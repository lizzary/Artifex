package settings

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/pelletier/go-toml/v2"
)

const (
	DefaultCLITheme      = "auto"
	DefaultPortAttempts  = 30
	DefaultUploadWorkers = 4
	DefaultTaggerSlots   = 1
	MaxPortAttempts      = 65536
	MaxUploadWorkers     = 32
	MaxTaggerSlots       = 16
)

type CLISettings struct {
	Theme        string `json:"theme" toml:"theme"`
	PortAttempts int    `json:"port_attempts" toml:"port_attempts"`
}

type Settings struct {
	DatabaseDir          string      `json:"database_dir" toml:"database_dir"`
	AutoTag              bool        `json:"auto_tag" toml:"auto_tag"`
	GPUEnabled           bool        `json:"gpu_enabled" toml:"gpu_enabled"`
	ActiveModel          string      `json:"active_model" toml:"active_model"`
	UploadConflictPolicy string      `json:"upload_conflict_policy" toml:"upload_conflict_policy"`
	UploadWorkers        int         `json:"upload_workers" toml:"upload_workers"`
	TaggerSlots          int         `json:"tagger_slots" toml:"tagger_slots"`
	BoardRenderer        string      `json:"board_renderer" toml:"board_renderer"`
	DownloadNamingFormat string      `json:"download_naming_format" toml:"download_naming_format"`
	BoardFreeRowLimit    int         `json:"board_free_row_limit" toml:"board_free_row_limit"`
	CLI                  CLISettings `json:"cli" toml:"cli"`
}

// Every writer, including the terminal UI, uses the same read-modify-write lock.
var fileMu sync.Mutex

func Load(path string) (*Settings, error) {
	fileMu.Lock()
	defer fileMu.Unlock()
	return load(path)
}

func load(path string) (*Settings, error) {
	s := &Settings{
		DatabaseDir: filepath.Dir(path), AutoTag: true,
		UploadConflictPolicy: "save_all", UploadWorkers: DefaultUploadWorkers,
		TaggerSlots: DefaultTaggerSlots, BoardRenderer: "auto", BoardFreeRowLimit: 10,
		CLI: CLISettings{Theme: DefaultCLITheme, PortAttempts: DefaultPortAttempts},
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := toml.Unmarshal(data, s); err != nil {
		return nil, fmt.Errorf("parse config.toml: %w", err)
	}
	if err := s.Validate(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Settings) Validate() error {
	if !filepath.IsAbs(s.DatabaseDir) {
		return fmt.Errorf("database_dir must be an absolute directory path")
	}
	if s.UploadConflictPolicy != "save_all" && s.UploadConflictPolicy != "skip" && s.UploadConflictPolicy != "overwrite" {
		return fmt.Errorf("invalid upload_conflict_policy")
	}
	if s.UploadWorkers < 1 || s.UploadWorkers > MaxUploadWorkers {
		return fmt.Errorf("upload_workers must be between 1 and %d", MaxUploadWorkers)
	}
	if s.TaggerSlots < 1 || s.TaggerSlots > MaxTaggerSlots {
		return fmt.Errorf("tagger_slots must be between 1 and %d", MaxTaggerSlots)
	}
	if s.BoardRenderer != "auto" && s.BoardRenderer != "dom" && s.BoardRenderer != "webgl" {
		return fmt.Errorf("invalid board_renderer")
	}
	if s.BoardFreeRowLimit < 5 || s.BoardFreeRowLimit > 30 {
		return fmt.Errorf("board_free_row_limit must be between 5 and 30")
	}
	if s.CLI.Theme != "auto" && s.CLI.Theme != "dark" && s.CLI.Theme != "light" {
		return fmt.Errorf("invalid CLI theme")
	}
	if s.CLI.PortAttempts < 1 || s.CLI.PortAttempts > MaxPortAttempts {
		return fmt.Errorf("invalid port_attempts")
	}
	if s.ActiveModel != "" && (filepath.Base(s.ActiveModel) != s.ActiveModel || !strings.EqualFold(filepath.Ext(s.ActiveModel), ".onnx")) {
		return fmt.Errorf("active_model must be an ONNX filename")
	}
	return nil
}

// Update writes only after the supplied change has completed successfully.
func Update(path string, change func(*Settings) error) (*Settings, error) {
	fileMu.Lock()
	defer fileMu.Unlock()
	s, err := load(path)
	if err != nil {
		return nil, err
	}
	if err := change(s); err != nil {
		return nil, err
	}
	if err := s.Validate(); err != nil {
		return nil, err
	}
	data, err := toml.Marshal(s)
	if err != nil {
		return nil, err
	}
	if err := WriteFile(path, data); err != nil {
		return nil, err
	}
	return s, nil
}

// WriteFile replaces a complete configuration without exposing a partial write.
func WriteFile(path string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".config-*")
	if err != nil {
		return err
	}
	temp := f.Name()
	defer os.Remove(temp)
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(temp, path)
}
