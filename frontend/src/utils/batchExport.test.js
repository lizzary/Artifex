import { buildExportTree, getExportDraft, getExportKeys, isExportDate, isExportDateRange } from './batchExport';

function build(illustrations, draft) {
  return buildExportTree({
    illustrations,
    draft: { ...getExportDraft(), ...draft },
    keys: new Set(getExportKeys('en').flat().map(({ id }) => id)),
    language: 'en',
    colorGroups: new Map(),
    other: 'Other',
  });
}

test('sanitizes folder names and numbers case-insensitive filename collisions', () => {
  const illustrations = [
    { id: 1, group_name: 'Archive', original_filename: 'Rose.png' },
    { id: 2, group_name: 'archive', original_filename: 'rose.png' },
    { id: 3, group_name: 'Archive/Rose.png', original_filename: 'Rose.png' },
  ];
  const { entries } = build(illustrations);
  expect(entries).toEqual([
    { id: 1, path: 'Archive/Rose.png' },
    { id: 2, path: 'Archive/rose(1).png' },
    { id: 3, path: 'Archive_Rose.png/Rose.png' },
  ]);
});

test.each([
  [['画集//春日/窗边'], 'relative', [[3, 4]]],
  [['/Album/'], 'relative', [[0, 1], [6, 7]]],
  [['Album/CON/.. /Name. '], 'relative', [[6, 9], [10, 13], [18, 20]]],
  [['📚/景?色/', { key: 'data:original' }], 'characters', [[4, 5]]],
  [['📚/', { key: 'data:removed' }, '/Name'], 'key', [[3, 4]]],
  [[' '.repeat(3)], 'empty', [[0, 3]]],
  [['Album/' + '画'.repeat(67)], 'length', [[6, 73]]],
])('locates export path problems in the editor (%j)', (pattern, error, errorRanges) => {
  expect(build([], { pattern })).toMatchObject({ error, errorRanges, entries: [] });
});

test('locates the component that makes the expanded path too long', () => {
  const pattern = Array.from({ length: 21 }, () => [{ key: 'data:original' }, '/']).flat().slice(0, -1);
  const illustrations = [{ id: 1, original_filename: `${'x'.repeat(200)}.png` }];
  expect(build(illustrations, { pattern })).toMatchObject({ error: 'length', errorRanges: [[40, 41]], entries: [] });
});

test('filters by file type without applying legacy single-day picks', () => {
  const illustrations = [
    { id: 1, original_filename: 'first.png' },
    { id: 2, original_filename: 'second.jpg' },
    { id: 3, original_filename: 'third.png' },
  ];
  const oldDraft = {
    dateMode: 'range',
    start: '2026-11-10',
    end: '2026-11-10',
    illustrationIds: [2, 3],
    extensions: ['png'],
    pattern: [{ key: 'data:exportIndex' }],
  };
  expect(getExportDraft(oldDraft)).not.toHaveProperty('illustrationIds');
  const { entries } = build(illustrations, oldDraft);
  expect(entries).toEqual([{ id: 1, path: '001.png' }, { id: 3, path: '002.png' }]);
});

test('only accepts real calendar dates with a four-digit year in an ordered range', () => {
  expect(isExportDate('2024-02-29')).toBe(true);
  expect(isExportDate('2026-02-29')).toBe(false);
  expect(isExportDate('0000-01-01')).toBe(false);
  expect(isExportDate('202611-11-10')).toBe(false);
  expect(isExportDateRange('2026-11-10', '2026-11-10')).toBe(true);
  expect(isExportDateRange('2026-11-11', '2026-11-10')).toBe(false);
});
