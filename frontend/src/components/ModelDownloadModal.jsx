import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Download, X } from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';

export default function ModelDownloadModal({ onDownload, onSkip, onClose }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const { t } = useLocale();

  const handleDownload = async () => {
    setDownloading(true);
    setError('');
    try {
      await onDownload();
    } catch (err) {
      setError(err.message || t('modelDownload.error.downloadFailed'));
      setDownloading(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-overlay/70 backdrop-blur-sm"
          onClick={downloading ? undefined : onClose}
        />

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: 'spring', duration: 0.3 }}
          className="relative bg-surface-secondary border border-edge-primary rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl"
        >
          {error ? (
            <>
              <h3 className="text-lg font-semibold text-content-primary mb-2">
                {t('modelDownload.error.incompleteTitle')}
              </h3>
              <p className="text-sm text-content-tertiary leading-relaxed mb-3">
                {t('modelDownload.error.incompleteDescription')}
              </p>
              <p className="text-danger text-xs break-words mb-6">{error}</p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={onSkip}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium bg-surface-tertiary hover:bg-edge-secondary text-content-secondary transition-all"
                >
                  {t('modelDownload.skip')}
                </button>
                <button
                  onClick={handleDownload}
                  className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-sm font-medium text-white shadow-lg shadow-accent/20 hover:shadow-accent/30 transition-all hover:scale-[1.03] inline-flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  {t('modelDownload.error.redownload')}
                </button>
              </div>
            </>
          ) : downloading ? (
            <>
              <h3 className="text-lg font-semibold text-content-primary mb-2">
                {t('modelDownload.downloading.title')}
              </h3>
              <p className="text-sm text-content-tertiary mb-6">
                {t('modelDownload.downloading.description')}
              </p>
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-8 h-8 animate-spin text-accent" />
                <span className="ml-3 text-sm text-content-secondary">
                  {t('modelDownload.downloading.progress')}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-content-primary mb-1">
                    {t('modelDownload.title')}
                  </h3>
                  <p className="text-sm text-content-tertiary leading-relaxed">
                    {t('modelDownload.description')}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-surface-tertiary text-content-tertiary hover:text-content-secondary transition-colors shrink-0 ml-2"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={onSkip}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium bg-surface-tertiary hover:bg-edge-secondary text-content-secondary transition-all"
                >
                  {t('modelDownload.skip')}
                </button>
                <button
                  onClick={handleDownload}
                  className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-sm font-medium text-white shadow-lg shadow-accent/20 hover:shadow-accent/30 transition-all hover:scale-[1.03] inline-flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  {t('modelDownload.download')}
                </button>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
