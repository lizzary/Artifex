package tagger

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

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

func DownloadModel(modelsDir string) error {
	defaultDir := filepath.Join(modelsDir, "default")
	os.MkdirAll(defaultDir, 0755)

	fmt.Println("Downloading default model from", DefaultModelRepo, "...")
	for _, filename := range defaultModelFiles {
		dest := filepath.Join(defaultDir, filename)
		if _, err := os.Stat(dest); err == nil {
			fmt.Println("  ", filename, "— already cached")
			continue
		}
		fmt.Println("  ", filename, "— downloading...")
		url := fmt.Sprintf(hfBaseURL, DefaultModelRepo, filename)
		if err := downloadFile(url, dest); err != nil {
			return fmt.Errorf("failed to download %s: %w", filename, err)
		}
	}
	fmt.Println("Default model download complete.")
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
