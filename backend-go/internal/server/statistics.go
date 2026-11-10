package server

import (
	"context"
	"database/sql"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type statisticsDay struct {
	Date  string `json:"date"`
	Count int64  `json:"count"`
}

type statisticsGroup struct {
	ID                  int             `json:"id"`
	Name                string          `json:"name"`
	CoverIllustrationID *int            `json:"cover_illustration_id"`
	IllustrationCount   int64           `json:"illustration_count"`
	DiskBytes           int64           `json:"disk_bytes"`
	Days                []statisticsDay `json:"days"`
}

type libraryStatistics struct {
	DatabaseBytes int64 `json:"database_bytes"`
	DatabaseFiles struct {
		MainBytes int64 `json:"main_bytes"`
		WALBytes  int64 `json:"wal_bytes"`
		SHMBytes  int64 `json:"shm_bytes"`
	} `json:"database_files"`
	Storage struct {
		Basis        string `json:"basis"`
		UploadsBytes int64  `json:"uploads_bytes"`
		ModelsBytes  int64  `json:"models_bytes"`
	} `json:"storage"`
	IllustrationCount int64             `json:"illustration_count"`
	Today             string            `json:"today"`
	Groups            []statisticsGroup `json:"groups"`
}

func (s *Server) GetStatistics(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	result, err := readLibraryStatistics(ctx, s.db)
	if err == nil {
		err = s.readLibraryStorage(ctx, &result)
	}
	if err != nil {
		if ctx.Err() == nil {
			s.logger().Warn("statistics", "could not read library statistics: %v", err)
			writeError(w, http.StatusInternalServerError, "Failed to load library statistics")
		}
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) GetGroupStorage(w http.ResponseWriter, r *http.Request) {
	groupID, err := intParam(r, "groupId")
	if err != nil || groupID <= 0 {
		writeError(w, http.StatusBadRequest, "Invalid group ID")
		return
	}
	ctx := r.Context()
	sizes, err := s.readGroupStorage(ctx, groupID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "Group not found")
		return
	}
	if err != nil {
		if ctx.Err() == nil {
			s.logger().Warn("statistics", "could not read storage for group %d: %v", groupID, err)
			writeError(w, http.StatusInternalServerError, "Failed to load group storage")
		}
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Illustrations map[int]int64 `json:"illustrations"`
	}{Illustrations: sizes})
}

func (s *Server) readGroupStorage(ctx context.Context, groupID int) (map[int]int64, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT i.id, i.filename
		FROM groups AS g LEFT JOIN illustrations AS i ON i.group_id = g.id
		WHERE g.id = ?
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sizes := map[int]int64{}
	filenames := map[int]string{}
	groupExists := false
	for rows.Next() {
		groupExists = true
		var id sql.NullInt64
		var filename sql.NullString
		if err := rows.Scan(&id, &filename); err != nil {
			return nil, err
		}
		if id.Valid {
			sizes[int(id.Int64)] = 0
			if validStoredIllustrationFilename(filename.String) {
				filenames[int(id.Int64)] = filename.String
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if !groupExists {
		return nil, sql.ErrNoRows
	}
	if len(filenames) == 0 {
		return sizes, nil
	}

	uploadsDir := s.UploadsDir()
	groupDir := filepath.Join(uploadsDir, strconv.Itoa(groupID))
	for _, path := range []string{uploadsDir, groupDir} {
		if ordinary, err := isOrdinaryDirectory(path); err != nil || !ordinary {
			return sizes, err
		}
	}
	for _, sub := range illustrationStorageDirs {
		directory := filepath.Join(groupDir, sub)
		ordinary, err := isOrdinaryDirectory(directory)
		if err != nil {
			return nil, err
		}
		if !ordinary {
			continue
		}
		for id, filename := range filenames {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			bytes, err := fileDiskUsage(filepath.Join(directory, filename))
			if err != nil {
				return nil, err
			}
			sizes[id] += bytes
		}
	}
	return sizes, nil
}

func readLibraryStatistics(ctx context.Context, db *sql.DB) (libraryStatistics, error) {
	result := libraryStatistics{
		Today:  time.Now().Format(time.DateOnly),
		Groups: []statisticsGroup{},
	}
	// Use one SQLite snapshot for the structure, current totals and daily counts.
	rows, err := db.QueryContext(ctx, `
		WITH daily AS (
			SELECT group_id, date(created_at) AS day, COUNT(*) AS count
			FROM illustrations
			GROUP BY group_id, day
		)
		SELECT g.id, g.name, g.cover_illustration_id, d.day, COALESCE(d.count, 0)
		FROM groups AS g
		LEFT JOIN group_order AS o ON o.group_id = g.id
		LEFT JOIN daily AS d ON d.group_id = g.id
		ORDER BY o.position IS NULL, o.position, g.created_at DESC, g.id DESC, d.day
	`)
	if err != nil {
		return result, err
	}
	defer rows.Close()

	var group *statisticsGroup
	for rows.Next() {
		var entry statisticsGroup
		var day sql.NullString
		var count int64
		if err := rows.Scan(&entry.ID, &entry.Name, &entry.CoverIllustrationID, &day, &count); err != nil {
			return result, err
		}
		if group == nil || group.ID != entry.ID {
			entry.Days = []statisticsDay{}
			result.Groups = append(result.Groups, entry)
			group = &result.Groups[len(result.Groups)-1]
		}
		if day.Valid && day.String >= "0001-01-01" && day.String <= result.Today {
			group.Days = append(group.Days, statisticsDay{Date: day.String, Count: count})
		}
		group.IllustrationCount += count
		result.IllustrationCount += count
	}
	return result, rows.Err()
}

func (s *Server) readLibraryStorage(ctx context.Context, result *libraryStatistics) error {
	result.Storage.Basis = diskUsageBasis
	databasePath := filepath.Join(s.Config.DatabaseDir, databaseFilename)
	var err error
	result.DatabaseFiles.MainBytes, err = fileDiskUsage(databasePath)
	if err != nil {
		return err
	}
	result.DatabaseFiles.WALBytes, err = fileDiskUsage(databasePath + "-wal")
	if err != nil {
		return err
	}
	result.DatabaseFiles.SHMBytes, err = fileDiskUsage(databasePath + "-shm")
	if err != nil {
		return err
	}
	result.DatabaseBytes = result.DatabaseFiles.MainBytes + result.DatabaseFiles.WALBytes + result.DatabaseFiles.SHMBytes
	groupDiskBytes := make(map[string]int64, len(result.Groups))
	result.Storage.UploadsBytes, err = directoryDiskUsage(ctx, s.UploadsDir(), groupDiskBytes)
	if err != nil {
		return err
	}
	for index := range result.Groups {
		group := &result.Groups[index]
		group.DiskBytes = groupDiskBytes[strconv.Itoa(group.ID)]
	}
	result.Storage.ModelsBytes, err = directoryDiskUsage(ctx, s.ModelsDir(), nil)
	return err
}

func fileDiskUsage(path string) (int64, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if !info.Mode().IsRegular() {
		return 0, nil
	}
	bytes, err := regularFileDiskUsage(path, info)
	if errors.Is(err, fs.ErrNotExist) {
		return 0, nil
	}
	return bytes, err
}

func isOrdinaryDirectory(path string) (bool, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return info.IsDir(), nil
}

func directoryDiskUsage(ctx context.Context, root string, bytesByDirectory map[string]int64) (int64, error) {
	var total int64
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		// Uploads and model downloads can rename or remove files during the walk.
		if errors.Is(walkErr, fs.ErrNotExist) {
			return nil
		}
		if walkErr != nil {
			return walkErr
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		info, err := entry.Info()
		var bytes int64
		if err == nil && info.Mode().IsRegular() {
			bytes, err = regularFileDiskUsage(path, info)
		}
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		total += bytes
		if bytesByDirectory != nil {
			relative, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			if directory, _, insideDirectory := strings.Cut(relative, string(filepath.Separator)); insideDirectory {
				bytesByDirectory[directory] += bytes
			}
		}
		return nil
	})
	return total, err
}
