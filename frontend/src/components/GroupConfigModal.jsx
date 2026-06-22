import { useState, useEffect } from 'react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion';
import { Plus, Trash2, Pencil, GripVertical } from 'lucide-react';
import TagPromptSuggest from './TagPromptSuggest';
import { useLocale } from '../contexts/LocaleContext';

export default function GroupConfigModal({ type, config, onClose }) {
  const { t } = useLocale();
  const { sets, activeSetId, switchSet, addSet, removeSet, renameSet, setPairs, palette } = config;

  const activeSet = sets.find((s) => s.id === activeSetId) || sets[0];

  // Local editing state — staged until Save
  const [editingPairs, setEditingPairs] = useState([]);
  const [editingName, setEditingName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null); // set id pending deletion

  // Sync local editing state whenever activeSetId or sets change
  useEffect(() => {
    const target = sets.find((s) => s.id === activeSetId);
    if (target) {
      setEditingPairs((target.pairs || []).map((p) => ({ ...p, keywords: [...p.keywords] })));
      setEditingName(target.name || '');
    }
    setDeleteConfirm(null);
  }, [activeSetId, sets]);

  const handleSwitchSet = (setId) => {
    // Save staged edits to current set before switching
    const cleaned = editingPairs
      .map((p) => ({ ...p, keywords: p.keywords.map((k) => k.trim()).filter(Boolean) }))
      .filter((p) => p.keywords.length > 0);
    setPairs(cleaned);
    if (editingName.trim() && editingName.trim() !== activeSet?.name) {
      renameSet(activeSetId, editingName.trim());
    }
    switchSet(setId);
  };

  const handleAddSet = () => {
    // Save current first
    const cleaned = editingPairs
      .map((p) => ({ ...p, keywords: p.keywords.map((k) => k.trim()).filter(Boolean) }))
      .filter((p) => p.keywords.length > 0);
    setPairs(cleaned);
    if (editingName.trim() && editingName.trim() !== activeSet?.name) {
      renameSet(activeSetId, editingName.trim());
    }
    addSet(); // hook auto-switches to new set, useEffect syncs local state
  };

  const handleSave = () => {
    const name = editingName.trim();
    if (name && name !== activeSet?.name) {
      renameSet(activeSetId, name);
    }
    const cleaned = editingPairs
      .map((p) => ({ ...p, keywords: p.keywords.map((k) => k.trim()).filter(Boolean) }))
      .filter((p) => p.keywords.length > 0);
    setPairs(cleaned);
    onClose();
  };

  const handleKeywordChange = (pairId, index, value) => {
    setEditingPairs((prev) =>
      prev.map((p) => {
        if (p.id !== pairId) return p;
        const kw = [...p.keywords];
        kw[index] = value;
        return { ...p, keywords: kw };
      })
    );
  };

  const handleAddKeyword = (pairId) => {
    setEditingPairs((prev) =>
      prev.map((p) => {
        if (p.id !== pairId) return p;
        return { ...p, keywords: [...p.keywords, ''] };
      })
    );
  };

  const handleRemoveKeyword = (pairId, index) => {
    setEditingPairs((prev) =>
      prev.map((p) => {
        if (p.id !== pairId) return p;
        const kw = p.keywords.filter((_, i) => i !== index);
        return { ...p, keywords: kw.length === 0 ? [''] : kw };
      })
    );
  };

  const handleAddPair = () => {
    const id = `pair_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const idx = editingPairs.length;
    const color = palette[idx % palette.length];
    setEditingPairs((prev) => [
      ...prev,
      { id, keywords: [''], color: color.bg, borderColor: color.border },
    ]);
  };

  const handleRemovePair = (pairId) => {
    setEditingPairs((prev) => prev.filter((p) => p.id !== pairId));
  };

  const handleDeleteSet = () => {
    if (!deleteConfirm) {
      setDeleteConfirm(activeSetId);
      return;
    }
    removeSet(deleteConfirm);
    setDeleteConfirm(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay/60 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-surface-secondary border border-edge-primary rounded-2xl w-full max-w-xl mx-4 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-edge-primary flex items-center justify-between">
          <h3 className="text-base font-semibold text-content-primary">
            {type === 'tag' ? t('groupConfig.titleTag') : t('groupConfig.titlePrompt')}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-tertiary text-content-muted hover:text-content-secondary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Set tabs bar */}
        <div className="px-6 pt-4">
          <p className="text-[11px] text-content-muted mb-2.5">{t('groupConfig.sets.switchHint')}</p>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
            {sets.map((s) => {
              const isActive = s.id === activeSetId;
              return (
                <button
                  key={s.id}
                  onClick={() => handleSwitchSet(s.id)}
                  className={`relative shrink-0 px-3.5 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? 'bg-accent text-white shadow-md shadow-accent/25'
                      : 'bg-surface-tertiary text-content-secondary hover:text-content-primary hover:bg-edge-secondary border border-transparent hover:border-edge-primary'
                  }`}
                >
                  {s.name || `Set ${sets.indexOf(s) + 1}`}
                </button>
              );
            })}

            {/* Add new set button */}
            <button
              onClick={handleAddSet}
              className="shrink-0 p-2 rounded-xl bg-surface-tertiary border border-dashed border-edge-primary hover:border-accent/50 hover:bg-accent/5 text-content-muted hover:text-accent transition-all duration-200"
              title={t('groupConfig.sets.newSet')}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="mx-6 border-t border-edge-subtle/30" />

        {/* Body */}
        <div className="px-6 py-4 max-h-[55vh] overflow-y-auto space-y-4">
          {/* Set name editor + delete */}
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 bg-surface-tertiary rounded-lg border border-edge-secondary focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/20 transition-all px-3 py-2">
              <Pencil className="w-3.5 h-3.5 text-content-muted shrink-0" />
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                placeholder={t('groupConfig.sets.namePlaceholder')}
                className="flex-1 bg-transparent text-sm text-content-primary placeholder-content-muted focus:outline-none"
              />
            </div>
            {sets.length > 1 && (
              <button
                onClick={handleDeleteSet}
                className={`shrink-0 flex flex-col items-center px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                  deleteConfirm === activeSetId
                    ? 'bg-danger text-white shadow-md shadow-danger/20'
                    : 'text-content-muted hover:text-danger hover:bg-danger/10'
                }`}
                title={t('groupConfig.sets.deleteSet')}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:block">
                  {deleteConfirm === activeSetId
                    ? t('groupConfig.sets.deleteConfirm', { name: editingName || activeSet?.name || '' })
                    : t('groupConfig.sets.deleteSet')}
                </span>
              </button>
            )}
          </div>

          <p className="text-xs text-content-muted leading-relaxed">
            {t('groupConfig.help.general')}
            {type === 'prompt' && <> {t('groupConfig.help.prompt')}</>}
            {' '}{t('groupConfig.help.other')}
          </p>

          {editingPairs.length === 0 && (
            <div className="text-center py-8 text-content-muted text-sm">
              {t('groupConfig.empty')}
            </div>
          )}

          {editingPairs.length > 0 && (
            <Reorder.Group
              axis="y"
              values={editingPairs}
              onReorder={setEditingPairs}
              className="space-y-4"
            >
              {editingPairs.map((pair, pi) => {
                const fallback = palette[pi % palette.length];
                const color = {
                  bg: pair.color || fallback.bg,
                  border: pair.borderColor || fallback.border,
                };
                return (
                  <PairItem
                    key={pair.id}
                    pair={pair}
                    index={pi}
                    color={color}
                    type={type}
                    t={t}
                    onKeywordChange={handleKeywordChange}
                    onAddKeyword={handleAddKeyword}
                    onRemoveKeyword={handleRemoveKeyword}
                    onRemovePair={handleRemovePair}
                  />
                );
              })}
            </Reorder.Group>
          )}

          <button
            onClick={handleAddPair}
            className="w-full py-3 rounded-xl border-2 border-dashed border-edge-primary hover:border-edge-secondary text-content-muted hover:text-content-tertiary text-sm transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t('groupConfig.addGroup')}
          </button>

          {/* Other group preview */}
          <div
            className="rounded-xl p-3 border flex items-center gap-3"
            style={{ backgroundColor: config.otherColor.bg, borderColor: config.otherColor.border }}
          >
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: config.otherColor.border }}
            />
            <span className="text-sm text-content-tertiary">{t('groupConfig.other')}</span>
            <span className="text-xs text-content-muted">{t('groupConfig.otherDesc')}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-edge-primary flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-content-muted hover:text-content-secondary transition-colors"
          >
            {t('groupConfig.cancel')}
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-lg bg-accent hover:bg-accent-hover text-sm font-medium text-white transition-colors"
          >
            {t('groupConfig.save')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function PairItem({ pair, index, color, type, t, onKeywordChange, onAddKeyword, onRemoveKeyword, onRemovePair }) {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      value={pair}
      dragListener={false}
      dragControls={dragControls}
      className="rounded-xl p-4 border"
      style={{ backgroundColor: color.bg, borderColor: color.border }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onPointerDown={(e) => { e.preventDefault(); dragControls.start(e); }}
            className="p-1 -m-1 rounded text-content-muted hover:text-content-secondary cursor-grab active:cursor-grabbing touch-none"
            title={t('groupConfig.dragReorder')}
            aria-label={t('groupConfig.dragReorder')}
          >
            <GripVertical className="w-4 h-4" />
          </button>
          <span
            className="w-3.5 h-3.5 rounded-full shrink-0"
            style={{ backgroundColor: color.border }}
          />
          <span className="text-sm font-medium text-content-secondary">
            {t('groupConfig.groupHeading', { n: index + 1 })}
          </span>
        </div>
        <button
          onClick={() => onRemovePair(pair.id)}
          className="p-1 rounded-lg hover:bg-edge-subtle/10 text-content-muted hover:text-danger transition-colors"
          title={t('groupConfig.removeGroup')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      <div className="space-y-1.5">
        {pair.keywords.map((kw, ki) => (
          <div key={ki} className="flex items-center gap-1.5">
            <TagPromptSuggest
              type={type}
              value={kw}
              onChange={(val) => onKeywordChange(pair.id, ki, val)}
              placeholder={type === 'tag' ? t('groupConfig.keywordPlaceholder.tag') : t('groupConfig.keywordPlaceholder.prompt')}
              className="flex-1"
              inputClassName="w-full bg-surface-tertiary border border-edge-primary rounded-lg px-3 py-1.5 text-sm text-content-primary placeholder-content-muted focus:outline-none focus:border-accent/50 transition-colors"
            />
            {pair.keywords.length > 1 && (
              <button
                onClick={() => onRemoveKeyword(pair.id, ki)}
                className="p-1.5 rounded-lg hover:bg-edge-subtle/10 text-content-muted hover:text-content-tertiary transition-colors shrink-0"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => onAddKeyword(pair.id)}
          className="text-xs text-content-muted hover:text-content-tertiary transition-colors flex items-center gap-1 mt-1"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {t('groupConfig.addKeyword')}
        </button>
      </div>
    </Reorder.Item>
  );
}
