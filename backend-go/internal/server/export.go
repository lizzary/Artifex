package server

import (
	"archive/zip"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/go-chi/chi/v5"
)

type exportIllustration struct {
	ID               int               `json:"id"`
	GroupID          int               `json:"group_id"`
	GroupName        string            `json:"group_name"`
	OriginalFilename string            `json:"original_filename"`
	CreatedAt        string            `json:"created_at"`
	FileSize         int64             `json:"file_size"`
	Width            *int              `json:"width"`
	Height           *int              `json:"height"`
	MimeType         string            `json:"mime_type"`
	Tags             string            `json:"tags"`
	ExtendedData     map[string]string `json:"extended_data,omitempty"`
}

func (s *Server) GetExportCatalog(w http.ResponseWriter, r *http.Request) {
	scope, err := exportScope(r.URL.Query().Get("scope"))
	if err != nil {
		writeError(w, 400, "Invalid export scope")
		return
	}
	query := `
		SELECT i.id, i.group_id, g.name, i.original_filename, COALESCE(i.created_at, ''),
		       i.file_size, i.width, i.height, i.mime_type, i.tags, i.extended_data
		FROM illustrations i JOIN groups g ON g.id = i.group_id`
	var args []any
	if scope > 0 {
		query += " WHERE i.group_id = ?"
		args = append(args, scope)
	}
	rows, err := s.db.QueryContext(r.Context(), query+" ORDER BY i.id DESC", args...)
	if err != nil {
		writeError(w, 500, "Failed to load the export catalog")
		return
	}
	defer rows.Close()

	items := []exportIllustration{}
	for rows.Next() {
		var item exportIllustration
		var metadata sql.NullString
		err := rows.Scan(&item.ID, &item.GroupID, &item.GroupName, &item.OriginalFilename, &item.CreatedAt,
			&item.FileSize, &item.Width, &item.Height, &item.MimeType, &item.Tags, &metadata)
		if err != nil {
			writeError(w, 500, "Failed to read the export catalog")
			return
		}
		if metadata.Valid {
			var prompts struct {
				Positive string `json:"Positive Prompt"`
				Negative string `json:"Negative Prompt"`
			}
			_ = json.Unmarshal([]byte(metadata.String), &prompts)
			if prompts.Positive != "" || prompts.Negative != "" {
				item.ExtendedData = map[string]string{"Positive Prompt": prompts.Positive, "Negative Prompt": prompts.Negative}
			}
		}
		items = append(items, item)
	}
	if rows.Err() != nil {
		writeError(w, 500, "Failed to read the export catalog")
		return
	}
	writeJSON(w, 200, items)
}

func exportScope(value string) (int, error) {
	if value == "" || value == "all" {
		return 0, nil
	}
	scope, err := strconv.Atoi(value)
	if err != nil || scope <= 0 {
		return 0, errors.New("invalid export scope")
	}
	return scope, nil
}

func (s *Server) GetExportDraft(w http.ResponseWriter, r *http.Request) {
	scope, err := exportScope(chi.URLParam(r, "scope"))
	if err != nil {
		writeError(w, 400, "Invalid export scope")
		return
	}
	var draft string
	err = s.db.QueryRowContext(r.Context(), "SELECT draft FROM export_drafts WHERE scope = ?", scope).Scan(&draft)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		writeJSON(w, 200, nil)
	case err != nil:
		writeError(w, 500, "Failed to load the export draft")
	default:
		writeJSON(w, 200, json.RawMessage(draft))
	}
}

func (s *Server) SaveExportDraft(w http.ResponseWriter, r *http.Request) {
	scope, err := exportScope(chi.URLParam(r, "scope"))
	if err != nil {
		writeError(w, 400, "Invalid export scope")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4<<20))
	var draft map[string]json.RawMessage
	if err != nil || json.Unmarshal(data, &draft) != nil || draft == nil {
		writeError(w, 400, "Invalid export draft")
		return
	}
	var groupID any
	if scope > 0 {
		groupID = scope
	}
	_, err = s.db.ExecContext(r.Context(), `
		INSERT INTO export_drafts (scope, group_id, draft) VALUES (?, ?, ?)
		ON CONFLICT(scope) DO UPDATE SET draft = excluded.draft`, scope, groupID, string(data))
	if err != nil {
		writeError(w, 500, "Failed to save the export draft")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type exportEntry struct {
	ID   int    `json:"id"`
	Path string `json:"path"`
}

type exportFile struct {
	path   string
	source string
}

type exportTicket struct {
	files   []exportFile
	library string
	expires time.Time
}

const exportTicketLifetime = 2 * time.Minute

type exportTickets struct {
	mu    sync.Mutex
	items map[string]exportTicket
}

func (tickets *exportTickets) issue(library string, files []exportFile) (string, bool) {
	tickets.mu.Lock()
	defer tickets.mu.Unlock()
	now := time.Now()
	for id, item := range tickets.items {
		if !now.Before(item.expires) || item.library != library {
			delete(tickets.items, id)
		}
	}
	if len(tickets.items) >= 8 {
		return "", false
	}
	if tickets.items == nil {
		tickets.items = make(map[string]exportTicket)
	}
	id := rand.Text()
	tickets.items[id] = exportTicket{files: files, library: library, expires: now.Add(exportTicketLifetime)}
	time.AfterFunc(exportTicketLifetime, func() {
		tickets.mu.Lock()
		defer tickets.mu.Unlock()
		delete(tickets.items, id)
	})
	return id, true
}

func (tickets *exportTickets) consume(id string, library string) []exportFile {
	tickets.mu.Lock()
	defer tickets.mu.Unlock()
	item, ok := tickets.items[id]
	delete(tickets.items, id)
	if !ok || item.library != library || !time.Now().Before(item.expires) {
		return nil
	}
	return item.files
}

func validExportPath(name string) bool {
	if len(name) > 4096 {
		return false
	}
	parts := strings.Split(name, "/")
	if len(parts) > 24 {
		return false
	}
	for _, part := range parts {
		if len(part) == 0 || len(part) > 255 || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") ||
			strings.ContainsAny(part, "<>:\"|?*\\") || strings.ContainsFunc(part, unicode.IsControl) {
			return false
		}
		device, _, _ := strings.Cut(strings.ToUpper(part), ".")
		device = strings.TrimRight(device, " ")
		switch device {
		case "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$":
			return false
		}
		if (strings.HasPrefix(device, "COM") || strings.HasPrefix(device, "LPT")) &&
			slices.Contains([]string{"1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"}, device[3:]) {
			return false
		}
	}
	return true
}

func validateExportEntries(entries []exportEntry) ([]int, bool) {
	ids := make([]int, 0, len(entries))
	usedIDs := make(map[int]bool)
	files, folders := make(map[string]bool), make(map[string]bool)
	for _, entry := range entries {
		if entry.ID <= 0 || usedIDs[entry.ID] || !validExportPath(entry.Path) {
			return nil, false
		}
		name := strings.ToLower(entry.Path)
		if files[name] || folders[name] {
			return nil, false
		}
		for index, char := range name {
			if char == '/' {
				folder := name[:index]
				if files[folder] {
					return nil, false
				}
				folders[folder] = true
			}
		}
		files[name], usedIDs[entry.ID] = true, true
		ids = append(ids, entry.ID)
	}
	return ids, true
}

func (s *Server) exportSources(ctx context.Context, ids []int) (map[int]string, error) {
	sources := make(map[int]string, len(ids))
	for batch := range slices.Chunk(ids, 500) {
		args := make([]any, len(batch))
		for i, id := range batch {
			args[i] = id
		}
		markers := strings.Repeat("?,", len(batch)-1) + "?"
		rows, err := s.db.QueryContext(ctx, "SELECT id, group_id, filename FROM illustrations WHERE id IN ("+markers+")", args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id, groupID int
			var filename string
			if err := rows.Scan(&id, &groupID, &filename); err != nil {
				rows.Close()
				return nil, err
			}
			if filename != "" && filepath.IsLocal(filename) && filepath.Base(filename) == filename {
				sources[id] = filepath.Join(s.UploadsDir(), strconv.Itoa(groupID), "originals", filename)
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	return sources, nil
}

func (s *Server) PrepareExport(w http.ResponseWriter, r *http.Request) {
	var entries []exportEntry
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<20))
	if err := decoder.Decode(&entries); err != nil || len(entries) == 0 {
		writeError(w, 400, "Choose illustrations to export")
		return
	}
	ids, valid := validateExportEntries(entries)
	if !valid {
		writeError(w, 400, "Invalid or duplicate export filenames")
		return
	}
	sources, err := s.exportSources(r.Context(), ids)
	if err != nil {
		writeError(w, 500, "Failed to locate the originals")
		return
	}
	files := make([]exportFile, 0, len(entries))
	for _, entry := range entries {
		source := sources[entry.ID]
		info, err := os.Stat(source)
		if err != nil || !info.Mode().IsRegular() {
			writeError(w, 409, "An original is unavailable. Reopen the export and check your selection.")
			return
		}
		files = append(files, exportFile{path: entry.Path, source: source})
	}
	id, available := s.exports.issue(s.libraryID, files)
	if !available {
		writeError(w, 429, "Too many pending exports. Try again shortly.")
		return
	}
	writeJSON(w, 200, map[string]string{"url": "/api/export/download/" + id})
}

func (s *Server) DownloadExport(w http.ResponseWriter, r *http.Request) {
	files := s.exports.consume(chi.URLParam(r, "ticket"), s.libraryID)
	if len(files) == 0 {
		writeError(w, 404, "This export has expired. Create a new download in Artifex.")
		return
	}
	name := fmt.Sprintf("Artifex-%s.zip", time.Now().Format("2006-01-02_15-04-05"))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	archive := zip.NewWriter(w)
	for _, file := range files {
		if err := r.Context().Err(); err != nil {
			return
		}
		if err := writeExportFile(archive, file); err != nil {
			s.logger().Warn("export", "archive interrupted: %v", err)
			panic(http.ErrAbortHandler)
		}
	}
	if err := archive.Close(); err != nil {
		s.logger().Warn("export", "archive interrupted: %v", err)
		panic(http.ErrAbortHandler)
	}
}

func writeExportFile(archive *zip.Writer, file exportFile) error {
	source, err := os.Open(file.source)
	if err != nil {
		return err
	}
	defer source.Close()
	info, err := source.Stat()
	if err != nil {
		return err
	}
	// The source is already an encoded image. Store it without recompressing.
	target, err := archive.CreateHeader(&zip.FileHeader{Name: file.path, Method: zip.Store, Modified: info.ModTime()})
	if err != nil {
		return err
	}
	_, err = io.Copy(target, source)
	return err
}
