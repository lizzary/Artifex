import { useCallback } from 'react';
import useProjectPreference from '../hooks/useProjectSettings';

export const COLOR_BOARD_RENDERER_OPTIONS = Object.freeze({
  AUTO: 'auto',
  WEBGL: 'webgl',
  DOM: 'dom',
});

const VALID_PREFERENCES = new Set(Object.values(COLOR_BOARD_RENDERER_OPTIONS));

export function normalizeColorBoardRendererPreference(value) {
  return VALID_PREFERENCES.has(value) ? value : COLOR_BOARD_RENDERER_OPTIONS.AUTO;
}

export function resolveColorBoardRenderer(preference) {
  return preference === COLOR_BOARD_RENDERER_OPTIONS.WEBGL
    ? COLOR_BOARD_RENDERER_OPTIONS.WEBGL
    : COLOR_BOARD_RENDERER_OPTIONS.DOM;
}

export default function useColorBoardRendererPreference() {
  const [preference, setPreference] = useProjectPreference('board_renderer', 'auto');
  const updatePreference = useCallback(
    (value) => setPreference(normalizeColorBoardRendererPreference(value)),
    [setPreference],
  );
  return [normalizeColorBoardRendererPreference(preference), updatePreference];
}
