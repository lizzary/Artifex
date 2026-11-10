import { useId, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Columns2, Images, LayoutTemplate, ListFilter, Minus, Plus, Rows3,
} from 'lucide-react';
import { getCardSizeGrid } from '../hooks/useCardSize';
import {
  COLOR_GROUP_PREVIEW_MAX, COLOR_GROUP_PREVIEW_MIN, packColorGroups,
} from '../utils/colorGroupGallery';
import { useLocale } from '../contexts/LocaleContext';
import ColorGroup from './ColorGroup';
import './ColorGroupGallery.css';

const LAYOUT_OPTIONS = [
  { value: 'single', icon: Rows3 },
  { value: 'double', icon: Columns2 },
  { value: 'mixed', icon: LayoutTemplate },
];

const PREVIEW_OPTIONS = [
  { value: 'all', icon: Images },
  { value: 'limited', icon: ListFilter },
];

function GalleryChoice({ name, options, value, onChange }) {
  const { t } = useLocale();
  const indicatorId = useId();
  const reduceMotion = useReducedMotion();
  return (
    <div role="group" aria-label={t(`colorGroup.gallery.${name}`)} className="color-gallery-choice">
      {options.map(({ value: option, icon: Icon }) => (
        <button
          type="button"
          key={option}
          aria-pressed={option === value}
          className="color-gallery-choice-button"
          onClick={() => option !== value && onChange(option)}
        >
          {option === value && (
            <motion.span
              aria-hidden="true"
              className="color-gallery-choice-indicator"
              layoutId={reduceMotion ? undefined : indicatorId}
              transition={{ type: 'spring', stiffness: 480, damping: 38 }}
            />
          )}
          <Icon aria-hidden="true" className="relative h-3.5 w-3.5" />
          <span className="relative whitespace-nowrap">{t(`colorGroup.gallery.${option}`)}</span>
        </button>
      ))}
    </div>
  );
}

function clampLimit(value) {
  return Math.max(COLOR_GROUP_PREVIEW_MIN, Math.min(COLOR_GROUP_PREVIEW_MAX, value));
}

function PreviewLimit({ value, onChange }) {
  const [draft, setDraft] = useState(null);
  const { t } = useLocale();
  const current = draft ? clampLimit(Number(draft)) : value;

  const commit = (next) => {
    setDraft(null);
    if (next !== value) onChange(next);
  };

  return (
    <div className="color-gallery-limit" role="group" aria-label={t('colorGroup.gallery.limit')}>
      <button
        type="button"
        aria-label={t('colorGroup.gallery.decrease')}
        disabled={current <= COLOR_GROUP_PREVIEW_MIN}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => commit(clampLimit(current - 1))}
      >
        <Minus className="h-3 w-3" aria-hidden="true" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={t('colorGroup.gallery.limit')}
        title={t('colorGroup.gallery.limit')}
        value={draft ?? value}
        onFocus={(event) => event.target.select()}
        onChange={(event) => {
          if (/^\d{0,4}$/.test(event.target.value)) setDraft(event.target.value);
        }}
        onBlur={() => commit(current)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') setDraft(null);
        }}
      />
      <button
        type="button"
        aria-label={t('colorGroup.gallery.increase')}
        disabled={current >= COLOR_GROUP_PREVIEW_MAX}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => commit(clampLimit(current + 1))}
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ColorGroupGalleryControls({
  layout, onLayoutChange, previewMode, onPreviewModeChange, previewLimit, onPreviewLimitChange,
}) {
  const { t } = useLocale();
  return (
    <div className="color-gallery-controls">
      <div className="color-gallery-controls-cluster">
        <span className="color-gallery-controls-label">{t('colorGroup.gallery.layout')}</span>
        <GalleryChoice name="layout" options={LAYOUT_OPTIONS} value={layout} onChange={onLayoutChange} />
      </div>
      <div className="color-gallery-controls-cluster">
        <span className="color-gallery-controls-label">{t('colorGroup.gallery.preview')}</span>
        <GalleryChoice
          name="preview"
          options={PREVIEW_OPTIONS}
          value={previewMode}
          onChange={onPreviewModeChange}
        />
        {previewMode === 'limited' && <PreviewLimit value={previewLimit} onChange={onPreviewLimitChange} />}
      </div>
    </div>
  );
}

export default function ColorGroupGallery({
  groups, layout, cardSize, collapsedGroups, onToggle, onToggleFull, renderCard,
}) {
  const sizeProbe = useRef(null);
  const firstToggles = useRef(new Map());
  const [sizing, setSizing] = useState(null);
  const grid = getCardSizeGrid(cardSize);

  useLayoutEffect(() => {
    const element = sizeProbe.current;
    const measure = () => {
      // Use the same responsive tracks as the single layout, including its panel inset.
      const { gridTemplateColumns, borderInlineStartWidth } = getComputedStyle(element);
      const tracks = gridTemplateColumns.trim().split(/\s+/);
      const cardWidth = Number.parseFloat(tracks[0]);
      if (!(cardWidth > 0)) return;
      const columns = tracks.length;
      setSizing((current) => current?.cardWidth === cardWidth && current.columns === columns
        && current.borderWidth === borderInlineStartWidth
        ? current
        : { cardWidth, columns, borderWidth: borderInlineStartWidth });
    };
    measure();
    const observer = window.ResizeObserver ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [grid]);

  const columns = sizing?.columns ?? 1;
  const segments = layout === 'mixed'
    ? (sizing ? packColorGroups(groups, collapsedGroups, columns) : [])
    : groups.map((group) => ({ group, items: group.items, start: 0 }));

  return (
    <div
      className="color-gallery"
      data-layout={layout}
      data-stacked={layout === 'double' && columns === 1 ? true : undefined}
      style={{
        '--color-gallery-card-width': sizing ? `${sizing.cardWidth}px` : undefined,
        '--color-gallery-rendered-border': sizing?.borderWidth,
        '--color-gallery-columns': columns,
      }}
    >
      <div ref={sizeProbe} className={`color-gallery-size-probe grid gap-4 ${grid}`} aria-hidden="true" />
      {segments.map((segment) => {
        const { group, items, start, fromPrevious } = segment;
        return (
          <ColorGroup
            key={`${group.id}:${start}`}
            group={group}
            collapsed={collapsedGroups.has(group.id)}
            onToggle={() => {
              onToggle(group.id);
              if (fromPrevious) firstToggles.current.get(group.id)?.focus();
            }}
            onToggleFull={onToggleFull && group.omittedCount > 0 && !fromPrevious
              ? () => onToggleFull(group.id)
              : undefined}
            toggleRef={fromPrevious ? undefined : (element) => {
              if (element) firstToggles.current.set(group.id, element);
              else firstToggles.current.delete(group.id);
            }}
            cardSize={cardSize}
            layout={layout}
            segment={layout === 'mixed' ? segment : undefined}
          >
            {collapsedGroups.has(group.id) ? null : items.map(renderCard)}
          </ColorGroup>
        );
      })}
    </div>
  );
}
