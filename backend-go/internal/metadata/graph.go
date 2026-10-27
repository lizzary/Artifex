package metadata

import (
	"encoding/json"
	"math"
	"math/big"
	"sort"
	"strconv"
)

type graph struct {
	Nodes map[string]*node
	IDs   []string
}

type node struct {
	ID, Type, Title string
	Inputs          map[string]any
}

type workflowLink struct {
	id, origin, target     string
	originSlot, targetSlot int
}

type graphOutput struct {
	id   string
	slot int
}

const (
	maxGraphNodes = 10000
	maxGraphEdges = 100000
)

// The budget is shared by every instance expansion, including repeated uses
// of the same definition. An exceeded budget rejects the whole graph rather
// than returning a map-iteration-dependent subset of generation metadata.
type graphBudget struct {
	nodes, edges int
	exceeded     bool
}

func (b *graphBudget) consume(nodes, edges int) bool {
	if b.exceeded || nodes > maxGraphNodes-b.nodes || edges > maxGraphEdges-b.edges {
		b.exceeded = true
		return false
	}
	b.nodes += nodes
	b.edges += edges
	return true
}

func newGraph() *graph { return &graph{Nodes: map[string]*node{}} }

// promptGraph preserves JSON numbers: a uint64 noise seed must never pass
// through float64 on its way to the displayed metadata.
func promptGraph(raw map[string]any) *graph {
	g := newGraph()
	if wrapped, ok := raw["prompt"].(map[string]any); ok {
		raw = wrapped
	}
	budget := &graphBudget{}
	if !budget.consume(len(raw), 0) {
		return g
	}
	for id, value := range raw {
		data, ok := value.(map[string]any)
		if !ok {
			continue
		}
		typ := graphString(data["class_type"])
		if typ == "" {
			typ = graphString(data["type"])
		}
		if typ == "" {
			continue
		}
		n := &node{ID: id, Type: canonicalType(typ), Inputs: map[string]any{}}
		if meta, ok := data["_meta"].(map[string]any); ok {
			n.Title = graphString(meta["title"])
		}
		if inputs, ok := data["inputs"].(map[string]any); ok {
			if !budget.consume(0, len(inputs)) {
				return newGraph()
			}
			for name, value := range inputs {
				n.Inputs[name] = normalizeGraphValue(value)
			}
		}
		g.Nodes[id] = n
	}
	g.sortIDs()
	return g
}

func workflowGraph(raw map[string]any) *graph {
	if wrapped, ok := raw["workflow"].(map[string]any); ok {
		raw = wrapped
	}
	definitions := map[string]map[string]any{}
	if defs, ok := raw["definitions"].(map[string]any); ok {
		if subgraphs, ok := defs["subgraphs"].([]any); ok {
			if len(subgraphs) > maxGraphNodes {
				return newGraph()
			}
			for _, value := range subgraphs {
				if def, ok := value.(map[string]any); ok {
					definitions[graphID(def["id"])] = def
				}
			}
		}
	}
	budget := &graphBudget{}
	g := workflowGraphAt(raw, definitions, map[string]bool{}, 0, budget)
	if budget.exceeded {
		return newGraph()
	}
	for id, n := range g.Nodes {
		if n.Type == "__SubgraphOutput" {
			delete(g.Nodes, id)
		}
	}
	g.sortIDs()
	return g
}

func workflowGraphAt(raw map[string]any, definitions map[string]map[string]any, active map[string]bool, depth int, budget *graphBudget) *graph {
	g := newGraph()
	if depth > 16 {
		budget.exceeded = true
		return g
	}
	values, _ := raw["nodes"].([]any)
	rawLinks, _ := raw["links"].([]any)
	if !budget.consume(len(values), len(rawLinks)) {
		return g
	}
	links := workflowLinks(raw)
	byLinkID := map[string]workflowLink{}
	for _, link := range links {
		byLinkID[link.id] = link
	}
	rawNodes := map[string]map[string]any{}
	bypassed := map[string]bool{}
	for _, value := range values {
		data, ok := value.(map[string]any)
		if !ok {
			continue
		}
		id := graphID(data["id"])
		typ := canonicalType(graphString(data["type"]))
		mode, _ := graphIndex(data["mode"])
		if id == "" || typ == "" || mode == 2 {
			continue
		}
		n := &node{ID: id, Type: typ, Title: graphString(data["title"]), Inputs: map[string]any{}}
		// Count serialized slots/widgets as well as actual links, so a single
		// pathological node cannot evade the graph's traversal budget.
		for _, field := range []string{"inputs", "widgets_values", "widgets_values_named", "widgets"} {
			var size int
			switch value := data[field].(type) {
			case []any:
				size = len(value)
			case map[string]any:
				size = len(value)
			}
			if !budget.consume(0, size) {
				return newGraph()
			}
		}
		applyWorkflowWidgets(n, data)
		if inputs, ok := data["inputs"].(map[string]any); ok {
			for name, value := range inputs {
				n.Inputs[name] = normalizeGraphValue(value)
			}
		}
		if inputs, ok := data["inputs"].([]any); ok {
			for slot, value := range inputs {
				input, ok := value.(map[string]any)
				if !ok {
					continue
				}
				name := graphString(input["name"])
				if name == "" {
					name = "value"
				}
				if value, exists := input["value"]; exists {
					n.Inputs[name] = normalizeGraphValue(value)
				}
				if widget, ok := input["widget"].(map[string]any); ok {
					if value, exists := widget["value"]; exists {
						n.Inputs[name] = normalizeGraphValue(value)
					}
				}
				if linkID := graphID(input["link"]); linkID != "" {
					// A connection takes precedence over the inactive widget value.
					delete(n.Inputs, name)
					if link, ok := byLinkID[linkID]; ok && link.target == id && link.targetSlot == slot {
						n.Inputs[name] = []any{link.origin, link.originSlot}
					}
				}
			}
		}
		g.Nodes[id], rawNodes[id] = n, data
		if mode == 4 {
			bypassed[id] = true
		}
	}

	// A bypassed node does not execute. Forward only a compatible input socket;
	// never report the disabled sampler/LoRA's stored widget values as active.
	bypassCache := map[graphOutput]any{}
	var bypass func(any, map[string]bool) any
	bypass = func(value any, seen map[string]bool) any {
		id, slot, ok := graphReference(value)
		if !ok || !bypassed[id] {
			return value
		}
		key := graphOutput{id, slot}
		if cached, exists := bypassCache[key]; exists {
			return cached
		}
		if seen[id] || len(seen) >= 128 {
			return nil
		}
		seen[id] = true
		remember := func(result any) any { bypassCache[key] = result; return result }
		data := rawNodes[id]
		outputs, _ := data["outputs"].([]any)
		inputs, _ := data["inputs"].([]any)
		if slot >= len(outputs) {
			return remember(nil)
		}
		output, _ := outputs[slot].(map[string]any)
		outputType := graphString(output["type"])
		compatible := func(input map[string]any) bool {
			inputType := graphString(input["type"])
			return inputType != "" && outputType != "" && (inputType == outputType || inputType == "*" || outputType == "*")
		}
		forward := func(input map[string]any) any {
			name := graphString(input["name"])
			if name == "" {
				name = "value"
			}
			return remember(bypass(g.Nodes[id].Inputs[name], seen))
		}
		// Follow ExecutableNodeDTO._getBypassSlotIndex: same slot, exact type,
		// then compatible type. Paired conditioning must preserve its output.
		// https://github.com/Comfy-Org/ComfyUI_frontend/blob/10f8b084ded04435ff05fba589a1512068a1c2f8/src/lib/litegraph/src/subgraph/ExecutableNodeDTO.ts#L359
		if slot < len(inputs) {
			input, _ := inputs[slot].(map[string]any)
			if compatible(input) {
				return forward(input)
			}
		}
		for _, rawInput := range inputs {
			input, _ := rawInput.(map[string]any)
			if outputType != "" && graphString(input["type"]) == outputType {
				return forward(input)
			}
		}
		for _, rawInput := range inputs {
			input, _ := rawInput.(map[string]any)
			if compatible(input) {
				return forward(input)
			}
		}
		return remember(nil)
	}
	for _, n := range g.Nodes {
		for name, value := range n.Inputs {
			n.Inputs[name] = bypass(value, map[string]bool{})
		}
	}
	for id := range bypassed {
		delete(g.Nodes, id)
	}
	if outputNode, ok := raw["outputNode"].(map[string]any); ok {
		id := graphID(outputNode["id"])
		if id != "" {
			boundary := &node{ID: id, Type: "__SubgraphOutput", Inputs: map[string]any{}}
			for _, link := range links {
				if link.target == id {
					boundary.Inputs[strconv.Itoa(link.targetSlot)] = bypass([]any{link.origin, link.originSlot}, map[string]bool{})
				}
			}
			g.Nodes[id] = boundary
		}
	}

	g.sortIDs()
	subgraphOutputs := map[graphOutput]any{}
	// Modern frontend workflows store reusable subgraphs in definitions. Their
	// UUID node type refers to the definition, not to a ComfyUI execution node.
	for _, id := range append([]string(nil), g.IDs...) {
		instance := g.Nodes[id]
		def, ok := definitions[instance.Type]
		if !ok {
			continue
		}
		delete(g.Nodes, id)
		if active[instance.Type] {
			continue
		}
		active[instance.Type] = true
		subgraph := workflowGraphAt(def, definitions, active, depth+1, budget)
		delete(active, instance.Type)
		if budget.exceeded {
			return newGraph()
		}
		inputNode, _ := def["inputNode"].(map[string]any)
		outputNode, _ := def["outputNode"].(map[string]any)
		inputID, outputID := graphID(inputNode["id"]), graphID(outputNode["id"])
		boundaryInputs, _ := def["inputs"].([]any)
		prefix := id + ":"
		qualify := func(value any) any {
			source, slot, isRef := graphReference(value)
			if !isRef {
				return value
			}
			if source == inputID {
				if slot < len(boundaryInputs) {
					input, _ := boundaryInputs[slot].(map[string]any)
					return instance.Inputs[graphString(input["name"])]
				}
				return nil
			}
			return []any{prefix + source, slot}
		}
		// Proxy widgets can expose a boundary input (-1) or an internal node's
		// widget. Apply only serialized values; absent proxies retain defaults.
		data := rawNodes[id]
		props, _ := data["properties"].(map[string]any)
		proxies, _ := props["proxyWidgets"].([]any)
		widgetValues, _ := data["widgets_values"].([]any)
		namedValues, named := data["widgets_values_named"].(map[string]any)
		for i, rawProxy := range proxies {
			proxy, _ := rawProxy.([]any)
			if len(proxy) != 2 {
				continue
			}
			target, name := graphID(proxy[0]), graphString(proxy[1])
			var value any
			if named {
				var exists bool
				value, exists = namedValues[name]
				if !exists {
					continue
				}
			} else {
				if i >= len(widgetValues) {
					continue
				}
				value = widgetValues[i]
			}
			if target == "-1" || name == "control_after_generate" {
				continue
			}
			if n := subgraph.Nodes[target]; n != nil {
				if _, _, linked := graphReference(n.Inputs[name]); !linked {
					n.Inputs[name] = value
				}
			}
		}
		outputs := map[int]any{}
		if boundary := subgraph.Nodes[outputID]; boundary != nil {
			for name, value := range boundary.Inputs {
				if slot, ok := graphIndex(name); ok {
					outputs[slot] = qualify(value)
				}
			}
			delete(subgraph.Nodes, outputID)
		}
		for subID, n := range subgraph.Nodes {
			n.ID = prefix + subID
			for name, value := range n.Inputs {
				n.Inputs[name] = qualify(value)
			}
			g.Nodes[n.ID] = n
		}
		for slot, value := range outputs {
			subgraphOutputs[graphOutput{id, slot}] = value
		}
	}
	// Resolve instance output aliases once after expansion, so many sibling
	// subgraphs do not require repeatedly rescanning the entire parent graph.
	var resolveOutput func(any, map[graphOutput]bool) any
	resolveOutput = func(value any, seen map[graphOutput]bool) any {
		id, slot, linked := graphReference(value)
		if !linked {
			return value
		}
		key := graphOutput{id, slot}
		alias, exists := subgraphOutputs[key]
		if !exists {
			return value
		}
		if seen[key] || len(seen) >= 128 {
			return nil
		}
		seen[key] = true
		resolved := resolveOutput(alias, seen)
		subgraphOutputs[key] = resolved
		return resolved
	}
	for _, n := range g.Nodes {
		for name, value := range n.Inputs {
			n.Inputs[name] = resolveOutput(value, map[graphOutput]bool{})
		}
	}
	g.sortIDs()
	return g
}

func applyWorkflowWidgets(n *node, data map[string]any) {
	// Current frontend writes widget names alongside the legacy positional
	// array. This is authoritative even if a custom widget is not serialized.
	if values, ok := data["widgets_values_named"].(map[string]any); ok {
		for name, value := range values {
			n.Inputs[name] = normalizeGraphValue(value)
		}
		return
	}
	if values, ok := data["widgets_values"].(map[string]any); ok {
		for name, value := range values {
			n.Inputs[name] = normalizeGraphValue(value)
		}
		return
	}
	values, _ := data["widgets_values"].([]any)
	names, known := nodeWidgets[n.Type]
	if !known {
		// Recent workflows can explicitly name each widget-bearing socket.
		if props, ok := data["properties"].(map[string]any); ok {
			if proxies, ok := props["proxyWidgets"].([]any); ok {
				for i, rawProxy := range proxies {
					if i >= len(values) {
						break
					}
					proxy, _ := rawProxy.([]any)
					if len(proxy) == 2 && graphID(proxy[0]) == "-1" {
						n.Inputs[graphString(proxy[1])] = values[i]
					}
				}
				return
			}
		}
		if inputs, ok := data["inputs"].([]any); ok {
			for _, rawInput := range inputs {
				input, _ := rawInput.(map[string]any)
				widget, _ := input["widget"].(map[string]any)
				if name := graphString(widget["name"]); name != "" {
					names = append(names, name)
				}
			}
		}
	}
	index := 0
	for _, name := range names {
		if index >= len(values) {
			break
		}
		n.Inputs[name] = normalizeGraphValue(values[index])
		index++
		if (name == "seed" || name == "noise_seed") && index < len(values) && isSeedControl(values[index]) {
			index++
		}
	}
	if widgets, ok := data["widgets"].([]any); ok {
		for _, rawWidget := range widgets {
			widget, _ := rawWidget.(map[string]any)
			if name := graphString(widget["name"]); name != "" {
				if value, exists := widget["value"]; exists {
					n.Inputs[name] = normalizeGraphValue(value)
				}
			}
		}
	}
}

func workflowLinks(raw map[string]any) []workflowLink {
	var result []workflowLink
	values, _ := raw["links"].([]any)
	for _, value := range values {
		var link workflowLink
		var originSlot, targetSlot any
		switch value := value.(type) {
		case []any:
			if len(value) < 5 {
				continue
			}
			link.id, link.origin, link.target = graphID(value[0]), graphID(value[1]), graphID(value[3])
			originSlot, targetSlot = value[2], value[4]
		case map[string]any:
			link.id = graphID(value["id"])
			link.origin, link.target = graphID(value["origin_id"]), graphID(value["target_id"])
			originSlot, targetSlot = value["origin_slot"], value["target_slot"]
		default:
			continue
		}
		var originOK, targetOK bool
		link.originSlot, originOK = graphIndex(originSlot)
		link.targetSlot, targetOK = graphIndex(targetSlot)
		if originOK && targetOK && link.id != "" && link.origin != "" && link.target != "" {
			result = append(result, link)
		}
	}
	return result
}

func normalizeGraphValue(value any) any {
	if id, slot, ok := graphReference(value); ok {
		return []any{id, slot}
	}
	return value
}

func graphReference(value any) (string, int, bool) {
	values, ok := value.([]any)
	if !ok || len(values) != 2 {
		return "", 0, false
	}
	id := graphID(values[0])
	slot, ok := graphIndex(values[1])
	return id, slot, id != "" && ok
}

func graphString(value any) string {
	s, _ := value.(string)
	return s
}

func graphID(value any) string {
	switch value := value.(type) {
	case string:
		return value
	case json.Number:
		return value.String()
	case int:
		return strconv.Itoa(value)
	case int64:
		return strconv.FormatInt(value, 10)
	case float64:
		if math.IsNaN(value) || math.IsInf(value, 0) || math.Trunc(value) != value {
			return ""
		}
		return strconv.FormatFloat(value, 'f', -1, 64)
	}
	return ""
}

func graphIndex(value any) (int, bool) {
	s := graphID(value)
	index, err := strconv.ParseInt(s, 10, 32)
	return int(index), err == nil && index >= 0
}

func (g *graph) sortIDs() {
	g.IDs = make([]string, 0, len(g.Nodes))
	for id := range g.Nodes {
		g.IDs = append(g.IDs, id)
	}
	sort.Slice(g.IDs, func(i, j int) bool {
		a, aOK := new(big.Int).SetString(g.IDs[i], 10)
		b, bOK := new(big.Int).SetString(g.IDs[j], 10)
		if aOK && bOK && a.Cmp(b) != 0 {
			return a.Cmp(b) < 0
		}
		if aOK != bOK {
			return aOK
		}
		return g.IDs[i] < g.IDs[j]
	})
}
