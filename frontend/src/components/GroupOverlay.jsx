import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpDown, Layers, Settings, Upload, Download, Trash2, X, Monitor, Loader2, ChevronLeft, ChevronRight, Tag } from 'lucide-react';
import useQuality from '../hooks/useQuality';
import useCardSize, { CARD_SIZE_MIN, CARD_SIZE_MAX } from '../hooks/useCardSize';
import useDownloadConfig, { resolveFilename, sanitizeFilename } from '../hooks/useDownloadConfig';
import { listIllustrations, uploadSingleIllustration, updateGroup, deleteIllustration, checkModelStatus, downloadModel, getSettings, retagIllustrations } from '../api';
import { useToast } from './Toast';
import ConfirmModal from './ConfirmModal';
import Lightbox from './Lightbox';
import IllustrationCard from './IllustrationCard';
import ColorGroup from './ColorGroup';
import DropdownSelect from './DropdownSelect';
import TagPromptSuggest from './TagPromptSuggest';
import GroupConfigModal from './GroupConfigModal';
import ModelDownloadModal from './ModelDownloadModal';
import UploadSummaryModal from './UploadSummaryModal';
import useGroupConfig from '../hooks/useGroupConfig';
import { groupIllustrations } from '../utils/grouping';
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
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [lastClickedId, setLastClickedId] = useState(null);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [retagging, setRetagging] = useState(false);
  const [retagConfirm, setRetagConfirm] = useState(false);
  const [uploadSummary, setUploadSummary] = useState(null); // { added, skipped, overwritten, failed }
  const [conflictPolicy, setConflictPolicy] = useState('save_all');
  const [sortBy, setSortBy] = useState('');
  const [sortOrder, setSortOrder] = useState('desc');
  const [groupBy, setGroupBy] = useState(() => {
    try {
      const v = localStorage.getItem('gallery-group-by');
      return (v === 'combined' || v === 'tag' || v === 'prompt') ? 'combined' : 'none';
    } catch { return 'none'; }
  });
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [showGroupConfig, setShowGroupConfig] = useState(false);
  const fileInputRef = useRef(null);
  const { addToast } = useToast();
  const [quality, setQuality] = useQuality();
  const [cardSize, setCardSize, cardSizeGrid] = useCardSize();
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

  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(totalCount / pageSize));

  const SORT_OPTIONS = useMemo(() => [
    { value: '', label: t('groupOverlay.sort.default') },
    { value: 'resolution', label: t('groupOverlay.sort.resolution') },
    { value: 'fileSize', label: t('groupOverlay.sort.fileSize') },
    { value: 'dateCreated', label: t('groupOverlay.sort.dateCreated') },
  ], [t]);

  const translatedGroupOptions = useMemo(() => [
    { value: 'none', label: t('dropdown.noGrouping') },
    { value: 'combined', label: t('dropdown.grouping') },
  ], [t]);

  const translatedQualityOptions = useMemo(() => [
    { value: 'low', label: t('quality.low') },
    { value: 'normal', label: t('quality.normal') },
    { value: 'original', label: t('quality.original') },
  ], [t]);

  const groupScope = `group_${group.id}`;
  const activeConfig = useGroupConfig('combined', groupScope);

  const fetchPage = useCallback(async (page, size) => {
    const limit = size === 'all' ? 100000 : size;
    const offset = size === 'all' ? 0 : (page - 1) * size;
    try {
      const data = await listIllustrations(group.id, offset, limit);
      setIllustrations(data.items);
      setTotalCount(data.total);
      // If current page is empty and not page 1, go back one page
      if (data.items.length === 0 && page > 1 && size !== 'all') {
        setCurrentPage(page - 1);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [group.id]);

  useEffect(() => {
    setLoading(true);
    setSelectedIds(new Set());
    setLastClickedId(null);
    fetchPage(currentPage, pageSize);
  }, [currentPage, pageSize, fetchPage]);

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

  const filteredIllustrations = useMemo(() => {
    if (!filterQuery.trim()) return sortedIllustrations;
    const q = filterQuery.trim().toLowerCase();
    return sortedIllustrations.filter((ill) => {
      const tags = (ill.tags || '').toLowerCase();
      const ext = ill.extended_data || {};
      const pos = (ext['Positive Prompt'] || '').toLowerCase();
      const neg = (ext['Negative Prompt'] || '').toLowerCase();
      switch (filterScope) {
        case 'tag':
          return tags.includes(q);
        case 'prompt':
          return pos.includes(q) || neg.includes(q);
        default:
          return tags.includes(q) || pos.includes(q) || neg.includes(q);
      }
    });
  }, [sortedIllustrations, filterQuery, filterScope]);

  // ── Grouping ───────────────────────────────────────────

  const groupedIllustrations = useMemo(() => {
    if (groupBy === 'none' || activeConfig.pairs.length === 0) return null;
    return groupIllustrations(
      filteredIllustrations,
      activeConfig.pairs,
      activeConfig.priorityOrder,
      activeConfig.otherColor
    );
  }, [groupBy, filteredIllustrations, activeConfig]);

  // Flat list matching visual order (for index lookups in Shift+Click / Lightbox)
  const displayedIllustrations = useMemo(() => {
    if (groupedIllustrations) {
      const flat = [];
      for (const g of groupedIllustrations) {
        if (!collapsedGroups.has(g.id)) {
          flat.push(...g.items);
        }
      }
      return flat;
    }
    return filteredIllustrations;
  }, [groupedIllustrations, collapsedGroups, filteredIllustrations]);

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
    setSelectedIds(new Set());
    setLastClickedId(null);
    const total = files.length;
    const summary = { added: [], skipped: [], overwritten: [], failed: [] };
    for (let i = 0; i < total; i++) {
      const file = files[i];
      setUploadProgress({ current: i + 1, total, filename: file.name, stage: 'uploading' });
      try {
        const result = await uploadSingleIllustration(group.id, file, skipAutoTag, conflictPolicy);
        // Backend returns { added, skipped, overwritten, failed }. Be defensive
        // in case an older backend ever returns the legacy array shape.
        if (Array.isArray(result)) {
          summary.added.push(...result);
        } else if (result) {
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
      await fetchPage(currentPage, pageSize);
      if (onGroupUpdated) onGroupUpdated();
    }

    // Only show the summary modal if there's something noteworthy beyond a
    // straightforward "all added" result.
    if (summary.skipped.length || summary.overwritten.length || summary.failed.length) {
      setUploadSummary(summary);
    } else if (summary.added.length) {
      addToast(t('groupOverlay.toast.uploadAdded', { n: summary.added.length }), 'success');
    }
  }, [group.id, currentPage, pageSize, fetchPage, onGroupUpdated, t, conflictPolicy, addToast]);

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

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
        setPendingFiles(files);
        setShowModelModal(true);
        return;
      }
    } catch {
      // If status check fails, proceed anyway (backend will handle)
    }

    // Model is cached — proceed directly
    await doUpload(files, false);
  };

  const handleModelDownload = async () => {
    setShowModelModal(false);
    if (!pendingFiles) return;
    const files = pendingFiles;
    setPendingFiles(null);
    setUploading(true);
    setUploadProgress({ current: 0, total: files.length, filename: '', stage: 'downloading' });
    try {
      await downloadModel();
    } catch (err) {
      setError(err.message || t('modelDownload.error.downloadFailed'));
      setUploading(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    // Model downloaded, now upload with auto-tag
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
    try {
      await deleteIllustration(deleteTarget.id);
      setDeleteTarget(null);
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(deleteTarget.id); return next; });
      addToast(t('groupOverlay.toast.deleted'), 'success');
      await fetchPage(currentPage, pageSize);
      if (onGroupUpdated) onGroupUpdated();
    } catch (err) {
      addToast(err.message || t('groupOverlay.toast.deleteFailed'), 'error');
    }
  };

  const handleBatchDelete = async () => {
    setBatchDeleting(true);
    const ids = [...selectedIds];
    let failed = 0;
    for (const id of ids) {
      try {
        await deleteIllustration(id);
      } catch {
        failed++;
      }
    }
    setBatchDeleting(false);
    setSelectedIds(new Set());
    setLastClickedId(null);
    if (failed === 0) {
      addToast(t('groupOverlay.toast.batchDeleted', { n: ids.length }), 'success');
    } else {
      addToast(t('groupOverlay.toast.batchPartial', { succeeded: ids.length - failed, failed }), 'error');
    }
    await fetchPage(currentPage, pageSize);
    if (onGroupUpdated) onGroupUpdated();
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

  const handleBatchDownload = async () => {
    const selected = illustrations.filter((i) => selectedIds.has(i.id));
    if (selected.length === 0) return;
    addToast(t('groupOverlay.toast.downloading', { n: selected.length }), 'success');
    for (const ill of selected) {
      try {
        const res = await fetch(ill.file_url);
        if (!res.ok) continue;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        try {
          a.download = resolveFilename(format, ill);
        } catch {
          a.download = ill.original_filename;
        }
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        // continue to next file on error
      }
    }
  };

  const handleCardClick = (ill) => {
    setSelectedIds(new Set());
    setLastClickedId(ill.id);
    const idx = displayedIllustrations.findIndex((i) => i.id === ill.id);
    if (idx !== -1) setLightboxIndex(idx);
  };

  const handleCtrlClick = (ill) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(ill.id)) next.delete(ill.id);
      else next.add(ill.id);
      return next;
    });
    setLastClickedId(ill.id);
  };

  const handleShiftClick = (ill) => {
    if (lastClickedId === null) {
      handleCtrlClick(ill);
      return;
    }
    const lastIdx = displayedIllustrations.findIndex((i) => i.id === lastClickedId);
    const currIdx = displayedIllustrations.findIndex((i) => i.id === ill.id);
    if (lastIdx === -1 || currIdx === -1) return;
    const [start, end] = lastIdx < currIdx ? [lastIdx, currIdx] : [currIdx, lastIdx];
    const rangeIds = displayedIllustrations.slice(start, end + 1).map((i) => i.id);
    setSelectedIds((prev) => new Set([...prev, ...rangeIds]));
    setLastClickedId(ill.id);
  };

  const handleLightboxDelete = async (ill) => {
    try {
      await deleteIllustration(ill.id);
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(ill.id); return next; });
      addToast(t('groupOverlay.toast.deleted'), 'success');
      await fetchPage(currentPage, pageSize);
      if (onGroupUpdated) onGroupUpdated();
    } catch (err) {
      addToast(err.message || t('groupOverlay.toast.deleteFailed'), 'error');
    }
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
    key: ill.id,
    illustration: ill,
    onClick: handleCardClick,
    onCtrlClick: handleCtrlClick,
    onShiftClick: handleShiftClick,
    onSetCover: setCoverTarget,
    onDelete: setDeleteTarget,
    isSelected: selectedIds.has(ill.id),
    showHoverActions: true,
    quality,
  }), [selectedIds, lastClickedId, displayedIllustrations, quality]);

  // ── Render ─────────────────────────────────────────────

  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col bg-surface-primary">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-edge-primary shrink-0">
          <div className="flex items-center gap-4">
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-surface-tertiary text-content-tertiary hover:text-content-secondary transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-lg font-semibold text-content-primary">{group.name}</h2>
            <span className="text-sm text-content-muted">
              {filterQuery.trim()
                ? t('groupOverlay.filteredCount', { filteredCount: filteredIllustrations.length, total: illustrations.length })
                : t('groupOverlay.totalCount', { total: totalCount })}
            </span>
            {filterQuery.trim() && filterScope !== 'all' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent font-medium uppercase">
                {filterScope}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
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
              <DropdownSelect
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
              <DropdownSelect
                icon={Layers}
                label={t('groupOverlay.group.label')}
                options={translatedGroupOptions}
                value={groupBy}
                onChange={(v) => { setGroupBy(v); try { localStorage.setItem('gallery-group-by', v); } catch {} setCollapsedGroups(new Set()); }}
                rightElement={
                  groupBy !== 'none' ? (
                    <button
                      onClick={() => setShowGroupConfig(true)}
                      className="p-2 rounded-lg bg-surface-tertiary border border-edge-secondary hover:border-edge-primary text-content-tertiary hover:text-content-primary transition-all"
                      title={t('groupOverlay.group.config')}
                    >
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                  ) : null
                }
              />
            )}

            {/* Quality selector */}
            <DropdownSelect
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
          {!loading && totalCount > 0 && (
            <div className="flex items-center justify-between mb-4 px-1">
              <div className="flex items-center gap-2 text-sm text-content-secondary">
                <span>{t('groupOverlay.pagination.page')}</span>
                <span className="font-medium text-content-primary">{currentPage}</span>
                <span>{t('groupOverlay.pagination.of')}</span>
                <span className="font-medium text-content-primary">{totalPages}</span>
                <span className="text-content-muted ml-1">({t('groupOverlay.pagination.total', { total: totalCount })})</span>
              </div>
              <div className="flex items-center gap-2">
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
                    <IllustrationCard {...cardProps(ill)} />
                  ))}
                </ColorGroup>
              ))}
            </div>
          ) : (
            /* Flat grid (no grouping) */
            <div className={`grid ${cardSizeGrid} gap-4`}>
              <AnimatePresence mode="popLayout">
                {filteredIllustrations.map((ill) => (
                  <IllustrationCard {...cardProps(ill)} />
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
                onClick={() => { setSelectedIds(new Set()); setLastClickedId(null); }}
                className="px-3 py-2 rounded-lg text-sm text-content-muted hover:text-content-secondary transition-colors flex items-center gap-1.5"
              >
                <X className="w-4 h-4" />
                {t('groupOverlay.batch.clear')}
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
    </>
  );
}
