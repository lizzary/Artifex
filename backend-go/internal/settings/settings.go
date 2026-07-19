package settings

import (
	"encoding/json"
	"os"
)

// GroupConfigs is an opaque, frontend-managed shape used to persist color
// grouping configurations on a per-scope-and-type basis. Stored verbatim as
// JSON: { "<scope>": { "<type>": { "sets": [...], "active_id": "..." } } }.
type GroupConfigs map[string]map[string]json.RawMessage

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
	Theme        string `json:"theme"`
	PortAttempts int    `json:"port_attempts"`
}

type Settings struct {
	AutoTag              bool         `json:"auto_tag"`
	GPUEnabled           bool         `json:"gpu_enabled"`
	ActiveModel          string       `json:"active_model,omitempty"`
	UploadConflictPolicy string       `json:"upload_conflict_policy"`
	UploadWorkers        int          `json:"upload_workers"`
	TaggerSlots          int          `json:"tagger_slots"`
	GroupOrder           []int        `json:"group_order"`
	GroupConfigs         GroupConfigs `json:"group_configs"`
	CLI                  CLISettings  `json:"cli"`
}

func Load(path string) (*Settings, error) {
	s := &Settings{
		AutoTag:              true,
		GPUEnabled:           false,
		UploadConflictPolicy: "save_all",
		UploadWorkers:        DefaultUploadWorkers,
		TaggerSlots:          DefaultTaggerSlots,
		GroupOrder:           []int{},
		GroupConfigs:         GroupConfigs{},
		CLI: CLISettings{
			Theme:        DefaultCLITheme,
			PortAttempts: DefaultPortAttempts,
		},
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return s, nil
		}
		return s, err
	}

	if err := json.Unmarshal(data, s); err != nil {
		return s, nil // Return defaults on parse error
	}

	if s.UploadConflictPolicy != "save_all" && s.UploadConflictPolicy != "skip" && s.UploadConflictPolicy != "overwrite" {
		s.UploadConflictPolicy = "save_all"
	}
	if s.UploadWorkers < 1 || s.UploadWorkers > MaxUploadWorkers {
		s.UploadWorkers = DefaultUploadWorkers
	}
	if s.TaggerSlots < 1 || s.TaggerSlots > MaxTaggerSlots {
		s.TaggerSlots = DefaultTaggerSlots
	}
	if s.GroupOrder == nil {
		s.GroupOrder = []int{}
	}
	if s.GroupConfigs == nil {
		s.GroupConfigs = GroupConfigs{}
	}
	if s.CLI.Theme != "auto" && s.CLI.Theme != "dark" && s.CLI.Theme != "light" {
		s.CLI.Theme = DefaultCLITheme
	}
	if s.CLI.PortAttempts < 1 || s.CLI.PortAttempts > MaxPortAttempts {
		s.CLI.PortAttempts = DefaultPortAttempts
	}

	return s, nil
}

func Save(path string, s *Settings) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
