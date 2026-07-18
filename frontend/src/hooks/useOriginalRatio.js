import { useCallback, useState } from 'react';

const STORAGE_KEY = 'gallery-original-ratio';

function getStored() {
  try { return localStorage.getItem(STORAGE_KEY) === 'true'; }
  catch { return false; }
}

export default function useOriginalRatio() {
  const [enabled, setEnabledState] = useState(getStored);

  const setEnabled = useCallback((value) => {
    const next = Boolean(value);
    setEnabledState(next);
    try { localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
  }, []);

  return [enabled, setEnabled];
}
