package server

import (
	"io/fs"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const diskUsageBasis = "allocated"

func regularFileDiskUsage(path string, info fs.FileInfo) (int64, error) {
	// The paths here are absolute and clean. Extend DOS and UNC paths as
	// needed since CreateFile is called directly rather than via os.Open.
	name := path
	if len(name) >= 248 && !strings.HasPrefix(name, `\\?\`) && !strings.HasPrefix(name, `\\.\`) {
		if strings.HasPrefix(name, `\\`) {
			name = `\\?\UNC\` + name[2:]
		} else {
			name = `\\?\` + name
		}
	}
	pathPtr, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return 0, err
	}
	handle, err := windows.CreateFile(pathPtr, windows.FILE_READ_ATTRIBUTES,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err == windows.ERROR_DELETE_PENDING {
		return 0, fs.ErrNotExist
	}
	if err != nil {
		return 0, &fs.PathError{Op: "measure disk usage", Path: path, Err: err}
	}
	defer windows.CloseHandle(handle)

	attributes := info.Sys().(*syscall.Win32FileAttributeData).FileAttributes
	if attributes&(windows.FILE_ATTRIBUTE_COMPRESSED|windows.FILE_ATTRIBUTE_SPARSE_FILE) != 0 {
		// FILE_COMPRESSION_INFO reports the backing bytes for these files.
		var compressed struct {
			Size int64
			_    [8]byte
		}
		err = windows.GetFileInformationByHandleEx(handle, windows.FileCompressionInfo,
			(*byte)(unsafe.Pointer(&compressed)), uint32(unsafe.Sizeof(compressed)))
		return compressed.Size, err
	}

	// FILE_STANDARD_INFO reports allocated bytes separately from end-of-file.
	var standard struct {
		AllocatedBytes int64
		_              [16]byte
	}
	err = windows.GetFileInformationByHandleEx(handle, windows.FileStandardInfo,
		(*byte)(unsafe.Pointer(&standard)), uint32(unsafe.Sizeof(standard)))
	return standard.AllocatedBytes, err
}
