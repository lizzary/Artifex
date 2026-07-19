import { Hand, MousePointer2 } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';
import InferenceIcon from '../InferenceIcon';
import {
  FREE_ROW_LIMIT_MAX,
  FREE_ROW_LIMIT_MIN,
} from '../../utils/colorBoardLayout';

export function BoardCircleLabel({ circle }) {
  const { t } = useLocale();

  return (
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
  );
}

export function BoardCircleLabelsLayer({ circles }) {
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
      <BoardCircleLabel circle={circle} />
    </div>
  ));
}

export function BoardFreeItemsControl({
  layout,
  freeRowLimit,
  onFreeRowLimitChange,
}) {
  const { t } = useLocale();
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
          {t('colorBoard.free.rowLimit', { count: freeRowLimit })}
        </span>
        <input
          type="range"
          min={FREE_ROW_LIMIT_MIN}
          max={FREE_ROW_LIMIT_MAX}
          value={freeRowLimit}
          onChange={(event) => onFreeRowLimitChange(event.target.value)}
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
  );
}
