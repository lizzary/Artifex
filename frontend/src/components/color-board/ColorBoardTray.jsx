import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight, Check, ChevronDown, Image, Inbox, Loader2, Plus, Undo2,
} from 'lucide-react';
import { backendUrl } from '../../api/url';
import { useLocale } from '../../contexts/LocaleContext';
import { BOARD_CARD_QUALITY } from './constants';
import useTraySweepSelection from './useTraySweepSelection';
import './color-board-tray.css';

const panelTransition = { duration: 0.22, ease: [0.22, 0.65, 0.24, 1] };

function TrayThumbnail({ illustration, className }) {
  return (
    <img
      src={backendUrl(`${illustration.thumbnail_url}?quality=${BOARD_CARD_QUALITY}`)}
      className={className}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}

export default function ColorBoardTray({
  open,
  onOpenChange,
  dropActive,
  illustrations,
  selectedIds,
  boardSelectionSize,
  groups,
  moving,
  drag,
  dragPreviewRef,
  onAddSelection,
  onCardPointerDown,
  onCardSelect,
  onSelectCards,
  onReturnSelection,
  onPlaceSelection,
}) {
  const { t } = useLocale();
  const reducedMotion = useReducedMotion();
  const panelId = useId();
  const headingId = useId();
  const groupInputId = useId();
  const resizeHelpId = useId();
  const toggleRef = useRef(null);
  const frameRef = useRef(null);
  const panelRef = useRef(null);
  const resizeRef = useRef(null);
  const [groupId, setGroupId] = useState('');
  const [size, setSize] = useState(null);
  const [resizing, setResizing] = useState(false);
  const validGroupId = groups.some((group) => group.id === groupId) ? groupId : '';
  const canMove = selectedIds.size > 0 && !moving;
  const { sweeping, sweepHandlers } = useTraySweepSelection(
    open && illustrations.length > 0 && !moving && !drag && !resizing,
    onSelectCards,
  );
  const selectionBusy = moving || Boolean(drag) || sweeping || resizing;

  const finishResize = useCallback(() => {
    const resize = resizeRef.current;
    if (!resize) return;
    resizeRef.current = null;
    if (resize.size) setSize(resize.size);
    if (resize.handle.hasPointerCapture?.(resize.pointerId)) {
      resize.handle.releasePointerCapture(resize.pointerId);
    }
    setResizing(false);
  }, []);

  useEffect(() => {
    if (open) return;
    finishResize();
    if (panelRef.current?.contains(document.activeElement)) toggleRef.current?.focus();
  }, [open, finishResize]);

  useEffect(() => {
    if (!resizing) return undefined;
    function cancelOnEscape(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finishResize();
    }
    window.addEventListener('blur', finishResize);
    window.addEventListener('resize', finishResize);
    window.addEventListener('keydown', cancelOnEscape, true);
    return () => {
      window.removeEventListener('blur', finishResize);
      window.removeEventListener('resize', finishResize);
      window.removeEventListener('keydown', cancelOnEscape, true);
    };
  }, [finishResize, resizing]);

  function resizePanel(width, height) {
    const frame = frameRef.current;
    const panel = panelRef.current;
    const maxWidth = Math.min(840, frame.clientWidth);
    const maxHeight = Math.max(1, frame.clientHeight - panel.offsetTop);
    return {
      width: Math.min(maxWidth, Math.max(Math.min(maxWidth, 276), Math.round(width))),
      height: Math.min(maxHeight, Math.max(Math.min(maxHeight, 176), Math.round(height))),
    };
  }

  function startResize(event) {
    if (event.button !== 0 || sweeping || drag || resizeRef.current) return;
    event.preventDefault();
    const panel = panelRef.current;
    resizeRef.current = {
      handle: event.currentTarget,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: panel.offsetWidth,
      height: panel.offsetHeight,
    };
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setResizing(true);
  }

  function moveResize(event) {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    resize.size = resizePanel(
      resize.width + resize.x - event.clientX,
      resize.height + event.clientY - resize.y,
    );
    // Update the live panel without re-rendering all thumbnail buttons per pointer event.
    const panel = panelRef.current;
    panel.dataset.customSize = '';
    panel.style.setProperty('--tray-width', `${resize.size.width}px`);
    panel.style.setProperty('--tray-height', `${resize.size.height}px`);
  }

  function endResize(event) {
    if (resizeRef.current?.pointerId === event.pointerId) finishResize();
  }

  function resizeWithKeyboard(event) {
    if (sweeping || drag || resizing) return;
    const step = event.shiftKey ? 48 : 16;
    const changes = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowDown: [0, step], ArrowUp: [0, -step] };
    const change = changes[event.key];
    if (!change) return;
    event.preventDefault();
    const panel = panelRef.current;
    setSize(resizePanel(panel.offsetWidth + change[0], panel.offsetHeight + change[1]));
  }

  return (
    <>
      <aside ref={frameRef} className="color-board-tray-frame pointer-events-none absolute inset-x-3 top-[4.85rem] z-30 mx-auto flex min-h-0 max-w-[1500px] flex-col items-end gap-2 sm:inset-x-4 sm:top-[5.25rem]">
        <button
          ref={toggleRef}
          type="button"
          id={headingId}
          data-color-board-tray-drop
          data-drop-active={dropActive || undefined}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => onOpenChange(!open)}
          className={`pointer-events-auto flex h-10 shrink-0 items-center gap-2.5 rounded-[13px] border px-3 text-xs transition-[background-color,border-color,color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none ${
            dropActive
              ? 'border-accent/70 bg-surface-secondary text-accent shadow-[0_0_0_4px_rgb(var(--clr-accent)/0.12)]'
              : 'border-edge-primary bg-surface-secondary/90 text-content-tertiary shadow-sm hover:border-accent/35 hover:text-content-primary'
          }`}
        >
          <Inbox aria-hidden="true" className={`h-4 w-4 ${illustrations.length > 0 ? 'text-accent' : ''}`} strokeWidth={1.65} />
          <span className="font-medium">{t('colorBoard.tray.title')}</span>
          {illustrations.length > 0 && (
            <span
              aria-label={t('colorBoard.tray.count', { count: illustrations.length })}
              className="min-w-[1.25rem] rounded-md bg-accent/10 px-1 py-0.5 text-center text-[10px] font-semibold tabular-nums text-accent"
            >
              {illustrations.length}
            </span>
          )}
          <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.section
              ref={panelRef}
              id={panelId}
              aria-labelledby={headingId}
              aria-busy={moving}
              data-color-board-tray-drop
              data-custom-size={size ? '' : undefined}
              data-resizing={resizing ? '' : undefined}
              onContextMenu={(event) => event.preventDefault()}
              style={size ? { '--tray-width': `${size.width}px`, '--tray-height': `${size.height}px` } : undefined}
              initial={{ opacity: 0, y: reducedMotion ? 0 : -6, scale: reducedMotion ? 1 : 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: reducedMotion ? 0 : -4, scale: reducedMotion ? 1 : 0.99, pointerEvents: 'none' }}
              transition={reducedMotion ? { duration: 0 } : panelTransition}
              className={`color-board-tray-panel pointer-events-auto flex min-h-0 origin-top-right flex-col rounded-[18px] border bg-surface-secondary/95 p-3 shadow-[0_16px_45px_-20px_rgb(var(--clr-overlay)/0.38)] backdrop-blur-xl transition-colors motion-reduce:transition-none ${
                dropActive ? 'border-accent/55' : 'border-edge-primary'
              }`}
            >
              <header className="mb-2 flex shrink-0 items-center justify-between gap-3 px-0.5">
                <p className={`text-[11px] leading-snug ${sweeping ? 'text-accent' : 'text-content-tertiary'}`}>
                  {t(illustrations.length ? 'colorBoard.tray.sweepHint' : 'colorBoard.tray.hint')}
                </p>
                <button
                  type="button"
                  title={t('colorBoard.tray.addSelected')}
                  onClick={onAddSelection}
                  disabled={boardSelectionSize === 0 || selectionBusy}
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-semibold text-accent outline-none transition-colors hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent/35 disabled:opacity-35"
                >
                  <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                  {t('colorBoard.tray.addSelected')}
                </button>
              </header>

              {illustrations.length > 0 && (
                <div className="color-board-tray-toolbar">
                  <span
                    className="color-board-tray-tally"
                    aria-label={t('colorBoard.tray.selected', { count: selectedIds.size })}
                    data-selected={selectedIds.size > 0 ? '' : undefined}
                  >
                    <span>{selectedIds.size}</span>
                    <span aria-hidden="true">/</span>
                    <span>{illustrations.length}</span>
                  </span>
                  <div className="color-board-tray-bulk">
                    <button
                      type="button"
                      disabled={selectionBusy || selectedIds.size === illustrations.length}
                      onClick={() => onSelectCards(illustrations.map(({ id }) => id))}
                    >
                      {t('colorBoard.tray.selectAll')}
                    </button>
                    <button
                      type="button"
                      disabled={selectionBusy || selectedIds.size === 0}
                      onClick={() => onSelectCards([])}
                    >
                      {t('colorBoard.tray.selectNone')}
                    </button>
                  </div>
                </div>
              )}

              <div
                {...sweepHandlers}
                data-sweeping={sweeping ? '' : undefined}
                className={`color-board-tray-scroll artifex-scrollbar artifex-scrollbar-quiet min-h-0 overflow-y-auto overscroll-contain rounded-xl border p-2 transition-colors motion-reduce:transition-none ${
                  dropActive ? 'border-accent/45 bg-accent/5' : 'border-edge-primary bg-surface-primary'
                }`}
              >
                {illustrations.length === 0 ? (
                  <div className="grid min-h-[5.15rem] place-items-center rounded-[9px] border border-dashed border-edge-secondary py-2 text-content-tertiary">
                    <div className="flex flex-col items-center gap-1.5">
                      <Image aria-hidden="true" className="h-5 w-5 text-content-muted" strokeWidth={1.35} />
                      <p className="text-[11px]">{t('colorBoard.tray.empty')}</p>
                    </div>
                  </div>
                ) : (
                  <div className="color-board-tray-grid">
                    {illustrations.map((illustration) => {
                      const id = illustration.id;
                      const selected = selectedIds.has(id);
                      return (
                        <button
                          type="button"
                          key={id}
                          disabled={moving}
                          data-tray-card-id={id}
                          aria-label={illustration.original_filename}
                          title={illustration.original_filename}
                          aria-pressed={selected}
                          onPointerDown={(event) => {
                            if (!sweeping && !resizing) onCardPointerDown(event, id);
                          }}
                          onClick={(event) => {
                            if (event.detail === 0) {
                              onCardSelect(id, event.ctrlKey || event.metaKey || event.shiftKey);
                            }
                          }}
                          className={`relative aspect-square touch-none cursor-grab overflow-hidden rounded-[8px] border bg-surface-secondary p-0.5 outline-none transition-[border-color,box-shadow] active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none ${
                            selected
                              ? 'border-accent/80'
                              : 'border-edge-primary hover:border-accent/50'
                          }`}
                        >
                          <TrayThumbnail illustration={illustration} className="h-full w-full rounded-[5px] object-cover" />
                          {selected && (
                            <span className="absolute right-[3px] top-[3px] grid h-4 w-4 place-items-center rounded-[4px] bg-accent text-white shadow-sm">
                              <Check aria-hidden="true" className="h-3 w-3" strokeWidth={2.5} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <footer className="mt-2.5 flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  className="color-board-tray-resize"
                  title={t('colorBoard.tray.resizeHelp')}
                  aria-label={t('colorBoard.tray.resize')}
                  aria-describedby={resizeHelpId}
                  onPointerDown={startResize}
                  onPointerMove={moveResize}
                  onPointerUp={endResize}
                  onPointerCancel={endResize}
                  onLostPointerCapture={endResize}
                  onKeyDown={resizeWithKeyboard}
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3 10 10 3M3 14 14 3M7 14l7-7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </button>
                <span id={resizeHelpId} className="sr-only">{t('colorBoard.tray.resizeHelp')}</span>
                {illustrations.length > 0 && (
                  <>
                  <button
                    type="button"
                    onClick={onReturnSelection}
                    disabled={!canMove || sweeping || resizing}
                    title={t('colorBoard.tray.return')}
                    aria-label={t('colorBoard.tray.return')}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-edge-primary text-content-tertiary outline-none transition-colors hover:bg-surface-tertiary hover:text-content-primary focus-visible:ring-2 focus-visible:ring-accent/35 disabled:opacity-40"
                  >
                    <Undo2 aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                  <label htmlFor={groupInputId} className="sr-only">{t('colorBoard.tray.chooseGroup')}</label>
                  <select
                    id={groupInputId}
                    value={validGroupId}
                    onChange={(event) => setGroupId(event.target.value)}
                    disabled={!canMove || sweeping || resizing || groups.length === 0}
                    className="h-8 min-w-0 flex-1 truncate rounded-lg border border-edge-primary bg-surface-primary px-2 text-[11px] text-content-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent/35 disabled:opacity-45 dark:[color-scheme:dark]"
                  >
                    <option value="" disabled>{t('colorBoard.tray.chooseGroup')}</option>
                    {groups.map((group) => <option value={group.id} key={group.id}>{group.label}</option>)}
                  </select>
                  <button
                    type="button"
                    disabled={!canMove || sweeping || resizing || !validGroupId}
                    onClick={() => onPlaceSelection(validGroupId)}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-accent/10 px-2 text-[11px] font-semibold text-accent outline-none transition-colors hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-accent/35 disabled:opacity-40"
                  >
                    {t('colorBoard.tray.place')}
                    {moving
                      ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 motion-safe:animate-spin" />
                      : <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />}
                  </button>
                  </>
                )}
              </footer>
            </motion.section>
          )}
        </AnimatePresence>
      </aside>

      {drag?.illustration && (
        <div
          ref={dragPreviewRef}
          aria-hidden="true"
          className="pointer-events-none fixed left-0 top-0 z-50"
          style={{ transform: `translate3d(${drag.x}px, ${drag.y}px, 0)` }}
        >
          <div className="relative ml-2 mt-2 h-16 w-16">
            {drag.count > 1 && (
              <div className="absolute inset-0 translate-x-1 rotate-6 rounded-[11px] border border-accent/35 bg-surface-secondary shadow-sm" />
            )}
            <div className="relative h-full w-full -rotate-3 rounded-[11px] border border-accent/55 bg-surface-secondary p-[3px] shadow-lg shadow-overlay/25">
              <TrayThumbnail illustration={drag.illustration} className="h-full w-full rounded-[7px] object-cover" />
              {drag.count > 1 && (
                <span className="absolute -right-1.5 -top-1.5 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                  {drag.count}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
