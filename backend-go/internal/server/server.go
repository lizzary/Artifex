package server

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"artifex-backend/internal/applog"
	"artifex-backend/internal/database"
	"artifex-backend/internal/models"
	"artifex-backend/internal/settings"
	"artifex-backend/internal/workerlimit"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

type ServerConfig struct {
	DatabaseDir   string
	SettingsPath  string
	FrontendDir   string
	UploadWorkers int
	Log           *applog.Hub
}

const multipartMemoryLimit int64 = 32 << 20

func parseMultipartForm(w http.ResponseWriter, r *http.Request, maxBytes int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	return r.ParseMultipartForm(multipartMemoryLimit)
}

func multipartErrorStatus(err error) int {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return http.StatusRequestEntityTooLarge
	}
	return http.StatusBadRequest
}

type Server struct {
	Router              *chi.Mux
	Config              ServerConfig
	uploadLimiter       *workerlimit.Limiter
	uploadMemoryLimiter *workerlimit.Weighted
	uploadCommitMu      sync.Mutex
	removeUploadDir     func(string) error
	db                  *sql.DB
	libraryMu           sync.RWMutex
	libraryID           string
	exports             exportTickets
}

// Image decoding and Lanczos thumbnail generation need several times the
// source pixel buffer. Keep that working set bounded independently from the
// user-selected worker count so that 16/32 workers remain safe for large art.
const uploadDecodeMemoryBudget int64 = 512 << 20

func NewServer(cfg ServerConfig) (*Server, error) {
	db, err := openLibrary(cfg.DatabaseDir)
	if err != nil {
		return nil, err
	}
	if cfg.UploadWorkers < 1 || cfg.UploadWorkers > settings.MaxUploadWorkers {
		cfg.UploadWorkers = settings.DefaultUploadWorkers
	}
	s := &Server{
		Config:              cfg,
		uploadLimiter:       workerlimit.New(cfg.UploadWorkers),
		uploadMemoryLimiter: workerlimit.NewWeighted(uploadDecodeMemoryBudget),
		removeUploadDir:     os.RemoveAll,
		db:                  db,
		libraryID:           rand.Text(),
	}

	// Router setup
	r := chi.NewRouter()

	// Middleware
	r.Use(chimw.RequestID)
	r.Use(s.requestLogger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.StripSlashes)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		ExposedHeaders:   []string{"X-Artifex-Library"},
		AllowCredentials: true,
	}))

	// API routes
	r.Route("/api", func(r chi.Router) {
		r.Use(s.withLibrary)
		// Groups
		r.Get("/groups", s.ListGroups)
		r.Post("/groups", s.CreateGroup)
		r.Get("/groups/{groupId}", s.GetGroup)
		r.Put("/groups/{groupId}", s.UpdateGroup)
		r.Delete("/groups/{groupId}", s.DeleteGroup)

		// Illustrations
		r.Get("/groups/{groupId}/illustrations", s.ListIllustrations)
		r.Post("/groups/{groupId}/illustrations/upload", s.UploadIllustrations)
		r.Post("/illustrations/tags", s.UpdateIllustrationTags)
		r.Post("/illustrations/retag", s.RetagIllustrations)
		r.Get("/illustrations/{illustrationId}", s.GetIllustration)
		r.Put("/illustrations/{illustrationId}", s.UpdateIllustration)
		r.Delete("/illustrations/{illustrationId}", s.DeleteIllustration)
		r.Get("/illustrations/{illustrationId}/file", s.ServeIllustrationFile)
		r.Get("/illustrations/{illustrationId}/thumbnail", s.ServeIllustrationThumbnail)
		r.Get("/illustrations/{illustrationId}/metadata", s.GetIllustrationMetadata)
		r.Get("/export/catalog", s.GetExportCatalog)
		r.Get("/export/draft/{scope}", s.GetExportDraft)
		r.Put("/export/draft/{scope}", s.SaveExportDraft)
		r.Post("/export/download", s.PrepareExport)
		r.Get("/export/download/{ticket}", s.DownloadExport)

		// Search
		r.Get("/search", s.SearchIllustrations)

		// Tags & Prompts
		r.Get("/tags", s.ListTags)
		r.Get("/prompts", s.ListPrompts)

		// Model
		r.Get("/model/status", s.ModelStatus)
		r.Post("/model/download", s.ModelDownload)
		r.Delete("/model/default", s.DeleteDefaultModel)
		r.Get("/models", s.ListModels)
		r.Post("/models/upload", s.UploadModel)
		r.Delete("/models/{modelName}", s.DeleteModel)

		// Settings
		r.Get("/settings", s.GetSettings)
		r.Put("/settings", s.UpdateSettings)
		r.Get("/group-config", s.GetGroupConfig)
		r.Put("/group-config", s.UpdateGroupConfig)
		r.Post("/groups/{groupId}/color-operations", s.ApplyColorOperations)
	})

	// SPA catch-all (registered last so API routes take priority)
	if _, err := os.Stat(s.FrontendDir()); err == nil {
		s.registerStaticRoutes(r)
	}

	s.Router = r
	return s, nil
}

func (s *Server) UploadsDir() string   { return filepath.Join(s.Config.DatabaseDir, "uploads") }
func (s *Server) ModelsDir() string    { return filepath.Join(s.Config.DatabaseDir, "models") }
func (s *Server) SettingsPath() string { return s.Config.SettingsPath }
func (s *Server) FrontendDir() string  { return s.Config.FrontendDir }

func openLibrary(root string) (*sql.DB, error) {
	if !filepath.IsAbs(root) {
		return nil, fmt.Errorf("database directory must be absolute")
	}
	for _, dir := range []string{"uploads", filepath.Join("models", "default"), filepath.Join("models", "user_model")} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0755); err != nil {
			return nil, err
		}
	}
	return database.Open(filepath.Join(root, "gallery.db"))
}

// A settings update may replace the entire library. Wait for in-flight uploads,
// model downloads, and file responses before changing any path or connection.
func (s *Server) withLibrary(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		// Illustration IDs can be reused by a different library. A conditional
		// file request must never reuse bytes belonging to the previous library.
		r.Header.Del("If-Modified-Since")
		r.Header.Del("If-None-Match")
		if r.Method == http.MethodPut && strings.TrimSuffix(r.URL.Path, "/") == "/api/settings" {
			s.libraryMu.Lock()
			defer s.libraryMu.Unlock()
		} else {
			s.libraryMu.RLock()
			defer s.libraryMu.RUnlock()
		}
		w.Header().Set("X-Artifex-Library", s.libraryID)
		if expected := r.Header.Get("X-Artifex-Library"); expected != "" && expected != s.libraryID {
			writeError(w, http.StatusConflict, "The database directory has changed. Reload the page before continuing.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) Close() error {
	s.libraryMu.Lock()
	defer s.libraryMu.Unlock()
	return s.db.Close()
}

func (s *Server) SetUploadWorkers(workers int) {
	if workers < 1 || workers > settings.MaxUploadWorkers {
		workers = settings.DefaultUploadWorkers
	}
	s.uploadLimiter.SetLimit(workers)
}

func (s *Server) UploadWorkers() int {
	return s.uploadLimiter.Limit()
}

func (s *Server) logger() *applog.Hub {
	if s.Config.Log != nil {
		return s.Config.Log
	}
	return applog.Default()
}

func (s *Server) requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)

		level := applog.LevelInfo
		if ww.Status() >= http.StatusInternalServerError {
			level = applog.LevelError
		} else if ww.Status() >= http.StatusBadRequest {
			level = applog.LevelWarn
		}
		s.logger().Log(
			level,
			"http",
			"%s %s  status=%d bytes=%d duration=%s",
			r.Method,
			r.URL.RequestURI(),
			ww.Status(),
			ww.BytesWritten(),
			time.Since(started).Round(time.Millisecond),
		)
	})
}

func (s *Server) registerStaticRoutes(r chi.Router) {
	frontendDir := s.FrontendDir()
	fs := http.FileServer(http.Dir(frontendDir))
	r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(frontendDir, r.URL.Path)
		if r.URL.Path != "/" {
			if info, err := os.Stat(path); err == nil && !info.IsDir() {
				fs.ServeHTTP(w, r)
				return
			}
		}
		// SPA fallback: serve index.html
		http.ServeFile(w, r, filepath.Join(frontendDir, "index.html"))
	})
}

// ── Helpers ─────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, detail string) {
	writeJSON(w, status, models.ErrorResponse{Detail: detail})
}

func intParam(r *http.Request, name string) (int, error) {
	return strconv.Atoi(chi.URLParam(r, name))
}

func queryInt(r *http.Request, name string, defaultVal int, min int, max int) int {
	s := r.URL.Query().Get(name)
	if s == "" {
		return defaultVal
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return defaultVal
	}
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}
