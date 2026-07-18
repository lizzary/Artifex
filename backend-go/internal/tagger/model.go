package tagger

import (
	"context"
	"crypto/sha256"
	"errors"
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
	DefaultModelRepo     = "lizzary111/wd-eva02-large-tagger-v3"
	DefaultModelRevision = "5f605f53bd4e28e3c80699fad6391ea94c5ae7d4"
	DefaultONNX          = "wd-eva02-large-tagger-v3.onnx"
	DefaultONNXData      = "wd-eva02-large-tagger-v3.onnx.data"
	DefaultTags          = "tags.csv"
)

var ErrDefaultModelIncomplete = errors.New("default model is incomplete")

type modelFile struct {
	name   string
	size   int64
	sha256 string
}

var defaultModelFiles = []modelFile{
	{name: DefaultONNX, size: 2_397_717, sha256: "1d57a41fdb9fc2d9dd2d6caedbab360668e357f9e4d4c630520b19a01ed0c9c9"},
	{name: DefaultONNXData, size: 1_262_538_752, sha256: "d6066bd40bf16b984003521d3fed26e8976b859523c6a6ec7e2b9d93d1019737"},
	{name: DefaultTags, size: 308_468, sha256: "298633d94d0031d2081c0893f29c82eab7f0df00b08483ba8f29d1e979441217"},
}

var hfBaseURL = "https://huggingface.co/%s/resolve/%s/%s"

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
	return validateDefaultModelDir(filepath.Join(modelsDir, "default"), false) == nil
}

func ValidateDefaultModel(modelsDir string) error {
	return validateDefaultModelDir(filepath.Join(modelsDir, "default"), true)
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

func DownloadModel(ctx context.Context, modelsDir string) error {
	if err := os.MkdirAll(modelsDir, 0755); err != nil {
		return fmt.Errorf("failed to prepare model directory: %w", err)
	}
	stagingDir, err := os.MkdirTemp(modelsDir, ".default-download-")
	if err != nil {
		return fmt.Errorf("failed to create model staging directory: %w", err)
	}
	defer os.RemoveAll(stagingDir)

	applog.Info("model", "downloading default model from %s", DefaultModelRepo)
	for _, file := range defaultModelFiles {
		applog.Info("model", "downloading %s", file.name)
		url := fmt.Sprintf(hfBaseURL, DefaultModelRepo, DefaultModelRevision, file.name)
		if err := downloadFile(ctx, url, filepath.Join(stagingDir, file.name), file); err != nil {
			return fmt.Errorf("failed to download %s: %w", file.name, err)
		}
	}

	if GetActiveModel() == "" {
		clearTaggerCache()
	}
	defaultDir := filepath.Join(modelsDir, "default")
	backupDir := stagingDir + ".previous"
	if err := os.Rename(defaultDir, backupDir); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to replace default model: %w", err)
	}
	if err := os.Rename(stagingDir, defaultDir); err != nil {
		_ = os.Rename(backupDir, defaultDir)
		return fmt.Errorf("failed to activate downloaded model: %w", err)
	}
	_ = os.RemoveAll(backupDir)
	applog.Info("model", "default model download complete")
	return nil
}

func ListAvailableModels(modelsDir string) []models.ModelInfo {
	result := make([]models.ModelInfo, 0)

	cached := IsModelCached(modelsDir)
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

func validateDefaultModelDir(dir string, verifyHash bool) error {
	for _, file := range defaultModelFiles {
		path := filepath.Join(dir, file.name)
		info, err := os.Stat(path)
		if err != nil {
			return fmt.Errorf("%w: %s is missing", ErrDefaultModelIncomplete, file.name)
		}
		if info.IsDir() || info.Size() != file.size {
			return fmt.Errorf("%w: %s has an unexpected size", ErrDefaultModelIncomplete, file.name)
		}
		if !verifyHash {
			continue
		}
		f, err := os.Open(path)
		if err != nil {
			return fmt.Errorf("%w: cannot read %s: %v", ErrDefaultModelIncomplete, file.name, err)
		}
		hash := sha256.New()
		_, copyErr := io.Copy(hash, f)
		closeErr := f.Close()
		if copyErr != nil || closeErr != nil || fmt.Sprintf("%x", hash.Sum(nil)) != file.sha256 {
			return fmt.Errorf("%w: %s failed checksum validation", ErrDefaultModelIncomplete, file.name)
		}
	}
	return nil
}

func downloadFile(ctx context.Context, url, dest string, expected modelFile) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	if resp.ContentLength >= 0 && resp.ContentLength != expected.size {
		return fmt.Errorf("%w: server reported an unexpected size", ErrDefaultModelIncomplete)
	}

	f, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	keep := false
	defer func() {
		_ = f.Close()
		if !keep {
			_ = os.Remove(dest)
		}
	}()

	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(f, hash), io.LimitReader(resp.Body, expected.size+1))
	closeErr := f.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if written != expected.size || fmt.Sprintf("%x", hash.Sum(nil)) != expected.sha256 {
		return fmt.Errorf("%w: downloaded content failed validation", ErrDefaultModelIncomplete)
	}
	keep = true
	return nil
}
