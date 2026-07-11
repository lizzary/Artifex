import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, Reorder, useDragControls } from 'framer-motion';
import {
  Check, GripVertical, Layers3, Palette, Pencil, Plus, RotateCcw, Trash2, X,
} from 'lucide-react';
import TagPromptSuggest from './TagPromptSuggest';
import SettingsSelect from './SettingsSelect';
import { useLocale } from '../contexts/LocaleContext';
import { groupDisplayName, normalizePairTerms, validateExpression } from '../utils/grouping';
import { groupColorsFromHex, toHexColor } from '../utils/groupColors';

function normalizeOrder(order, pairs) {
  const ids = new Set(pairs.map((pair) => pair.id));
  const existing = Array.isArray(order) ? order.filter((id) => ids.has(id)) : [];
  return [...existing, ...pairs.map((pair) => pair.id).filter((id) => !existing.includes(id))];
}

function clonePairs(pairs) {
  return pairs.map((pair) => ({
    ...pair,
    terms: normalizePairTerms(pair).map((term) => ({ ...term })),
  }));
}

function cleanPairs(pairs) {
  return pairs.flatMap((pair) => {
    const terms = normalizePairTerms(pair)
      .map((term) => ({ ...term, value: term.value.trim() }))
      .filter((term) => term.value);
    if (terms.length === 0) return [];
    terms[0] = { ...terms[0], operator: 'and' };
    const customName = typeof pair.customName === 'string' ? pair.customName.trim() : '';
    return [{ ...pair, customName, terms }];
  });
}

export default function GroupConfigModal({ config, onClose }) {
  const { t } = useLocale();
  const {
    sets, activeSetId, switchSet, addSet, removeSet, renameSet,
    setPairs, palette, matchOrder,
  } = config;
  const activeSet = sets.find((set) => set.id === activeSetId) || sets[0];

  const [editingPairs, setEditingPairs] = useState([]);
  const [editingMatchOrder, setEditingMatchOrder] = useState([]);
  const [editingName, setEditingName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [invalidIds, setInvalidIds] = useState(new Set());

  useEffect(() => {
    const target = sets.find((set) => set.id === activeSetId);
    if (target) {
      const pairs = clonePairs(target.pairs || []);
      setEditingPairs(pairs);
      setEditingMatchOrder(normalizeOrder(target.match_order || matchOrder, pairs));
      setEditingName(target.name || '');
    }
    setDeleteConfirm(null);
    setInvalidIds(new Set());
  }, [activeSetId, sets, matchOrder]);

  const priorityPairs = useMemo(() => {
    const byId = new Map(editingPairs.map((pair) => [pair.id, pair]));
    return normalizeOrder(editingMatchOrder, editingPairs).map((id) => byId.get(id)).filter(Boolean);
  }, [editingPairs, editingMatchOrder]);

  const commitCurrent = () => {
    const cleaned = cleanPairs(editingPairs);
    const invalid = new Set(
      cleaned.filter((pair) => !validateExpression(pair).valid).map((pair) => pair.id),
    );
    if (invalid.size > 0) {
      setInvalidIds(invalid);
      return false;
    }

    const name = editingName.trim();
    if (name && name !== activeSet?.name) renameSet(activeSetId, name);
    setPairs(cleaned, normalizeOrder(editingMatchOrder, cleaned));
    setInvalidIds(new Set());
    return true;
  };

  const handleSwitchSet = (setId) => {
    if (setId !== activeSetId && commitCurrent()) switchSet(setId);
  };

  const handleAddSet = () => {
    if (commitCurrent()) addSet();
  };

  const handleSave = () => {
    if (commitCurrent()) onClose();
  };

  const updateTerm = (pairId, termIndex, updates) => {
    setEditingPairs((previous) => previous.map((pair) => {
      if (pair.id !== pairId) return pair;
      const terms = normalizePairTerms(pair).map((term, index) => (
        index === termIndex ? { ...term, ...updates } : term
      ));
      return { ...pair, terms };
    }));
    setInvalidIds((previous) => {
      if (!previous.has(pairId)) return previous;
      const next = new Set(previous);
      next.delete(pairId);
      return next;
    });
  };

  const addTerm = (pairId) => {
    setEditingPairs((previous) => previous.map((pair) => (
      pair.id === pairId
        ? {
          ...pair,
          terms: [...normalizePairTerms(pair), {
            value: '', scope: 'all', operator: 'and', negated: false, open: 0, close: 0,
          }],
        }
        : pair
    )));
  };

  const removeTerm = (pairId, termIndex) => {
    setEditingPairs((previous) => previous.map((pair) => {
      if (pair.id !== pairId) return pair;
      const terms = normalizePairTerms(pair).filter((_, index) => index !== termIndex);
      if (terms.length === 0) {
        return { ...pair, terms: [{ value: '', scope: 'all', operator: 'and', negated: false, open: 0, close: 0 }] };
      }
      terms[0] = { ...terms[0], operator: 'and' };
      return { ...pair, terms };
    }));
  };

  const addPair = () => {
    const id = `pair_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const color = palette[editingPairs.length % palette.length];
    const pair = {
      id,
      customName: '',
      terms: [{ value: '', scope: 'all', operator: 'and', negated: false, open: 0, close: 0 }],
      color: color.bg,
      borderColor: color.border,
    };
    setEditingPairs((previous) => [...previous, pair]);
    setEditingMatchOrder((previous) => [...previous, id]);
  };

  const removePair = (pairId) => {
    setEditingPairs((previous) => previous.filter((pair) => pair.id !== pairId));
    setEditingMatchOrder((previous) => previous.filter((id) => id !== pairId));
    setInvalidIds((previous) => {
      const next = new Set(previous);
      next.delete(pairId);
      return next;
    });
  };

  const updatePairColor = (pairId, nextColor) => {
    setEditingPairs((previous) => previous.map((pair) => (
      pair.id === pairId ? { ...pair, ...nextColor } : pair
    )));
  };

  const updatePairName = (pairId, customName) => {
    setEditingPairs((previous) => previous.map((pair) => (
      pair.id === pairId ? { ...pair, customName } : pair
    )));
  };

  const handleDeleteSet = () => {
    if (deleteConfirm !== activeSetId) {
      setDeleteConfirm(activeSetId);
      return;
    }
    removeSet(activeSetId);
    setDeleteConfirm(null);
  };

  const reorderPriority = (nextPairs) => setEditingMatchOrder(nextPairs.map((pair) => pair.id));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay/60 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-config-title"
    >
      <motion.div
        initial={{ scale: 0.97, y: 12, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.97, y: 12, opacity: 0 }}
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-edge-primary bg-surface-secondary shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-edge-primary px-5 py-4 sm:px-6">
          <div>
            <div className="mb-1 flex items-center gap-2 text-accent">
              <Layers3 className="h-4 w-4" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">
                {t('groupConfig.eyebrow')}
              </span>
            </div>
            <h3 id="group-config-title" className="text-lg font-semibold text-content-primary">
              {t('groupConfig.titleMixed')}
            </h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-content-muted">
              {t('groupConfig.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-tertiary hover:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40"
            aria-label={t('groupConfig.cancel')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-edge-primary px-5 pt-4 sm:px-6">
          <div className="mb-3 space-y-1 text-[11px] leading-relaxed text-content-muted">
            <p>{t('groupConfig.sets.switchHint')}</p>
            <p>{t('groupConfig.sets.ruleGuide')}</p>
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-content-tertiary">{t('groupConfig.sets.exampleLabel')}</span>
              <code className="rounded-md bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                {t('groupConfig.sets.example')}
              </code>
            </p>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-3">
            {sets.map((set, index) => {
              const isActive = set.id === activeSetId;
              return (
                <button
                  type="button"
                  key={set.id}
                  onClick={() => handleSwitchSet(set.id)}
                  className={`relative shrink-0 rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-accent/40 ${
                    isActive
                      ? 'bg-accent text-white shadow-md shadow-accent/25'
                      : 'border border-transparent bg-surface-tertiary text-content-secondary hover:border-edge-primary hover:text-content-primary'
                  }`}
                >
                  {set.name || `Set ${index + 1}`}
                </button>
              );
            })}
            <button
              type="button"
              onClick={handleAddSet}
              className="shrink-0 rounded-xl border border-dashed border-edge-primary bg-surface-tertiary p-2 text-content-muted transition-all hover:border-accent/50 hover:bg-accent/5 hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              title={t('groupConfig.sets.newSet')}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="artifex-scrollbar overflow-y-auto px-5 py-5 sm:px-6">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-edge-secondary bg-surface-tertiary px-3 py-2.5 transition-all focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/20">
              <Pencil className="h-3.5 w-3.5 shrink-0 text-content-muted" />
              <input
                type="text"
                value={editingName}
                onChange={(event) => setEditingName(event.target.value)}
                placeholder={t('groupConfig.sets.namePlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-sm text-content-primary placeholder-content-muted focus:outline-none"
              />
            </div>
            {sets.length > 1 && (
              <button
                type="button"
                onClick={handleDeleteSet}
                onBlur={() => setDeleteConfirm(null)}
                className={`rounded-xl px-3 py-2.5 text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-danger/40 ${
                  deleteConfirm === activeSetId
                    ? 'bg-danger text-white shadow-md shadow-danger/20'
                    : 'text-content-muted hover:bg-danger/10 hover:text-danger'
                }`}
                title={t('groupConfig.sets.deleteSet')}
              >
                <span className="flex items-center gap-1.5">
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleteConfirm === activeSetId ? t('groupConfig.sets.deleteConfirmShort') : t('groupConfig.sets.deleteSet')}
                </span>
              </button>
            )}
          </div>

          {invalidIds.size > 0 && (
            <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
              {t('groupConfig.error.parentheses')}
            </div>
          )}

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <section aria-labelledby="display-order-heading">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h4 id="display-order-heading" className="text-sm font-semibold text-content-primary">
                    {t('groupConfig.displayOrder.title')}
                  </h4>
                  <p className="mt-0.5 text-xs text-content-muted">{t('groupConfig.displayOrder.desc')}</p>
                </div>
                <span className="shrink-0 rounded-full bg-surface-tertiary px-2.5 py-1 text-[11px] text-content-muted">
                  {t('groupConfig.groupCount', { count: editingPairs.length })}
                </span>
              </div>

              {editingPairs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-edge-primary bg-surface-tertiary/40 px-5 py-10 text-center text-sm text-content-muted">
                  {t('groupConfig.empty')}
                </div>
              ) : (
                <Reorder.Group axis="y" values={editingPairs} onReorder={setEditingPairs} className="space-y-3">
                  {editingPairs.map((pair, index) => {
                    const fallback = palette[index % palette.length];
                    return (
                      <PairItem
                        key={pair.id}
                        pair={pair}
                        index={index}
                        color={{ bg: pair.color || fallback.bg, border: pair.borderColor || fallback.border }}
                        defaultColor={fallback}
                        palette={palette}
                        invalid={invalidIds.has(pair.id)}
                        t={t}
                        onUpdateTerm={updateTerm}
                        onAddTerm={addTerm}
                        onRemoveTerm={removeTerm}
                        onRemovePair={removePair}
                        onUpdateColor={updatePairColor}
                        onUpdateName={updatePairName}
                      />
                    );
                  })}
                </Reorder.Group>
              )}

              <button
                type="button"
                onClick={addPair}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-edge-primary py-3 text-sm text-content-muted transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                <Plus className="h-4 w-4" />
                {t('groupConfig.addGroup')}
              </button>
            </section>

            <aside className="rounded-2xl border border-edge-primary bg-surface-tertiary/60 p-4 lg:sticky lg:top-0" aria-labelledby="match-priority-heading">
              <div className="mb-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/15 text-accent">
                    <Layers3 className="h-3.5 w-3.5" />
                  </span>
                  <h4 id="match-priority-heading" className="text-sm font-semibold text-content-primary">
                    {t('groupConfig.priority.title')}
                  </h4>
                </div>
                <p className="text-xs leading-relaxed text-content-muted">{t('groupConfig.priority.desc')}</p>
              </div>

              {priorityPairs.length === 0 ? (
                <p className="rounded-xl border border-dashed border-edge-primary px-3 py-5 text-center text-xs text-content-muted">
                  {t('groupConfig.priority.empty')}
                </p>
              ) : (
                <Reorder.Group axis="y" values={priorityPairs} onReorder={reorderPriority} className="space-y-2">
                  {priorityPairs.map((pair, index) => (
                    <PriorityItem
                      key={pair.id}
                      pair={pair}
                      priority={index + 1}
                      displayIndex={editingPairs.findIndex((item) => item.id === pair.id) + 1}
                      t={t}
                    />
                  ))}
                </Reorder.Group>
              )}

              <div
                className="mt-3 flex items-center gap-2 rounded-xl border px-3 py-2.5"
                style={{ backgroundColor: config.otherColor.bg, borderColor: config.otherColor.border }}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: config.otherColor.border }} />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-content-tertiary">{t('groupConfig.other')}</p>
                  <p className="truncate text-[10px] text-content-muted">{t('groupConfig.otherDesc')}</p>
                </div>
              </div>
            </aside>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-edge-primary bg-surface-secondary px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-content-muted transition-colors hover:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            {t('groupConfig.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white shadow-md shadow-accent/20 transition-all hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:ring-offset-2 focus:ring-offset-surface-secondary"
          >
            {t('groupConfig.save')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function getGroupRanges(terms) {
  const stack = [];
  const ranges = [];
  terms.forEach((term, index) => {
    for (let count = 0; count < term.open; count += 1) {
      stack.push({ start: index, depth: stack.length });
    }
    for (let count = 0; count < term.close; count += 1) {
      const opening = stack.pop();
      if (opening) ranges.push({ ...opening, end: index });
    }
  });
  return ranges.sort((a, b) => a.depth - b.depth || a.start - b.start || b.end - a.end);
}

function PairItem({
  pair, index, color, defaultColor, palette, invalid, t,
  onUpdateTerm, onAddTerm, onRemoveTerm, onRemovePair, onUpdateColor, onUpdateName,
}) {
  const dragControls = useDragControls();
  const terms = normalizePairTerms(pair);
  const ranges = getGroupRanges(terms);
  const [logicMode, setLogicMode] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState(new Set());

  useEffect(() => {
    setSelectedIndices((previous) => new Set([...previous].filter((termIndex) => termIndex < terms.length)));
  }, [terms.length]);

  const selected = [...selectedIndices].sort((a, b) => a - b);
  const isContiguous = selected.every((termIndex, selectedIndex) => (
    selectedIndex === 0 || termIndex === selected[selectedIndex - 1] + 1
  ));
  const selectionStart = selected[0];
  const selectionEnd = selected[selected.length - 1];
  const exactRange = isContiguous
    ? [...ranges].reverse().find((range) => range.start === selectionStart && range.end === selectionEnd)
    : null;
  const canGroup = selected.length >= 2
    && isContiguous
    && !exactRange
    && terms[selectionStart]?.open < 4
    && terms[selectionEnd]?.close < 4;
  const canUngroup = Boolean(exactRange);

  const toggleSelection = (termIndex) => {
    setSelectedIndices((previous) => {
      const next = new Set(previous);
      if (next.has(termIndex)) next.delete(termIndex);
      else next.add(termIndex);
      return next;
    });
  };

  const selectRange = (range) => {
    setLogicMode(true);
    setSelectedIndices(new Set(Array.from({ length: range.end - range.start + 1 }, (_, offset) => range.start + offset)));
  };

  const toggleNotForSelection = () => {
    if (selected.length === 0) return;
    const shouldNegate = selected.some((termIndex) => !terms[termIndex].negated);
    selected.forEach((termIndex) => onUpdateTerm(pair.id, termIndex, { negated: shouldNegate }));
    setSelectedIndices(new Set());
  };

  const groupSelection = () => {
    if (!canGroup) return;
    onUpdateTerm(pair.id, selectionStart, { open: terms[selectionStart].open + 1 });
    onUpdateTerm(pair.id, selectionEnd, { close: terms[selectionEnd].close + 1 });
    setSelectedIndices(new Set());
  };

  const ungroupSelection = () => {
    if (!canUngroup) return;
    onUpdateTerm(pair.id, exactRange.start, { open: Math.max(0, terms[exactRange.start].open - 1) });
    onUpdateTerm(pair.id, exactRange.end, { close: Math.max(0, terms[exactRange.end].close - 1) });
    setSelectedIndices(new Set());
  };

  const selectionHint = selected.length === 0
    ? t('groupConfig.logic.selectHint')
    : (!isContiguous ? t('groupConfig.logic.contiguousHint') : t('groupConfig.logic.selectedCount', { count: selected.length }));

  return (
    <Reorder.Item
      value={pair}
      dragListener={false}
      dragControls={dragControls}
      className={`rounded-2xl border p-4 transition-shadow ${invalid ? 'ring-2 ring-danger/40' : ''}`}
      style={{ backgroundColor: color.bg, borderColor: invalid ? 'rgb(var(--clr-danger))' : color.border }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            onPointerDown={(event) => { event.preventDefault(); dragControls.start(event); }}
            className="-m-1 cursor-grab touch-none rounded p-1 text-content-muted transition-colors hover:text-content-secondary active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-accent/30"
            title={t('groupConfig.displayOrder.drag')}
            aria-label={t('groupConfig.displayOrder.drag')}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <GroupColorPicker
            color={color}
            defaultColor={defaultColor}
            palette={palette}
            t={t}
            onChange={(nextColor) => onUpdateColor(pair.id, nextColor)}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-xs font-semibold text-content-secondary">
                {t('groupConfig.groupHeading', { n: index + 1 })}
              </span>
              <span className="hidden text-[10px] text-content-muted sm:inline">{t('groupConfig.displayOrder.badge')}</span>
            </div>
            <input
              type="text"
              value={pair.customName || ''}
              onChange={(event) => onUpdateName(pair.id, event.target.value)}
              placeholder={t('groupConfig.name.placeholder')}
              aria-label={t('groupConfig.name.label', { n: index + 1 })}
              className="mt-0.5 w-full border-b border-transparent bg-transparent py-0.5 text-sm font-medium text-content-primary placeholder-content-muted transition-colors hover:border-edge-secondary focus:border-accent/50 focus:outline-none"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => onRemovePair(pair.id)}
          className="rounded-lg p-1.5 text-content-muted transition-colors hover:bg-danger/10 hover:text-danger focus:outline-none focus:ring-2 focus:ring-danger/30"
          title={t('groupConfig.removeGroup')}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {logicMode && (
        <div className="mb-3 rounded-xl border border-accent/20 bg-surface-secondary/75 p-2.5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-[11px] text-content-muted">{selectionHint}</span>
            <button
              type="button"
              onClick={toggleNotForSelection}
              disabled={selected.length === 0}
              className="rounded-lg border border-edge-secondary bg-surface-tertiary px-2.5 py-1.5 text-[10px] font-bold text-content-tertiary transition-colors hover:border-edge-primary hover:text-content-primary disabled:cursor-not-allowed disabled:opacity-35"
            >
              {selected.length > 0 && selected.every((termIndex) => terms[termIndex].negated)
                ? t('groupConfig.logic.removeNotSelected')
                : t('groupConfig.logic.notSelected')}
            </button>
            <button
              type="button"
              onClick={groupSelection}
              disabled={!canGroup}
              className="rounded-lg border border-accent/25 bg-accent/10 px-2.5 py-1.5 text-[10px] font-semibold text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-35"
            >
              {t('groupConfig.logic.groupSelected')}
            </button>
            <button
              type="button"
              onClick={ungroupSelection}
              disabled={!canUngroup}
              className="rounded-lg border border-edge-secondary bg-surface-tertiary px-2.5 py-1.5 text-[10px] text-content-muted transition-colors hover:text-content-primary disabled:cursor-not-allowed disabled:opacity-35"
            >
              {t('groupConfig.logic.ungroupSelected')}
            </button>
            <button
              type="button"
              onClick={() => { setLogicMode(false); setSelectedIndices(new Set()); }}
              className="rounded-lg px-2.5 py-1.5 text-[10px] font-medium text-content-muted transition-colors hover:bg-surface-tertiary hover:text-content-primary"
            >
              {t('groupConfig.logic.done')}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {terms.map((term, termIndex) => {
          const activeRanges = ranges.filter((range) => range.start <= termIndex && range.end >= termIndex);
          const startingRanges = activeRanges.filter((range) => range.start === termIndex);
          return (
            <div
              key={`${pair.id}_${termIndex}`}
              className={`relative rounded-xl py-0.5 transition-colors ${selectedIndices.has(termIndex) ? 'bg-accent/10' : ''}`}
              style={{ paddingLeft: `${Math.min(activeRanges.length, 4) * 8}px` }}
            >
              {activeRanges.map((range) => (
                <span
                  key={`${range.start}_${range.end}_${range.depth}`}
                  className="pointer-events-none absolute w-1.5 border-l-2 border-accent/35"
                  style={{
                    left: `${range.depth * 7}px`,
                    top: range.start === termIndex ? '4px' : '-4px',
                    bottom: range.end === termIndex ? '4px' : '-4px',
                    borderTop: range.start === termIndex ? '2px solid rgb(var(--clr-accent) / 0.35)' : undefined,
                    borderBottom: range.end === termIndex ? '2px solid rgb(var(--clr-accent) / 0.35)' : undefined,
                    borderTopLeftRadius: range.start === termIndex ? '5px' : undefined,
                    borderBottomLeftRadius: range.end === termIndex ? '5px' : undefined,
                  }}
                />
              ))}
              {startingRanges.map((range) => (
                <button
                  type="button"
                  key={`badge_${range.start}_${range.end}_${range.depth}`}
                  onClick={() => selectRange(range)}
                  className="absolute -top-1 z-10 rounded-md border border-accent/20 bg-surface-secondary px-1 font-mono text-[8px] text-accent shadow-sm transition-colors hover:bg-accent/10"
                  style={{ left: `${range.depth * 7 + 3}px` }}
                  title={t('groupConfig.logic.editGroup')}
                  aria-label={t('groupConfig.logic.editGroup')}
                >
                  (…)
                </button>
              ))}
              <ExpressionTerm
                term={term}
                termIndex={termIndex}
                pairId={pair.id}
                canRemove={terms.length > 1}
                logicMode={logicMode}
                selected={selectedIndices.has(termIndex)}
                t={t}
                onToggleSelected={toggleSelection}
                onUpdate={onUpdateTerm}
                onRemove={(targetPairId, targetTermIndex) => {
                  setSelectedIndices(new Set());
                  onRemoveTerm(targetPairId, targetTermIndex);
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onAddTerm(pair.id)}
          className="flex items-center gap-1 text-xs text-content-muted transition-colors hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        >
          <Plus className="h-3 w-3" />
          {t('groupConfig.addKeyword')}
        </button>
        <button
          type="button"
          onClick={() => {
            setLogicMode((previous) => !previous);
            setSelectedIndices(new Set());
          }}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-medium transition-all focus:outline-none focus:ring-2 focus:ring-accent/30 ${
            logicMode
              ? 'border-accent/30 bg-accent/10 text-accent'
              : 'border-edge-primary bg-surface-tertiary/70 text-content-muted hover:border-edge-secondary hover:text-content-primary'
          }`}
          aria-pressed={logicMode}
        >
          <span className="font-mono text-[9px]">&#123;…&#125;</span>
          {t('groupConfig.logic.tools')}
        </button>
      </div>
    </Reorder.Item>
  );
}

function GroupColorPicker({ color, defaultColor, palette, t, onChange }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const fallbackHex = toHexColor(defaultColor.border);
  const currentHex = toHexColor(color.border, fallbackHex);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="group/color relative flex h-7 w-7 items-center justify-center rounded-lg border border-edge-secondary bg-surface-tertiary shadow-sm transition-all hover:-translate-y-0.5 hover:border-edge-primary hover:shadow-md focus:outline-none focus:ring-2 focus:ring-accent/35"
        title={t('groupConfig.color.edit')}
        aria-label={t('groupConfig.color.edit')}
        aria-expanded={open}
      >
        <span
          className="h-3.5 w-3.5 rounded-full ring-2 ring-white/60 transition-transform group-hover/color:scale-110"
          style={{ backgroundColor: currentHex }}
        />
        <Palette className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-surface-secondary p-0.5 text-content-muted shadow-sm" />
      </button>

      {open && (
        <div
          className="absolute left-0 top-9 z-40 w-64 rounded-2xl border border-edge-primary bg-surface-secondary p-3.5 shadow-2xl shadow-overlay/20"
          role="dialog"
          aria-label={t('groupConfig.color.title')}
        >
          <div className="mb-3">
            <p className="text-xs font-semibold text-content-primary">{t('groupConfig.color.title')}</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-content-muted">{t('groupConfig.color.desc')}</p>
          </div>

          <div className="grid grid-cols-5 gap-2" aria-label={t('groupConfig.color.palette')}>
            {palette.map((preset, presetIndex) => {
              const presetHex = toHexColor(preset.border);
              const selected = presetHex === currentHex;
              return (
                <button
                  type="button"
                  key={`${presetHex}_${presetIndex}`}
                  onClick={() => {
                    onChange(groupColorsFromHex(presetHex));
                    setOpen(false);
                  }}
                  className={`flex h-8 items-center justify-center rounded-lg border transition-all hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent/35 ${
                    selected ? 'border-content-primary shadow-md' : 'border-edge-secondary hover:border-edge-primary'
                  }`}
                  style={{ backgroundColor: presetHex }}
                  aria-label={t('groupConfig.color.preset', { n: presetIndex + 1 })}
                  aria-pressed={selected}
                >
                  {selected && <Check className="h-3.5 w-3.5 text-white drop-shadow" />}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-2 border-t border-edge-primary pt-3">
            <label className="relative flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl border border-edge-secondary bg-surface-tertiary px-2.5 py-2 transition-colors hover:border-edge-primary">
              <span className="h-5 w-5 shrink-0 rounded-md border border-white/50 shadow-inner" style={{ backgroundColor: currentHex }} />
              <span className="min-w-0">
                <span className="block text-[10px] font-medium text-content-tertiary">{t('groupConfig.color.custom')}</span>
                <span className="block font-mono text-[9px] uppercase text-content-muted">{currentHex}</span>
              </span>
              <input
                type="color"
                value={currentHex}
                onChange={(event) => onChange(groupColorsFromHex(event.target.value))}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label={t('groupConfig.color.custom')}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                onChange({ color: defaultColor.bg, borderColor: defaultColor.border });
                setOpen(false);
              }}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-edge-secondary bg-surface-tertiary text-content-muted transition-colors hover:border-edge-primary hover:text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/35"
              title={t('groupConfig.color.reset')}
              aria-label={t('groupConfig.color.reset')}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ExpressionTerm({
  term, termIndex, pairId, canRemove, logicMode, selected,
  t, onToggleSelected, onUpdate, onRemove,
}) {
  const scopeOptions = [
    { value: 'all', label: t('groupConfig.scope.all'), description: t('groupConfig.scope.allDesc') },
    { value: 'tag', label: t('groupConfig.scope.tag'), description: t('groupConfig.scope.tagDesc') },
    { value: 'prompt', label: t('groupConfig.scope.prompt'), description: t('groupConfig.scope.promptDesc') },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
      {logicMode && (
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onToggleSelected(termIndex)}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] transition-all focus:outline-none focus:ring-2 focus:ring-accent/30 ${
            selected
              ? 'border-accent bg-accent text-white'
              : 'border-edge-secondary bg-surface-secondary text-transparent hover:border-accent/50'
          }`}
          title={t('groupConfig.logic.selectCondition')}
          aria-label={t('groupConfig.logic.selectCondition')}
        >
          ✓
        </button>
      )}

      {termIndex === 0 ? (
        <span className="w-[4.5rem] shrink-0 text-center text-[10px] font-semibold uppercase tracking-wide text-content-muted">
          {t('groupConfig.logic.when')}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onUpdate(pairId, termIndex, { operator: term.operator === 'or' ? 'and' : 'or' })}
          className={`w-[4.5rem] shrink-0 rounded-lg border px-2 py-2 text-[10px] font-bold tracking-wide transition-all focus:outline-none focus:ring-2 focus:ring-accent/30 ${
            term.operator === 'or'
              ? 'border-accent/35 bg-accent/15 text-accent'
              : 'border-edge-secondary bg-surface-tertiary text-content-tertiary hover:text-content-primary'
          }`}
          title={t('groupConfig.logic.toggle')}
        >
          {term.operator.toUpperCase()}
        </button>
      )}

      {term.negated && (
        <button
          type="button"
          onClick={() => onUpdate(pairId, termIndex, { negated: false })}
          className="h-7 shrink-0 rounded-md border border-content-secondary/30 bg-content-primary px-1.5 text-[9px] font-bold tracking-wide text-surface-secondary shadow-sm transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-accent/30"
          title={t('groupConfig.logic.removeNot')}
          aria-label={t('groupConfig.logic.removeNot')}
        >
          NOT
        </button>
      )}

      <div className="relative min-w-[8rem] flex-1">
        <TagPromptSuggest
          type="mixed"
          value={term.value}
          onChange={(value) => onUpdate(pairId, termIndex, { value })}
          onSelect={(value, scope) => onUpdate(pairId, termIndex, { value, scope })}
          placeholder={t('groupConfig.keywordPlaceholder.mixed')}
          inputClassName="w-full rounded-lg border border-edge-primary bg-surface-tertiary px-3 py-2 pr-28 text-sm text-content-primary placeholder-content-muted transition-colors focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/20"
        />
        <div className="absolute right-1 top-1 z-10">
          <SettingsSelect
            value={term.scope}
            onChange={(scope) => onUpdate(pairId, termIndex, { scope })}
            options={scopeOptions}
            minWidth={94}
            menuMinWidth={170}
            compact
            placement="top"
            ariaLabel={t('groupConfig.scope.label')}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => onRemove(pairId, termIndex)}
        disabled={!canRemove}
        className="shrink-0 rounded-lg p-2 text-content-muted transition-colors hover:bg-edge-subtle/10 hover:text-content-tertiary disabled:cursor-not-allowed disabled:opacity-25 focus:outline-none focus:ring-2 focus:ring-accent/30"
        title={t('groupConfig.removeKeyword')}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function PriorityItem({ pair, priority, displayIndex, t }) {
  const label = groupDisplayName(pair) || t('groupConfig.priority.untitled');
  return (
    <Reorder.Item
      value={pair}
      className="group flex cursor-grab touch-none items-center gap-2 rounded-xl border border-edge-primary bg-surface-secondary p-2.5 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
      title={t('groupConfig.priority.drag')}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-xs font-bold text-accent">
        {priority}
      </span>
      <span className="h-7 w-1 shrink-0 rounded-full" style={{ backgroundColor: pair.borderColor }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-content-secondary">
          {t('groupConfig.groupHeading', { n: displayIndex })}
        </p>
        <p className="truncate font-mono text-[9px] text-content-muted">{label}</p>
      </div>
      <GripVertical className="h-4 w-4 shrink-0 text-content-muted transition-colors group-hover:text-content-tertiary" />
    </Reorder.Item>
  );
}
