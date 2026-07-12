import {
  groupDisplayName,
  groupIllustrations,
  matchesMixedExpression,
  paginateIllustrationGroups,
  validateExpression,
} from './grouping';

const illustration = (id, tags = '', positive = '', negative = '') => ({
  id,
  tags,
  extended_data: {
    'Positive Prompt': positive,
    'Negative Prompt': negative,
  },
});

const term = (value, options = {}) => ({
  value,
  scope: 'all',
  operator: 'and',
  negated: false,
  open: 0,
  close: 0,
  ...options,
});

describe('smart grouping expressions', () => {
  test('uses an optional custom group name and falls back to the Boolean expression', () => {
    const named = { customName: '  Favorites  ', terms: [term('portrait', { scope: 'prompt' })] };
    const unnamed = { customName: '   ', terms: [term('portrait', { scope: 'prompt' })] };

    expect(groupDisplayName(named)).toBe('Favorites');
    expect(groupDisplayName(unnamed)).toBe('prompt:portrait');
  });

  test('allows repeated custom group names without merging distinct groups', () => {
    const pairs = [
      { id: 'a', customName: 'Favorites', terms: [term('cat', { scope: 'tag' })] },
      { id: 'b', customName: 'Favorites', terms: [term('dog', { scope: 'tag' })] },
    ];
    const result = groupIllustrations(
      [illustration(1, 'cat'), illustration(2, 'dog')],
      pairs,
      { bg: 'gray', border: 'darkgray' },
      ['a', 'b'],
    );

    expect(result.map((group) => [group.id, group.name])).toEqual([
      ['a', 'Favorites'],
      ['b', 'Favorites'],
    ]);
  });

  test('combines exact tags and prompt substrings in one AND rule', () => {
    const pair = {
      terms: [
        term('1girl', { scope: 'tag' }),
        term('soft light', { scope: 'prompt', operator: 'and' }),
      ],
    };

    expect(matchesMixedExpression(illustration(1, '1girl, blue eyes', 'soft lighting'), pair)).toBe(true);
    expect(matchesMixedExpression(illustration(2, '1girl', 'flat colors'), pair)).toBe(false);
  });

  test('negates a tag, prompt, or mixed-source keyword condition', () => {
    const noMonochrome = { terms: [term('monochrome', { scope: 'tag', negated: true })] };
    const noWatermark = { terms: [term('watermark', { scope: 'prompt', negated: true })] };

    expect(matchesMixedExpression(illustration(1, 'portrait', 'studio light'), noMonochrome)).toBe(true);
    expect(matchesMixedExpression(illustration(2, 'portrait, monochrome', 'studio light'), noMonochrome)).toBe(false);
    expect(matchesMixedExpression(illustration(3, 'portrait', 'no watermark'), noWatermark)).toBe(false);
  });

  test('evaluates NOT before AND and OR', () => {
    const pair = {
      terms: [
        term('cat', { scope: 'tag' }),
        term('dog', { scope: 'tag', operator: 'or', negated: true }),
        term('blue', { scope: 'prompt', operator: 'and' }),
      ],
    };

    expect(matchesMixedExpression(illustration(1, 'cat, dog', 'red background'), pair)).toBe(true);
    expect(matchesMixedExpression(illustration(2, 'portrait', 'blue background'), pair)).toBe(true);
    expect(matchesMixedExpression(illustration(3, 'dog', 'blue background'), pair)).toBe(false);
  });

  test('evaluates parentheses before AND and OR', () => {
    const pair = {
      terms: [
        term('cat', { scope: 'tag', open: 1 }),
        term('dog', { scope: 'tag', operator: 'or', close: 1 }),
        term('blue', { scope: 'prompt', operator: 'and' }),
      ],
    };

    expect(matchesMixedExpression(illustration(1, 'cat', 'red background'), pair)).toBe(false);
    expect(matchesMixedExpression(illustration(2, 'dog', 'blue background'), pair)).toBe(true);
  });

  test('rejects unbalanced parentheses instead of partially matching', () => {
    const pair = { terms: [term('cat', { open: 1 })] };
    expect(validateExpression(pair)).toEqual({ valid: false, reason: 'unclosedParenthesis' });
    expect(matchesMixedExpression(illustration(1, 'cat'), pair)).toBe(false);
  });

  test('uses match priority independently from display order and stops after first match', () => {
    const pairs = [
      { id: 'display-first', terms: [term('cat', { scope: 'tag' })], color: 'red', borderColor: 'darkred' },
      { id: 'priority-first', terms: [term('portrait', { scope: 'prompt' })], color: 'blue', borderColor: 'darkblue' },
    ];
    const result = groupIllustrations(
      [illustration(1, 'cat', 'portrait lighting'), illustration(2, 'cat', 'landscape')],
      pairs,
      { bg: 'gray', border: 'darkgray' },
      ['priority-first', 'display-first'],
    );

    expect(result.map((group) => group.id)).toEqual(['display-first', 'priority-first']);
    expect(result[0].items.map((item) => item.id)).toEqual([2]);
    expect(result[1].items.map((item) => item.id)).toEqual([1]);
  });

  test('paginates after display grouping instead of grouping an existing database page', () => {
    const illustrations = [
      ...Array.from({ length: 90 }, (_, index) => illustration(index + 1, 'group-a')),
      ...Array.from({ length: 20 }, (_, index) => illustration(index + 91, 'group-b')),
      ...Array.from({ length: 1890 }, (_, index) => illustration(index + 111, 'ungrouped')),
    ];
    const pairs = [
      { id: 'a', terms: [term('group-a', { scope: 'tag' })], color: 'red', borderColor: 'darkred' },
      { id: 'b', terms: [term('group-b', { scope: 'tag' })], color: 'blue', borderColor: 'darkblue' },
    ];
    const groups = groupIllustrations(
      illustrations,
      pairs,
      { bg: 'gray', border: 'darkgray' },
      ['a', 'b'],
    );

    const first50 = paginateIllustrationGroups(groups, 1, 50);
    expect(first50.map((group) => [group.id, group.items.length])).toEqual([['a', 50]]);

    const first100 = paginateIllustrationGroups(groups, 1, 100);
    expect(first100.map((group) => [group.id, group.items.length])).toEqual([
      ['a', 90],
      ['b', 10],
    ]);

    const second50 = paginateIllustrationGroups(groups, 2, 50);
    expect(second50.map((group) => [group.id, group.items.length])).toEqual([
      ['a', 40],
      ['b', 10],
    ]);
  });
});
