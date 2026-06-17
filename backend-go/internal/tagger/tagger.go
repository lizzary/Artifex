package tagger

import (
	"encoding/csv"
	"fmt"
	"image"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	ort "github.com/yalue/onnxruntime_go"
)

// ImageNet normalization constants (for ViT tagger preprocessing)
var imagenetMean = []float32{0.485, 0.456, 0.406}
var imagenetStd = []float32{0.229, 0.224, 0.225}

const taggerInputSize = 448

// Tag category indices
const (
	ratingCategory    = 9
	generalCategory   = 0
	characterCategory = 4
)

const (
	defaultGeneralThresh   = 0.35
	defaultCharacterThresh = 0.75
)

// Module-level tagger cache
var (
	taggerSession    *ort.DynamicAdvancedSession
	taggerTagNames   []string
	taggerRatingIdx  []int
	taggerGeneralIdx []int
	taggerCharIdx    []int
	taggerMu         sync.Mutex
)

func clearTaggerCache() {
	taggerMu.Lock()
	defer taggerMu.Unlock()
	clearTaggerCacheLocked()
}

// clearTaggerCacheLocked assumes taggerMu is already held.
func clearTaggerCacheLocked() {
	if taggerSession != nil {
		taggerSession.Destroy()
		taggerSession = nil
	}
	taggerTagNames = nil
	taggerRatingIdx = nil
	taggerGeneralIdx = nil
	taggerCharIdx = nil
}

// LoadTagger initializes the ONNX Runtime session for the active model.
func LoadTagger(modelsDir string) error {
	taggerMu.Lock()
	defer taggerMu.Unlock()

	clearTaggerCacheLocked()

	modelMu.RLock()
	active := activeModel
	gpu := useGPU
	modelMu.RUnlock()

	var onnxPath, labelsPath string
	defaultDir := filepath.Join(modelsDir, "default")
	userDir := filepath.Join(modelsDir, "user_model")

	if active != "" {
		onnxPath = filepath.Join(userDir, active)
		// Labels: matching CSV > user tags.csv > default tags.csv
		stem := strings.TrimSuffix(active, filepath.Ext(active))
		userCSV := filepath.Join(userDir, stem+".csv")
		userTags := filepath.Join(userDir, "tags.csv")
		defaultTags := filepath.Join(defaultDir, DefaultTags)
		switch {
		case fileExists(userCSV):
			labelsPath = userCSV
		case fileExists(userTags):
			labelsPath = userTags
		default:
			labelsPath = defaultTags
		}
	} else {
		onnxPath = filepath.Join(defaultDir, DefaultONNX)
		labelsPath = filepath.Join(defaultDir, DefaultTags)
	}

	if !fileExists(onnxPath) {
		if active == "" {
			return fmt.Errorf("default model not found: %s\nGo to Settings → Download Model to download it.", onnxPath)
		}
		return fmt.Errorf("user model not found: %s", onnxPath)
	}
	if !fileExists(labelsPath) {
		return fmt.Errorf("tags CSV not found: %s", labelsPath)
	}

	// Parse labels CSV
	tagNames, ratingIdx, generalIdx, charIdx, err := parseLabelsCSV(labelsPath)
	if err != nil {
		return fmt.Errorf("failed to parse labels: %w", err)
	}

	// Initialize ONNX Runtime (one-time, loads onnxruntime.dll)
	if !ort.IsInitialized() {
		if err := ort.InitializeEnvironment(); err != nil {
			return fmt.Errorf("failed to initialize ONNX Runtime: %w", err)
		}
	}

	// Configure ONNX Runtime session options
	opts := ort.SessionOptions{}
	if gpu {
		if err := opts.AppendExecutionProvider("CUDAExecutionProvider", nil); err != nil {
			fmt.Println("  GPU (CUDA) not available, falling back to CPU:", err)
		}
	}

	session, err := ort.NewDynamicAdvancedSession(onnxPath,
		[]string{"input"}, []string{"output"},
		&opts,
	)
	if err != nil {
		return fmt.Errorf("failed to create ONNX session: %w", err)
	}

	taggerSession = session
	taggerTagNames = tagNames
	taggerRatingIdx = ratingIdx
	taggerGeneralIdx = generalIdx
	taggerCharIdx = charIdx

	fmt.Printf("Tagger ready (%d tags).\n", len(tagNames))
	return nil
}

// ExtractTags runs the ONNX tagger on an image and returns comma-separated tags.
func ExtractTags(img image.Image) string {
	taggerMu.Lock()
	defer taggerMu.Unlock()

	if taggerSession == nil {
		return ""
	}

	// Preprocess: RGBA → RGB, resize, normalize
	inputTensor, err := preprocessImage(img)
	if err != nil {
		fmt.Println("Tag extraction failed during preprocessing:", err)
		return ""
	}

	// Run inference
	outputs := []ort.Value{nil} // nil = auto-allocate by ONNX Runtime
	err = taggerSession.Run([]ort.Value{inputTensor}, outputs)
	if err != nil {
		fmt.Println("Tag extraction failed during inference:", err)
		return ""
	}
	defer outputs[0].Destroy()

	// Get output data
	outputTensor, ok := outputs[0].(*ort.Tensor[float32])
	if !ok {
		fmt.Println("Tag extraction failed: unexpected output type")
		return ""
	}
	outputData := outputTensor.GetData()
	if outputData == nil {
		return ""
	}

	// Apply sigmoid and thresholds
	tags := make([]string, 0)

	// Character tags (higher threshold)
	for _, i := range taggerCharIdx {
		if i < len(outputData) && sigmoid(outputData[i]) >= defaultCharacterThresh {
			if i < len(taggerTagNames) {
				tags = append(tags, taggerTagNames[i])
			}
		}
	}

	// General tags (lower threshold)
	for _, i := range taggerGeneralIdx {
		if i < len(outputData) && sigmoid(outputData[i]) >= defaultGeneralThresh {
			if i < len(taggerTagNames) {
				tags = append(tags, taggerTagNames[i])
			}
		}
	}

	return strings.Join(tags, ", ")
}

// preprocessImage does: resize → normalize → NCHW + batch dim
func preprocessImage(img image.Image) (ort.ArbitraryTensor, error) {
	// RGBA compositing on white background
	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()

	// Resize using nearest-neighbor (simplified — imaging package does Lanczos in Python)
	// For the Go version, we use basic resize to 448x448
	// In a production port, we'd use a proper resize library
	scaleX := float64(w) / float64(taggerInputSize)
	scaleY := float64(h) / float64(taggerInputSize)

	// Create flat float32 array [1, 3, 448, 448] = 1*3*448*448 = 602112 floats
	data := make([]float32, 3*taggerInputSize*taggerInputSize)

	for y := 0; y < taggerInputSize; y++ {
		for x := 0; x < taggerInputSize; x++ {
			srcX := int(float64(x) * scaleX)
			srcY := int(float64(y) * scaleY)
			if srcX >= w {
				srcX = w - 1
			}
			if srcY >= h {
				srcY = h - 1
			}

			r, g, b, a := img.At(srcX+bounds.Min.X, srcY+bounds.Min.Y).RGBA()

			// Composite RGBA onto white
			alpha := float32(a) / 65535.0
			rf := float32(r>>8) / 255.0
			gf := float32(g>>8) / 255.0
			bf := float32(b>>8) / 255.0

			// Blend with white background (1.0, 1.0, 1.0)
			rf = rf*alpha + 1.0*(1.0-alpha)
			gf = gf*alpha + 1.0*(1.0-alpha)
			bf = bf*alpha + 1.0*(1.0-alpha)

			// Normalize with ImageNet stats
			rf = (rf - imagenetMean[0]) / imagenetStd[0]
			gf = (gf - imagenetMean[1]) / imagenetStd[1]
			bf = (bf - imagenetMean[2]) / imagenetStd[2]

			// NCHW layout: channel first
			chOffset := 1 * taggerInputSize * taggerInputSize
			idx := y*taggerInputSize + x
			data[0*chOffset+idx] = rf
			data[1*chOffset+idx] = gf
			data[2*chOffset+idx] = bf
		}
	}

	shape := ort.NewShape(1, 3, int64(taggerInputSize), int64(taggerInputSize))
	tensor, err := ort.NewTensor(shape, data)
	return tensor, err
}

func sigmoid(x float32) float32 {
	return 1.0 / (1.0 + float32(math.Exp(float64(-x))))
}

// ── Helpers ──────────────────────────────────────────────────────────────

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// parseLabelsCSV reads a tags CSV file and returns tag names + category-indexed slices.
// CSV format: tag_id, name, category, count (category column is the key for thresholds).
// If tag_id is missing, row indices are used as IDs.
func parseLabelsCSV(path string) (names []string, ratingIdx, generalIdx, charIdx []int, err error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	defer f.Close()

	reader := csv.NewReader(f)
	rows, err := reader.ReadAll()
	if err != nil {
		return nil, nil, nil, nil, err
	}
	if len(rows) < 2 {
		return nil, nil, nil, nil, fmt.Errorf("CSV has no data rows")
	}

	// First row is header
	headers := rows[0]
	nameCol := -1
	categoryCol := -1
	for i, h := range headers {
		switch strings.TrimSpace(strings.ToLower(h)) {
		case "name":
			nameCol = i
		case "category":
			categoryCol = i
		}
	}
	if nameCol == -1 {
		return nil, nil, nil, nil, fmt.Errorf("CSV missing 'name' column")
	}

	names = make([]string, 0, len(rows)-1)
	for _, row := range rows[1:] {
		if nameCol >= len(row) {
			continue
		}
		names = append(names, strings.TrimSpace(row[nameCol]))

		category := -1
		if categoryCol >= 0 && categoryCol < len(row) {
			if c, err := strconv.Atoi(strings.TrimSpace(row[categoryCol])); err == nil {
				category = c
			}
		}

		i := len(names) - 1
		switch category {
		case ratingCategory:
			ratingIdx = append(ratingIdx, i)
		case generalCategory:
			generalIdx = append(generalIdx, i)
		case characterCategory:
			charIdx = append(charIdx, i)
		}
	}

	return names, ratingIdx, generalIdx, charIdx, nil
}
