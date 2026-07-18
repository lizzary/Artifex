import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Check, ChevronDown, Download, GripHorizontal, Image as ImageIcon, Loader2, Plus, Tag, Trash2, X,
} from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';
import { clamp, getAspectFitPreviewHeight } from '../utils/illustrationPreview';
import { buildSelectionTagSummary, parseTagInput } from '../utils/illustrationTags';
import ConfirmModal from './ConfirmModal';
import IllustrationPreviewImage from './IllustrationPreviewImage';
import TagPromptSuggest from './TagPromptSuggest';

const TAG_PANEL_DEFAULT_HEIGHT = 336;
const TAG_PANEL_HEIGHT_STEP = 24;
const TAG_PANEL_VIEWPORT_GAP = 92;
const DETAIL_PREVIEW_MEDIA_WIDTH = 220;
const DETAIL_PREVIEW_MEDIA_MIN_HEIGHT = 88;
const DETAIL_PREVIEW_MEDIA_MAX_HEIGHT = 320;
const DETAIL_PREVIEW_CHROME_HEIGHT = 56;

function getTagPanelHeightBounds() {
  if (typeof window === 'undefined') return { min: 300, max: 640 };
  const max = Math.max(220, window.innerHeight - TAG_PANEL_VIEWPORT_GAP);
  const preferredMin = window.innerWidth < 1024 ? 470 : 300;
  return { min: Math.min(preferredMin, max), max };
}

function IllustrationPreview({ illustration, anchorRect, quality }) {
  const width = 236;
  const mediaHeight = getAspectFitPreviewHeight(
    illustration,
    DETAIL_PREVIEW_MEDIA_WIDTH,
    DETAIL_PREVIEW_MEDIA_MIN_HEIGHT,
    DETAIL_PREVIEW_MEDIA_MAX_HEIGHT,
  );
  const height = mediaHeight + DETAIL_PREVIEW_CHROME_HEIGHT;
  const hasRoomOnRight = anchorRect.right + width + 28 <= window.innerWidth;
  const left = hasRoomOnRight
    ? anchorRect.right + 12
    : Math.max(12, anchorRect.left - width - 12);
  const top = clamp(anchorRect.top - 56, 12, window.innerHeight - height - 12);

  return createPortal(
    <div
      className="pointer-events-none fixed z-[110] w-[236px] overflow-hidden rounded-2xl border border-edge-primary bg-surface-secondary/95 p-2 shadow-2xl shadow-overlay/30 backdrop-blur-xl"
      style={{ left, top }}
    >
      <IllustrationPreviewImage
        illustration={illustration}
        quality={quality}
        height={mediaHeight}
      />
      <div className="flex items-center gap-2 px-1 pb-0.5 pt-2">
        <ImageIcon className="h-3.5 w-3.5 shrink-0 text-content-muted" />
        <p className="truncate text-[11px] font-medium text-content-primary">
          {illustration.original_filename}
        </p>
      </div>
    </div>,
    document.body,
  );
}

function TagHolderRow({
  illustration,
  colorGroupName,
  quality,
  busy,
  onRemove,
}) {
  const { t } = useLocale();
  const rowRef = useRef(null);
  const [previewRect, setPreviewRect] = useState(null);

  const showPreview = () => {
    if (rowRef.current) setPreviewRect(rowRef.current.getBoundingClientRect());
  };

  return (
    <div
      ref={rowRef}
      role="listitem"
      className="group/holder relative flex items-center gap-2 rounded-xl px-2 py-2 transition-colors hover:bg-surface-tertiary"
      onMouseEnter={showPreview}
      onMouseLeave={() => setPreviewRect(null)}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-content-muted" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-content-secondary">
          {illustration.original_filename}
        </p>
        <p className="mt-0.5 truncate text-[9px] text-content-muted">{colorGroupName}</p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          setPreviewRect(null);
          onRemove(illustration.id);
        }}
        className="shrink-0 rounded-lg px-2 py-1 text-[9px] font-medium text-content-muted opacity-0 transition-all hover:bg-danger/10 hover:text-danger focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-danger/25 group-hover/holder:opacity-100 disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : t('colorBoard.tags.removeFromIllustration')}
      </button>
      {previewRect && (
        <IllustrationPreview illustration={illustration} anchorRect={previewRect} quality={quality} />
      )}
    </div>
  );
}

function PartialTagChip({
  entry,
  total,
  quality,
  pendingKey,
  resolveColorGroupName,
  onRemove,
}) {
  const { t } = useLocale();
  const anchorRef = useRef(null);
  const closeTimerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState({ left: 12, bottom: 80, width: 420 });

  const updatePosition = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(430, window.innerWidth - 24);
    setPosition({
      width,
      left: clamp(rect.left, 12, window.innerWidth - width - 12),
      bottom: window.innerHeight - rect.top + 10,
    });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);

  const keepOpen = () => {
    window.clearTimeout(closeTimerRef.current);
    updatePosition();
    setOpen(true);
  };
  const scheduleClose = () => {
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 160);
  };
  const visibleIllustrations = expanded ? entry.illustrations : entry.illustrations.slice(0, 7);
  const removingAll = pendingKey === `remove:${entry.tag}:all`;

  return (
    <span
      ref={anchorRef}
      className="relative inline-flex"
      onMouseEnter={keepOpen}
      onMouseLeave={scheduleClose}
      onFocusCapture={keepOpen}
    >
      <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-edge-secondary bg-surface-primary/70 py-1 pl-2.5 pr-1 text-[10px] text-content-secondary transition-colors hover:border-accent/35 hover:bg-surface-tertiary">
        <span>{entry.tag}</span>
        <span className="rounded-full bg-surface-tertiary px-1.5 py-0.5 text-[9px] tabular-nums text-content-muted">
          {entry.count}/{total}
        </span>
        <button
          type="button"
          disabled={Boolean(pendingKey)}
          onClick={() => onRemove(entry.tag, entry.illustrations.map((item) => item.id), 'all')}
          className="grid h-5 w-5 place-items-center rounded-full text-content-muted transition-colors hover:bg-danger/10 hover:text-danger focus:outline-none focus:ring-2 focus:ring-danger/25 disabled:opacity-40"
          aria-label={t('colorBoard.tags.removeTag', { tag: entry.tag })}
        >
          {removingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        </button>
      </span>

      {open && createPortal(
        <div
          className="fixed z-[105] rounded-2xl border border-edge-primary bg-surface-secondary/95 p-2.5 shadow-2xl shadow-overlay/30 backdrop-blur-xl"
          style={position}
          onMouseEnter={keepOpen}
          onMouseLeave={scheduleClose}
          role="dialog"
          aria-label={t('colorBoard.tags.holdersTitle', { tag: entry.tag })}
        >
          <div className="flex items-start gap-3 px-1 pb-2 pt-0.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-tertiary text-content-tertiary">
              <Tag className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-content-primary">{entry.tag}</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-content-muted">
                {t('colorBoard.tags.holdersSummary', { count: entry.count, total })}
              </p>
            </div>
          </div>

          <div
            role="list"
            aria-label={t('colorBoard.tags.holdersTitle', { tag: entry.tag })}
            className={`artifex-scrollbar artifex-scrollbar-quiet border-t border-edge-primary pt-1 ${expanded ? 'max-h-72 overflow-y-auto overscroll-contain pr-1' : ''}`}
          >
            {visibleIllustrations.map((illustration) => (
              <TagHolderRow
                key={illustration.id}
                illustration={illustration}
                colorGroupName={resolveColorGroupName(illustration)}
                quality={quality}
                busy={pendingKey === `remove:${entry.tag}:${illustration.id}`}
                onRemove={(illustrationId) => onRemove(entry.tag, [illustrationId], illustrationId)}
              />
            ))}
          </div>

          {entry.count > 7 && (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-xl border-t border-edge-primary px-3 py-2 text-[10px] font-medium text-content-muted transition-colors hover:bg-surface-tertiary hover:text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/25"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              {expanded
                ? t('colorBoard.tags.collapse')
                : t('colorBoard.tags.expand', { count: entry.count })}
            </button>
          )}
          <p className="px-2 pb-0.5 pt-1.5 text-center text-[9px] text-content-muted">
            {t('colorBoard.tags.previewHint')}
          </p>
        </div>,
        document.body,
      )}
    </span>
  );
}

export default function ColorBoardSelectionDock({
  selectedIllustrations,
  quality,
  resolveColorGroupName,
  onClear,
  onDownload,
  onDelete,
  onUpdateTags,
  tagPanelOpen,
  onTagPanelChange,
}) {
  const { t } = useLocale();
  const [tagValue, setTagValue] = useState('');
  const [pendingKey, setPendingKey] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tagPanelHeight, setTagPanelHeight] = useState(() => {
    const bounds = getTagPanelHeightBounds();
    return clamp(TAG_PANEL_DEFAULT_HEIGHT, bounds.min, bounds.max);
  });
  const [resizingTagPanel, setResizingTagPanel] = useState(false);
  const resizeGestureRef = useRef(null);
  const tagSummary = useMemo(
    () => buildSelectionTagSummary(selectedIllustrations),
    [selectedIllustrations],
  );
  const ids = useMemo(
    () => selectedIllustrations.map((illustration) => illustration.id),
    [selectedIllustrations],
  );

  useEffect(() => {
    if (!tagPanelOpen) return undefined;
    const fitPanelToViewport = () => {
      const bounds = getTagPanelHeightBounds();
      setTagPanelHeight((current) => clamp(current, bounds.min, bounds.max));
    };
    fitPanelToViewport();
    window.addEventListener('resize', fitPanelToViewport);
    return () => window.removeEventListener('resize', fitPanelToViewport);
  }, [tagPanelOpen]);

  const run = async (key, action) => {
    if (pendingKey) return;
    setPendingKey(key);
    try {
      await action();
    } catch {
      // Parent actions own user-facing error reporting.
    } finally {
      setPendingKey('');
    }
  };

  const addTags = () => {
    const tags = parseTagInput(tagValue);
    if (tags.length === 0) return;
    run('add', async () => {
      await onUpdateTags(ids, 'add', tags);
      setTagValue('');
    });
  };

  const removeTag = (tag, illustrationIds, suffix) => {
    run(`remove:${tag}:${suffix}`, () => onUpdateTags(illustrationIds, 'remove', [tag]));
  };

  const beginTagPanelResize = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeGestureRef.current = {
      startHeight: tagPanelHeight,
      startY: event.clientY,
    };
    setResizingTagPanel(true);
  };

  const resizeTagPanel = (event) => {
    if (!resizeGestureRef.current) return;
    const { startHeight, startY } = resizeGestureRef.current;
    const bounds = getTagPanelHeightBounds();
    setTagPanelHeight(clamp(startHeight + startY - event.clientY, bounds.min, bounds.max));
  };

  const finishTagPanelResize = (event) => {
    if (!resizeGestureRef.current) return;
    resizeGestureRef.current = null;
    setResizingTagPanel(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeTagPanelWithKeyboard = (event) => {
    const bounds = getTagPanelHeightBounds();
    const actions = {
      ArrowDown: (height) => height - TAG_PANEL_HEIGHT_STEP,
      ArrowUp: (height) => height + TAG_PANEL_HEIGHT_STEP,
      End: () => bounds.max,
      Home: () => bounds.min,
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    setTagPanelHeight((current) => clamp(action(current), bounds.min, bounds.max));
  };

  const tagPanelHeightBounds = getTagPanelHeightBounds();

  if (selectedIllustrations.length === 0) return null;

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center px-4" data-board-control>
        <div className="pointer-events-auto relative max-w-full">
          {tagPanelOpen && (
            <section
              className={`absolute bottom-[calc(100%+10px)] left-1/2 flex w-[min(860px,calc(100vw-2rem))] -translate-x-1/2 flex-col rounded-3xl border bg-surface-secondary/95 p-4 shadow-2xl backdrop-blur-xl transition-[border-color,box-shadow] ${
                resizingTagPanel
                  ? 'border-accent/40 shadow-accent/10'
                  : 'border-edge-primary/90 shadow-overlay/25'
              }`}
              style={{ height: tagPanelHeight }}
              aria-labelledby="color-board-tags-title"
            >
              <div
                role="separator"
                tabIndex={0}
                aria-label={t('colorBoard.tags.resize')}
                aria-orientation="horizontal"
                aria-valuemin={Math.round(tagPanelHeightBounds.min)}
                aria-valuemax={Math.round(tagPanelHeightBounds.max)}
                aria-valuenow={Math.round(tagPanelHeight)}
                title={t('colorBoard.tags.resize')}
                onPointerDown={beginTagPanelResize}
                onPointerMove={resizeTagPanel}
                onPointerUp={finishTagPanelResize}
                onPointerCancel={finishTagPanelResize}
                onKeyDown={resizeTagPanelWithKeyboard}
                className={`group/resize absolute left-1/2 top-0 z-10 flex h-5 w-14 -translate-x-1/2 -translate-y-1/2 touch-none cursor-ns-resize select-none items-center justify-center rounded-full border shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent/30 ${
                  resizingTagPanel
                    ? 'border-accent bg-accent text-white'
                    : 'border-edge-primary bg-surface-secondary text-content-muted hover:border-accent/35 hover:text-accent'
                }`}
              >
                <GripHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
              </div>

              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
                  <Tag className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 id="color-board-tags-title" className="text-sm font-semibold text-content-primary">
                    {t('colorBoard.tags.title')}
                  </h3>
                  <p className="mt-0.5 text-[10px] text-content-muted">
                    {t('colorBoard.tags.subtitle', { count: selectedIllustrations.length })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onTagPanelChange(false)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-content-muted hover:bg-surface-tertiary hover:text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/25"
                  aria-label={t('colorBoard.tags.close')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2 rounded-2xl border border-edge-primary bg-surface-primary/70 p-1.5">
                <TagPromptSuggest
                  type="tag"
                  value={tagValue}
                  onChange={setTagValue}
                  onEnter={addTags}
                  placeholder={t('colorBoard.tags.addPlaceholder')}
                  className="min-w-0 flex-1"
                  inputClassName="w-full rounded-xl bg-transparent px-3 py-2 text-xs text-content-primary placeholder-content-muted focus:outline-none"
                />
                <button
                  type="button"
                  onClick={addTags}
                  disabled={!tagValue.trim() || Boolean(pendingKey)}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3 text-[10px] font-semibold text-white shadow-sm shadow-accent/20 transition-colors hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent/35 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {pendingKey === 'add' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {t('colorBoard.tags.add')}
                </button>
              </div>

              <div className="mt-3 grid min-h-0 flex-1 grid-rows-2 gap-3 lg:grid-cols-2 lg:grid-rows-1">
                <div className="flex min-h-0 flex-col rounded-2xl border border-accent/20 bg-accent/5 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
                      {t('colorBoard.tags.commonTitle')}
                    </p>
                    <span className="text-[9px] tabular-nums text-content-muted">{tagSummary.common.length}</span>
                  </div>
                  <p className="mt-1 text-[9px] leading-relaxed text-content-muted">{t('colorBoard.tags.commonDesc')}</p>
                  <div
                    role="region"
                    aria-label={t('colorBoard.tags.commonTitle')}
                    className="artifex-scrollbar artifex-scrollbar-quiet mt-2 flex min-h-7 flex-1 flex-wrap content-start gap-1.5 overflow-y-auto overscroll-contain pr-1"
                  >
                    {tagSummary.common.length > 0 ? tagSummary.common.map((entry) => (
                      <span key={entry.tag} className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/10 py-1 pl-2.5 pr-1 text-[10px] font-medium text-accent">
                        <Check className="h-3 w-3" strokeWidth={2.5} />
                        <span>{entry.tag}</span>
                        <button
                          type="button"
                          disabled={Boolean(pendingKey)}
                          onClick={() => removeTag(entry.tag, ids, 'all')}
                          className="grid h-5 w-5 place-items-center rounded-full transition-colors hover:bg-danger/10 hover:text-danger focus:outline-none focus:ring-2 focus:ring-danger/25 disabled:opacity-40"
                          aria-label={t('colorBoard.tags.removeTag', { tag: entry.tag })}
                        >
                          {pendingKey === `remove:${entry.tag}:all`
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <X className="h-3 w-3" />}
                        </button>
                      </span>
                    )) : (
                      <span className="self-center text-[10px] text-content-muted">{t('colorBoard.tags.noCommon')}</span>
                    )}
                  </div>
                </div>

                <div className="flex min-h-0 flex-col rounded-2xl border border-edge-primary bg-surface-primary/50 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-content-tertiary">
                      {t('colorBoard.tags.partialTitle')}
                    </p>
                    <span className="text-[9px] tabular-nums text-content-muted">{tagSummary.partial.length}</span>
                  </div>
                  <p className="mt-1 text-[9px] leading-relaxed text-content-muted">{t('colorBoard.tags.partialDesc')}</p>
                  <div
                    role="region"
                    aria-label={t('colorBoard.tags.partialTitle')}
                    className="artifex-scrollbar artifex-scrollbar-quiet mt-2 flex min-h-7 flex-1 flex-wrap content-start gap-1.5 overflow-y-auto overscroll-contain pr-1"
                  >
                    {tagSummary.partial.length > 0 ? tagSummary.partial.map((entry) => (
                      <PartialTagChip
                        key={entry.tag}
                        entry={entry}
                        total={tagSummary.total}
                        quality={quality}
                        pendingKey={pendingKey}
                        resolveColorGroupName={resolveColorGroupName}
                        onRemove={removeTag}
                      />
                    )) : (
                      <span className="self-center text-[10px] text-content-muted">{t('colorBoard.tags.noPartial')}</span>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          <div className="flex max-w-full items-center gap-1.5 rounded-2xl border border-edge-primary/90 bg-surface-secondary/95 p-1.5 shadow-xl shadow-overlay/20 backdrop-blur-xl">
            <span className="shrink-0 rounded-xl bg-accent px-2.5 py-1.5 text-[10px] font-semibold tabular-nums text-white">
              {t('colorBoard.selected', { count: selectedIllustrations.length })}
            </span>
            <button
              type="button"
              onClick={() => onTagPanelChange(!tagPanelOpen)}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[10px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent/30 ${
                tagPanelOpen ? 'bg-accent/10 text-accent' : 'text-content-secondary hover:bg-surface-tertiary hover:text-content-primary'
              }`}
            >
              <Tag className="h-3.5 w-3.5" />
              {t('colorBoard.batch.tags')}
            </button>
            <button
              type="button"
              onClick={() => run('download', () => onDownload(selectedIllustrations))}
              disabled={Boolean(pendingKey)}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[10px] font-medium text-content-secondary transition-colors hover:bg-surface-tertiary hover:text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-40"
            >
              {pendingKey === 'download' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {t('colorBoard.batch.download')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={Boolean(pendingKey)}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[10px] font-medium text-danger transition-colors hover:bg-danger/10 focus:outline-none focus:ring-2 focus:ring-danger/25 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('colorBoard.batch.delete')}
            </button>
            <span className="mx-0.5 h-4 w-px shrink-0 bg-edge-primary" />
            <button
              type="button"
              onClick={onClear}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-content-muted transition-colors hover:bg-surface-tertiary hover:text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/25"
              aria-label={t('colorBoard.clearSelection')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title={t('colorBoard.delete.title')}
          message={t('colorBoard.delete.message', { count: selectedIllustrations.length })}
          confirmText={t('colorBoard.delete.confirm')}
          cancelText={t('colorBoard.delete.cancel')}
          danger
          onConfirm={() => run('delete', async () => {
            await onDelete(ids);
            setConfirmDelete(false);
          })}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
