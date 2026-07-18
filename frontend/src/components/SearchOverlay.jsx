import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, Settings, Download, Trash2, X, Monitor, Tag, Loader2 } from 'lucide-react';
import useQuality from '../hooks/useQuality';
import useCardSize, { CARD_SIZE_MIN, CARD_SIZE_MAX } from '../hooks/useCardSize';
import useDownloadConfig from '../hooks/useDownloadConfig';
import useOriginalRatio from '../hooks/useOriginalRatio';
import {
  filterIllustrations,
  flattenVisibleGroups,
  useGroupBy,
  useIllustrationSelection,
} from '../hooks/useGalleryView';
import {
  checkModelStatus,
  deleteIllustration,
  deleteIllustrations,
  retagIllustrations,
  searchIllustrations,
} from '../api';
import { useToast } from './Toast';
import IllustrationCard from './IllustrationCard';
import ConfirmModal from './ConfirmModal';
import Lightbox from './Lightbox';
import ColorGroup from './ColorGroup';
import SettingsSelect from './SettingsSelect';
import TagPromptSuggest from './TagPromptSuggest';
import GroupConfigModal from './GroupConfigModal';
import useGroupConfig, { removeManualAssignmentsForIllustrations } from '../hooks/useGroupConfig';
import { downloadIllustrations } from '../utils/downloadIllustrations';
import { groupIllustrations } from '../utils/grouping';
import { useLocale } from '../contexts/LocaleContext';

// ── Main component ───────────────────────────────────────

export default function SearchOverlay({ query, onClose }) {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [retagging, setRetagging] = useState(false);
  const [retagConfirm, setRetagConfirm] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [groupBy, setGroupBy] = useGroupBy();
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [showGroupConfig, setShowGroupConfig] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [filterScope, setFilterScope] = useState('all');
  const { addToast } = useToast();
  const [quality, setQuality] = useQuality();
  const [cardSize, setCardSize, cardSizeGrid] = useCardSize();
  const [preserveAspectRatio] = useOriginalRatio();
  const { format } = useDownloadConfig();
  const { t } = useLocale();

  const translatedGroupOptions = useMemo(() => [
    { value: 'none', label: t('dropdown.noGrouping') },
    { value: 'mixed', label: t('dropdown.smartGrouping') },
  ], [t]);

  const translatedQualityOptions = useMemo(() => [
    { value: 'low', label: t('quality.low') },
    { value: 'normal', label: t('quality.normal') },
    { value: 'original', label: t('quality.original') },
  ], [t]);

  const activeConfig = useGroupConfig();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    searchIllustrations(query)
      .then((data) => {
        if (!cancelled) setResults(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [query]);

  const items = useMemo(() => results?.items || [], [results]);

  // ── Client-side filter (tags + prompts) ──────────────

  const filteredItems = useMemo(
    () => filterIllustrations(items, filterQuery, filterScope),
    [filterQuery, filterScope, items],
  );

  // ── Grouping ───────────────────────────────────────────

  const groupedIllustrations = useMemo(() => {
    if (groupBy === 'none' || activeConfig.pairs.length === 0 || filteredItems.length === 0) return null;
    return groupIllustrations(
      filteredItems,
      activeConfig.pairs,
      activeConfig.otherColor,
      activeConfig.matchOrder,
      activeConfig.manualAssignments,
    );
  }, [
    activeConfig.manualAssignments,
    activeConfig.matchOrder,
    activeConfig.otherColor,
    activeConfig.pairs,
    filteredItems,
    groupBy,
  ]);

  const displayedItems = useMemo(() => {
    return flattenVisibleGroups(groupedIllustrations, collapsedGroups) || filteredItems;
  }, [groupedIllustrations, collapsedGroups, filteredItems]);

  const {
    selectedIds,
    clearSelection,
    removeFromSelection,
    handleCardClick,
    handleCtrlClick,
    handleShiftClick,
  } = useIllustrationSelection(displayedItems, setLightboxIndex);

  const toggleGroupCollapse = useCallback((groupId) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  // ── Handlers ───────────────────────────────────────────

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteIllustration(deleteTarget.id);
      activeConfig.removeManualGroupIds([deleteTarget.id]);
      await removeManualAssignmentsForIllustrations([deleteTarget.id]).catch(() => {});
      setResults((prev) => prev ? {
        ...prev,
        items: prev.items.filter((i) => i.id !== deleteTarget.id),
        total: prev.total - 1,
      } : prev);
      removeFromSelection([deleteTarget.id]);
      addToast(t('searchOverlay.toast.deleted'), 'success');
    } catch (err) {
      addToast(err.message || t('searchOverlay.toast.deleteFailed'), 'error');
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleBatchDelete = async () => {
    setBatchDeleting(true);
    const ids = [...selectedIds];
    try {
      const result = await deleteIllustrations(ids);
      const deletedIds = new Set(result.deleted);
      if (deletedIds.size > 0) {
        activeConfig.removeManualGroupIds(result.deleted);
        await removeManualAssignmentsForIllustrations(result.deleted).catch(() => {});
        setResults((prev) => prev ? {
          ...prev,
          items: prev.items.filter((item) => !deletedIds.has(item.id)),
          total: Math.max(0, prev.total - deletedIds.size),
        } : prev);
        removeFromSelection(result.deleted);
      }
      if (result.failed.length === 0) {
        clearSelection();
        addToast(t('searchOverlay.toast.batchDeleted', { n: result.deleted.length }), 'success');
      } else {
        addToast(t('searchOverlay.toast.batchPartial', {
          succeeded: result.deleted.length,
          failed: result.failed.length,
        }), 'error');
      }
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleBatchRetag = async () => {
    setRetagConfirm(false);
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setRetagging(true);
    try {
      try {
        const status = await checkModelStatus();
        if (!status.cached) {
          addToast(t('searchOverlay.toast.retagNoModel'), 'error');
          setRetagging(false);
          return;
        }
      } catch { /* fall through */ }

      const res = await retagIllustrations(ids);
      const updated = res?.updated || [];
      const failed = res?.failed || [];

      if (updated.length > 0) {
        const byId = new Map(updated.map(it => [it.id, it]));
        setResults((prev) => prev ? {
          ...prev,
          items: prev.items.map((it) => byId.get(it.id) || it),
        } : prev);
      }

      if (failed.length === 0) {
        addToast(t('searchOverlay.toast.retagDone', { n: updated.length }), 'success');
      } else if (updated.length === 0) {
        addToast(t('searchOverlay.toast.retagFailed', { n: failed.length }), 'error');
      } else {
        addToast(
          t('searchOverlay.toast.retagPartial', { succeeded: updated.length, failed: failed.length }),
          'error'
        );
      }
    } catch (err) {
      addToast(err.message || t('searchOverlay.toast.retagFailed', { n: ids.length }), 'error');
    } finally {
      setRetagging(false);
    }
  };

  const handleBatchDownload = async () => {
    const selected = items.filter((i) => selectedIds.has(i.id));
    if (selected.length === 0) return;
    addToast(t('searchOverlay.toast.downloading', { n: selected.length }), 'success');
    const result = await downloadIllustrations(selected, format);
    if (result.failed.length > 0) {
      addToast(t('searchOverlay.toast.downloadPartial', {
        succeeded: result.downloaded.length,
        failed: result.failed.length,
      }), 'error');
    }
  };

  const handleLightboxDelete = async (ill) => {
    try {
      await deleteIllustration(ill.id);
      activeConfig.removeManualGroupIds([ill.id]);
      await removeManualAssignmentsForIllustrations([ill.id]).catch(() => {});
      setResults((prev) => prev ? {
        ...prev,
        items: prev.items.filter((i) => i.id !== ill.id),
        total: prev.total - 1,
      } : prev);
      removeFromSelection([ill.id]);
      addToast(t('searchOverlay.toast.deleted'), 'success');
    } catch (err) {
      addToast(err.message || t('searchOverlay.toast.deleteFailed'), 'error');
    }
  };

  const cardProps = useCallback((ill) => ({
    illustration: ill,
    onClick: handleCardClick,
    onCtrlClick: handleCtrlClick,
    onShiftClick: handleShiftClick,
    onDelete: setDeleteTarget,
    isSelected: selectedIds.has(ill.id),
    showHoverActions: true,
    quality,
    preserveAspectRatio,
  }), [
    handleCardClick,
    handleCtrlClick,
    handleShiftClick,
    preserveAspectRatio,
    quality,
    selectedIds,
  ]);

  // ── Render ─────────────────────────────────────────────

  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col bg-surface-primary">
        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-edge-primary shrink-0">
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-tertiary text-content-tertiary hover:text-content-secondary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-lg font-semibold text-content-primary">
            {t('searchOverlay.heading')}<span className="text-accent">{query}</span>
          </h2>
          {results && (
            <>
              <span className="text-sm text-content-muted">
                {filterQuery.trim()
                  ? t('searchOverlay.filteredCount', { filteredCount: filteredItems.length, total: results.total })
                  : t('searchOverlay.totalCount', { total: results.total })}
              </span>
              {filterQuery.trim() && filterScope !== 'all' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent font-medium uppercase">
                  {filterScope}
                </span>
              )}
            </>
          )}

          {/* Group By & Quality controls */}
          <div className="ml-auto flex items-center gap-3">
            {/* In-page search */}
            <TagPromptSuggest
              type="mixed"
              value={filterQuery}
              onChange={(v) => { setFilterQuery(v); if (!v) setFilterScope('all'); }}
              onSelect={(v, scope) => { setFilterQuery(v); setFilterScope(scope); }}
              onEnter={(v) => { setFilterQuery(v); setFilterScope('all'); }}
              placeholder={t('searchOverlay.filter.placeholder')}
              className="w-52"
              inputClassName="w-full pl-3 pr-3 py-2 rounded-lg bg-surface-tertiary border border-edge-secondary text-sm text-content-primary placeholder-content-muted focus:outline-none focus:border-accent/50 transition-colors"
            />
            {items.length > 1 && (
              <SettingsSelect
                variant="toolbar"
                icon={Layers}
                label={t('searchOverlay.group.label')}
                options={translatedGroupOptions}
                value={groupBy}
                onChange={(v) => { setGroupBy(v); setCollapsedGroups(new Set()); }}
                rightElement={
                  groupBy !== 'none' ? (
                    <button
                      onClick={() => setShowGroupConfig(true)}
                      className="p-2 rounded-lg bg-surface-tertiary border border-edge-secondary hover:border-edge-primary text-content-tertiary hover:text-content-primary transition-all"
                      title={t('searchOverlay.group.configMixed')}
                    >
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                  ) : null
                }
              />
            )}
            <SettingsSelect
              variant="toolbar"
              icon={Monitor}
              label={t('searchOverlay.quality.label')}
              options={translatedQualityOptions}
              value={quality}
              onChange={setQuality}
            />

            {/* Card size slider */}
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface-tertiary border border-edge-secondary">
              <span className="text-xs text-content-muted whitespace-nowrap">{t('searchOverlay.cardSize.label')}</span>
              <input
                type="range"
                min={CARD_SIZE_MIN}
                max={CARD_SIZE_MAX}
                value={cardSize}
                onChange={(e) => setCardSize(Number(e.target.value))}
                className="w-20 h-1.5 rounded-full appearance-none bg-edge-secondary cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110
                  [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-pointer
                  accent-accent"
              />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-content-muted text-sm">{t('searchOverlay.searching')}</div>
          ) : error ? (
            <div className="flex items-center justify-center h-64 text-danger text-sm">{error}</div>
          ) : !results || results.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-content-muted">
              <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <p className="text-sm">{t('searchOverlay.empty')}</p>
            </div>
          ) : groupedIllustrations ? (
            /* Grouped rendering */
            <div>
              {groupedIllustrations.map((group) => (
                <ColorGroup
                  key={group.id}
                  group={group}
                  collapsed={collapsedGroups.has(group.id)}
                  onToggle={() => toggleGroupCollapse(group.id)}
                  cardSize={cardSize}
                >
                  {group.items.map((ill) => (
                    <IllustrationCard key={ill.id} {...cardProps(ill)} />
                  ))}
                </ColorGroup>
              ))}
            </div>
          ) : (
            /* Flat grid */
            <div className={`grid ${cardSizeGrid} gap-4`}>
              <AnimatePresence mode="popLayout">
                {filteredItems.map((ill) => (
                  <IllustrationCard key={ill.id} {...cardProps(ill)} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Key hints */}
        {selectedIds.size === 0 && items.length > 0 && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[55] px-4 py-2 rounded-lg bg-surface-secondary/85 backdrop-blur border border-edge-primary/60 shadow-lg text-xs text-content-secondary flex items-center gap-3 select-none">
            <span><kbd className="px-1 py-0.5 rounded bg-edge-subtle/10 text-content-tertiary text-[10px] font-mono">Ctrl+Click</kbd> {t('searchOverlay.keyHints.ctrlClick')}</span>
            <span className="text-content-muted/50">|</span>
            <span><kbd className="px-1 py-0.5 rounded bg-edge-subtle/10 text-content-tertiary text-[10px] font-mono">Shift+Click</kbd> {t('searchOverlay.keyHints.shiftClick')}</span>
          </div>
        )}

        {/* Batch action bar */}
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed bottom-0 left-0 right-0 z-[55] bg-surface-secondary border-t border-edge-primary px-6 py-4 flex items-center justify-between shadow-2xl"
          >
            <span className="text-sm text-content-secondary">{t('searchOverlay.batch.selected', { count: selectedIds.size })}</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setRetagConfirm(true)}
                disabled={retagging}
                className="px-4 py-2 rounded-xl bg-surface-tertiary hover:bg-edge-secondary disabled:opacity-50 text-sm text-content-secondary hover:text-content-primary transition-all flex items-center gap-2 font-medium border border-transparent hover:border-edge-primary"
              >
                {retagging
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Tag className="w-4 h-4" />}
                {retagging ? t('searchOverlay.batch.retagging') : t('searchOverlay.batch.retag')}
              </button>
              <button
                onClick={handleBatchDownload}
                className="px-4 py-2 rounded-xl bg-surface-tertiary hover:bg-edge-secondary text-sm text-content-secondary hover:text-content-primary transition-all flex items-center gap-2 font-medium border border-transparent hover:border-edge-primary"
              >
                <Download className="w-4 h-4" />
                {t('searchOverlay.batch.download')}
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={batchDeleting}
                className="px-4 py-2 rounded-xl bg-danger hover:bg-danger-hover disabled:opacity-50 text-sm text-white shadow-lg shadow-danger/20 hover:shadow-danger/30 transition-all hover:scale-[1.02] flex items-center gap-2 font-medium"
              >
                <Trash2 className="w-4 h-4" />
                {batchDeleting ? t('searchOverlay.batch.deleting') : t('searchOverlay.batch.delete')}
              </button>
              <button
                onClick={clearSelection}
                className="px-3 py-2 rounded-lg text-sm text-content-muted hover:text-content-secondary transition-colors flex items-center gap-1.5"
              >
                <X className="w-4 h-4" />
                {t('searchOverlay.batch.clear')}
              </button>
            </div>
          </motion.div>
        )}
      </div>

      {/* Group Config Modal */}
      <AnimatePresence>
        {showGroupConfig && (
          <GroupConfigModal
            config={activeConfig}
            onClose={() => setShowGroupConfig(false)}
          />
        )}
      </AnimatePresence>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <Lightbox
          illustrations={displayedItems}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onDelete={handleLightboxDelete}
          onUpdate={(updated) => {
            setResults((prev) => prev ? {
              ...prev,
              items: prev.items.map((i) => (i.id === updated.id ? updated : i)),
            } : prev);
          }}
        />
      )}

      {/* Confirm: delete illustration */}
      {deleteTarget && (
        <ConfirmModal
          title={t('searchOverlay.delete.title')}
          message={t('searchOverlay.delete.message', { filename: deleteTarget.original_filename })}
          confirmText={t('searchOverlay.delete.confirm')}
          cancelText={t('searchOverlay.delete.cancel')}
          danger
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Confirm: re-tag selected illustrations */}
      {retagConfirm && (
        <ConfirmModal
          title={t('searchOverlay.retag.title')}
          message={t('searchOverlay.retag.message', { count: selectedIds.size })}
          confirmText={t('searchOverlay.retag.confirm')}
          cancelText={t('searchOverlay.retag.cancel')}
          onConfirm={handleBatchRetag}
          onCancel={() => setRetagConfirm(false)}
        />
      )}
    </>
  );
}
