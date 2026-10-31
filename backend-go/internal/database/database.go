package database

import (
	"database/sql"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

func Open(dbPath string) (*sql.DB, error) {
	// Ensure parent directory exists
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}

	if err := createSchema(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func createSchema(db *sql.DB) error {
	schema := `
		CREATE TABLE IF NOT EXISTS groups (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			cover_illustration_id INTEGER,
			created_at TEXT DEFAULT (datetime('now', 'localtime'))
		);

		CREATE TABLE IF NOT EXISTS group_configs (
			group_id INTEGER PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
			view TEXT NOT NULL CHECK (json_valid(view)),
			colors TEXT NOT NULL CHECK (json_valid(colors))
		);

		CREATE TABLE IF NOT EXISTS group_order (
			group_id INTEGER PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
			position INTEGER NOT NULL UNIQUE CHECK (position >= 0)
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

	_, err := db.Exec(schema)
	return err
}
