package server

import (
	"encoding/json"
	"net/http"

	"artifex-backend/internal/settings"
	"artifex-backend/internal/tagger"
)

// coerceIntSlice accepts a JSON value that should be an array of integers and
// returns the canonicalised slice. Empty for any malformed shape.
func coerceIntSlice(raw interface{}) []int {
	arr, ok := raw.([]interface{})
	if !ok {
		return []int{}
	}
	out := make([]int, 0, len(arr))
	for _, v := range arr {
		switch n := v.(type) {
		case float64:
			out = append(out, int(n))
		case int:
			out = append(out, n)
		case int64:
			out = append(out, int(n))
		}
	}
	return out
}

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

	allowed := map[string]bool{
		"auto_tag":               true,
		"gpu_enabled":            true,
		"active_model":           true,
		"upload_conflict_policy": true,
		"group_order":            true,
		"group_configs":          true,
	}
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
		case "upload_conflict_policy":
			if str, ok := val.(string); ok && (str == "save_all" || str == "skip" || str == "overwrite") {
				current.UploadConflictPolicy = str
			}
		case "group_order":
			current.GroupOrder = coerceIntSlice(val)
		case "group_configs":
			// Re-encode and decode into the typed shape so we don't store random
			// non-JSON values from misbehaving clients.
			raw, err := json.Marshal(val)
			if err != nil {
				continue
			}
			var typed settings.GroupConfigs
			if err := json.Unmarshal(raw, &typed); err == nil {
				current.GroupConfigs = typed
			}
		}
	}

	if err := settings.Save(s.SettingsPath(), current); err != nil {
		writeError(w, 500, "Failed to save settings")
		return
	}

	if shouldReload {
		if err := tagger.LoadTagger(s.ModelsDir()); err != nil {
			s.logger().Warn("tagger", "reload after settings change failed: %v", err)
		}
	}

	writeJSON(w, 200, current)
}
