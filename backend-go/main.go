package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"artifex-backend/internal/database"
	"artifex-backend/internal/server"
	"artifex-backend/internal/settings"
	"artifex-backend/internal/tagger"
)

func main() {
	// CLI flags
	host := flag.String("host", "127.0.0.1", "Host to listen on")
	port := flag.Int("port", 8000, "Port to listen on")
	dbPath := flag.String("db", "", "Path to SQLite database (default: <basedir>/gallery.db)")
	uploadsDir := flag.String("uploads", "", "Path to uploads directory (default: <basedir>/uploads)")
	modelsDir := flag.String("models", "", "Path to models directory (default: <basedir>/models)")
	frontendDir := flag.String("frontend", "", "Path to frontend build directory")
	flag.Parse()

	// Determine base directory
	baseDir := "."
	if execPath, err := os.Executable(); err == nil {
		baseDir = filepath.Dir(execPath)
	}
	// Override with working directory for dev (if settings.json exists there)
	if wd, err := os.Getwd(); err == nil {
		if _, err := os.Stat(filepath.Join(wd, "settings.json")); err == nil {
			baseDir = wd
		}
	}

	// Set paths
	if *dbPath == "" {
		*dbPath = filepath.Join(baseDir, "gallery.db")
	}
	if *uploadsDir == "" {
		*uploadsDir = filepath.Join(baseDir, "uploads")
	}
	if *modelsDir == "" {
		*modelsDir = filepath.Join(baseDir, "models")
	}
	settingsPath := filepath.Join(baseDir, "settings.json")

	// Determine frontend build path
	if *frontendDir == "" {
		// Check packaged layout first (_internal/frontend)
		packagedFrontend := filepath.Join(baseDir, "frontend")
		if _, err := os.Stat(packagedFrontend); err == nil {
			*frontendDir = packagedFrontend
		} else {
			// Dev layout: ../frontend/build relative to binary/working dir
			devFrontend := filepath.Join(baseDir, "..", "frontend", "build")
			if abs, err := filepath.Abs(devFrontend); err == nil {
				devFrontend = abs
			}
			if _, err := os.Stat(devFrontend); err == nil {
				*frontendDir = devFrontend
			}
		}
	}

	// Initialize database
	fmt.Println("Initializing database...")
	if err := database.InitDB(*dbPath); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Load settings
	st, err := settings.Load(settingsPath)
	if err != nil {
		log.Printf("Warning: Could not load settings: %v", err)
	}

	// Apply GPU and model settings
	tagger.SetUseGPU(st.GPUEnabled)
	if st.ActiveModel != "" {
		tagger.SetActiveModel(st.ActiveModel)
	}

	// Pre-load tagger if auto-tag is enabled
	if st.AutoTag {
		fmt.Println("Loading tagger model...")
		if err := tagger.LoadTagger(*modelsDir); err != nil {
			fmt.Println("  Tagger not available:", err)
			fmt.Println("  Auto-tagging will be skipped.")
			fmt.Println("  Download the model from Settings page.")
		}
	}

	// Create server with explicit config
	srv := server.NewServer(server.ServerConfig{
		BaseDir:      baseDir,
		UploadsDir:   *uploadsDir,
		ModelsDir:    *modelsDir,
		SettingsPath: settingsPath,
		FrontendDir:  *frontendDir,
	})

	// Create HTTP server
	addr := fmt.Sprintf("%s:%d", *host, *port)
	httpServer := &http.Server{
		Addr:         addr,
		Handler:      srv.Router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		fmt.Println("\nShutting down...")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		httpServer.Shutdown(ctx)
	}()

	fmt.Printf("\n  Artifex Backend (Go)\n")
	fmt.Printf("  Listening on http://%s\n", addr)
	fmt.Printf("  Frontend: %s\n\n", srv.FrontendDir())

	if err := httpServer.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)
	}
	fmt.Println("Server stopped.")
}
