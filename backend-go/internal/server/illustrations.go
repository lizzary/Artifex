package server

import (
	"bytes"
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
		ORDER BY i.created_at DESC
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

	writeJSON(w, 200, models.IllustrationListResult{
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
	}

	// Parse multipart form (max 2GB)
	if err := r.ParseMultipartForm(2 << 30); err != nil {
		writeError(w, 400, "Failed to parse upload")
		return
	}

	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		writeError(w, 400, "No files provided")
		return
	}

	skipAutoTag := strings.ToLower(r.FormValue("skip_auto_tag")) == "true"

	// Ensure upload directories exist
	s.ensureUploadDirs(groupID)

	currentSettings, _ := settings.Load(s.SettingsPath())
	autoTagEnabled := currentSettings.AutoTag && !skipAutoTag

	results := make([]models.IllustrationResponse, 0)

	for _, fh := range files {
		item, err := s.processUpload(groupID, groupName, fh, autoTagEnabled)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		results = append(results, *item)
	}

	writeJSON(w, 201, results)
}

func (s *Server) processUpload(groupID int, groupName string, fh *multipart.FileHeader, autoTag bool) (*models.IllustrationResponse, error) {

	file, err := fh.Open()
	if err != nil {
		return nil, fmt.Errorf("failed to open uploaded file")
	}
	defer file.Close()

	safeFilename := filepath.Base(fh.Filename)

	// Read all bytes
	contents, err := io.ReadAll(file)
	if err != nil {
		return nil, fmt.Errorf("failed to read %s", safeFilename)
	}

	// Decode image
	img, format, err := image.Decode(bytes.NewReader(contents))
	if err != nil {
		return nil, fmt.Errorf("cannot identify image: %s", safeFilename)
	}

	// Tag extraction
	var tags string
	if autoTag {
		tags = tagger.ExtractTags(img)
	}

	width, height, mimeType := thumbnail.GetImageInfo(img, format)

	db := database.GetDB()

	// Insert with placeholder filename
	result, err := db.Exec(`
		INSERT INTO illustrations
		(group_id, filename, original_filename, file_size, width, height, mime_type, tags, extended_data)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, groupID, "", safeFilename, len(contents), width, height, mimeType, tags, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to save %s: %v", safeFilename, err)
	}

	illID, _ := result.LastInsertId()
	diskFilename := fmt.Sprintf("%d_%s", illID, safeFilename)

	// Write originals and thumbnails
	originalsDir := filepath.Join(s.UploadsDir(), strconv.Itoa(groupID), "originals")

	// Generate thumbnails
	for quality, cfg := range thumbnail.QualityConfigs {
		thumbImg := thumbnail.CreateThumbnail(img, cfg.MaxSize)
		thumbDir := filepath.Join(s.UploadsDir(), strconv.Itoa(groupID), cfg.Dir)
		thumbPath := filepath.Join(thumbDir, diskFilename)
		if err := thumbnail.SaveJPEG(thumbImg, thumbPath, cfg.JPEGQuality); err != nil {
			return nil, fmt.Errorf("failed to create thumbnail for %s", safeFilename)
		}
		_ = quality
	}

	// Save original
	originalPath := filepath.Join(originalsDir, diskFilename)
	if err := os.MkdirAll(originalsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create directory: %v", err)
	}
	if err := os.WriteFile(originalPath, contents, 0644); err != nil {
		return nil, fmt.Errorf("failed to save original %s", safeFilename)
	}

	// Extract ComfyUI metadata
	var extendedDataJSON *string
	meta, err := metadata.Extract(originalPath, img)
	if err == nil && len(meta) > 0 {
		metaBytes, _ := json.Marshal(meta)
		ed := string(metaBytes)
		extendedDataJSON = &ed
	}

	// Update filename and extended_data
	if extendedDataJSON != nil {
		db.Exec("UPDATE illustrations SET filename = ?, extended_data = ? WHERE id = ?",
			diskFilename, *extendedDataJSON, illID)
	} else {
		db.Exec("UPDATE illustrations SET filename = ? WHERE id = ?",
			diskFilename, illID)
	}

	var item models.IllustrationResponse
	var w, h sql.NullInt64
	var extData sql.NullString
	db.QueryRow(`
		SELECT i.*, ? AS group_name FROM illustrations i WHERE i.id = ?
	`, groupName, illID).Scan(
		&item.ID, &item.GroupID, &item.Filename, &item.OriginalFilename,
		&item.FileSize, &w, &h, &item.MimeType, &item.Tags, &extData,
		&item.CreatedAt,
	)
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
	item.ThumbnailURL = fmt.Sprintf("/api/illustrations/%d/thumbnail", illID)
	item.FileURL = fmt.Sprintf("/api/illustrations/%d/file", illID)

	return &item, nil
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

	item := scanIllustrationRow(row)
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
	item := scanIllustrationRow(row)
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
	updated := scanIllustrationRow(row)
	if updated == nil {
		writeError(w, 404, "Illustration not found")
		return
	}
	writeJSON(w, 200, updated)
}

// ── Delete Illustration ──────────────────────────────────────────────────

func (s *Server) DeleteIllustration(w http.ResponseWriter, r *http.Request) {
	illID, err := intParam(r, "illustrationId")
	if err != nil {
		writeError(w, 400, "Invalid illustration ID")
		return
	}

	db := database.GetDB()

	var filename string
	var groupID int
	if err := db.QueryRow("SELECT filename, group_id FROM illustrations WHERE id = ?", illID).
		Scan(&filename, &groupID); err == sql.ErrNoRows {
		writeError(w, 404, "Illustration not found")
		return
	}

	// Unset as cover
	db.Exec("UPDATE groups SET cover_illustration_id = NULL WHERE cover_illustration_id = ?", illID)
	db.Exec("DELETE FROM illustrations WHERE id = ?", illID)

	// Delete files
	groupDir := filepath.Join(s.UploadsDir(), strconv.Itoa(groupID))
	for _, sub := range []string{"originals", "thumbnails", "thumbnails_normal"} {
		fp := filepath.Join(groupDir, sub, filename)
		if _, err := os.Stat(fp); err == nil {
			os.Remove(fp)
		}
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

	filepath := filepath.Join(s.UploadsDir(), strconv.Itoa(gID), "originals", filename)
	if _, err := os.Stat(filepath); os.IsNotExist(err) {
		writeError(w, 404, "File not found on disk")
		return
	}

	if r.URL.Query().Get("download") == "true" {
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, origFilename))
	}
	w.Header().Set("Content-Type", mimeType)
	http.ServeFile(w, r, filepath)
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

	groupDir := filepath.Join(s.UploadsDir(), strconv.Itoa(groupID))

	if quality == "original" {
		filepath := filepath.Join(groupDir, "originals", filename)
		if _, err := os.Stat(filepath); os.IsNotExist(err) {
			writeError(w, 404, "Original file not found on disk")
			return
		}
		w.Header().Set("Content-Type", mimeType)
		http.ServeFile(w, r, filepath)
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

	w.Header().Set("Content-Type", "image/jpeg")
	http.ServeFile(w, r, filePath)
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

func (s *Server) ensureUploadDirs(groupID int) {
	baseDir := filepath.Join(s.UploadsDir(), strconv.Itoa(groupID))
	os.MkdirAll(filepath.Join(baseDir, "originals"), 0755)
	os.MkdirAll(filepath.Join(baseDir, "thumbnails"), 0755)
	os.MkdirAll(filepath.Join(baseDir, "thumbnails_normal"), 0755)
}

func scanIllustration(rows *sql.Rows) *models.IllustrationResponse {
	var item models.IllustrationResponse
	var w, h sql.NullInt64
	var extData sql.NullString
	var groupName string

	if err := rows.Scan(
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

func scanIllustrationRow(row *sql.Row) *models.IllustrationResponse {
	var item models.IllustrationResponse
	var w, h sql.NullInt64
	var extData sql.NullString
	var groupName string

	if err := row.Scan(
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
