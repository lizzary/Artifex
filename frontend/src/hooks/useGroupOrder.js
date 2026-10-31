import { useCallback } from 'react';
import { changeGroupSettings, useGroupSettings } from './useGroupSettings';

export default function useGroupOrder() {
  const { data, error } = useGroupSettings();
  const order = data.group_order;

  const applyOrder = useCallback((groups) => {
    if (!groups?.length || !order.length) return groups;
    const positions = new Map(order.map((id, index) => [id, index]));
    return [...groups].sort((a, b) => (
      (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER)
      - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    ));
  }, [order]);

  const persistOrder = useCallback((groups) => {
    void changeGroupSettings(() => ({ group_order: groups.map((group) => group.id) }))
      .catch(() => {});
  }, []);

  return { applyOrder, persistOrder, error };
}
