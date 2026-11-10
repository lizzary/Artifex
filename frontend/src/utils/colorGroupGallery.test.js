import { paginateIllustrationGroups } from './grouping';
import { limitColorGroups, packColorGroups } from './colorGroupGallery';

const groups = [
  { id: 'rose', items: [1, 2] },
  { id: 'ink', items: [3, 4, 5, 6, 7] },
  { id: 'linen', items: [8] },
  { id: 'jade', items: [9, 10] },
];

test('limits each group once before pagination and retains the omitted count', () => {
  const limited = limitColorGroups(groups, 2);
  const secondPage = paginateIllustrationGroups(limited, 2, 3);
  expect(secondPage).toEqual([
    { id: 'ink', items: [4], totalCount: 5, omittedCount: 3 },
    { id: 'linen', items: [8], totalCount: 1, omittedCount: 0 },
    { id: 'jade', items: [9], totalCount: 2, omittedCount: 0 },
  ]);
  expect(limitColorGroups(groups, null)).toBe(groups);
});

test('fills a partial row and marks every edge of a group spanning several rows', () => {
  const segments = packColorGroups(groups, new Set(), 3);
  expect(segments.map(({ group, items, span, fromPrevious, continuesOnNext }) => (
    [group.id, items, span, fromPrevious, continuesOnNext]
  ))).toEqual([
    ['rose', [1, 2], 2, false, false],
    ['ink', [3], 1, false, true],
    ['ink', [4, 5, 6], 3, true, true],
    ['ink', [7], 1, true, false],
    ['linen', [8], 1, false, false],
    ['jade', [9], 1, false, true],
    ['jade', [10], 1, true, false],
  ]);
});

test('uses one slot for a collapsed group and preserves order after repacking', () => {
  const segments = packColorGroups(groups, new Set(['ink']), 3);
  expect(segments.map(({ group, span }) => [group.id, span]))
    .toEqual([['rose', 2], ['ink', 1], ['linen', 1], ['jade', 2]]);
  expect(segments.flatMap(({ items }) => items)).toEqual([1, 2, 8, 9, 10]);
});
