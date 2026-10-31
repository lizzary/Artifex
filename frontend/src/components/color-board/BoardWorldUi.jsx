import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { Hand, MousePointer2 } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';
import InferenceIcon from '../InferenceIcon';
import {
  FREE_ROW_LIMIT_MAX,
  FREE_ROW_LIMIT_MIN,
} from '../../utils/colorBoardLayout';

export function BoardCircleLabel({ circle, onRenameGroup }) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const inputRef = useRef(null);
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editing) return undefined;
    inputRef.current?.select();
    const handleOutsidePointerDown = (event) => {
      if (event.target !== inputRef.current) inputRef.current?.blur();
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
  }, [editing]);

  const finishEditing = () => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setEditing(false);
    const name = draftName.trim();
    if (name !== circle.label) onRenameGroup(circle.id, name);
  };

  return (
    <div
      data-board-control
      className="pointer-events-auto absolute left-1/2 top-7 z-30 -translate-x-1/2 whitespace-nowrap rounded-2xl border bg-surface-secondary/92 px-4 py-2.5 shadow-lg shadow-overlay/10 backdrop-blur-xl"
      style={{ borderColor: circle.borderColor }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: circle.borderColor }} />
        {editing ? (
          <input
            ref={inputRef}
            autoFocus
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={finishEditing}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                editingRef.current = false;
                setEditing(false);
              }
            }}
            aria-label={t('colorBoard.groupName')}
            className="w-52 rounded-md border border-accent bg-surface-primary px-1.5 text-center text-sm font-semibold text-content-primary outline-none focus:ring-2 focus:ring-accent/30"
          />
        ) : (
          <button
            type="button"
            title={t('colorBoard.renameGroup')}
            disabled={!onRenameGroup}
            onClick={() => {
              setDraftName(circle.label);
              editingRef.current = true;
              setEditing(true);
            }}
            className="max-w-[240px] truncate rounded-md text-sm font-semibold text-content-primary outline-none hover:text-accent focus:ring-2 focus:ring-accent/40"
          >
            {circle.label}
          </button>
        )}
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
  );
}

export function BoardCircleLabelsLayer({ circles, onRenameGroup }) {
  return circles.map((circle) => (
    <div
      key={circle.id}
      className="pointer-events-none absolute rounded-full"
      style={{
        left: circle.x - circle.radius,
        top: circle.y - circle.radius,
        width: circle.radius * 2,
        height: circle.radius * 2,
      }}
    >
      <BoardCircleLabel circle={circle} onRenameGroup={onRenameGroup} />
    </div>
  ));
}

export function BoardFreeItemsControl({
  layout,
  freeRowLimit,
  onFreeRowLimitChange,
}) {
  const { t } = useLocale();
  const [draftRowLimit, setDraftRowLimit] = useState(freeRowLimit);
  const draftRowLimitRef = useRef(freeRowLimit);
  const committedRowLimitRef = useRef(freeRowLimit);
  const interactingRef = useRef(false);

  useEffect(() => {
    committedRowLimitRef.current = freeRowLimit;
    if (interactingRef.current) return;
    draftRowLimitRef.current = freeRowLimit;
    setDraftRowLimit(freeRowLimit);
  }, [freeRowLimit]);

  const updateDraft = useCallback((value) => {
    const nextValue = Number(value);
    interactingRef.current = true;
    draftRowLimitRef.current = nextValue;
    setDraftRowLimit(nextValue);
  }, []);

  const commitDraft = useCallback((nextValue) => {
    interactingRef.current = false;
    if (nextValue === committedRowLimitRef.current) return;
    committedRowLimitRef.current = nextValue;
    onFreeRowLimitChange(nextValue);
  }, [onFreeRowLimitChange]);

  const commitFromControl = useCallback((event) => {
    const nextValue = Number(event.currentTarget.value);
    draftRowLimitRef.current = nextValue;
    setDraftRowLimit(nextValue);
    commitDraft(nextValue);
  }, [commitDraft]);

  const cancelDraft = useCallback(() => {
    interactingRef.current = false;
    draftRowLimitRef.current = committedRowLimitRef.current;
    setDraftRowLimit(committedRowLimitRef.current);
  }, []);

  if (layout.freeItems.length === 0) return null;

  return (
    <div
      data-board-control
      className="pointer-events-auto absolute flex items-center gap-3"
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
          {t('colorBoard.free.rowLimit', { count: draftRowLimit })}
        </span>
        <input
          type="range"
          min={FREE_ROW_LIMIT_MIN}
          max={FREE_ROW_LIMIT_MAX}
          step={1}
          value={draftRowLimit}
          onChange={(event) => updateDraft(event.target.value)}
          onPointerDown={() => { interactingRef.current = true; }}
          onPointerUp={commitFromControl}
          onPointerCancel={cancelDraft}
          onKeyUp={commitFromControl}
          onBlur={commitFromControl}
          aria-label={t('colorBoard.free.rowLimitLabel')}
          className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-edge-secondary accent-accent"
        />
      </label>
    </div>
  );
}
