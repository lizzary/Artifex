import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import {
  buildColorBoardLayout,
  CARD_SIZE,
  FREE_CARD_COLUMN_GAP,
  FREE_ROW_LIMIT_DEFAULT,
  FREE_ROW_LIMIT_MAX,
  FREE_ROW_LIMIT_MIN,
  hitTestColorBoardCard,
  MAX_SCALE,
  MIN_SCALE,
  pointInCircle,
  rectFromPoints,
  WORLD_MARGIN,
} from '../../utils/colorBoardLayout';
import { clamp, getAspectFitPreviewHeight } from '../../utils/illustrationPreview';
import {
  FREE_GRID_VIEWPORT_RATIO,
  FREE_ROW_LIMIT_STORAGE_KEY,
  PREVIEW_CHROME_HEIGHT,
  PREVIEW_MEDIA_MAX_HEIGHT,
  PREVIEW_MEDIA_MIN_HEIGHT,
  PREVIEW_MEDIA_WIDTH,
} from './constants';

const INITIAL_VIEW = Object.freeze({ x: 0, y: 0, scale: 0.72 });

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

export default function useColorBoardController({
  illustrations,
  pairs,
  matchOrder,
  manualAssignments,
  onAssign,
  onClose,
  t,
}) {
  const viewportRef = useRef(null);
  const rendererRef = useRef(null);
  const gestureRef = useRef(null);
  const didFitRef = useRef(false);
  const layoutWidthRef = useRef(null);
  const viewRef = useRef({ ...INITIAL_VIEW });
  const viewFrameRef = useRef(null);
  const pendingViewRef = useRef(null);
  const dragFrameRef = useRef(null);
  const pendingDragOffsetRef = useRef(null);
  const previewRef = useRef(null);
  const previewFrameRef = useRef(null);
  const pendingPreviewGeometryRef = useRef(null);

  const [view, setView] = useState(() => ({ ...INITIAL_VIEW }));
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

  previewRef.current = preview;

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

  const applyWorldTransform = useCallback((nextView) => {
    rendererRef.current?.setView?.(nextView);
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

  const applyDragOffset = useCallback((offset) => {
    rendererRef.current?.setDragOffset?.(offset);
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
    rendererRef.current?.endDrag?.();
  }, []);

  const applyPreviewGeometry = useCallback((geometry) => {
    if (!previewRef.current) return;
    const element = document.querySelector('[data-color-board-preview]');
    if (!element) return;
    element.style.left = `${geometry.left}px`;
    element.style.top = `${geometry.top}px`;
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
    previewRef.current = null;
    setPreview(null);
  }, []);

  const clearHover = useCallback(() => {
    rendererRef.current?.setHoveredCard?.(null);
    clearPreview();
  }, [clearPreview]);

  const drawSelectionRect = useCallback((rect) => {
    rendererRef.current?.drawSelectionRect?.(rect);
  }, []);

  const hideSelectionRect = useCallback(() => {
    rendererRef.current?.hideSelectionRect?.();
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
    viewportRef.current?.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointerup', finishAnywhere, true);
    window.addEventListener('pointercancel', cancelAnywhere, true);
    resetDragOffset();
    rendererRef.current?.beginDrag?.(ids);
    setDraggingIds(new Set(ids));
    setDropTarget(null);
    clearHover();
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

  const finishCardGesture = useCallback((event) => {
    const gesture = gestureRef.current;
    gesture?.cleanup?.();
    gestureRef.current = null;
    setDraggingIds(new Set());
    resetDragOffset();
    setDropTarget(null);
    if (viewportRef.current?.hasPointerCapture?.(event.pointerId)) {
      viewportRef.current.releasePointerCapture(event.pointerId);
    }
  }, [resetDragOffset]);

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
    finishCardGesture(event);
  });

  const handleCardPointerCancel = useStableEvent((event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    finishCardGesture(event);
  });

  const handleViewportPointerDown = useStableEvent((event) => {
    if (event.button === 2) {
      event.preventDefault();
      viewportRef.current?.setPointerCapture?.(event.pointerId);
      gestureRef.current = {
        type: 'pan',
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        startView: viewRef.current,
      };
      if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing';
      clearHover();
      return;
    }

    if (event.button !== 0) return;
    const viewportRect = viewportRef.current?.getBoundingClientRect();
    const start = toWorld(event.clientX, event.clientY, viewportRect);
    const targetedId = event.target.closest?.('[data-board-card]')?.dataset?.illustrationId;
    if (
      targetedId == null
      && event.target.closest?.('button, a, input, select, textarea, [data-board-control]')
    ) return;
    const card = targetedId != null
      ? layout.cards.find((candidate) => String(candidate.illustration.id) === targetedId)
      : hitTestColorBoardCard(layout.cards, start);
    if (card) {
      handleCardPointerDown(event, card);
      return;
    }

    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const baseSelection = additive ? new Set(selectedIds) : new Set();
    if (!additive) setSelectedIds((previous) => (previous.size === 0 ? previous : new Set()));
    viewportRef.current?.setPointerCapture?.(event.pointerId);
    gestureRef.current = {
      type: 'marquee', pointerId: event.pointerId, start, baseSelection, viewportRect,
    };
    drawSelectionRect(rectFromPoints(start, start));
    clearHover();
  });

  const updatePointerPreview = useStableEvent((event) => {
    if (event.pointerType === 'touch') return;
    const card = hitTestColorBoardCard(
      layout.cards,
      toWorld(event.clientX, event.clientY),
    );
    const nextId = card?.illustration.id ?? null;
    rendererRef.current?.setHoveredCard?.(nextId);
    if (!card) {
      clearPreview();
      return;
    }
    const geometry = previewGeometry(card.illustration, event.clientX, event.clientY);
    if (previewRef.current?.illustration.id === nextId) {
      queuePreviewGeometry(geometry);
      return;
    }
    setPreview({
      illustration: card.illustration,
      membership: card.membership,
      ...geometry,
    });
  });

  const handleViewportPointerMove = useStableEvent((event) => {
    const gesture = gestureRef.current;
    if (!gesture) {
      if (rendererRef.current?.usesPointerHitTesting) updatePointerPreview(event);
      return;
    }
    if (gesture.pointerId !== event.pointerId) return;
    if (gesture.type === 'cards') {
      handleCardPointerMove(event);
      return;
    }
    if (gesture.type === 'pan') {
      queueViewTransform({
        ...gesture.startView,
        x: gesture.startView.x + event.clientX - gesture.startClient.x,
        y: gesture.startView.y + event.clientY - gesture.startClient.y,
      });
      return;
    }
    if (gesture.type !== 'marquee') return;
    queueMarqueeSelection(gesture, toWorld(event.clientX, event.clientY, gesture.viewportRect));
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
    gestureRef.current = null;
    if (viewportRef.current?.hasPointerCapture?.(event.pointerId)) {
      viewportRef.current.releasePointerCapture(event.pointerId);
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
    if (viewportRef.current?.hasPointerCapture?.(event.pointerId)) {
      viewportRef.current.releasePointerCapture(event.pointerId);
    }
  });

  const handleCardMouseEnter = useStableEvent((event, card) => {
    if (gestureRef.current) return;
    rendererRef.current?.setHoveredCard?.(card.illustration.id);
    setPreview({
      illustration: card.illustration,
      membership: card.membership,
      ...previewGeometry(card.illustration, event.clientX, event.clientY),
    });
  });

  const handleCardMouseMove = useStableEvent((event, card) => {
    if (gestureRef.current) return;
    queuePreviewGeometry(previewGeometry(card.illustration, event.clientX, event.clientY));
  });

  const handleCardMouseLeave = useStableEvent((illustrationId) => {
    rendererRef.current?.setHoveredCard?.(null);
    cancelFrame(previewFrameRef.current);
    previewFrameRef.current = null;
    pendingPreviewGeometryRef.current = null;
    setPreview((current) => (current?.illustration.id === illustrationId ? null : current));
  });

  const handleKeyboardSelect = useStableEvent((illustrationId, additive = false) => {
    setSelectedIds((previous) => {
      if (!additive) return new Set([illustrationId]);
      const next = new Set(previous);
      if (next.has(illustrationId)) next.delete(illustrationId);
      else next.add(illustrationId);
      return next;
    });
  });

  return {
    circleById,
    clearPreview,
    clearSelection: () => setSelectedIds(new Set()),
    draggingIds,
    dropTarget,
    fitToView,
    freeRowLimit,
    handleCardMouseEnter,
    handleCardMouseLeave,
    handleCardMouseMove,
    handleKeyboardSelect,
    handleViewportPointerCancel,
    handleViewportPointerDown,
    handleViewportPointerLeave: clearHover,
    handleViewportPointerMove,
    handleViewportPointerUp,
    lastAction,
    layout,
    preview,
    rendererRef,
    selectedIds,
    setFreeRowLimit,
    setLastAction,
    setTagPanelOpen,
    tagPanelOpen,
    view,
    viewportRef,
    zoomTo,
  };
}
