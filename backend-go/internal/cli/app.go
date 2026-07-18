package cli

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"artifex-backend/internal/applog"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

type BootResult struct {
	URL            string
	DatabasePath   string
	FrontendReady  bool
	TaggerStatus   string
	TaggerWarning  bool
	TaggerDisabled bool
	Err            error
}

type Config struct {
	Version      string
	Theme        ThemeMode
	ConfigPath   string
	PortAttempts int
	Log          *applog.Hub
	Bootstrap    func() BootResult
	OpenURL      func(string) error
}

type screen uint8

const (
	homeScreen screen = iota
	logScreen
)

type tickMsg time.Time
type openResultMsg struct{ err error }

type model struct {
	cfg          Config
	palette      palette
	detectedDark bool
	mode         ThemeMode
	screen       screen
	width        int
	height       int
	input        string
	notice       string
	booting      bool
	result       BootResult
	spinner      int
	logOffset    int
	followLogs   bool
	levelFilter  int
	lastLogCount int
	portAttempts int
}

func Run(cfg Config) error {
	if cfg.Log == nil {
		cfg.Log = applog.Default()
	}
	if cfg.Version == "" {
		cfg.Version = "dev"
	}
	if cfg.Bootstrap == nil {
		cfg.Bootstrap = func() BootResult { return BootResult{} }
	}
	if cfg.PortAttempts < 1 || cfg.PortAttempts > MaxPortAttempts {
		cfg.PortAttempts = DefaultPortAttempts
	}

	dark := DetectDark(cfg.Theme)
	m := &model{
		cfg:          cfg,
		palette:      newPalette(dark),
		detectedDark: dark,
		mode:         cfg.Theme,
		width:        80,
		height:       24,
		booting:      true,
		followLogs:   true,
		portAttempts: cfg.PortAttempts,
	}
	_, err := tea.NewProgram(m).Run()
	return err
}

func (m *model) Init() tea.Cmd {
	return tea.Batch(
		m.tick(),
		func() tea.Msg { return m.cfg.Bootstrap() },
	)
}

func (m *model) tick() tea.Cmd {
	return tea.Tick(120*time.Millisecond, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = max(36, msg.Width)
		m.height = max(12, msg.Height)
		return m, nil
	case BootResult:
		m.booting = false
		m.result = msg
		if msg.Err != nil {
			m.notice = "Use /log to inspect the startup details."
		}
		return m, nil
	case tickMsg:
		m.spinner = (m.spinner + 1) % 4
		count := len(m.cfg.Log.Snapshot())
		if !m.followLogs && count > m.lastLogCount {
			m.logOffset += count - m.lastLogCount
		}
		m.lastLogCount = count
		return m, m.tick()
	case openResultMsg:
		if msg.err != nil {
			m.notice = "Could not open the browser: " + msg.err.Error()
		} else {
			m.notice = "Opened the gallery in your browser."
		}
		return m, nil
	case tea.KeyPressMsg:
		return m.handleKey(msg)
	default:
		return m, nil
	}
}

func (m *model) handleKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	key := msg.Key()
	if msg.String() == "ctrl+c" {
		return m, tea.Quit
	}

	if m.screen == logScreen && m.input == "" {
		switch key.Code {
		case tea.KeyEscape:
			m.screen = homeScreen
			return m, tea.ClearScreen
		case tea.KeyUp:
			m.followLogs = false
			m.logOffset++
			return m, nil
		case tea.KeyDown:
			m.logOffset = max(0, m.logOffset-1)
			m.followLogs = m.logOffset == 0
			return m, nil
		case tea.KeyPgUp:
			m.followLogs = false
			m.logOffset += max(3, m.logBodyHeight()-2)
			return m, nil
		case tea.KeyPgDown:
			m.logOffset = max(0, m.logOffset-max(3, m.logBodyHeight()-2))
			m.followLogs = m.logOffset == 0
			return m, nil
		case tea.KeyEnd:
			m.logOffset = 0
			m.followLogs = true
			return m, nil
		}

		switch key.Text {
		case "f":
			m.followLogs = !m.followLogs
			if m.followLogs {
				m.logOffset = 0
			}
			return m, nil
		case "1", "2", "3", "4":
			m.levelFilter = int(key.Text[0] - '1')
			m.logOffset = 0
			m.followLogs = true
			return m, nil
		}
	}

	switch key.Code {
	case tea.KeyEnter:
		command := strings.TrimSpace(m.input)
		m.input = ""
		return m.execute(command)
	case tea.KeyBackspace, tea.KeyDelete:
		if m.input != "" {
			_, size := utf8.DecodeLastRuneInString(m.input)
			m.input = m.input[:len(m.input)-size]
		}
		return m, nil
	case tea.KeyEscape:
		if m.input != "" {
			m.input = ""
		} else if m.screen == logScreen {
			m.screen = homeScreen
			return m, tea.ClearScreen
		}
		return m, nil
	default:
		if key.Text != "" && key.Mod == 0 {
			m.input += key.Text
		}
		return m, nil
	}
}

func (m *model) execute(command string) (tea.Model, tea.Cmd) {
	if command == "" {
		return m, nil
	}
	parts := strings.Fields(command)
	switch strings.ToLower(parts[0]) {
	case "/log":
		m.screen = logScreen
		m.followLogs = true
		m.logOffset = 0
		return m, nil
	case "/home":
		m.screen = homeScreen
		return m, tea.ClearScreen
	case "/help":
		m.notice = "/log  /status  /theme auto|dark|light  /port-attempts 1-65536  /open  /home  /quit"
	case "/status":
		m.notice = m.statusText()
	case "/port-attempts":
		if len(parts) != 2 {
			m.notice = "Choose /port-attempts followed by a number from 1 to 65536."
			return m, nil
		}
		attempts, err := ParsePortAttempts(parts[1])
		if err != nil {
			m.notice = err.Error()
			return m, nil
		}
		if err := SavePortAttempts(m.cfg.ConfigPath, attempts); err != nil {
			m.notice = "Could not save the port attempt limit: " + err.Error()
			return m, nil
		}
		m.portAttempts = attempts
		m.notice = fmt.Sprintf("Port attempt limit set to %d. It will apply after restart.", attempts)
	case "/theme":
		if len(parts) != 2 {
			m.notice = "Choose /theme auto, /theme dark, or /theme light."
			return m, nil
		}
		mode, err := ParseTheme(parts[1])
		if err != nil {
			m.notice = err.Error()
			return m, nil
		}
		m.mode = mode
		dark := m.detectedDark
		if mode == ThemeDark {
			dark = true
		} else if mode == ThemeLight {
			dark = false
		}
		m.palette = newPalette(dark)
		if err := SaveTheme(m.cfg.ConfigPath, mode); err != nil {
			m.notice = "Theme changed for this session; saving failed: " + err.Error()
		} else {
			m.notice = "Terminal appearance set to " + string(mode) + "."
		}
	case "/open":
		if m.booting || m.result.URL == "" {
			m.notice = "The gallery is not ready yet."
			return m, nil
		}
		if m.cfg.OpenURL == nil {
			m.notice = "Open " + m.result.URL + " in your browser."
			return m, nil
		}
		m.notice = "Opening the gallery..."
		url := m.result.URL
		return m, func() tea.Msg { return openResultMsg{err: m.cfg.OpenURL(url)} }
	case "/quit", "/exit":
		return m, tea.Quit
	default:
		m.notice = "Unknown command. Type /help to see the available commands."
	}
	return m, nil
}

func (m *model) View() tea.View {
	content := m.renderHome()
	altScreen := false
	if m.screen == logScreen {
		content = m.renderLogs()
		altScreen = true
	}
	view := tea.NewView(content)
	view.AltScreen = altScreen
	view.WindowTitle = "Artifex"
	return view
}

func (m *model) renderHome() string {
	p := m.palette
	panelWidth := min(118, max(36, m.width-2))
	wide := panelWidth >= 88
	leftWidth := panelWidth - 2
	if wide {
		leftWidth = 38
	}

	art := strings.Split(renderFrameCrab(p), "\n")
	artWidth := 0
	for _, line := range art {
		artWidth = max(artWidth, lipgloss.Width(line))
	}
	leftLines := []string{
		centerCell(p.textStyle().Bold(true).Render("Welcome to Artifex"), leftWidth),
		"",
	}
	for _, line := range art {
		leftLines = append(leftLines, centerCell(fitCell(line, artWidth), leftWidth))
	}
	leftLines = append(leftLines,
		"",
		centerCell(p.secondaryStyle().Render("Frame Crab keeps your art local"), leftWidth),
		centerCell(p.mutedStyle().Render("terminal theme · "+string(m.mode)), leftWidth),
	)

	statusLines := m.homeStatusLines()
	actionLines := m.homeActionLines()
	panel := renderStackedPanel(p, panelWidth, m.cfg.Version, leftLines, statusLines, actionLines)
	if wide {
		panel = renderWidePanel(p, panelWidth, m.cfg.Version, leftLines, statusLines, actionLines)
	}

	parts := []string{panel}
	if m.notice != "" {
		parts = append(parts, "", p.secondaryStyle().Render(m.notice))
	}
	if suggestions := m.commandSuggestions(); suggestions != "" {
		parts = append(parts, "", suggestions)
	}
	parts = append(parts, "", m.renderPrompt(), p.mutedStyle().Render("/log logs   /theme appearance   /help commands   Ctrl+C quit"))
	return strings.Join(parts, "\n")
}

func (m *model) homeStatusLines() []string {
	p := m.palette
	lines := []string{p.accentStyle().Bold(true).Render("STATUS")}
	if m.booting {
		spinners := []string{"◒", "◐", "◓", "◑"}
		lines = append(lines, p.accentStyle().Render(spinners[m.spinner])+" Preparing the gallery")
		entries := m.cfg.Log.Snapshot()
		start := max(0, len(entries)-2)
		for _, entry := range entries[start:] {
			lines = append(lines, p.mutedStyle().Render(entry.Message))
		}
		return lines
	}
	if m.result.Err != nil {
		return append(lines,
			p.dangerStyle().Bold(true).Render("■ Startup failed"),
			p.secondaryStyle().Render(m.result.Err.Error()),
		)
	}

	lines = append(lines,
		p.successStyle().Render("■")+" Gallery server ready",
		p.successStyle().Render("■")+" Database connected",
	)
	if m.result.TaggerDisabled {
		lines = append(lines, p.mutedStyle().Render("■")+" Auto-tagger "+m.result.TaggerStatus)
	} else if m.result.TaggerWarning {
		lines = append(lines, p.warningStyle().Render("■")+" Auto-tagger "+m.result.TaggerStatus)
	} else {
		lines = append(lines, p.successStyle().Render("■")+" Auto-tagger "+m.result.TaggerStatus)
	}
	if !m.result.FrontendReady {
		lines = append(lines, p.warningStyle().Render("■")+" Frontend files not found")
	}
	return lines
}

func (m *model) homeActionLines() []string {
	p := m.palette
	lines := []string{p.accentStyle().Bold(true).Render("GET STARTED")}
	if m.booting {
		return append(lines, p.secondaryStyle().Render("The gallery URL will appear when startup finishes."))
	}
	if m.result.Err != nil {
		return append(lines,
			p.secondaryStyle().Render("Run /log to inspect the startup details."),
			p.mutedStyle().Render("Fix the reported issue, then restart Artifex."),
		)
	}
	return append(lines,
		p.secondaryStyle().Render("Open this address in your browser:"),
		p.textStyle().Underline(true).Render(m.result.URL),
		"",
		p.mutedStyle().Render("Run /open to launch it automatically."),
	)
}

func renderWidePanel(p palette, width int, version string, left, status, actions []string) string {
	const ruleMarker = "\x00rule"
	leftWidth := 38
	rightWidth := width - leftWidth - 3
	right := append(append(append([]string{}, status...), ruleMarker), actions...)
	rowCount := max(len(left), len(right))
	border := p.accentStyle()
	rows := []string{panelHeader(p, width, version)}

	for index := 0; index < rowCount; index++ {
		leftCell := ""
		if index < len(left) {
			leftCell = left[index]
		}
		if index < len(right) && right[index] == ruleMarker {
			rows = append(rows,
				border.Render("│")+fitCell(leftCell, leftWidth)+
					border.Render("├"+strings.Repeat("─", rightWidth)+"┤"),
			)
			continue
		}
		rightCell := ""
		if index < len(right) {
			rightCell = right[index]
		}
		rows = append(rows,
			border.Render("│")+fitCell(leftCell, leftWidth)+
				border.Render("│")+fitCell(rightCell, rightWidth)+border.Render("│"),
		)
	}
	rows = append(rows, border.Render("╰"+strings.Repeat("─", leftWidth)+"┴"+strings.Repeat("─", rightWidth)+"╯"))
	return strings.Join(rows, "\n")
}

func renderStackedPanel(p palette, width int, version string, sections ...[]string) string {
	innerWidth := width - 2
	border := p.accentStyle()
	rows := []string{panelHeader(p, width, version)}
	for sectionIndex, section := range sections {
		if sectionIndex > 0 {
			rows = append(rows, border.Render("├"+strings.Repeat("─", innerWidth)+"┤"))
		}
		for _, line := range section {
			rows = append(rows, border.Render("│")+fitCell(line, innerWidth)+border.Render("│"))
		}
	}
	rows = append(rows, border.Render("╰"+strings.Repeat("─", innerWidth)+"╯"))
	return strings.Join(rows, "\n")
}

func panelHeader(p palette, width int, version string) string {
	border := p.accentStyle()
	label := p.accentStyle().Bold(true).Render("ARTIFEX") + p.mutedStyle().Render(" "+version)
	ruleWidth := max(1, width-lipgloss.Width(label)-5)
	return border.Render("╭─ ") + label + " " + border.Render(strings.Repeat("─", ruleWidth)+"╮")
}

func fitCell(value string, width int) string {
	value = ansi.Truncate(value, max(1, width), "…")
	return value + strings.Repeat(" ", max(0, width-lipgloss.Width(value)))
}

func centerCell(value string, width int) string {
	value = ansi.Truncate(value, max(1, width), "…")
	padding := max(0, width-lipgloss.Width(value))
	left := padding / 2
	return strings.Repeat(" ", left) + value + strings.Repeat(" ", padding-left)
}

func (m *model) renderLogs() string {
	p := m.palette
	filterNames := []string{"ALL", "INFO", "WARN", "ERROR"}
	follow := "paused"
	if m.followLogs {
		follow = "following"
	}
	header := p.accentStyle().Bold(true).Render("ARTIFEX / LOGS") +
		p.mutedStyle().Render(fmt.Sprintf("   %s · %s", filterNames[m.levelFilter], follow))
	help := p.mutedStyle().Render("↑↓ scroll  PgUp/PgDn page  End latest  f follow  1–4 filter  Esc home")
	divider := p.mutedStyle().Render(strings.Repeat("─", max(1, m.width)))

	entries := m.filteredEntries()
	bodyHeight := m.logBodyHeight()
	maxOffset := max(0, len(entries)-bodyHeight)
	m.logOffset = min(m.logOffset, maxOffset)
	start := max(0, len(entries)-bodyHeight-m.logOffset)
	end := min(len(entries), start+bodyHeight)

	body := make([]string, 0, bodyHeight)
	for _, entry := range entries[start:end] {
		body = append(body, m.renderLogEntry(entry))
	}
	for len(body) < bodyHeight {
		body = append(body, "")
	}

	return strings.Join([]string{
		header,
		help,
		divider,
		strings.Join(body, "\n"),
		m.renderPrompt(),
	}, "\n")
}

func (m *model) renderLogEntry(entry applog.Entry) string {
	p := m.palette
	levelStyle := p.successStyle()
	if entry.Level == applog.LevelWarn {
		levelStyle = p.warningStyle()
	} else if entry.Level == applog.LevelError {
		levelStyle = p.dangerStyle()
	}
	line := p.mutedStyle().Render(entry.Time.Format("15:04:05")) + " " +
		levelStyle.Bold(true).Render(fmt.Sprintf("%-5s", entry.Level.String())) + " " +
		p.secondaryStyle().Render(fmt.Sprintf("%-9s", entry.Scope)) + " " +
		p.textStyle().Render(entry.Message)
	return ansi.Truncate(line, max(1, m.width), "…")
}

func (m *model) filteredEntries() []applog.Entry {
	entries := m.cfg.Log.Snapshot()
	if m.levelFilter == 0 {
		return entries
	}
	level := applog.LevelInfo
	if m.levelFilter == 2 {
		level = applog.LevelWarn
	} else if m.levelFilter == 3 {
		level = applog.LevelError
	}
	filtered := make([]applog.Entry, 0, len(entries))
	for _, entry := range entries {
		if entry.Level == level {
			filtered = append(filtered, entry)
		}
	}
	return filtered
}

func (m *model) logBodyHeight() int {
	return max(3, m.height-5)
}

func (m *model) renderPrompt() string {
	cursor := "▌"
	if m.spinner%2 == 0 {
		cursor = " "
	}
	return m.palette.accentStyle().Bold(true).Render("›") + " " +
		m.palette.textStyle().Render(m.input) + m.palette.accentStyle().Render(cursor)
}

func (m *model) commandSuggestions() string {
	if !strings.HasPrefix(m.input, "/") || strings.Contains(m.input, " ") {
		return ""
	}
	commands := []string{"/help", "/home", "/log", "/open", "/port-attempts", "/quit", "/status", "/theme"}
	matches := make([]string, 0, len(commands))
	for _, command := range commands {
		if strings.HasPrefix(command, strings.ToLower(m.input)) {
			matches = append(matches, command)
		}
	}
	sort.Strings(matches)
	if len(matches) == 0 {
		return ""
	}
	return m.palette.mutedStyle().Render(strings.Join(matches, "   "))
}

func (m *model) statusText() string {
	if m.booting {
		return "Artifex is still starting."
	}
	if m.result.Err != nil {
		return "Startup failed: " + m.result.Err.Error()
	}
	return fmt.Sprintf(
		"Server %s · Database %s · Tagger %s · Theme %s · Port attempts %d",
		m.result.URL,
		filepath.Base(m.result.DatabasePath),
		m.result.TaggerStatus,
		m.mode,
		m.portAttempts,
	)
}
