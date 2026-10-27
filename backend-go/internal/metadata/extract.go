package metadata

import (
	"encoding/json"
	"fmt"
	"image"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ParserVersion changes when stored metadata needs to be extracted again.
const ParserVersion = "comfyui-0.43.0-v1"

// Extract reads embedded generation metadata without requiring ComfyUI to run.
// Unsupported or damaged metadata must not prevent an otherwise valid image upload.
func Extract(imagePath string, img image.Image) (map[string]interface{}, error) {
	result := map[string]any{"fileinfo": buildFileInfo(imagePath, img), "parser_version": ParserVersion}
	chunks, err := readImageMetadata(imagePath)
	if err != nil {
		return result, nil
	}
	for key, value := range parseComfyMetadata(chunks["prompt"], chunks["workflow"]) {
		result[key] = value
	}
	return result, nil
}

func decodeMetadata(text string) map[string]any {
	var value map[string]any
	decoder := json.NewDecoder(strings.NewReader(text))
	// ComfyUI seeds occupy the entire uint64 range. Never round through float64.
	decoder.UseNumber()
	if decoder.Decode(&value) != nil {
		return nil
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return nil
	}
	return value
}

func parseComfyMetadata(promptText, workflowText string) map[string]any {
	prompt := promptGraph(decodeMetadata(promptText))
	workflow := workflowGraph(decodeMetadata(workflowText))
	g := prompt
	if len(g.Nodes) == 0 {
		g = workflow
	} else {
		// Execution values take priority over the UI's post-generation widget values.
		for id, n := range g.Nodes {
			if fallback := workflow.Nodes[id]; fallback != nil && fallback.Type == n.Type {
				for key, value := range fallback.Inputs {
					if _, exists := n.Inputs[key]; !exists {
						n.Inputs[key] = value
					}
				}
			}
		}
	}
	result := map[string]any{}
	for _, key := range []string{"Model", "Seed", "Positive Prompt", "Negative Prompt", "Sampler", "Scheduler", "Steps", "CFG Scale"} {
		result[key] = ""
	}
	result["LoRAs"] = "N/A"
	stages := generationStages(g)
	if len(stages) > 0 {
		for key, value := range stages[0] {
			if key != "Sampler Node" {
				result[key] = value
			}
		}
		// Preserve independent passes rather than mixing parameters from several nodes.
		result["Generation Stages"] = stages
	}
	return result
}

func buildFileInfo(path string, img image.Image) map[string]any {
	info := map[string]any{"filename": filepath.ToSlash(path)}
	if img != nil {
		bounds := img.Bounds()
		info["resolution"] = fmt.Sprintf("%dx%d", bounds.Dx(), bounds.Dy())
	}
	if stat, err := os.Stat(path); err == nil {
		info["date"] = stat.ModTime().String()
		info["size"] = formatSize(stat.Size())
	}
	return info
}

func formatSize(bytes int64) string {
	switch {
	case bytes < 1024:
		return fmt.Sprintf("%d bytes", bytes)
	case bytes < 1024*1024:
		return fmt.Sprintf("%.2f KB", float64(bytes)/1024)
	default:
		return fmt.Sprintf("%.2f MB", float64(bytes)/(1024*1024))
	}
}
