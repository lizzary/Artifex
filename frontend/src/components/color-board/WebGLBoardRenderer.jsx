import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Check, CircleDot, Hand } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';
import { CARD_SIZE } from '../../utils/colorBoardLayout';
import InferenceIcon from '../InferenceIcon';
import { BoardCircleLabelsLayer, BoardFreeItemsControl } from './BoardWorldUi';
import WebGLBoardScene from './webglBoardScene';

function sameVisibleCards(left, right) {
  if (left.length !== right.length) return false;
  return left.every((card, index) => (
    card.illustration.id === right[index].illustration.id
    && card.x === right[index].x
    && card.y === right[index].y
    && card.rotation === right[index].rotation
    && card.membership?.source === right[index].membership?.source
    && card.illustration.original_filename === right[index].illustration.original_filename
  ));
}

const WebGLCardBadgesLayer = memo(function WebGLCardBadgesLayer({
  cards,
  selectedIds,
  draggingIds,
  onElementChange,
}) {
  const { t } = useLocale();

  return cards.map((card) => {
    const id = card.illustration.id;
    const membership = card.membership;
    const selected = selectedIds.has(id);
    const dragging = draggingIds.has(id);
    const sourceLabel = membership?.source === 'manual'
      ? t('colorBoard.source.manual')
      : membership?.source === 'computed'
        ? t('colorBoard.source.automatic')
        : t('colorBoard.source.other');
    const SourceIcon = membership?.source === 'manual'
      ? Hand
      : membership?.source === 'computed' ? InferenceIcon : CircleDot;

    return (
      <div
        key={id}
        ref={(element) => onElementChange(id, element)}
        data-webgl-card-badges={id}
        data-dragging={dragging ? 'true' : undefined}
        className="pointer-events-none absolute"
        style={{
          left: card.x,
          top: card.y,
          width: CARD_SIZE,
          height: CARD_SIZE,
          zIndex: dragging ? 20 : 10,
          transform: dragging
            ? `translate3d(var(--board-drag-x, 0px), var(--board-drag-y, 0px), 0) rotate(${card.rotation}deg) scale(1.05)`
            : `rotate(${card.rotation}deg)`,
          filter: dragging ? 'saturate(1.08)' : undefined,
          willChange: dragging ? 'transform' : undefined,
        }}
      >
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
      </div>
    );
  });
});

const WebGLBoardRenderer = forwardRef(function WebGLBoardRenderer({
  layout,
  view,
  selectedIds,
  draggingIds,
  dropTarget,
  freeRowLimit,
  onFreeRowLimitChange,
  onKeyboardSelect,
  onUnavailable,
  theme,
}, ref) {
  const { t } = useLocale();
  const canvasHostRef = useRef(null);
  const worldOverlayRef = useRef(null);
  const sceneRef = useRef(null);
  const badgeElementsRef = useRef(new Map());
  const dragStateRef = useRef({ ids: new Set(), offset: { x: 0, y: 0 } });
  const propsRef = useRef(null);
  const [visibleCards, setVisibleCards] = useState([]);
  const [activeCardId, setActiveCardId] = useState(null);

  propsRef.current = {
    layout, view, selectedIds, draggingIds, dropTarget,
  };

  const publishVisibleCards = useCallback((cards) => {
    setVisibleCards((current) => (sameVisibleCards(current, cards) ? current : cards));
  }, []);

  useEffect(() => {
    if (!canvasHostRef.current) return undefined;
    let active = true;
    const scene = new WebGLBoardScene({
      host: canvasHostRef.current,
      onContextLost: (error) => {
        if (active) onUnavailable(error);
      },
      onVisibleCardsChange: publishVisibleCards,
    });
    sceneRef.current = scene;

    scene.init(propsRef.current)
      .then(() => {
        if (!active || sceneRef.current !== scene) return;
        scene.update(propsRef.current);
        scene.setView(propsRef.current.view);
      })
      .catch((error) => {
        if (active) onUnavailable(error);
      });

    return () => {
      active = false;
      if (sceneRef.current === scene) sceneRef.current = null;
      scene.destroy();
    };
  }, [onUnavailable, publishVisibleCards, theme]);

  useLayoutEffect(() => {
    sceneRef.current?.update({ layout, selectedIds, draggingIds, dropTarget });
  }, [draggingIds, dropTarget, layout, selectedIds]);

  useLayoutEffect(() => {
    if (worldOverlayRef.current) {
      worldOverlayRef.current.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`;
    }
    sceneRef.current?.setView(view);
  }, [view]);

  const updateBadgeDragStyles = useCallback((ids, offset, dragging) => {
    ids.forEach((id) => {
      const element = badgeElementsRef.current.get(id);
      if (!element) return;
      element.style.setProperty('--board-drag-x', `${offset.x}px`);
      element.style.setProperty('--board-drag-y', `${offset.y}px`);
      if (dragging) element.setAttribute('data-dragging', 'true');
      else element.removeAttribute('data-dragging');
    });
  }, []);

  const registerBadgeElement = useCallback((id, element) => {
    if (!element) {
      badgeElementsRef.current.delete(id);
      return;
    }
    badgeElementsRef.current.set(id, element);
    const { ids, offset } = dragStateRef.current;
    if (ids.has(id)) updateBadgeDragStyles([id], offset, true);
  }, [updateBadgeDragStyles]);

  useImperativeHandle(ref, () => ({
    usesPointerHitTesting: true,
    setView(nextView) {
      if (worldOverlayRef.current) {
        worldOverlayRef.current.style.transform = `translate3d(${nextView.x}px, ${nextView.y}px, 0) scale(${nextView.scale})`;
      }
      sceneRef.current?.setView(nextView);
    },
    beginDrag(ids) {
      const idSet = new Set(ids);
      dragStateRef.current = { ids: idSet, offset: { x: 0, y: 0 } };
      updateBadgeDragStyles(ids, { x: 0, y: 0 }, true);
      sceneRef.current?.beginDrag(ids);
    },
    setDragOffset(offset) {
      const { ids } = dragStateRef.current;
      dragStateRef.current = { ids, offset };
      updateBadgeDragStyles(ids, offset, true);
      sceneRef.current?.setDragOffset(offset);
    },
    endDrag() {
      const { ids } = dragStateRef.current;
      updateBadgeDragStyles(ids, { x: 0, y: 0 }, false);
      dragStateRef.current = { ids: new Set(), offset: { x: 0, y: 0 } };
      sceneRef.current?.endDrag();
    },
    drawSelectionRect(rect) {
      sceneRef.current?.drawSelectionRect(rect);
    },
    hideSelectionRect() {
      sceneRef.current?.hideSelectionRect();
    },
    setHoveredCard(id) {
      sceneRef.current?.setHoveredCard(id);
    },
  }), [updateBadgeDragStyles]);

  const focusCard = useCallback((id) => {
    setActiveCardId(id);
    sceneRef.current?.setFocusedCard(id);
  }, []);

  const handleKeyboardFocus = useCallback(() => {
    if (visibleCards.length === 0) return;
    const selected = visibleCards.find((card) => selectedIds.has(card.illustration.id));
    focusCard(selected?.illustration.id ?? visibleCards[0].illustration.id);
  }, [focusCard, selectedIds, visibleCards]);

  const handleKeyboardBlur = useCallback((event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    sceneRef.current?.setFocusedCard(null);
  }, []);

  const handleKeyDown = useCallback((event) => {
    if (visibleCards.length === 0) return;
    const currentIndex = Math.max(
      0,
      visibleCards.findIndex((card) => card.illustration.id === activeCardId),
    );
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = Math.min(visibleCards.length - 1, currentIndex + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = visibleCards.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const id = visibleCards[currentIndex].illustration.id;
      onKeyboardSelect(id, event.ctrlKey || event.metaKey || event.shiftKey);
      return;
    } else return;

    event.preventDefault();
    focusCard(visibleCards[nextIndex].illustration.id);
  }, [activeCardId, focusCard, onKeyboardSelect, visibleCards]);

  const activeCard = visibleCards.find((card) => card.illustration.id === activeCardId) || null;
  const activeSource = activeCard?.membership?.source === 'manual'
    ? t('colorBoard.source.manual')
    : activeCard?.membership?.source === 'computed'
      ? t('colorBoard.source.automatic')
      : t('colorBoard.source.other');
  const activeOptionId = activeCard ? `color-board-webgl-option-${activeCard.illustration.id}` : undefined;

  return (
    <div
      data-color-board-world
      data-board-renderer="webgl"
      className="absolute inset-0"
    >
      <div
        ref={canvasHostRef}
        className="absolute inset-0 focus:outline-none"
        role="listbox"
        tabIndex={0}
        aria-label={t('colorBoard.webgl.accessibleLabel')}
        aria-multiselectable="true"
        aria-activedescendant={activeOptionId}
        onFocus={handleKeyboardFocus}
        onBlur={handleKeyboardBlur}
        onKeyDown={handleKeyDown}
      >
        {activeCard && (
          <span
            id={activeOptionId}
            role="option"
            aria-selected={selectedIds.has(activeCard.illustration.id)}
            className="sr-only"
          >
            {`${activeCard.illustration.original_filename} · ${activeSource}`}
          </span>
        )}
      </div>

      <div
        ref={worldOverlayRef}
        className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{
          width: layout.worldWidth,
          height: layout.worldHeight,
          transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
        }}
      >
        <BoardCircleLabelsLayer circles={layout.circles} />
        <BoardFreeItemsControl
          layout={layout}
          freeRowLimit={freeRowLimit}
          onFreeRowLimitChange={onFreeRowLimitChange}
        />
        <WebGLCardBadgesLayer
          cards={visibleCards}
          selectedIds={selectedIds}
          draggingIds={draggingIds}
          onElementChange={registerBadgeElement}
        />
      </div>
    </div>
  );
});

export default memo(WebGLBoardRenderer);
