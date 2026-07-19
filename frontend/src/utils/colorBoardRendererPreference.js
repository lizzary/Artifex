import { useCallback, useEffect, useState } from 'react';

export const COLOR_BOARD_RENDERER_STORAGE_KEY = 'color-board-renderer';
export const COLOR_BOARD_RENDERER_EVENT = 'color-board-renderer-change';

export const COLOR_BOARD_RENDERER_OPTIONS = Object.freeze({
  AUTO: 'auto',
  WEBGL: 'webgl',
  DOM: 'dom',
});

const VALID_PREFERENCES = new Set(Object.values(COLOR_BOARD_RENDERER_OPTIONS));

export function normalizeColorBoardRendererPreference(value) {
  return VALID_PREFERENCES.has(value) ? value : COLOR_BOARD_RENDERER_OPTIONS.AUTO;
}

export function readColorBoardRendererPreference() {
  try {
    return normalizeColorBoardRendererPreference(
      localStorage.getItem(COLOR_BOARD_RENDERER_STORAGE_KEY),
    );
  } catch {
    return COLOR_BOARD_RENDERER_OPTIONS.AUTO;
  }
}

export function resolveColorBoardRenderer(preference) {
  const normalized = normalizeColorBoardRendererPreference(preference);
  // Initial rollout deliberately keeps Auto on the proven renderer. Once the
  // WebGL renderer has enough field data this is the only line that must change.
  return normalized === COLOR_BOARD_RENDERER_OPTIONS.WEBGL
    ? COLOR_BOARD_RENDERER_OPTIONS.WEBGL
    : COLOR_BOARD_RENDERER_OPTIONS.DOM;
}

export function writeColorBoardRendererPreference(value) {
  const normalized = normalizeColorBoardRendererPreference(value);
  try {
    localStorage.setItem(COLOR_BOARD_RENDERER_STORAGE_KEY, normalized);
  } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(COLOR_BOARD_RENDERER_EVENT, {
      detail: normalized,
    }));
  }
  return normalized;
}

export default function useColorBoardRendererPreference() {
  const [preference, setPreferenceState] = useState(readColorBoardRendererPreference);

  useEffect(() => {
    const handleStorage = (event) => {
      if (
        event.type === 'storage'
        && event.key != null
        && event.key !== COLOR_BOARD_RENDERER_STORAGE_KEY
      ) return;
      const next = event.detail ?? readColorBoardRendererPreference();
      setPreferenceState(normalizeColorBoardRendererPreference(next));
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener(COLOR_BOARD_RENDERER_EVENT, handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(COLOR_BOARD_RENDERER_EVENT, handleStorage);
    };
  }, []);

  const setPreference = useCallback((value) => {
    setPreferenceState(writeColorBoardRendererPreference(value));
  }, []);

  return [preference, setPreference];
}
