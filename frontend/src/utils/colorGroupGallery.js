export const COLOR_GROUP_PREVIEW_MIN = 1;
export const COLOR_GROUP_PREVIEW_MAX = 1000;

export function isColorGroupPreviewLimit(value) {
  return Number.isInteger(value)
    && value >= COLOR_GROUP_PREVIEW_MIN
    && value <= COLOR_GROUP_PREVIEW_MAX;
}

export function limitColorGroups(groups, limit) {
  if (!groups || limit == null) return groups;
  return groups.map((group) => ({
    ...group,
    items: group.items.slice(0, limit),
    totalCount: group.items.length,
    omittedCount: Math.max(0, group.items.length - limit),
  }));
}

// Fill the remaining slots before wrapping, keeping each group's items
// contiguous in reading order. A collapsed group still occupies one slot.
export function packColorGroups(groups, collapsedGroups, columns) {
  const segments = [];
  let occupied = 0;

  for (const group of groups) {
    const items = collapsedGroups.has(group.id) ? [] : group.items;
    let start = 0;
    do {
      const span = Math.min(columns - occupied, Math.max(1, items.length - start));
      segments.push({
        group,
        items: items.slice(start, start + span),
        start,
        span,
        fromPrevious: start > 0,
        continuesOnNext: start + span < items.length,
      });
      start += span;
      occupied = (occupied + span) % columns;
    } while (start < items.length);
  }

  return segments;
}
