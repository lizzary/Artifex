package cli

import "strings"

// renderFrameCrab uses two terminal cells per source pixel so each block reads
// as a compact square instead of terminal line art.
func renderFrameCrab(p palette, compact bool) string {
	rows := []string{
		"..PPPPP.......",
		"..PSSSP.......",
		"..PSPSP.......",
		"..PSSSP...CC..",
		"..PPPPP.CCCCC.",
		".......CCKCKCC",
		"......CCCCCCCC",
		".......CC.CC..",
	}
	if compact {
		rows = []string{
			".PPPP.....",
			".PSSP..CC.",
			".PSSP.CCCC",
			".PPPPCKCKC",
			".....CCCCC",
			"......C.C.",
		}
	}

	styles := map[rune]func() string{
		'P': func() string { return p.accentStyle().Render("██") },
		'S': func() string { return p.pictureStyle().Render("██") },
		'C': func() string { return p.crabStyle().Render("██") },
		'K': func() string { return p.eyeStyle().Render("██") },
		'.': func() string { return "  " },
	}
	if p.noColor {
		styles['S'] = func() string { return "▓▓" }
		styles['K'] = func() string { return "  " }
	}

	var art strings.Builder
	for rowIndex, row := range rows {
		if rowIndex > 0 {
			art.WriteByte('\n')
		}
		for _, pixel := range row {
			if render, ok := styles[pixel]; ok {
				art.WriteString(render())
			}
		}
	}
	return strings.TrimRight(art.String(), " ")
}
