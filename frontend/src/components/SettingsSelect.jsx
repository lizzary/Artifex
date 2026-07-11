import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check } from 'lucide-react';

export default function SettingsSelect({
  value,
  onChange,
  options,
  disabled = false,
  minWidth = 180,
  menuMinWidth = minWidth,
  compact = false,
  placement = 'bottom',
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const active = options.find((o) => o.value === value);

  return (
    <div ref={containerRef} className="relative flex-shrink-0">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{ minWidth }}
        className={`group flex items-center rounded-lg border font-medium transition-all focus:outline-none focus:ring-2 focus:ring-accent/40 ${
          compact ? 'gap-1.5 px-2.5 py-1.5 text-[11px]' : 'gap-2 px-3.5 py-2 text-sm'
        } ${
          open
            ? 'bg-surface-tertiary border-accent/50 text-content-primary shadow-sm'
            : 'bg-surface-tertiary border-edge-secondary text-content-primary hover:border-accent/40 hover:bg-edge-secondary/40'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className="flex-1 text-left truncate">{active ? active.label : ''}</span>
        <ChevronDown
          className={`${compact ? 'h-3 w-3' : 'h-4 w-4'} text-content-tertiary group-hover:text-content-secondary transition-transform duration-200 ${
            open ? 'rotate-180 text-accent' : ''
          }`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            initial={{ opacity: 0, y: placement === 'top' ? 6 : -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: placement === 'top' ? 6 : -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{ minWidth: menuMinWidth }}
            className={`absolute right-0 bg-surface-secondary border border-edge-primary rounded-xl shadow-2xl z-50 overflow-hidden py-1 ${
              placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
            }`}
          >
            {options.map((opt) => {
              const selected = opt.value === value;
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  key={String(opt.value)}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition-colors text-left ${
                    selected
                      ? 'bg-accent/10 text-accent font-medium'
                      : 'text-content-secondary hover:bg-surface-tertiary hover:text-content-primary'
                  }`}
                >
                  <span className="w-4 flex justify-center flex-shrink-0">
                    {selected ? <Check className="w-3.5 h-3.5" /> : null}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{opt.label}</div>
                    {opt.description && (
                      <div className={`text-xs mt-0.5 truncate ${selected ? 'text-accent/70' : 'text-content-muted'}`}>
                        {opt.description}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
