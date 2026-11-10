import { AnimatePresence } from 'framer-motion';
import { ChevronDown, CornerDownLeft, CornerDownRight, Hand } from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';
import { getCardSizeGrid } from '../hooks/useCardSize';
import { toHexColor } from '../utils/groupColors';
import InferenceIcon from './InferenceIcon';

export default function ColorGroup({
  group, collapsed, onToggle, children, cardSize = 3, layout, segment, toggleRef,
}) {
  const { t } = useLocale();
  const name = group.id === 'other' ? t('colorGroup.other') : group.name;
  const fromPrevious = Boolean(segment?.fromPrevious);
  const continuesOnNext = Boolean(segment?.continuesOnNext);
  const omittedCount = group.omittedCount || 0;
  const count = t('colorGroup.count', { count: group.totalCount ?? group.items.length });
  const manualCount = t('colorGroup.manualCount', { count: group.manualCount });
  const automaticCount = t('colorGroup.automaticCount', { count: group.computedCount });
  const title = [
    `${name} ${count}`,
    group.manualCount > 0 && manualCount,
    group.computedCount > 0 && automaticCount,
  ].filter(Boolean).join(' · ');

  return (
    <section
      className={`min-w-0 rounded-xl border ${layout ? 'color-gallery-panel' : 'mb-5 overflow-hidden'}`}
      data-from-previous={fromPrevious || undefined}
      data-continues={continuesOnNext || undefined}
      style={{
        backgroundColor: group.bgColor || group.color,
        borderColor: group.borderColor,
        '--color-gallery-ink': toHexColor(group.borderColor),
        gridColumn: segment ? `span ${segment.span}` : undefined,
      }}
    >
      <button
        type="button"
        ref={toggleRef}
        onClick={onToggle}
        aria-expanded={!collapsed}
        title={title}
        className={`flex min-w-0 w-full items-center text-left select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 ${
          layout ? 'color-gallery-panel-header' : 'gap-3 px-4 py-3 transition-all hover:brightness-110'
        }`}
      >
        {fromPrevious ? (
          <span className="color-gallery-continuation" title={t('colorGroup.gallery.continued')}>
            <CornerDownRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">{t('colorGroup.gallery.continued')}</span>
          </span>
        ) : (
          <>
            <ChevronDown
              aria-hidden="true"
              className={`h-3.5 w-3.5 shrink-0 text-content-tertiary transition-transform motion-reduce:transition-none ${collapsed ? '-rotate-90' : ''}`}
            />
            <span
              aria-hidden="true"
              className={`shrink-0 rounded-full ${layout ? 'color-gallery-swatch' : 'h-3 w-3'}`}
              style={{ backgroundColor: layout ? undefined : group.borderColor }}
            />
          </>
        )}
        <span className={`min-w-0 truncate text-sm font-medium text-content-secondary ${layout ? 'flex-1' : ''}`}>{name}</span>
        {!fromPrevious && <span className="shrink-0 text-xs tabular-nums text-content-tertiary">{count}</span>}
        {!fromPrevious && group.id !== 'other' && (group.manualCount > 0 || group.computedCount > 0) && (
          <span className={`ml-auto flex shrink-0 items-center gap-1.5 text-[10px] text-content-muted ${layout ? 'color-gallery-metadata' : ''}`}>
            {group.manualCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-1 font-medium text-accent">
                <Hand className="h-2.5 w-2.5" />
                {manualCount}
              </span>
            )}
            {group.computedCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-secondary/70 px-2 py-1">
                <InferenceIcon className="h-2.5 w-2.5" />
                {automaticCount}
              </span>
            )}
          </span>
        )}
        {!collapsed && !continuesOnNext && omittedCount > 0 && (
          <span className="color-gallery-omitted" title={t('colorGroup.gallery.omitted', { count: omittedCount })}>
            <span aria-hidden="true">+{omittedCount}</span>
            <span className="sr-only">{t('colorGroup.gallery.omitted', { count: omittedCount })}</span>
          </span>
        )}
        {continuesOnNext && (
          <span className="color-gallery-continuation" title={t('colorGroup.gallery.continues')}>
            <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">{t('colorGroup.gallery.continues')}</span>
          </span>
        )}
      </button>
      {!collapsed && (
        <div className={layout ? 'color-gallery-panel-body' : 'px-4 pb-4'}>
          <div
            className={`grid items-start ${layout === 'double' || segment ? 'color-gallery-card-grid' : `${getCardSizeGrid(cardSize)} gap-4`}`}
            style={segment ? { gridTemplateColumns: `repeat(${segment.span}, minmax(0, 1fr))` } : undefined}
          >
            <AnimatePresence mode="popLayout">
              {children}
            </AnimatePresence>
          </div>
        </div>
      )}
    </section>
  );
}
