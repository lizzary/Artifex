package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"artifex-backend/internal/models"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

type ServerConfig struct {
	BaseDir      string
	UploadsDir   string
	ModelsDir    string
	SettingsPath string
	FrontendDir  string
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
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.RequestID)
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
