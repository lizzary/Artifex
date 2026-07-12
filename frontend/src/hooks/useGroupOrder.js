import { useCallback, useEffect, useState } from 'react';
import { getSettings, updateSettings } from '../api';

export default function useGroupOrder() {
  const [order, setOrder] = useState([]);

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((s) => {
        if (cancelled) return;
        const remote = Array.isArray(s?.group_order) ? s.group_order : [];
        setOrder(remote);
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
