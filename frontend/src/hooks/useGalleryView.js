import { useCallback, useState } from 'react';

const GROUP_BY_STORAGE_KEY = 'gallery-group-by';

function readStoredGroupBy() {
  try {
    return localStorage.getItem(GROUP_BY_STORAGE_KEY) === 'mixed' ? 'mixed' : 'none';
  } catch {
    return 'none';
  }
}

export function useGroupBy() {
  const [groupBy, setGroupByState] = useState(readStoredGroupBy);

  const setGroupBy = useCallback((value) => {
    const next = value === 'mixed' ? 'mixed' : 'none';
    setGroupByState(next);
    try { localStorage.setItem(GROUP_BY_STORAGE_KEY, next); } catch { /* storage unavailable */ }
  }, []);

  return [groupBy, setGroupBy];
}

export function useIllustrationSelection(illustrations, onOpen) {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [lastClickedId, setLastClickedId] = useState(null);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastClickedId(null);
  }, []);

  const removeFromSelection = useCallback((ids) => {
    const removed = new Set(ids);
    setSelectedIds((previous) => new Set(
      [...previous].filter((id) => !removed.has(id)),
    ));
    setLastClickedId(null);
  }, []);

  const handleCardClick = useCallback((illustration) => {
    clearSelection();
    setLastClickedId(illustration.id);
    const index = illustrations.findIndex((item) => item.id === illustration.id);
    if (index !== -1) onOpen(index);
  }, [clearSelection, illustrations, onOpen]);

  const handleCtrlClick = useCallback((illustration) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(illustration.id)) next.delete(illustration.id);
      else next.add(illustration.id);
      return next;
    });
    setLastClickedId(illustration.id);
  }, []);

  const handleShiftClick = useCallback((illustration) => {
    if (lastClickedId === null) {
      handleCtrlClick(illustration);
      return;
    }

    const previousIndex = illustrations.findIndex((item) => item.id === lastClickedId);
    const currentIndex = illustrations.findIndex((item) => item.id === illustration.id);
    if (previousIndex === -1 || currentIndex === -1) return;

    const start = Math.min(previousIndex, currentIndex);
    const end = Math.max(previousIndex, currentIndex);
    const rangeIds = illustrations.slice(start, end + 1).map((item) => item.id);
    setSelectedIds((previous) => new Set([...previous, ...rangeIds]));
    setLastClickedId(illustration.id);
  }, [handleCtrlClick, illustrations, lastClickedId]);

  return {
    selectedIds,
    clearSelection,
    removeFromSelection,
    handleCardClick,
    handleCtrlClick,
    handleShiftClick,
  };
}

export function filterIllustrations(illustrations, query, scope = 'all') {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return illustrations;

  return illustrations.filter((illustration) => {
    const tags = (illustration.tags || '').toLowerCase();
    const extendedData = illustration.extended_data || {};
    const prompt = [
      extendedData['Positive Prompt'] || '',
      extendedData['Negative Prompt'] || '',
    ].join(' ').toLowerCase();

    if (scope === 'tag') return tags.includes(normalizedQuery);
    if (scope === 'prompt') return prompt.includes(normalizedQuery);
    return tags.includes(normalizedQuery) || prompt.includes(normalizedQuery);
  });
}

export function flattenVisibleGroups(groups, collapsedGroups) {
  if (!groups) return null;
  return groups.flatMap((group) => (
    collapsedGroups.has(group.id) ? [] : group.items
  ));
}
