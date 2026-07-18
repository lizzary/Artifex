import { getAspectFitPreviewHeight } from './illustrationPreview';

describe('getAspectFitPreviewHeight', () => {
  test('preserves regular portrait and landscape aspect ratios', () => {
    expect(getAspectFitPreviewHeight({ width: 600, height: 900 }, 240, 80, 360)).toBe(360);
    expect(getAspectFitPreviewHeight({ width: 1600, height: 900 }, 240, 80, 360)).toBe(135);
  });

  test('uses a bounded contain box for extreme or missing aspect ratios', () => {
    expect(getAspectFitPreviewHeight({ width: 100, height: 1000 }, 240, 80, 360)).toBe(360);
    expect(getAspectFitPreviewHeight({ width: 4000, height: 200 }, 240, 80, 360)).toBe(80);
    expect(getAspectFitPreviewHeight({}, 240, 80, 360)).toBe(180);
  });
});
