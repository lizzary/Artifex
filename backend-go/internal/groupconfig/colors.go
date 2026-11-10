package groupconfig

import (
	"encoding/json"
	"slices"
	"strings"
)

type colorTerm struct {
	Value    *string `json:"value"`
	Scope    string  `json:"scope"`
	Operator string  `json:"operator"`
	Negated  *bool   `json:"negated"`
	Open     *int    `json:"open"`
	Close    *int    `json:"close"`
}

type colorPair struct {
	ID          string      `json:"id"`
	CustomName  *string     `json:"customName"`
	Terms       []colorTerm `json:"terms"`
	Color       string      `json:"color"`
	BorderColor string      `json:"borderColor"`
}

type colorSet struct {
	ID                string            `json:"id"`
	Name              *string           `json:"name"`
	Pairs             []colorPair       `json:"pairs"`
	MatchOrder        []string          `json:"match_order"`
	ManualAssignments map[string]string `json:"manual_assignments"`
}

type colorConfig struct {
	Sets     []colorSet `json:"sets"`
	ActiveID *string    `json:"active_id"`
}

func emptyColorConfig() colorConfig { return colorConfig{Sets: []colorSet{}} }

func validTerms(terms []colorTerm) bool {
	if terms == nil {
		return false
	}
	depth := 0
	for _, term := range terms {
		if term.Value == nil || strings.TrimSpace(*term.Value) == "" ||
			!slices.Contains([]string{"all", "tag", "prompt"}, term.Scope) ||
			!slices.Contains([]string{"and", "or"}, term.Operator) || term.Negated == nil ||
			term.Open == nil || term.Close == nil || *term.Open < 0 || *term.Open > 4 ||
			*term.Close < 0 || *term.Close > 4 {
			return false
		}
		depth += *term.Open - *term.Close
		if depth < 0 {
			return false
		}
	}
	return depth == 0
}

func (p colorPair) valid() bool {
	return strings.TrimSpace(p.ID) != "" && p.CustomName != nil && validTerms(p.Terms) &&
		validColor(p.Color) && validColor(p.BorderColor)
}

func (c colorConfig) valid() bool {
	if c.Sets == nil {
		return false
	}
	setIDs := map[string]bool{}
	for _, set := range c.Sets {
		if strings.TrimSpace(set.ID) == "" || setIDs[set.ID] || set.Name == nil ||
			set.Pairs == nil || set.MatchOrder == nil || set.ManualAssignments == nil {
			return false
		}
		setIDs[set.ID] = true
		pairIDs := map[string]bool{}
		for _, pair := range set.Pairs {
			if !pair.valid() || pairIDs[pair.ID] {
				return false
			}
			pairIDs[pair.ID] = true
		}
		if len(set.MatchOrder) != len(pairIDs) {
			return false
		}
		seen := map[string]bool{}
		for _, id := range set.MatchOrder {
			if !pairIDs[id] || seen[id] {
				return false
			}
			seen[id] = true
		}
		for imageID, pairID := range set.ManualAssignments {
			// An empty override explicitly puts the illustration in the ungrouped bucket.
			if !ValidGroupID(imageID) || (pairID != "" && !pairIDs[pairID]) {
				return false
			}
		}
	}
	if len(c.Sets) == 0 {
		return c.ActiveID == nil
	}
	return c.ActiveID != nil && setIDs[*c.ActiveID]
}

func readColors(raw json.RawMessage) colorConfig {
	var config colorConfig
	if json.Unmarshal(raw, &config) != nil || !config.valid() {
		return emptyColorConfig()
	}
	return config
}

// Missing or invalid persisted colors are empty. Only the current schema is read.
func NormalizeColors(raw json.RawMessage) json.RawMessage {
	value, _ := json.Marshal(readColors(raw))
	return value
}

func (c *colorConfig) set(id string) *colorSet {
	for i := range c.Sets {
		if c.Sets[i].ID == id {
			return &c.Sets[i]
		}
	}
	return nil
}

func (s *colorSet) pair(id string) *colorPair {
	for i := range s.Pairs {
		if s.Pairs[i].ID == id {
			return &s.Pairs[i]
		}
	}
	return nil
}
