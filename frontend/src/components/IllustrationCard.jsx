import { useState } from 'react';
import { motion } from 'framer-motion';
import { Star, Trash2 } from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';
import { backendUrl } from '../api/url';

export default function IllustrationCard({
  illustration,
  onClick,
  onCtrlClick,
  onShiftClick,
  onSetCover,
  onDelete,
  isSelected = false,
  showHoverActions = true,
  quality = 'low',
  preserveAspectRatio = false,
}) {
  const [imgError, setImgError] = useState(false);
  const { t } = useLocale();
  const sourceWidth = Number(illustration.width);
  const sourceHeight = Number(illustration.height);
  const aspectRatio = sourceWidth > 0 && sourceHeight > 0
    ? `${sourceWidth} / ${sourceHeight}`
    : '1 / 1';

  const handleClick = (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onCtrlClick?.(illustration);
    } else if (e.shiftKey) {
      e.preventDefault();
      onShiftClick?.(illustration);
    } else {
      onClick(illustration);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`group relative overflow-hidden rounded-lg border bg-surface-secondary align-top transition-colors ${
        isSelected ? 'border-accent ring-2 ring-accent/40' : 'border-edge-primary hover:border-accent/40'
      } ${preserveAspectRatio ? 'w-full self-start' : ''}`}
    >
      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-accent flex items-center justify-center shadow-lg">
          <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}

      {/* Thumbnail */}
      <div
        className={`${preserveAspectRatio ? 'illustration-original-ratio' : 'aspect-square'} flex cursor-pointer items-center justify-center overflow-hidden bg-surface-tertiary`}
        style={preserveAspectRatio ? { '--illustration-aspect-ratio': aspectRatio } : undefined}
        onClick={handleClick}
      >
        {imgError ? (
          <span className="text-content-muted text-xs">{t('illustrationCard.loadFailed')}</span>
        ) : (
          <img
            src={backendUrl(`${illustration.thumbnail_url}?quality=${quality}`)}
            alt={illustration.original_filename}
            onError={() => setImgError(true)}
            className={`h-full w-full transition-transform duration-200 ${
              preserveAspectRatio ? 'object-contain' : 'object-cover'
            } ${
              showHoverActions && !preserveAspectRatio ? 'group-hover:scale-105' : ''
            }`}
          />
        )}
      </div>

      {/* Hover actions */}
      {showHoverActions && (
        <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-overlay/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex justify-center gap-2">
          {onSetCover && (
            <button
              onClick={(e) => { e.stopPropagation(); onSetCover(illustration); }}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-accent/85 hover:bg-accent text-white shadow-lg shadow-accent/20 transition-all hover:scale-105 inline-flex items-center gap-1"
            >
              <Star className="w-3 h-3" />
              {t('illustrationCard.setCover')}
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(illustration); }}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-danger/85 hover:bg-danger text-white shadow-lg shadow-danger/20 transition-all hover:scale-105 inline-flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              {t('illustrationCard.delete')}
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
