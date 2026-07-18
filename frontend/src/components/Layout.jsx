import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sun, Moon, Search } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useLocale } from '../contexts/LocaleContext';
import TagPromptSuggest from './TagPromptSuggest';

export default function Layout({ children, onSearch }) {
  const [query, setQuery] = useState('');
  const { theme, toggleTheme } = useTheme();
  const { t } = useLocale();

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed && onSearch) onSearch(trimmed);
  };

  return (
    <div className="min-h-screen bg-surface-primary text-content-primary">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-edge-primary bg-surface-primary/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <a href="/" className="text-xl font-bold tracking-tight text-content-primary hover:text-accent transition-colors">
              {t('layout.brand')}
            </a>
            <nav className="flex items-center gap-4">
              <Link to="/tags" className="text-sm text-content-tertiary hover:text-accent transition-colors">
                {t('layout.nav.tags')}
              </Link>
              <Link to="/prompts" className="text-sm text-content-tertiary hover:text-accent transition-colors">
                {t('layout.nav.prompts')}
              </Link>
              <Link to="/settings" className="text-sm text-content-tertiary hover:text-accent transition-colors">
                {t('layout.nav.settings')}
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <form onSubmit={handleSubmit} className="flex items-center gap-2">
              <TagPromptSuggest
                type="tag"
                value={query}
                onChange={setQuery}
                placeholder={t('layout.search.placeholder')}
                inputClassName="w-64 px-4 py-2 rounded-lg bg-surface-tertiary border border-edge-secondary text-sm text-content-primary placeholder-content-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
              />
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-accent hover:bg-accent-hover text-sm font-medium text-white shadow-lg shadow-accent/20 hover:shadow-accent/30 transition-all hover:scale-[1.03] inline-flex items-center gap-2"
              >
                <Search className="w-4 h-4" />
                {t('layout.search.button')}
              </button>
            </form>
            <a
              href="https://github.com/lizzary/Artifex"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg hover:bg-surface-tertiary text-content-tertiary hover:text-content-primary transition-colors"
              title={t('layout.github')}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </a>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-surface-tertiary text-content-tertiary hover:text-content-primary transition-colors"
              title={theme === 'dark' ? t('layout.theme.switchToLight') : t('layout.theme.switchToDark')}
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
