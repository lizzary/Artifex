import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSettings, updateSettings } from '../api';
import { normalizeManualAssignments, normalizePairTerms } from '../utils/grouping';

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

const OTHER_COLOR = {
  bg: 'rgba(156, 163, 175, 0.06)',
  border: 'rgba(156, 163, 175, 0.25)',
};
const GLOBAL_SCOPE = 'global';
const CONFIG_TYPE = 'mixed';

let cachedConfigs = null;
let loadPromise = null;
let writeChain = Promise.resolve();
let idCounter = 1;

function genSetId() { return `set_${Date.now()}_${idCounter++}`; }
function genPairId() { return `pair_${Date.now()}_${idCounter++}`; }

function currentConfigsOnly(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value).reduce((result, [scope, scoped]) => {
    if (scoped?.[CONFIG_TYPE] && typeof scoped[CONFIG_TYPE] === 'object') {
      const normalized = normalizeEntry(scoped[CONFIG_TYPE]);
      if (normalized.sets.length > 0) result[scope] = { [CONFIG_TYPE]: normalized };
    }
    return result;
  }, {});
}

function ensureLoaded() {
  if (cachedConfigs !== null) return Promise.resolve(cachedConfigs);
  if (loadPromise) return loadPromise;

  loadPromise = getSettings()
    .then(async (settings) => {
      const stored = settings?.group_configs;
      cachedConfigs = currentConfigsOnly(stored);
      if (JSON.stringify(cachedConfigs) !== JSON.stringify(stored || {})) {
        await updateSettings({ group_configs: cachedConfigs }).catch(() => {});
      }
      return cachedConfigs;
    })
    .catch(() => {
      cachedConfigs = {};
      return cachedConfigs;
    })
    .finally(() => { loadPromise = null; });
  return loadPromise;
}

async function mutateConfigs(transform) {
  await ensureLoaded();
  const operation = writeChain.then(async () => {
    const previous = cachedConfigs || {};
    const next = transform(previous);
    if (next === previous) return false;
    cachedConfigs = next;
    await updateSettings({ group_configs: next });
    return true;
  });
  writeChain = operation.catch(() => {});
  return operation;
}

function persistEntry(scope, value) {
  void mutateConfigs((configs) => ({
    ...configs,
    [scope]: { [CONFIG_TYPE]: value },
  })).catch(() => {});
}

function normalizeMatchOrder(order, pairs) {
  const ids = new Set(pairs.map((pair) => pair.id));
  const supplied = Array.isArray(order) ? order.filter((id) => ids.has(id)) : [];
  return [...supplied, ...pairs.map((pair) => pair.id).filter((id) => !supplied.includes(id))];
}

function assignColors(pairs) {
  return pairs.map((pair, index) => ({
    id: pair?.id || genPairId(),
    customName: typeof pair?.customName === 'string' ? pair.customName : '',
    terms: normalizePairTerms(pair),
    color: pair?.color || GROUP_COLORS[index % GROUP_COLORS.length].bg,
    borderColor: pair?.borderColor || GROUP_COLORS[index % GROUP_COLORS.length].border,
  }));
}

function normalizeEntry(entry) {
  const rawSets = Array.isArray(entry?.sets) ? entry.sets : [];
  const sets = rawSets.map((set, index) => {
    const pairs = assignColors(Array.isArray(set?.pairs) ? set.pairs : []);
    return {
      id: set?.id || genSetId(),
      name: set?.name || `Set ${index + 1}`,
      pairs,
      match_order: normalizeMatchOrder(set?.match_order, pairs),
      manual_assignments: normalizeManualAssignments(set?.manual_assignments, pairs),
    };
  });
  const activeId = entry?.active_id && sets.some((set) => set.id === entry.active_id)
    ? entry.active_id
    : (sets[0]?.id || null);
  return { sets, active_id: activeId };
}

function cloneEntryForScope(entry) {
  const normalized = normalizeEntry(entry);
  const setIdMap = new Map();
  const sets = normalized.sets.map((set) => {
    const setId = genSetId();
    setIdMap.set(set.id, setId);
    const pairIdMap = new Map();
    const pairs = set.pairs.map((pair) => {
      const pairId = genPairId();
      pairIdMap.set(pair.id, pairId);
      return { ...pair, id: pairId, terms: pair.terms.map((term) => ({ ...term })) };
    });
    return {
      ...set,
      id: setId,
      pairs,
      match_order: set.match_order.map((id) => pairIdMap.get(id)).filter(Boolean),
      manual_assignments: Object.entries(set.manual_assignments).reduce(
        (assignments, [illustrationId, pairId]) => {
          const clonedPairId = pairIdMap.get(pairId);
          if (clonedPairId) assignments[illustrationId] = clonedPairId;
          return assignments;
        },
        {},
      ),
    };
  });
  return {
    sets,
    active_id: setIdMap.get(normalized.active_id) || sets[0]?.id || null,
  };
}

function makeDefaultEntry() {
  const defaultSet = {
    id: genSetId(),
    name: 'Default',
    pairs: [],
    match_order: [],
    manual_assignments: {},
  };
  return { sets: [defaultSet], active_id: defaultSet.id };
}

export async function removeManualAssignmentsForIllustrations(illustrationIds) {
  const ids = new Set((illustrationIds || []).map(String));
  if (ids.size === 0) return false;

  return mutateConfigs((configs) => {
    let changed = false;
    const next = Object.fromEntries(Object.entries(configs).map(([scope, scoped]) => {
      const entry = scoped[CONFIG_TYPE];
      let scopeChanged = false;
      const sets = entry.sets.map((set) => {
        const manualAssignments = { ...set.manual_assignments };
        let setChanged = false;
        ids.forEach((id) => {
          if (Object.hasOwn(manualAssignments, id)) {
            delete manualAssignments[id];
            setChanged = true;
          }
        });
        if (!setChanged) return set;
        changed = true;
        scopeChanged = true;
        return { ...set, manual_assignments: manualAssignments };
      });
      return [scope, scopeChanged ? { [CONFIG_TYPE]: { ...entry, sets } } : scoped];
    }));
    return changed ? next : configs;
  });
}

export async function removeGroupConfigScope(groupId) {
  const scope = `group_${groupId}`;
  return mutateConfigs((configs) => {
    if (!Object.hasOwn(configs, scope)) return configs;
    const next = { ...configs };
    delete next[scope];
    return next;
  });
}

export default function useGroupConfig(scope = GLOBAL_SCOPE) {
  const [state, setState] = useState({ sets: [], activeId: null });

  useEffect(() => {
    let cancelled = false;
    ensureLoaded().then((configs) => {
      if (cancelled) return;
      const remote = configs?.[scope]?.[CONFIG_TYPE];
      if (remote?.sets?.length) {
        const normalized = normalizeEntry(remote);
        setState({ sets: normalized.sets, activeId: normalized.active_id });
        return;
      }

      if (scope !== GLOBAL_SCOPE) {
        const globalEntry = configs?.[GLOBAL_SCOPE]?.[CONFIG_TYPE];
        if (globalEntry?.sets?.length) {
          const seeded = cloneEntryForScope(globalEntry);
          setState({ sets: seeded.sets, activeId: seeded.active_id });
          persistEntry(scope, seeded);
          return;
        }
      }

      const fresh = makeDefaultEntry();
      setState({ sets: fresh.sets, activeId: fresh.active_id });
      persistEntry(scope, fresh);
    });
    return () => { cancelled = true; };
  }, [scope]);

  const switchSet = useCallback((id) => {
    setState((previous) => {
      if (previous.activeId === id) return previous;
      const next = { ...previous, activeId: id };
      persistEntry(scope, { sets: next.sets, active_id: id });
      return next;
    });
  }, [scope]);

  const addSet = useCallback((name) => {
    setState((previous) => {
      const newSet = {
        id: genSetId(),
        name: name || `Set ${previous.sets.length + 1}`,
        pairs: [],
        match_order: [],
        manual_assignments: {},
      };
      const next = { sets: [...previous.sets, newSet], activeId: newSet.id };
      persistEntry(scope, { sets: next.sets, active_id: next.activeId });
      return next;
    });
  }, [scope]);

  const removeSet = useCallback((id) => {
    setState((previous) => {
      if (previous.sets.length <= 1) return previous;
      const sets = previous.sets.filter((set) => set.id !== id);
      const activeId = previous.activeId === id ? sets[0].id : previous.activeId;
      persistEntry(scope, { sets, active_id: activeId });
      return { sets, activeId };
    });
  }, [scope]);

  const renameSet = useCallback((id, name) => {
    setState((previous) => {
      const sets = previous.sets.map((set) => (set.id === id ? { ...set, name } : set));
      persistEntry(scope, { sets, active_id: previous.activeId });
      return { ...previous, sets };
    });
  }, [scope]);

  const setPairs = useCallback((pairs, matchOrder) => {
    setState((previous) => {
      const sets = previous.sets.map((set) => {
        if (set.id !== previous.activeId) return set;
        const normalizedPairs = assignColors(pairs);
        return {
          ...set,
          pairs: normalizedPairs,
          match_order: normalizeMatchOrder(matchOrder ?? set.match_order, normalizedPairs),
          manual_assignments: normalizeManualAssignments(set.manual_assignments, normalizedPairs),
        };
      });
      persistEntry(scope, { sets, active_id: previous.activeId });
      return { ...previous, sets };
    });
  }, [scope]);

  const setManualGroupIds = useCallback((illustrationIds, groupId) => {
    const ids = [...new Set((illustrationIds || []).map(String))];
    if (ids.length === 0) return;
    setState((previous) => {
      const sets = previous.sets.map((set) => {
        if (set.id !== previous.activeId) return set;
        const validGroupIds = new Set(set.pairs.map((pair) => pair.id));
        const targetGroupId = validGroupIds.has(groupId) ? groupId : null;
        const manualAssignments = { ...set.manual_assignments };
        ids.forEach((illustrationId) => {
          if (targetGroupId) manualAssignments[illustrationId] = targetGroupId;
          else delete manualAssignments[illustrationId];
        });
        return { ...set, manual_assignments: manualAssignments };
      });
      persistEntry(scope, { sets, active_id: previous.activeId });
      return { ...previous, sets };
    });
  }, [scope]);

  const removeManualGroupIds = useCallback((illustrationIds) => {
    const ids = new Set((illustrationIds || []).map(String));
    if (ids.size === 0) return;
    setState((previous) => {
      let changed = false;
      const sets = previous.sets.map((set) => {
        const manualAssignments = { ...set.manual_assignments };
        let setChanged = false;
        ids.forEach((id) => {
          if (Object.hasOwn(manualAssignments, id)) {
            delete manualAssignments[id];
            setChanged = true;
          }
        });
        if (!setChanged) return set;
        changed = true;
        return { ...set, manual_assignments: manualAssignments };
      });
      if (!changed) return previous;
      persistEntry(scope, { sets, active_id: previous.activeId });
      return { ...previous, sets };
    });
  }, [scope]);

  const activeSet = useMemo(
    () => state.sets.find((set) => set.id === state.activeId) || state.sets[0],
    [state.activeId, state.sets],
  );

  return useMemo(() => ({
    sets: state.sets,
    activeSetId: state.activeId,
    pairs: activeSet?.pairs || [],
    matchOrder: activeSet?.match_order || [],
    manualAssignments: activeSet?.manual_assignments || {},
    setPairs,
    setManualGroupIds,
    removeManualGroupIds,
    otherColor: OTHER_COLOR,
    palette: GROUP_COLORS,
    switchSet,
    addSet,
    removeSet,
    renameSet,
  }), [
    activeSet,
    addSet,
    removeManualGroupIds,
    removeSet,
    renameSet,
    setManualGroupIds,
    setPairs,
    state.activeId,
    state.sets,
    switchSet,
  ]);
}
