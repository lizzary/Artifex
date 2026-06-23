import { useState, useCallback, useEffect, useRef } from 'react';
import { getSettings, updateSettings } from '../api';

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

// ── Module-level cache so multiple hook instances coordinate ────────────
//
// Without this, every (scope, type) pair would race to read/write the same
// settings blob and stomp each other. The cache holds the latest known
// `group_configs` map; reads are coalesced through `ensureLoaded()` and writes
// flush via a single in-flight PUT chain.
let cachedConfigs = null;
let loadPromise = null;
let writeChain = Promise.resolve();

function ensureLoaded() {
  if (cachedConfigs !== null) return Promise.resolve(cachedConfigs);
  if (loadPromise) return loadPromise;
  loadPromise = getSettings()
    .then((s) => {
      cachedConfigs = (s && typeof s.group_configs === 'object' && s.group_configs) ? s.group_configs : {};
      return cachedConfigs;
    })
    .catch(() => {
      cachedConfigs = {};
      return cachedConfigs;
    })
    .finally(() => { loadPromise = null; });
  return loadPromise;
}

function persistEntry(scope, type, value) {
  // Serialize writes so concurrent mutations from different (scope, type)
  // pairs don't race; each one reads the latest cache and writes a fresh blob.
  writeChain = writeChain.then(async () => {
    const configs = cachedConfigs ? { ...cachedConfigs } : {};
    const scoped = configs[scope] ? { ...configs[scope] } : {};
    scoped[type] = value;
    configs[scope] = scoped;
    cachedConfigs = configs;
    try {
      await updateSettings({ group_configs: configs });
    } catch { /* swallow — next mutation will retry */ }
  });
  return writeChain;
}

// ── Legacy localStorage migration ───────────────────────────────────────

function legacySetsKey(scope, type) { return `gallery_group_${scope}_${type}_sets`; }
function legacyActiveKey(scope, type) { return `gallery_group_${scope}_${type}_active`; }
// Even older keys, only relevant for the global scope.
function oldSetsKey(type) { return `gallery_group_${type}_sets`; }
function oldActiveKey(type) { return `gallery_group_${type}_active`; }
function oldConfigKey(type) { return `gallery_group_${type}_config`; }

function readLegacyEntry(scope, type) {
  try {
    const setsRaw = localStorage.getItem(legacySetsKey(scope, type));
    if (setsRaw) {
      const sets = JSON.parse(setsRaw).map((s) => ({ ...s, pairs: assignColors(s.pairs || []) }));
      const stored = localStorage.getItem(legacyActiveKey(scope, type));
      const activeId = (stored && sets.some((s) => s.id === stored)) ? stored : (sets[0]?.id || null);
      return { sets, active_id: activeId };
    }
  } catch { /* fall through */ }

  if (scope === GLOBAL_SCOPE) {
    try {
      const setsRaw = localStorage.getItem(oldSetsKey(type));
      if (setsRaw) {
        const sets = JSON.parse(setsRaw).map((s) => ({ ...s, pairs: assignColors(s.pairs || []) }));
        const stored = localStorage.getItem(oldActiveKey(type));
        const activeId = (stored && sets.some((s) => s.id === stored)) ? stored : (sets[0]?.id || null);
        return { sets, active_id: activeId };
      }
    } catch { /* fall through */ }

    try {
      const cfgRaw = localStorage.getItem(oldConfigKey(type));
      if (cfgRaw) {
        const data = JSON.parse(cfgRaw);
        const setId = genSetId();
        return {
          sets: [{ id: setId, name: 'Default', pairs: assignColors(data.pairs || []) }],
          active_id: setId,
        };
      }
    } catch { /* ignore */ }
  }

  return null;
}

function dropLegacyEntry(scope, type) {
  try {
    localStorage.removeItem(legacySetsKey(scope, type));
    localStorage.removeItem(legacyActiveKey(scope, type));
    if (scope === GLOBAL_SCOPE) {
      localStorage.removeItem(oldSetsKey(type));
      localStorage.removeItem(oldActiveKey(type));
      localStorage.removeItem(oldConfigKey(type));
    }
  } catch { /* ignore */ }
}

// ── Helpers ─────────────────────────────────────────────────────────────

let _idCounter = 1;
function genSetId() { return `set_${Date.now()}_${_idCounter++}`; }
function genPairId() { return `pair_${Date.now()}_${_idCounter++}`; }

function assignColors(pairs) {
  // Color sticks to the pair, not its position — drag-reorder preserves
  // each group's color. Only fills in defaults for pairs that don't have one yet.
  return pairs.map((p, i) => ({
    ...p,
    color: p.color || GROUP_COLORS[i % GROUP_COLORS.length].bg,
    borderColor: p.borderColor || GROUP_COLORS[i % GROUP_COLORS.length].border,
  }));
}

function cloneGlobalForScope(globalEntry) {
  // Re-id everything so the per-group scope can drift independently from the
  // global template.
  const cloned = globalEntry.sets.map((s) => ({
    id: genSetId(),
    name: s.name,
    pairs: assignColors(
      (s.pairs || []).map((p) => ({
        id: genPairId(),
        keywords: [...(p.keywords || [])],
      })),
    ),
  }));
  return { sets: cloned, active_id: cloned[0]?.id || null };
}

function makeDefaultEntry() {
  const defaultSet = { id: genSetId(), name: 'Default', pairs: [] };
  return { sets: [defaultSet], active_id: defaultSet.id };
}

// ── Hook ────────────────────────────────────────────────────────────────

export default function useGroupConfig(type, scope = GLOBAL_SCOPE) {
  const [state, setState] = useState({ sets: [], activeId: null });
  // Latest state ref for the debounced flush — avoids closure staleness.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Initial load: pull from cache (or settings → cache), with legacy
  // localStorage migration and per-group seeding from global.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const configs = await ensureLoaded();
      if (cancelled) return;

      const remote = configs?.[scope]?.[type];
      if (remote && Array.isArray(remote.sets) && remote.sets.length > 0) {
        const sets = remote.sets.map((s) => ({ ...s, pairs: assignColors(s.pairs || []) }));
        const activeId = (remote.active_id && sets.some((s) => s.id === remote.active_id))
          ? remote.active_id
          : sets[0].id;
        setState({ sets, activeId });
        return;
      }

      // Try migrating from localStorage on first server-empty load.
      const legacy = readLegacyEntry(scope, type);
      if (legacy && legacy.sets.length > 0) {
        setState({ sets: legacy.sets, activeId: legacy.active_id });
        persistEntry(scope, type, { sets: legacy.sets, active_id: legacy.active_id })
          .then(() => dropLegacyEntry(scope, type));
        return;
      }

      // For per-group scopes, seed from global if it exists so the user keeps
      // the same defaults they'd configured globally.
      if (scope !== GLOBAL_SCOPE) {
        const globalEntry = configs?.[GLOBAL_SCOPE]?.[type];
        if (globalEntry && Array.isArray(globalEntry.sets) && globalEntry.sets.length > 0) {
          const seeded = cloneGlobalForScope({
            sets: globalEntry.sets.map((s) => ({ ...s, pairs: assignColors(s.pairs || []) })),
          });
          setState({ sets: seeded.sets, activeId: seeded.active_id });
          persistEntry(scope, type, seeded);
          return;
        }
      }

      // Nothing yet — create a fresh default entry and persist it.
      const fresh = makeDefaultEntry();
      setState({ sets: fresh.sets, activeId: fresh.active_id });
      persistEntry(scope, type, fresh);
    })();

    return () => { cancelled = true; };
  }, [scope, type]);

  const flushNow = useCallback(() => {
    const { sets, activeId } = stateRef.current;
    if (!sets || sets.length === 0) return;
    persistEntry(scope, type, { sets, active_id: activeId });
  }, [scope, type]);

  const { sets, activeId } = state;
  const activeSet = sets.find((s) => s.id === activeId) || sets[0];

  const switchSet = useCallback((id) => {
    setState((prev) => {
      if (prev.activeId === id) return prev;
      const next = { ...prev, activeId: id };
      stateRef.current = next;
      persistEntry(scope, type, { sets: next.sets, active_id: next.activeId });
      return next;
    });
  }, [scope, type]);

  const addSet = useCallback((name) => {
    setState((prev) => {
      const newSet = {
        id: genSetId(),
        name: name || `Set ${prev.sets.length + 1}`,
        pairs: [],
      };
      const sets = [...prev.sets, newSet];
      const next = { sets, activeId: newSet.id };
      stateRef.current = next;
      persistEntry(scope, type, { sets, active_id: next.activeId });
      return next;
    });
  }, [scope, type]);

  const removeSet = useCallback((id) => {
    setState((prev) => {
      if (prev.sets.length <= 1) return prev;
      const sets = prev.sets.filter((s) => s.id !== id);
      const activeId = prev.activeId === id ? sets[0].id : prev.activeId;
      const next = { sets, activeId };
      stateRef.current = next;
      persistEntry(scope, type, { sets, active_id: activeId });
      return next;
    });
  }, [scope, type]);

  const renameSet = useCallback((id, name) => {
    setState((prev) => {
      const sets = prev.sets.map((s) => (s.id === id ? { ...s, name } : s));
      const next = { ...prev, sets };
      stateRef.current = next;
      persistEntry(scope, type, { sets, active_id: prev.activeId });
      return next;
    });
  }, [scope, type]);

  const setPairs = useCallback((pairs) => {
    setState((prev) => {
      const sets = prev.sets.map((s) =>
        s.id === prev.activeId ? { ...s, pairs: assignColors(pairs) } : s
      );
      const next = { ...prev, sets };
      stateRef.current = next;
      persistEntry(scope, type, { sets, active_id: prev.activeId });
      return next;
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
    flushNow,
  };
}
