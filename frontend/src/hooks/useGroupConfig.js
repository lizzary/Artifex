import { useState, useCallback, useEffect } from 'react';

const GROUP_COLORS = [
  { bg: 'rgba(239, 68, 68, 0.08)', border: 'rgba(239, 68, 68, 0.35)' },
  { bg: 'rgba(59, 130, 246, 0.08)', border: 'rgba(59, 130, 246, 0.35)' },
  { bg: 'rgba(34, 197, 94, 0.08)', border: 'rgba(34, 197, 94, 0.35)' },
  { bg: 'rgba(251, 191, 36, 0.08)', border: 'rgba(251, 191, 36, 0.35)' },
  { bg: 'rgba(168, 85, 247, 0.08)', border: 'rgba(168, 85, 247, 0.35)' },
  { bg: 'rgba(236, 72, 153, 0.08)', border: 'rgba(236, 72, 153, 0.35)' },
  { bg: 'rgba(20, 184, 166, 0.08)', border: 'rgba(20, 184, 166, 0.35)' },
  { bg: 'rgba(249, 115, 22, 0.08)', border: 'rgba(249, 115, 22, 0.35)' },
  { bg: 'rgba(99, 102, 241, 0.08)', border: 'rgba(99, 102, 241, 0.35)' },
  { bg: 'rgba(244, 114, 182, 0.08)', border: 'rgba(244, 114, 182, 0.35)' },
];

const OTHER_COLOR = { bg: 'rgba(156, 163, 175, 0.06)', border: 'rgba(156, 163, 175, 0.25)' };

const GLOBAL_SCOPE = 'global';

function getSetsKey(scope, type) {
  return `gallery_group_${scope}_${type}_sets`;
}

function getActiveKey(scope, type) {
  return `gallery_group_${scope}_${type}_active`;
}

// Legacy keys (pre per-scope refactor) — read-once for migration into the global scope.
function getLegacySetsKey(type) {
  return `gallery_group_${type}_sets`;
}

function getLegacyActiveKey(type) {
  return `gallery_group_${type}_active`;
}

function getLegacyConfigKey(type) {
  return `gallery_group_${type}_config`;
}

let _nextId = 1;
function genSetId() {
  return `set_${Date.now()}_${_nextId++}`;
}

function genPairId() {
  return `pair_${Date.now()}_${_nextId++}`;
}

function assignColors(pairs) {
  return pairs.map((p, i) => ({
    ...p,
    color: p.color || GROUP_COLORS[i % GROUP_COLORS.length].bg,
    borderColor: p.borderColor || GROUP_COLORS[i % GROUP_COLORS.length].border,
  }));
}

function readSets(scope, type) {
  try {
    const raw = localStorage.getItem(getSetsKey(scope, type));
    if (!raw) return null;
    return JSON.parse(raw).map((s) => ({ ...s, pairs: assignColors(s.pairs || []) }));
  } catch {
    return null;
  }
}

function pickActiveId(scope, type, sets) {
  const stored = localStorage.getItem(getActiveKey(scope, type));
  if (stored && sets.some((s) => s.id === stored)) return stored;
  return sets[0]?.id || null;
}

// Migrate legacy global-only storage into the new global-scoped keys (one-time).
function migrateLegacyGlobalIfNeeded(type) {
  const newKey = getSetsKey(GLOBAL_SCOPE, type);
  if (localStorage.getItem(newKey)) return;

  const legacySetsRaw = localStorage.getItem(getLegacySetsKey(type));
  if (legacySetsRaw) {
    localStorage.setItem(newKey, legacySetsRaw);
    const legacyActive = localStorage.getItem(getLegacyActiveKey(type));
    if (legacyActive) {
      localStorage.setItem(getActiveKey(GLOBAL_SCOPE, type), legacyActive);
    }
    localStorage.removeItem(getLegacySetsKey(type));
    localStorage.removeItem(getLegacyActiveKey(type));
    return;
  }

  // Older legacy: single-config blob
  const legacyConfigRaw = localStorage.getItem(getLegacyConfigKey(type));
  if (legacyConfigRaw) {
    try {
      const data = JSON.parse(legacyConfigRaw);
      const defaultSet = {
        id: genSetId(),
        name: 'Default',
        pairs: assignColors(data.pairs || []),
      };
      localStorage.setItem(newKey, JSON.stringify([defaultSet]));
      localStorage.setItem(getActiveKey(GLOBAL_SCOPE, type), defaultSet.id);
      localStorage.removeItem(getLegacyConfigKey(type));
    } catch { /* ignore */ }
  }
}

// Seed a per-group scope from the global config (one-time per scope/type).
// Clones sets with fresh ids so subsequent edits stay local to this group.
function seedFromGlobalIfNeeded(scope, type) {
  if (scope === GLOBAL_SCOPE) return null;
  if (localStorage.getItem(getSetsKey(scope, type))) return null;

  const globalSets = readSets(GLOBAL_SCOPE, type);
  if (!globalSets || globalSets.length === 0) return null;

  const cloned = globalSets.map((s) => ({
    id: genSetId(),
    name: s.name,
    pairs: assignColors(
      (s.pairs || []).map((p) => ({
        id: genPairId(),
        keywords: [...(p.keywords || [])],
      })),
    ),
  }));
  saveSets(scope, type, cloned);
  saveActiveId(scope, type, cloned[0].id);
  return { sets: cloned, activeId: cloned[0].id };
}

function loadState(scope, type) {
  // For the global scope, migrate any legacy keys first so they become readable here.
  if (scope === GLOBAL_SCOPE) {
    migrateLegacyGlobalIfNeeded(type);
  } else {
    // For a per-group scope, the legacy keys still live under the global scope —
    // make sure they exist there before we try to seed from them.
    migrateLegacyGlobalIfNeeded(type);
    const seeded = seedFromGlobalIfNeeded(scope, type);
    if (seeded) return seeded;
  }

  const existing = readSets(scope, type);
  if (existing) {
    return { sets: existing, activeId: pickActiveId(scope, type, existing) };
  }

  const defaultSet = { id: genSetId(), name: 'Default', pairs: [] };
  saveSets(scope, type, [defaultSet]);
  saveActiveId(scope, type, defaultSet.id);
  return { sets: [defaultSet], activeId: defaultSet.id };
}

export default function useGroupConfig(type, scope = GLOBAL_SCOPE) {
  const [state, setState] = useState(() => loadState(scope, type));

  // Re-load when the scope changes (e.g. switching between groups in nested overlays).
  useEffect(() => {
    setState(loadState(scope, type));
  }, [scope, type]);

  const { sets, activeId } = state;
  const activeSet = sets.find((s) => s.id === activeId) || sets[0];

  const switchSet = useCallback((id) => {
    setState((prev) => {
      if (prev.activeId === id) return prev;
      saveActiveId(scope, type, id);
      return { ...prev, activeId: id };
    });
  }, [scope, type]);

  const addSet = useCallback((name) => {
    setState((prev) => {
      const newSet = {
        id: genSetId(),
        name: name || `Set ${prev.sets.length + 1}`,
        pairs: [],
      };
      const updated = [...prev.sets, newSet];
      saveSets(scope, type, updated);
      saveActiveId(scope, type, newSet.id);
      return { sets: updated, activeId: newSet.id };
    });
  }, [scope, type]);

  const removeSet = useCallback((id) => {
    setState((prev) => {
      if (prev.sets.length <= 1) return prev;
      const updated = prev.sets.filter((s) => s.id !== id);
      const newActiveId = prev.activeId === id ? updated[0].id : prev.activeId;
      saveSets(scope, type, updated);
      saveActiveId(scope, type, newActiveId);
      return { sets: updated, activeId: newActiveId };
    });
  }, [scope, type]);

  const renameSet = useCallback((id, name) => {
    setState((prev) => {
      const updated = prev.sets.map((s) => (s.id === id ? { ...s, name } : s));
      saveSets(scope, type, updated);
      return { ...prev, sets: updated };
    });
  }, [scope, type]);

  const setPairs = useCallback((pairs) => {
    setState((prev) => {
      const updated = prev.sets.map((s) =>
        s.id === prev.activeId ? { ...s, pairs: assignColors(pairs) } : s
      );
      saveSets(scope, type, updated);
      return { ...prev, sets: updated };
    });
  }, [scope, type]);

  return {
    sets,
    activeSetId: activeId,
    activeSet: activeSet || sets[0],
    // Backward-compatible convenience accessors
    pairs: activeSet?.pairs || [],
    setPairs,
    otherColor: OTHER_COLOR,
    palette: GROUP_COLORS,
    // Set management
    switchSet,
    addSet,
    removeSet,
    renameSet,
  };
}

function saveSets(scope, type, sets) {
  localStorage.setItem(getSetsKey(scope, type), JSON.stringify(sets));
}

function saveActiveId(scope, type, id) {
  localStorage.setItem(getActiveKey(scope, type), id);
}
