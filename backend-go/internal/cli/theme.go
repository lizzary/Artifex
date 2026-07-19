package cli

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"artifex-backend/internal/settings"

	"charm.land/lipgloss/v2"
)

type ThemeMode string

const (
	ThemeAuto  ThemeMode = "auto"
	ThemeDark  ThemeMode = "dark"
	ThemeLight ThemeMode = "light"

	DefaultPortAttempts  = settings.DefaultPortAttempts
	MaxPortAttempts      = settings.MaxPortAttempts
	DefaultUploadWorkers = settings.DefaultUploadWorkers
	DefaultTaggerSlots   = settings.DefaultTaggerSlots
	MaxUploadWorkers     = settings.MaxUploadWorkers
	MaxTaggerSlots       = settings.MaxTaggerSlots
)

func ParseTheme(value string) (ThemeMode, error) {
	switch ThemeMode(strings.ToLower(strings.TrimSpace(value))) {
	case ThemeAuto, "":
		return ThemeAuto, nil
	case ThemeDark:
		return ThemeDark, nil
	case ThemeLight:
		return ThemeLight, nil
	default:
		return "", errors.New("theme must be auto, dark, or light")
	}
}

func LoadTheme(path string) ThemeMode {
	cfg, err := settings.Load(path)
	if err != nil {
		return ThemeAuto
	}
	mode, err := ParseTheme(cfg.CLI.Theme)
	if err != nil {
		return ThemeAuto
	}
	return mode
}

func SaveTheme(path string, mode ThemeMode) error {
	cfg, err := settings.Load(path)
	if err != nil {
		return err
	}
	cfg.CLI.Theme = string(mode)
	return settings.Save(path, cfg)
}

func ParsePortAttempts(value string) (int, error) {
	attempts, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || attempts < 1 || attempts > MaxPortAttempts {
		return 0, fmt.Errorf("port attempts must be between 1 and %d", MaxPortAttempts)
	}
	return attempts, nil
}

func LoadPortAttempts(path string) int {
	cfg, err := settings.Load(path)
	if err != nil {
		return DefaultPortAttempts
	}
	return cfg.CLI.PortAttempts
}

func SavePortAttempts(path string, attempts int) error {
	if attempts < 1 || attempts > MaxPortAttempts {
		return fmt.Errorf("port attempts must be between 1 and %d", MaxPortAttempts)
	}
	cfg, err := settings.Load(path)
	if err != nil {
		return err
	}
	cfg.CLI.PortAttempts = attempts
	return settings.Save(path, cfg)
}

func ParseUploadWorkers(value string) (int, error) {
	workers, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || workers < 1 || workers > MaxUploadWorkers {
		return 0, fmt.Errorf("upload workers must be between 1 and %d", MaxUploadWorkers)
	}
	return workers, nil
}

func ParseTaggerSlots(value string) (int, error) {
	slots, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || slots < 1 || slots > MaxTaggerSlots {
		return 0, fmt.Errorf("tagger slots must be between 1 and %d", MaxTaggerSlots)
	}
	return slots, nil
}

func LoadConcurrency(path string) (int, int) {
	cfg, err := settings.Load(path)
	if err != nil {
		return DefaultUploadWorkers, DefaultTaggerSlots
	}
	return cfg.UploadWorkers, cfg.TaggerSlots
}

func SaveUploadWorkers(path string, workers int) error {
	if workers < 1 || workers > MaxUploadWorkers {
		return fmt.Errorf("upload workers must be between 1 and %d", MaxUploadWorkers)
	}
	cfg, err := settings.Load(path)
	if err != nil {
		return err
	}
	cfg.UploadWorkers = workers
	return settings.Save(path, cfg)
}

func SaveTaggerSlots(path string, slots int) error {
	if slots < 1 || slots > MaxTaggerSlots {
		return fmt.Errorf("tagger slots must be between 1 and %d", MaxTaggerSlots)
	}
	cfg, err := settings.Load(path)
	if err != nil {
		return err
	}
	cfg.TaggerSlots = slots
	return settings.Save(path, cfg)
}

func DetectDark(mode ThemeMode) bool {
	switch mode {
	case ThemeDark:
		return true
	case ThemeLight:
		return false
	default:
		return lipgloss.HasDarkBackground(os.Stdin, os.Stdout)
	}
}

type palette struct {
	noColor   bool
	accent    string
	text      string
	secondary string
	muted     string
	success   string
	warning   string
	danger    string
	crab      string
	picture   string
	eye       string
}

func newPalette(dark bool) palette {
	p := palette{noColor: os.Getenv("NO_COLOR") != ""}
	if dark {
		p.accent = "#9B87F5"
		p.text = "#E4E2DF"
		p.secondary = "#B8B4AE"
		p.muted = "#6B6762"
		p.success = "#4ADE80"
		p.warning = "#FBBF24"
		p.danger = "#F87171"
		p.crab = "#F0A26A"
		p.picture = "#CFC7FF"
		p.eye = "#18181B"
	} else {
		p.accent = "#7C5CE0"
		p.text = "#2D2B28"
		p.secondary = "#555350"
		p.muted = "#958F88"
		p.success = "#22C55E"
		p.warning = "#D97706"
		p.danger = "#EF4444"
		p.crab = "#C76F3E"
		p.picture = "#BDB2F2"
		p.eye = "#18181B"
	}
	return p
}

func (p palette) style(color string) lipgloss.Style {
	style := lipgloss.NewStyle()
	if !p.noColor {
		style = style.Foreground(lipgloss.Color(color))
	}
	return style
}

func (p palette) accentStyle() lipgloss.Style    { return p.style(p.accent) }
func (p palette) textStyle() lipgloss.Style      { return p.style(p.text) }
func (p palette) secondaryStyle() lipgloss.Style { return p.style(p.secondary) }
func (p palette) mutedStyle() lipgloss.Style     { return p.style(p.muted) }
func (p palette) successStyle() lipgloss.Style   { return p.style(p.success) }
func (p palette) warningStyle() lipgloss.Style   { return p.style(p.warning) }
func (p palette) dangerStyle() lipgloss.Style    { return p.style(p.danger) }
func (p palette) crabStyle() lipgloss.Style      { return p.style(p.crab) }
