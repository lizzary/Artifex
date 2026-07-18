import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { motion } from 'framer-motion';
import {
  Check, CircleDot, Focus, Hand, Layers3, Minus, MousePointer2, Move, Palette,
  Plus, Settings2, X,
} from 'lucide-react';
import { backendUrl } from '../api/url';
import { useLocale } from '../contexts/LocaleContext';
import { getIllustrationMemberships, groupDisplayName } from '../utils/grouping';
import InferenceIcon from './InferenceIcon';

const CARD_SIZE = 78;
const CIRCLE_GAP = 150;
const WORLD_MARGIN = 180;
const MIN_SCALE = 0.24;
const MAX_SCALE = 1.25;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function circleRadius(itemCount) {
  return clamp(230 + Math.sqrt(Math.max(itemCount, 1)) * 48, 258, 700);
}

function pointInCircle(point, circle) {
  return Math.hypot(point.x - circle.x, point.y - circle.y) <= circle.radius;
}

function rectFromPoints(start, end) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
}

export function buildColorBoardLayout(
  illustrations,
  pairs,
  matchOrder,
  manualAssignments,
  untitledLabel,
) {
  const memberships = getIllustrationMemberships(
    illustrations,
    pairs,
    matchOrder,
    manualAssignments,
  );
  const itemsByGroup = new Map(pairs.map((pair) => [pair.id, []]));
  const freeItems = [];

  illustrations.forEach((illustration) => {
    const membership = memberships.get(illustration.id);
    const target = itemsByGroup.get(membership?.effectiveGroupId);
    if (target) target.push(illustration);
    else freeItems.push(illustration);
  });

  const rawCircles = pairs.map((pair, index) => {
    const items = itemsByGroup.get(pair.id) || [];
    const manualCount = items.filter((item) => memberships.get(item.id)?.source === 'manual').length;
    return {
      ...pair,
      index,
      items,
      manualCount,
      computedCount: items.length - manualCount,
      label: groupDisplayName(pair) || untitledLabel(index + 1),
      radius: circleRadius(items.length),
    };
  });

  const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(Math.max(rawCircles.length, 1)))));
  const circles = [];
  let cursorY = WORLD_MARGIN;
  let widestRow = 0;

  for (let rowStart = 0; rowStart < rawCircles.length; rowStart += columns) {
    const row = rawCircles.slice(rowStart, rowStart + columns);
    const rowRadius = Math.max(...row.map((circle) => circle.radius));
    const rowCenterY = cursorY + rowRadius;
    let cursorX = WORLD_MARGIN;
    row.forEach((circle) => {
      circles.push({
        ...circle,
        x: cursorX + circle.radius,
        y: rowCenterY,
      });
      cursorX += circle.radius * 2 + CIRCLE_GAP;
    });
    widestRow = Math.max(widestRow, cursorX - CIRCLE_GAP + WORLD_MARGIN);
    cursorY += rowRadius * 2 + CIRCLE_GAP;
  }

  const cards = [];
  circles.forEach((circle) => {
    const usableRadius = Math.max(90, circle.radius - 112);
    const count = circle.items.length;
    circle.items.forEach((illustration, index) => {
      const angle = index * 2.3999632297 + circle.index * 0.57;
      const distance = count <= 1 ? 0 : Math.sqrt((index + 0.35) / count) * usableRadius;
      cards.push({
        illustration,
        membership: memberships.get(illustration.id),
        x: circle.x + Math.cos(angle) * distance - CARD_SIZE / 2,
        y: circle.y + Math.sin(angle) * distance - CARD_SIZE / 2,
        rotation: ((Number(illustration.id) || index) % 7) - 3,
      });
    });
  });

  const circleBottom = circles.length
    ? Math.max(...circles.map((circle) => circle.y + circle.radius))
    : WORLD_MARGIN + 240;
  const minimumWorldWidth = Math.max(widestRow, 1500);
  const freeTop = circleBottom + 210;
  const freeColumns = Math.max(6, Math.floor((minimumWorldWidth - WORLD_MARGIN * 2) / (CARD_SIZE + 26)));
  freeItems.forEach((illustration, index) => {
    cards.push({
      illustration,
      membership: memberships.get(illustration.id),
      x: WORLD_MARGIN + (index % freeColumns) * (CARD_SIZE + 26),
      y: freeTop + Math.floor(index / freeColumns) * (CARD_SIZE + 28),
      rotation: ((Number(illustration.id) || index) % 7) - 3,
    });
  });

  const freeRows = Math.ceil(freeItems.length / freeColumns);
  const worldHeight = Math.max(
    circleBottom + 360,
    freeTop + Math.max(1, freeRows) * (CARD_SIZE + 28) + WORLD_MARGIN,
  );

  return {
    cards,
    circles,
    freeItems,
    freeTop,
    memberships,
    worldWidth: minimumWorldWidth,
    worldHeight,
  };
}

export default function ColorGroupBoard({
  groupName,
  illustrations,
  pairs,
  matchOrder,
  manualAssignments,
  quality,
  onAssign,
  onConfigure,
  onClose,
}) {
  const { t } = useLocale();
  const viewportRef = useRef(null);
  const gestureRef = useRef(null);
  const didFitRef = useRef(false);
  const [view, setView] = useState({ x: 0, y: 0, scale: 0.72 });
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [draggingIds, setDraggingIds] = useState(new Set());
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [selectionRect, setSelectionRect] = useState(null);
  const [preview, setPreview] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [lastAction, setLastAction] = useState('');

  const layout = useMemo(() => buildColorBoardLayout(
    illustrations,
    pairs,
    matchOrder,
    manualAssignments,
    (index) => t('colorBoard.untitledGroup', { n: index }),
  ), [illustrations, pairs, matchOrder, manualAssignments, t]);

  const circleById = useMemo(
    () => new Map(layout.circles.map((circle) => [circle.id, circle])),
    [layout.circles],
  );

  const toWorld = useCallback((clientX, clientY) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - view.x) / view.scale,
      y: (clientY - rect.top - view.y) / view.scale,
    };
  }, [view]);

  const fitToView = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scale = clamp(
      Math.min((rect.width - 120) / layout.worldWidth, (rect.height - 120) / layout.worldHeight),
      MIN_SCALE,
      1,
    );
    setView({
      scale,
      x: (rect.width - layout.worldWidth * scale) / 2,
      y: (rect.height - layout.worldHeight * scale) / 2,
    });
  }, [layout.worldHeight, layout.worldWidth]);

  const focusInitialView = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scale = rect.width < 900 ? 0.58 : 0.72;
    setView({
      scale,
      x: (rect.width - layout.worldWidth * scale) / 2,
      y: 96 - WORLD_MARGIN * scale,
    });
  }, [layout.worldWidth]);

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
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => () => gestureRef.current?.cleanup?.(), []);

  useEffect(() => {
    setSelectedIds((previous) => {
      const availableIds = new Set(illustrations.map((illustration) => illustration.id));
      return new Set([...previous].filter((id) => availableIds.has(id)));
    });
  }, [illustrations]);

  useEffect(() => {
    if (!lastAction) return undefined;
    const timeout = window.setTimeout(() => setLastAction(''), 2600);
    return () => window.clearTimeout(timeout);
  }, [lastAction]);

  const zoomTo = useCallback((nextScale) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    setView((previous) => {
      const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      const center = { x: rect.width / 2, y: rect.height / 2 };
      const worldCenter = {
        x: (center.x - previous.x) / previous.scale,
        y: (center.y - previous.y) / previous.scale,
      };
      return {
        scale,
        x: center.x - worldCenter.x * scale,
        y: center.y - worldCenter.y * scale,
      };
    });
  }, []);

  const handleViewportPointerDown = (event) => {
    if (event.button === 2) {
      event.preventDefault();
      viewportRef.current?.setPointerCapture(event.pointerId);
      gestureRef.current = {
        type: 'pan',
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        startView: view,
      };
      setPreview(null);
      return;
    }

    if (
      event.button !== 0
      || event.target.closest?.('[data-board-card], button, a, input, select, textarea, [data-board-control]')
    ) return;
    const start = toWorld(event.clientX, event.clientY);
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const baseSelection = additive ? new Set(selectedIds) : new Set();
    if (!additive) setSelectedIds(new Set());
    viewportRef.current?.setPointerCapture(event.pointerId);
    gestureRef.current = {
      type: 'marquee', pointerId: event.pointerId, start, baseSelection,
    };
    setSelectionRect({ ...rectFromPoints(start, start), width: 0, height: 0 });
    setPreview(null);
  };

  const handleViewportPointerMove = (event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.type === 'pan') {
      setView({
        ...gesture.startView,
        x: gesture.startView.x + event.clientX - gesture.startClient.x,
        y: gesture.startView.y + event.clientY - gesture.startClient.y,
      });
      return;
    }
    if (gesture.type !== 'marquee') return;

    const current = toWorld(event.clientX, event.clientY);
    const rect = rectFromPoints(gesture.start, current);
    const hits = layout.cards.filter((card) => {
      const centerX = card.x + CARD_SIZE / 2;
      const centerY = card.y + CARD_SIZE / 2;
      return centerX >= rect.left && centerX <= rect.right && centerY >= rect.top && centerY <= rect.bottom;
    }).map((card) => card.illustration.id);
    setSelectionRect({
      ...rect,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
    });
    setSelectedIds(new Set([...gesture.baseSelection, ...hits]));
  };

  const handleViewportPointerUp = (event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.type === 'cards') {
      handleCardPointerUp(event);
      return;
    }
    if (gesture.type === 'pan' || gesture.type === 'marquee') {
      gestureRef.current = null;
      setSelectionRect(null);
      if (viewportRef.current?.hasPointerCapture(event.pointerId)) {
        viewportRef.current.releasePointerCapture(event.pointerId);
      }
    }
  };

  const handleViewportPointerCancel = (event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.type === 'cards') {
      handleCardPointerCancel(event);
      return;
    }
    gestureRef.current = null;
    setSelectionRect(null);
    if (viewportRef.current?.hasPointerCapture(event.pointerId)) {
      viewportRef.current.releasePointerCapture(event.pointerId);
    }
  };

  const handleCardPointerDown = (event, card) => {
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
      dragged: false,
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
    window.addEventListener('pointerup', finishAnywhere, true);
    window.addEventListener('pointercancel', cancelAnywhere, true);
    setDraggingIds(new Set(ids));
    setDragOffset({ x: 0, y: 0 });
    setDropTarget(null);
    setPreview(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCardPointerMove = (event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.type !== 'cards' || gesture.pointerId !== event.pointerId) return;
    const dx = (event.clientX - gesture.startClient.x) / view.scale;
    const dy = (event.clientY - gesture.startClient.y) / view.scale;
    if (!gesture.dragged && Math.hypot(dx, dy) < 5) return;
    gesture.dragged = true;
    setDragOffset({ x: dx, y: dy });
    const worldPoint = toWorld(event.clientX, event.clientY);
    const target = layout.circles.find((circle) => pointInCircle(worldPoint, circle));
    gesture.hasDropTarget = true;
    gesture.dropTargetId = target?.id || null;
    setDropTarget(target?.id || 'outside');
  };

  const handleCardPointerUp = (event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.type !== 'cards' || gesture.pointerId !== event.pointerId) return;
    if (gesture.dragged && gesture.ids.length > 0) {
      const pointerTarget = gesture.hasDropTarget
        ? null
        : layout.circles.find((circle) => pointInCircle(toWorld(event.clientX, event.clientY), circle));
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
    setDragOffset({ x: 0, y: 0 });
    setDropTarget(null);
    if (event.currentTarget?.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleCardPointerCancel = (event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.cleanup?.();
    gestureRef.current = null;
    setDraggingIds(new Set());
    setDragOffset({ x: 0, y: 0 });
    setDropTarget(null);
  };

  const manualTotal = Object.keys(manualAssignments || {}).length;
  const previewLeft = preview
    ? Math.min(preview.clientX + 18, Math.max(12, window.innerWidth - 286))
    : 0;
  const previewTop = preview
    ? Math.min(preview.clientY + 18, Math.max(12, window.innerHeight - 326))
    : 0;

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
        className={`absolute inset-0 overflow-hidden select-none ${gestureRef.current?.type === 'pan' ? 'cursor-grabbing' : 'cursor-default'}`}
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
            className="absolute left-0 top-0 origin-top-left"
            style={{
              width: layout.worldWidth,
              height: layout.worldHeight,
              transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
            }}
          >
            {layout.circles.map((circle) => {
              const isTarget = dropTarget === circle.id;
              return (
                <div
                  key={circle.id}
                  className="pointer-events-none absolute rounded-full border-2 transition-[box-shadow,filter] duration-150"
                  style={{
                    left: circle.x - circle.radius,
                    top: circle.y - circle.radius,
                    width: circle.radius * 2,
                    height: circle.radius * 2,
                    backgroundColor: circle.color,
                    borderColor: circle.borderColor,
                    boxShadow: isTarget
                      ? `0 0 0 10px ${circle.color}, 0 30px 80px rgb(var(--clr-overlay) / 0.18)`
                      : '0 24px 70px rgb(var(--clr-overlay) / 0.08)',
                    filter: isTarget ? 'saturate(1.2)' : undefined,
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
            })}

            {layout.freeItems.length > 0 && (
              <div
                className="pointer-events-none absolute flex items-center gap-3"
                style={{ left: WORLD_MARGIN, top: layout.freeTop - 76 }}
              >
                <span className="grid h-10 w-10 place-items-center rounded-2xl border border-edge-primary bg-surface-secondary/90 text-content-muted shadow-sm backdrop-blur">
                  <MousePointer2 className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-content-secondary">{t('colorBoard.free.title')}</p>
                  <p className="mt-0.5 text-[10px] text-content-muted">{t('colorBoard.free.body')}</p>
                </div>
              </div>
            )}

            {layout.cards.map((card) => {
              const id = card.illustration.id;
              const selected = selectedIds.has(id);
              const dragging = draggingIds.has(id);
              const membership = card.membership;
              const sourceLabel = membership?.source === 'manual'
                ? t('colorBoard.source.manual')
                : membership?.source === 'computed'
                  ? t('colorBoard.source.automatic')
                  : t('colorBoard.source.other');
              const SourceIcon = membership?.source === 'manual'
                ? Hand
                : membership?.source === 'computed' ? InferenceIcon : CircleDot;
              return (
                <button
                  type="button"
                  key={id}
                  data-board-card
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
                      ? `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0) rotate(${card.rotation}deg) scale(1.05)`
                      : `rotate(${card.rotation}deg)`,
                    filter: dragging ? 'saturate(1.08)' : undefined,
                  }}
                  onPointerDown={(event) => handleCardPointerDown(event, card)}
                  onPointerMove={handleCardPointerMove}
                  onPointerUp={handleCardPointerUp}
                  onPointerCancel={handleCardPointerCancel}
                  onMouseEnter={(event) => {
                    if (!gestureRef.current) setPreview({ illustration: card.illustration, membership, clientX: event.clientX, clientY: event.clientY });
                  }}
                  onMouseMove={(event) => {
                    if (!gestureRef.current) setPreview({ illustration: card.illustration, membership, clientX: event.clientX, clientY: event.clientY });
                  }}
                  onMouseLeave={() => setPreview((current) => (current?.illustration.id === id ? null : current))}
                  onClick={(event) => {
                    if (event.detail !== 0) return;
                    setSelectedIds(new Set([id]));
                  }}
                >
                  <img
                    src={backendUrl(`${card.illustration.thumbnail_url}?quality=${quality}`)}
                    alt=""
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
            })}

            {selectionRect && (
              <div
                className="pointer-events-none absolute z-30 rounded-lg border-2 border-accent bg-accent/10 shadow-[0_0_0_1px_rgb(var(--clr-surface-2)/0.8)]"
                style={{
                  left: selectionRect.left,
                  top: selectionRect.top,
                  width: selectionRect.width,
                  height: selectionRect.height,
                }}
              />
            )}
          </div>
        )}
      </div>

      {preview && (
        <div
          className="pointer-events-none fixed z-50 w-64 overflow-hidden rounded-2xl border border-edge-primary bg-surface-secondary/95 p-2 shadow-2xl shadow-overlay/25 backdrop-blur-xl"
          style={{ left: previewLeft, top: previewTop }}
        >
          <img
            src={backendUrl(`${preview.illustration.thumbnail_url}?quality=${quality === 'low' ? 'normal' : quality}`)}
            alt={preview.illustration.original_filename}
            className="aspect-[4/3] w-full rounded-xl bg-surface-tertiary object-cover"
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
          ) : selectedIds.size > 0 ? (
            <>
              <span className="rounded-lg bg-accent px-2.5 py-1 text-[10px] font-semibold text-white">
                {t('colorBoard.selected', { count: selectedIds.size })}
              </span>
              <span className="text-[10px] text-content-muted">{t('colorBoard.help.dragSelection')}</span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="rounded-lg px-2 py-1 text-[10px] text-content-muted hover:bg-surface-tertiary hover:text-content-primary"
              >
                {t('colorBoard.clearSelection')}
              </button>
            </>
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
    </motion.div>
  );
}
