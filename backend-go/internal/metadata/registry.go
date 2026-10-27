package metadata

import "strings"

// Widget order is the order of primitive/combo inputs in ComfyUI's schema,
// excluding sockets. Audited against ComfyUI v0.43.0, commit
// 426f5eea52a7ece1dd599fff4cb6cd1f352ddd24 (nodes.py and comfy_extras).
// Keep node IDs here, not localized display names or Python class names.
var nodeWidgets = map[string][]string{
	"KSampler":                            {"seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"},
	"KSamplerAdvanced":                    {"add_noise", "noise_seed", "steps", "cfg", "sampler_name", "scheduler", "start_at_step", "end_at_step", "return_with_leftover_noise"},
	"SamplerCustom":                       {"add_noise", "noise_seed", "cfg"},
	"SamplerCustomAdvanced":               {},
	"BasicGuider":                         {},
	"CFGGuider":                           {"cfg"},
	"DualCFGGuider":                       {"cfg_conds", "cfg_cond2_negative", "style"},
	"DualModelGuider":                     {"cfg"},
	"RandomNoise":                         {"noise_seed"},
	"DisableNoise":                        {},
	"BasicScheduler":                      {"scheduler", "steps", "denoise"},
	"KarrasScheduler":                     {"steps", "sigma_max", "sigma_min", "rho"},
	"ExponentialScheduler":                {"steps", "sigma_max", "sigma_min"},
	"PolyexponentialScheduler":            {"steps", "sigma_max", "sigma_min", "rho"},
	"LaplaceScheduler":                    {"steps", "sigma_max", "sigma_min", "mu", "beta"},
	"VPScheduler":                         {"steps", "beta_d", "beta_min", "eps_s"},
	"BetaSamplingScheduler":               {"steps", "alpha", "beta"},
	"SDTurboScheduler":                    {"steps", "denoise"},
	"Flux2Scheduler":                      {"steps", "width", "height"},
	"AlignYourStepsScheduler":             {"model_type", "steps", "denoise"},
	"OptimalStepsScheduler":               {"model_type", "steps", "denoise"},
	"Ideogram4Scheduler":                  {"steps", "width", "height", "mu", "std"},
	"LTXVScheduler":                       {"steps", "max_shift", "base_shift", "stretch", "terminal"},
	"KSamplerSelect":                      {"sampler_name"},
	"SamplerEulerAncestral":               {"eta", "s_noise"},
	"SamplerEulerAncestralCFGPP":          {"eta", "s_noise"},
	"SamplerLMS":                          {"order"},
	"SamplerDPMPP_3M_SDE":                 {"eta", "s_noise", "noise_device"},
	"SamplerDPMPP_2M_SDE":                 {"solver_type", "eta", "s_noise", "noise_device"},
	"SamplerDPMPP_SDE":                    {"eta", "s_noise", "r", "noise_device"},
	"SamplerDPMPP_2S_Ancestral":           {"eta", "s_noise"},
	"SamplerDPMAdaptative":                {"order", "rtol", "atol", "h_init", "pcoeff", "icoeff", "dcoeff", "accept_safety", "eta", "s_noise"},
	"SamplerER_SDE":                       {"solver_type", "max_stage", "eta", "s_noise"},
	"SamplerSASolver":                     {"eta", "sde_start_percent", "sde_end_percent", "s_noise", "predictor_order", "corrector_order", "use_pece", "simple_order_2"},
	"SamplerSEEDS2":                       {"solver_type", "eta", "s_noise", "r"},
	"SplitSigmas":                         {"step"},
	"SplitSigmasDenoise":                  {"denoise"},
	"FlipSigmas":                          {},
	"SetFirstSigma":                       {"sigma"},
	"ExtendIntermediateSigmas":            {"steps", "start_at_sigma", "end_at_sigma", "spacing"},
	"ManualSigmas":                        {"sigmas"},
	"CFGOverride":                         {"cfg", "start_percent", "end_percent"},
	"CheckpointLoaderSimple":              {"ckpt_name"},
	"CheckpointLoader":                    {"config_name", "ckpt_name"},
	"DiffusersLoader":                     {"model_path"},
	"UNETLoader":                          {"unet_name", "weight_dtype"},
	"LoraLoader":                          {"lora_name", "strength_model", "strength_clip"},
	"LoraLoaderModelOnly":                 {"lora_name", "strength_model"},
	"CLIPLoader":                          {"clip_name", "type", "device"},
	"DualCLIPLoader":                      {"clip_name1", "clip_name2", "type", "device"},
	"TripleCLIPLoader":                    {"clip_name1", "clip_name2", "clip_name3"},
	"VAELoader":                           {"vae_name"},
	"CLIPTextEncode":                      {"text"},
	"CLIPTextEncodeSDXL":                  {"width", "height", "crop_w", "crop_h", "target_width", "target_height", "text_g", "text_l"},
	"CLIPTextEncodeSDXLRefiner":           {"ascore", "width", "height", "text"},
	"CLIPTextEncodeSD3":                   {"clip_l", "clip_g", "t5xxl", "empty_padding"},
	"CLIPTextEncodeFlux":                  {"clip_l", "t5xxl", "guidance"},
	"CLIPTextEncodeHunyuanDiT":            {"bert", "mt5xl"},
	"TextEncodeHunyuanVideo_ImageToVideo": {"prompt", "image_interleave"},
	"TextEncodeQwenImageEdit":             {"prompt"},
	"TextEncodeQwenImageEditPlus":         {"prompt"},
	"TextEncodeQwenImage21":               {"prompt", "negative_prompt", "resolution"},
	"FluxGuidance":                        {"guidance"},
	"FluxDisableGuidance":                 {},
	"ConditioningZeroOut":                 {},
	"ConditioningCombine":                 {},
	"ConditioningConcat":                  {},
	"ConditioningAverage":                 {"conditioning_to_strength"},
	"ControlNetApply":                     {"strength"},
	"ControlNetApplyAdvanced":             {"strength", "start_percent", "end_percent"},
	"PrimitiveString":                     {"value"},
	"PrimitiveStringMultiline":            {"value"},
	"PrimitiveInt":                        {"value"},
	"PrimitiveFloat":                      {"value"},
	"PrimitiveBoolean":                    {"value"},
	"PrimitiveNode":                       {"value"},
	"Reroute":                             {},
	"SaveImage":                           {"filename_prefix"},
	"PreviewImage":                        {},
	"SaveAnimatedWEBP":                    {"filename_prefix", "fps", "lossless", "quality", "method"},
	"SaveAnimatedPNG":                     {"filename_prefix", "fps", "compress_level"},
	"SaveVideo":                           {"filename_prefix", "format", "codec"},
	"VAEDecode":                           {},
	"VAEDecodeTiled":                      {"tile_size", "overlap", "temporal_size", "temporal_overlap"},
	// Established third-party loaders from the previous parser. Do not infer
	// arbitrary custom-node widget layouts from similar names.
	"UnetLoaderGGUF":              {"unet_name"},
	"UnetLoaderGGUFAdvanced":      {"unet_name", "dequant_dtype", "patch_dtype", "patch_on_device"},
	"UnetLoaderGGML":              {"unet_name"},
	"UnetLoaderGGMLv3":            {"unet_name"},
	"CheckpointLoader|pysssss":    {"ckpt_name"},
	"LoraLoader|pysssss":          {"lora_name", "strength_model", "strength_clip"},
	"Power Lora Loader (rgthree)": {},
	"FaceDetailer":                {},
	"FaceDetailerPipe":            {},
	"UltimateSDUpscale":           {},
	"Textbox":                     {"text"},
}

var canonicalNodeTypes = func() map[string]string {
	result := make(map[string]string, len(nodeWidgets))
	for name := range nodeWidgets {
		result[strings.ToLower(name)] = name
	}
	// These IDs are recognized without guessing their positional widget
	// schemas. Named inputs/widgets remain available to the graph reader.
	for _, name := range []string{
		"unCLIPCheckpointLoader", "ModelLoader", "InpaintModelConditioning",
		"WanInfiniteTalkToVideo", "SaveImageAdvanced", "SaveWEBM",
		"ImpactWildcardProcessor", "ImpactWildcardEncode",
	} {
		result[strings.ToLower(name)] = name
	}
	return result
}()

func canonicalType(value string) string {
	value = strings.TrimSpace(value)
	if canonical, ok := canonicalNodeTypes[strings.ToLower(value)]; ok {
		return canonical
	}
	return value
}

func isSeedControl(value any) bool {
	s, ok := value.(string)
	if !ok {
		return false
	}
	switch strings.ToLower(s) {
	case "fixed", "increment", "decrement", "randomize":
		return true
	}
	return false
}
