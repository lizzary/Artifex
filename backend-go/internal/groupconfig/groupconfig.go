package groupconfig

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

type View struct {
	SortBy                 string `json:"sort_by"`
	SortOrder              string `json:"sort_order"`
	Quality                string `json:"quality"`
	CardSize               int    `json:"card_size"`
	OriginalRatio          bool   `json:"original_ratio"`
	GroupBy                string `json:"group_by"`
	PageSize               any    `json:"page_size"`
	ColorGroupLayout       string `json:"color_group_layout"`
	ColorGroupPreviewMode  string `json:"color_group_preview_mode"`
	ColorGroupPreviewLimit int    `json:"color_group_preview_limit"`
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
	return View{
		SortOrder: "desc", Quality: "low", CardSize: 3, GroupBy: "none", PageSize: 50,
		ColorGroupLayout: "single", ColorGroupPreviewMode: "all", ColorGroupPreviewLimit: 4,
	}
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
	if !slices.Contains([]string{"single", "double", "mixed"}, v.ColorGroupLayout) {
		return fmt.Errorf("invalid color_group_layout")
	}
	if v.ColorGroupPreviewMode != "all" && v.ColorGroupPreviewMode != "limited" {
		return fmt.Errorf("invalid color_group_preview_mode")
	}
	if v.ColorGroupPreviewLimit < 1 || v.ColorGroupPreviewLimit > 1000 {
		return fmt.Errorf("color_group_preview_limit must be between 1 and 1000")
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
