import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import translations from '../i18n/translations';

const LocaleContext = createContext(null);

const STORAGE_KEY = 'gallery-locale';
const DEFAULT_LOCALE = 'en';

function loadLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && translations[stored]) return stored;
  } catch { /* localStorage unavailable */ }
  return DEFAULT_LOCALE;
}

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(loadLocale);

  const setLocale = useCallback((next) => {
    setLocaleState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* noop */ }
  }, []);

  const t = useCallback((key, params) => {
    const map = translations[locale] || translations[DEFAULT_LOCALE];
    let text = map[key];
    if (text === undefined) {
      // Fallback to English if key missing in current locale
      text = (translations[DEFAULT_LOCALE] || {})[key];
      if (text === undefined) return key;
    }
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, v);
      });
    }
    return text;
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return (
    <LocaleContext.Provider value={value}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within a LocaleProvider');
  return ctx;
}
