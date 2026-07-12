import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Trash2, Pencil, GripVertical } from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';
import { backendUrl } from '../api/url';

export default function GroupCard({ group, onClick, onDelete, onRename, quality = 'low', onReorderRequest }) {
  const { t } = useLocale();
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [dropSide, setDropSide] = useState(null); // 'before' | 'after' | null
  const draggableEnabled = typeof onReorderRequest === 'function';

  const handleDragStart = (e) => {
    if (!draggableEnabled) return;
    setDragging(true);
    e.dataTransfer.setData('text/plain', String(group.id));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDragging(false);
    setDropSide(null);
  };

  const handleDragOver = (e) => {
    if (!draggableEnabled) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setDropSide(e.clientX < rect.left + rect.width / 2 ? 'before' : 'after');
  };

  const handleDragLeave = (e) => {
    if (!ref.current) return;
    if (ref.current.contains(e.relatedTarget)) return;
    setDropSide(null);
  };

  const handleDrop = (e) => {
    if (!draggableEnabled) return;
    e.preventDefault();
    const sourceId = Number(e.dataTransfer.getData('text/plain'));
    const side = dropSide;
    setDropSide(null);
    if (!Number.isFinite(sourceId) || sourceId === group.id || !side) return;
    onReorderRequest(sourceId, group.id, side);
  };

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: dragging ? 0.35 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      draggable={draggableEnabled}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => onClick(group)}
      className="group relative bg-surface-secondary rounded-xl border border-edge-primary overflow-hidden cursor-pointer hover:border-accent/50 hover:shadow-lg hover:shadow-accent/10 transition-all duration-200"
    >
      {/* Drop position indicator */}
      {dropSide === 'before' && (
        <div className="pointer-events-none absolute -left-[10px] top-1 bottom-1 w-1 rounded-full bg-accent shadow-[0_0_8px_rgba(99,102,241,0.6)] z-20" />
      )}
      {dropSide === 'after' && (
        <div className="pointer-events-none absolute -right-[10px] top-1 bottom-1 w-1 rounded-full bg-accent shadow-[0_0_8px_rgba(99,102,241,0.6)] z-20" />
      )}

      {/* Cover image */}
      <div className="aspect-[4/5] bg-surface-tertiary flex items-center justify-center overflow-hidden">
        {group.cover_thumbnail_url ? (
          <img
            src={backendUrl(`${group.cover_thumbnail_url}?quality=${quality}`)}
            alt={group.name}
            draggable={false}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-content-muted">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
            <span className="text-xs">{t('groupCard.noCover')}</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="text-sm font-semibold text-content-primary truncate">{group.name}</h3>
        <p className="text-xs text-content-muted mt-0.5">{t('groupCard.illustrationCount', { count: group.illustration_count })}</p>
      </div>

      {/* Drag handle hint (hover) — visual cue; whole card is the drag source */}
      {draggableEnabled && (
        <div
          className="pointer-events-none absolute top-2 left-2 p-1.5 rounded-lg bg-overlay/60 text-white/80 opacity-0 group-hover:opacity-100 transition-all"
          title={t('groupCard.dragReorder')}
          aria-hidden
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
      )}

      {/* Action buttons */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRename(group);
          }}
          className="p-1.5 rounded-lg bg-overlay/60 text-white/80 hover:text-accent hover:bg-overlay/80 transition-all"
          title={t('groupCard.renameTitle')}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(group);
          }}
          className="p-1.5 rounded-lg bg-overlay/60 text-white/80 hover:text-danger hover:bg-overlay/80 transition-all"
          title={t('groupCard.deleteTitle')}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}
