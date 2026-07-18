package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"artifex-backend/internal/applog"
	"artifex-backend/internal/models"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

type ServerConfig struct {
	UploadsDir   string
	ModelsDir    string
	SettingsPath string
	FrontendDir  string
	Log          *applog.Hub
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
	Router *chi.Mux
	Config ServerConfig
}

func NewServer(cfg ServerConfig) *Server {
	s := &Server{Config: cfg}

	// Create required directories
	os.MkdirAll(s.UploadsDir(), 0755)
	os.MkdirAll(filepath.Join(s.ModelsDir(), "default"), 0755)
	os.MkdirAll(filepath.Join(s.ModelsDir(), "user_model"), 0755)

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
		AllowCredentials: true,
	}))

	// API routes
	r.Route("/api", func(r chi.Router) {
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
	})

	// SPA catch-all (registered last so API routes take priority)
	if _, err := os.Stat(s.FrontendDir()); err == nil {
		s.registerStaticRoutes(r)
	}

	s.Router = r
	return s
}

func (s *Server) UploadsDir() string   { return s.Config.UploadsDir }
func (s *Server) ModelsDir() string    { return s.Config.ModelsDir }
func (s *Server) SettingsPath() string { return s.Config.SettingsPath }
func (s *Server) FrontendDir() string  { return s.Config.FrontendDir }

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
