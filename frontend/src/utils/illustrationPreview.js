const FALLBACK_ASPECT_RATIO = 4 / 3;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getAspectFitPreviewHeight(
  illustration,
  boxWidth,
  minHeight,
  maxHeight,
) {
  const sourceWidth = Number(illustration?.width);
  const sourceHeight = Number(illustration?.height);
  const aspectRatio = sourceWidth > 0 && sourceHeight > 0
    ? sourceWidth / sourceHeight
    : FALLBACK_ASPECT_RATIO;
  return Math.round(clamp(boxWidth / aspectRatio, minHeight, maxHeight));
}
