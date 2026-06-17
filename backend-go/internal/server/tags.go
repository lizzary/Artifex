package server

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"

	"artifex-backend/internal/database"
)

// ── List Tags ────────────────────────────────────────────────────────────

func (s *Server) ListTags(w http.ResponseWriter, r *http.Request) {
	db := database.GetDB()
	rows, err := db.Query("SELECT tags FROM illustrations WHERE tags IS NOT NULL AND tags != ''")
	if err != nil {
		writeError(w, 500, "Failed to list tags")
		return
	}
	defer rows.Close()

	unique := make(map[string]bool)
	for rows.Next() {
		var tags string
		if err := rows.Scan(&tags); err != nil {
			continue
		}
		for _, t := range strings.Split(tags, ",") {
			if trimmed := strings.TrimSpace(t); trimmed != "" {
				unique[trimmed] = true
			}
		}
	}

	result := make([]string, 0, len(unique))
	for t := range unique {
		result = append(result, t)
	}
	sort.Strings(result)

	writeJSON(w, 200, result)
}

// ── List Prompts ─────────────────────────────────────────────────────────

func (s *Server) ListPrompts(w http.ResponseWriter, r *http.Request) {
	db := database.GetDB()
	rows, err := db.Query("SELECT extended_data FROM illustrations WHERE extended_data IS NOT NULL")
	if err != nil {
		writeError(w, 500, "Failed to list prompts")
		return
	}
	defer rows.Close()

	unique := make(map[string]bool)
	for rows.Next() {
		var extData string
		if err := rows.Scan(&extData); err != nil {
			continue
		}
		var data map[string]interface{}
		if err := json.Unmarshal([]byte(extData), &data); err != nil {
			continue
		}
		for _, key := range []string{"Positive Prompt", "Negative Prompt"} {
			if text, ok := data[key].(string); ok && text != "" {
				for _, term := range strings.Split(text, ",") {
					if trimmed := strings.TrimSpace(term); trimmed != "" {
						unique[trimmed] = true
					}
				}
			}
		}
	}

	result := make([]string, 0, len(unique))
	for t := range unique {
		result = append(result, t)
	}
	sort.Strings(result)

	writeJSON(w, 200, result)
}
