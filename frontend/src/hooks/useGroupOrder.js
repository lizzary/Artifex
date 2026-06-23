import { useCallback, useEffect, useState } from 'react';
import { getSettings, updateSettings } from '../api';

const LEGACY_KEY = 'gallery-group-order';

function readLegacyOrder() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function dropLegacyKey() {
  try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
}

export default function useGroupOrder() {
  const [order, setOrder] = useState([]);

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((s) => {
        if (cancelled) return;
        const remote = Array.isArray(s?.group_order) ? s.group_order : [];
        if (remote.length > 0) {
          setOrder(remote);
          // If a stale localStorage copy still exists, drop it now that the
          // server is authoritative.
          dropLegacyKey();
          return;
        }
        // First-time migration: hoist whatever was in browser storage onto the
        // backend so we can stop reading from localStorage on next boot.
        const legacy = readLegacyOrder();
        if (legacy && legacy.length > 0) {
          setOrder(legacy);
          updateSettings({ group_order: legacy })
            .then(dropLegacyKey)
            .catch(() => { /* keep the legacy key so we can retry later */ });
        }
      })
      .catch(() => { /* keep default empty order */ });
    return () => { cancelled = true; };
  }, []);

  const applyOrder = useCallback((groups) => {
    if (!Array.isArray(groups) || groups.length === 0 || order.length === 0) return groups;
    const idx = new Map(order.map((id, i) => [id, i]));
    return [...groups].sort((a, b) => {
      const ia = idx.has(a.id) ? idx.get(a.id) : Number.MAX_SAFE_INTEGER;
      const ib = idx.has(b.id) ? idx.get(b.id) : Number.MAX_SAFE_INTEGER;
      return ia - ib;
    });
  }, [order]);

  const persistOrder = useCallback((groups) => {
    if (!Array.isArray(groups)) return;
    const ids = groups.map((g) => g.id);
    setOrder(ids);
    updateSettings({ group_order: ids }).catch(() => { /* swallow; will retry on next change */ });
  }, []);

  return { applyOrder, persistOrder };
}
