import {
  buildSelectionTagSummary,
  parseIllustrationTags,
  parseTagInput,
} from './illustrationTags';

describe('illustration tag utilities', () => {
  test('normalizes stored and entered tags without changing their first spelling', () => {
    expect(parseIllustrationTags(' Portrait, portrait, warm light, ')).toEqual(['Portrait', 'warm light']);
    expect(parseTagInput('blue, cinematic\nBLUE')).toEqual(['blue', 'cinematic']);
  });

  test('places shared tags first and merges partial tags by union', () => {
    const summary = buildSelectionTagSummary([
      { id: 1, tags: 'portrait, warm, studio' },
      { id: 2, tags: 'portrait, warm' },
      { id: 3, tags: 'portrait, night' },
    ]);

    expect(summary.common.map((entry) => entry.tag)).toEqual(['portrait']);
    expect(summary.partial.map((entry) => [entry.tag, entry.count])).toEqual([
      ['warm', 2],
      ['night', 1],
      ['studio', 1],
    ]);
    expect(summary.partial[0].illustrations.map((item) => item.id)).toEqual([1, 2]);
  });

  test('returns no common tags for an empty selection', () => {
    expect(buildSelectionTagSummary([])).toEqual({ common: [], partial: [], total: 0 });
  });
});
