import {
  forwardRef, memo, useCallback, useImperativeHandle, useRef,
} from 'react';
import { Check, CircleDot, Hand } from 'lucide-react';
import { backendUrl } from '../../api/url';
import { useLocale } from '../../contexts/LocaleContext';
import { CARD_SIZE } from '../../utils/colorBoardLayout';
import InferenceIcon from '../InferenceIcon';
import { BoardCircleLabel, BoardFreeItemsControl } from './BoardWorldUi';
import { BOARD_CARD_QUALITY } from './constants';

const BoardCirclesLayer = memo(function BoardCirclesLayer({ circles, dropTarget }) {
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
        <BoardCircleLabel circle={circle} />
      </div>
    );
  });
});

const BoardCard = memo(function BoardCard({
  card,
  selected,
  dragging,
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
      data-illustration-id={id}
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
        onMouseEnter={onMouseEnter}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onKeyboardSelect={onKeyboardSelect}
        onElementChange={onElementChange}
      />
    );
  });
});

const DomBoardRenderer = forwardRef(function DomBoardRenderer({
  layout,
  view,
  selectedIds,
  draggingIds,
  dropTarget,
  freeRowLimit,
  onFreeRowLimitChange,
  onCardMouseEnter,
  onCardMouseMove,
  onCardMouseLeave,
  onKeyboardSelect,
}, ref) {
  const worldRef = useRef(null);
  const cardElementsRef = useRef(new Map());
  const draggingElementsRef = useRef([]);
  const selectionRectRef = useRef(null);

  const registerCardElement = useCallback((illustrationId, element) => {
    if (element) cardElementsRef.current.set(illustrationId, element);
    else cardElementsRef.current.delete(illustrationId);
  }, []);

  useImperativeHandle(ref, () => ({
    usesPointerHitTesting: false,
    setView(nextView) {
      if (!worldRef.current) return;
      worldRef.current.style.transform = `translate3d(${nextView.x}px, ${nextView.y}px, 0) scale(${nextView.scale})`;
    },
    beginDrag(ids) {
      draggingElementsRef.current = ids
        .map((id) => cardElementsRef.current.get(id))
        .filter(Boolean);
      draggingElementsRef.current.forEach((element) => {
        element.style.setProperty('--board-drag-x', '0px');
        element.style.setProperty('--board-drag-y', '0px');
        element.setAttribute('data-dragging', 'true');
      });
      if (worldRef.current && draggingElementsRef.current.length > 0) {
        worldRef.current.setAttribute('data-drag-active', 'true');
      }
    },
    setDragOffset({ x, y }) {
      draggingElementsRef.current.forEach((element) => {
        element.style.setProperty('--board-drag-x', `${x}px`);
        element.style.setProperty('--board-drag-y', `${y}px`);
      });
    },
    endDrag() {
      draggingElementsRef.current.forEach((element) => {
        element.style.setProperty('--board-drag-x', '0px');
        element.style.setProperty('--board-drag-y', '0px');
        element.removeAttribute('data-dragging');
      });
      if (worldRef.current) worldRef.current.removeAttribute('data-drag-active');
      draggingElementsRef.current = [];
    },
    drawSelectionRect(rect) {
      if (!selectionRectRef.current) return;
      selectionRectRef.current.hidden = false;
      selectionRectRef.current.style.left = `${rect.left}px`;
      selectionRectRef.current.style.top = `${rect.top}px`;
      selectionRectRef.current.style.width = `${rect.right - rect.left}px`;
      selectionRectRef.current.style.height = `${rect.bottom - rect.top}px`;
    },
    hideSelectionRect() {
      if (selectionRectRef.current) selectionRectRef.current.hidden = true;
    },
    setHoveredCard() {},
  }), []);

  return (
    <div
      ref={worldRef}
      data-color-board-world
      data-board-renderer="dom"
      className="absolute left-0 top-0 origin-top-left"
      style={{
        width: layout.worldWidth,
        height: layout.worldHeight,
        transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
      }}
    >
      <BoardCirclesLayer circles={layout.circles} dropTarget={dropTarget} />
      <BoardFreeItemsControl
        layout={layout}
        freeRowLimit={freeRowLimit}
        onFreeRowLimitChange={onFreeRowLimitChange}
      />
      <BoardCardsLayer
        cards={layout.cards}
        selectedIds={selectedIds}
        draggingIds={draggingIds}
        onMouseEnter={onCardMouseEnter}
        onMouseMove={onCardMouseMove}
        onMouseLeave={onCardMouseLeave}
        onKeyboardSelect={onKeyboardSelect}
        onElementChange={registerCardElement}
      />
      <div
        ref={selectionRectRef}
        hidden
        className="pointer-events-none absolute z-30 rounded-lg border-2 border-accent bg-accent/10 shadow-[0_0_0_1px_rgb(var(--clr-surface-2)/0.8)]"
      />
    </div>
  );
});

export default memo(DomBoardRenderer);
