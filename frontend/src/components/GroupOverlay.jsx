import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowUpDown, ChevronLeft, ChevronRight, Download, ImagePlus, Layers, Loader2,
  Monitor, Palette, Ratio, Settings, Tag, Trash2, Upload, X,
} from 'lucide-react';
import useQuality from '../hooks/useQuality';
import useCardSize, { CARD_SIZE_MIN, CARD_SIZE_MAX } from '../hooks/useCardSize';
import useOriginalRatio from '../hooks/useOriginalRatio';
import useDownloadConfig from '../hooks/useDownloadConfig';
import useIllustrationFileDrop from '../hooks/useIllustrationFileDrop';
import {
  filterIllustrations,
  flattenVisibleGroups,
  useGroupBy,
  useIllustrationSelection,
} from '../hooks/useGalleryView';
import {
  checkModelStatus, deleteIllustrations,
  downloadModel, getSettings, listAllIllustrations, retagIllustrations,
  updateGroup, updateIllustrationTags, uploadSingleIllustration,
} from '../api';
import { useToast } from './Toast';
import ConfirmModal from './ConfirmModal';
import Lightbox from './Lightbox';
import IllustrationCard from './IllustrationCard';
import ColorGroup from './ColorGroup';
import SettingsSelect from './SettingsSelect';
import TagPromptSuggest from './TagPromptSuggest';
import GroupConfigModal from './GroupConfigModal';
import ColorGroupBoard from './ColorGroupBoard';
import ModelDownloadModal from './ModelDownloadModal';
import UploadSummaryModal from './UploadSummaryModal';
import useGroupConfig, { removeManualAssignmentsForIllustrations } from '../hooks/useGroupConfig';
import { downloadIllustrations } from '../utils/downloadIllustrations';
import { groupIllustrations, paginateIllustrationGroups } from '../utils/grouping';
import { useLocale } from '../contexts/LocaleContext';

// ── Main component ───────────────────────────────────────

export default function GroupOverlay({ group, onClose, onGroupUpdated }) {
  const [illustrations, setIllustrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // { current, total, filename, stage }
  const [pendingFiles, setPendingFiles] = useState(null); // files queued for upload while model modal is shown
  const [showModelModal, setShowModelModal] = useState(false);
  const [autoTagEnabled, setAutoTagEnabled] = useState(true); // whether auto-tag is enabled in Settings
  const [filterQuery, setFilterQuery] = useState('');
  const [filterScope, setFilterScope] = useState('all'); // 'all' | 'tag' | 'prompt'
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [coverTarget, setCoverTarget] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [retagging, setRetagging] = useState(false);
  const [retagConfirm, setRetagConfirm] = useState(false);
  const [uploadSummary, setUploadSummary] = useState(null); // { added, skipped, overwritten, failed }
  const [conflictPolicy, setConflictPolicy] = useState('save_all');
  const [sortBy, setSortBy] = useState('');
  const [sortOrder, setSortOrder] = useState('desc');
  const [groupBy, setGroupBy] = useGroupBy();
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [showGroupConfig, setShowGroupConfig] = useState(false);
  const [showColorBoard, setShowColorBoard] = useState(false);
  const fileInputRef = useRef(null);
  const { addToast } = useToast();
  const [quality, setQuality] = useQuality();
  const [cardSize, setCardSize, cardSizeGrid] = useCardSize();
  const [preserveAspectRatio, setPreserveAspectRatio] = useOriginalRatio();
  const { format } = useDownloadConfig();
  const { t } = useLocale();

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);

  const PAGE_SIZE_OPTIONS = useMemo(() => [
    { value: 50, label: '50' },
    { value: 100, label: '100' },
    { value: 200, label: '200' },
    { value: 500, label: '500' },
    { value: 1000, label: '1000' },
    { value: 'all', label: t('groupOverlay.pagination.all') },
  ], [t]);

  const SORT_OPTIONS = useMemo(() => [
    { value: '', label: t('groupOverlay.sort.default') },
    { value: 'resolution', label: t('groupOverlay.sort.resolution') },
    { value: 'fileSize', label: t('groupOverlay.sort.fileSize') },
    { value: 'dateCreated', label: t('groupOverlay.sort.dateCreated') },
  ], [t]);

  const translatedGroupOptions = useMemo(() => [
    { value: 'none', label: t('dropdown.noGrouping') },
    { value: 'mixed', label: t('dropdown.colorGrouping') },
  ], [t]);

  const translatedQualityOptions = useMemo(() => [
    { value: 'low', label: t('quality.low') },
    { value: 'normal', label: t('quality.normal') },
    { value: 'original', label: t('quality.original') },
  ], [t]);

  const groupScope = `group_${group.id}`;
  const activeConfig = useGroupConfig(groupScope);
  const { removeManualGroupIds, setManualGroupIds } = activeConfig;

  const fetchIllustrations = useCallback(async () => {
    try {
      const data = await listAllIllustrations(group.id);
      setIllustrations(data.items);
      setTotalCount(data.total);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [group.id]);

  useEffect(() => {
    setLoading(true);
    setCurrentPage(1);
    fetchIllustrations();
  }, [fetchIllustrations]);

  // Fetch settings to know whether auto-tag is enabled and how to handle filename conflicts
  useEffect(() => {
    getSettings()
      .then(data => {
        setAutoTagEnabled(data.auto_tag ?? true);
        if (data.upload_conflict_policy === 'save_all' || data.upload_conflict_policy === 'skip' || data.upload_conflict_policy === 'overwrite') {
          setConflictPolicy(data.upload_conflict_policy);
        }
      })
      .catch(() => { /* keep default */ });
  }, []);

  const handlePageSizeChange = (size) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  const sortedIllustrations = useMemo(() => {
    if (!sortBy) return illustrations;
    const sorted = [...illustrations].sort((a, b) => {
      let valA, valB;
      switch (sortBy) {
        case 'resolution':
          valA = (a.width || 0) * (a.height || 0);
          valB = (b.width || 0) * (b.height || 0);
          break;
        case 'fileSize':
          valA = a.file_size || 0;
          valB = b.file_size || 0;
          break;
        case 'dateCreated':
          valA = a.created_at || '';
          valB = b.created_at || '';
          break;
        default:
          return 0;
      }
      if (sortOrder === 'asc') return valA > valB ? 1 : valA < valB ? -1 : 0;
      return valA < valB ? 1 : valA > valB ? -1 : 0;
    });
    return sorted;
  }, [illustrations, sortBy, sortOrder]);

  // ── Client-side filter (tags + prompts) ──────────────

  const filteredIllustrations = useMemo(
    () => filterIllustrations(sortedIllustrations, filterQuery, filterScope),
    [filterQuery, filterScope, sortedIllustrations],
  );

  // ── Grouping ───────────────────────────────────────────

  const groupedIllustrations = useMemo(() => {
    if (groupBy === 'none' || activeConfig.pairs.length === 0) return null;
    return groupIllustrations(
      filteredIllustrations,
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
    filteredIllustrations,
    groupBy,
  ]);

  const groupedIllustrationIds = useMemo(
    () => groupedIllustrations?.map((item) => item.id) || [],
    [groupedIllustrations],
  );
  const collapsedGroupCount = groupedIllustrationIds.reduce(
    (count, id) => count + (collapsedGroups.has(id) ? 1 : 0),
    0,
  );
  const allGroupsCollapsed = groupedIllustrationIds.length > 0
    && collapsedGroupCount === groupedIllustrationIds.length;

  const toggleAllGroups = useCallback(() => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (allGroupsCollapsed) {
        groupedIllustrationIds.forEach((id) => next.delete(id));
      } else {
        groupedIllustrationIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [allGroupsCollapsed, groupedIllustrationIds]);

  const paginationTotal = filteredIllustrations.length;
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(paginationTotal / pageSize));

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const paginatedGroupedIllustrations = useMemo(() => {
    if (!groupedIllustrations) return null;
    return paginateIllustrationGroups(groupedIllustrations, currentPage, pageSize);
  }, [groupedIllustrations, currentPage, pageSize]);

  const paginatedIllustrations = useMemo(() => {
    if (groupedIllustrations || pageSize === 'all') return filteredIllustrations;
    const start = (currentPage - 1) * pageSize;
    return filteredIllustrations.slice(start, start + pageSize);
  }, [groupedIllustrations, filteredIllustrations, currentPage, pageSize]);

  // Flat list matching visual order (for index lookups in Shift+Click / Lightbox)
  const displayedIllustrations = useMemo(() => {
    return flattenVisibleGroups(paginatedGroupedIllustrations, collapsedGroups)
      || paginatedIllustrations;
  }, [paginatedGroupedIllustrations, collapsedGroups, paginatedIllustrations]);

  const {
    selectedIds,
    clearSelection,
    removeFromSelection,
    handleCardClick,
    handleCtrlClick,
    handleShiftClick,
  } = useIllustrationSelection(displayedIllustrations, setLightboxIndex);

  useEffect(() => {
    clearSelection();
  }, [clearSelection, group.id]);

  const toggleGroupCollapse = useCallback((groupId) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  // ── Handlers ───────────────────────────────────────────

  // ── Upload helpers ──────────────────────────────────────

  const doUpload = useCallback(async (files, skipAutoTag) => {
    setUploading(true);
    setError('');
    clearSelection();
    const total = files.length;
    const summary = { added: [], skipped: [], overwritten: [], failed: [] };
    for (let i = 0; i < total; i++) {
      const file = files[i];
      setUploadProgress({ current: i + 1, total, filename: file.name, stage: 'uploading' });
      try {
        const result = await uploadSingleIllustration(group.id, file, skipAutoTag, conflictPolicy);
        if (result) {
          if (result.added) summary.added.push(...result.added);
          if (result.skipped) summary.skipped.push(...result.skipped);
          if (result.overwritten) summary.overwritten.push(...result.overwritten);
          if (result.failed) summary.failed.push(...result.failed);
        }
      } catch (err) {
        summary.failed.push({ filename: file.name, error: err.message || t('groupOverlay.upload.failed') });
      }
    }
    setUploadProgress(null);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';

    const touched = summary.added.length + summary.overwritten.length;
    if (touched > 0) {
      await fetchIllustrations();
      if (onGroupUpdated) onGroupUpdated();
    }

    // Only show the summary modal if there's something noteworthy beyond a
    // straightforward "all added" result.
    if (summary.skipped.length || summary.overwritten.length || summary.failed.length) {
      setUploadSummary(summary);
    } else if (summary.added.length) {
      addToast(t('groupOverlay.toast.uploadAdded', { n: summary.added.length }), 'success');
    }
  }, [addToast, clearSelection, conflictPolicy, fetchIllustrations, group.id, onGroupUpdated, t]);

  const handleUploadFiles = useCallback(async (files) => {
    if (uploading || pendingFiles || files.length === 0) return;
    setUploading(true);

    // If auto-tag is disabled in Settings, skip model check and upload directly
    if (!autoTagEnabled) {
      await doUpload(files, true);
      return;
    }

    // Check if the tagger model is cached (needed for auto-tag)
    try {
      const status = await checkModelStatus();
      if (!status.cached) {
        // Model not cached — store files and show download modal
        setUploading(false);
        setPendingFiles(files);
        setShowModelModal(true);
        return;
      }
    } catch {
      // If status check fails, proceed anyway (backend will handle)
    }

    // Model is cached — proceed directly
    await doUpload(files, false);
  }, [autoTagEnabled, doUpload, pendingFiles, uploading]);

  const handleUpload = useCallback((event) => {
    const files = Array.from(event.target.files || []);
    handleUploadFiles(files);
  }, [handleUploadFiles]);

  const handleRejectedUploadFiles = useCallback((files) => {
    addToast(t('groupOverlay.upload.rejected', { count: files.length }), 'error');
  }, [addToast, t]);

  const { isDraggingFiles, dropTargetProps } = useIllustrationFileDrop({
    onFiles: handleUploadFiles,
    onRejected: handleRejectedUploadFiles,
    disabled: uploading || showModelModal,
  });

  const handleModelDownload = async () => {
    if (!pendingFiles) return;
    const files = pendingFiles;
    await downloadModel();
    setShowModelModal(false);
    setPendingFiles(null);
    await doUpload(files, false);
  };

  const handleModelSkip = () => {
    setShowModelModal(false);
    if (!pendingFiles) return;
    const files = pendingFiles;
    setPendingFiles(null);
    // Upload without auto-tagging
    doUpload(files, true);
  };

  const handleModelClose = () => {
    setShowModelModal(false);
    setPendingFiles(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSetCoverConfirm = async () => {
    if (!coverTarget) return;
    try {
      await updateGroup(group.id, { cover_illustration_id: coverTarget.id });
      setCoverTarget(null);
      addToast(t('groupOverlay.toast.coverUpdated'), 'success');
      if (onGroupUpdated) onGroupUpdated();
    } catch (err) {
      addToast(err.message || t('groupOverlay.toast.coverFailed'), 'error');
      setCoverTarget(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const result = await handleDeleteIllustrations([deleteTarget.id], true);
    if (result.deleted.length > 0) {
      setDeleteTarget(null);
    }
  };

  const handleDeleteIllustrations = useCallback(async (ids, single = false) => {
    const result = await deleteIllustrations(ids);
    const deletedSet = new Set(result.deleted);

    if (deletedSet.size > 0) {
      setIllustrations((previous) => previous.filter((item) => !deletedSet.has(item.id)));
      setTotalCount((previous) => Math.max(0, previous - deletedSet.size));
      removeFromSelection(result.deleted);
      removeManualGroupIds(result.deleted);
      await removeManualAssignmentsForIllustrations(result.deleted).catch(() => {});
      if (onGroupUpdated) onGroupUpdated();
    }

    if (result.failed.length === 0) {
      addToast(
        single
          ? t('groupOverlay.toast.deleted')
          : t('groupOverlay.toast.batchDeleted', { n: result.deleted.length }),
        'success',
      );
    } else {
      addToast(
        single
          ? t('groupOverlay.toast.deleteFailed')
          : t('groupOverlay.toast.batchPartial', {
            succeeded: result.deleted.length,
            failed: result.failed.length,
          }),
        'error',
      );
    }
    return result;
  }, [addToast, onGroupUpdated, removeFromSelection, removeManualGroupIds, t]);

  const handleBatchDelete = async () => {
    setBatchDeleting(true);
    try {
      await handleDeleteIllustrations([...selectedIds]);
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
      // Confirm the tagger model is available before kicking off a long job.
      try {
        const status = await checkModelStatus();
        if (!status.cached) {
          addToast(t('groupOverlay.toast.retagNoModel'), 'error');
          setRetagging(false);
          return;
        }
      } catch { /* fall through; backend will report any failure per-item */ }

      const res = await retagIllustrations(ids);
      const updated = res?.updated || [];
      const failed = res?.failed || [];

      if (updated.length > 0) {
        const byId = new Map(updated.map(it => [it.id, it]));
        setIllustrations((prev) => prev.map((it) => byId.get(it.id) || it));
      }

      if (failed.length === 0) {
        addToast(t('groupOverlay.toast.retagDone', { n: updated.length }), 'success');
      } else if (updated.length === 0) {
        addToast(t('groupOverlay.toast.retagFailed', { n: failed.length }), 'error');
      } else {
        addToast(
          t('groupOverlay.toast.retagPartial', { succeeded: updated.length, failed: failed.length }),
          'error'
        );
      }
    } catch (err) {
      addToast(err.message || t('groupOverlay.toast.retagFailed', { n: ids.length }), 'error');
    } finally {
      setRetagging(false);
    }
  };

  const handleDownloadIllustrations = useCallback(async (selected) => {
    if (selected.length === 0) return { downloaded: [], failed: [] };
    addToast(t('groupOverlay.toast.downloading', { n: selected.length }), 'success');
    const result = await downloadIllustrations(selected, format);
    if (result.failed.length > 0) {
      addToast(t('colorBoard.toast.downloadPartial', {
        succeeded: result.downloaded.length,
        failed: result.failed.length,
      }), 'error');
    }
    return result;
  }, [addToast, format, t]);

  const handleBatchDownload = () => handleDownloadIllustrations(
    illustrations.filter((illustration) => selectedIds.has(illustration.id)),
  );

  const handleUpdateIllustrationTags = useCallback(async (ids, operation, tags) => {
    try {
      const result = await updateIllustrationTags(ids, operation, tags);
      const updatedById = new Map((result.updated || []).map((item) => [item.id, item]));
      setIllustrations((previous) => previous.map((item) => updatedById.get(item.id) || item));
      addToast(t(
        operation === 'add' ? 'colorBoard.toast.tagsAdded' : 'colorBoard.toast.tagsRemoved',
        { count: result.updated?.length || 0, tags: tags.join(', ') },
      ), 'success');
      if (result.missing?.length > 0) {
        addToast(t('colorBoard.toast.tagsPartial', { failed: result.missing.length }), 'error');
      }
      return result;
    } catch (error) {
      addToast(error.message || t('colorBoard.toast.tagsFailed'), 'error');
      throw error;
    }
  }, [addToast, t]);

  const handleLightboxDelete = async (ill) => {
    await handleDeleteIllustrations([ill.id], true);
  };

  const handleLightboxSetCover = async (ill) => {
    try {
      await updateGroup(group.id, { cover_illustration_id: ill.id });
      addToast(t('groupOverlay.toast.coverUpdated'), 'success');
      if (onGroupUpdated) onGroupUpdated();
    } catch (err) {
      addToast(err.message || t('groupOverlay.toast.coverFailed'), 'error');
    }
  };

  const cardProps = useCallback((ill) => ({
    illustration: ill,
    onClick: handleCardClick,
    onCtrlClick: handleCtrlClick,
    onShiftClick: handleShiftClick,
    onSetCover: setCoverTarget,
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
    <div className="contents" {...dropTargetProps}>
      <AnimatePresence>
        {isDraggingFiles && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-3 z-[120] grid place-items-center rounded-3xl border-2 border-dashed border-accent bg-accent/10 shadow-[inset_0_0_80px_rgb(var(--clr-accent)/0.12)] backdrop-blur-sm sm:inset-6"
            role="status"
            aria-live="polite"
          >
            <motion.div
              initial={{ y: 8, scale: 0.96 }}
              animate={{ y: 0, scale: 1 }}
              className="mx-5 max-w-md rounded-3xl border border-accent/35 bg-surface-secondary/95 px-8 py-7 text-center shadow-2xl shadow-accent/20"
            >
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent">
                <ImagePlus className="h-7 w-7" />
              </span>
              <p className="mt-4 text-base font-semibold text-content-primary">
                {t('groupOverlay.upload.dropTitle')}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-content-muted">
                {t('groupOverlay.upload.dropBody')}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {!showColorBoard && (
        <div className="fixed inset-0 z-50 flex flex-col bg-surface-primary">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-edge-primary px-4 py-3.5 shrink-0 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-surface-tertiary text-content-tertiary hover:text-content-secondary transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="max-w-[14rem] truncate whitespace-nowrap text-lg font-semibold text-content-primary" title={group.name}>{group.name}</h2>
            <span className="hidden shrink-0 whitespace-nowrap text-sm text-content-muted 2xl:inline">
              {filterQuery.trim()
                ? t('groupOverlay.filteredCount', { filteredCount: filteredIllustrations.length, total: illustrations.length })
                : t('groupOverlay.totalCount', { total: totalCount })}
            </span>
            {filterQuery.trim() && filterScope !== 'all' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent font-medium uppercase">
                {filterScope}
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowColorBoard(true)}
              className="group/board inline-flex items-center gap-2 rounded-xl border border-accent/25 bg-accent/10 px-3 py-2 text-xs font-medium text-accent shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/45 hover:bg-accent/15 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-accent/35"
              title={t('groupOverlay.board.openHint')}
              aria-label={t('groupOverlay.board.openHint')}
            >
              <span className="grid h-5 w-5 place-items-center rounded-lg bg-accent/15 transition-transform group-hover/board:rotate-6">
                <Palette className="h-3 w-3" />
              </span>
              <span className="hidden xl:inline">{t('groupOverlay.board.open')}</span>
              <span className="rounded-full bg-surface-secondary/80 px-1.5 py-0.5 text-[9px] tabular-nums text-content-muted">
                {activeConfig.pairs.length}
              </span>
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            {/* In-page search */}
            <TagPromptSuggest
              type="mixed"
              value={filterQuery}
              onChange={(v) => { setFilterQuery(v); if (!v) setFilterScope('all'); }}
              onSelect={(v, scope) => { setFilterQuery(v); setFilterScope(scope); }}
              onEnter={(v) => { setFilterQuery(v); setFilterScope('all'); }}
              placeholder={t('groupOverlay.filter.placeholder')}
              className="w-52"
              inputClassName="w-full pl-3 pr-3 py-2 rounded-lg bg-surface-tertiary border border-edge-secondary text-sm text-content-primary placeholder-content-muted focus:outline-none focus:border-accent/50 transition-colors"
            />

            {/* Sort controls */}
            {illustrations.length > 1 && (
              <SettingsSelect
                variant="toolbar"
                icon={ArrowUpDown}
                label={t('groupOverlay.sort.label')}
                options={SORT_OPTIONS}
                value={sortBy}
                onChange={setSortBy}
                rightElement={
                  sortBy ? (
                    <button
                      onClick={() => setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
                      className="p-2 rounded-lg bg-surface-tertiary border border-edge-secondary hover:border-edge-primary text-content-tertiary hover:text-content-primary transition-all"
                      title={sortOrder === 'asc' ? t('groupOverlay.sort.asc') : t('groupOverlay.sort.desc')}
                    >
                      <span className="text-xs font-medium">
                        {sortOrder === 'asc' ? t('groupOverlay.sort.ascShort') : t('groupOverlay.sort.descShort')}
                      </span>
                    </button>
                  ) : null
                }
              />
            )}

            {/* Group By controls */}
            {illustrations.length > 1 && (
              <SettingsSelect
                variant="toolbar"
                icon={Layers}
                label={t('groupOverlay.group.label')}
                options={translatedGroupOptions}
                value={groupBy}
                onChange={(v) => { setGroupBy(v); setCollapsedGroups(new Set()); }}
                rightElement={
                  groupBy !== 'none' ? (
                    <button
                      onClick={() => setShowGroupConfig(true)}
                      className="p-2 rounded-lg bg-surface-tertiary border border-edge-secondary hover:border-edge-primary text-content-tertiary hover:text-content-primary transition-all"
                      title={t('groupOverlay.group.configMixed')}
                    >
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                  ) : null
                }
              />
            )}

            {/* Quality selector */}
            <SettingsSelect
              variant="toolbar"
              icon={Monitor}
              label={t('groupOverlay.quality.label')}
              options={translatedQualityOptions}
              value={quality}
              onChange={setQuality}
            />

            {/* Card size slider */}
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface-tertiary border border-edge-secondary">
              <span className="text-xs text-content-muted whitespace-nowrap">{t('groupOverlay.cardSize.label')}</span>
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
              <span className="h-4 w-px bg-edge-primary" />
              <button
                type="button"
                onClick={() => setPreserveAspectRatio(!preserveAspectRatio)}
                aria-pressed={preserveAspectRatio}
                aria-label={t('groupOverlay.originalRatio.hint')}
                title={t('groupOverlay.originalRatio.hint')}
                className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent/30 ${
                  preserveAspectRatio
                    ? 'bg-accent/15 text-accent'
                    : 'text-content-muted hover:bg-surface-secondary hover:text-content-primary'
                }`}
              >
                <Ratio className="h-3.5 w-3.5" />
                <span className="hidden whitespace-nowrap xl:inline">{t('groupOverlay.originalRatio.label')}</span>
              </button>
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-5 py-2 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 text-sm font-medium text-white shadow-lg shadow-accent/20 hover:shadow-accent/30 transition-all hover:scale-[1.03] inline-flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              {uploading ? t('groupOverlay.upload.uploading') : t('groupOverlay.upload.button')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={handleUpload}
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-danger/30 border border-danger text-danger text-sm">
              {error}
              <button onClick={() => setError('')} className="ml-2 underline hover:opacity-80">{t('home.dismiss')}</button>
            </div>
          )}

          {/* Upload progress bar */}
          {uploadProgress && (
            <div className="mb-4 p-4 rounded-xl bg-surface-secondary border border-edge-primary">
              {uploadProgress.stage === 'downloading' ? (
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-accent shrink-0" />
                  <span className="text-sm font-medium text-content-primary">
                    {t('groupOverlay.upload.downloadingModel')}
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-surface-tertiary overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-accent"
                      animate={{ width: ['0%', '90%'] }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-content-primary flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                      {t('groupOverlay.upload.progress', { current: uploadProgress.current, total: uploadProgress.total })}
                    </span>
                    <span className="text-xs text-content-muted truncate ml-4 max-w-[300px]">
                      {uploadProgress.filename}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-surface-tertiary overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-accent"
                      initial={{ width: 0 }}
                      animate={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Pagination — top */}
          {!loading && paginationTotal > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 px-1">
              <div className="flex items-center gap-2 text-sm text-content-secondary">
                <span>{t('groupOverlay.pagination.page')}</span>
                <span className="font-medium text-content-primary">{currentPage}</span>
                <span>{t('groupOverlay.pagination.of')}</span>
                <span className="font-medium text-content-primary">{totalPages}</span>
                <span className="text-content-muted ml-1">({t('groupOverlay.pagination.total', { total: paginationTotal })})</span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {groupedIllustrationIds.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleAllGroups}
                    className={`group inline-flex items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-1.5 text-xs font-medium shadow-sm transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                      allGroupsCollapsed
                        ? 'border-accent/35 bg-accent/10 text-accent hover:bg-accent/15'
                        : 'border-edge-secondary bg-surface-tertiary text-content-secondary hover:border-accent/30 hover:text-content-primary'
                    }`}
                    title={allGroupsCollapsed
                      ? t('groupOverlay.group.expandAllHint')
                      : t('groupOverlay.group.collapseAllHint')}
                    aria-label={allGroupsCollapsed
                      ? t('groupOverlay.group.expandAllHint')
                      : t('groupOverlay.group.collapseAllHint')}
                    aria-pressed={allGroupsCollapsed}
                  >
                    <span className={`grid h-5 w-5 place-items-center rounded-md transition-colors ${
                      allGroupsCollapsed ? 'bg-accent/15' : 'bg-surface-primary'
                    }`}>
                      <Layers className="h-3.5 w-3.5" />
                    </span>
                    <span>
                      {allGroupsCollapsed
                        ? t('groupOverlay.group.expandAll')
                        : t('groupOverlay.group.collapseAll')}
                    </span>
                    <span
                      className="rounded-full bg-surface-primary/80 px-1.5 py-0.5 text-[10px] tabular-nums text-content-muted"
                      aria-hidden="true"
                    >
                      {collapsedGroupCount}/{groupedIllustrationIds.length}
                    </span>
                  </button>
                )}
                {groupedIllustrationIds.length > 0 && (
                  <span className="mx-0.5 h-5 w-px bg-edge-primary" aria-hidden="true" />
                )}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className="p-1.5 rounded-lg hover:bg-surface-tertiary text-content-tertiary hover:text-content-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    className="p-1.5 rounded-lg hover:bg-surface-tertiary text-content-tertiary hover:text-content-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <span className="text-xs text-content-muted mx-1">{t('groupOverlay.pagination.pageSize')}</span>
                <div className="flex items-center gap-0.5">
                  {PAGE_SIZE_OPTIONS.map(opt => (
                    <button
                      key={String(opt.value)}
                      onClick={() => handlePageSizeChange(opt.value)}
                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                        pageSize === opt.value
                          ? 'bg-accent text-white'
                          : 'text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-64 text-content-muted text-sm">{t('groupOverlay.loading')}</div>
          ) : illustrations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-content-muted">
              <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
              <p className="text-sm">{t('groupOverlay.empty')}</p>
            </div>
          ) : paginatedGroupedIllustrations ? (
            /* Grouped rendering */
            <div>
              {paginatedGroupedIllustrations.map((group) => (
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
            /* Flat grid (no grouping) */
            <div className={`grid items-start ${cardSizeGrid} gap-4`}>
              <AnimatePresence mode="popLayout">
                {paginatedIllustrations.map((ill) => (
                  <IllustrationCard key={ill.id} {...cardProps(ill)} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>


        {/* Key hints */}
        {selectedIds.size === 0 && illustrations.length > 0 && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[55] px-4 py-2 rounded-lg bg-surface-secondary/85 backdrop-blur border border-edge-primary/60 shadow-lg text-xs text-content-secondary flex items-center gap-3 select-none">
            <span><kbd className="px-1 py-0.5 rounded bg-edge-subtle/10 text-content-tertiary text-[10px] font-mono">Click</kbd> {t('groupOverlay.keyHints.click')}</span>
            <span className="text-content-muted/50">|</span>
            <span><kbd className="px-1 py-0.5 rounded bg-edge-subtle/10 text-content-tertiary text-[10px] font-mono">Ctrl+Click</kbd> {t('groupOverlay.keyHints.ctrlClick')}</span>
            <span className="text-content-muted/50">|</span>
            <span><kbd className="px-1 py-0.5 rounded bg-edge-subtle/10 text-content-tertiary text-[10px] font-mono">Shift+Click</kbd> {t('groupOverlay.keyHints.shiftClick')}</span>
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
            <span className="text-sm text-content-secondary">{t('groupOverlay.batch.selected', { count: selectedIds.size })}</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setRetagConfirm(true)}
                disabled={retagging}
                className="px-4 py-2 rounded-xl bg-surface-tertiary hover:bg-edge-secondary disabled:opacity-50 text-sm text-content-secondary hover:text-content-primary transition-all flex items-center gap-2 font-medium border border-transparent hover:border-edge-primary"
              >
                {retagging
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Tag className="w-4 h-4" />}
                {retagging ? t('groupOverlay.batch.retagging') : t('groupOverlay.batch.retag')}
              </button>
              <button
                onClick={handleBatchDownload}
                className="px-4 py-2 rounded-xl bg-surface-tertiary hover:bg-edge-secondary text-sm text-content-secondary hover:text-content-primary transition-all flex items-center gap-2 font-medium border border-transparent hover:border-edge-primary"
              >
                <Download className="w-4 h-4" />
                {t('groupOverlay.batch.download')}
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={batchDeleting}
                className="px-4 py-2 rounded-xl bg-danger hover:bg-danger-hover disabled:opacity-50 text-sm text-white shadow-lg shadow-danger/20 hover:shadow-danger/30 transition-all hover:scale-[1.02] flex items-center gap-2 font-medium"
              >
                <Trash2 className="w-4 h-4" />
                {batchDeleting ? t('groupOverlay.batch.deleting') : t('groupOverlay.batch.delete')}
              </button>
              <button
                onClick={clearSelection}
                className="px-3 py-2 rounded-lg text-sm text-content-muted hover:text-content-secondary transition-colors flex items-center gap-1.5"
              >
                <X className="w-4 h-4" />
                {t('groupOverlay.batch.clear')}
              </button>
            </div>
          </motion.div>
        )}
        </div>
      )}

      {/* Group Config Modal */}
      <AnimatePresence>
        {showGroupConfig && (
          <GroupConfigModal
            config={activeConfig}
            onClose={() => setShowGroupConfig(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showColorBoard && (
          <ColorGroupBoard
            groupName={group.name}
            illustrations={illustrations}
            pairs={activeConfig.pairs}
            matchOrder={activeConfig.matchOrder}
            manualAssignments={activeConfig.manualAssignments}
            onAssign={setManualGroupIds}
            onDownload={handleDownloadIllustrations}
            onDelete={handleDeleteIllustrations}
            onUpdateTags={handleUpdateIllustrationTags}
            onConfigure={() => setShowGroupConfig(true)}
            onClose={() => setShowColorBoard(false)}
            uploading={uploading}
            uploadProgress={uploadProgress}
          />
        )}
      </AnimatePresence>

      {/* Model download modal */}
      {showModelModal && (
        <ModelDownloadModal
          onDownload={handleModelDownload}
          onSkip={handleModelSkip}
          onClose={handleModelClose}
        />
      )}

      {/* Confirm: set as cover */}
      {coverTarget && (
        <ConfirmModal
          title={t('groupOverlay.setCover.title')}
          message={t('groupOverlay.setCover.message', { filename: coverTarget.original_filename, groupName: group.name })}
          confirmText={t('groupOverlay.setCover.confirm')}
          cancelText={t('groupOverlay.setCover.cancel')}
          onConfirm={handleSetCoverConfirm}
          onCancel={() => setCoverTarget(null)}
        />
      )}

      {/* Confirm: delete illustration */}
      {deleteTarget && (
        <ConfirmModal
          title={t('groupOverlay.deleteIllustration.title')}
          message={t('groupOverlay.deleteIllustration.message', { filename: deleteTarget.original_filename })}
          confirmText={t('groupOverlay.deleteIllustration.confirm')}
          cancelText={t('groupOverlay.deleteIllustration.cancel')}
          danger
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Confirm: re-tag selected illustrations */}
      {retagConfirm && (
        <ConfirmModal
          title={t('groupOverlay.retag.title')}
          message={t('groupOverlay.retag.message', { count: selectedIds.size })}
          confirmText={t('groupOverlay.retag.confirm')}
          cancelText={t('groupOverlay.retag.cancel')}
          onConfirm={handleBatchRetag}
          onCancel={() => setRetagConfirm(false)}
        />
      )}

      {/* Upload summary modal */}
      {uploadSummary && (
        <UploadSummaryModal
          summary={uploadSummary}
          onClose={() => setUploadSummary(null)}
        />
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <Lightbox
          illustrations={displayedIllustrations}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onDelete={handleLightboxDelete}
          onSetCover={handleLightboxSetCover}
          onUpdate={(updated) => {
            setIllustrations((prev) =>
              prev.map((i) => (i.id === updated.id ? updated : i))
            );
          }}
        />
      )}
    </div>
  );
}
