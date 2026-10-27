package metadata

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"os"
)

// readImageMetadata identifies the container by its signature, not its filename.
func readImageMetadata(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := bufio.NewReader(f)
	signature, _ := r.Peek(12)
	if bytes.HasPrefix(signature, []byte("\x89PNG\r\n\x1a\n")) {
		return readPNGTextChunks(r)
	}
	if len(signature) == 12 && string(signature[:4]) == "RIFF" && string(signature[8:]) == "WEBP" {
		return readWebPTextChunks(r)
	}
	return nil, fmt.Errorf("unsupported image metadata container")
}

func readWebPTextChunks(r io.Reader) (map[string]string, error) {
	var header [12]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return nil, fmt.Errorf("read WebP header: %w", err)
	}
	if string(header[:4]) != "RIFF" || string(header[8:]) != "WEBP" {
		return nil, fmt.Errorf("invalid WebP signature")
	}
	remaining := int64(binary.LittleEndian.Uint32(header[4:8])) - 4
	if remaining < 0 {
		return nil, fmt.Errorf("invalid WebP size")
	}
	result := make(map[string]string)
	metadataBytes := 0
	for remaining > 0 {
		if remaining < 8 {
			return result, fmt.Errorf("truncated WebP chunk header")
		}
		if _, err := io.ReadFull(r, header[:8]); err != nil {
			return result, fmt.Errorf("read WebP chunk header: %w", err)
		}
		length := int64(binary.LittleEndian.Uint32(header[4:8]))
		padded := length + length%2
		remaining -= 8
		if padded > remaining {
			return result, fmt.Errorf("WebP chunk exceeds container size")
		}
		if string(header[:4]) == "EXIF" {
			if length > maxPNGTextChunkBytes || int64(metadataBytes)+length > maxPNGTextBytes {
				return result, fmt.Errorf("WebP EXIF exceeds metadata limits")
			}
			metadataBytes += int(length)
			data := make([]byte, int(length))
			if _, err := io.ReadFull(r, data); err != nil {
				return result, fmt.Errorf("read WebP EXIF: %w", err)
			}
			values, err := decodeComfyEXIF(data)
			if err != nil {
				return result, err
			}
			for key, value := range values {
				result[key] = value
			}
			if _, err := io.CopyN(io.Discard, r, length%2); err != nil {
				return result, fmt.Errorf("read WebP padding: %w", err)
			}
		} else if _, err := io.CopyN(io.Discard, r, padded); err != nil {
			return result, fmt.Errorf("read WebP chunk: %w", err)
		}
		remaining -= padded
	}
	return result, nil
}

// ComfyUI stores ASCII "prompt:<json>" and "workflow:<json>" values in
// the root EXIF directory. Tags for extra_pnginfo can move depending on its order,
// so identify these values by their prefix instead of assuming a fixed tag number.
// https://github.com/Comfy-Org/ComfyUI/blob/426f5eea52a7ece1dd599fff4cb6cd1f352ddd24/comfy_api/latest/_ui.py
func decodeComfyEXIF(data []byte) (map[string]string, error) {
	if bytes.HasPrefix(data, []byte("Exif\x00\x00")) {
		data = data[6:]
	}
	if len(data) < 8 {
		return nil, fmt.Errorf("truncated WebP TIFF header")
	}
	var order binary.ByteOrder
	switch string(data[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return nil, fmt.Errorf("invalid WebP TIFF byte order")
	}
	if order.Uint16(data[2:4]) != 42 {
		return nil, fmt.Errorf("invalid WebP TIFF signature")
	}
	result := make(map[string]string)
	offset := uint64(order.Uint32(data[4:8]))
	if offset == 0 {
		return result, nil
	}
	if offset+2 > uint64(len(data)) {
		return nil, fmt.Errorf("invalid WebP TIFF directory offset")
	}
	count := uint64(order.Uint16(data[offset : offset+2]))
	if offset+2+count*12+4 > uint64(len(data)) {
		return nil, fmt.Errorf("truncated WebP TIFF directory")
	}
	textBytes := 0
	for i := uint64(0); i < count; i++ {
		entry := data[offset+2+i*12 : offset+2+(i+1)*12]
		if order.Uint16(entry[2:4]) != 2 { // TIFF ASCII
			continue
		}
		length := uint64(order.Uint32(entry[4:8]))
		var value []byte
		if length <= 4 {
			value = entry[8 : 8+length]
		} else {
			start := uint64(order.Uint32(entry[8:12]))
			if start+length > uint64(len(data)) {
				return nil, fmt.Errorf("invalid WebP TIFF text offset")
			}
			value = data[start : start+length]
		}
		key := ""
		switch {
		case bytes.HasPrefix(value, []byte("prompt:")):
			key = "prompt"
		case bytes.HasPrefix(value, []byte("workflow:")):
			key = "workflow"
		default:
			// Unrelated EXIF fields can alias a large byte range. Do not copy or
			// scan those ranges repeatedly for each directory entry.
			continue
		}
		body := value[len(key)+1:]
		textBytes += len(body)
		if textBytes > maxPNGTextBytes {
			return nil, fmt.Errorf("WebP TIFF text exceeds metadata limits")
		}
		result[key] = string(bytes.TrimRight(body, "\x00"))
	}
	return result, nil
}
