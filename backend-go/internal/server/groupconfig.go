package server

import (
	"errors"
	"io"
	"net/http"

	"artifex-backend/internal/groupconfig"
)

func (s *Server) GetGroupConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := groupconfig.Load(r.Context(), s.db)
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
	cfg, err := groupconfig.Update(r.Context(), s.db, data)
	writeGroupConfigResult(w, cfg, err)
}

func (s *Server) ApplyColorOperations(w http.ResponseWriter, r *http.Request) {
	groupID, err := intParam(r, "groupId")
	if err != nil || groupID <= 0 {
		writeError(w, 400, "Invalid group ID")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16<<20))
	if err != nil {
		writeError(w, 400, "Invalid color operations")
		return
	}
	cfg, err := groupconfig.ApplyColorOperations(r.Context(), s.db, groupID, data)
	writeGroupConfigResult(w, cfg, err)
}

func (s *Server) ReorderIllustrations(w http.ResponseWriter, r *http.Request) {
	groupID, err := intParam(r, "groupId")
	if err != nil || groupID <= 0 {
		writeError(w, 400, "Invalid group ID")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16<<20))
	if err != nil {
		writeError(w, 400, "Invalid illustration order")
		return
	}
	cfg, err := groupconfig.ReorderIllustrations(r.Context(), s.db, groupID, data)
	writeGroupConfigResult(w, cfg, err)
}

func writeGroupConfigResult(w http.ResponseWriter, cfg *groupconfig.Config, err error) {
	if err != nil {
		switch {
		case errors.Is(err, groupconfig.ErrInvalid):
			writeError(w, 400, err.Error())
		case errors.Is(err, groupconfig.ErrGroupNotFound), errors.Is(err, groupconfig.ErrColorNotFound):
			writeError(w, 404, err.Error())
		case errors.Is(err, groupconfig.ErrConflict), errors.Is(err, groupconfig.ErrIllustrationOrderConflict):
			writeError(w, 409, err.Error())
		default:
			writeError(w, 500, "Failed to save group configuration")
		}
		return
	}
	writeJSON(w, 200, cfg)
}
