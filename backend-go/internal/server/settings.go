package server

import (
	"encoding/json"
	"fmt"
	"net/http"

	"artifex-backend/internal/settings"
	"artifex-backend/internal/tagger"
)

// ── Get Settings ────────────────────────────────────────────────────────

func (s *Server) GetSettings(w http.ResponseWriter, r *http.Request) {
	st, err := settings.Load(s.SettingsPath())
	if err != nil {
		writeError(w, 500, "Failed to load settings")
		return
	}
	writeJSON(w, 200, st)
}

// ── Update Settings ─────────────────────────────────────────────────────

func (s *Server) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "Invalid request body")
		return
	}

	current, err := settings.Load(s.SettingsPath())
	if err != nil {
		writeError(w, 500, "Failed to load settings")
		return
	}

	allowed := map[string]bool{"auto_tag": true, "gpu_enabled": true, "active_model": true}
	shouldReload := false
	for key, val := range body {
		if !allowed[key] {
			continue
		}
		switch key {
		case "auto_tag":
			if b, ok := val.(bool); ok {
				current.AutoTag = b
				if b {
					shouldReload = true
				}
			}
		case "gpu_enabled":
			if b, ok := val.(bool); ok {
				current.GPUEnabled = b
				tagger.SetUseGPU(b)
				shouldReload = true
			}
		case "active_model":
			if s, ok := val.(string); ok {
				current.ActiveModel = s
				tagger.SetActiveModel(s)
				shouldReload = true
			}
		}
	}

	if err := settings.Save(s.SettingsPath(), current); err != nil {
		writeError(w, 500, "Failed to save settings")
		return
	}

	if shouldReload {
		if err := tagger.LoadTagger(s.ModelsDir()); err != nil {
			fmt.Println("Tagger reload after settings change failed:", err)
		}
	}

	writeJSON(w, 200, current)
}
