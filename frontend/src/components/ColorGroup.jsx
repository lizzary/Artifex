import { AnimatePresence } from 'framer-motion';
import { Hand } from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';
import { getCardSizeGrid } from '../hooks/useCardSize';
import InferenceIcon from './InferenceIcon';

export default function ColorGroup({ group, collapsed, onToggle, children, cardSize = 3 }) {
  const { t } = useLocale();
  const gridClass = getCardSizeGrid(cardSize);
  return (
    <div
      className="rounded-xl mb-5 overflow-hidden border"
      style={{ backgroundColor: group.bgColor || group.color, borderColor: group.borderColor }}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:brightness-110 transition-all text-left select-none"
      >
        <span
          className="text-xs text-content-tertiary transition-transform"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
        <span
          className="w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: group.borderColor }}
        />
        <span className="text-sm font-medium text-content-secondary">{group.name === 'Other' ? t('colorGroup.other') : group.name}</span>
        <span className="text-xs text-content-muted">{t('colorGroup.count', { count: group.items.length })}</span>
        {group.id !== 'other' && (group.manualCount > 0 || group.computedCount > 0) && (
          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-content-muted">
            {group.manualCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-1 font-medium text-accent">
                <Hand className="h-2.5 w-2.5" />
                {t('colorGroup.manualCount', { count: group.manualCount })}
              </span>
            )}
            {group.computedCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-secondary/70 px-2 py-1">
                <InferenceIcon className="h-2.5 w-2.5" />
                {t('colorGroup.automaticCount', { count: group.computedCount })}
              </span>
            )}
          </span>
        )}
      </button>
      {!collapsed && (
        <div className="px-4 pb-4">
          <div className={`grid ${gridClass} gap-4`}>
            <AnimatePresence mode="popLayout">
              {children}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
