package metadata

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"fmt"
	"hash/crc32"
	"io"
	"os"
)

// Limits apply to text only; image data is streamed without allocating a chunk-sized buffer.
const (
	maxPNGTextChunkBytes = 16 << 20
	maxPNGTextBytes      = 32 << 20
	maxPNGTextChunks     = 4096
)

// ReadPNGTextChunks reads PNG tEXt, zTXt, and iTXt chunks, including compressed
// international text. Invalid/truncated chunks and oversized metadata return an error.
// Reference: https://www.w3.org/TR/png-3/#11textinfo
func ReadPNGTextChunks(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return readPNGTextChunks(f)
}

func readPNGTextChunks(r io.Reader) (map[string]string, error) {
	var signature [8]byte
	if _, err := io.ReadFull(r, signature[:]); err != nil {
		return nil, fmt.Errorf("read PNG signature: %w", err)
	}
	if string(signature[:]) != "\x89PNG\r\n\x1a\n" {
		return nil, fmt.Errorf("invalid PNG signature")
	}
	result := make(map[string]string)
	textBytes, textChunks := 0, 0
	for {
		var header [8]byte
		if _, err := io.ReadFull(r, header[:]); err != nil {
			return result, fmt.Errorf("read PNG chunk header: %w", err)
		}
		length := binary.BigEndian.Uint32(header[:4])
		kind := string(header[4:])
		if length > 0x7fffffff {
			return result, fmt.Errorf("invalid PNG chunk length: %d", length)
		}
		isText := kind == "tEXt" || kind == "zTXt" || kind == "iTXt"
		if isText {
			textChunks++
			if length > maxPNGTextChunkBytes || textChunks > maxPNGTextChunks {
				return result, fmt.Errorf("PNG text exceeds metadata limits")
			}
		}
		checksum := crc32.NewIEEE()
		_, _ = checksum.Write(header[4:])
		var data []byte
		if isText {
			data = make([]byte, int(length))
			if _, err := io.ReadFull(r, data); err != nil {
				return result, fmt.Errorf("read PNG %s: %w", kind, err)
			}
			_, _ = checksum.Write(data)
		} else if _, err := io.CopyN(checksum, r, int64(length)); err != nil {
			return result, fmt.Errorf("read PNG %s: %w", kind, err)
		}
		var crc [4]byte
		if _, err := io.ReadFull(r, crc[:]); err != nil {
			return result, fmt.Errorf("read PNG %s checksum: %w", kind, err)
		}
		if checksum.Sum32() != binary.BigEndian.Uint32(crc[:]) {
			return result, fmt.Errorf("invalid PNG %s checksum", kind)
		}
		if isText {
			limit := min(maxPNGTextChunkBytes, maxPNGTextBytes-textBytes)
			key, value, err := decodePNGText(kind, data, limit)
			if err != nil {
				return result, fmt.Errorf("decode PNG %s: %w", kind, err)
			}
			textBytes += len(value)
			result[key] = value
		}
		if kind == "IEND" {
			if length != 0 {
				return result, fmt.Errorf("invalid PNG IEND length")
			}
			return result, nil
		}
	}
}

func decodePNGText(kind string, data []byte, limit int) (string, string, error) {
	separator := bytes.IndexByte(data, 0)
	if separator < 1 || separator > 79 {
		return "", "", fmt.Errorf("invalid text keyword")
	}
	key := pngLatin1(data[:separator])
	data = data[separator+1:]
	compressed := false
	switch kind {
	case "zTXt":
		if len(data) < 1 || data[0] != 0 {
			return "", "", fmt.Errorf("invalid text compression method")
		}
		compressed, data = true, data[1:]
	case "iTXt":
		if len(data) < 2 || data[0] > 1 || data[1] != 0 {
			return "", "", fmt.Errorf("invalid international text compression header")
		}
		compressed, data = data[0] == 1, data[2:]
		// The language tag and translated keyword are NUL-terminated fields.
		// Binary compression headers and compressed bytes are not delimiters.
		for range 2 {
			separator = bytes.IndexByte(data, 0)
			if separator < 0 {
				return "", "", fmt.Errorf("truncated international text header")
			}
			data = data[separator+1:]
		}
	}
	if compressed {
		reader, err := zlib.NewReader(bytes.NewReader(data))
		if err != nil {
			return "", "", err
		}
		defer reader.Close()
		data, err = io.ReadAll(io.LimitReader(reader, int64(limit)+1))
		if err != nil {
			return "", "", err
		}
	}
	if len(data) > limit {
		return "", "", fmt.Errorf("PNG text exceeds metadata limits")
	}
	value := string(data)
	if kind != "iTXt" {
		value = pngLatin1(data)
	}
	if len(value) > limit {
		return "", "", fmt.Errorf("PNG text exceeds metadata limits")
	}
	return key, value, nil
}

func pngLatin1(data []byte) string {
	for _, b := range data {
		if b >= 128 {
			runes := make([]rune, len(data))
			for i, c := range data {
				runes[i] = rune(c)
			}
			return string(runes)
		}
	}
	return string(data)
}
