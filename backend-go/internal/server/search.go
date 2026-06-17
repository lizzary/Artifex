package server

import (
	"net/http"
	"strings"

	"artifex-backend/internal/database"
	"artifex-backend/internal/models"
)

// ── Search ──────────────────────────────────────────────────────────────

func (s *Server) SearchIllustrations(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, 200, models.SearchResult{Items: []models.IllustrationResponse{}, Total: 0, Offset: 0, Limit: 0})
		return
	}

	offset := queryInt(r, "offset", 0, 0, 100000)
	limit := queryInt(r, "limit", 50, 1, 200)

	// Build FTS5 prefix query: wrap each term for prefix matching
	normalized := strings.ReplaceAll(q, ",", " ")
	terms := strings.Fields(normalized)
	if len(terms) == 0 {
		writeJSON(w, 200, models.SearchResult{Items: []models.IllustrationResponse{}, Total: 0, Offset: offset, Limit: limit})
		return
	}

	safeTerms := make([]string, 0, len(terms))
	for _, t := range terms {
		clean := strings.ReplaceAll(t, `"`, "")
		if clean != "" {
			safeTerms = append(safeTerms, `"`+clean+`"*`)
		}
	}
	if len(safeTerms) == 0 {
		writeJSON(w, 200, models.SearchResult{Items: []models.IllustrationResponse{}, Total: 0, Offset: offset, Limit: limit})
		return
	}
	ftsQuery := strings.Join(safeTerms, " AND ")

	db := database.GetDB()

	// Count total
	var total int
	err := db.QueryRow(
		"SELECT COUNT(*) FROM illustrations_fts WHERE illustrations_fts MATCH ?",
		ftsQuery,
	).Scan(&total)
	if err != nil {
		writeJSON(w, 200, models.SearchResult{Items: []models.IllustrationResponse{}, Total: 0, Offset: offset, Limit: limit})
		return
	}

	rows, err := db.Query(`
		SELECT i.*, g.name AS group_name
		FROM illustrations_fts fts
		JOIN illustrations i ON fts.rowid = i.id
		JOIN groups g ON i.group_id = g.id
		WHERE illustrations_fts MATCH ?
		ORDER BY rank
		LIMIT ? OFFSET ?
	`, ftsQuery, limit, offset)
	if err != nil {
		writeJSON(w, 200, models.SearchResult{Items: []models.IllustrationResponse{}, Total: 0, Offset: offset, Limit: limit})
		return
	}
	defer rows.Close()

	items := make([]models.IllustrationResponse, 0)
	for rows.Next() {
		item := scanIllustration(rows)
		if item != nil {
			items = append(items, *item)
		}
	}

	writeJSON(w, 200, models.SearchResult{Items: items, Total: total, Offset: offset, Limit: limit})
}
