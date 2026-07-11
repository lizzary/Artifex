// ── Unified tag + prompt grouping engine ───────────────────────────────────
//
// A group is defined by a boolean *expression* over keywords. Each keyword is
// matched against an illustration in a unified way: it matches when it is an
// exact tag OR appears as a substring of the positive/negative prompt text.
// Expressions support AND / OR / NOT (case-insensitive), parentheses for
// precedence, and "quoted phrases" for multi-word terms. Adjacent terms with
// no operator between them are implicitly AND-ed (so a bare space-separated
// list behaves like the old "all keywords must match" rule).

// ── Illustration → match context ────────────────────────────────────────────

export function buildContext(ill) {
  const tagSet = new Set(
    (ill.tags || '')
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
  );
  const ext = ill.extended_data || {};
  const promptText = [
    ext['Positive Prompt'] || '',
    ext['Negative Prompt'] || '',
  ].join(' ').toLowerCase();
  return { tagSet, promptText };
}

// A single keyword matches when it is an exact tag or a prompt substring.
function termMatches(term, ctx) {
  if (!term) return false;
  return ctx.tagSet.has(term) || ctx.promptText.includes(term);
}

// ── Tokenizer ───────────────────────────────────────────────────────────────

const BOUNDARY = new Set([' ', '\t', '\n', '\r', '(', ')', '"']);

function tokenize(input) {
  const tokens = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '(') { tokens.push({ type: 'lparen' }); i++; continue; }
    if (c === ')') { tokens.push({ type: 'rparen' }); i++; continue; }
    if (c === '"') {
      // Quoted phrase — may contain spaces / operator-like words verbatim.
      let j = i + 1;
      let s = '';
      while (j < n && input[j] !== '"') { s += input[j]; j++; }
      tokens.push({ type: 'term', value: s });
      i = j < n ? j + 1 : j;
      continue;
    }
    // Bareword: run up to the next boundary character.
    let j = i;
    let s = '';
    while (j < n && !BOUNDARY.has(input[j])) { s += input[j]; j++; }
    const up = s.toUpperCase();
    if (up === 'AND' || up === 'OR' || up === 'NOT') {
      tokens.push({ type: 'op', op: up });
    } else {
      tokens.push({ type: 'term', value: s });
    }
    i = j;
  }
  return tokens;
}

// ── Parser (recursive descent) ──────────────────────────────────────────────
//
//   orExpr  := andExpr (OR andExpr)*
//   andExpr := notExpr ((AND)? notExpr)*      // AND is optional / implicit
//   notExpr := NOT notExpr | atom
//   atom    := '(' orExpr ')' | TERM

function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];

  function parseOr() {
    let node = parseAnd();
    while (peek() && peek().type === 'op' && peek().op === 'OR') {
      pos++;
      node = { type: 'or', left: node, right: parseAnd() };
    }
    return node;
  }

  function parseAnd() {
    let node = parseNot();
    for (;;) {
      const tk = peek();
      if (!tk) break;
      if (tk.type === 'op' && tk.op === 'AND') {
        pos++; // explicit AND
        node = { type: 'and', left: node, right: parseNot() };
      } else if (tk.type === 'term' || tk.type === 'lparen' || (tk.type === 'op' && tk.op === 'NOT')) {
        // implicit AND — a new factor starts without an operator
        node = { type: 'and', left: node, right: parseNot() };
      } else {
        break;
      }
    }
    return node;
  }

  function parseNot() {
    const tk = peek();
    if (tk && tk.type === 'op' && tk.op === 'NOT') {
      pos++;
      return { type: 'not', child: parseNot() };
    }
    return parseAtom();
  }

  function parseAtom() {
    const tk = peek();
    if (!tk) throw new Error('unexpected end of expression');
    if (tk.type === 'lparen') {
      pos++;
      const node = parseOr();
      if (!peek() || peek().type !== 'rparen') throw new Error('missing closing parenthesis');
      pos++;
      return node;
    }
    if (tk.type === 'term') { pos++; return { type: 'term', value: tk.value }; }
    throw new Error('unexpected operator');
  }

  const node = parseOr();
  if (pos < tokens.length) throw new Error('unexpected trailing input');
  return node;
}

// ── Compilation ─────────────────────────────────────────────────────────────

function compileNode(node) {
  switch (node.type) {
    case 'term': {
      const term = node.value.trim().toLowerCase();
      return (ctx) => termMatches(term, ctx);
    }
    case 'and': {
      const l = compileNode(node.left);
      const r = compileNode(node.right);
      return (ctx) => l(ctx) && r(ctx);
    }
    case 'or': {
      const l = compileNode(node.left);
      const r = compileNode(node.right);
      return (ctx) => l(ctx) || r(ctx);
    }
    case 'not': {
      const c = compileNode(node.child);
      return (ctx) => !c(ctx);
    }
    default:
      return () => false;
  }
}

// Compiled-predicate cache, keyed by the raw expression string.
const _exprCache = new Map();

// Returns { predicate, valid, error }.
//  - predicate: (ctx) => boolean, or null when the expression is empty/invalid
//  - valid: false only when the (non-empty) expression fails to parse
export function compileExpression(expr) {
  const raw = (expr || '').trim();
  if (!raw) return { predicate: null, valid: true, error: null };
  if (_exprCache.has(raw)) return _exprCache.get(raw);

  let result;
  try {
    const tokens = tokenize(raw);
    if (tokens.length === 0) {
      result = { predicate: null, valid: true, error: null };
    } else {
      const ast = parse(tokens);
      result = { predicate: compileNode(ast), valid: true, error: null };
    }
  } catch (err) {
    result = { predicate: null, valid: false, error: err.message };
  }
  _exprCache.set(raw, result);
  return result;
}

// Convenience for UI validation.
export function isValidExpression(expr) {
  return compileExpression(expr).valid;
}

// ── Migration helper: old keyword list → expression string ──────────────────

export function keywordsToExpr(keywords) {
  return (keywords || [])
    .map((k) => (k || '').trim())
    .filter(Boolean)
    .map((k) => (/\s/.test(k) ? `"${k}"` : k))
    .join(' AND ');
}

// Human-readable label for a group (used as the collapsible header title).
function exprLabel(expr) {
  return (expr || '').trim();
}

// ── Grouping ────────────────────────────────────────────────────────────────
//
// Assignment happens in *priority* order (first matching group claims the
// illustration; matched illustrations never participate again), while the
// returned groups keep their *display* order (the `pairs` array order).

export function groupIllustrations(illustrations, pairs, priorityOrder, otherColor) {
  const groups = pairs.map((p) => ({ ...p, name: exprLabel(p.expr), items: [] }));
  const predById = new Map(pairs.map((p) => [p.id, compileExpression(p.expr).predicate]));

  // Build the priority-ordered assignment sequence.
  const byId = new Map(groups.map((g) => [g.id, g]));
  let ordered;
  if (Array.isArray(priorityOrder) && priorityOrder.length) {
    const seen = new Set();
    ordered = [];
    for (const id of priorityOrder) {
      const g = byId.get(id);
      if (g && !seen.has(id)) { ordered.push(g); seen.add(id); }
    }
    for (const g of groups) if (!seen.has(g.id)) ordered.push(g);
  } else {
    ordered = groups;
  }

  const matchedIds = new Set();
  for (const ill of illustrations) {
    const ctx = buildContext(ill);
    for (const g of ordered) {
      const pred = predById.get(g.id);
      if (pred && pred(ctx)) {
        g.items.push(ill);
        matchedIds.add(ill.id);
        break;
      }
    }
  }

  const otherItems = illustrations.filter((ill) => !matchedIds.has(ill.id));
  const result = groups.filter((g) => g.items.length > 0);
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
