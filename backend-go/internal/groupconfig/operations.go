package groupconfig

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
)

type colorOperation struct {
	Type        string             `json:"type"`
	SetID       string             `json:"set_id"`
	PairID      string             `json:"pair_id"`
	Set         json.RawMessage    `json:"set"`
	Pair        json.RawMessage    `json:"pair"`
	Changes     json.RawMessage    `json:"changes"`
	IDs         json.RawMessage    `json:"ids"`
	Assignments map[string]*string `json:"assignments"`
	IfAbsent    bool               `json:"if_absent"`
}

var operationFields = map[string][]string{
	"create_set":        {"set", "if_absent"},
	"update_set":        {"set_id", "changes"},
	"delete_set":        {"set_id"},
	"set_active":        {"set_id"},
	"create_pair":       {"set_id", "pair"},
	"update_pair":       {"set_id", "pair_id", "changes"},
	"delete_pair":       {"set_id", "pair_id"},
	"reorder_pairs":     {"set_id", "ids"},
	"reorder_rules":     {"set_id", "ids"},
	"assign":            {"set_id", "assignments"},
	"clear_assignments": {"ids"},
}

func parseOperation(raw json.RawMessage) (colorOperation, error) {
	var op colorOperation
	if err := decode(raw, &op); err != nil {
		return op, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	allowed, ok := operationFields[op.Type]
	if !ok {
		return op, fmt.Errorf("%w: unknown operation %q", ErrInvalid, op.Type)
	}
	if slices.Contains(allowed, "set_id") && strings.TrimSpace(op.SetID) == "" {
		return op, fmt.Errorf("%w: set_id is required", ErrInvalid)
	}
	if slices.Contains(allowed, "pair_id") && strings.TrimSpace(op.PairID) == "" {
		return op, fmt.Errorf("%w: pair_id is required", ErrInvalid)
	}
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(raw, &fields)
	for key, value := range fields {
		if key != "type" && !slices.Contains(allowed, key) {
			return op, fmt.Errorf("%w: unexpected field %q for %s", ErrInvalid, key, op.Type)
		}
		if string(value) == "null" {
			return op, fmt.Errorf("%w: %s cannot be null", ErrInvalid, key)
		}
	}
	return op, nil
}

// ApplyColorOperations applies only explicit resource/field mutations to the
// latest committed configuration. The entire batch commits or rolls back.
func ApplyColorOperations(ctx context.Context, db *sql.DB, groupID int, data []byte) (*Config, error) {
	var body *struct {
		Operations []json.RawMessage `json:"operations"`
	}
	if err := decode(data, &body); err != nil || body == nil || len(body.Operations) == 0 {
		return nil, fmt.Errorf("%w: operations must be a nonempty array", ErrInvalid)
	}
	ops := make([]colorOperation, len(body.Operations))
	for i, raw := range body.Operations {
		op, err := parseOperation(raw)
		if err != nil {
			return nil, err
		}
		ops[i] = op
	}
	return writeConfig(ctx, db, func(conn *sql.Conn, cfg *Config) error {
		id := strconv.Itoa(groupID)
		if groupID <= 0 {
			return fmt.Errorf("%w: invalid group ID", ErrInvalid)
		}
		if err := requireGroup(ctx, conn, id); err != nil {
			return err
		}
		group, ok := cfg.Groups[id]
		if !ok {
			group = DefaultGroup()
		}
		colors := readColors(group.Colors)
		for _, op := range ops {
			if err := colors.apply(ctx, conn, groupID, op); err != nil {
				return err
			}
		}
		if !colors.valid() {
			return fmt.Errorf("%w: invalid resulting colors", ErrInvalid)
		}
		group.Colors, _ = json.Marshal(colors)
		view, err := json.Marshal(group.View)
		if err != nil {
			return err
		}
		if _, err := conn.ExecContext(ctx, `INSERT INTO group_configs (group_id, view, colors) VALUES (?, ?, ?)
			ON CONFLICT(group_id) DO UPDATE SET colors = excluded.colors`, groupID, string(view), string(group.Colors)); err != nil {
			return err
		}
		cfg.Groups[id] = group
		return nil
	})
}

func (c *colorConfig) apply(ctx context.Context, conn *sql.Conn, groupID int, op colorOperation) error {
	if op.Type == "create_set" {
		var value *struct {
			ID   string  `json:"id"`
			Name *string `json:"name"`
		}
		if err := decode(op.Set, &value); err != nil || value == nil || strings.TrimSpace(value.ID) == "" || value.Name == nil {
			return fmt.Errorf("%w: set requires id and name", ErrInvalid)
		}
		if c.set(value.ID) != nil {
			if op.IfAbsent {
				return nil
			}
			return fmt.Errorf("%w: set %s", ErrConflict, value.ID)
		}
		c.Sets = append(c.Sets, colorSet{ID: value.ID, Name: value.Name, Pairs: []colorPair{}, MatchOrder: []string{}, ManualAssignments: map[string]string{}})
		if c.ActiveID == nil {
			c.ActiveID = &value.ID
		}
		return nil
	}
	if op.Type == "clear_assignments" {
		var ids []int
		if err := decode(op.IDs, &ids); err != nil || ids == nil {
			return fmt.Errorf("%w: ids must be an array", ErrInvalid)
		}
		for _, id := range ids {
			if id <= 0 {
				return fmt.Errorf("%w: invalid illustration ID", ErrInvalid)
			}
			for i := range c.Sets {
				delete(c.Sets[i].ManualAssignments, strconv.Itoa(id))
			}
		}
		return nil
	}
	if strings.TrimSpace(op.SetID) == "" {
		return fmt.Errorf("%w: set_id is required", ErrInvalid)
	}
	set := c.set(op.SetID)
	if set == nil {
		if op.Type == "delete_set" || op.Type == "delete_pair" {
			return nil
		}
		return fmt.Errorf("%w: set %s", ErrColorNotFound, op.SetID)
	}
	switch op.Type {
	case "delete_set":
		c.Sets = slices.DeleteFunc(c.Sets, func(set colorSet) bool { return set.ID == op.SetID })
		if c.ActiveID != nil && *c.ActiveID == op.SetID {
			c.ActiveID = nil
			if len(c.Sets) != 0 {
				id := c.Sets[0].ID
				c.ActiveID = &id
			}
		}
	case "set_active":
		c.ActiveID = &op.SetID
	case "update_set":
		var changes *struct {
			Name *string `json:"name"`
		}
		if err := decode(op.Changes, &changes); err != nil || changes == nil || changes.Name == nil {
			return fmt.Errorf("%w: set changes require name", ErrInvalid)
		}
		set.Name = changes.Name
	case "create_pair":
		var pair *colorPair
		if err := decode(op.Pair, &pair); err != nil || pair == nil || !pair.valid() {
			return fmt.Errorf("%w: invalid color group", ErrInvalid)
		}
		if set.pair(pair.ID) != nil {
			return fmt.Errorf("%w: pair %s", ErrConflict, pair.ID)
		}
		set.Pairs = append(set.Pairs, *pair)
		set.MatchOrder = append(set.MatchOrder, pair.ID)
	case "update_pair":
		pair := set.pair(op.PairID)
		if pair == nil {
			return fmt.Errorf("%w: pair %s", ErrColorNotFound, op.PairID)
		}
		if err := updatePair(pair, op.Changes); err != nil {
			return err
		}
	case "delete_pair":
		if strings.TrimSpace(op.PairID) == "" {
			return fmt.Errorf("%w: pair_id is required", ErrInvalid)
		}
		set.Pairs = slices.DeleteFunc(set.Pairs, func(pair colorPair) bool { return pair.ID == op.PairID })
		set.MatchOrder = slices.DeleteFunc(set.MatchOrder, func(id string) bool { return id == op.PairID })
		for imageID, pairID := range set.ManualAssignments {
			if pairID == op.PairID {
				delete(set.ManualAssignments, imageID)
			}
		}
	case "reorder_pairs", "reorder_rules":
		current := set.MatchOrder
		if op.Type == "reorder_pairs" {
			current = make([]string, len(set.Pairs))
			for i, pair := range set.Pairs {
				current[i] = pair.ID
			}
		}
		order, err := orderedIDs(op.IDs, current)
		if err != nil {
			return err
		}
		if op.Type == "reorder_rules" {
			set.MatchOrder = order
		} else {
			pairs := make([]colorPair, len(order))
			for i, id := range order {
				pairs[i] = *set.pair(id)
			}
			set.Pairs = pairs
		}
	case "assign":
		if op.Assignments == nil {
			return fmt.Errorf("%w: assignments must be an object", ErrInvalid)
		}
		for imageID, pairID := range op.Assignments {
			if !ValidGroupID(imageID) {
				return fmt.Errorf("%w: invalid illustration ID", ErrInvalid)
			}
			if pairID == nil {
				delete(set.ManualAssignments, imageID)
				continue
			}
			if set.pair(*pairID) == nil {
				return fmt.Errorf("%w: pair %s", ErrColorNotFound, *pairID)
			}
			var exists bool
			if err := conn.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM illustrations WHERE id = ? AND group_id = ?)", imageID, groupID).Scan(&exists); err != nil {
				return err
			}
			if !exists {
				return fmt.Errorf("%w: illustration %s", ErrColorNotFound, imageID)
			}
			set.ManualAssignments[imageID] = *pairID
		}
	}
	return nil
}

func updatePair(pair *colorPair, raw json.RawMessage) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || len(fields) == 0 {
		return fmt.Errorf("%w: changes must be a nonempty object", ErrInvalid)
	}
	for key, value := range fields {
		if !slices.Contains([]string{"customName", "color", "borderColor", "terms"}, key) || string(value) == "null" {
			return fmt.Errorf("%w: invalid color-group field %s", ErrInvalid, key)
		}
	}
	if err := decode(raw, pair); err != nil || !pair.valid() {
		return fmt.Errorf("%w: invalid color-group changes", ErrInvalid)
	}
	return nil
}

func orderedIDs(raw json.RawMessage, current []string) ([]string, error) {
	var supplied []string
	if err := decode(raw, &supplied); err != nil || supplied == nil {
		return nil, fmt.Errorf("%w: ids must be an array", ErrInvalid)
	}
	seen := map[string]bool{}
	order := make([]string, 0, len(current))
	for _, id := range supplied {
		if strings.TrimSpace(id) == "" || seen[id] {
			return nil, fmt.Errorf("%w: duplicate or empty ordering ID", ErrInvalid)
		}
		seen[id] = true
		if slices.Contains(current, id) {
			order = append(order, id)
		}
	}
	for _, id := range current {
		if !seen[id] {
			order = append(order, id)
		}
	}
	return order, nil
}
