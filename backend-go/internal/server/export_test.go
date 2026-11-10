package server

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDownloadExportPreservesOriginalsAndPaths(t *testing.T) {
	library := t.TempDir()
	s, err := NewServer(ServerConfig{DatabaseDir: library, FrontendDir: filepath.Join(library, "no-frontend")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })

	if _, err := s.db.Exec(`INSERT INTO groups (id, name) VALUES (1, 'Album');
		INSERT INTO illustrations (id, group_id, filename, original_filename)
		VALUES (1, 1, 'stored.png', 'source.png')`); err != nil {
		t.Fatal(err)
	}
	originals := filepath.Join(s.UploadsDir(), "1", "originals")
	if err := os.MkdirAll(originals, 0755); err != nil {
		t.Fatal(err)
	}
	const original = "original image bytes"
	if err := os.WriteFile(filepath.Join(originals, "stored.png"), []byte(original), 0644); err != nil {
		t.Fatal(err)
	}

	request := func(method, path, data string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(data))
		w := httptest.NewRecorder()
		s.Router.ServeHTTP(w, r)
		return w
	}
	const path = "插画组/2026-11/原图.png"
	prepared := request(http.MethodPost, "/api/export/download", `[{"id":1,"path":"`+path+`"}]`)
	var ticket struct{ URL string }
	if prepared.Code != 200 || json.Unmarshal(prepared.Body.Bytes(), &ticket) != nil || ticket.URL == "" {
		t.Fatalf("prepare export: %d %s", prepared.Code, prepared.Body.String())
	}
	download := request(http.MethodGet, ticket.URL, "")
	if download.Code != 200 || !strings.HasPrefix(download.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatalf("download export: %d, headers %v", download.Code, download.Header())
	}
	archive, err := zip.NewReader(bytes.NewReader(download.Body.Bytes()), int64(download.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if len(archive.File) != 1 || archive.File[0].Name != path {
		t.Fatalf("unexpected archive entries: %v", archive.File)
	}
	file, err := archive.File[0].Open()
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	contents, err := io.ReadAll(file)
	if err != nil || string(contents) != original {
		t.Fatalf("original file changed: %q (%v)", contents, err)
	}
	if replay := request(http.MethodGet, ticket.URL, ""); replay.Code != 404 {
		t.Fatalf("reused ticket: %d", replay.Code)
	}

	invalid := request(http.MethodPost, "/api/export/download", `[{"id":1,"path":"Album/../escape.png"}]`)
	if invalid.Code != 400 {
		t.Fatalf("unsafe path accepted: %d", invalid.Code)
	}

	for scope, draft := range map[string]string{"all": `{"fileLimit":8}`, "1": `{"fileLimit":11}`} {
		draftPath := "/api/export/draft/" + scope
		if saved := request(http.MethodPut, draftPath, draft); saved.Code != 204 {
			t.Fatalf("save %s draft: %d %s", scope, saved.Code, saved.Body.String())
		}
		if read := request(http.MethodGet, draftPath, ""); read.Code != 200 || strings.TrimSpace(read.Body.String()) != draft {
			t.Fatalf("read %s draft: %d %s", scope, read.Code, read.Body.String())
		}
	}
}
