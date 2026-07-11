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

function legacySetsKey(scope, type) { return `gallery_group_${scope}_${type}_sets`; }
function legacyActiveKey(scope, type) { return `gallery_group_${scope}_${type}_active`; }
function oldSetsKey(type) { return `gallery_group_${type}_sets`; }
function oldActiveKey(type) { return `gallery_group_${type}_active`; }
function oldConfigKey(type) { return `gallery_group_${type}_config`; }

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

function readLegacyEntry(scope, type) {
  try {
    const setsRaw = localStorage.getItem(legacySetsKey(scope, type));
    if (setsRaw) {
      return normalizeEntry({
        sets: JSON.parse(setsRaw),
        active_id: localStorage.getItem(legacyActiveKey(scope, type)),
      }, type);
    }
  } catch { /* fall through */ }

  if (scope === GLOBAL_SCOPE) {
    try {
      const setsRaw = localStorage.getItem(oldSetsKey(type));
      if (setsRaw) {
        return normalizeEntry({
          sets: JSON.parse(setsRaw),
          active_id: localStorage.getItem(oldActiveKey(type)),
        }, type);
      }
    } catch { /* fall through */ }

    try {
      const configRaw = localStorage.getItem(oldConfigKey(type));
      if (configRaw) {
        const data = JSON.parse(configRaw);
        const setId = genSetId();
        return normalizeEntry({
          sets: [{ id: setId, name: 'Default', pairs: data.pairs || [] }],
          active_id: setId,
        }, type);
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

function legacySourcesForScope(configs, scope) {
  return ['tag', 'prompt'].flatMap((sourceType) => {
    const remote = configs?.[scope]?.[sourceType];
    const entry = remote?.sets?.length
      ? normalizeEntry(remote, sourceType)
      : readLegacyEntry(scope, sourceType);
    return entry?.sets?.length ? [{ sourceType, entry }] : [];
  });
}

function mergeLegacySources(sources) {
  const setsByName = new Map();
  let activeId = null;

  for (const { sourceType, entry } of sources) {
    const nameOccurrences = new Map();
    for (const sourceSet of entry.sets) {
      const name = sourceSet.name || 'Default';
      const occurrence = nameOccurrences.get(name) || 0;
      nameOccurrences.set(name, occurrence + 1);
      const mergeKey = `${name}\u0000${occurrence}`;
      let target = setsByName.get(mergeKey);
      if (!target) {
        target = { id: genSetId(), name, pairs: [], match_order: [] };
        setsByName.set(mergeKey, target);
      }

      const idMap = new Map();
      const migratedPairs = sourceSet.pairs.map((pair) => {
        const nextId = genPairId();
        idMap.set(pair.id, nextId);
        return {
          ...pair,
          id: nextId,
          terms: normalizePairTerms(pair, sourceType),
        };
      });
      target.pairs.push(...migratedPairs);
      const sourceOrder = normalizeMatchOrder(sourceSet.match_order, sourceSet.pairs);
      target.match_order.push(...sourceOrder.map((id) => idMap.get(id)).filter(Boolean));

      if (!activeId && sourceSet.id === entry.active_id) activeId = target.id;
    }
  }

  const sets = [...setsByName.values()];
  return normalizeEntry({ sets, active_id: activeId || sets[0]?.id }, 'all');
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

      const sameTypeLegacy = readLegacyEntry(scope, type);
      if (sameTypeLegacy?.sets?.length) {
        setState({ sets: sameTypeLegacy.sets, activeId: sameTypeLegacy.active_id });
        persistEntry(scope, type, sameTypeLegacy).then(() => dropLegacyEntry(scope, type));
        return;
      }

      // The unified configuration absorbs both former tag and prompt configs.
      // Sets with the same name are merged; each legacy term keeps its original
      // source scope so migration cannot broaden an existing rule.
      if (type === 'mixed') {
        const sources = legacySourcesForScope(configs, scope);
        if (sources.length > 0) {
          const merged = mergeLegacySources(sources);
          setState({ sets: merged.sets, activeId: merged.active_id });
          persistEntry(scope, type, merged).then(() => {
            dropLegacyEntry(scope, 'tag');
            dropLegacyEntry(scope, 'prompt');
          });
          return;
        }
      }

      if (scope !== GLOBAL_SCOPE) {
        let globalEntry = configs?.[GLOBAL_SCOPE]?.[type];
        if (!globalEntry?.sets?.length && type === 'mixed') {
          const globalSources = legacySourcesForScope(configs, GLOBAL_SCOPE);
          if (globalSources.length > 0) {
            globalEntry = mergeLegacySources(globalSources);
            persistEntry(GLOBAL_SCOPE, type, globalEntry);
          }
        }
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
