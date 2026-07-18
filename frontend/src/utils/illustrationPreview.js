const FALLBACK_ASPECT_RATIO = 4 / 3;

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
  return Math.round(Math.max(minHeight, Math.min(maxHeight, boxWidth / aspectRatio)));
}
