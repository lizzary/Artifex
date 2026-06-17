package server

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"artifex-backend/internal/database"
	"artifex-backend/internal/models"
)

// ── List Groups ──────────────────────────────────────────────────────────

func (s *Server) ListGroups(w http.ResponseWriter, r *http.Request) {
	db := database.GetDB()
	rows, err := db.Query(`
		SELECT g.*, COUNT(i.id) AS illustration_count
		FROM groups g
		LEFT JOIN illustrations i ON g.id = i.group_id
		GROUP BY g.id
		ORDER BY g.created_at DESC
	`)
	if err != nil {
		writeError(w, 500, "Failed to list groups")
		return
	}
	defer rows.Close()

	groups := make([]models.GroupResponse, 0)
	for rows.Next() {
		var grp models.GroupResponse
		var coverID sql.NullInt64
		if err := rows.Scan(&grp.ID, &grp.Name, &coverID, &grp.CreatedAt, &grp.IllustrationCount); err != nil {
			continue
		}
		if coverID.Valid {
			cid := int(coverID.Int64)
			grp.CoverIllustrationID = &cid
			url := s.buildCoverURL(int(coverID.Int64))
			grp.CoverThumbnailURL = &url
		}
		groups = append(groups, grp)
	}
	writeJSON(w, 200, groups)
}

// ── Create Group ─────────────────────────────────────────────────────────

func (s *Server) CreateGroup(w http.ResponseWriter, r *http.Request) {
	var body models.GroupCreate
	if err := decodeJSONBody(r, &body); err != nil {
		writeError(w, 400, "Invalid request body")
		return
	}
	if len(body.Name) == 0 || len(body.Name) > 100 {
		writeError(w, 400, "Name must be between 1 and 100 characters")
		return
	}

	db := database.GetDB()
	result, err := db.Exec("INSERT INTO groups (name) VALUES (?)", body.Name)
	if err != nil {
		writeError(w, 500, "Failed to create group")
		return
	}

	id, _ := result.LastInsertId()

	var grp models.GroupResponse
	db.QueryRow("SELECT id, name, cover_illustration_id, created_at FROM groups WHERE id = ?", id).
		Scan(&grp.ID, &grp.Name, &grp.CoverIllustrationID, &grp.CreatedAt)
	grp.IllustrationCount = 0
	writeJSON(w, 201, grp)
}

// ── Get Group ────────────────────────────────────────────────────────────

func (s *Server) GetGroup(w http.ResponseWriter, r *http.Request) {
	groupID, err := intParam(r, "groupId")
	if err != nil {
		writeError(w, 400, "Invalid group ID")
		return
	}

	db := database.GetDB()
	var grp models.GroupResponse
	var coverID sql.NullInt64
	err = db.QueryRow(`
		SELECT g.*, COUNT(i.id) AS illustration_count
		FROM groups g
		LEFT JOIN illustrations i ON g.id = i.group_id
		WHERE g.id = ?
		GROUP BY g.id
	`, groupID).Scan(&grp.ID, &grp.Name, &coverID, &grp.CreatedAt, &grp.IllustrationCount)

	if err == sql.ErrNoRows {
		writeError(w, 404, "Group not found")
		return
	}
	if err != nil {
		writeError(w, 500, "Failed to get group")
		return
	}

	if coverID.Valid {
		cid := int(coverID.Int64)
		grp.CoverIllustrationID = &cid
		url := s.buildCoverURL(cid)
		grp.CoverThumbnailURL = &url
	}
	writeJSON(w, 200, grp)
}

// ── Update Group ─────────────────────────────────────────────────────────

func (s *Server) UpdateGroup(w http.ResponseWriter, r *http.Request) {
	groupID, err := intParam(r, "groupId")
	if err != nil {
		writeError(w, 400, "Invalid group ID")
		return
	}

	var body models.GroupUpdate
	if err := decodeJSONBody(r, &body); err != nil {
		writeError(w, 400, "Invalid request body")
		return
	}

	db := database.GetDB()

	// Verify group exists
	var exists bool
	db.QueryRow("SELECT EXISTS(SELECT 1 FROM groups WHERE id = ?)", groupID).Scan(&exists)
	if !exists {
		writeError(w, 404, "Group not found")
		return
	}

	if body.Name != nil {
		if len(*body.Name) == 0 || len(*body.Name) > 100 {
			writeError(w, 400, "Name must be between 1 and 100 characters")
			return
		}
		db.Exec("UPDATE groups SET name = ? WHERE id = ?", *body.Name, groupID)
	}

	if body.CoverIllustrationID != nil {
		// Verify illustration belongs to this group
		var count int
		db.QueryRow(
			"SELECT COUNT(*) FROM illustrations WHERE id = ? AND group_id = ?",
			*body.CoverIllustrationID, groupID,
		).Scan(&count)
		if count == 0 {
			writeError(w, 400, "Cover illustration must belong to this group")
			return
		}
		db.Exec("UPDATE groups SET cover_illustration_id = ? WHERE id = ?", *body.CoverIllustrationID, groupID)
	}

	var grp models.GroupResponse
	var coverID sql.NullInt64
	db.QueryRow(`
		SELECT g.*, COUNT(i.id) AS illustration_count
		FROM groups g
		LEFT JOIN illustrations i ON g.id = i.group_id
		WHERE g.id = ?
		GROUP BY g.id
	`, groupID).Scan(&grp.ID, &grp.Name, &coverID, &grp.CreatedAt, &grp.IllustrationCount)

	if coverID.Valid {
		cid := int(coverID.Int64)
		grp.CoverIllustrationID = &cid
		url := s.buildCoverURL(cid)
		grp.CoverThumbnailURL = &url
	}
	writeJSON(w, 200, grp)
}

// ── Delete Group ─────────────────────────────────────────────────────────

func (s *Server) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	groupID, err := intParam(r, "groupId")
	if err != nil {
		writeError(w, 400, "Invalid group ID")
		return
	}

	db := database.GetDB()

	var exists bool
	db.QueryRow("SELECT EXISTS(SELECT 1 FROM groups WHERE id = ?)", groupID).Scan(&exists)
	if !exists {
		writeError(w, 404, "Group not found")
		return
	}

	// Unset cover references, delete illustrations, delete group
	db.Exec("UPDATE groups SET cover_illustration_id = NULL WHERE id = ?", groupID)
	db.Exec("DELETE FROM illustrations WHERE group_id = ?", groupID)
	db.Exec("DELETE FROM groups WHERE id = ?", groupID)

	// Remove uploaded files
	groupDir := filepath.Join(s.UploadsDir(), strconv.Itoa(groupID))
	if info, err := os.Stat(groupDir); err == nil && info.IsDir() {
		os.RemoveAll(groupDir)
	}

	w.WriteHeader(204)
}

// ── Helpers ─────────────────────────────────────────────────────────────

func (s *Server) buildCoverURL(illustrationID int) string {
	return "/api/illustrations/" + strconv.Itoa(illustrationID) + "/thumbnail"
}

func decodeJSONBody(r *http.Request, v interface{}) error {
	return json.NewDecoder(r.Body).Decode(v)
}
