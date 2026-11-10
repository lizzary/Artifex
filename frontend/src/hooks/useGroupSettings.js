import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getGroupConfig, updateColorConfig, updateGroupConfig } from '../api';
import { applyColorOperations } from '../utils/colorConfig';
import { isColorGroupPreviewLimit } from '../utils/colorGroupGallery';

export const DEFAULT_GROUP_VIEW = Object.freeze({
  sort_by: '',
  sort_order: 'desc',
  quality: 'low',
  card_size: 3,
  original_ratio: false,
  group_by: 'none',
  page_size: 50,
  color_group_layout: 'single',
  color_group_preview_mode: 'all',
  color_group_preview_limit: 4,
});

const VALID_VALUES = {
  sort_by: ['', 'resolution', 'fileSize', 'dateCreated'],
  sort_order: ['asc', 'desc'],
  quality: ['low', 'normal', 'original'],
  card_size: [1, 2, 3, 4, 5],
  original_ratio: [false, true],
  group_by: ['none', 'mixed'],
  page_size: [50, 100, 200, 500, 1000, 'all'],
  color_group_layout: ['single', 'double', 'mixed'],
  color_group_preview_mode: ['all', 'limited'],
};

function viewValue(key, value) {
  const valid = key === 'color_group_preview_limit'
    ? isColorGroupPreviewLimit(value)
    : VALID_VALUES[key].includes(value);
  return valid ? value : DEFAULT_GROUP_VIEW[key];
}

let committed = { group_order: [], groups: {} };
let snapshot = { data: committed, error: null };
const pending = [];
let loaded = false;
let loadPromise;
let writeChain = Promise.resolve();
const listeners = new Set();

function publish(error = snapshot.error) {
  const data = pending.reduce((current, operation) => operation.apply(current), committed);
  snapshot = { data, error };
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadGroupSettings() {
  if (loaded) return Promise.resolve(snapshot.data);
  if (!loadPromise) {
    loadPromise = getGroupConfig().then((data) => {
      loaded = true;
      committed = data;
      publish(null);
      return data;
    }).catch((error) => {
      publish(error);
      throw error;
    }).finally(() => { loadPromise = null; });
  }
  return loadPromise;
}

function applyPatch(data, patch) {
  const groups = { ...data.groups };
  Object.entries(patch.groups || {}).forEach(([id, group]) => {
    groups[id] = {
      ...groups[id],
      ...group,
      view: { ...groups[id]?.view, ...group.view },
    };
  });
  return { ...data, ...patch, groups };
}

async function enqueueChange(operation) {
  await loadGroupSettings();
  pending.push(operation);
  publish(null);
  const result = writeChain.then(async () => {
    try {
      committed = await operation.send(committed);
      return committed;
    } catch (error) {
      snapshot = { ...snapshot, error };
      throw error;
    } finally {
      pending.splice(pending.indexOf(operation), 1);
      publish();
    }
  });
  writeChain = result.catch(() => {});
  return result;
}

export function changeGroupSettings(transform) {
  return enqueueChange({
    apply(current) {
      const patch = transform(current);
      return patch ? applyPatch(current, patch) : current;
    },
    send(current) {
      const patch = transform(current);
      return patch ? updateGroupConfig(patch) : Promise.resolve(current);
    },
  });
}

export function changeColorSettings(groupId, operations) {
  if (!operations.length) return Promise.resolve(false);
  return enqueueChange({
    apply(current) {
      const group = current.groups[groupId];
      return {
        ...current,
        groups: {
          ...current.groups,
          [groupId]: { ...group, colors: applyColorOperations(group?.colors, operations) },
        },
      };
    },
    send: () => updateColorConfig(groupId, operations),
  });
}

export async function refreshGroupSettings() {
  await loadGroupSettings();
  const result = writeChain.then(async () => {
    try {
      committed = await getGroupConfig();
      publish(null);
    } catch (error) {
      publish(error);
      throw error;
    }
  });
  writeChain = result.catch(() => {});
  return result;
}

export async function flushGroupSettings() {
  await loadPromise?.catch(() => {});
  await writeChain;
}

export function useGroupSettings(enabled = true) {
  const current = useSyncExternalStore(subscribe, () => snapshot);
  useEffect(() => {
    if (enabled) void loadGroupSettings().catch(() => {});
  }, [enabled]);
  return current;
}

export default function useGroupViewSetting(groupId, key) {
  const { data } = useGroupSettings(groupId != null);
  const [transientValue, setTransientValue] = useState(DEFAULT_GROUP_VIEW[key]);
  const value = groupId == null
    ? transientValue
    : viewValue(key, data.groups[groupId]?.view?.[key]);

  const setValue = useCallback((update) => {
    if (groupId == null) {
      setTransientValue((previous) => viewValue(
        key, typeof update === 'function' ? update(previous) : update,
      ));
      return;
    }
    void changeGroupSettings((current) => {
      const previous = viewValue(key, current.groups[groupId]?.view?.[key]);
      const next = viewValue(key, typeof update === 'function' ? update(previous) : update);
      return { groups: { [groupId]: { view: { [key]: next } } } };
    }).catch(() => {});
  }, [groupId, key]);

  return [value, setValue];
}
