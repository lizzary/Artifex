package main

import (
	"fmt"
	"os"
	"regexp"
	"strings"
	"unicode/utf8"

	tea "github.com/charmbracelet/bubbletea"
)

// model only tracks the current terminal size so the sprite can stay centered.
type model struct {
	width  int
	height int
}

func (model) Init() tea.Cmd {
	return nil
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height

	case tea.KeyMsg:
		switch msg.String() {
		case "q", "esc", "ctrl+c":
			return m, tea.Quit
		}
	}

	return m, nil
}

func (m model) View() string {
	return centerSprite(FrameCrab, m.width, m.height)
}

var ansiSGR = regexp.MustCompile(`\x1b\[[0-9;]*m`)

func centerSprite(sprite string, terminalWidth, terminalHeight int) string {
	lines := strings.Split(sprite, "\n")

	spriteWidth := 0
	for _, line := range lines {
		width := visibleWidth(line)
		if width > spriteWidth {
			spriteWidth = width
		}
	}

	leftPadding := nonNegative((terminalWidth - spriteWidth) / 2)
	topPadding := nonNegative((terminalHeight - len(lines)) / 2)

	var out strings.Builder
	out.Grow(len(sprite) + topPadding + leftPadding*len(lines))
	out.WriteString(strings.Repeat("\n", topPadding))

	for i, line := range lines {
		out.WriteString(strings.Repeat(" ", leftPadding))
		out.WriteString(line)
		if i < len(lines)-1 {
			out.WriteByte('\n')
		}
	}

	return out.String()
}

func visibleWidth(s string) int {
	plain := ansiSGR.ReplaceAllString(s, "")
	return utf8.RuneCountInString(plain)
}

func nonNegative(value int) int {
	if value < 0 {
		return 0
	}
	return value
}

func main() {
	program := tea.NewProgram(model{}, tea.WithAltScreen())
	if _, err := program.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "frame-crab:", err)
		os.Exit(1)
	}
}
