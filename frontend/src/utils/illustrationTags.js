export function parseIllustrationTags(value) {
  const seen = new Set();
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function parseTagInput(value) {
  const seen = new Set();
  return String(value || '')
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function buildSelectionTagSummary(illustrations) {
  const selection = illustrations || [];
  const byTag = new Map();

  selection.forEach((illustration) => {
    parseIllustrationTags(illustration.tags).forEach((tag) => {
      const key = tag.toLocaleLowerCase();
      const entry = byTag.get(key) || { tag, illustrations: [] };
      entry.illustrations.push(illustration);
      byTag.set(key, entry);
    });
  });

  const entries = [...byTag.values()].map((entry) => ({
    ...entry,
    count: entry.illustrations.length,
  }));
  const byName = (a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' });

  return {
    common: entries
      .filter((entry) => entry.count === selection.length && selection.length > 0)
      .sort(byName),
    partial: entries
      .filter((entry) => entry.count < selection.length)
      .sort((a, b) => b.count - a.count || byName(a, b)),
    total: selection.length,
  };
}
