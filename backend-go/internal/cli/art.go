package cli

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/charmbracelet/x/ansi"
)

// Generated in D:\GoLand 2026.1.2\PROJECT\frame-crab-bubbletea by
// tools/image_to_quadrant.py. The source sprite is kept intact here and its
// palette is remapped at render time so it follows Artifex's terminal theme.
const frameCrabANSI = "    \x1b[38;2;124;92;224m▄██████████████▄\x1b[0m\n    \x1b[38;2;124;92;224m██\x1b[38;2;189;178;242m████████████\x1b[38;2;124;92;224m██\x1b[0m\n    \x1b[38;2;124;92;224m██\x1b[38;2;189;178;242m████████\x1b[38;2;124;92;224m██\x1b[38;2;189;178;242m██\x1b[38;2;124;92;224m██\x1b[0m\n    \x1b[38;2;124;92;224m██\x1b[38;2;189;178;242m██\x1b[38;2;124;92;224m██\x1b[38;2;189;178;242m████████\x1b[38;2;124;92;224m██\x1b[0m\n    \x1b[38;2;124;92;224m████████\x1b[38;2;189;178;242m████\x1b[38;2;199;111;62m███████▄▄\x1b[0m\n    \x1b[38;2;124;92;224m██████████\x1b[38;2;199;111;62m██\x1b[38;2;24;24;27m██\x1b[38;2;199;111;62m██\x1b[38;2;24;24;27m██\x1b[38;2;199;111;62m███\x1b[0m\n    \x1b[38;2;124;92;224m████████\x1b[38;2;199;111;62m██████████████\x1b[0m\n    \x1b[38;2;124;92;224m▀███████\x1b[38;2;199;111;62m█████████▀█████▄\x1b[0m\n    \x1b[38;2;199;111;62m▄████████▀█████▄\x1b[0m  \x1b[38;2;199;111;62m▀█████\x1b[0m\n    \x1b[38;2;199;111;62m█\x1b[0m \x1b[38;2;199;111;62m███\x1b[0m \x1b[38;2;199;111;62m██\x1b[0m   \x1b[38;2;199;111;62m▀███▀\x1b[0m     \x1b[38;2;199;111;62m▀▀\x1b[0m"

func renderFrameCrab(p palette, _ bool) string {
	if p.noColor {
		return ansi.Strip(frameCrabANSI)
	}

	return strings.NewReplacer(
		"\x1b[38;2;124;92;224m", foregroundSGR(p.accent),
		"\x1b[38;2;189;178;242m", foregroundSGR(p.picture),
		"\x1b[38;2;199;111;62m", foregroundSGR(p.crab),
		"\x1b[38;2;24;24;27m", foregroundSGR(p.eye),
	).Replace(frameCrabANSI)
}

func foregroundSGR(hex string) string {
	hex = strings.TrimPrefix(hex, "#")
	if len(hex) != 6 {
		return "\x1b[39m"
	}
	value, err := strconv.ParseUint(hex, 16, 24)
	if err != nil {
		return "\x1b[39m"
	}
	return fmt.Sprintf(
		"\x1b[38;2;%d;%d;%dm",
		(value>>16)&0xff,
		(value>>8)&0xff,
		value&0xff,
	)
}
