//go:build linux || darwin || dragonfly || freebsd || netbsd || openbsd

package server

import (
	"io/fs"
	"syscall"
)

const diskUsageBasis = "allocated"

func regularFileDiskUsage(_ string, info fs.FileInfo) (int64, error) {
	stat := info.Sys().(*syscall.Stat_t)
	return int64(stat.Blocks) * 512, nil
}
