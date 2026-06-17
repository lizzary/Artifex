package database

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

func InitDB(dbPath string) error {
	// Ensure parent directory exists
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	var err error
	DB, err = sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return err
	}

	// Enable WAL mode and foreign keys
	if _, err := DB.Exec("PRAGMA journal_mode=WAL"); err != nil {
		return err
	}
	if _, err := DB.Exec("PRAGMA foreign_keys=ON"); err != nil {
		return err
	}

	return createSchema()
}

func createSchema() error {
	schema := `
		CREATE TABLE IF NOT EXISTS groups (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			cover_illustration_id INTEGER,
			created_at TEXT DEFAULT (datetime('now', 'localtime'))
		);

		CREATE TABLE IF NOT EXISTS illustrations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			group_id INTEGER NOT NULL,
			filename TEXT NOT NULL,
			original_filename TEXT NOT NULL,
			file_size INTEGER NOT NULL DEFAULT 0,
			width INTEGER,
			height INTEGER,
			mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
			tags TEXT NOT NULL DEFAULT '',
			extended_data TEXT DEFAULT NULL,
			created_at TEXT DEFAULT (datetime('now', 'localtime')),
			FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
		);

		CREATE VIRTUAL TABLE IF NOT EXISTS illustrations_fts USING fts5(
			tags,
			content='illustrations',
			content_rowid='id'
		);

		CREATE TRIGGER IF NOT EXISTS illustrations_ai AFTER INSERT ON illustrations BEGIN
			INSERT INTO illustrations_fts(rowid, tags) VALUES (new.id, new.tags);
		END;

		CREATE TRIGGER IF NOT EXISTS illustrations_ad AFTER DELETE ON illustrations BEGIN
			INSERT INTO illustrations_fts(illustrations_fts, rowid, tags) VALUES('delete', old.id, old.tags);
		END;

		CREATE TRIGGER IF NOT EXISTS illustrations_au AFTER UPDATE ON illustrations BEGIN
			INSERT INTO illustrations_fts(illustrations_fts, rowid, tags) VALUES('delete', old.id, old.tags);
			INSERT INTO illustrations_fts(rowid, tags) VALUES (new.id, new.tags);
		END;

		CREATE INDEX IF NOT EXISTS idx_illustrations_group_id
			ON illustrations(group_id);
	`

	_, err := DB.Exec(schema)
	return err
}

// SplitTags splits a comma-separated tags string into a slice of unique, sorted tag names.
func SplitTags(tags string) []string {
	if strings.TrimSpace(tags) == "" {
		return nil
	}
	parts := strings.Split(tags, ",")
	seen := make(map[string]bool)
	var result []string
	for _, p := range parts {
		t := strings.TrimSpace(p)
		if t != "" && !seen[t] {
			seen[t] = true
			result = append(result, t)
		}
	}
	// Sort for deterministic output
	for i := 0; i < len(result); i++ {
		for j := i + 1; j < len(result); j++ {
			if result[i] > result[j] {
				result[i], result[j] = result[j], result[i]
			}
		}
	}
	return result
}

func GetDB() *sql.DB {
	return DB
}
