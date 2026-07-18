package server

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"image"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"artifex-backend/internal/database"
	"artifex-backend/internal/metadata"
	"artifex-backend/internal/models"
	"artifex-backend/internal/settings"
	"artifex-backend/internal/tagger"
	"artifex-backend/internal/thumbnail"

	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
)

const (
	maxIllustrationFileBytes    int64 = 2 << 30
	maxIllustrationRequestBytes       = maxIllustrationFileBytes + 1<<20
	maxIllustrationPixels       int64 = 100_000_000
)

// ── List Illustrations ───────────────────────────────────────────────────

func (s *Server) ListIllustrations(w http.ResponseWriter, r *http.Request) {
	groupID, err := intParam(r, "groupId")
	if err != nil {
		writeError(w, 400, "Invalid group ID")
		return
	}

	offset := queryInt(r, "offset", 0, 0, 100000)
	limit := queryInt(r, "limit", 50, 1, 100000)

	db := database.GetDB()

	var groupName string
	if err := db.QueryRow("SELECT name FROM groups WHERE id = ?", groupID).Scan(&groupName); err == sql.ErrNoRows {
		writeError(w, 404, "Group not found")
		return
	}

	var total int
	db.QueryRow("SELECT COUNT(*) FROM illustrations WHERE group_id = ?", groupID).Scan(&total)

	rows, err := db.Query(`
		SELECT i.*, ? AS group_name
		FROM illustrations i
		WHERE i.group_id = ?
		ORDER BY i.created_at DESC, i.id DESC
		LIMIT ? OFFSET ?
	`, groupName, groupID, limit, offset)
	if err != nil {
		writeError(w, 500, "Failed to list illustrations")
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

	writeJSON(w, 200, models.IllustrationPage{
		Items:  items,
		Total:  total,
		Offset: offset,
		Limit:  limit,
	})
}

// ── Upload Illustrations ─────────────────────────────────────────────────

func (s *Server) UploadIllustrations(w http.ResponseWriter, r *http.Request) {
	groupID, err := intParam(r, "groupId")
	if err != nil {
		writeError(w, 400, "Invalid group ID")
		return
	}

	db := database.GetDB()

	var groupName string
	if err := db.QueryRow("SELECT name FROM groups WHERE id = ?", groupID).Scan(&groupName); err == sql.ErrNoRows {
		writeError(w, 404, "Group not found")
		return
	} else if err != nil {
		writeError(w, 500, "Failed to read group")
		return
	}

	if err := parseMultipartForm(w, r, maxIllustrationRequestBytes); err != nil {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
		writeError(w, multipartErrorStatus(err), "Failed to parse upload")
		return
	}
	defer r.MultipartForm.RemoveAll()

	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		writeError(w, 400, "No files provided")
		return
	}

	skipAutoTag := strings.ToLower(r.FormValue("skip_auto_tag")) == "true"

	if err := s.ensureUploadDirs(groupID); err != nil {
		writeError(w, 500, "Failed to prepare upload directory")
		return
	}

	currentSettings, _ := settings.Load(s.SettingsPath())
	autoTagEnabled := currentSettings.AutoTag && !skipAutoTag
	if autoTagEnabled && !tagger.IsTaggerReady() {
		writeError(w, 409, "AI tagging model is incomplete or unavailable. Download it again before uploading.")
		return
	}

	// Allow per-request override of the conflict policy (form field), else fall back to settings.
	conflictPolicy := strings.ToLower(strings.TrimSpace(r.FormValue("conflict_policy")))
	if conflictPolicy != "save_all" && conflictPolicy != "skip" && conflictPolicy != "overwrite" {
		conflictPolicy = currentSettings.UploadConflictPolicy
	}

	result := models.UploadResult{
		Added:       make([]models.IllustrationResponse, 0),
		Skipped:     make([]models.UploadConflictItem, 0),
		Overwritten: make([]models.UploadConflictItem, 0),
		Failed:      make([]models.UploadConflictItem, 0),
	}

	for _, fh := range files {
		safeFilename := filepath.Base(fh.Filename)

		conflictID, hasConflict := s.findConflictingIllustration(groupID, safeFilename)

		if hasConflict && conflictPolicy == "skip" {
			result.Skipped = append(result.Skipped, models.UploadConflictItem{Filename: safeFilename})
			continue
		}

		item, err := s.processUpload(groupID, groupName, fh, autoTagEnabled)
		if err != nil {
			result.Failed = append(result.Failed, models.UploadConflictItem{
				Filename: safeFilename,
				Error:    err.Error(),
			})
			continue
		}

		if hasConflict && conflictPolicy == "overwrite" {
			deleted, _ := s.deleteIllustration(conflictID)
			if deleted {
				result.Overwritten = append(result.Overwritten, models.UploadConflictItem{Filename: safeFilename})
				continue
			}
		}
		result.Added = append(result.Added, *item)
	}

	writeJSON(w, 201, result)
}

func (s *Server) findConflictingIllustration(groupID int, originalFilename string) (int, bool) {
	db := database.GetDB()
	var id int
	err := db.QueryRow(
		"SELECT id FROM illustrations WHERE group_id = ? AND original_filename = ? LIMIT 1",
		groupID, originalFilename,
	).Scan(&id)
	if err != nil {
		return 0, false
	}
	return id, true
}

func (s *Server) deleteIllustration(illID int) (bool, error) {
	db := database.GetDB()
	tx, err := db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	var filename string
	var groupID int
	if err := tx.QueryRow("SELECT filename, group_id FROM illustrations WHERE id = ?", illID).
		Scan(&filename, &groupID); err == sql.ErrNoRows {
		return false, nil
	} else if err != nil {
		return false, err
	}
	if _, err := tx.Exec("UPDATE groups SET cover_illustration_id = NULL WHERE cover_illustration_id = ?", illID); err != nil {
		return false, err
	}
	if _, err := tx.Exec("DELETE FROM illustrations WHERE id = ?", illID); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}

	groupDir := filepath.Join(s.UploadsDir(), strconv.Itoa(groupID))
	for _, sub := range []string{"originals", "thumbnails", "thumbnails_normal"} {
		_ = os.Remove(filepath.Join(groupDir, sub, filename))
	}
	return true, nil
}

func (s *Server) processUpload(groupID int, groupName string, fh *multipart.FileHeader, autoTag bool) (*models.IllustrationResponse, error) {
	safeFilename := filepath.Base(fh.Filename)
	if safeFilename == "" || safeFilename == "." || safeFilename == ".." {
		return nil, fmt.Errorf("invalid filename")
	}
	if fh.Size > maxIllustrationFileBytes {
		return nil, fmt.Errorf("%s exceeds the 2 GiB upload limit", safeFilename)
	}

	file, err := fh.Open()
	if err != nil {
		return nil, fmt.Errorf("failed to open %s", safeFilename)
	}
	defer file.Close()

	db := database.GetDB()
	tx, err := db.Begin()
	if err != nil {
		return nil, fmt.Errorf("failed to start upload: %w", err)
	}
	committed := false
	createdFiles := make([]string, 0, len(thumbnail.QualityConfigs)+1)
	defer func() {
		if committed {
			return
		}
		_ = tx.Rollback()
		for _, path := range createdFiles {
			_ = os.Remove(path)
		}
	}()

	result, err := tx.Exec(
		"INSERT INTO illustrations (group_id, filename, original_filename) VALUES (?, '', ?)",
		groupID, safeFilename,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to save %s: %w", safeFilename, err)
	}

	illID, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get illustration id: %w", err)
	}
	diskFilename := fmt.Sprintf("%d_%s", illID, safeFilename)
	originalsDir := filepath.Join(s.UploadsDir(), strconv.Itoa(groupID), "originals")
	originalPath := filepath.Join(originalsDir, diskFilename)
	original, err := os.OpenFile(originalPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to create original %s: %w", safeFilename, err)
	}
	createdFiles = append(createdFiles, originalPath)
	fileSize, copyErr := io.Copy(original, io.LimitReader(file, maxIllustrationFileBytes+1))
	closeErr := original.Close()
	if copyErr != nil {
		return nil, fmt.Errorf("failed to save original %s: %w", safeFilename, copyErr)
	}
	if closeErr != nil {
		return nil, fmt.Errorf("failed to close original %s: %w", safeFilename, closeErr)
	}
	if fileSize > maxIllustrationFileBytes {
		return nil, fmt.Errorf("%s exceeds the 2 GiB upload limit", safeFilename)
	}

	stored, err := os.Open(originalPath)
	if err != nil {
		return nil, fmt.Errorf("failed to reopen %s: %w", safeFilename, err)
	}
	config, _, configErr := image.DecodeConfig(stored)
	if configErr == nil && config.Height > 0 && int64(config.Width) > maxIllustrationPixels/int64(config.Height) {
		stored.Close()
		return nil, fmt.Errorf("%s exceeds the 100 megapixel image limit", safeFilename)
	}
	if _, err := stored.Seek(0, io.SeekStart); err != nil {
		stored.Close()
		return nil, fmt.Errorf("failed to read %s: %w", safeFilename, err)
	}
	img, format, err := image.Decode(stored)
	stored.Close()
	if err != nil {
		return nil, fmt.Errorf("cannot identify image: %s", safeFilename)
	}

	var tags string
	if autoTag {
		tags = tagger.ExtractTags(img)
	}
	width, height, mimeType := thumbnail.GetImageInfo(img, format)

	for _, cfg := range thumbnail.QualityConfigs {
		thumbImg := thumbnail.CreateThumbnail(img, cfg.MaxSize)
		thumbDir := filepath.Join(s.UploadsDir(), strconv.Itoa(groupID), cfg.Dir)
		thumbPath := filepath.Join(thumbDir, diskFilename)
		createdFiles = append(createdFiles, thumbPath)
		if err := thumbnail.SaveJPEG(thumbImg, thumbPath, cfg.JPEGQuality); err != nil {
			return nil, fmt.Errorf("failed to create thumbnail for %s", safeFilename)
		}
	}

	var extendedData any
	meta, err := metadata.Extract(originalPath, img)
	if err == nil && len(meta) > 0 {
		metaBytes, err := json.Marshal(meta)
		if err != nil {
			return nil, fmt.Errorf("failed to encode metadata for %s: %w", safeFilename, err)
		}
		extendedData = string(metaBytes)
	}

	if _, err := tx.Exec(`
		UPDATE illustrations
		SET filename = ?, file_size = ?, width = ?, height = ?, mime_type = ?, tags = ?, extended_data = ?
		WHERE id = ?
	`, diskFilename, fileSize, width, height, mimeType, tags, extendedData, illID); err != nil {
		return nil, fmt.Errorf("failed to finalize %s: %w", safeFilename, err)
	}

	item := scanIllustration(tx.QueryRow(`
		SELECT i.*, ? AS group_name FROM illustrations i WHERE i.id = ?
	`, groupName, illID))
	if item == nil {
		return nil, fmt.Errorf("failed to build upload response for %s", safeFilename)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit %s: %w", safeFilename, err)
	}
	committed = true
	return item, nil
}

// ── Get Illustration ─────────────────────────────────────────────────────

func (s *Server) GetIllustration(w http.ResponseWriter, r *http.Request) {
	illID, err := intParam(r, "illustrationId")
	if err != nil {
		writeError(w, 400, "Invalid illustration ID")
		return
	}

	db := database.GetDB()
	row := db.QueryRow(`
		SELECT i.*, g.name AS group_name
		FROM illustrations i
		JOIN groups g ON i.group_id = g.id
		WHERE i.id = ?
	`, illID)

	item := scanIllustration(row)
	if item == nil {
		writeError(w, 404, "Illustration not found")
		return
	}
	writeJSON(w, 200, item)
}

// ── Update Illustration ──────────────────────────────────────────────────

func (s *Server) UpdateIllustration(w http.ResponseWriter, r *http.Request) {
	illID, err := intParam(r, "illustrationId")
	if err != nil {
		writeError(w, 400, "Invalid illustration ID")
		return
	}

	var body models.IllustrationUpdate
	if err := decodeJSONBody(r, &body); err != nil {
		writeError(w, 400, "Invalid request body")
		return
	}

	db := database.GetDB()

	// Verify exists
	row := db.QueryRow(`
		SELECT i.*, g.name AS group_name
		FROM illustrations i JOIN groups g ON i.group_id = g.id
		WHERE i.id = ?
	`, illID)
	item := scanIllustration(row)
	if item == nil {
		writeError(w, 404, "Illustration not found")
		return
	}

	if body.Tags != nil {
		db.Exec("UPDATE illustrations SET tags = ? WHERE id = ?", *body.Tags, illID)
	}

	// Re-fetch updated
	row = db.QueryRow(`
		SELECT i.*, g.name AS group_name
		FROM illustrations i JOIN groups g ON i.group_id = g.id
		WHERE i.id = ?
	`, illID)
	updated := scanIllustration(row)
	if updated == nil {
		writeError(w, 404, "Illustration not found")
		return
	}
	writeJSON(w, 200, updated)
}

// ── Batch Illustration Tags ─────────────────────────────────────────────

// UpdateIllustrationTags adds or removes tags for a reusable batch of illustrations.
// Body: { "ids": [int, ...], "operation": "add"|"remove", "tags": [string, ...] }.
func (s *Server) UpdateIllustrationTags(w http.ResponseWriter, r *http.Request) {
	var body models.IllustrationTagsRequest
	if err := decodeJSONBody(r, &body); err != nil {
		writeError(w, 400, "Invalid request body")
		return
	}

	ids := uniquePositiveIDs(body.IDs)
	tags := normalizeRequestedTags(body.Tags)
	operation := strings.ToLower(strings.TrimSpace(body.Operation))
	if len(ids) == 0 || len(tags) == 0 {
		writeError(w, 400, "Illustration ids and tags are required")
		return
	}
	if operation != "add" && operation != "remove" {
		writeError(w, 400, "Operation must be add or remove")
		return
	}
	db := database.GetDB()
	tx, err := db.Begin()
	if err != nil {
		writeError(w, 500, "Failed to start tag update")
		return
	}
	defer tx.Rollback()

	updatedIDs := make([]int, 0, len(ids))
	missing := make([]int, 0)
	for _, illID := range ids {
		var current sql.NullString
		err := tx.QueryRow("SELECT tags FROM illustrations WHERE id = ?", illID).Scan(&current)
		if err == sql.ErrNoRows {
			missing = append(missing, illID)
			continue
		}
		if err != nil {
			writeError(w, 500, "Failed to read illustration tags")
			return
		}

		next := mutateStoredTags(current.String, tags, operation)
		if _, err := tx.Exec("UPDATE illustrations SET tags = ? WHERE id = ?", next, illID); err != nil {
			writeError(w, 500, "Failed to update illustration tags")
			return
		}
		updatedIDs = append(updatedIDs, illID)
	}

	if err := tx.Commit(); err != nil {
		writeError(w, 500, "Failed to save illustration tags")
		return
	}

	result := models.IllustrationTagsResult{
		Updated: make([]models.IllustrationResponse, 0, len(updatedIDs)),
		Missing: missing,
	}
	for _, illID := range updatedIDs {
		row := db.QueryRow(`
			SELECT i.*, g.name AS group_name
			FROM illustrations i JOIN groups g ON i.group_id = g.id
			WHERE i.id = ?
		`, illID)
		if item := scanIllustration(row); item != nil {
			result.Updated = append(result.Updated, *item)
		}
	}

	writeJSON(w, 200, result)
}

// ── Delete Illustration ──────────────────────────────────────────────────

func (s *Server) DeleteIllustration(w http.ResponseWriter, r *http.Request) {
	illID, err := intParam(r, "illustrationId")
	if err != nil {
		writeError(w, 400, "Invalid illustration ID")
		return
	}

	deleted, err := s.deleteIllustration(illID)
	if err != nil {
		writeError(w, 500, "Failed to delete illustration")
		return
	}
	if !deleted {
		writeError(w, 404, "Illustration not found")
		return
	}

	w.WriteHeader(204)
}

// ── Serve File ───────────────────────────────────────────────────────────

func (s *Server) ServeIllustrationFile(w http.ResponseWriter, r *http.Request) {
	illID, err := intParam(r, "illustrationId")
	if err != nil {
		writeError(w, 400, "Invalid illustration ID")
		return
	}

	db := database.GetDB()
	var filename string
	var gID int
	var mimeType, origFilename string
	if err := db.QueryRow(
		"SELECT filename, group_id, mime_type, original_filename FROM illustrations WHERE id = ?",
		illID,
	).Scan(&filename, &gID, &mimeType, &origFilename); err == sql.ErrNoRows {
		writeError(w, 404, "Illustration not found")
		return
	}

	if filename == "" {
		writeError(w, 404, "Illustration file not yet available")
		return
	}

	origPath := filepath.Join(s.UploadsDir(), strconv.Itoa(gID), "originals", filename)
	info, err := os.Stat(origPath)
	if err != nil || info.IsDir() {
		writeError(w, 404, "File not found on disk")
		return
	}

	if r.URL.Query().Get("download") == "true" {
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, origFilename))
	}
	w.Header().Set("Content-Type", mimeType)
	http.ServeFile(w, r, origPath)
}

// ── Serve Thumbnail ──────────────────────────────────────────────────────

func (s *Server) ServeIllustrationThumbnail(w http.ResponseWriter, r *http.Request) {
	illID, err := intParam(r, "illustrationId")
	if err != nil {
		writeError(w, 400, "Invalid illustration ID")
		return
	}

	quality := r.URL.Query().Get("quality")
	if quality == "" {
		quality = "low"
	}
	if quality != "low" && quality != "normal" && quality != "original" {
		writeError(w, 400, "quality must be one of: low, normal, original")
		return
	}

	db := database.GetDB()
	var filename string
	var groupID int
	var mimeType string
	if err := db.QueryRow(
		"SELECT filename, group_id, mime_type FROM illustrations WHERE id = ?",
		illID,
	).Scan(&filename, &groupID, &mimeType); err == sql.ErrNoRows {
		writeError(w, 404, "Illustration not found")
		return
	}

	if filename == "" {
		writeError(w, 404, "Illustration file not yet available")
		return
	}

	groupDir := filepath.Join(s.UploadsDir(), strconv.Itoa(groupID))

	if quality == "original" {
		origPath := filepath.Join(groupDir, "originals", filename)
		// info.IsDir() guard: avoids http.ServeFile's directory-canonicalization
		// 301 to "<url>/", which the router can't match.
		info, err := os.Stat(origPath)
		if err != nil || info.IsDir() {
			writeError(w, 404, "Original file not found on disk")
			return
		}
		w.Header().Set("Content-Type", mimeType)
		http.ServeFile(w, r, origPath)
		return
	}

	cfg := thumbnail.QualityConfigs[quality]
	thumbDir := filepath.Join(groupDir, cfg.Dir)
	filePath := filepath.Join(thumbDir, filename)

	// Generate on-the-fly if missing
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		originalPath := filepath.Join(groupDir, "originals", filename)
		if _, err := os.Stat(originalPath); os.IsNotExist(err) {
			writeError(w, 404, "Original file not found — cannot generate thumbnail")
			return
		}
		src, err := imaging.Open(originalPath)
		if err != nil {
			writeError(w, 500, "Failed to open original for thumbnail generation")
			return
		}
		thumb := thumbnail.CreateThumbnail(src, cfg.MaxSize)
		if err := thumbnail.SaveJPEG(thumb, filePath, cfg.JPEGQuality); err != nil {
			writeError(w, 500, "Failed to generate thumbnail")
			return
		}
	}

	if info, err := os.Stat(filePath); err != nil || info.IsDir() {
		writeError(w, 404, "Thumbnail not found")
		return
	}

	w.Header().Set("Content-Type", "image/jpeg")
	http.ServeFile(w, r, filePath)
}

// ── Retag Illustrations ──────────────────────────────────────────────────

// RetagIllustrations re-runs the tagger model on a batch of existing illustrations
// and overwrites their `tags` column. Body: { "ids": [int, ...] }.
func (s *Server) RetagIllustrations(w http.ResponseWriter, r *http.Request) {
	var body models.RetagRequest
	if err := decodeJSONBody(r, &body); err != nil {
		writeError(w, 400, "Invalid request body")
		return
	}
	if len(body.IDs) == 0 {
		writeError(w, 400, "No illustration ids provided")
		return
	}

	if !tagger.IsTaggerReady() {
		writeError(w, 503, "Tagger model is not loaded. Configure one in Settings first.")
		return
	}

	db := database.GetDB()
	resp := models.RetagResult{
		Updated: make([]models.IllustrationResponse, 0),
		Failed:  make([]models.UploadConflictItem, 0),
	}

	for _, illID := range body.IDs {
		var filename, originalFilename string
		var groupID int
		err := db.QueryRow(
			"SELECT filename, original_filename, group_id FROM illustrations WHERE id = ?",
			illID,
		).Scan(&filename, &originalFilename, &groupID)
		if err == sql.ErrNoRows {
			resp.Failed = append(resp.Failed, models.UploadConflictItem{
				Filename: fmt.Sprintf("#%d", illID),
				Error:    "illustration not found",
			})
			continue
		}
		if err != nil {
			resp.Failed = append(resp.Failed, models.UploadConflictItem{
				Filename: originalFilename,
				Error:    "database error",
			})
			continue
		}

		originalPath := filepath.Join(s.UploadsDir(), strconv.Itoa(groupID), "originals", filename)
		f, err := os.Open(originalPath)
		if err != nil {
			resp.Failed = append(resp.Failed, models.UploadConflictItem{
				Filename: originalFilename,
				Error:    "original file not found on disk",
			})
			continue
		}
		img, _, err := image.Decode(f)
		f.Close()
		if err != nil {
			resp.Failed = append(resp.Failed, models.UploadConflictItem{
				Filename: originalFilename,
				Error:    "cannot decode image",
			})
			continue
		}

		tags := tagger.ExtractTags(img)
		if _, err := db.Exec("UPDATE illustrations SET tags = ? WHERE id = ?", tags, illID); err != nil {
			resp.Failed = append(resp.Failed, models.UploadConflictItem{
				Filename: originalFilename,
				Error:    "failed to update tags",
			})
			continue
		}

		row := db.QueryRow(`
			SELECT i.*, g.name AS group_name
			FROM illustrations i JOIN groups g ON i.group_id = g.id
			WHERE i.id = ?
		`, illID)
		updated := scanIllustration(row)
		if updated != nil {
			resp.Updated = append(resp.Updated, *updated)
		}
	}

	writeJSON(w, 200, resp)
}

// ── Get Metadata ─────────────────────────────────────────────────────────

func (s *Server) GetIllustrationMetadata(w http.ResponseWriter, r *http.Request) {
	illID, err := intParam(r, "illustrationId")
	if err != nil {
		writeError(w, 400, "Invalid illustration ID")
		return
	}

	db := database.GetDB()
	var extData sql.NullString
	if err := db.QueryRow("SELECT extended_data FROM illustrations WHERE id = ?", illID).
		Scan(&extData); err == sql.ErrNoRows {
		writeError(w, 404, "Illustration not found")
		return
	}

	if extData.Valid {
		var parsed interface{}
		if err := json.Unmarshal([]byte(extData.String), &parsed); err == nil {
			writeJSON(w, 200, parsed)
			return
		}
	}
	writeJSON(w, 200, map[string]interface{}{})
}

// ── Helpers ─────────────────────────────────────────────────────────────

func uniquePositiveIDs(ids []int) []int {
	seen := make(map[int]bool, len(ids))
	result := make([]int, 0, len(ids))
	for _, id := range ids {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	return result
}

func normalizeRequestedTags(values []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0, len(values))
	for _, value := range values {
		parts := strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == '\n' || r == '\r' })
		for _, part := range parts {
			tag := strings.TrimSpace(part)
			key := strings.ToLower(tag)
			if tag == "" || seen[key] {
				continue
			}
			seen[key] = true
			result = append(result, tag)
		}
	}
	return result
}

func mutateStoredTags(current string, requested []string, operation string) string {
	existing := normalizeRequestedTags([]string{current})
	requestedKeys := make(map[string]bool, len(requested))
	for _, tag := range requested {
		requestedKeys[strings.ToLower(tag)] = true
	}

	if operation == "add" {
		for _, tag := range existing {
			delete(requestedKeys, strings.ToLower(tag))
		}
		for _, tag := range requested {
			if requestedKeys[strings.ToLower(tag)] {
				existing = append(existing, tag)
				delete(requestedKeys, strings.ToLower(tag))
			}
		}
		return strings.Join(existing, ", ")
	}

	kept := make([]string, 0, len(existing))
	for _, tag := range existing {
		if !requestedKeys[strings.ToLower(tag)] {
			kept = append(kept, tag)
		}
	}
	return strings.Join(kept, ", ")
}

func (s *Server) ensureUploadDirs(groupID int) error {
	baseDir := filepath.Join(s.UploadsDir(), strconv.Itoa(groupID))
	for _, sub := range []string{"originals", "thumbnails", "thumbnails_normal"} {
		if err := os.MkdirAll(filepath.Join(baseDir, sub), 0755); err != nil {
			return err
		}
	}
	return nil
}

type illustrationScanner interface {
	Scan(dest ...any) error
}

func scanIllustration(scanner illustrationScanner) *models.IllustrationResponse {
	var item models.IllustrationResponse
	var w, h sql.NullInt64
	var extData sql.NullString
	var groupName string

	if err := scanner.Scan(
		&item.ID, &item.GroupID, &item.Filename, &item.OriginalFilename,
		&item.FileSize, &w, &h, &item.MimeType, &item.Tags, &extData,
		&item.CreatedAt, &groupName,
	); err != nil {
		return nil
	}

	item.GroupName = groupName
	if w.Valid {
		wi := int(w.Int64)
		item.Width = &wi
	}
	if h.Valid {
		he := int(h.Int64)
		item.Height = &he
	}
	if extData.Valid {
		var parsed interface{}
		if json.Unmarshal([]byte(extData.String), &parsed) == nil {
			item.ExtendedData = parsed
		}
	}
	item.ThumbnailURL = fmt.Sprintf("/api/illustrations/%d/thumbnail", item.ID)
	item.FileURL = fmt.Sprintf("/api/illustrations/%d/file", item.ID)
	return &item
}
