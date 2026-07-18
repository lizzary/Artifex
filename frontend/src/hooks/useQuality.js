import { useState, useCallback } from 'react';

const KEY = 'gallery-thumbnail-quality';

function getStored() {
  try { return localStorage.getItem(KEY) || 'low'; }
  catch { return 'low'; }
}

export default function useQuality() {
  const [quality, setQualityState] = useState(getStored);

  const setQuality = useCallback((q) => {
    setQualityState(q);
    try { localStorage.setItem(KEY, q); } catch {}
  }, []);

  return [quality, setQuality];
}
