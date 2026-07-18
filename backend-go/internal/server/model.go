package server

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"artifex-backend/internal/models"
	"artifex-backend/internal/tagger"
)

const (
	maxModelUploadBytes  int64 = 2 << 30
	maxModelRequestBytes       = maxModelUploadBytes + 1<<20
)

// ── Model Status ────────────────────────────────────────────────────────

func (s *Server) ModelStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, models.ModelStatusResponse{
		Cached: tagger.IsModelCached(s.ModelsDir()) && tagger.IsTaggerReady(),
	})
}

// ── Model Download ──────────────────────────────────────────────────────

func (s *Server) ModelDownload(w http.ResponseWriter, r *http.Request) {
	if err := tagger.DownloadModel(r.Context(), s.ModelsDir()); err != nil {
		writeError(w, 500, "Model download failed: "+err.Error())
		return
	}
	if err := tagger.LoadTagger(s.ModelsDir()); err != nil {
		writeError(w, 500, "Downloaded model could not be loaded: "+err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

// ── Delete Default Model ────────────────────────────────────────────────

func (s *Server) DeleteDefaultModel(w http.ResponseWriter, r *http.Request) {
	if err := tagger.DeleteDefaultModel(s.ModelsDir()); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted"})
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
	if err := parseMultipartForm(w, r, maxModelRequestBytes); err != nil {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
		writeError(w, multipartErrorStatus(err), "Failed to parse upload")
		return
	}
	defer r.MultipartForm.RemoveAll()

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
	if header.Size > maxModelUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "Model exceeds the 2 GiB upload limit")
		return
	}

	userModelDir := filepath.Join(s.ModelsDir(), "user_model")
	if err := os.MkdirAll(userModelDir, 0755); err != nil {
		writeError(w, 500, "Failed to prepare model directory")
		return
	}

	dest := filepath.Join(userModelDir, safeName)
	destFile, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if errors.Is(err, os.ErrExist) {
		writeError(w, 409, "File '"+safeName+"' already exists")
		return
	}
	if err != nil {
		writeError(w, 500, "Failed to create model file")
		return
	}
	keep := false
	defer func() {
		_ = destFile.Close()
		if !keep {
			_ = os.Remove(dest)
		}
	}()

	fileSize, copyErr := io.Copy(destFile, io.LimitReader(file, maxModelUploadBytes+1))
	closeErr := destFile.Close()
	if copyErr != nil || closeErr != nil {
		writeError(w, 500, "Failed to save file")
		return
	}
	if fileSize > maxModelUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "Model exceeds the 2 GiB upload limit")
		return
	}
	keep = true
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
			s.logger().Warn("tagger", "reload after model deletion failed: %v", err)
		}
	}

	writeJSON(w, 200, map[string]string{"status": "deleted"})
}
