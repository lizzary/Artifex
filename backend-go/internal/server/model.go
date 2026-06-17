package server

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"artifex-backend/internal/models"
	"artifex-backend/internal/tagger"
)

// ── Model Status ────────────────────────────────────────────────────────

func (s *Server) ModelStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, models.ModelStatusResponse{
		Cached: tagger.IsModelCached(s.ModelsDir()),
	})
}

// ── Model Download ──────────────────────────────────────────────────────

func (s *Server) ModelDownload(w http.ResponseWriter, r *http.Request) {
	if err := tagger.DownloadModel(s.ModelsDir()); err != nil {
		writeError(w, 500, "Model download failed: "+err.Error())
		return
	}
	// Reload tagger so the newly downloaded model takes effect immediately
	if err := tagger.LoadTagger(s.ModelsDir()); err != nil {
		fmt.Println("Tagger reload after download failed:", err)
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

// ── List Models ─────────────────────────────────────────────────────────

func (s *Server) ListModels(w http.ResponseWriter, r *http.Request) {
	modelList := tagger.ListAvailableModels(s.ModelsDir())
	activeModel := tagger.GetActiveModel()
	writeJSON(w, 200, models.ModelListResponse{
		Models:      modelList,
		ActiveModel: activeModel,
	})
}

// ── Upload Model ────────────────────────────────────────────────────────

func (s *Server) UploadModel(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(512 << 20); err != nil {
		writeError(w, 400, "Failed to parse upload")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, 400, "No file provided")
		return
	}
	defer file.Close()

	safeName := filepath.Base(header.Filename)
	if safeName == "" || safeName == "." || safeName == ".." {
		writeError(w, 400, "Invalid filename")
		return
	}

	ext := strings.ToLower(filepath.Ext(safeName))
	if ext != ".onnx" && ext != ".csv" {
		writeError(w, 400, "Only .onnx and .csv files are accepted")
		return
	}

	userModelDir := filepath.Join(s.ModelsDir(), "user_model")
	os.MkdirAll(userModelDir, 0755)

	dest := filepath.Join(userModelDir, safeName)
	if _, err := os.Stat(dest); err == nil {
		writeError(w, 409, "File '"+safeName+"' already exists")
		return
	}

	buf := make([]byte, header.Size)
	if _, err := file.Read(buf); err != nil {
		writeError(w, 500, "Failed to read file")
		return
	}

	if err := os.WriteFile(dest, buf, 0644); err != nil {
		writeError(w, 500, "Failed to save file")
		return
	}

	info, _ := os.Stat(dest)
	fileSize := info.Size()
	writeJSON(w, 201, models.ModelUploadResponse{
		Name: safeName,
		Type: "user",
		Size: fileSize,
	})
}

// ── Delete Model ────────────────────────────────────────────────────────

func (s *Server) DeleteModel(w http.ResponseWriter, r *http.Request) {
	modelName := filepath.Base(r.PathValue("modelName"))
	if modelName == "" || modelName == "." || modelName == ".." {
		writeError(w, 400, "Invalid model name")
		return
	}

	userModelDir := filepath.Join(s.ModelsDir(), "user_model")
	target := filepath.Join(userModelDir, modelName)

	// Path traversal check
	realTarget, _ := filepath.EvalSymlinks(target)
	realBase, _ := filepath.EvalSymlinks(userModelDir)
	if !strings.HasPrefix(realTarget, realBase) {
		writeError(w, 400, "Path traversal denied")
		return
	}

	if _, err := os.Stat(target); os.IsNotExist(err) {
		writeError(w, 404, "Model not found")
		return
	}

	if err := os.Remove(target); err != nil {
		writeError(w, 500, "Failed to delete: "+err.Error())
		return
	}

	// If the deleted model was active, reset to default
	if tagger.GetActiveModel() == modelName {
		tagger.SetActiveModel("")
		if err := tagger.LoadTagger(s.ModelsDir()); err != nil {
			fmt.Println("Tagger reload after model deletion failed:", err)
		}
	}

	writeJSON(w, 200, map[string]string{"status": "deleted"})
}
