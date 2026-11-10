import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Pin, X } from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';
import StatisticsSelect from './StatisticsSelect';
import './StatisticsHistory.css';

const DAY = 86400000;
const CHART_WIDTH = 960;
const CHART_HEIGHT = 180;
const LEVELS = ['0', '1', '2–9', '10–49', '50+'];

const messages = {
  zh: {
    chapter: '入库年表',
    heading: '入库活动总览',
    intro: '悬浮以查看当天数据，点击以固定日期。',
    all: '全部',
    scope: '入库统计范围',
    previous: '上一年',
    next: '下一年',
    year: '选择年份',
    calendar: '入库日历',
    calendarHelp: '方向键可探索日期。点按或按回车键固定日期。',
    activeDays: '有入库的日子',
    imports: '本年入库',
    noActivity: '这段时间暂无现存入库记录。',
    fewer: '无',
    more: '多',
    trend: '逐日趋势',
    daily: '每日入库',
    cumulative: '现存累计',
    controls: '折线统计方式',
    dateTotal: '截至当天',
    fixed: '已固定日期',
    clear: '取消固定',
    help: '方向键可逐日探索折线。点按或按回车键固定日期。',
    note: '日历与曲线按现存插画的入库日期绘制。累计从最早的现存记录算起，删除或覆盖前的记录无法回溯。',
    undated: count => `另有 ${count} 张现存插画的入库日期无法计入年表。`,
    items: count => `${count} 张`,
    yearLabel: year => `${year} 年`,
  },
  en: {
    chapter: 'Import timeline',
    heading: 'Import activity',
    intro: 'Hover to view the daily data. Click to pin a date.',
    all: 'All',
    scope: 'Import scope',
    previous: 'Previous year',
    next: 'Next year',
    year: 'Choose a year',
    calendar: 'Import calendar',
    calendarHelp: 'Use the arrow keys to explore days. Click or press Enter to pin a date.',
    activeDays: 'Active days',
    imports: 'Added this year',
    noActivity: 'No surviving entries were added in this period.',
    fewer: 'None',
    more: 'More',
    trend: 'Day by day',
    daily: 'Daily additions',
    cumulative: 'Current collection',
    controls: 'Trend metric',
    dateTotal: 'Total by this day',
    fixed: 'Date pinned',
    clear: 'Unpin date',
    help: 'Use the arrow keys to explore the chart. Click or press Enter to pin a date.',
    note: 'Both views use the accession dates of illustrations still in the archive. The running total starts with the oldest surviving entry. Deleted and replaced entries cannot be recovered.',
    undated: count => `Another ${count} current illustrations have no usable accession date.`,
    items: count => `${count} ${count === '1' ? 'illustration' : 'illustrations'}`,
    yearLabel: year => year,
  },
};

function toDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function fromDate(date) {
  return Date.parse(`${date}T00:00:00Z`);
}

function activityLevel(count) {
  if (count >= 50) return 4;
  if (count >= 10) return 3;
  if (count >= 2) return 2;
  return count;
}

function getAxisStep(maximum) {
  const approximate = Math.max(1, maximum / 4);
  const unit = 10 ** Math.floor(Math.log10(approximate));
  const step = [1, 2, 5, 10].find(candidate => candidate * unit >= approximate);
  return unit * step;
}

function buildYear(year, today, daily) {
  const start = fromDate(`${String(year).padStart(4, '0')}-01-01`);
  const end = Math.min(fromDate(`${String(year).padStart(4, '0')}-12-31`), fromDate(today));
  const dayCounts = new Map();
  let cumulative = 0;

  for (const { date, count } of daily) {
    const time = fromDate(date);
    if (time < start) cumulative += count;
    else if (time <= end) dayCounts.set(date, count);
  }

  const days = [];
  let activeDays = 0;
  let additions = 0;
  let lastActive = null;
  for (let time = start; time <= end; time += DAY) {
    const date = toDate(time);
    const count = dayCounts.get(date) || 0;
    cumulative += count;
    if (count > 0) {
      additions += count;
      activeDays += 1;
      lastActive = date;
    }
    days.push({ date, time, count, cumulative });
  }

  const firstWeekday = (new Date(start).getUTCDay() + 6) % 7;
  const weekCount = Math.ceil((firstWeekday + days.length) / 7);
  const slots = Array.from({ length: weekCount * 7 }, (_, index) => days[index - firstWeekday]);
  const monthLabels = days.flatMap((day, index) => (
    day.date.endsWith('-01') ? [{ ...day, column: Math.floor((index + firstWeekday) / 7) + 1 }] : []
  ));

  return { activeDays, additions, days, lastActive, monthLabels, slots, start, weekCount };
}

export default function StatisticsHistory({ history, groups, groupId, onGroupChange }) {
  const { locale } = useLocale();
  const copy = messages[locale] || messages.en;
  const { to: today, daily, undated = 0 } = history;
  const latestYear = Number(today.slice(0, 4));
  const earliestYear = groups.reduce((earliest, group) => (
    group.days.length ? Math.min(earliest, Number(group.days[0].date.slice(0, 4))) : earliest
  ), latestYear);
  const [requestedYear, setRequestedYear] = useState(null);
  const year = Math.max(earliestYear, Math.min(requestedYear ?? latestYear, latestYear));
  const [mode, setMode] = useState('count');
  const [previewDate, setPreviewDate] = useState(null);
  const [pinnedDate, setPinnedDate] = useState(null);
  const [focusedDate, setFocusedDate] = useState(null);
  const calendarScrollRef = useRef(null);
  const gradientId = useId();

  const formats = useMemo(() => ({
    count: new Intl.NumberFormat(locale),
    axis: new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }),
    day: new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }),
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }),
    month: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }),
    tick: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  }), [locale]);

  const yearData = useMemo(() => buildYear(year, today, daily), [year, today, daily]);
  const { activeDays, additions, days, lastActive, monthLabels, slots, start, weekCount } = yearData;
  const indexOf = date => date ? (fromDate(date) - start) / DAY : -1;
  const defaultDay = lastActive || days.at(-1).date;
  const selected = days[indexOf(pinnedDate)];
  const active = days[indexOf(previewDate)] || selected || days[indexOf(defaultDay)];
  const activeIndex = indexOf(active.date);
  const focusTarget = days[indexOf(focusedDate)]?.date || selected?.date || defaultDay;
  const total = mode === 'cumulative';
  const { axisTicks, dateTicks, dayPosition, heightPosition, maximum, trendPath } = useMemo(() => {
    const maximum = days.reduce((max, day) => Math.max(max, day[mode]), 0);
    const axisStep = getAxisStep(maximum);
    const axisLimit = Math.max(axisStep * 2, Math.ceil(maximum / axisStep) * axisStep);
    const axisTicks = Array.from({ length: axisLimit / axisStep + 1 }, (_, index) => index * axisStep);
    const dayPosition = index => days.length === 1 ? 50 : index / (days.length - 1) * 100;
    const heightPosition = value => 100 - (value / axisLimit) * 100;
    const trendPath = days.map((day, index) => {
      const x = dayPosition(index) * CHART_WIDTH / 100;
      const y = heightPosition(day[mode]) * CHART_HEIGHT / 100;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    const dateTicks = [...new Set(Array.from({ length: 5 }, (_, index) => Math.round((days.length - 1) * index / 4)))];
    return { axisTicks, dateTicks, dayPosition, heightPosition, maximum, trendPath };
  }, [days, mode]);

  useEffect(() => {
    const calendar = calendarScrollRef.current;
    if (calendar) calendar.scrollLeft = year === latestYear ? calendar.scrollWidth : 0;
  }, [year, latestYear]);

  function changeYear(next) {
    setRequestedYear(next);
    setPreviewDate(null);
    setFocusedDate(null);
  }

  function togglePin(date) {
    setPinnedDate(current => current === date ? null : date);
  }

  function handleCalendarKeys(event, index) {
    const offsets = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    let next = index + offsets[event.key];
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = days.length - 1;
    if (event.key === 'Escape') {
      setPinnedDate(null);
      return;
    }
    if (!Number.isFinite(next)) return;
    event.preventDefault();
    const date = days[Math.max(0, Math.min(next, days.length - 1))].date;
    const target = calendarScrollRef.current?.querySelector(`[data-date="${date}"]`);
    target?.focus();
  }

  function handleChartKeys(event) {
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 1, ArrowDown: -1 };
    let next = activeIndex + offsets[event.key];
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = days.length - 1;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      togglePin(active.date);
      return;
    }
    if (event.key === 'Escape') {
      setPinnedDate(null);
      return;
    }
    if (!Number.isFinite(next)) return;
    event.preventDefault();
    setPreviewDate(days[Math.max(0, Math.min(next, days.length - 1))].date);
  }

  function dateUnderPointer(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const progress = (event.clientX - rect.left) / rect.width;
    return days[Math.max(0, Math.min(Math.round(progress * (days.length - 1)), days.length - 1))].date;
  }

  return (
    <section id="statistics-history" className="statistics-history" aria-labelledby={`${gradientId}-heading`}>
      <div className="history-heading">
        <div>
          <p className="statistics-kicker"><span>02</span>{copy.chapter}</p>
          <h2 id={`${gradientId}-heading`} className="statistics-title">{copy.heading}</h2>
          <p className="history-intro">{copy.intro}</p>
        </div>
        <StatisticsSelect
          className="history-scope"
          ariaLabel={copy.scope}
          icon={CalendarDays}
          value={groupId}
          onChange={onGroupChange}
          options={[{ value: null, label: copy.all }, ...groups.map(group => ({ value: group.id, label: group.name }))]}
        />
      </div>

      <div className="history-folio">
        <div className="history-calendar-header">
          <h3>{copy.calendar}</h3>
          <div className="history-year">
            <button type="button" aria-label={copy.previous} disabled={year === earliestYear} onClick={() => changeYear(year - 1)}>
              <ChevronLeft size={17} aria-hidden="true" />
            </button>
            <StatisticsSelect
              className="history-year-select"
              ariaLabel={copy.year}
              compact
              menuMinWidth={140}
              value={year}
              onChange={changeYear}
              options={Array.from({ length: latestYear - earliestYear + 1 }, (_, index) => ({
                value: latestYear - index,
                label: copy.yearLabel(latestYear - index),
              }))}
            />
            <button type="button" aria-label={copy.next} disabled={year === latestYear} onClick={() => changeYear(year + 1)}>
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
        <p id={`${gradientId}-calendar-help`} className="sr-only">{copy.calendarHelp}</p>
        <div ref={calendarScrollRef} className="history-calendar-scroll artifex-scrollbar artifex-scrollbar-quiet">
          <div
            className="history-calendar"
            style={{ '--history-weeks': weekCount }}
            onPointerLeave={() => setPreviewDate(null)}
            onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget)) setPreviewDate(null);
            }}
          >
            <div className="history-calendar-months" aria-hidden="true">
              {monthLabels.map(({ date, time, column }, index) => (
                <span key={date} style={{ gridColumn: `${column} / ${monthLabels[index + 1]?.column || weekCount + 1}` }}>
                  {formats.month.format(time)}
                </span>
              ))}
            </div>
            <div className="history-calendar-weekdays" aria-hidden="true">
              {[0, 2, 4, 6].map(index => (
                <span key={index} style={{ gridRow: index + 1 }}>
                  {formats.weekday.format(Date.UTC(2024, 0, 1 + index))}
                </span>
              ))}
            </div>
            <div className="history-calendar-grid" role="group" aria-label={copy.calendar} aria-describedby={`${gradientId}-calendar-help`}>
              {slots.map((day, index) => day ? (
                <button
                  key={day.date}
                  type="button"
                  data-date={day.date}
                  data-level={activityLevel(day.count)}
                  data-active={day.date === active.date ? '' : undefined}
                  data-pinned={day.date === selected?.date ? '' : undefined}
                  tabIndex={day.date === focusTarget ? 0 : -1}
                  aria-current={day.date === today ? 'date' : undefined}
                  aria-pressed={day.date === selected?.date}
                  aria-label={`${formats.day.format(day.time)} · ${copy.items(formats.count.format(day.count))}`}
                  onPointerEnter={event => {
                    if (event.pointerType !== 'touch') setPreviewDate(day.date);
                  }}
                  onFocus={() => {
                    setFocusedDate(day.date);
                    setPreviewDate(day.date);
                  }}
                  onClick={() => togglePin(day.date)}
                  onKeyDown={event => handleCalendarKeys(event, indexOf(day.date))}
                />
              ) : <span key={`blank-${index}`} aria-hidden="true" />)}
            </div>
          </div>
        </div>
        <div className="history-calendar-footer">
          {activeDays > 0 ? (
            <dl className="history-period-summary">
              <div><dt>{copy.imports}</dt><dd>{formats.count.format(additions)}</dd></div>
              <div><dt>{copy.activeDays}</dt><dd>{formats.count.format(activeDays)}</dd></div>
            </dl>
          ) : <p>{copy.noActivity}</p>}
          <div className="history-calendar-reading">
            <time dateTime={active.date}>{formats.tick.format(active.time)}</time>
            <strong>{copy.items(formats.count.format(active.count))}</strong>
          </div>
          <div className="history-legend" role="img" aria-label={`${copy.daily} · ${LEVELS.join(', ')}`}>
            <span>{copy.fewer}</span>
            {LEVELS.map((range, level) => (
              <span className="history-legend-swatch" key={range} data-level={level} title={copy.items(range)} aria-hidden="true" />
            ))}
            <span>{copy.more}</span>
          </div>
        </div>
      </div>

      <div className="history-trend">
        <div className="history-trend-header">
          <h3>{copy.trend}</h3>
          <div className="history-mode" role="group" aria-label={copy.controls}>
            <button type="button" aria-pressed={!total} onClick={() => setMode('count')}>{copy.daily}</button>
            <button type="button" aria-pressed={total} onClick={() => setMode('cumulative')}>{copy.cumulative}</button>
          </div>
        </div>
        <div className="history-reading">
          <div className="history-reading-date">
            <time dateTime={active.date}>{formats.day.format(active.time)}</time>
            {selected && (
              <button type="button" className="history-unpin" aria-label={copy.clear} title={copy.clear} onClick={() => setPinnedDate(null)}>
                <Pin size={12} aria-hidden="true" />
                <span>{copy.fixed}</span>
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </div>
          <p><span>{total ? copy.dateTotal : copy.daily}</span> <strong>{copy.items(formats.count.format(active[mode]))}</strong></p>
        </div>
        <div className="history-chart">
          <div className="history-axis-y" aria-hidden="true">
            {axisTicks.map(value => (
              <span key={value} style={{ top: `${heightPosition(value)}%` }} title={formats.count.format(value)}>{formats.axis.format(value)}</span>
            ))}
          </div>
          <div
            className="history-plot"
            role="slider"
            tabIndex={0}
            aria-label={total ? copy.cumulative : copy.daily}
            aria-describedby={`${gradientId}-help`}
            aria-valuemin={1}
            aria-valuemax={days.length}
            aria-valuenow={activeIndex + 1}
            aria-valuetext={`${formats.day.format(active.time)} · ${copy.items(formats.count.format(active[mode]))}`}
            onPointerMove={event => {
              if (event.pointerType !== 'touch') setPreviewDate(dateUnderPointer(event));
            }}
            onPointerLeave={() => setPreviewDate(null)}
            onBlur={() => setPreviewDate(null)}
            onClick={event => togglePin(dateUnderPointer(event))}
            onKeyDown={handleChartKeys}
          >
            <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id={gradientId} x1="0%" x2="0%" y1="0%" y2="100%" gradientUnits="objectBoundingBox">
                  <stop offset="0" className="history-chart-stop" stopOpacity=".21" />
                  <stop offset="1" className="history-chart-stop" stopOpacity=".025" />
                </linearGradient>
              </defs>
              {axisTicks.map(value => (
                <line key={value} className="history-chart-rule" x1="0" x2={CHART_WIDTH} y1={heightPosition(value) * CHART_HEIGHT / 100} y2={heightPosition(value) * CHART_HEIGHT / 100} vectorEffect="non-scaling-stroke" />
              ))}
              {days.length > 1 && maximum > 0 && (
                <path className="history-chart-area" key={`area-${groupId}-${year}-${mode}`} d={`${trendPath} L${CHART_WIDTH},${CHART_HEIGHT} L0,${CHART_HEIGHT} Z`} fill={`url(#${gradientId})`} />
              )}
              <path className="history-chart-line" key={`line-${groupId}-${year}-${mode}`} d={trendPath} vectorEffect="non-scaling-stroke" />
            </svg>
            <span className="history-chart-marker" aria-hidden="true" style={{ left: `${dayPosition(activeIndex)}%` }}>
              <span style={{ top: `${heightPosition(active[mode])}%` }} />
            </span>
          </div>
          <div className="history-axis-x" aria-hidden="true">
            {dateTicks.map((index, tickIndex) => (
              <span
                key={index}
                data-align={dateTicks.length === 1 ? undefined : tickIndex === 0 ? 'start' : tickIndex === dateTicks.length - 1 ? 'end' : undefined}
                data-secondary={dateTicks.length === 5 && tickIndex % 2 === 1 ? '' : undefined}
                style={{ left: `${dayPosition(index)}%` }}
              >{formats.tick.format(days[index].time)}</span>
            ))}
          </div>
        </div>
        <p className="history-chart-help" id={`${gradientId}-help`}>{copy.help}</p>
      </div>
      <p className="history-source">
        {copy.note}
        {undated > 0 && ` ${copy.undated(formats.count.format(undated))}`}
      </p>
    </section>
  );
}
