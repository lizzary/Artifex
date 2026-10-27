package metadata

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

const maxResolveDepth = 256

// Links retain their output slot: several modern nodes produce both positive
// and negative conditioning from a single node.
func connected(g *graph, value any) (*node, int) {
	a, ok := value.([]any)
	if !ok || len(a) != 2 {
		return nil, 0
	}
	id := scalarText(a[0])
	slot, err := strconv.Atoi(scalarText(a[1]))
	if err != nil || slot < 0 {
		return nil, 0
	}
	return g.Nodes[id], slot
}

func scalarText(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case json.Number:
		return v.String()
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case int:
		return strconv.Itoa(v)
	case int64:
		return strconv.FormatInt(v, 10)
	case uint64:
		return strconv.FormatUint(v, 10)
	case bool:
		return strconv.FormatBool(v)
	case map[string]any:
		return scalarText(v["content"])
	}
	return ""
}

func inputKeys(n *node) []string {
	keys := make([]string, 0, len(n.Inputs))
	for key := range n.Inputs {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	// Prefer the image/latent path when looking backwards from an output.
	priority := map[string]int{"images": 1, "image": 2, "samples": 3, "video": 4, "latent_image": 5}
	sort.SliceStable(keys, func(i, j int) bool {
		a, b := priority[keys[i]], priority[keys[j]]
		if a == 0 {
			a = 100
		}
		if b == 0 {
			b = 100
		}
		return a < b
	})
	return keys
}

func isSampler(n *node) bool {
	switch n.Type {
	case "KSampler", "KSamplerAdvanced", "SamplerCustom", "SamplerCustomAdvanced", "FaceDetailer", "FaceDetailerPipe", "UltimateSDUpscale", "UltimateSDUpscaleNoUpscale", "KSampler (Efficient)", "KSampler Adv. (Efficient)":
		return true
	}
	// A custom node with explicit sampling inputs can be read without guessing
	// positional widgets or treating a sampler-selector/guider as a sampling pass.
	_, latent := n.Inputs["latent_image"]
	_, images := n.Inputs["image"]
	_, seed := n.Inputs["seed"]
	_, noiseSeed := n.Inputs["noise_seed"]
	_, positive := n.Inputs["positive"]
	return (latent || images) && (seed || noiseSeed) && positive
}

func isOutput(n *node) bool {
	switch n.Type {
	case "SaveImage", "SaveImageAdvanced", "SaveAnimatedPNG", "SaveAnimatedWEBP", "SaveVideo", "SaveWEBM", "VHS_VideoCombine":
		return true
	}
	return false
}

// walkNodes is deterministic, cycle safe and iterative. Each node is visited at
// most once; cycles in damaged or user-authored graphs cannot hang extraction.
func walkNodes(g *graph, roots []*node) []*node {
	return walkNodesSeen(g, roots, map[string]bool{})
}

func walkNodesSeen(g *graph, roots []*node, seen map[string]bool) []*node {
	queue := append([]*node(nil), roots...)
	var out []*node
	for len(queue) > 0 {
		n := queue[0]
		queue = queue[1:]
		if n == nil || seen[n.ID] {
			continue
		}
		seen[n.ID] = true
		out = append(out, n)
		for _, key := range inputKeys(n) {
			if next, _ := connected(g, n.Inputs[key]); next != nil && !seen[next.ID] {
				queue = append(queue, next)
			}
		}
	}
	return out
}

func generationStages(g *graph) []map[string]any {
	var roots []*node
	for _, id := range g.IDs {
		if n := g.Nodes[id]; n != nil && isOutput(n) {
			roots = append(roots, n)
		}
	}
	if len(roots) == 0 {
		for _, id := range g.IDs {
			if n := g.Nodes[id]; n != nil && n.Type == "PreviewImage" {
				roots = append(roots, n)
			}
		}
	}
	if len(roots) == 0 {
		// For API snippets without a save node, prefer final sampling passes over
		// their latent-producing ancestors, with stable node-ID tie breaking.
		upstream := map[string]bool{}
		var dependencies []*node
		for _, id := range g.IDs {
			n := g.Nodes[id]
			if n == nil || !isSampler(n) {
				continue
			}
			for _, key := range inputKeys(n) {
				if ancestor, _ := connected(g, n.Inputs[key]); ancestor != nil {
					dependencies = append(dependencies, ancestor)
				}
			}
		}
		for _, ancestor := range walkNodes(g, dependencies) {
			if isSampler(ancestor) {
				upstream[ancestor.ID] = true
			}
		}
		for _, id := range g.IDs {
			if n := g.Nodes[id]; n != nil && isSampler(n) && !upstream[id] {
				roots = append(roots, n)
			}
		}
		if len(roots) == 0 {
			for _, id := range g.IDs {
				if n := g.Nodes[id]; n != nil && isSampler(n) {
					roots = append(roots, n)
				}
			}
		}
	}
	var stages []map[string]any
	seen := map[string]bool{}
	visited := map[string]bool{}
	for _, root := range roots {
		for _, n := range walkNodesSeen(g, []*node{root}, visited) {
			if isSampler(n) && !seen[n.ID] {
				seen[n.ID] = true
				stages = append(stages, extractStage(g, n))
			}
		}
	}
	return stages
}

func resolveScalar(g *graph, value any, seen map[string]bool, depth int) string {
	if depth > maxResolveDepth {
		return ""
	}
	n, slot := connected(g, value)
	if n == nil {
		return scalarText(value)
	}
	key := n.ID + ":" + strconv.Itoa(slot)
	if seen[key] {
		return ""
	}
	seen[key] = true
	// Follow explicit scalar inputs only; do not pretend to execute arbitrary
	// arithmetic or custom-node code while reading metadata.
	var fields []string
	switch n.Type {
	case "PrimitiveInt", "PrimitiveFloat", "PrimitiveBoolean", "PrimitiveString", "PrimitiveStringMultiline", "PrimitiveNode", "Reroute":
		fields = []string{"value", "input"}
	case "Textbox":
		fields = []string{"text"}
	case "Seed (rgthree)", "Seed", "easy seed":
		fields = []string{"seed", "value"}
	}
	for _, field := range fields {
		if v, ok := n.Inputs[field]; ok {
			return resolveScalar(g, v, seen, depth+1)
		}
	}
	return ""
}

func valueOf(g *graph, n *node, fields ...string) string {
	if n == nil {
		return ""
	}
	for _, field := range fields {
		if value, ok := n.Inputs[field]; ok {
			return resolveScalar(g, value, map[string]bool{}, 0)
		}
	}
	return ""
}

func joinUnique(values []string) string {
	seen := map[string]bool{}
	var out []string
	for _, s := range values {
		if strings.TrimSpace(s) != "" && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return strings.Join(out, "\n")
}

// conditionText follows conditioning ports, never the words inside a prompt.
// Empty text and ConditioningZeroOut are valid, intentional empty conditions.
func conditionText(g *graph, value any, seen map[string]bool, depth int) string {
	if depth > maxResolveDepth {
		return ""
	}
	n, slot := connected(g, value)
	if n == nil {
		return scalarText(value)
	}
	key := n.ID + ":" + strconv.Itoa(slot)
	if seen[key] {
		return ""
	}
	seen[key] = true
	if n.Type == "ConditioningZeroOut" {
		return ""
	}
	if n.Type == "Reroute" {
		return conditionText(g, rerouteInput(n), seen, depth+1)
	}
	if n.Type == "TextEncodeQwenImage21" {
		switch slot {
		case 0:
			return valueOf(g, n, "prompt")
		case 1:
			return valueOf(g, n, "negative_prompt")
		default:
			return ""
		}
	}
	// Nodes that route paired conditioning must respect the selected output.
	pos, hasPositive := n.Inputs["positive"]
	neg, hasNegative := n.Inputs["negative"]
	if hasPositive && hasNegative {
		offset := 0
		if n.Type == "WanInfiniteTalkToVideo" {
			offset = 1
		}
		if slot == offset {
			return conditionText(g, pos, seen, depth+1)
		}
		if slot == offset+1 {
			return conditionText(g, neg, seen, depth+1)
		}
		return ""
	}
	var textFields []string
	switch n.Type {
	case "CLIPTextEncodeSDXL":
		textFields = []string{"text_g", "text_l"}
	case "CLIPTextEncodeSD3":
		textFields = []string{"clip_l", "clip_g", "t5xxl"}
	case "CLIPTextEncodeFlux":
		textFields = []string{"clip_l", "t5xxl"}
	case "CLIPTextEncodeHunyuanDiT":
		textFields = []string{"bert", "mt5xl"}
	case "ImpactWildcardProcessor", "ImpactWildcardEncode":
		textFields = []string{"populated_text"}
		if _, ok := n.Inputs["populated_text"]; !ok {
			textFields = []string{"wildcard_text"}
		}
	default:
		for _, field := range []string{"text", "prompt", "positive_prompt", "value", "string"} {
			if _, ok := n.Inputs[field]; ok {
				textFields = []string{field}
				break
			}
		}
	}
	if len(textFields) > 0 {
		var values []string
		for _, field := range textFields {
			values = append(values, valueOf(g, n, field))
		}
		return joinUnique(values)
	}
	var values []string
	for _, field := range []string{"conditioning", "conditioning_1", "conditioning_2", "conditioning_to", "conditioning_from", "cond", "positive", "input"} {
		if v, ok := n.Inputs[field]; ok {
			values = append(values, conditionText(g, v, seen, depth+1))
		}
	}
	return joinUnique(values)
}

func modelNames(g *graph, value any, seen map[string]bool, depth int) []string {
	if depth > maxResolveDepth {
		return nil
	}
	n, _ := connected(g, value)
	if n == nil {
		return nil
	}
	if seen[n.ID] {
		return nil
	}
	seen[n.ID] = true
	if n.Type == "Reroute" {
		return modelNames(g, rerouteInput(n), seen, depth+1)
	}
	var fields []string
	switch n.Type {
	case "CheckpointLoaderSimple", "CheckpointLoader", "unCLIPCheckpointLoader", "CheckpointLoader|pysssss":
		fields = []string{"ckpt_name"}
	case "UNETLoader", "UnetLoaderGGUF", "UnetLoaderGGUFAdvanced", "UnetLoaderGGML", "UnetLoaderGGMLv3":
		fields = []string{"unet_name"}
	case "DiffusersLoader":
		fields = []string{"model_path"}
	case "ModelLoader":
		fields = []string{"ckpt_name", "unet_name", "model_name", "file_name"}
	}
	if len(fields) > 0 {
		if name := valueOf(g, n, fields...); name != "" {
			return []string{name}
		}
	}
	var names []string
	for _, field := range []string{"model", "model1", "model2", "base_model", "unet", "basic_pipe", "pipe", "input"} {
		if v, ok := n.Inputs[field]; ok {
			names = append(names, modelNames(g, v, seen, depth+1)...)
		}
	}
	return names
}

func firstNodeAlong(g *graph, value any, accept func(*node) bool) *node {
	queue := []any{value}
	seen := map[string]bool{}
	for len(queue) > 0 {
		ref := queue[0]
		queue = queue[1:]
		n, _ := connected(g, ref)
		if n == nil || seen[n.ID] {
			continue
		}
		seen[n.ID] = true
		if accept(n) {
			return n
		}
		for _, key := range []string{"value", "input", "noise", "sampler", "sigmas", "guider", "basic_pipe", "pipe"} {
			if v, ok := n.Inputs[key]; ok {
				queue = append(queue, v)
			}
		}
	}
	return nil
}

func rerouteInput(n *node) any {
	if value, ok := n.Inputs["value"]; ok {
		return value
	}
	if value, ok := n.Inputs["input"]; ok {
		return value
	}
	if len(n.Inputs) == 1 {
		for _, value := range n.Inputs {
			return value
		}
	}
	return nil
}

// semanticNodes stays on model/CLIP/conditioning edges. Reference images and
// latent inputs may come from another generation and must not contribute LoRAs
// or guidance to this pass.
func semanticNodes(g *graph, refs ...any) []*node {
	queue := append([]any(nil), refs...)
	seen := map[string]bool{}
	var result []*node
	for len(queue) > 0 {
		ref := queue[0]
		queue = queue[1:]
		n, slot := connected(g, ref)
		if n == nil {
			continue
		}
		key := n.ID + ":" + strconv.Itoa(slot)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, n)
		if n.Type == "ConditioningZeroOut" {
			continue
		}
		if n.Type == "Reroute" {
			queue = append(queue, rerouteInput(n))
			continue
		}
		_, pos := n.Inputs["positive"]
		_, neg := n.Inputs["negative"]
		if pos && neg {
			offset := 0
			if n.Type == "WanInfiniteTalkToVideo" {
				offset = 1
			}
			if slot == offset {
				queue = append(queue, n.Inputs["positive"])
			}
			if slot == offset+1 {
				queue = append(queue, n.Inputs["negative"])
			}
			continue
		}
		if n.Type == "LoraLoader" || n.Type == "LoraLoaderModelOnly" || n.Type == "LoraLoader|pysssss" || n.Type == "Power Lora Loader (rgthree)" {
			if slot == 0 {
				queue = append(queue, n.Inputs["model"])
			} else if slot == 1 {
				queue = append(queue, n.Inputs["clip"])
			}
			continue
		}
		for _, field := range []string{"model", "model1", "model2", "base_model", "clip", "conditioning", "conditioning_1", "conditioning_2", "conditioning_to", "conditioning_from", "cond", "positive", "basic_pipe", "pipe", "input"} {
			if v, ok := n.Inputs[field]; ok {
				queue = append(queue, v)
			}
		}
	}
	return result
}

var schedulerNames = map[string]string{
	"KarrasScheduler": "karras", "ExponentialScheduler": "exponential", "PolyexponentialScheduler": "polyexponential", "LaplaceScheduler": "laplace", "VPScheduler": "vp", "BetaSamplingScheduler": "beta", "SDTurboScheduler": "sd_turbo", "Flux2Scheduler": "flux2", "AlignYourStepsScheduler": "align_your_steps", "OptimalStepsScheduler": "optimal_steps", "LTXVScheduler": "ltxv", "Ideogram4Scheduler": "ideogram4", "ManualSigmas": "manual",
}
var samplerNames = map[string]string{
	"SamplerEulerAncestral": "euler_ancestral", "SamplerEulerAncestralCFGPP": "euler_ancestral_cfg_pp", "SamplerLMS": "lms", "SamplerDPMPP_3M_SDE": "dpmpp_3m_sde", "SamplerDPMPP_2M_SDE": "dpmpp_2m_sde", "SamplerDPMPP_SDE": "dpmpp_sde", "SamplerDPMPP_2S_Ancestral": "dpmpp_2s_ancestral", "SamplerDPMAdaptative": "dpm_adaptive", "SamplerER_SDE": "er_sde", "SamplerSASolver": "sa_solver", "SamplerSEEDS2": "seeds_2",
}

func extractStage(g *graph, n *node) map[string]any {
	out := map[string]any{"Sampler Node": n.ID, "LoRAs": "N/A"}
	for _, key := range []string{"Model", "Seed", "Positive Prompt", "Negative Prompt", "Sampler", "Scheduler", "Steps", "CFG Scale"} {
		out[key] = ""
	}
	fields := map[string][]string{"Seed": {"seed", "noise_seed"}, "Steps": {"steps"}, "CFG Scale": {"cfg"}, "Sampler": {"sampler_name"}, "Scheduler": {"scheduler"}, "Denoise": {"denoise"}, "Start Step": {"start_at_step"}, "End Step": {"end_at_step"}}
	for label, keys := range fields {
		if v := valueOf(g, n, keys...); v != "" {
			out[label] = v
		}
	}
	condNode := n
	if guider := firstNodeAlong(g, n.Inputs["guider"], func(v *node) bool { return v.Type != "Reroute" }); guider != nil {
		condNode = guider
	}
	if condNode == n {
		for _, field := range []string{"basic_pipe", "pipe"} {
			if _, exists := n.Inputs["positive"]; !exists {
				if pipe := firstNodeAlong(g, n.Inputs[field], func(v *node) bool { _, ok := v.Inputs["positive"]; return ok }); pipe != nil {
					condNode = pipe
					break
				}
			}
		}
	}
	if cfg := valueOf(g, condNode, "cfg", "cfg_conds"); cfg != "" {
		out["CFG Scale"] = cfg
	}
	if cfg := valueOf(g, condNode, "cfg_cond2_negative"); cfg != "" {
		out["CFG Scale 2"] = cfg
	}
	var positive any
	for _, key := range []string{"positive", "conditioning", "cond1"} {
		if v, ok := condNode.Inputs[key]; ok {
			positive = v
			break
		}
	}
	out["Positive Prompt"] = conditionText(g, positive, map[string]bool{}, 0)
	out["Negative Prompt"] = conditionText(g, condNode.Inputs["negative"], map[string]bool{}, 0)
	if middle, ok := condNode.Inputs["cond2"]; ok {
		out["Middle Prompt"] = conditionText(g, middle, map[string]bool{}, 0)
	}
	modelRef := condNode.Inputs["model"]
	if modelRef == nil {
		modelRef = n.Inputs["model"]
	}
	out["Model"] = joinUnique(modelNames(g, modelRef, map[string]bool{}, 0))
	if negativeModel := joinUnique(modelNames(g, condNode.Inputs["model_negative"], map[string]bool{}, 0)); negativeModel != "" {
		out["Negative Model"] = negativeModel
	}
	if noise := firstNodeAlong(g, n.Inputs["noise"], func(v *node) bool { return v.Type == "RandomNoise" }); noise != nil {
		out["Seed"] = valueOf(g, noise, "noise_seed")
	}
	if sampler := firstNodeAlong(g, n.Inputs["sampler"], func(v *node) bool { return v.Type == "KSamplerSelect" || samplerNames[v.Type] != "" }); sampler != nil {
		name := valueOf(g, sampler, "sampler_name")
		if name == "" {
			name = samplerNames[sampler.Type]
		}
		out["Sampler"] = name
	}
	if schedule := readSchedule(g, n.Inputs["sigmas"], map[string]bool{}, 0); schedule.name != "" {
		out["Scheduler"] = schedule.name
		out["Steps"] = schedule.steps
		if schedule.denoise != "" {
			out["Denoise"] = schedule.denoise
		}
	}
	for _, guidance := range semanticNodes(g, positive) {
		if guidance.Type == "FluxDisableGuidance" {
			break
		}
		if _, ok := guidance.Inputs["guidance"]; ok {
			out["Guidance"] = valueOf(g, guidance, "guidance")
			break
		}
	}
	// Scope LoRAs to this pass's model and conditioning, excluding earlier latent passes.
	if loras := loraDescriptions(g, semanticNodes(g, modelRef, positive, condNode.Inputs["negative"], condNode.Inputs["cond2"], condNode.Inputs["model_negative"])); len(loras) > 0 {
		out["LoRAs"] = strings.Join(loras, ", ")
	}
	return out
}

func loraDescriptions(g *graph, nodes []*node) []string {
	var out []string
	seen := map[string]bool{}
	for _, n := range nodes {
		if seen[n.ID] {
			continue
		}
		seen[n.ID] = true
		switch n.Type {
		case "LoraLoader", "LoraLoaderModelOnly", "LoraLoader|pysssss":
			name := valueOf(g, n, "lora_name")
			if name == "" {
				continue
			}
			model, clip := valueOf(g, n, "strength_model"), valueOf(g, n, "strength_clip")
			if n.Type == "LoraLoaderModelOnly" {
				clip = "0"
			}
			if model == "" {
				model = "?"
			}
			if clip == "" {
				clip = "?"
			}
			out = append(out, fmt.Sprintf("%s (Model: %s, Clip: %s)", name, model, clip))
		case "Power Lora Loader (rgthree)":
			for _, key := range inputKeys(n) {
				if !strings.HasPrefix(key, "lora_") {
					continue
				}
				entry, ok := n.Inputs[key].(map[string]any)
				if !ok {
					continue
				}
				if enabled, ok := entry["on"].(bool); ok && !enabled {
					continue
				}
				name := scalarText(entry["lora"])
				if name == "" {
					continue
				}
				model, clip := scalarText(entry["strength"]), scalarText(entry["strengthTwo"])
				if clip == "" {
					clip = model
				}
				if model == "" {
					model = "?"
				}
				if clip == "" {
					clip = "?"
				}
				out = append(out, fmt.Sprintf("%s (Model: %s, Clip: %s)", name, model, clip))
			}
		}
	}
	return out
}
