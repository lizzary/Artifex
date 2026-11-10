import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowLeft, ArrowUpRight, ChevronDown, FolderClosed, Moon, RefreshCw, Sun } from 'lucide-react';
import { getExportCatalog, getGroupConfig, getStatistics, getStatisticsGroupStorage } from '../api';
import { backendUrl } from '../api/url';
import StatisticsHistory from '../components/StatisticsHistory';
import StatisticsSelect from '../components/StatisticsSelect';
import { useLocale } from '../contexts/LocaleContext';
import { useTheme } from '../contexts/ThemeContext';
import { getIllustrationMemberships, groupDisplayName } from '../utils/grouping';
import { toHexColor } from '../utils/groupColors';
import copy from './statisticsCopy';
import './statistics.css';

const storageUnits = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

function ByteSize({ bytes, format, className = '' }) {
  if (bytes == null) return <span className={className}>—</span>;
  const unit = bytes > 0 ? Math.min(storageUnits.length - 1, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;
  const value = bytes / 1024 ** unit;
  return (
    <span className={`statistics-bytes ${className}`} title={`${format.format(bytes)} B`}>
      {format.format(value)} <small>{storageUnits[unit]}</small>
    </span>
  );
}

function CollectionMark() {
  return (
    <svg className="statistics-mark" viewBox="0 0 410 276" fill="none" aria-hidden="true">
      <path className="statistics-mark-frame" d="M30 22h350v232H30zM38 30h334v216H38zM205 9v258M15 138h380" />
      <circle className="statistics-mark-frame" cx="205" cy="138" r="100" strokeDasharray="1 5" />
      <circle className="statistics-mark-frame" cx="205" cy="138" r="108" />
      <g className="statistics-mark-lines">
        {Array.from({ length: 13 }, (_, index) => (
          <ellipse key={index} cx="205" cy="138" rx="89" ry="36" transform={`rotate(${index * 180 / 13} 205 138)`} />
        ))}
      </g>
      <path className="statistics-mark-stars" d="M205 115c0 14 9 23 23 23-14 0-23 9-23 23 0-14-9-23-23-23 14 0 23-9 23-23ZM54 44l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5ZM356 218l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z" />
      <circle className="statistics-mark-stars" cx="205" cy="30" r="2.5" />
      <circle className="statistics-mark-stars" cx="205" cy="246" r="2.5" />
    </svg>
  );
}

function CollectionCover({ group }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="statistics-cover" aria-hidden="true">
      <FolderClosed size={16} strokeWidth={1.5} />
      {group.cover_illustration_id && !failed && (
        <img
          src={backendUrl(`/api/illustrations/${group.cover_illustration_id}/thumbnail?quality=low`)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

function CollectionHeader({ statistics, colorCount, totalBytes, labels, format }) {
  return (
    <header className="statistics-folio" aria-labelledby="statistics-title">
      <div className="statistics-folio-body">
        <div className="statistics-folio-copy">
          <p className="statistics-kicker"><span>01</span>{labels.edition}</p>
          <h1 id="statistics-title">{labels.title}</h1>
          <p className="statistics-intro">{labels.intro}</p>
        </div>
        <div className="statistics-folio-art">
          <CollectionMark />
          {statistics && (
            <a href="#statistics-storage" className="statistics-footprint">
              <span>{labels.footprint}</span>
              <span className="statistics-footprint-value">
                <ByteSize bytes={totalBytes} format={format} />
                <ArrowDownRight size={17} aria-hidden="true" />
              </span>
            </a>
          )}
        </div>
      </div>
      <dl className="statistics-totals">
        <div>
          <dt>{labels.illustrations}</dt>
          <dd>{statistics ? format.format(statistics.illustration_count) : '—'}</dd>
        </div>
        <div>
          <dt>{labels.groups}</dt>
          <dd>{statistics ? format.format(statistics.groups.length) : '—'}</dd>
        </div>
        <div>
          <dt>{labels.colorGroups} <span>{labels.colorCountNote}</span></dt>
          <dd>{statistics ? format.format(colorCount) : '—'}</dd>
        </div>
      </dl>
    </header>
  );
}

function StorageSection({ statistics, totalBytes, labels, format }) {
  const categories = [
    { name: labels.database, bytes: statistics.database_bytes, kind: 'database' },
    { name: labels.uploads, bytes: statistics.storage.uploads_bytes, kind: 'uploads' },
    { name: labels.models, bytes: statistics.storage.models_bytes, kind: 'models' },
  ];
  const files = [
    [labels.main, statistics.database_files.main_bytes],
    [labels.wal, statistics.database_files.wal_bytes],
    [labels.shm, statistics.database_files.shm_bytes],
  ];
  return (
    <section id="statistics-storage" className="statistics-storage" aria-labelledby="statistics-storage-title">
      <div className="statistics-section-heading">
        <p className="statistics-kicker"><span>04</span>{labels.storage}</p>
        <h2 className="statistics-title" id="statistics-storage-title">{labels.storageTitle}</h2>
        <p>{labels.storageNote} {statistics.storage.basis === 'allocated' ? labels.storageAllocated : labels.storageLength}</p>
      </div>
      <div className="statistics-storage-body">
        <div className="statistics-storage-overview">
          <div className="statistics-storage-value">
            <span>{labels.footprint}</span>
            <ByteSize bytes={totalBytes} format={format} />
          </div>
          <div className="statistics-storage-meter" aria-hidden="true">
            {categories.map(({ kind, bytes }) => bytes > 0 && (
              <span key={kind} data-storage={kind} style={{ flexGrow: bytes / totalBytes }} />
            ))}
          </div>
          <dl className="statistics-storage-legend">
            {categories.map(({ name, bytes, kind }) => (
              <div key={kind}>
                <dt><i data-storage={kind} aria-hidden="true" />{name}</dt>
                <dd><ByteSize bytes={bytes} format={format} /></dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="statistics-database">
          <h3>{labels.database}</h3>
          <dl>
            {files.map(([name, bytes]) => (
              <div key={name}><dt>{name}</dt><dd><ByteSize bytes={bytes} format={format} /></dd></div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

function ColorLedger({ group, colors, labels, format, sizeLabel, openTimeline }) {
  const sets = colors?.sets ?? [];
  const [selectedId, setSelectedId] = useState(colors?.active_id);
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const scheme = sets.find(({ id }) => id === selectedId) ?? sets[0];
  const needsCatalog = sets.length > 0 && group.illustration_count > 0;
  const currentResult = result?.group === group && result.attempt === attempt ? result : null;

  useEffect(() => {
    if (!needsCatalog) return undefined;
    const controller = new AbortController();
    Promise.all([
      getExportCatalog(group.id, controller.signal),
      getStatisticsGroupStorage(group.id, controller.signal),
    ]).then(([items, storage]) => {
      if (!controller.signal.aborted) setResult({ group, attempt, items, diskBytes: storage.illustrations });
    }).catch((failure) => {
      if (!controller.signal.aborted) setResult({ group, attempt, error: failure.message });
    });
    return () => controller.abort();
  }, [group, needsCatalog, attempt]);

  const rows = useMemo(() => {
    if (!scheme) return [];
    const other = { name: labels.unassigned, count: 0, bytes: 0 };
    const buckets = new Map(scheme.pairs.map((pair) => [
      pair.id,
      { id: pair.id, name: groupDisplayName(pair) || labels.unnamed, color: toHexColor(pair.borderColor, toHexColor(pair.color)), count: 0, bytes: 0 },
    ]));
    const items = currentResult?.items ?? [];
    const memberships = getIllustrationMemberships(items, scheme.pairs, scheme.match_order, scheme.manual_assignments);
    for (const item of items) {
      const membership = memberships.get(item.id);
      const row = membership.source === 'other' ? other : buckets.get(membership.effectiveGroupId) ?? other;
      row.count += 1;
      row.bytes += currentResult.diskBytes[item.id] ?? 0;
    }
    return [...buckets.values(), other];
  }, [currentResult, labels, scheme]);

  const waiting = needsCatalog && !currentResult?.items;

  return (
    <div className="statistics-color-ledger">
      <div className="statistics-color-actions">
        {scheme && (
          <StatisticsSelect
            label={labels.colorScheme}
            value={scheme.id}
            onChange={setSelectedId}
            options={sets.map(({ id, name }) => ({
              value: id,
              label: name,
              description: id === colors.active_id ? labels.active : undefined,
            }))}
          />
        )}
        <a href="#statistics-history" className="statistics-text-action" onClick={() => openTimeline(group.id)}>
          {labels.timelineAction} <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      </div>
      {!scheme && <p className="statistics-message">{labels.noScheme}</p>}
      {waiting && (currentResult?.error ? (
        <div className="statistics-message" role="alert">
          <p>{labels.colorsError}</p><p className="statistics-error-detail">{currentResult.error}</p>
          <button className="statistics-text-action" type="button" onClick={() => setAttempt(attempt + 1)}>
            {labels.retry} <RefreshCw size={14} aria-hidden="true" />
          </button>
        </div>
      ) : <p className="statistics-message" role="status">{labels.loadingColors}</p>)}
      {scheme && !waiting && (
        <table className="statistics-color-table">
          <thead><tr><th scope="col">{labels.colorGroup}</th><th scope="col">{labels.illustrations}</th><th scope="col">{sizeLabel}</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id === undefined ? 'unassigned' : `pair-${row.id}`}>
                <th scope="row">
                  <span className="statistics-color-label">
                    <span className="statistics-color-dot" data-unassigned={row.id === undefined ? '' : undefined} style={{ '--stat-swatch': row.color }} aria-hidden="true" />
                    <span>{row.name}</span>
                  </span>
                </th>
                <td>{format.format(row.count)}</td>
                <td><ByteSize bytes={row.bytes} format={format} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CollectionIndex({ statistics, config, labels, format, openTimeline }) {
  const [order, setOrder] = useState('library');
  const [expandedId, setExpandedId] = useState(null);
  const groups = useMemo(() => {
    if (order === 'library') return statistics.groups;
    return [...statistics.groups].sort((a, b) => b[order] - a[order]);
  }, [order, statistics.groups]);
  const maxSize = groups.reduce((max, group) => Math.max(max, group.disk_bytes), 0);
  const sizeLabel = statistics.storage.basis === 'allocated' ? labels.diskUsage : labels.fileSize;

  return (
    <section id="statistics-index" className="statistics-index" aria-labelledby="statistics-index-title">
      <div className="statistics-index-heading">
        <div className="statistics-section-heading">
          <p className="statistics-kicker"><span>03</span>{labels.index}</p>
          <h2 className="statistics-title" id="statistics-index-title">{labels.indexTitle}</h2>
          <p>{labels.indexNote}</p>
        </div>
        {groups.length > 0 && (
          <StatisticsSelect
            label={labels.order}
            value={order}
            onChange={setOrder}
            align="end"
            options={[
              { value: 'library', label: labels.orderLibrary },
              { value: 'disk_bytes', label: labels.orderSize },
              { value: 'illustration_count', label: labels.orderCount },
            ]}
          />
        )}
      </div>
      {groups.length > 0 ? (
        <div className="statistics-ledger">
          <div className="statistics-ledger-columns statistics-ledger-labels" aria-hidden="true">
            <span>{labels.groupName}</span><span>{labels.illustrations}</span><span>{sizeLabel}</span><span />
          </div>
          <ul>
            {groups.map((group) => {
              const expanded = expandedId === group.id;
              const colors = config.groups[group.id]?.colors;
              return (
                <li key={group.id}>
                  <button
                    type="button"
                    className="statistics-ledger-columns statistics-group-button"
                    aria-expanded={expanded}
                    aria-controls={`statistics-group-${group.id}`}
                    onClick={() => setExpandedId(expanded ? null : group.id)}
                  >
                    <span className="statistics-group-name">
                      <CollectionCover key={group.cover_illustration_id} group={group} />
                      <span>{group.name}</span>
                    </span>
                    <span className="statistics-group-count"><span className="sr-only">{labels.illustrations} </span>{format.format(group.illustration_count)}</span>
                    <span className="statistics-group-bytes">
                      <span className="sr-only">{sizeLabel} </span>
                      <span className="statistics-group-meter" aria-hidden="true"><span style={{ width: `${maxSize ? group.disk_bytes / maxSize * 100 : 0}%` }} /></span>
                      <ByteSize bytes={group.disk_bytes} format={format} />
                    </span>
                    <ChevronDown className="statistics-group-chevron" size={17} aria-hidden="true" />
                  </button>
                  <div id={`statistics-group-${group.id}`} hidden={!expanded}>
                    {expanded && <ColorLedger group={group} colors={colors} labels={labels} format={format} sizeLabel={sizeLabel} openTimeline={openTimeline} />}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="statistics-index-note">{labels.sizeNote}</p>
        </div>
      ) : <p className="statistics-message">{labels.emptyGroups}</p>}
    </section>
  );
}

function getHistory(statistics, groupId) {
  const group = statistics.groups.find(({ id }) => id === groupId);
  const counts = new Map();
  let datedCount = 0;
  for (const { days } of group ? [group] : statistics.groups) {
    for (const { date, count } of days) {
      counts.set(date, (counts.get(date) ?? 0) + count);
      datedCount += count;
    }
  }
  return {
    to: statistics.today,
    daily: Array.from(counts, ([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
    undated: (group?.illustration_count ?? statistics.illustration_count) - datedCount,
  };
}

export default function StatisticsPage() {
  const { locale } = useLocale();
  const { theme, toggleTheme } = useTheme();
  const labels = copy[locale] ?? copy.en;
  const format = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }), [locale]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [historyGroupId, setHistoryGroupId] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([getStatistics(controller.signal), getGroupConfig(controller.signal)]).then(([statistics, config]) => {
      if (controller.signal.aborted) return;
      setData({ statistics, config });
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(failure.message);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [attempt]);

  function refresh() {
    setError('');
    setLoading(true);
    setAttempt((previous) => previous + 1);
  }

  const statistics = data?.statistics;
  const groupId = statistics?.groups.some(({ id }) => id === historyGroupId) ? historyGroupId : null;
  const history = useMemo(() => statistics && getHistory(statistics, groupId), [statistics, groupId]);
  const colorCount = statistics?.groups.reduce((count, { id }) => (
    count + (data.config.groups[id]?.colors?.sets.reduce((sum, set) => sum + set.pairs.length, 0) ?? 0)
  ), 0);
  const totalBytes = statistics && statistics.database_bytes + statistics.storage.uploads_bytes + statistics.storage.models_bytes;
  const themeLabel = theme === 'dark' ? labels.light : labels.dark;

  return (
    <div className="statistics-page" lang={locale === 'zh' ? 'zh-CN' : 'en'}>
      <div className="statistics-top">
        <div className="statistics-width statistics-top-inner">
          <Link className="statistics-back" to="/" aria-label={`${labels.back} · Artifex`}>
            <ArrowLeft size={16} aria-hidden="true" /><span>Artifex</span><small>{labels.back}</small>
          </Link>
          <div className="statistics-tools">
            {statistics && <span className="statistics-snapshot">{labels.snapshot} <time dateTime={statistics.today}>{statistics.today}</time></span>}
            <button className="statistics-icon" type="button" onClick={refresh} disabled={loading} aria-label={labels.refresh} title={labels.refresh}>
              <RefreshCw className={loading ? 'statistics-refreshing' : undefined} size={17} aria-hidden="true" />
            </button>
            <button className="statistics-icon" type="button" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel}>
              {theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
      <main className="statistics-width statistics-main" aria-busy={loading}>
        <CollectionHeader statistics={statistics} colorCount={colorCount} totalBytes={totalBytes} labels={labels} format={format} />
        {loading && !data && <p className="statistics-message" role="status">{labels.loading}</p>}
        {error && (
          <div className="statistics-message" role="alert">
            <p>{labels.loadError}</p><p className="statistics-error-detail">{error}</p>
            <button className="statistics-text-action" type="button" onClick={refresh}>{labels.retry} <RefreshCw size={14} aria-hidden="true" /></button>
          </div>
        )}
        {data && (
          <>
            <nav className="statistics-contents" aria-label={labels.navigation}>
              <a href="#statistics-history"><span>02</span>{labels.history}<ArrowDownRight size={14} aria-hidden="true" /></a>
              <a href="#statistics-index"><span>03</span>{labels.index}<ArrowDownRight size={14} aria-hidden="true" /></a>
              <a href="#statistics-storage"><span>04</span>{labels.storage}<ArrowDownRight size={14} aria-hidden="true" /></a>
            </nav>
            <StatisticsHistory history={history} groups={statistics.groups} groupId={groupId} onGroupChange={setHistoryGroupId} />
            <CollectionIndex statistics={statistics} config={data.config} labels={labels} format={format} openTimeline={setHistoryGroupId} />
            <StorageSection statistics={statistics} totalBytes={totalBytes} labels={labels} format={format} />
            <footer className="statistics-colophon"><span>ARTIFEX</span><span>{labels.edition}</span></footer>
          </>
        )}
      </main>
    </div>
  );
}
