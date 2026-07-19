import {
  Component, lazy, Suspense, useCallback, useEffect, useMemo, useState,
} from 'react';
import { motion } from 'framer-motion';
import {
  CircleDot, Focus, Hand, Layers3, Loader2, Minus, MousePointer2, Move,
  Palette, Plus, Settings2, X,
} from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';
import useColorBoardRendererPreference, {
  COLOR_BOARD_RENDERER_OPTIONS,
  resolveColorBoardRenderer,
} from '../utils/colorBoardRendererPreference';
import ColorBoardSelectionDock from './ColorBoardSelectionDock';
import IllustrationPreviewImage from './IllustrationPreviewImage';
import InferenceIcon from './InferenceIcon';
import DomBoardRenderer from './color-board/DomBoardRenderer';
import useColorBoardController from './color-board/useColorBoardController';
import { BOARD_PREVIEW_QUALITY } from './color-board/constants';

const WebGLBoardRenderer = lazy(() => import('./color-board/WebGLBoardRenderer'));

class WebGLRendererBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    this.props.onUnavailable(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export { buildColorBoardLayout } from '../utils/colorBoardLayout';

export default function ColorGroupBoard({
  groupName,
  illustrations,
  pairs,
  matchOrder,
  manualAssignments,
  onAssign,
  onDownload,
  onDelete,
  onUpdateTags,
  onConfigure,
  onClose,
  uploading = false,
  uploadProgress = null,
}) {
  const { t } = useLocale();
  const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  const [rendererPreference] = useColorBoardRendererPreference();
  const desiredRenderer = resolveColorBoardRenderer(rendererPreference);
  const [runtimeRenderer, setRuntimeRenderer] = useState(desiredRenderer);
  const controller = useColorBoardController({
    illustrations,
    pairs,
    matchOrder,
    manualAssignments,
    onAssign,
    onClose,
    t,
  });
  const setBoardLastAction = controller.setLastAction;

  useEffect(() => {
    setRuntimeRenderer(desiredRenderer);
  }, [desiredRenderer]);

  const handleWebGLUnavailable = useCallback(() => {
    setRuntimeRenderer(COLOR_BOARD_RENDERER_OPTIONS.DOM);
    setBoardLastAction(t('colorBoard.renderer.fallback'));
  }, [setBoardLastAction, t]);

  const selectedIllustrations = useMemo(
    () => illustrations.filter((illustration) => controller.selectedIds.has(illustration.id)),
    [controller.selectedIds, illustrations],
  );
  const resolveColorGroupName = useCallback((illustration) => {
    const membership = controller.layout.memberships.get(illustration.id);
    return controller.circleById.get(membership?.effectiveGroupId)?.label
      || t('colorBoard.tags.otherGroup');
  }, [controller.circleById, controller.layout.memberships, t]);
  const manualTotal = Object.keys(manualAssignments || {}).length;

  const rendererProps = {
    layout: controller.layout,
    view: controller.view,
    selectedIds: controller.selectedIds,
    draggingIds: controller.draggingIds,
    dropTarget: controller.dropTarget,
    freeRowLimit: controller.freeRowLimit,
    onFreeRowLimitChange: controller.setFreeRowLimit,
    onKeyboardSelect: controller.handleKeyboardSelect,
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[65] overflow-hidden bg-surface-primary"
      role="dialog"
      aria-modal="true"
      aria-labelledby="color-board-title"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 p-3 sm:p-4">
        <div className="pointer-events-auto mx-auto flex max-w-[1500px] items-center gap-3 rounded-2xl border border-edge-primary/90 bg-surface-secondary/90 px-3 py-2.5 shadow-xl shadow-overlay/10 backdrop-blur-xl sm:px-4">
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-content-muted transition-colors hover:bg-surface-tertiary hover:text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
            aria-label={t('colorBoard.close')}
          >
            <X className="h-4 w-4" />
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                <Layers3 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 id="color-board-title" className="truncate text-sm font-semibold text-content-primary sm:text-base">
                  {t('colorBoard.title')}
                </h2>
                <p className="hidden truncate text-[11px] text-content-muted sm:block">
                  {t('colorBoard.subtitle', { group: groupName })}
                </p>
              </div>
            </div>
          </div>

          <div className="ml-auto hidden items-center gap-1 rounded-xl border border-edge-primary bg-surface-primary/70 p-1 lg:flex">
            <span className="flex items-center gap-1.5 rounded-lg bg-accent/10 px-2.5 py-1.5 text-[10px] font-medium text-accent">
              <Hand className="h-3 w-3" />
              {t('colorBoard.priority.manual')}
            </span>
            <span className="px-1 text-content-muted">›</span>
            <span className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-content-tertiary">
              <InferenceIcon className="h-3 w-3" />
              {t('colorBoard.priority.automatic')}
            </span>
            <span className="px-1 text-content-muted">›</span>
            <span className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-content-muted">
              <CircleDot className="h-3 w-3" />
              {t('colorBoard.priority.other')}
            </span>
          </div>

          <span className="hidden shrink-0 rounded-full bg-surface-tertiary px-2.5 py-1 text-[10px] tabular-nums text-content-muted xl:inline">
            {t('colorBoard.summary', { groups: pairs.length, illustrations: illustrations.length, manual: manualTotal })}
          </span>

          {uploading && (
            <span
              className="hidden shrink-0 items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-[10px] font-medium text-accent md:flex"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              {uploadProgress
                ? t('groupOverlay.upload.progress', {
                  current: uploadProgress.current,
                  total: uploadProgress.total,
                })
                : t('groupOverlay.upload.uploading')}
            </span>
          )}

          <button
            type="button"
            onClick={onConfigure}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-accent/25 bg-accent/10 px-3 text-xs font-medium text-accent transition-all hover:border-accent/40 hover:bg-accent/15 focus:outline-none focus:ring-2 focus:ring-accent/35"
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('colorBoard.configure')}</span>
          </button>

          <div className="flex h-9 shrink-0 items-center rounded-xl border border-edge-primary bg-surface-primary/80 p-0.5">
            <button
              type="button"
              onClick={() => controller.zoomTo(controller.view.scale - 0.1)}
              className="grid h-7 w-7 place-items-center rounded-lg text-content-muted hover:bg-surface-tertiary hover:text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
              aria-label={t('colorBoard.zoomOut')}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-10 text-center text-[10px] tabular-nums text-content-muted">
              {Math.round(controller.view.scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => controller.zoomTo(controller.view.scale + 0.1)}
              className="grid h-7 w-7 place-items-center rounded-lg text-content-muted hover:bg-surface-tertiary hover:text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
              aria-label={t('colorBoard.zoomIn')}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={controller.fitToView}
              className="ml-0.5 grid h-7 w-7 place-items-center rounded-lg text-content-muted hover:bg-surface-tertiary hover:text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
              aria-label={t('colorBoard.fit')}
            >
              <Focus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={controller.viewportRef}
        data-color-board-viewport
        className="absolute inset-0 cursor-default overflow-hidden select-none"
        style={{
          backgroundColor: 'rgb(var(--clr-surface-1))',
          backgroundImage: 'radial-gradient(rgb(var(--clr-text-muted) / 0.2) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={controller.handleViewportPointerDown}
        onPointerMove={controller.handleViewportPointerMove}
        onPointerUp={controller.handleViewportPointerUp}
        onPointerCancel={controller.handleViewportPointerCancel}
        onPointerLeave={controller.handleViewportPointerLeave}
      >
        {pairs.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center px-5">
            <div className="max-w-md rounded-3xl border border-edge-primary bg-surface-secondary/95 p-8 text-center shadow-2xl shadow-overlay/10 backdrop-blur-xl">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent/10 text-accent">
                <Palette className="h-6 w-6" />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-content-primary">{t('colorBoard.empty.title')}</h3>
              <p className="mt-2 text-sm leading-relaxed text-content-muted">{t('colorBoard.empty.body')}</p>
              <button
                type="button"
                onClick={onConfigure}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-accent/20 transition-all hover:bg-accent-hover hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <Plus className="h-4 w-4" />
                {t('colorBoard.empty.action')}
              </button>
            </div>
          </div>
        ) : runtimeRenderer === COLOR_BOARD_RENDERER_OPTIONS.WEBGL ? (
          <WebGLRendererBoundary onUnavailable={handleWebGLUnavailable}>
            <Suspense
              fallback={(
                <div className="absolute inset-0 grid place-items-center" role="status">
                  <span className="flex items-center gap-2 rounded-xl border border-edge-primary bg-surface-secondary/90 px-4 py-3 text-xs text-content-muted shadow-lg backdrop-blur">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    {t('colorBoard.renderer.loading')}
                  </span>
                </div>
              )}
            >
              <WebGLBoardRenderer
                ref={controller.rendererRef}
                {...rendererProps}
                onUnavailable={handleWebGLUnavailable}
                theme={theme}
              />
            </Suspense>
          </WebGLRendererBoundary>
        ) : (
          <DomBoardRenderer
            ref={controller.rendererRef}
            {...rendererProps}
            onCardMouseEnter={controller.handleCardMouseEnter}
            onCardMouseMove={controller.handleCardMouseMove}
            onCardMouseLeave={controller.handleCardMouseLeave}
          />
        )}
      </div>

      {controller.preview && (
        <div
          data-color-board-preview
          className="pointer-events-none fixed z-50 w-64 overflow-hidden rounded-2xl border border-edge-primary bg-surface-secondary/95 p-2 shadow-2xl shadow-overlay/25 backdrop-blur-xl"
          style={{ left: controller.preview.left, top: controller.preview.top }}
        >
          <IllustrationPreviewImage
            illustration={controller.preview.illustration}
            quality={BOARD_PREVIEW_QUALITY}
            height={controller.preview.mediaHeight}
          />
          <div className="flex items-center gap-2 px-1 pb-1 pt-2">
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ${
              controller.preview.membership?.source === 'manual'
                ? 'bg-accent/15 text-accent'
                : 'bg-surface-tertiary text-content-muted'
            }`}>
              {controller.preview.membership?.source === 'manual'
                ? <Hand className="h-3 w-3" />
                : controller.preview.membership?.source === 'computed'
                  ? <InferenceIcon className="h-3 w-3" />
                  : <CircleDot className="h-3 w-3" />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-content-primary">{controller.preview.illustration.original_filename}</p>
              <p className="text-[10px] text-content-muted">
                {controller.preview.membership?.source === 'manual'
                  ? t('colorBoard.source.manual')
                  : controller.preview.membership?.source === 'computed'
                    ? t('colorBoard.source.automatic')
                    : t('colorBoard.source.other')}
              </p>
            </div>
          </div>
        </div>
      )}

      {(controller.lastAction || controller.dropTarget || controller.selectedIds.size === 0) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-2xl border border-edge-primary/90 bg-surface-secondary/90 px-3 py-2 shadow-xl shadow-overlay/10 backdrop-blur-xl">
            {controller.lastAction ? (
              <span
                className="px-2 text-xs font-medium text-accent"
                role="status"
                aria-live="polite"
              >
                {controller.lastAction}
              </span>
            ) : controller.dropTarget ? (
              <span className="px-2 text-xs font-medium text-accent">
                {controller.dropTarget === 'outside'
                  ? t('colorBoard.drop.clear')
                  : t('colorBoard.drop.group', {
                    group: controller.circleById.get(controller.dropTarget)?.label || '',
                  })}
              </span>
            ) : (
              <>
                <span className="hidden items-center gap-1.5 text-[10px] text-content-muted sm:flex">
                  <Move className="h-3 w-3" />
                  {t('colorBoard.help.pan')}
                </span>
                <span className="hidden h-4 w-px bg-edge-primary sm:block" />
                <span className="flex items-center gap-1.5 text-[10px] text-content-muted">
                  <MousePointer2 className="h-3 w-3" />
                  {t('colorBoard.help.select')}
                </span>
                <span className="h-4 w-px bg-edge-primary" />
                <span className="flex items-center gap-1.5 text-[10px] text-content-muted">
                  <Hand className="h-3 w-3" />
                  {t('colorBoard.help.assign')}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {controller.selectedIds.size > 0 && !controller.lastAction && !controller.dropTarget && (
        <ColorBoardSelectionDock
          selectedIllustrations={selectedIllustrations}
          quality={BOARD_PREVIEW_QUALITY}
          resolveColorGroupName={resolveColorGroupName}
          onClear={controller.clearSelection}
          onDownload={onDownload}
          onDelete={onDelete}
          onUpdateTags={onUpdateTags}
          tagPanelOpen={controller.tagPanelOpen}
          onTagPanelChange={(open) => {
            controller.setTagPanelOpen(open);
            if (open) controller.clearPreview();
          }}
        />
      )}
    </motion.div>
  );
}
