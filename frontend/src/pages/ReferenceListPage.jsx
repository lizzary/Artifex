import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLocale } from '../contexts/LocaleContext';

export default function ReferenceListPage({ loadItems, translationPrefix }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const { t } = useLocale();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    loadItems()
      .then((result) => { if (!cancelled) setItems(result); })
      .catch((loadError) => { if (!cancelled) setError(loadError.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadItems]);

  const filteredItems = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => item.toLowerCase().includes(query));
  }, [filter, items]);

  return (
    <div className="min-h-screen bg-surface-primary text-content-primary">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <Link
              to="/"
              className="rounded-lg p-2 text-content-tertiary transition-colors hover:bg-surface-tertiary hover:text-content-secondary"
              aria-label={t('navigation.back')}
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-xl font-semibold">{t(`${translationPrefix}.heading`)}</h1>
            <span className="text-sm text-content-muted">
              {t(`${translationPrefix}.subtitle`, { count: items.length })}
            </span>
          </div>
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t(`${translationPrefix}.filterPlaceholder`)}
            className="w-64 rounded-lg border border-edge-secondary bg-surface-tertiary px-4 py-2 text-sm text-content-primary placeholder-content-muted focus:border-accent/50 focus:outline-none"
          />
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center text-content-muted">
            {t(`${translationPrefix}.loading`)}
          </div>
        ) : error ? (
          <div className="flex h-64 items-center justify-center text-danger">{error}</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {filteredItems.map((item) => (
              <span
                key={item}
                className="cursor-default rounded-lg border border-edge-secondary/50 bg-surface-tertiary/80 px-3 py-1.5 text-sm text-content-secondary transition-colors hover:border-edge-primary/50 hover:bg-surface-tertiary hover:text-content-primary"
              >
                {item}
              </span>
            ))}
            {filteredItems.length === 0 && (
              <p className="text-sm text-content-muted">{t(`${translationPrefix}.empty`)}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
