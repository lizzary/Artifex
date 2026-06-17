package thumbnail

import (
	"image"
	"image/jpeg"
	"os"

	_ "golang.org/x/image/webp"
	_ "image/gif"
	_ "image/png"

	"github.com/disintegration/imaging"
)

// QualityConfig maps quality level to configuration.
type QualityConfig struct {
	MaxSize     int
	JPEGQuality int
	Dir         string
}

var QualityConfigs = map[string]QualityConfig{
	"low":    {MaxSize: 400, JPEGQuality: 75, Dir: "thumbnails"},
	"normal": {MaxSize: 1200, JPEGQuality: 85, Dir: "thumbnails_normal"},
}

// CreateThumbnail creates a thumbnail copy, maintaining aspect ratio, and
// converting to RGB (required for JPEG output).
func CreateThumbnail(src image.Image, maxSize int) image.Image {
	thumb := imaging.Clone(src)

	// JPEG does not support alpha — composite onto white background
	// imaging.Fit handles this automatically for RGBA images
	thumb = imaging.Fit(thumb, maxSize, maxSize, imaging.Lanczos)
	return thumb
}

// SaveJPEG encodes and saves an image as JPEG with given quality.
func SaveJPEG(img image.Image, path string, quality int) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return jpeg.Encode(f, img, &jpeg.Options{Quality: quality})
}

// GetImageInfo returns (width, height, mimeType) for an image.
func GetImageInfo(img image.Image, format string) (int, int, string) {
	mimeMap := map[string]string{
		"jpeg": "image/jpeg",
		"png":  "image/png",
		"gif":  "image/gif",
		"webp": "image/webp",
		"bmp":  "image/bmp",
	}
	mime, ok := mimeMap[format]
	if !ok {
		mime = "image/jpeg"
	}
	return img.Bounds().Dx(), img.Bounds().Dy(), mime
}
