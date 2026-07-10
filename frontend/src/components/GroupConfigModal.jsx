import { useEffect, useMemo, useState } from 'react';
import { motion, Reorder, useDragControls } from 'framer-motion';
import {
  Brackets, ChevronDown, GripVertical, Layers3, MessageSquareText,
  Pencil, Plus, Sparkles, Tag, Trash2, X,
} from 'lucide-react';
import TagPromptSuggest from './TagPromptSuggest';
import { useLocale } from '../contexts/LocaleContext';
import { expressionLabel, normalizePairTerms, validateExpression } from '../utils/grouping';

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
    return [{ ...pair, terms }];
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
            value: '', scope: 'all', operator: 'and', open: 0, close: 0,
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
        return { ...pair, terms: [{ value: '', scope: 'all', operator: 'and', open: 0, close: 0 }] };
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
      terms: [{ value: '', scope: 'all', operator: 'and', open: 0, close: 0 }],
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
          <p className="mb-2.5 text-[11px] text-content-muted">{t('groupConfig.sets.switchHint')}</p>
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

        <div className="overflow-y-auto px-5 py-5 sm:px-6">
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

          <div className="mb-5 grid gap-2 sm:grid-cols-3">
            <HelpChip icon={Sparkles} text={t('groupConfig.help.mixed')} />
            <HelpChip icon={Brackets} text={t('groupConfig.help.logic')} />
            <HelpChip icon={Layers3} text={t('groupConfig.help.priority')} />
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
                        invalid={invalidIds.has(pair.id)}
                        t={t}
                        onUpdateTerm={updateTerm}
                        onAddTerm={addTerm}
                        onRemoveTerm={removeTerm}
                        onRemovePair={removePair}
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

function HelpChip({ icon: Icon, text }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-edge-primary bg-surface-tertiary/60 px-3 py-2.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
      <span className="text-[11px] leading-relaxed text-content-tertiary">{text}</span>
    </div>
  );
}

function PairItem({ pair, index, color, invalid, t, onUpdateTerm, onAddTerm, onRemoveTerm, onRemovePair }) {
  const dragControls = useDragControls();
  const terms = normalizePairTerms(pair);

  return (
    <Reorder.Item
      value={pair}
      dragListener={false}
      dragControls={dragControls}
      className={`rounded-2xl border p-4 transition-shadow ${invalid ? 'ring-2 ring-danger/40' : ''}`}
      style={{ backgroundColor: color.bg, borderColor: invalid ? 'rgb(var(--clr-danger))' : color.border }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onPointerDown={(event) => { event.preventDefault(); dragControls.start(event); }}
            className="-m-1 cursor-grab touch-none rounded p-1 text-content-muted transition-colors hover:text-content-secondary active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-accent/30"
            title={t('groupConfig.displayOrder.drag')}
            aria-label={t('groupConfig.displayOrder.drag')}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: color.border }} />
          <span className="truncate text-sm font-semibold text-content-secondary">
            {t('groupConfig.groupHeading', { n: index + 1 })}
          </span>
          <span className="hidden text-[10px] text-content-muted sm:inline">{t('groupConfig.displayOrder.badge')}</span>
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

      <div className="space-y-2">
        {terms.map((term, termIndex) => (
          <ExpressionTerm
            key={`${pair.id}_${termIndex}`}
            term={term}
            termIndex={termIndex}
            pairId={pair.id}
            canRemove={terms.length > 1}
            t={t}
            onUpdate={onUpdateTerm}
            onRemove={onRemoveTerm}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => onAddTerm(pair.id)}
        className="mt-2 flex items-center gap-1 text-xs text-content-muted transition-colors hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
      >
        <Plus className="h-3 w-3" />
        {t('groupConfig.addKeyword')}
      </button>
    </Reorder.Item>
  );
}

function ExpressionTerm({ term, termIndex, pairId, canRemove, t, onUpdate, onRemove }) {
  const scopeOptions = [
    { value: 'all', label: t('groupConfig.scope.all'), icon: Sparkles },
    { value: 'tag', label: t('groupConfig.scope.tag'), icon: Tag },
    { value: 'prompt', label: t('groupConfig.scope.prompt'), icon: MessageSquareText },
  ];
  const currentScope = scopeOptions.find((option) => option.value === term.scope) || scopeOptions[0];
  const ScopeIcon = currentScope.icon;

  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
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

      <ParenStepper
        value={term.open}
        symbol="("
        decreaseLabel={t('groupConfig.logic.removeOpen')}
        increaseLabel={t('groupConfig.logic.addOpen')}
        onChange={(value) => onUpdate(pairId, termIndex, { open: value })}
      />

      <div className="relative min-w-[8rem] flex-1">
        <TagPromptSuggest
          type="mixed"
          value={term.value}
          onChange={(value) => onUpdate(pairId, termIndex, { value })}
          onSelect={(value, scope) => onUpdate(pairId, termIndex, { value, scope })}
          placeholder={t('groupConfig.keywordPlaceholder.mixed')}
          inputClassName="w-full rounded-lg border border-edge-primary bg-surface-tertiary px-3 py-2 pr-24 text-sm text-content-primary placeholder-content-muted transition-colors focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/20"
        />
        <label className="absolute right-1 top-1 z-10 flex h-[calc(100%-0.5rem)] items-center rounded-md border border-edge-primary bg-surface-secondary text-[10px] text-content-muted shadow-sm">
          <ScopeIcon className="ml-2 h-3 w-3 shrink-0" />
          <select
            value={term.scope}
            onChange={(event) => onUpdate(pairId, termIndex, { scope: event.target.value })}
            className="h-full max-w-[4.75rem] cursor-pointer appearance-none bg-transparent py-0 pl-1 pr-5 text-[10px] text-content-tertiary focus:outline-none"
            aria-label={t('groupConfig.scope.label')}
          >
            {scopeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1 h-3 w-3" />
        </label>
      </div>

      <ParenStepper
        value={term.close}
        symbol=")"
        decreaseLabel={t('groupConfig.logic.removeClose')}
        increaseLabel={t('groupConfig.logic.addClose')}
        onChange={(value) => onUpdate(pairId, termIndex, { close: value })}
      />

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

function ParenStepper({ value, symbol, decreaseLabel, increaseLabel, onChange }) {
  return (
    <div className="flex h-9 shrink-0 items-center overflow-hidden rounded-lg border border-edge-primary bg-surface-tertiary">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={value === 0}
        className="h-full px-1.5 text-xs text-content-muted transition-colors hover:bg-edge-secondary hover:text-content-primary disabled:opacity-25"
        title={decreaseLabel}
        aria-label={decreaseLabel}
      >
        −
      </button>
      <span className={`min-w-4 text-center font-mono text-xs ${value ? 'font-bold text-accent' : 'text-content-muted'}`}>
        {value ? symbol.repeat(value) : symbol}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(4, value + 1))}
        disabled={value >= 4}
        className="h-full px-1.5 text-xs text-content-muted transition-colors hover:bg-edge-secondary hover:text-content-primary disabled:opacity-25"
        title={increaseLabel}
        aria-label={increaseLabel}
      >
        +
      </button>
    </div>
  );
}

function PriorityItem({ pair, priority, displayIndex, t }) {
  const label = expressionLabel(pair) || t('groupConfig.priority.untitled');
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
