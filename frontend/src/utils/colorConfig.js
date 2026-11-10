import { validateExpression } from './grouping';
import { toHexColor } from './groupColors';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = (value) => typeof value === 'string' && value.length > 0;

function validPair(pair) {
  if (!isObject(pair) || !isId(pair.id) || typeof pair.customName !== 'string'
    || !toHexColor(pair.color, null) || !toHexColor(pair.borderColor, null)
    || !Array.isArray(pair.terms)) return false;
  const validTerms = pair.terms.every((term) => isObject(term)
    && typeof term.value === 'string' && term.value.trim().length > 0
    && ['all', 'tag', 'prompt'].includes(term.scope)
    && ['and', 'or'].includes(term.operator) && typeof term.negated === 'boolean'
    && Number.isInteger(term.open) && term.open >= 0 && term.open <= 4
    && Number.isInteger(term.close) && term.close >= 0 && term.close <= 4);
  return validTerms && (pair.terms.length === 0 || validateExpression(pair).valid);
}

export function isColorConfig(entry) {
  if (!isObject(entry) || !Array.isArray(entry.sets)) return false;
  const setIds = new Set();
  for (const set of entry.sets) {
    if (!isObject(set) || !isId(set.id) || setIds.has(set.id)
      || typeof set.name !== 'string' || !Array.isArray(set.pairs)
      || !set.pairs.every(validPair) || !Array.isArray(set.match_order)
      || !isObject(set.manual_assignments)) return false;
    setIds.add(set.id);
    const pairIds = new Set(set.pairs.map((pair) => pair.id));
    if (pairIds.size !== set.pairs.length || set.match_order.length !== pairIds.size
      || new Set(set.match_order).size !== pairIds.size
      || !set.match_order.every((id) => pairIds.has(id))
      || !Object.entries(set.manual_assignments).every(([id, pairId]) => (
        /^[1-9]\d*$/.test(id) && (pairId === '' || pairIds.has(pairId))
      ))) return false;
  }
  return entry.sets.length === 0 ? entry.active_id === null : setIds.has(entry.active_id);
}


export function emptyColorConfig() {
  return { sets: [], active_id: null };
}

export function createColorId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function orderedIds(requested, current) {
  const available = new Set(current);
  const ordered = [...new Set(requested)].filter((id) => available.has(id));
  return [...ordered, ...current.filter((id) => !ordered.includes(id))];
}

// Optimistic replay tolerates missing targets. The server validates each batch
// atomically and returns an error instead of recreating a deleted entity.
export function applyColorOperations(value, operations) {
  let result = isColorConfig(value) ? value : emptyColorConfig();
  for (const operation of operations) {
    const { type, set_id: setId, pair_id: pairId } = operation;
    if (type === 'create_set') {
      if (result.sets.some((set) => set.id === operation.set.id)) continue;
      const set = { ...operation.set, pairs: [], match_order: [], manual_assignments: {} };
      result = { sets: [...result.sets, set], active_id: result.active_id ?? set.id };
      continue;
    }
    if (type === 'delete_set') {
      const sets = result.sets.filter((set) => set.id !== setId);
      result = { sets, active_id: result.active_id === setId ? sets[0]?.id ?? null : result.active_id };
      continue;
    }
    if (type === 'set_active') {
      if (result.sets.some((set) => set.id === setId)) result = { ...result, active_id: setId };
      continue;
    }
    if (type === 'clear_assignments') {
      const ids = new Set(operation.ids.map(String));
      result = { ...result, sets: result.sets.map((set) => ({
        ...set,
        manual_assignments: Object.fromEntries(Object.entries(set.manual_assignments).filter(([id]) => !ids.has(id))),
      })) };
      continue;
    }
    result = { ...result, sets: result.sets.map((set) => {
      if (set.id !== setId) return set;
      switch (type) {
        case 'update_set':
          return { ...set, ...operation.changes };
        case 'create_pair':
          if (set.pairs.some((pair) => pair.id === operation.pair.id)) return set;
          return { ...set, pairs: [...set.pairs, operation.pair], match_order: [...set.match_order, operation.pair.id] };
        case 'update_pair':
          return { ...set, pairs: set.pairs.map((pair) => pair.id === pairId ? { ...pair, ...operation.changes } : pair) };
        case 'delete_pair':
          return {
            ...set,
            pairs: set.pairs.filter((pair) => pair.id !== pairId),
            match_order: set.match_order.filter((id) => id !== pairId),
            manual_assignments: Object.fromEntries(Object.entries(set.manual_assignments).filter(([, id]) => id !== pairId)),
          };
        case 'reorder_pairs': {
          const byId = new Map(set.pairs.map((pair) => [pair.id, pair]));
          return { ...set, pairs: orderedIds(operation.ids, set.pairs.map((pair) => pair.id)).map((id) => byId.get(id)) };
        }
        case 'reorder_rules':
          return { ...set, match_order: orderedIds(operation.ids, set.match_order) };
        case 'assign': {
          const assignments = { ...set.manual_assignments };
          Object.entries(operation.assignments).forEach(([id, target]) => {
            if (target == null) delete assignments[id];
            else if (set.pairs.some((pair) => pair.id === target)) assignments[id] = target;
          });
          return { ...set, manual_assignments: assignments };
        }
        default:
          return set;
      }
    }) };
  }
  return result;
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const PAIR_FIELDS = ['customName', 'color', 'borderColor', 'terms'];

// Diff against the editor's immutable starting snapshot, not a newer response.
// A field the user never touched must never be sent back to the server.
export function diffColorSet(baseline, draft) {
  const operations = [];
  const setId = baseline.id;
  if (draft.name !== baseline.name) operations.push({ type: 'update_set', set_id: setId, changes: { name: draft.name } });
  const before = new Map(baseline.pairs.map((pair) => [pair.id, pair]));
  const after = new Map(draft.pairs.map((pair) => [pair.id, pair]));
  baseline.pairs.forEach((pair) => {
    if (!after.has(pair.id)) operations.push({ type: 'delete_pair', set_id: setId, pair_id: pair.id });
  });
  draft.pairs.forEach((pair) => {
    const previous = before.get(pair.id);
    if (!previous) {
      operations.push({ type: 'create_pair', set_id: setId, pair });
      return;
    }
    const changes = Object.fromEntries(PAIR_FIELDS.filter((field) => !same(previous[field], pair[field])).map((field) => [field, pair[field]]));
    if (Object.keys(changes).length) operations.push({ type: 'update_pair', set_id: setId, pair_id: pair.id, changes });
  });
  const automaticPairOrder = [...baseline.pairs.filter((pair) => after.has(pair.id)), ...draft.pairs.filter((pair) => !before.has(pair.id))].map((pair) => pair.id);
  const pairOrder = draft.pairs.map((pair) => pair.id);
  if (!same(automaticPairOrder, pairOrder)) operations.push({ type: 'reorder_pairs', set_id: setId, ids: pairOrder });
  const automaticMatchOrder = [...baseline.match_order.filter((id) => after.has(id)), ...draft.pairs.filter((pair) => !before.has(pair.id)).map((pair) => pair.id)];
  if (!same(automaticMatchOrder, draft.match_order)) operations.push({ type: 'reorder_rules', set_id: setId, ids: draft.match_order });
  return operations;
}
