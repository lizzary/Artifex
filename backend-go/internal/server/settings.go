package server

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"

	"artifex-backend/internal/settings"
	"artifex-backend/internal/tagger"
)

func (s *Server) GetSettings(w http.ResponseWriter, r *http.Request) {
	st, err := settings.Load(s.SettingsPath())
	if err != nil {
		writeError(w, 500, "Failed to load settings: "+err.Error())
		return
	}
	writeJSON(w, 200, st)
}

type settingsPatch struct {
	DatabaseDir          *string `json:"database_dir"`
	AutoTag              *bool   `json:"auto_tag"`
	GPUEnabled           *bool   `json:"gpu_enabled"`
	ActiveModel          *string `json:"active_model"`
	UploadConflictPolicy *string `json:"upload_conflict_policy"`
	UploadWorkers        *int    `json:"upload_workers"`
	TaggerSlots          *int    `json:"tagger_slots"`
	BoardRenderer        *string `json:"board_renderer"`
	DownloadNamingFormat *string `json:"download_naming_format"`
	BoardFreeRowLimit    *int    `json:"board_free_row_limit"`
}

func (s *Server) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var patch settingsPatch
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&patch); err != nil {
		writeError(w, 400, "Invalid settings: "+err.Error())
		return
	}
	var prepared *sql.DB
	var invalid error
	current, err := settings.Update(s.SettingsPath(), func(st *settings.Settings) error {
		applySetting(&st.DatabaseDir, patch.DatabaseDir)
		applySetting(&st.AutoTag, patch.AutoTag)
		applySetting(&st.GPUEnabled, patch.GPUEnabled)
		applySetting(&st.ActiveModel, patch.ActiveModel)
		applySetting(&st.UploadConflictPolicy, patch.UploadConflictPolicy)
		applySetting(&st.UploadWorkers, patch.UploadWorkers)
		applySetting(&st.TaggerSlots, patch.TaggerSlots)
		applySetting(&st.BoardRenderer, patch.BoardRenderer)
		applySetting(&st.DownloadNamingFormat, patch.DownloadNamingFormat)
		applySetting(&st.BoardFreeRowLimit, patch.BoardFreeRowLimit)
		st.DatabaseDir = filepath.Clean(st.DatabaseDir)
		if err := st.Validate(); err != nil {
			invalid = err
			return err
		}
		if st.DatabaseDir != s.Config.DatabaseDir {
			db, err := openLibrary(st.DatabaseDir)
			if err != nil {
				invalid = fmt.Errorf("cannot load database directory: %w", err)
				return invalid
			}
			prepared = db
		}
		return nil
	})
	if err != nil {
		if prepared != nil {
			prepared.Close()
		}
		code := http.StatusInternalServerError
		if invalid != nil && errors.Is(err, invalid) {
			code = http.StatusBadRequest
		}
		writeError(w, code, "Failed to save settings: "+err.Error())
		return
	}
	if prepared != nil {
		old := s.db
		s.db = prepared
		s.Config.DatabaseDir = current.DatabaseDir
		s.libraryID = rand.Text()
		w.Header().Set("X-Artifex-Library", s.libraryID)
		if err := old.Close(); err != nil {
			s.logger().Warn("database", "close previous library: %v", err)
		}
	}
	s.SetUploadWorkers(current.UploadWorkers)
	tagger.SetTaggerSlots(current.TaggerSlots)
	tagger.SetUseGPU(current.GPUEnabled)
	tagger.SetActiveModel(current.ActiveModel)
	if prepared != nil || patch.AutoTag != nil || patch.GPUEnabled != nil || patch.ActiveModel != nil {
		if current.AutoTag {
			if err := tagger.LoadTagger(s.ModelsDir()); err != nil {
				s.logger().Warn("tagger", "reload after settings change failed: %v", err)
			}
		} else {
			tagger.Unload()
		}
	}
	writeJSON(w, 200, current)
}

func applySetting[T any](target *T, value *T) {
	if value != nil {
		*target = *value
	}
}
