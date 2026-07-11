package tagger

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"artifex-backend/internal/applog"
	"artifex-backend/internal/models"
)

const (
	DefaultModelRepo = "lizzary111/wd-eva02-large-tagger-v3"
	DefaultONNX      = "wd-eva02-large-tagger-v3.onnx"
	DefaultTags      = "tags.csv"
)

var defaultModelFiles = []string{
	"wd-eva02-large-tagger-v3.onnx",
	"wd-eva02-large-tagger-v3.onnx.data",
	"tags.csv",
}

var hfBaseURL = "https://huggingface.co/%s/resolve/main/%s"

var (
	activeModel string
	useGPU      bool
	modelMu     sync.RWMutex
)

// ── Active model management ──────────────────────────────────────────────

func SetActiveModel(name string) {
	modelMu.Lock()
	defer modelMu.Unlock()
	activeModel = strings.TrimSpace(name)
}

func GetActiveModel() string {
	modelMu.RLock()
	defer modelMu.RUnlock()
	return activeModel
}

func SetUseGPU(enabled bool) {
	modelMu.Lock()
	defer modelMu.Unlock()
	useGPU = enabled
}

// ── Model availability ───────────────────────────────────────────────────

func IsModelCached(modelsDir string) bool {
	_, err := os.Stat(filepath.Join(modelsDir, "default", DefaultONNX))
	return err == nil
}

// DeleteDefaultModel removes the entire <modelsDir>/default directory so the
// user can re-trigger a clean download after a corrupted/partial fetch.
// If the active model is the default (active == ""), the in-memory tagger
// session is released first so Windows doesn't keep the .onnx file locked.
func DeleteDefaultModel(modelsDir string) error {
	if GetActiveModel() == "" {
		clearTaggerCache()
	}
	defaultDir := filepath.Join(modelsDir, "default")
	if err := os.RemoveAll(defaultDir); err != nil {
		return fmt.Errorf("failed to delete default model directory: %w", err)
	}
	if err := os.MkdirAll(defaultDir, 0755); err != nil {
		return fmt.Errorf("failed to recreate default model directory: %w", err)
	}
	return nil
}

func DownloadModel(modelsDir string) error {
	defaultDir := filepath.Join(modelsDir, "default")
	os.MkdirAll(defaultDir, 0755)

	applog.Info("model", "downloading default model from %s", DefaultModelRepo)
	for _, filename := range defaultModelFiles {
		dest := filepath.Join(defaultDir, filename)
		if _, err := os.Stat(dest); err == nil {
			applog.Info("model", "%s already cached", filename)
			continue
		}
		applog.Info("model", "downloading %s", filename)
		url := fmt.Sprintf(hfBaseURL, DefaultModelRepo, filename)
		if err := downloadFile(url, dest); err != nil {
			return fmt.Errorf("failed to download %s: %w", filename, err)
		}
	}
	applog.Info("model", "default model download complete")
	return nil
}

func ListAvailableModels(modelsDir string) []models.ModelInfo {
	result := make([]models.ModelInfo, 0)

	defaultONNX := filepath.Join(modelsDir, "default", DefaultONNX)
	cached := false
	if _, err := os.Stat(defaultONNX); err == nil {
		cached = true
	}
	result = append(result, models.ModelInfo{
		Name:   "wd-eva02-large-tagger-v3 (Default)",
		Type:   "default",
		Cached: &cached,
	})

	userDir := filepath.Join(modelsDir, "user_model")
	entries, err := os.ReadDir(userDir)
	if err != nil {
		return result
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if strings.HasSuffix(strings.ToLower(entry.Name()), ".onnx") {
			info, _ := entry.Info()
			size := info.Size()
			result = append(result, models.ModelInfo{
				Name: entry.Name(),
				Type: "user",
				Size: &size,
			})
		}
	}
	return result
}

// ── Helpers ──────────────────────────────────────────────────────────────

func downloadFile(url, dest string) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = io.Copy(f, resp.Body)
	return err
}
