import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getSettings, updateSettings } from '../api';

let committed = null;
let snapshot = null;
let loadPromise = null;
let writeChain = Promise.resolve();
const pending = new Map();
const listeners = new Set();

function publish() {
  snapshot = committed;
  for (const patch of pending.values()) snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => snapshot;

export function loadProjectSettings() {
  if (committed) return Promise.resolve(committed);
  if (!loadPromise) {
    loadPromise = getSettings().then((settings) => {
      committed = settings;
      publish();
      return settings;
    }).finally(() => { loadPromise = null; });
  }
  return loadPromise;
}

export function saveProjectSettings(patch) {
  const token = Symbol();
  pending.set(token, patch);
  publish();
  const operation = writeChain.then(async () => {
    try {
      await loadProjectSettings();
      committed = await updateSettings(patch);
      return committed;
    } finally {
      pending.delete(token);
      publish();
    }
  });
  writeChain = operation.catch(() => {});
  return operation;
}

export default function useProjectPreference(key, defaultValue) {
  const settings = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    loadProjectSettings().catch(() => {});
  }, []);
  const setValue = useCallback(
    (value) => saveProjectSettings({ [key]: value }),
    [key],
  );
  return [settings?.[key] ?? defaultValue, setValue];
}
