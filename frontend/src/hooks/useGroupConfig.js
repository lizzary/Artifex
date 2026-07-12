import { useState, useCallback, useEffect, useRef } from 'react';
import { getSettings, updateSettings } from '../api';
import { normalizePairTerms } from '../utils/grouping';

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

// Multiple overlays can mount this hook. Keep one settings cache and serialize
// writes so separate scopes never overwrite one another with a stale blob.
let cachedConfigs = null;
let loadPromise = null;
let writeChain = Promise.resolve();

function ensureLoaded() {
  if (cachedConfigs !== null) return Promise.resolve(cachedConfigs);
  if (loadPromise) return loadPromise;
  loadPromise = getSettings()
    .then((settings) => {
      cachedConfigs = (settings && typeof settings.group_configs === 'object' && settings.group_configs)
        ? settings.group_configs
        : {};
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
  writeChain = writeChain.then(async () => {
    const configs = cachedConfigs ? { ...cachedConfigs } : {};
    const scoped = configs[scope] ? { ...configs[scope] } : {};
    scoped[type] = value;
    configs[scope] = scoped;
    cachedConfigs = configs;
    try {
      await updateSettings({ group_configs: configs });
    } catch { /* a later mutation retries with the latest cached value */ }
  });
  return writeChain;
}

let idCounter = 1;
function genSetId() { return `set_${Date.now()}_${idCounter++}`; }
function genPairId() { return `pair_${Date.now()}_${idCounter++}`; }

function normalizeMatchOrder(order, pairs) {
  const ids = new Set(pairs.map((pair) => pair.id));
  const supplied = Array.isArray(order) ? order.filter((id) => ids.has(id)) : [];
  return [...supplied, ...pairs.map((pair) => pair.id).filter((id) => !supplied.includes(id))];
}

function assignColors(pairs, fallbackScope = 'all') {
  return pairs.map((pair, index) => {
    const { keywords, ...rest } = pair || {};
    return {
      ...rest,
      id: pair?.id || genPairId(),
      customName: typeof pair?.customName === 'string' ? pair.customName : '',
      terms: normalizePairTerms(pair, fallbackScope),
      color: pair?.color || GROUP_COLORS[index % GROUP_COLORS.length].bg,
      borderColor: pair?.borderColor || GROUP_COLORS[index % GROUP_COLORS.length].border,
    };
  });
}

function normalizeEntry(entry, fallbackScope = 'all') {
  const rawSets = Array.isArray(entry?.sets) ? entry.sets : [];
  const sets = rawSets.map((set, index) => {
    const pairs = assignColors(set.pairs || [], fallbackScope);
    return {
      ...set,
      id: set.id || genSetId(),
      name: set.name || `Set ${index + 1}`,
      pairs,
      match_order: normalizeMatchOrder(set.match_order, pairs),
    };
  });
  const activeId = entry?.active_id && sets.some((set) => set.id === entry.active_id)
    ? entry.active_id
    : (sets[0]?.id || null);
  return { sets, active_id: activeId };
}

function cloneEntryForScope(entry) {
  const normalized = normalizeEntry(entry, 'all');
  const setIdMap = new Map();
  const sets = normalized.sets.map((set) => {
    const setId = genSetId();
    setIdMap.set(set.id, setId);
    const pairIdMap = new Map();
    const pairs = set.pairs.map((pair) => {
      const pairId = genPairId();
      pairIdMap.set(pair.id, pairId);
      return {
        ...pair,
        id: pairId,
        terms: normalizePairTerms(pair).map((term) => ({ ...term })),
      };
    });
    return {
      ...set,
      id: setId,
      pairs,
      match_order: normalizeMatchOrder(set.match_order, set.pairs).map((id) => pairIdMap.get(id)).filter(Boolean),
    };
  });
  return {
    sets,
    active_id: setIdMap.get(normalized.active_id) || sets[0]?.id || null,
  };
}

function makeDefaultEntry() {
  const defaultSet = { id: genSetId(), name: 'Default', pairs: [], match_order: [] };
  return { sets: [defaultSet], active_id: defaultSet.id };
}

export default function useGroupConfig(type, scope = GLOBAL_SCOPE) {
  const [state, setState] = useState({ sets: [], activeId: null });
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const configs = await ensureLoaded();
      if (cancelled) return;

      const remote = configs?.[scope]?.[type];
      if (remote?.sets?.length) {
        const normalized = normalizeEntry(remote, type === 'mixed' ? 'all' : type);
        setState({ sets: normalized.sets, activeId: normalized.active_id });
        return;
      }

      if (scope !== GLOBAL_SCOPE) {
        const globalEntry = configs?.[GLOBAL_SCOPE]?.[type];
        if (globalEntry?.sets?.length) {
          const seeded = cloneEntryForScope(globalEntry);
          setState({ sets: seeded.sets, activeId: seeded.active_id });
          persistEntry(scope, type, seeded);
          return;
        }
      }

      const fresh = makeDefaultEntry();
      setState({ sets: fresh.sets, activeId: fresh.active_id });
      persistEntry(scope, type, fresh);
    })();

    return () => { cancelled = true; };
  }, [scope, type]);

  const flushNow = useCallback(() => {
    const { sets, activeId } = stateRef.current;
    if (!sets?.length) return;
    persistEntry(scope, type, { sets, active_id: activeId });
  }, [scope, type]);

  const { sets, activeId } = state;
  const activeSet = sets.find((set) => set.id === activeId) || sets[0];

  const switchSet = useCallback((id) => {
    setState((previous) => {
      if (previous.activeId === id) return previous;
      const next = { ...previous, activeId: id };
      stateRef.current = next;
      persistEntry(scope, type, { sets: next.sets, active_id: id });
      return next;
    });
  }, [scope, type]);

  const addSet = useCallback((name) => {
    setState((previous) => {
      const newSet = {
        id: genSetId(),
        name: name || `Set ${previous.sets.length + 1}`,
        pairs: [],
        match_order: [],
      };
      const next = { sets: [...previous.sets, newSet], activeId: newSet.id };
      stateRef.current = next;
      persistEntry(scope, type, { sets: next.sets, active_id: next.activeId });
      return next;
    });
  }, [scope, type]);

  const removeSet = useCallback((id) => {
    setState((previous) => {
      if (previous.sets.length <= 1) return previous;
      const sets = previous.sets.filter((set) => set.id !== id);
      const activeId = previous.activeId === id ? sets[0].id : previous.activeId;
      const next = { sets, activeId };
      stateRef.current = next;
      persistEntry(scope, type, { sets, active_id: activeId });
      return next;
    });
  }, [scope, type]);

  const renameSet = useCallback((id, name) => {
    setState((previous) => {
      const sets = previous.sets.map((set) => (set.id === id ? { ...set, name } : set));
      const next = { ...previous, sets };
      stateRef.current = next;
      persistEntry(scope, type, { sets, active_id: previous.activeId });
      return next;
    });
  }, [scope, type]);

  const setPairs = useCallback((pairs, matchOrder) => {
    setState((previous) => {
      const sets = previous.sets.map((set) => {
        if (set.id !== previous.activeId) return set;
        const normalizedPairs = assignColors(pairs, 'all');
        return {
          ...set,
          pairs: normalizedPairs,
          match_order: normalizeMatchOrder(matchOrder ?? set.match_order, normalizedPairs),
        };
      });
      const next = { ...previous, sets };
      stateRef.current = next;
      persistEntry(scope, type, { sets, active_id: previous.activeId });
      return next;
    });
  }, [scope, type]);

  return {
    sets,
    activeSetId: activeId,
    activeSet: activeSet || sets[0],
    pairs: activeSet?.pairs || [],
    matchOrder: activeSet?.match_order || [],
    setPairs,
    otherColor: OTHER_COLOR,
    palette: GROUP_COLORS,
    switchSet,
    addSet,
    removeSet,
    renameSet,
    flushNow,
  };
}
