package settings

import (
	"encoding/json"
	"os"
)

// GroupConfigs is an opaque, frontend-managed shape used to persist color
// grouping configurations on a per-scope-and-type basis. Stored verbatim as
// JSON: { "<scope>": { "<type>": { "sets": [...], "active_id": "..." } } }.
type GroupConfigs map[string]map[string]json.RawMessage

type Settings struct {
	AutoTag              bool         `json:"auto_tag"`
	GPUEnabled           bool         `json:"gpu_enabled"`
	ActiveModel          string       `json:"active_model,omitempty"`
	UploadConflictPolicy string       `json:"upload_conflict_policy"`
	GroupOrder           []int        `json:"group_order"`
	GroupConfigs         GroupConfigs `json:"group_configs"`
}

func Load(path string) (*Settings, error) {
	s := &Settings{
		AutoTag:              true,
		GPUEnabled:           false,
		UploadConflictPolicy: "skip",
		GroupOrder:           []int{},
		GroupConfigs:         GroupConfigs{},
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

	if s.UploadConflictPolicy != "skip" && s.UploadConflictPolicy != "overwrite" {
		s.UploadConflictPolicy = "skip"
	}
	if s.GroupOrder == nil {
		s.GroupOrder = []int{}
	}
	if s.GroupConfigs == nil {
		s.GroupConfigs = GroupConfigs{}
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
