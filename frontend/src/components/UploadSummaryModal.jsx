import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, SkipForward, RefreshCcw, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';

function Section({ icon: Icon, color, label, count, items }) {
  const [open, setOpen] = useState(false);
  const expandable = items && items.length > 0;
  return (
    <div className="rounded-xl border border-edge-secondary overflow-hidden">
      <button
        onClick={() => expandable && setOpen((v) => !v)}
        disabled={!expandable}
        className={`w-full px-4 py-3 flex items-center justify-between text-left transition-colors ${
          expandable ? 'hover:bg-surface-tertiary cursor-pointer' : 'cursor-default'
        }`}
      >
        <div className="flex items-center gap-3">
          <Icon className={`w-5 h-5 ${color}`} />
          <span className="text-sm font-medium text-content-primary">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${color}`}>{count}</span>
          {expandable && (
            open
              ? <ChevronDown className="w-4 h-4 text-content-tertiary" />
              : <ChevronRight className="w-4 h-4 text-content-tertiary" />
          )}
        </div>
      </button>
      {expandable && open && (
        <ul className="px-4 pb-3 pt-1 space-y-1 max-h-48 overflow-y-auto bg-surface-tertiary/30">
          {items.map((it, i) => (
            <li key={i} className="text-xs text-content-tertiary truncate" title={it.filename}>
              <span className="text-content-muted mr-1.5">·</span>
              {it.filename}
              {it.error ? <span className="ml-2 text-danger/80">— {it.error}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function UploadSummaryModal({ summary, onClose }) {
  const { t } = useLocale();

  const addedCount = summary.added?.length ?? 0;
  const skippedCount = summary.skipped?.length ?? 0;
  const overwrittenCount = summary.overwritten?.length ?? 0;
  const failedCount = summary.failed?.length ?? 0;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-overlay/70 backdrop-blur-sm"
          onClick={onClose}
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: 'spring', duration: 0.3 }}
          className="relative bg-surface-secondary border border-edge-primary rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl"
        >
          <h3 className="text-lg font-semibold text-content-primary mb-1">
            {t('uploadSummary.title')}
          </h3>
          <p className="text-sm text-content-tertiary mb-5">
            {t('uploadSummary.subtitle', {
              total: addedCount + skippedCount + overwrittenCount + failedCount,
            })}
          </p>

          <div className="space-y-2">
            <Section
              icon={CheckCircle2}
              color="text-success"
              label={t('uploadSummary.added')}
              count={addedCount}
              items={null}
            />
            <Section
              icon={SkipForward}
              color="text-content-tertiary"
              label={t('uploadSummary.skipped')}
              count={skippedCount}
              items={summary.skipped}
            />
            <Section
              icon={RefreshCcw}
              color="text-accent"
              label={t('uploadSummary.overwritten')}
              count={overwrittenCount}
              items={summary.overwritten}
            />
            {failedCount > 0 && (
              <Section
                icon={AlertTriangle}
                color="text-danger"
                label={t('uploadSummary.failed')}
                count={failedCount}
                items={summary.failed}
              />
            )}
          </div>

          <div className="flex justify-end mt-6">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm font-medium bg-accent hover:bg-accent-hover text-white shadow-lg shadow-accent/20 hover:shadow-accent/30 transition-all hover:scale-[1.03]"
            >
              {t('uploadSummary.close')}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
