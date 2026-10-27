package metadata

import (
	"math"
	"regexp"
	"strconv"
)

// sigmaSchedule follows the SIGMAS output, preserving cardinality across known
// transformations. Unknown transforms must not report an upstream step count as
// though it were the number of steps actually supplied to this sampler.
type sigmaSchedule struct{ name, steps, denoise string }

var manualSigmaNumbers = regexp.MustCompile(`[-+]?(?:\d*\.*\d+)`)

func readSchedule(g *graph, ref any, seen map[string]bool, depth int) sigmaSchedule {
	if depth > maxResolveDepth {
		return sigmaSchedule{}
	}
	n, slot := connected(g, ref)
	if n == nil {
		return sigmaSchedule{}
	}
	key := n.ID + ":" + strconv.Itoa(slot)
	if seen[key] {
		return sigmaSchedule{}
	}
	seen[key] = true
	if n.Type == "Reroute" {
		return readSchedule(g, rerouteInput(n), seen, depth+1)
	}
	if n.Type == "BasicScheduler" || schedulerNames[n.Type] != "" {
		name := valueOf(g, n, "scheduler")
		if name == "" {
			name = schedulerNames[n.Type]
		}
		result := sigmaSchedule{name, valueOf(g, n, "steps"), valueOf(g, n, "denoise")}
		if n.Type == "ManualSigmas" {
			count := len(manualSigmaNumbers.FindAllString(valueOf(g, n, "sigmas"), -1)) - 1
			if count < 0 {
				count = 0
			}
			result.steps = strconv.Itoa(count)
		}
		return result
	}
	result := readSchedule(g, n.Inputs["sigmas"], seen, depth+1)
	switch n.Type {
	case "FlipSigmas", "SetFirstSigma":
		return result
	case "SplitSigmas", "SplitSigmasDenoise":
		total, err := strconv.Atoi(result.steps)
		if err != nil || total < 0 {
			result.steps = ""
			return result
		}
		if slot > 1 {
			return sigmaSchedule{}
		}
		if n.Type == "SplitSigmas" {
			step, err := strconv.Atoi(valueOf(g, n, "step"))
			if err != nil {
				result.steps = ""
				return result
			}
			step = max(0, min(step, total))
			if slot == 0 {
				result.steps = strconv.Itoa(step)
			} else {
				result.steps = strconv.Itoa(total - step)
			}
		} else {
			denoise, err := strconv.ParseFloat(valueOf(g, n, "denoise"), 64)
			if err != nil || math.IsNaN(denoise) || denoise < 0 || denoise > 1 {
				result.steps = ""
				return result
			}
			low := int(math.RoundToEven(float64(total) * denoise))
			if slot == 1 {
				result.steps = strconv.Itoa(low)
			} else if low == 0 {
				result.steps = "0"
			} else {
				result.steps = strconv.Itoa(total - low)
			}
		}
		return result
	case "ExtendIntermediateSigmas":
		// Added steps depend on runtime sigma values and the chosen model.
		result.steps = ""
		return result
	default:
		return sigmaSchedule{}
	}
}
