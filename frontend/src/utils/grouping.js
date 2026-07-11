const VALID_SCOPES = new Set(['all', 'tag', 'prompt']);

function clampParenCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(4, Math.trunc(parsed))) : 0;
}

export function normalizeTerm(term, fallbackScope = 'all', index = 0) {
  if (typeof term === 'string') {
    return {
      value: term,
      scope: VALID_SCOPES.has(fallbackScope) ? fallbackScope : 'all',
      operator: index === 0 ? 'and' : 'and',
      negated: false,
      open: 0,
      close: 0,
    };
  }

  const value = term?.value ?? term?.text ?? '';
  return {
    value: String(value),
    scope: VALID_SCOPES.has(term?.scope) ? term.scope : (VALID_SCOPES.has(fallbackScope) ? fallbackScope : 'all'),
    operator: index === 0 ? 'and' : (term?.operator === 'or' ? 'or' : 'and'),
    negated: Boolean(term?.negated),
    open: clampParenCount(term?.open),
    close: clampParenCount(term?.close),
  };
}

export function normalizePairTerms(pair, fallbackScope = 'all') {
  const source = Array.isArray(pair?.terms)
    ? pair.terms
    : (Array.isArray(pair?.keywords) ? pair.keywords : []);
  return source.map((term, index) => normalizeTerm(term, fallbackScope, index));
}

export function expressionLabel(pair) {
  const terms = normalizePairTerms(pair);
  return terms.map((term, index) => {
    const prefix = index === 0 ? '' : ` ${term.operator.toUpperCase()} `;
    const scope = term.scope === 'tag' ? 'tag:' : term.scope === 'prompt' ? 'prompt:' : '';
    const negation = term.negated ? 'NOT ' : '';
    return `${prefix}${'('.repeat(term.open)}${negation}${scope}${term.value}${')'.repeat(term.close)}`;
  }).join('');
}

export function groupDisplayName(pair) {
  const customName = typeof pair?.customName === 'string' ? pair.customName.trim() : '';
  return customName || expressionLabel(pair);
}

export function validateExpression(pair) {
  const terms = normalizePairTerms(pair);
  if (terms.length === 0) return { valid: false, reason: 'empty' };

  let depth = 0;
  for (const term of terms) {
    if (!term.value.trim()) return { valid: false, reason: 'emptyTerm' };
    depth += term.open;
    depth -= term.close;
    if (depth < 0) return { valid: false, reason: 'closingBeforeOpening' };
  }
  if (depth !== 0) return { valid: false, reason: 'unclosedParenthesis' };
  return { valid: true, reason: null };
}

function illustrationSearchFields(ill) {
  const tags = new Set(
    (ill.tags || '')
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
  );
  const ext = ill.extended_data || {};
  const prompt = [
    ext['Positive Prompt'] || '',
    ext['Negative Prompt'] || '',
  ].join(' ').toLowerCase();
  return { tags, prompt };
}

function termMatches(fields, term) {
  const keyword = term.value.trim().toLowerCase();
  const tagMatch = fields.tags.has(keyword);
  const promptMatch = fields.prompt.includes(keyword);
  let matches;
  if (term.scope === 'tag') matches = tagMatch;
  else if (term.scope === 'prompt') matches = promptMatch;
  else matches = tagMatch || promptMatch;
  return term.negated ? !matches : matches;
}

function toPostfix(terms, values) {
  const output = [];
  const operators = [];
  const precedence = { or: 1, and: 2 };

  terms.forEach((term, index) => {
    if (index > 0) {
      const operator = term.operator === 'or' ? 'or' : 'and';
      while (
        operators.length > 0
        && operators[operators.length - 1] !== '('
        && precedence[operators[operators.length - 1]] >= precedence[operator]
      ) {
        output.push(operators.pop());
      }
      operators.push(operator);
    }

    for (let i = 0; i < term.open; i += 1) operators.push('(');
    output.push(values[index]);
    for (let i = 0; i < term.close; i += 1) {
      while (operators.length > 0 && operators[operators.length - 1] !== '(') {
        output.push(operators.pop());
      }
      if (operators[operators.length - 1] === '(') operators.pop();
    }
  });

  while (operators.length > 0) output.push(operators.pop());
  return output;
}

export function matchesMixedExpression(ill, pair) {
  const validation = validateExpression(pair);
  if (!validation.valid) return false;

  const terms = normalizePairTerms(pair);
  const fields = illustrationSearchFields(ill);
  const postfix = toPostfix(terms, terms.map((term) => termMatches(fields, term)));
  const stack = [];
  for (const token of postfix) {
    if (typeof token === 'boolean') {
      stack.push(token);
      continue;
    }
    const right = stack.pop() ?? false;
    const left = stack.pop() ?? false;
    stack.push(token === 'and' ? left && right : left || right);
  }
  return stack.length === 1 ? stack[0] : false;
}

// Kept as compatibility helpers for legacy callers and saved configurations.
export function matchesTagPair(ill, keywords) {
  return matchesMixedExpression(ill, {
    terms: (keywords || []).map((value, index) => normalizeTerm(value, 'tag', index)),
  });
}

export function matchesPromptPair(ill, keywords) {
  return matchesMixedExpression(ill, {
    terms: (keywords || []).map((value, index) => normalizeTerm(value, 'prompt', index)),
  });
}

export function groupIllustrations(illustrations, pairs, otherColor, matchOrder = []) {
  const displayGroups = pairs.map((pair) => ({
    ...pair,
    name: groupDisplayName(pair),
    items: [],
  }));
  const groupById = new Map(displayGroups.map((group) => [group.id, group]));
  const orderedIds = [
    ...matchOrder.filter((id) => groupById.has(id)),
    ...displayGroups.map((group) => group.id).filter((id) => !matchOrder.includes(id)),
  ];
  const priorityGroups = orderedIds.map((id) => groupById.get(id));
  const matchedIds = new Set();

  for (const ill of illustrations) {
    for (const group of priorityGroups) {
      if (matchesMixedExpression(ill, group)) {
        group.items.push(ill);
        matchedIds.add(ill.id);
        break;
      }
    }
  }

  const otherItems = illustrations.filter((ill) => !matchedIds.has(ill.id));
  const result = displayGroups.filter((group) => group.items.length > 0);
  if (otherItems.length > 0) {
    result.push({
      id: 'other',
      name: 'Other',
      color: otherColor.bg,
      borderColor: otherColor.border,
      items: otherItems,
    });
  }
  return result;
}

// Slice the flattened visual group order, then rebuild only the group
// containers that intersect the requested page. This keeps page boundaries
// aligned with display order (group A, then group B, then Other) without
// losing the group metadata used by the renderer.
export function paginateIllustrationGroups(groups, page, pageSize) {
  if (pageSize === 'all') return groups;

  const size = Number(pageSize);
  if (!Number.isFinite(size) || size <= 0) return groups;

  const pageNumber = Math.max(1, Number(page) || 1);
  const pageStart = (pageNumber - 1) * size;
  const pageEnd = pageStart + size;
  let groupStart = 0;
  const result = [];

  for (const group of groups) {
    const groupEnd = groupStart + group.items.length;
    const sliceStart = Math.max(0, pageStart - groupStart);
    const sliceEnd = Math.min(group.items.length, pageEnd - groupStart);

    if (sliceStart < sliceEnd) {
      result.push({
        ...group,
        items: group.items.slice(sliceStart, sliceEnd),
      });
    }

    groupStart = groupEnd;
    if (groupStart >= pageEnd) break;
  }

  return result;
}

export const GROUP_BY_OPTIONS = [
  { value: 'none', label: 'No Grouping' },
  { value: 'mixed', label: 'Smart Groups' },
];
