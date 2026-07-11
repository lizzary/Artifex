package applog

import (
	"bytes"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"
)

// Level is the severity of an application log entry.
type Level uint8

const (
	LevelInfo Level = iota
	LevelWarn
	LevelError
)

func (l Level) String() string {
	switch l {
	case LevelWarn:
		return "WARN"
	case LevelError:
		return "ERROR"
	default:
		return "INFO"
	}
}

// Entry is a single structured application log entry.
type Entry struct {
	Sequence uint64
	Time     time.Time
	Level    Level
	Scope    string
	Message  string
}

// Hub stores recent logs for the interactive UI and can optionally mirror
// them to a traditional output stream for non-interactive runs.
type Hub struct {
	mu       sync.RWMutex
	entries  []Entry
	capacity int
	next     uint64
	mirror   io.Writer
}

func New(capacity int, mirror io.Writer) *Hub {
	if capacity < 1 {
		capacity = 1
	}
	return &Hub{capacity: capacity, mirror: mirror}
}

func (h *Hub) Log(level Level, scope, format string, args ...any) {
	if h == nil {
		return
	}
	message := strings.TrimSpace(fmt.Sprintf(format, args...))
	if message == "" {
		return
	}
	entry := Entry{
		Time:    time.Now(),
		Level:   level,
		Scope:   strings.TrimSpace(scope),
		Message: message,
	}

	h.mu.Lock()
	h.next++
	entry.Sequence = h.next
	if len(h.entries) == h.capacity {
		copy(h.entries, h.entries[1:])
		h.entries[len(h.entries)-1] = entry
	} else {
		h.entries = append(h.entries, entry)
	}
	mirror := h.mirror
	h.mu.Unlock()

	if mirror != nil {
		fmt.Fprintln(mirror, FormatPlain(entry))
	}
}

func (h *Hub) Info(scope, format string, args ...any) {
	h.Log(LevelInfo, scope, format, args...)
}

func (h *Hub) Warn(scope, format string, args ...any) {
	h.Log(LevelWarn, scope, format, args...)
}

func (h *Hub) Error(scope, format string, args ...any) {
	h.Log(LevelError, scope, format, args...)
}

// Snapshot returns a stable copy ordered from oldest to newest.
func (h *Hub) Snapshot() []Entry {
	if h == nil {
		return nil
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	entries := make([]Entry, len(h.entries))
	copy(entries, h.entries)
	return entries
}

func FormatPlain(entry Entry) string {
	scope := entry.Scope
	if scope == "" {
		scope = "app"
	}
	return fmt.Sprintf("%s %-5s %-9s %s", entry.Time.Format("15:04:05"), entry.Level, scope, entry.Message)
}

// Writer adapts traditional line-oriented log output to the structured hub.
func (h *Hub) Writer(scope string, level Level) io.Writer {
	return &lineWriter{hub: h, scope: scope, level: level}
}

type lineWriter struct {
	mu    sync.Mutex
	hub   *Hub
	scope string
	level Level
	buf   bytes.Buffer
}

func (w *lineWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	n, _ := w.buf.Write(p)
	for {
		line, err := w.buf.ReadString('\n')
		if err != nil {
			w.buf.WriteString(line)
			break
		}
		w.hub.Log(w.level, w.scope, "%s", strings.TrimSpace(line))
	}
	return n, nil
}

var (
	defaultMu  sync.RWMutex
	defaultHub = New(2000, nil)
)

func SetDefault(h *Hub) {
	if h == nil {
		return
	}
	defaultMu.Lock()
	defaultHub = h
	defaultMu.Unlock()
}

func Default() *Hub {
	defaultMu.RLock()
	defer defaultMu.RUnlock()
	return defaultHub
}

func Info(scope, format string, args ...any) {
	Default().Info(scope, format, args...)
}

func Warn(scope, format string, args ...any) {
	Default().Warn(scope, format, args...)
}

func Error(scope, format string, args ...any) {
	Default().Error(scope, format, args...)
}
