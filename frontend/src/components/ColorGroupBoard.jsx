import {
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { motion } from 'framer-motion';
import {
  Check, CircleDot, Focus, Hand, Layers3, Loader2, Minus, MousePointer2, Move,
  Palette, Plus, Settings2, X,
} from 'lucide-react';
import { backendUrl } from '../api/url';
import { useLocale } from '../contexts/LocaleContext';
import {
  buildColorBoardLayout,
  CARD_SIZE,
  FREE_CARD_COLUMN_GAP,
  FREE_ROW_LIMIT_DEFAULT,
  FREE_ROW_LIMIT_MAX,
  FREE_ROW_LIMIT_MIN,
  MAX_SCALE,
  MIN_SCALE,
  pointInCircle,
  rectFromPoints,
  WORLD_MARGIN,
} from '../utils/colorBoardLayout';
import { clamp, getAspectFitPreviewHeight } from '../utils/illustrationPreview';
import ColorBoardSelectionDock from './ColorBoardSelectionDock';
import IllustrationPreviewImage from './IllustrationPreviewImage';
import InferenceIcon from './InferenceIcon';

const FREE_ROW_LIMIT_STORAGE_KEY = 'color-board-free-row-limit';
const FREE_GRID_VIEWPORT_RATIO = 0.8;
const PREVIEW_MEDIA_WIDTH = 240;
const PREVIEW_MEDIA_MIN_HEIGHT = 80;
const PREVIEW_MEDIA_MAX_HEIGHT = 360;
const PREVIEW_CHROME_HEIGHT = 64;
const BOARD_CARD_QUALITY = 'low';
const BOARD_PREVIEW_QUALITY = 'normal';

export { buildColorBoardLayout } from '../utils/colorBoardLayout';

function readFreeRowLimit() {
  try {
    const stored = localStorage.getItem(FREE_ROW_LIMIT_STORAGE_KEY);
    if (stored != null) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) {
        return clamp(Math.round(parsed), FREE_ROW_LIMIT_MIN, FREE_ROW_LIMIT_MAX);
      }
    }
  } catch {}
  return FREE_ROW_LIMIT_DEFAULT;
}

function requestFrame(callback) {
  if (typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(callback, 16);
}

function cancelFrame(frameId) {
  if (frameId == null) return;
  if (typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(frameId);
  } else {
    window.clearTimeout(frameId);
  }
}

function sameSet(left, right) {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function useStableEvent(handler) {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  });
  return useCallback((...args) => handlerRef.current(...args), []);
}

function previewGeometry(illustration, clientX, clientY) {
  const mediaHeight = getAspectFitPreviewHeight(
    illustration,
    PREVIEW_MEDIA_WIDTH,
    PREVIEW_MEDIA_MIN_HEIGHT,
    PREVIEW_MEDIA_MAX_HEIGHT,
  );
  return {
    mediaHeight,
    left: Math.min(clientX + 18, Math.max(12, window.innerWidth - 286)),
    top: Math.min(
      clientY + 18,
      Math.max(12, window.innerHeight - mediaHeight - PREVIEW_CHROME_HEIGHT),
    ),
  };
}

const BoardCirclesLayer = memo(function BoardCirclesLayer({ circles, dropTarget }) {
  const { t } = useLocale();

  return circles.map((circle) => {
    const isTarget = dropTarget === circle.id;
    return (
      <div
        key={circle.id}
        data-board-circle={circle.id}
        data-drop-target={isTarget ? 'true' : undefined}
        className="pointer-events-none absolute rounded-full border-2"
        style={{
          left: circle.x - circle.radius,
          top: circle.y - circle.radius,
          width: circle.radius * 2,
          height: circle.radius * 2,
          backgroundColor: circle.color,
          borderColor: circle.borderColor,
          boxShadow: '0 24px 70px rgb(var(--clr-overlay) / 0.08)',
          outline: isTarget ? `6px solid ${circle.borderColor}` : 'none',
          outlineOffset: isTarget ? 6 : 0,
        }}
      >
        <div
          className="absolute left-1/2 top-7 -translate-x-1/2 whitespace-nowrap rounded-2xl border bg-surface-secondary/92 px-4 py-2.5 shadow-lg shadow-overlay/10 backdrop-blur-xl"
          style={{ borderColor: circle.borderColor }}
        >
          <div className="flex items-center justify-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: circle.borderColor }} />
            <span className="max-w-[240px] truncate text-sm font-semibold text-content-primary">{circle.label}</span>
            <span className="rounded-full bg-surface-tertiary px-2 py-0.5 text-[10px] tabular-nums text-content-muted">
              {circle.items.length}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-center gap-3 text-[9px] text-content-muted">
            <span className="flex items-center gap-1 text-accent">
              <Hand className="h-2.5 w-2.5" />
              {t('colorBoard.count.manual', { count: circle.manualCount })}
            </span>
            <span className="flex items-center gap-1">
              <InferenceIcon className="h-2.5 w-2.5" />
              {t('colorBoard.count.automatic', { count: circle.computedCount })}
            </span>
          </div>
        </div>
      </div>
    );
  });
});

const BoardCard = memo(function BoardCard({
  card,
  selected,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  onKeyboardSelect,
  onElementChange,
}) {
  const { t } = useLocale();
  const id = card.illustration.id;
  const membership = card.membership;
  const sourceLabel = membership?.source === 'manual'
    ? t('colorBoard.source.manual')
    : membership?.source === 'computed'
      ? t('colorBoard.source.automatic')
      : t('colorBoard.source.other');
  const SourceIcon = membership?.source === 'manual'
    ? Hand
    : membership?.source === 'computed' ? InferenceIcon : CircleDot;
  const setElementRef = useCallback((element) => {
    onElementChange(id, element);
  }, [id, onElementChange]);

  return (
    <button
      ref={setElementRef}
      type="button"
      data-board-card
      data-dragging={dragging ? 'true' : undefined}
      aria-pressed={selected}
      aria-label={`${card.illustration.original_filename} · ${sourceLabel}`}
      className={`group/card absolute rounded-2xl border-2 bg-surface-secondary p-1 shadow-lg transition-[border-color,box-shadow,filter] focus:outline-none focus:ring-4 focus:ring-accent/30 ${
        selected
          ? 'border-accent shadow-xl shadow-accent/20'
          : 'border-surface-secondary hover:border-accent/45 hover:shadow-xl'
      } ${dragging ? 'z-20 cursor-grabbing' : 'z-10 cursor-grab'}`}
      style={{
        left: card.x,
        top: card.y,
        width: CARD_SIZE,
        height: CARD_SIZE,
        transform: dragging
          ? `translate3d(var(--board-drag-x, 0px), var(--board-drag-y, 0px), 0) rotate(${card.rotation}deg) scale(1.05)`
          : `rotate(${card.rotation}deg)`,
        filter: dragging ? 'saturate(1.08)' : undefined,
        willChange: dragging ? 'transform' : undefined,
      }}
      onPointerDown={(event) => onPointerDown(event, card)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onMouseEnter={(event) => onMouseEnter(event, card)}
      onMouseMove={(event) => onMouseMove(event, card)}
      onMouseLeave={() => onMouseLeave(id)}
      onClick={(event) => {
        if (event.detail === 0) onKeyboardSelect(id);
      }}
    >
      <img
        src={backendUrl(`${card.illustration.thumbnail_url}?quality=${BOARD_CARD_QUALITY}`)}
        alt=""
        loading="lazy"
        decoding="async"
        draggable="false"
        className="h-full w-full rounded-xl object-cover"
      />
      <span className={`absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full border border-surface-secondary text-white shadow-md ${
        membership?.source === 'manual' ? 'bg-accent' : 'bg-content-tertiary'
      }`} title={sourceLabel}>
        <SourceIcon className="h-2.5 w-2.5" />
      </span>
      {selected && (
        <span className="absolute -bottom-1 -left-1 grid h-5 w-5 place-items-center rounded-full border-2 border-surface-secondary bg-accent text-[10px] font-bold text-white shadow-md">
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
        </span>
      )}
    </button>
  );
});

const BoardCardsLayer = memo(function BoardCardsLayer({
  cards,
  selectedIds,
  draggingIds,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  onKeyboardSelect,
  onElementChange,
}) {
  return cards.map((card) => {
    const id = card.illustration.id;
    return (
      <BoardCard
        key={id}
        card={card}
        selected={selectedIds.has(id)}
        dragging={draggingIds.has(id)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onMouseEnter={onMouseEnter}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onKeyboardSelect={onKeyboardSelect}
        onElementChange={onElementChange}
      />
    );
  });
});

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
  const viewportRef = useRef(null);
  const worldRef = useRef(null);
  const cardElementsRef = useRef(new Map());
  const draggingElementsRef = useRef([]);
  const selectionRectRef = useRef(null);
  const previewRef = useRef(null);
  const gestureRef = useRef(null);
  const didFitRef = useRef(false);
  const layoutWidthRef = useRef(null);
  const initialView = { x: 0, y: 0, scale: 0.72 };
  const viewRef = useRef(initialView);
  const viewFrameRef = useRef(null);
  const pendingViewRef = useRef(null);
  const dragFrameRef = useRef(null);
  const pendingDragOffsetRef = useRef(null);
  const previewFrameRef = useRef(null);
  const pendingPreviewGeometryRef = useRef(null);
  const [view, setView] = useState(initialView);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [draggingIds, setDraggingIds] = useState(new Set());
  const [preview, setPreview] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [lastAction, setLastAction] = useState('');
  const [tagPanelOpen, setTagPanelOpen] = useState(false);
  const [freeRowLimit, setFreeRowLimitState] = useState(readFreeRowLimit);
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window === 'undefined' ? 1280 : window.innerWidth || 1280
  ));

  const setFreeRowLimit = useCallback((value) => {
    const nextValue = clamp(
      Math.round(Number(value) || FREE_ROW_LIMIT_DEFAULT),
      FREE_ROW_LIMIT_MIN,
      FREE_ROW_LIMIT_MAX,
    );
    setFreeRowLimitState(nextValue);
    try { localStorage.setItem(FREE_ROW_LIMIT_STORAGE_KEY, String(nextValue)); } catch {}
  }, []);

  const availableFreeWidth = Math.max(
    CARD_SIZE,
    (viewportWidth * FREE_GRID_VIEWPORT_RATIO) / view.scale,
  );
  const responsiveFreeColumnLimit = Math.min(
    freeRowLimit,
    Math.max(
      1,
      Math.floor(
        (availableFreeWidth - CARD_SIZE) / (CARD_SIZE + FREE_CARD_COLUMN_GAP),
      ) + 1,
    ),
  );
  const maxFreeWidth = CARD_SIZE
    + Math.max(0, responsiveFreeColumnLimit - 1) * (CARD_SIZE + FREE_CARD_COLUMN_GAP);

  const layout = useMemo(() => buildColorBoardLayout(
    illustrations,
    pairs,
    matchOrder,
    manualAssignments,
    (index) => t('colorBoard.untitledGroup', { n: index }),
    { freeRowLimit, maxFreeWidth },
  ), [
    freeRowLimit,
    illustrations,
    manualAssignments,
    matchOrder,
    maxFreeWidth,
    pairs,
    t,
  ]);

  const circleById = useMemo(
    () => new Map(layout.circles.map((circle) => [circle.id, circle])),
    [layout.circles],
  );

  const selectedIllustrations = useMemo(
    () => illustrations.filter((illustration) => selectedIds.has(illustration.id)),
    [illustrations, selectedIds],
  );
  const resolveColorGroupName = useCallback((illustration) => {
    const membership = layout.memberships.get(illustration.id);
    return circleById.get(membership?.effectiveGroupId)?.label || t('colorBoard.tags.otherGroup');
  }, [circleById, layout.memberships, t]);

  const applyWorldTransform = useCallback((nextView) => {
    if (!worldRef.current) return;
    worldRef.current.style.transform = `translate3d(${nextView.x}px, ${nextView.y}px, 0) scale(${nextView.scale})`;
  }, []);

  const commitView = useCallback((nextView) => {
    cancelFrame(viewFrameRef.current);
    viewFrameRef.current = null;
    pendingViewRef.current = null;
    viewRef.current = nextView;
    applyWorldTransform(nextView);
    setView(nextView);
  }, [applyWorldTransform]);

  useEffect(() => {
    const previousWidth = layoutWidthRef.current;
    layoutWidthRef.current = layout.worldWidth;
    if (previousWidth == null || previousWidth === layout.worldWidth) return;

    const current = viewRef.current;
    const previousCenterX = current.x + previousWidth * current.scale / 2;
    commitView({
      ...current,
      x: previousCenterX - layout.worldWidth * current.scale / 2,
    });
  }, [commitView, layout.worldWidth]);

  const queueViewTransform = useCallback((nextView) => {
    viewRef.current = nextView;
    pendingViewRef.current = nextView;
    if (viewFrameRef.current != null) return;
    viewFrameRef.current = requestFrame(() => {
      viewFrameRef.current = null;
      const pending = pendingViewRef.current;
      pendingViewRef.current = null;
      if (pending) applyWorldTransform(pending);
    });
  }, [applyWorldTransform]);

  const flushViewTransform = useCallback(() => {
    cancelFrame(viewFrameRef.current);
    viewFrameRef.current = null;
    const pending = pendingViewRef.current;
    pendingViewRef.current = null;
    if (pending) applyWorldTransform(pending);
  }, [applyWorldTransform]);

  const registerCardElement = useCallback((illustrationId, element) => {
    if (element) cardElementsRef.current.set(illustrationId, element);
    else cardElementsRef.current.delete(illustrationId);
  }, []);

  const applyDragOffset = useCallback(({ x, y }) => {
    draggingElementsRef.current.forEach((element) => {
      element.style.setProperty('--board-drag-x', `${x}px`);
      element.style.setProperty('--board-drag-y', `${y}px`);
    });
  }, []);

  const queueDragOffset = useCallback((offset) => {
    pendingDragOffsetRef.current = offset;
    if (dragFrameRef.current != null) return;
    dragFrameRef.current = requestFrame(() => {
      dragFrameRef.current = null;
      const pending = pendingDragOffsetRef.current;
      pendingDragOffsetRef.current = null;
      if (pending) applyDragOffset(pending);
    });
  }, [applyDragOffset]);

  const resetDragOffset = useCallback(() => {
    cancelFrame(dragFrameRef.current);
    dragFrameRef.current = null;
    pendingDragOffsetRef.current = null;
    applyDragOffset({ x: 0, y: 0 });
    draggingElementsRef.current.forEach((element) => {
      element.removeAttribute('data-dragging');
    });
    if (worldRef.current) worldRef.current.removeAttribute('data-drag-active');
    draggingElementsRef.current = [];
  }, [applyDragOffset]);

  const applyPreviewGeometry = useCallback((geometry) => {
    if (!previewRef.current) return;
    previewRef.current.style.left = `${geometry.left}px`;
    previewRef.current.style.top = `${geometry.top}px`;
  }, []);

  const queuePreviewGeometry = useCallback((geometry) => {
    pendingPreviewGeometryRef.current = geometry;
    if (previewFrameRef.current != null) return;
    previewFrameRef.current = requestFrame(() => {
      previewFrameRef.current = null;
      const pending = pendingPreviewGeometryRef.current;
      pendingPreviewGeometryRef.current = null;
      if (pending) applyPreviewGeometry(pending);
    });
  }, [applyPreviewGeometry]);

  const clearPreview = useCallback(() => {
    cancelFrame(previewFrameRef.current);
    previewFrameRef.current = null;
    pendingPreviewGeometryRef.current = null;
    setPreview(null);
  }, []);

  const drawSelectionRect = useCallback((rect) => {
    if (!selectionRectRef.current) return;
    selectionRectRef.current.hidden = false;
    selectionRectRef.current.style.left = `${rect.left}px`;
    selectionRectRef.current.style.top = `${rect.top}px`;
    selectionRectRef.current.style.width = `${rect.right - rect.left}px`;
    selectionRectRef.current.style.height = `${rect.bottom - rect.top}px`;
  }, []);

  const hideSelectionRect = useCallback(() => {
    if (selectionRectRef.current) selectionRectRef.current.hidden = true;
  }, []);

  const toWorld = useCallback((clientX, clientY, knownViewportRect) => {
    const rect = knownViewportRect || viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const currentView = viewRef.current;
    return {
      x: (clientX - rect.left - currentView.x) / currentView.scale,
      y: (clientY - rect.top - currentView.y) / currentView.scale,
    };
  }, []);

  const fitToView = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = rect.width || window.innerWidth;
    const height = rect.height || window.innerHeight;
    setViewportWidth(width);
    const scale = clamp(
      Math.min((width - 120) / layout.worldWidth, (height - 120) / layout.worldHeight),
      MIN_SCALE,
      1,
    );
    commitView({
      scale,
      x: (width - layout.worldWidth * scale) / 2,
      y: (height - layout.worldHeight * scale) / 2,
    });
  }, [commitView, layout.worldHeight, layout.worldWidth]);

  const focusInitialView = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = rect.width || window.innerWidth;
    setViewportWidth(width);
    const scale = width < 900 ? 0.58 : 0.72;
    commitView({
      scale,
      x: (width - layout.worldWidth * scale) / 2,
      y: 96 - WORLD_MARGIN * scale,
    });
  }, [commitView, layout.worldWidth]);

  useLayoutEffect(() => {
    viewRef.current = view;
    applyWorldTransform(view);
  }, [applyWorldTransform, view]);

  useLayoutEffect(() => {
    if (didFitRef.current) return;
    didFitRef.current = true;
    focusInitialView();
  }, [focusInitialView]);

  useEffect(() => {
    const handleResize = () => focusInitialView();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [focusInitialView]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (tagPanelOpen) setTagPanelOpen(false);
      else onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, tagPanelOpen]);

  useEffect(() => () => {
    gestureRef.current?.cleanup?.();
    cancelFrame(gestureRef.current?.frameId);
    cancelFrame(viewFrameRef.current);
    cancelFrame(dragFrameRef.current);
    cancelFrame(previewFrameRef.current);
  }, []);

  useEffect(() => {
    setSelectedIds((previous) => {
      const availableIds = new Set(illustrations.map((illustration) => illustration.id));
      const next = new Set([...previous].filter((id) => availableIds.has(id)));
      return sameSet(previous, next) ? previous : next;
    });
  }, [illustrations]);

  useEffect(() => {
    if (selectedIds.size === 0) setTagPanelOpen(false);
  }, [selectedIds.size]);

  useEffect(() => {
    if (!lastAction) return undefined;
    const timeout = window.setTimeout(() => setLastAction(''), 2600);
    return () => window.clearTimeout(timeout);
  }, [lastAction]);

  const zoomAt = useCallback((nextScale, clientX, clientY) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const previous = viewRef.current;
    const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    const width = rect.width || window.innerWidth;
    const height = rect.height || window.innerHeight;
    const anchor = {
      x: Number.isFinite(clientX) ? clientX - rect.left : width / 2,
      y: Number.isFinite(clientY) ? clientY - rect.top : height / 2,
    };
    const worldAnchor = {
      x: (anchor.x - previous.x) / previous.scale,
      y: (anchor.y - previous.y) / previous.scale,
    };
    commitView({
      scale,
      x: anchor.x - worldAnchor.x * scale,
      y: anchor.y - worldAnchor.y * scale,
    });
  }, [commitView]);

  const zoomTo = useCallback((nextScale) => {
    zoomAt(nextScale);
  }, [zoomAt]);

  const handleViewportWheel = useStableEvent((event) => {
    if (event.target.closest?.('[data-board-control]')) return;
    event.preventDefault();
    if (!event.deltaY) return;
    const rect = viewportRef.current?.getBoundingClientRect();
    const pageHeight = rect?.height || window.innerHeight;
    const pixelDelta = event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2 ? event.deltaY * pageHeight : event.deltaY;
    const boundedDelta = clamp(pixelDelta, -120, 120);
    const nextScale = viewRef.current.scale * Math.exp(-boundedDelta * 0.0016);
    zoomAt(nextScale, event.clientX, event.clientY);
  });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    viewport.addEventListener('wheel', handleViewportWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleViewportWheel);
  }, [handleViewportWheel]);

  const applyMarqueeSelection = useStableEvent((gesture, current) => {
    const rect = rectFromPoints(gesture.start, current);
    const nextSelection = new Set(gesture.baseSelection);
    layout.cards.forEach((card) => {
      const centerX = card.x + CARD_SIZE / 2;
      const centerY = card.y + CARD_SIZE / 2;
      if (centerX >= rect.left && centerX <= rect.right && centerY >= rect.top && centerY <= rect.bottom) {
        nextSelection.add(card.illustration.id);
      }
    });
    drawSelectionRect(rect);
    setSelectedIds((previous) => (sameSet(previous, nextSelection) ? previous : nextSelection));
  });

  const queueMarqueeSelection = useStableEvent((gesture, current) => {
    gesture.pendingPoint = current;
    if (gesture.frameId != null) return;
    gesture.frameId = requestFrame(() => {
      gesture.frameId = null;
      if (gestureRef.current !== gesture || !gesture.pendingPoint) return;
      applyMarqueeSelection(gesture, gesture.pendingPoint);
    });
  });

  const handleViewportPointerDown = useStableEvent((event) => {
    if (event.button === 2) {
      event.preventDefault();
      viewportRef.current?.setPointerCapture(event.pointerId);
      gestureRef.current = {
        type: 'pan',
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        startView: viewRef.current,
      };
      if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing';
      clearPreview();
      return;
    }

    if (
      event.button !== 0
      || event.target.closest?.('[data-board-card], button, a, input, select, textarea, [data-board-control]')
    ) return;
    const viewportRect = viewportRef.current?.getBoundingClientRect();
    const start = toWorld(event.clientX, event.clientY, viewportRect);
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const baseSelection = additive ? new Set(selectedIds) : new Set();
    if (!additive) setSelectedIds((previous) => (previous.size === 0 ? previous : new Set()));
    viewportRef.current?.setPointerCapture(event.pointerId);
    gestureRef.current = {
      type: 'marquee', pointerId: event.pointerId, start, baseSelection, viewportRect,
    };
    drawSelectionRect(rectFromPoints(start, start));
    clearPreview();
  });

  const handleViewportPointerMove = useStableEvent((event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.type === 'pan') {
      queueViewTransform({
        ...gesture.startView,
        x: gesture.startView.x + event.clientX - gesture.startClient.x,
        y: gesture.startView.y + event.clientY - gesture.startClient.y,
      });
      return;
    }
    if (gesture.type !== 'marquee') return;

    const current = toWorld(event.clientX, event.clientY, gesture.viewportRect);
    queueMarqueeSelection(gesture, current);
  });

  const handleViewportPointerUp = useStableEvent((event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.type === 'cards') {
      handleCardPointerUp(event);
      return;
    }
    if (gesture.type === 'pan') {
      flushViewTransform();
      setView({ ...viewRef.current });
      if (viewportRef.current) viewportRef.current.style.cursor = 'default';
    } else if (gesture.type === 'marquee') {
      cancelFrame(gesture.frameId);
      gesture.frameId = null;
      applyMarqueeSelection(gesture, toWorld(event.clientX, event.clientY, gesture.viewportRect));
      hideSelectionRect();
    }
    if (gesture.type === 'pan' || gesture.type === 'marquee') {
      gestureRef.current = null;
      if (viewportRef.current?.hasPointerCapture(event.pointerId)) {
        viewportRef.current.releasePointerCapture(event.pointerId);
      }
    }
  });

  const handleViewportPointerCancel = useStableEvent((event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.type === 'cards') {
      handleCardPointerCancel(event);
      return;
    }
    cancelFrame(gesture.frameId);
    if (gesture.type === 'pan') {
      flushViewTransform();
      setView({ ...viewRef.current });
      if (viewportRef.current) viewportRef.current.style.cursor = 'default';
    }
    gestureRef.current = null;
    hideSelectionRect();
    if (viewportRef.current?.hasPointerCapture(event.pointerId)) {
      viewportRef.current.releasePointerCapture(event.pointerId);
    }
  });

  const handleCardPointerDown = useStableEvent((event, card) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const illustrationId = card.illustration.id;
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const nextSelection = new Set(selectedIds);

    if (additive) {
      if (nextSelection.has(illustrationId)) nextSelection.delete(illustrationId);
      else nextSelection.add(illustrationId);
    } else if (!nextSelection.has(illustrationId)) {
      nextSelection.clear();
      nextSelection.add(illustrationId);
    }

    setSelectedIds(nextSelection);
    const ids = nextSelection.has(illustrationId) ? [...nextSelection] : [];
    const gesture = {
      type: 'cards',
      pointerId: event.pointerId,
      ids,
      startClient: { x: event.clientX, y: event.clientY },
      viewportRect: viewportRef.current?.getBoundingClientRect(),
      dragged: false,
      activeDropTarget: null,
    };
    const finishAnywhere = (pointerEvent) => {
      if (pointerEvent.pointerId === gesture.pointerId) handleCardPointerUp(pointerEvent);
    };
    const cancelAnywhere = (pointerEvent) => {
      if (pointerEvent.pointerId === gesture.pointerId) handleCardPointerCancel(pointerEvent);
    };
    gesture.cleanup = () => {
      window.removeEventListener('pointerup', finishAnywhere, true);
      window.removeEventListener('pointercancel', cancelAnywhere, true);
    };
    gestureRef.current = gesture;
    event.currentTarget.setPointerCapture(event.pointerId);
    window.addEventListener('pointerup', finishAnywhere, true);
    window.addEventListener('pointercancel', cancelAnywhere, true);
    resetDragOffset();
    draggingElementsRef.current = ids
      .map((id) => cardElementsRef.current.get(id))
      .filter(Boolean);
    applyDragOffset({ x: 0, y: 0 });
    draggingElementsRef.current.forEach((element) => {
      element.setAttribute('data-dragging', 'true');
    });
    if (worldRef.current && draggingElementsRef.current.length > 0) {
      worldRef.current.setAttribute('data-drag-active', 'true');
    }
    setDraggingIds(new Set(ids));
    setDropTarget(null);
    clearPreview();
  });

  const handleCardPointerMove = useStableEvent((event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.type !== 'cards' || gesture.pointerId !== event.pointerId) return;
    const dx = (event.clientX - gesture.startClient.x) / viewRef.current.scale;
    const dy = (event.clientY - gesture.startClient.y) / viewRef.current.scale;
    if (!gesture.dragged && Math.hypot(dx, dy) < 5) return;
    gesture.dragged = true;
    queueDragOffset({ x: dx, y: dy });
    const worldPoint = toWorld(event.clientX, event.clientY, gesture.viewportRect);
    const target = layout.circles.find((circle) => pointInCircle(worldPoint, circle));
    gesture.hasDropTarget = true;
    gesture.dropTargetId = target?.id || null;
    const nextDropTarget = target?.id || 'outside';
    if (gesture.activeDropTarget !== nextDropTarget) {
      gesture.activeDropTarget = nextDropTarget;
      setDropTarget(nextDropTarget);
    }
  });

  const handleCardPointerUp = useStableEvent((event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.type !== 'cards' || gesture.pointerId !== event.pointerId) return;
    if (gesture.dragged && gesture.ids.length > 0) {
      const pointerTarget = gesture.hasDropTarget
        ? null
        : layout.circles.find((circle) => pointInCircle(
          toWorld(event.clientX, event.clientY, gesture.viewportRect),
          circle,
        ));
      const targetId = gesture.hasDropTarget ? gesture.dropTargetId : pointerTarget?.id;
      const target = targetId ? circleById.get(targetId) : null;
      onAssign(gesture.ids, target?.id || null);
      setLastAction(target
        ? t('colorBoard.action.assigned', { count: gesture.ids.length, group: target.label })
        : t('colorBoard.action.cleared', { count: gesture.ids.length }));
    }
    gesture.cleanup?.();
    gestureRef.current = null;
    setDraggingIds(new Set());
    resetDragOffset();
    setDropTarget(null);
    if (event.currentTarget?.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  });

  const handleCardPointerCancel = useStableEvent((event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.cleanup?.();
    gestureRef.current = null;
    setDraggingIds(new Set());
    resetDragOffset();
    setDropTarget(null);
  });

  const handleCardMouseEnter = useStableEvent((event, card) => {
    if (gestureRef.current) return;
    const geometry = previewGeometry(card.illustration, event.clientX, event.clientY);
    setPreview({
      illustration: card.illustration,
      membership: card.membership,
      ...geometry,
    });
  });

  const handleCardMouseMove = useStableEvent((event, card) => {
    if (gestureRef.current) return;
    queuePreviewGeometry(previewGeometry(card.illustration, event.clientX, event.clientY));
  });

  const handleCardMouseLeave = useStableEvent((illustrationId) => {
    cancelFrame(previewFrameRef.current);
    previewFrameRef.current = null;
    pendingPreviewGeometryRef.current = null;
    setPreview((current) => (current?.illustration.id === illustrationId ? null : current));
  });

  const handleKeyboardSelect = useStableEvent((illustrationId) => {
    setSelectedIds(new Set([illustrationId]));
  });

  const manualTotal = Object.keys(manualAssignments || {}).length;

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
              onClick={() => zoomTo(view.scale - 0.1)}
              className="grid h-7 w-7 place-items-center rounded-lg text-content-muted hover:bg-surface-tertiary hover:text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
              aria-label={t('colorBoard.zoomOut')}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-10 text-center text-[10px] tabular-nums text-content-muted">
              {Math.round(view.scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => zoomTo(view.scale + 0.1)}
              className="grid h-7 w-7 place-items-center rounded-lg text-content-muted hover:bg-surface-tertiary hover:text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
              aria-label={t('colorBoard.zoomIn')}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={fitToView}
              className="ml-0.5 grid h-7 w-7 place-items-center rounded-lg text-content-muted hover:bg-surface-tertiary hover:text-content-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
              aria-label={t('colorBoard.fit')}
            >
              <Focus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={viewportRef}
        data-color-board-viewport
        className="absolute inset-0 cursor-default overflow-hidden select-none"
        style={{
          backgroundColor: 'rgb(var(--clr-surface-1))',
          backgroundImage: 'radial-gradient(rgb(var(--clr-text-muted) / 0.2) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerUp}
        onPointerCancel={handleViewportPointerCancel}
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
        ) : (
          <div
            ref={worldRef}
            data-color-board-world
            className="absolute left-0 top-0 origin-top-left"
            style={{
              width: layout.worldWidth,
              height: layout.worldHeight,
              transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
            }}
          >
            <BoardCirclesLayer circles={layout.circles} dropTarget={dropTarget} />

            {layout.freeItems.length > 0 && (
              <div
                data-board-control
                className="absolute flex items-center gap-3"
                style={{ left: layout.freeLeft, top: layout.freeTop - 82 }}
              >
                <span className="pointer-events-none grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-edge-primary bg-surface-secondary/90 text-content-muted shadow-sm backdrop-blur">
                  <MousePointer2 className="h-4 w-4" />
                </span>
                <div className="pointer-events-none shrink-0">
                  <p className="text-xs font-semibold text-content-secondary">{t('colorBoard.free.title')}</p>
                  <p className="mt-0.5 text-[10px] text-content-muted">{t('colorBoard.free.body')}</p>
                </div>
                <label
                  className="ml-2 flex shrink-0 items-center gap-2 rounded-xl border border-edge-primary bg-surface-secondary/90 px-3 py-2 shadow-sm backdrop-blur"
                  title={t('colorBoard.free.rowLimitHint')}
                >
                  <span className="whitespace-nowrap text-[10px] font-medium text-content-secondary">
                    {t('colorBoard.free.rowLimit', { count: freeRowLimit })}
                  </span>
                  <input
                    type="range"
                    min={FREE_ROW_LIMIT_MIN}
                    max={FREE_ROW_LIMIT_MAX}
                    value={freeRowLimit}
                    onChange={(event) => setFreeRowLimit(event.target.value)}
                    aria-label={t('colorBoard.free.rowLimitLabel')}
                    className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-edge-secondary accent-accent"
                  />
                  {layout.freeColumns < freeRowLimit && (
                    <span className="whitespace-nowrap rounded-full bg-surface-tertiary px-1.5 py-0.5 text-[9px] tabular-nums text-content-muted">
                      {t('colorBoard.free.currentColumns', { count: layout.freeColumns })}
                    </span>
                  )}
                </label>
              </div>
            )}

            <BoardCardsLayer
              cards={layout.cards}
              selectedIds={selectedIds}
              draggingIds={draggingIds}
              onPointerDown={handleCardPointerDown}
              onPointerMove={handleCardPointerMove}
              onPointerUp={handleCardPointerUp}
              onPointerCancel={handleCardPointerCancel}
              onMouseEnter={handleCardMouseEnter}
              onMouseMove={handleCardMouseMove}
              onMouseLeave={handleCardMouseLeave}
              onKeyboardSelect={handleKeyboardSelect}
              onElementChange={registerCardElement}
            />

            <div
              ref={selectionRectRef}
              hidden
              className="pointer-events-none absolute z-30 rounded-lg border-2 border-accent bg-accent/10 shadow-[0_0_0_1px_rgb(var(--clr-surface-2)/0.8)]"
            />
          </div>
        )}
      </div>

      {preview && (
        <div
          ref={previewRef}
          className="pointer-events-none fixed z-50 w-64 overflow-hidden rounded-2xl border border-edge-primary bg-surface-secondary/95 p-2 shadow-2xl shadow-overlay/25 backdrop-blur-xl"
          style={{ left: preview.left, top: preview.top }}
        >
          <IllustrationPreviewImage
            illustration={preview.illustration}
            quality={BOARD_PREVIEW_QUALITY}
            height={preview.mediaHeight}
          />
          <div className="flex items-center gap-2 px-1 pb-1 pt-2">
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ${
              preview.membership?.source === 'manual' ? 'bg-accent/15 text-accent' : 'bg-surface-tertiary text-content-muted'
            }`}>
              {preview.membership?.source === 'manual'
                ? <Hand className="h-3 w-3" />
                : preview.membership?.source === 'computed'
                  ? <InferenceIcon className="h-3 w-3" />
                  : <CircleDot className="h-3 w-3" />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-content-primary">{preview.illustration.original_filename}</p>
              <p className="text-[10px] text-content-muted">
                {preview.membership?.source === 'manual'
                  ? t('colorBoard.source.manual')
                  : preview.membership?.source === 'computed'
                    ? t('colorBoard.source.automatic')
                    : t('colorBoard.source.other')}
              </p>
            </div>
          </div>
        </div>
      )}

      {(lastAction || dropTarget || selectedIds.size === 0) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-2xl border border-edge-primary/90 bg-surface-secondary/90 px-3 py-2 shadow-xl shadow-overlay/10 backdrop-blur-xl">
            {lastAction ? (
              <span className="px-2 text-xs font-medium text-accent">{lastAction}</span>
            ) : dropTarget ? (
              <span className="px-2 text-xs font-medium text-accent">
                {dropTarget === 'outside'
                  ? t('colorBoard.drop.clear')
                  : t('colorBoard.drop.group', { group: circleById.get(dropTarget)?.label || '' })}
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

      {selectedIds.size > 0 && !lastAction && !dropTarget && (
        <ColorBoardSelectionDock
          selectedIllustrations={selectedIllustrations}
          quality={BOARD_PREVIEW_QUALITY}
          resolveColorGroupName={resolveColorGroupName}
          onClear={() => setSelectedIds(new Set())}
          onDownload={onDownload}
          onDelete={onDelete}
          onUpdateTags={onUpdateTags}
          tagPanelOpen={tagPanelOpen}
          onTagPanelChange={(open) => {
            setTagPanelOpen(open);
            if (open) clearPreview();
          }}
        />
      )}
    </motion.div>
  );
}
