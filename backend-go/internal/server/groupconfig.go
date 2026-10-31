package server

import (
	"encoding/json"
	"io"
	"net/http"

	"artifex-backend/internal/groupconfig"
)

func (s *Server) GetGroupConfig(w http.ResponseWriter, r *http.Request) {
	s.groupConfigMu.Lock()
	defer s.groupConfigMu.Unlock()
	cfg, err := groupconfig.Load(s.GroupConfigPath())
	if err != nil {
		writeError(w, 500, "Failed to load group configuration")
		return
	}
	writeJSON(w, 200, cfg)
}

func (s *Server) UpdateGroupConfig(w http.ResponseWriter, r *http.Request) {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16<<20))
	if err != nil {
		writeError(w, 400, "Invalid group configuration")
		return
	}
	s.groupConfigMu.Lock()
	defer s.groupConfigMu.Unlock()
	var patch struct {
		Groups map[string]json.RawMessage `json:"groups"`
	}
	if err := json.Unmarshal(data, &patch); err != nil {
		writeError(w, 400, "Invalid group configuration")
		return
	}
	for id := range patch.Groups {
		var exists bool
		if err := s.db.QueryRow("SELECT EXISTS(SELECT 1 FROM groups WHERE id = ?)", id).Scan(&exists); err != nil {
			writeError(w, 500, "Failed to read group")
			return
		}
		if !exists {
			writeError(w, 404, "Group not found")
			return
		}
	}
	cfg, err := groupconfig.Load(s.GroupConfigPath())
	if err != nil {
		writeError(w, 500, "Failed to load group configuration")
		return
	}
	if err := cfg.Patch(data); err != nil {
		writeError(w, 400, "Invalid group configuration: "+err.Error())
		return
	}
	if err := groupconfig.Save(s.GroupConfigPath(), cfg); err != nil {
		writeError(w, 500, "Failed to save group configuration")
		return
	}
	writeJSON(w, 200, cfg)
}
