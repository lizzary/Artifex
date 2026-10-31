package groupconfig

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"artifex-backend/internal/settings"
)

type View struct {
	SortBy        string `json:"sort_by"`
	SortOrder     string `json:"sort_order"`
	Quality       string `json:"quality"`
	CardSize      int    `json:"card_size"`
	OriginalRatio bool   `json:"original_ratio"`
	GroupBy       string `json:"group_by"`
	PageSize      any    `json:"page_size"`
}

type Group struct {
	View   View            `json:"view"`
	Colors json.RawMessage `json:"colors"`
}

type Config struct {
	GroupOrder []int            `json:"group_order"`
	Groups     map[string]Group `json:"groups"`
}

func DefaultView() View {
	return View{SortOrder: "desc", Quality: "low", CardSize: 3, GroupBy: "none", PageSize: 50}
}
func EmptyColors() json.RawMessage { return json.RawMessage(`{"sets":[],"active_id":null}`) }
func DefaultGroup() Group          { return Group{View: DefaultView(), Colors: EmptyColors()} }
func New() *Config                 { return &Config{GroupOrder: []int{}, Groups: map[string]Group{}} }
func ValidGroupID(id string) bool {
	n, err := strconv.Atoi(id)
	return err == nil && n > 0 && strconv.Itoa(n) == id
}

func (v View) Validate() error {
	if !slices.Contains([]string{"", "resolution", "fileSize", "dateCreated"}, v.SortBy) {
		return fmt.Errorf("invalid sort_by")
	}
	if v.SortOrder != "asc" && v.SortOrder != "desc" {
		return fmt.Errorf("invalid sort_order")
	}
	if !slices.Contains([]string{"low", "normal", "original"}, v.Quality) {
		return fmt.Errorf("invalid quality")
	}
	if v.CardSize < 1 || v.CardSize > 5 {
		return fmt.Errorf("invalid card_size")
	}
	if v.GroupBy != "none" && v.GroupBy != "mixed" {
		return fmt.Errorf("invalid group_by")
	}
	switch n := v.PageSize.(type) {
	case string:
		if n == "all" {
			return nil
		}
	case int:
		if slices.Contains([]int{50, 100, 200, 500, 1000}, n) {
			return nil
		}
	case float64:
		if slices.Contains([]float64{50, 100, 200, 500, 1000}, n) {
			return nil
		}
	}
	return fmt.Errorf("invalid page_size")
}

var hexColor = regexp.MustCompile(`(?i)^#([0-9a-f]{3}|[0-9a-f]{6})$`)
var rgbColor = regexp.MustCompile(`(?i)^(rgb|rgba)\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d+(?:\.\d+)?|\.\d+)\s*)?\)$`)

func validColor(value string) bool {
	value = strings.TrimSpace(value)
	if hexColor.MatchString(value) {
		return true
	}
	parts := rgbColor.FindStringSubmatch(value)
	if parts == nil || (strings.EqualFold(parts[1], "rgba") != (parts[5] != "")) {
		return false
	}
	for _, channel := range parts[2:5] {
		n, _ := strconv.Atoi(channel)
		if n > 255 {
			return false
		}
	}
	if parts[5] != "" {
		alpha, err := strconv.ParseFloat(parts[5], 64)
		if err != nil || alpha > 1 {
			return false
		}
	}
	return true
}

// Missing or invalid colors are empty; validated values are encoded from the
// current schema so only fields used by the color-group editor are persisted.
func NormalizeColors(raw json.RawMessage) json.RawMessage {
	type term struct {
		Value    *string `json:"value"`
		Scope    string  `json:"scope"`
		Operator string  `json:"operator"`
		Negated  *bool   `json:"negated"`
		Open     *int    `json:"open"`
		Close    *int    `json:"close"`
	}
	type pair struct {
		ID          string  `json:"id"`
		CustomName  *string `json:"customName"`
		Terms       []term  `json:"terms"`
		Color       string  `json:"color"`
		BorderColor string  `json:"borderColor"`
	}
	type set struct {
		ID                string            `json:"id"`
		Name              *string           `json:"name"`
		Pairs             []pair            `json:"pairs"`
		MatchOrder        []string          `json:"match_order"`
		ManualAssignments map[string]string `json:"manual_assignments"`
	}
	var entry struct {
		Sets     []set   `json:"sets"`
		ActiveID *string `json:"active_id"`
	}
	if json.Unmarshal(raw, &entry) != nil || entry.Sets == nil {
		return EmptyColors()
	}
	ids := map[string]bool{}
	for _, s := range entry.Sets {
		if s.ID == "" || ids[s.ID] || s.Name == nil || s.Pairs == nil || s.MatchOrder == nil || s.ManualAssignments == nil {
			return EmptyColors()
		}
		ids[s.ID] = true
		pairs := map[string]bool{}
		for _, p := range s.Pairs {
			if p.ID == "" || pairs[p.ID] || p.CustomName == nil || p.Terms == nil || !validColor(p.Color) || !validColor(p.BorderColor) {
				return EmptyColors()
			}
			pairs[p.ID] = true
			depth := 0
			for _, t := range p.Terms {
				if t.Value == nil || strings.TrimSpace(*t.Value) == "" || !slices.Contains([]string{"all", "tag", "prompt"}, t.Scope) || !slices.Contains([]string{"and", "or"}, t.Operator) || t.Negated == nil || t.Open == nil || t.Close == nil || *t.Open < 0 || *t.Open > 4 || *t.Close < 0 || *t.Close > 4 {
					return EmptyColors()
				}
				depth += *t.Open - *t.Close
				if depth < 0 {
					return EmptyColors()
				}
			}
			if depth != 0 {
				return EmptyColors()
			}
		}
		if len(s.MatchOrder) != len(pairs) {
			return EmptyColors()
		}
		order := map[string]bool{}
		for _, id := range s.MatchOrder {
			if !pairs[id] || order[id] {
				return EmptyColors()
			}
			order[id] = true
		}
		for illustrationID, id := range s.ManualAssignments {
			if !ValidGroupID(illustrationID) || !pairs[id] {
				return EmptyColors()
			}
		}
	}
	if len(entry.Sets) == 0 {
		return EmptyColors()
	}
	if entry.ActiveID == nil || !ids[*entry.ActiveID] {
		return EmptyColors()
	}
	normalized, _ := json.Marshal(entry)
	return normalized
}

func Load(path string) (*Config, error) {
	cfg := New()
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return cfg, nil
	}
	if err != nil {
		return nil, err
	}
	var raw struct {
		GroupOrder []int                      `json:"group_order"`
		Groups     map[string]json.RawMessage `json:"groups"`
	}
	if json.Unmarshal(data, &raw) != nil {
		return cfg, nil
	}
	if raw.GroupOrder != nil {
		cfg.GroupOrder = raw.GroupOrder
	}
	for id, data := range raw.Groups {
		if !ValidGroupID(id) {
			continue
		}
		g := DefaultGroup()
		if json.Unmarshal(data, &g) != nil {
			g = DefaultGroup()
		}
		if g.View.Validate() != nil {
			g.View = DefaultView()
		}
		g.Colors = NormalizeColors(g.Colors)
		cfg.Groups[id] = g
	}
	return cfg, nil
}

func (c *Config) Patch(data []byte) error {
	var patch struct {
		GroupOrder *[]int                     `json:"group_order"`
		Groups     map[string]json.RawMessage `json:"groups"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&patch); err != nil {
		return err
	}
	if patch.GroupOrder != nil {
		c.GroupOrder = *patch.GroupOrder
		if c.GroupOrder == nil {
			c.GroupOrder = []int{}
		}
	}
	for id, raw := range patch.Groups {
		if !ValidGroupID(id) {
			return fmt.Errorf("invalid group ID")
		}
		if string(raw) == "null" {
			return fmt.Errorf("group configuration must be an object")
		}
		var fields struct {
			View   json.RawMessage `json:"view"`
			Colors json.RawMessage `json:"colors"`
		}
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&fields); err != nil {
			return err
		}
		g, ok := c.Groups[id]
		if !ok {
			g = DefaultGroup()
		}
		if fields.View != nil {
			decoder := json.NewDecoder(bytes.NewReader(fields.View))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&g.View); err != nil {
				return err
			}
			if err := g.View.Validate(); err != nil {
				return err
			}
		}
		if fields.Colors != nil {
			g.Colors = NormalizeColors(fields.Colors)
		}
		c.Groups[id] = g
	}
	return nil
}

func Save(path string, c *Config) error {
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return settings.WriteFile(path, data)
}
