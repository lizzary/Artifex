import { groupColorsFromHex, toHexColor } from './groupColors';

describe('group color helpers', () => {
  test('reads existing rgba colors and normalizes custom hex values', () => {
    expect(toHexColor('rgba(239, 68, 68, 0.35)')).toBe('#ef4444');
    expect(toHexColor('#0af')).toBe('#00aaff');
  });

  test('derives the subtle background and visible border from one custom color', () => {
    expect(groupColorsFromHex('#14b8a6')).toEqual({
      color: 'rgba(20, 184, 166, 0.08)',
      borderColor: 'rgba(20, 184, 166, 0.35)',
    });
  });
});
