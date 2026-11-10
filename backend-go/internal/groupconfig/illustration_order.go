package groupconfig

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
)

var ErrIllustrationOrderConflict = errors.New("illustrations changed; refresh the group and try again")

type illustrationReorder struct {
	IDs      []int  `json:"ids"`
	AnchorID int    `json:"anchor_id"`
	Side     string `json:"side"`
	Color    *struct {
		SetID       string             `json:"set_id"`
		Assignments map[string]*string `json:"assignments"`
	} `json:"color"`
}

// ReorderIllustrations applies a relative move to the latest default order.
// Color assignments and positions are committed together under the same writer lock.
func ReorderIllustrations(ctx context.Context, db *sql.DB, groupID int, data []byte) (*Config, error) {
	var move *illustrationReorder
	if err := decode(data, &move); err != nil || move == nil || groupID <= 0 ||
		len(move.IDs) == 0 || move.AnchorID <= 0 || (move.Side != "before" && move.Side != "after") {
		return nil, fmt.Errorf("%w: expected illustration IDs, an anchor and a side", ErrInvalid)
	}
	moved := make(map[int]bool, len(move.IDs))
	for _, id := range move.IDs {
		if id <= 0 || moved[id] || id == move.AnchorID {
			return nil, fmt.Errorf("%w: moved IDs must be unique, positive and exclude the anchor", ErrInvalid)
		}
		moved[id] = true
	}
	if move.Color != nil {
		if strings.TrimSpace(move.Color.SetID) == "" || len(move.Color.Assignments) == 0 {
			return nil, fmt.Errorf("%w: color changes require a set and assignments", ErrInvalid)
		}
		for id := range move.Color.Assignments {
			numericID, err := strconv.Atoi(id)
			if err != nil || !moved[numericID] || strconv.Itoa(numericID) != id {
				return nil, fmt.Errorf("%w: color assignments must reference moved illustrations", ErrInvalid)
			}
		}
	}

	groupKey := strconv.Itoa(groupID)
	return writeConfig(ctx, db, func(conn *sql.Conn, cfg *Config) error {
		if err := requireGroup(ctx, conn, groupKey); err != nil {
			return err
		}
		order, err := readReorderedIllustrationIDs(ctx, conn, groupID, move, moved)
		if err != nil {
			return err
		}
		if move.Color != nil {
			colors := readColors(cfg.Groups[groupKey].Colors)
			set := colors.set(move.Color.SetID)
			if set == nil {
				return fmt.Errorf("%w: set %s", ErrColorNotFound, move.Color.SetID)
			}
			if colors.ActiveID == nil || *colors.ActiveID != set.ID {
				return ErrIllustrationOrderConflict
			}
			for id, pairID := range move.Color.Assignments {
				if pairID == nil {
					set.ManualAssignments[id] = ""
					continue
				}
				if set.pair(*pairID) == nil {
					return fmt.Errorf("%w: pair %s", ErrColorNotFound, *pairID)
				}
				set.ManualAssignments[id] = *pairID
			}
			if err := saveColors(ctx, conn, cfg, groupID, colors); err != nil {
				return err
			}
		}
		positions, err := json.Marshal(order)
		if err != nil {
			return err
		}
		// json_each binds a single value even for libraries larger than SQLite's parameter limit.
		_, err = conn.ExecContext(ctx, `INSERT OR REPLACE INTO illustration_order (illustration_id, position)
			SELECT value, key FROM json_each(?)`, string(positions))
		return err
	})
}

func readReorderedIllustrationIDs(ctx context.Context, conn *sql.Conn, groupID int, move *illustrationReorder, moved map[int]bool) ([]int, error) {
	rows, err := conn.QueryContext(ctx, `
		SELECT i.id
		FROM illustrations i
		LEFT JOIN illustration_order io ON io.illustration_id = i.id
		WHERE i.group_id = ?
		ORDER BY io.position, i.created_at DESC, i.id DESC
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var remaining []int
	movedCount := 0
	anchorIndex := -1
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		if moved[id] {
			movedCount++
			continue
		}
		if id == move.AnchorID {
			anchorIndex = len(remaining)
		}
		remaining = append(remaining, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if movedCount != len(move.IDs) || anchorIndex < 0 {
		return nil, ErrIllustrationOrderConflict
	}
	if move.Side == "after" {
		anchorIndex++
	}
	return slices.Insert(remaining, anchorIndex, move.IDs...), nil
}
