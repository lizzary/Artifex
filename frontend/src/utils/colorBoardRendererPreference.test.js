import {
  COLOR_BOARD_RENDERER_OPTIONS,
  COLOR_BOARD_RENDERER_STORAGE_KEY,
  normalizeColorBoardRendererPreference,
  readColorBoardRendererPreference,
  resolveColorBoardRenderer,
  writeColorBoardRendererPreference,
} from './colorBoardRendererPreference';

describe('color board renderer preference', () => {
  beforeEach(() => {
    localStorage.removeItem(COLOR_BOARD_RENDERER_STORAGE_KEY);
  });

  test('keeps the initial Auto rollout on the DOM renderer', () => {
    expect(readColorBoardRendererPreference()).toBe(COLOR_BOARD_RENDERER_OPTIONS.AUTO);
    expect(resolveColorBoardRenderer(COLOR_BOARD_RENDERER_OPTIONS.AUTO))
      .toBe(COLOR_BOARD_RENDERER_OPTIONS.DOM);
  });

  test('uses WebGL only when the user explicitly selects it', () => {
    expect(resolveColorBoardRenderer(COLOR_BOARD_RENDERER_OPTIONS.WEBGL))
      .toBe(COLOR_BOARD_RENDERER_OPTIONS.WEBGL);
    expect(resolveColorBoardRenderer(COLOR_BOARD_RENDERER_OPTIONS.DOM))
      .toBe(COLOR_BOARD_RENDERER_OPTIONS.DOM);
  });

  test('normalizes and persists only supported local values', () => {
    expect(normalizeColorBoardRendererPreference('unknown'))
      .toBe(COLOR_BOARD_RENDERER_OPTIONS.AUTO);
    expect(writeColorBoardRendererPreference(COLOR_BOARD_RENDERER_OPTIONS.WEBGL))
      .toBe(COLOR_BOARD_RENDERER_OPTIONS.WEBGL);
    expect(localStorage.getItem(COLOR_BOARD_RENDERER_STORAGE_KEY))
      .toBe(COLOR_BOARD_RENDERER_OPTIONS.WEBGL);
  });
});
