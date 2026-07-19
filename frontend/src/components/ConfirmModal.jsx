import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';

export default function ConfirmModal({
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  danger = false,
  pending = false,
  pendingText,
}) {
  const { t } = useLocale();
  const confirm = confirmText ?? t('confirmModal.confirm');
  const cancel = cancelText ?? t('confirmModal.cancel');
  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-overlay/70 backdrop-blur-sm"
          onClick={pending ? undefined : onCancel}
        />

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: 'spring', duration: 0.3 }}
          className="relative bg-surface-secondary border border-edge-primary rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl"
        >
          <h3 className="text-lg font-semibold text-content-primary mb-2">{title}</h3>
          <p className="text-sm text-content-tertiary mb-6">{message}</p>

          <div className="flex justify-end gap-3">
            <button
              onClick={onCancel}
              disabled={pending}
              className="px-5 py-2.5 rounded-xl text-sm font-medium bg-surface-tertiary hover:bg-edge-secondary text-content-secondary transition-all disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cancel}
            </button>
            <button
              onClick={onConfirm}
              disabled={pending}
              aria-busy={pending}
              className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white shadow-lg transition-all hover:scale-[1.03] disabled:cursor-wait disabled:opacity-70 disabled:hover:scale-100 ${
                danger
                  ? 'bg-danger hover:bg-danger-hover shadow-danger/20 hover:shadow-danger/30'
                  : 'bg-accent hover:bg-accent-hover shadow-accent/20 hover:shadow-accent/30'
              }`}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {pending ? (pendingText ?? confirm) : confirm}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
