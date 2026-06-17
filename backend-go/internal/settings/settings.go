package settings

import (
	"encoding/json"
	"os"
)

type Settings struct {
	AutoTag     bool   `json:"auto_tag"`
	GPUEnabled  bool   `json:"gpu_enabled"`
	ActiveModel string `json:"active_model,omitempty"`
}

func Load(path string) (*Settings, error) {
	s := &Settings{
		AutoTag:    true,
		GPUEnabled: false,
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

	return s, nil
}

func Save(path string, s *Settings) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
