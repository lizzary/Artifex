import { useCallback, useMemo, useState } from 'react';
import { changeGroupSettings, useGroupSettings } from './useGroupSettings';
import { normalizeManualAssignments, validateExpression } from '../utils/grouping';
import { toHexColor } from '../utils/groupColors';

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

let idCounter = 1;
function genSetId() { return `set_${Date.now()}_${idCounter++}`; }
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = (value) => typeof value === 'string' && value.length > 0;

function validPair(pair) {
  if (!isObject(pair) || !isId(pair.id) || typeof pair.customName !== 'string'
    || !toHexColor(pair.color, null) || !toHexColor(pair.borderColor, null)
    || !Array.isArray(pair.terms)) return false;
  const validTerms = pair.terms.every((term) => isObject(term)
    && typeof term.value === 'string' && term.value.trim().length > 0
    && ['all', 'tag', 'prompt'].includes(term.scope)
    && ['and', 'or'].includes(term.operator) && typeof term.negated === 'boolean'
    && Number.isInteger(term.open) && term.open >= 0 && term.open <= 4
    && Number.isInteger(term.close) && term.close >= 0 && term.close <= 4);
  return validTerms && (pair.terms.length === 0 || validateExpression(pair).valid);
}

export function isColorConfig(entry) {
  if (!isObject(entry) || !Array.isArray(entry.sets)) return false;
  const setIds = new Set();
  for (const set of entry.sets) {
    if (!isObject(set) || !isId(set.id) || setIds.has(set.id)
      || typeof set.name !== 'string' || !Array.isArray(set.pairs)
      || !set.pairs.every(validPair) || !Array.isArray(set.match_order)
      || !isObject(set.manual_assignments)) return false;
    setIds.add(set.id);
    const pairIds = new Set(set.pairs.map((pair) => pair.id));
    if (pairIds.size !== set.pairs.length || set.match_order.length !== pairIds.size
      || new Set(set.match_order).size !== pairIds.size
      || !set.match_order.every((id) => pairIds.has(id))
      || !Object.entries(set.manual_assignments).every(([id, pairId]) => (
        /^[1-9]\d*$/.test(id) && pairIds.has(pairId)
      ))) return false;
  }
  return entry.sets.length === 0 ? entry.active_id === null : setIds.has(entry.active_id);
}

function makeEmptyEntry() {
  const set = { id: genSetId(), name: 'Default', pairs: [], match_order: [], manual_assignments: {} };
  return { sets: [set], active_id: set.id };
}

function usableEntry(value, emptyEntry) {
  return isColorConfig(value) && value.sets.length > 0 ? value : emptyEntry;
}

function normalizeMatchOrder(order, pairs) {
  const ids = new Set(pairs.map((pair) => pair.id));
  const supplied = [...new Set((order || []).filter((id) => ids.has(id)))];
  return [...supplied, ...pairs.map((pair) => pair.id).filter((id) => !supplied.includes(id))];
}

function withoutAssignments(entry, ids) {
  let changed = false;
  const sets = entry.sets.map((set) => {
    const manualAssignments = { ...set.manual_assignments };
    ids.forEach((id) => {
      if (Object.hasOwn(manualAssignments, id)) {
        delete manualAssignments[id];
        changed = true;
      }
    });
    return { ...set, manual_assignments: manualAssignments };
  });
  return changed ? { ...entry, sets } : entry;
}

export async function removeManualAssignmentsForIllustrations(illustrationIds) {
  const ids = new Set((illustrationIds || []).map(String));
  if (ids.size === 0) return false;
  return changeGroupSettings((data) => {
    const groups = {};
    Object.entries(data.groups).forEach(([id, group]) => {
      if (!isColorConfig(group.colors)) return;
      const colors = withoutAssignments(group.colors, ids);
      if (colors !== group.colors) groups[id] = { colors };
    });
    return Object.keys(groups).length ? { groups } : null;
  });
}

export default function useGroupConfig(groupId) {
  const { data, error } = useGroupSettings(groupId != null);
  const [emptyEntry] = useState(makeEmptyEntry);
  const [transientEntry, setTransientEntry] = useState(emptyEntry);
  const storedEntry = data.groups[groupId]?.colors;
  const entry = useMemo(() => groupId == null ? transientEntry : usableEntry(storedEntry, emptyEntry),
    [emptyEntry, groupId, storedEntry, transientEntry]);

  const changeEntry = useCallback((transform) => {
    if (groupId == null) {
      setTransientEntry(transform);
      return;
    }
    void changeGroupSettings((current) => {
      const previous = usableEntry(current.groups[groupId]?.colors, emptyEntry);
      const colors = transform(previous);
      return colors === previous ? null : { groups: { [groupId]: { colors } } };
    }).catch(() => {});
  }, [emptyEntry, groupId]);

  const switchSet = useCallback((id) => {
    changeEntry((previous) => previous.active_id === id || !previous.sets.some((set) => set.id === id)
      ? previous : { ...previous, active_id: id });
  }, [changeEntry]);

  const addSet = useCallback((name) => {
    const id = genSetId();
    changeEntry((previous) => ({
      sets: [...previous.sets, {
        id, name: name || `Set ${previous.sets.length + 1}`,
        pairs: [], match_order: [], manual_assignments: {},
      }],
      active_id: id,
    }));
  }, [changeEntry]);

  const removeSet = useCallback((id) => {
    changeEntry((previous) => {
      if (previous.sets.length <= 1) return previous;
      const sets = previous.sets.filter((set) => set.id !== id);
      return { sets, active_id: previous.active_id === id ? sets[0].id : previous.active_id };
    });
  }, [changeEntry]);

  const renameSet = useCallback((id, name) => {
    changeEntry((previous) => ({
      ...previous,
      sets: previous.sets.map((set) => set.id === id ? { ...set, name } : set),
    }));
  }, [changeEntry]);

  const setPairs = useCallback((pairs, matchOrder) => {
    changeEntry((previous) => ({
      ...previous,
      sets: previous.sets.map((set) => set.id !== previous.active_id ? set : {
        ...set,
        pairs,
        match_order: normalizeMatchOrder(matchOrder ?? set.match_order, pairs),
        manual_assignments: normalizeManualAssignments(set.manual_assignments, pairs),
      }),
    }));
  }, [changeEntry]);

  const renamePair = useCallback((id, name) => {
    changeEntry((previous) => ({
      ...previous,
      sets: previous.sets.map((set) => set.id !== previous.active_id ? set : {
        ...set,
        pairs: set.pairs.map((pair) => pair.id === id ? { ...pair, customName: name.trim() } : pair),
      }),
    }));
  }, [changeEntry]);

  const setManualGroupIds = useCallback((illustrationIds, pairId) => {
    const ids = [...new Set((illustrationIds || []).map(String))];
    if (ids.length === 0) return;
    changeEntry((previous) => ({
      ...previous,
      sets: previous.sets.map((set) => {
        if (set.id !== previous.active_id) return set;
        const validTarget = set.pairs.some((pair) => pair.id === pairId);
        const manualAssignments = { ...set.manual_assignments };
        ids.forEach((id) => {
          if (validTarget) manualAssignments[id] = pairId;
          else delete manualAssignments[id];
        });
        return { ...set, manual_assignments: manualAssignments };
      }),
    }));
  }, [changeEntry]);

  const removeManualGroupIds = useCallback((illustrationIds) => {
    const ids = new Set((illustrationIds || []).map(String));
    if (ids.size) changeEntry((previous) => withoutAssignments(previous, ids));
  }, [changeEntry]);

  const activeSet = entry.sets.find((set) => set.id === entry.active_id);
  return useMemo(() => ({
    sets: entry.sets,
    activeSetId: entry.active_id,
    pairs: activeSet.pairs,
    matchOrder: activeSet.match_order,
    manualAssignments: activeSet.manual_assignments,
    error: groupId == null ? null : error,
    setPairs,
    renamePair,
    setManualGroupIds,
    removeManualGroupIds,
    otherColor: OTHER_COLOR,
    palette: GROUP_COLORS,
    switchSet,
    addSet,
    removeSet,
    renameSet,
  }), [activeSet, addSet, entry, error, groupId, removeManualGroupIds, removeSet,
    renamePair, renameSet, setManualGroupIds, setPairs, switchSet]);
}
