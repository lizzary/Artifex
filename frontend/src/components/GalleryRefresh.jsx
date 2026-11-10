import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';

const INTERVAL_MS = 5000;

export default function GalleryRefresh({ onRefresh, paused }) {
  const { t } = useLocale();
  const requestRef = useRef(null);
  const deadlineRef = useRef(0);
  const [remaining, setRemaining] = useState(INTERVAL_MS / 1000);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (paused || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setRefreshing(true);
    try {
      await onRefresh(controller.signal);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        deadlineRef.current = performance.now() + INTERVAL_MS;
        setRemaining(INTERVAL_MS / 1000);
        setRefreshing(false);
      }
    }
  }, [onRefresh, paused]);

  useEffect(() => {
    setRefreshing(false);
    setRemaining(INTERVAL_MS / 1000);
    if (paused) return undefined;
    deadlineRef.current = performance.now() + INTERVAL_MS;
    const interval = window.setInterval(() => {
      if (requestRef.current) return;
      const remaining = Math.max(0, Math.ceil((deadlineRef.current - performance.now()) / 1000));
      setRemaining(remaining);
      if (remaining === 0) void refresh();
    }, 250);
    return () => {
      window.clearInterval(interval);
      const controller = requestRef.current;
      requestRef.current = null;
      controller?.abort();
    };
  }, [paused, refresh]);

  const hint = t(paused ? 'groupOverlay.refresh.paused' : 'groupOverlay.refresh.hint');
  return (
    <button
      type="button"
      onClick={refresh}
      disabled={paused || refreshing}
      aria-busy={refreshing}
      aria-label={t('groupOverlay.refresh.label')}
      title={hint}
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-edge-primary bg-surface-secondary px-2.5 text-content-tertiary transition-colors hover:border-accent/30 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 motion-reduce:transition-none"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
      <span className="min-w-[1.6em] text-right font-mono text-[10px] tabular-nums" aria-hidden="true">
        {paused || refreshing ? '··' : t('groupOverlay.refresh.seconds', { count: remaining })}
      </span>
    </button>
  );
}
