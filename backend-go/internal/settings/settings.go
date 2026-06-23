package settings

import (
	"encoding/json"
	"os"
)

type Settings struct {
	AutoTag              bool   `json:"auto_tag"`
	GPUEnabled           bool   `json:"gpu_enabled"`
	ActiveModel          string `json:"active_model,omitempty"`
	UploadConflictPolicy string `json:"upload_conflict_policy"`
}

func Load(path string) (*Settings, error) {
	s := &Settings{
		AutoTag:              true,
		GPUEnabled:           false,
		UploadConflictPolicy: "skip",
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

	return s, nil
}

func Save(path string, s *Settings) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
