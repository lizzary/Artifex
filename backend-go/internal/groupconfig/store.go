package groupconfig

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
)

var (
	ErrInvalid       = errors.New("invalid group configuration")
	ErrGroupNotFound = errors.New("group not found")
	ErrColorNotFound = errors.New("color configuration item not found")
	ErrConflict      = errors.New("color configuration item already exists")
)

type configPatch struct {
	GroupOrder *[]int                     `json:"group_order"`
	Groups     map[string]json.RawMessage `json:"groups"`
}

func decode(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("expected one JSON value")
	}
	return nil
}

type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

// Load reads preferences and gallery order from a single database snapshot.
func Load(ctx context.Context, db *sql.DB) (*Config, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	cfg, err := load(ctx, tx)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func load(ctx context.Context, reader queryer) (*Config, error) {
	cfg := New()
	rows, err := reader.QueryContext(ctx, "SELECT group_id, view, colors FROM group_configs")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		var view, colors []byte
		if err := rows.Scan(&id, &view, &colors); err != nil {
			return nil, err
		}
		group := DefaultGroup()
		if json.Unmarshal(view, &group.View) != nil || group.View.Validate() != nil {
			group.View = DefaultView()
		}
		group.Colors = NormalizeColors(colors)
		cfg.Groups[strconv.Itoa(id)] = group
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	rows, err = reader.QueryContext(ctx, "SELECT group_id FROM group_order ORDER BY position")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		cfg.GroupOrder = append(cfg.GroupOrder, id)
	}
	return cfg, rows.Err()
}

// Update reserves the SQLite writer before reading. Concurrent partial updates
// therefore merge against committed data, and a failed patch changes no rows.
func Update(ctx context.Context, db *sql.DB, data []byte) (*Config, error) {
	var patch *configPatch
	if err := decode(data, &patch); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if patch == nil {
		return nil, fmt.Errorf("%w: expected an object", ErrInvalid)
	}
	return writeConfig(ctx, db, func(conn *sql.Conn, cfg *Config) error {
		for id, raw := range patch.Groups {
			if !ValidGroupID(id) {
				return fmt.Errorf("%w: invalid group ID", ErrInvalid)
			}
			if err := requireGroup(ctx, conn, id); err != nil {
				return err
			}
			var fields *struct {
				View json.RawMessage `json:"view"`
			}
			if err := decode(raw, &fields); err != nil || fields == nil {
				return fmt.Errorf("%w: expected group settings object", ErrInvalid)
			}
			group, ok := cfg.Groups[id]
			if !ok {
				group = DefaultGroup()
			}
			if fields.View != nil {
				if err := decode(fields.View, &group.View); err != nil {
					return fmt.Errorf("%w: %v", ErrInvalid, err)
				}
				if err := group.View.Validate(); err != nil {
					return fmt.Errorf("%w: %v", ErrInvalid, err)
				}
			}
			view, err := json.Marshal(group.View)
			if err != nil {
				return err
			}
			_, err = conn.ExecContext(ctx, `INSERT INTO group_configs (group_id, view, colors) VALUES (?, ?, ?)
			ON CONFLICT(group_id) DO UPDATE SET view = excluded.view`, id, string(view), string(group.Colors))
			if err != nil {
				return err
			}
			cfg.Groups[id] = group
		}
		if patch.GroupOrder != nil {
			if _, err := conn.ExecContext(ctx, "DELETE FROM group_order"); err != nil {
				return err
			}
			seen := make(map[int]bool)
			for position, id := range *patch.GroupOrder {
				if id <= 0 || seen[id] {
					return fmt.Errorf("%w: group_order requires unique positive IDs", ErrInvalid)
				}
				if err := requireGroup(ctx, conn, strconv.Itoa(id)); err != nil {
					return err
				}
				if _, err := conn.ExecContext(ctx, "INSERT INTO group_order (group_id, position) VALUES (?, ?)", id, position); err != nil {
					return err
				}
				seen[id] = true
			}
			cfg.GroupOrder = *patch.GroupOrder
		}
		return nil
	})
}

func writeConfig(ctx context.Context, db *sql.DB, change func(*sql.Conn, *Config) error) (*Config, error) {
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return nil, err
	}
	defer conn.ExecContext(context.Background(), "ROLLBACK")
	cfg, err := load(ctx, conn)
	if err != nil {
		return nil, err
	}
	if err := change(conn, cfg); err != nil {
		return nil, err
	}
	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return nil, err
	}
	return cfg, nil
}

func requireGroup(ctx context.Context, conn *sql.Conn, id string) error {
	var exists bool
	if err := conn.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM groups WHERE id = ?)", id).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("%w: %s", ErrGroupNotFound, id)
	}
	return nil
}
