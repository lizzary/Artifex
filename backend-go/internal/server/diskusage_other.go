//go:build !windows && !linux && !darwin && !dragonfly && !freebsd && !netbsd && !openbsd

package server

import "io/fs"

const diskUsageBasis = "file_length"

func regularFileDiskUsage(_ string, info fs.FileInfo) (int64, error) {
	return info.Size(), nil
}
