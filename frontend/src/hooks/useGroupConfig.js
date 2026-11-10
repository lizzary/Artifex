import { useCallback, useMemo, useState } from 'react';
import { changeColorSettings, loadGroupSettings, useGroupSettings } from './useGroupSettings';
import { applyColorOperations, createColorId, diffColorSet, isColorConfig } from '../utils/colorConfig';

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


function makeEmptyEntry() {
  return {
    sets: [{ id: 'default', name: 'Default', pairs: [], match_order: [], manual_assignments: {} }],
    active_id: 'default',
  };
}

const initializeDefault = () => ({
  type: 'create_set', set: { id: 'default', name: 'Default' }, if_absent: true,
});

export async function removeManualAssignmentsForIllustrations(illustrationIds) {
  const ids = [...new Set(illustrationIds.map(Number))];
  if (!ids.length) return false;
  const data = await loadGroupSettings();
  const affected = Object.entries(data.groups).filter(([, group]) => isColorConfig(group.colors)
    && group.colors.sets.some((set) => ids.some((id) => Object.hasOwn(set.manual_assignments, String(id)))));
  for (const [groupId] of affected) {
    await changeColorSettings(groupId, [{ type: 'clear_assignments', ids }]);
  }
  return affected.length > 0;
}

export default function useGroupConfig(groupId) {
  const { data, error } = useGroupSettings(groupId != null);
  const [emptyEntry] = useState(makeEmptyEntry);
  const [transientEntry, setTransientEntry] = useState(emptyEntry);
  const storedEntry = data.groups[groupId]?.colors;
  const isDraftSet = groupId != null && (!isColorConfig(storedEntry) || storedEntry.sets.length === 0);
  const entry = groupId == null ? transientEntry : isDraftSet ? emptyEntry : storedEntry;
  const activeSet = entry.sets.find((set) => set.id === entry.active_id) || emptyEntry.sets[0];

  const submitOperations = useCallback((operations) => {
    if (!operations.length) return Promise.resolve(false);
    if (groupId == null) {
      setTransientEntry((previous) => applyColorOperations(previous, operations));
      return Promise.resolve(true);
    }
    return changeColorSettings(groupId, operations);
  }, [groupId]);

  const saveSetChanges = useCallback((baseline, draft, createDefault = false) => {
    const operations = diffColorSet(baseline, draft);
    if (createDefault && operations.length) operations.unshift(initializeDefault());
    return submitOperations(operations);
  }, [submitOperations]);

  const switchSet = useCallback((id) => submitOperations([{ type: 'set_active', set_id: id }]), [submitOperations]);

  const addSet = useCallback(async (name) => {
    const id = createColorId();
    const operations = [
      { type: 'create_set', set: { id, name: name || `Set ${entry.sets.length + 1}` } },
      { type: 'set_active', set_id: id },
    ];
    if (isDraftSet) operations.unshift(initializeDefault());
    await submitOperations(operations);
    return id;
  }, [entry.sets.length, isDraftSet, submitOperations]);

  const removeSet = useCallback(async (id) => {
    const operations = [{ type: 'delete_set', set_id: id }];
    if (groupId == null) {
      const next = applyColorOperations(transientEntry, operations);
      setTransientEntry(next);
      return next.active_id;
    }
    const updated = await submitOperations(operations);
    return updated.groups[groupId].colors.active_id;
  }, [groupId, submitOperations, transientEntry]);

  const renamePair = useCallback((id, name) => {
    void submitOperations([{
      type: 'update_pair', set_id: activeSet.id, pair_id: id, changes: { customName: name.trim() },
    }]).catch(() => {});
  }, [activeSet.id, submitOperations]);

  const setManualGroupIds = useCallback((illustrationIds, pairId) => {
    if (isDraftSet && !pairId) return Promise.resolve(false);
    const assignments = Object.fromEntries([...new Set(illustrationIds.map(String))].map((id) => [id, pairId || null]));
    if (!Object.keys(assignments).length) return Promise.resolve(false);
    return submitOperations([{ type: 'assign', set_id: activeSet.id, assignments }]);
  }, [activeSet.id, isDraftSet, submitOperations]);

  const removeManualGroupIds = useCallback((illustrationIds) => {
    const ids = [...new Set(illustrationIds.map(Number))];
    if (ids.length) void submitOperations([{ type: 'clear_assignments', ids }]).catch(() => {});
  }, [submitOperations]);

  return useMemo(() => ({
    sets: entry.sets,
    activeSetId: entry.active_id,
    isDraftSet,
    pairs: activeSet.pairs,
    matchOrder: activeSet.match_order,
    manualAssignments: activeSet.manual_assignments,
    error: groupId == null ? null : error,
    saveSetChanges,
    renamePair,
    setManualGroupIds,
    removeManualGroupIds,
    otherColor: OTHER_COLOR,
    palette: GROUP_COLORS,
    switchSet,
    addSet,
    removeSet,
  }), [activeSet, addSet, entry, error, groupId, isDraftSet, removeManualGroupIds,
    removeSet, renamePair, saveSetChanges, setManualGroupIds, switchSet]);
}
