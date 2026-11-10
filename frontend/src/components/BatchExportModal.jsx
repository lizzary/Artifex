import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ArrowRight, CalendarDays, ChevronDown, ChevronRight, Download, File, Folder, Image, Layers,
  LoaderCircle, Plus, Search, X,
} from 'lucide-react';
import { getExportCatalog, getExportDraft as loadExportDraft, prepareExport, saveExportDraft } from '../api';
import { backendUrl } from '../api/url';
import { useLocale } from '../contexts/LocaleContext';
import { loadGroupSettings } from '../hooks/useGroupSettings';
import {
  archiveDay, buildExportTree, getColorGroups, getExportDraft, getExportKeys, getExtensionOptions,
  isExportDate, isExportDateRange, localDate, previewLimit,
} from '../utils/batchExport';
import ExportPopover from './ExportPopover';
import { useToast } from './Toast';
import './batch-export.css';

const copy = {
  zh: {
    title: '批量导出', subtitle: '将馆藏中的原图按自定目录打包为 ZIP。',
    collection: '导出范围', groups: '插画组', allGroups: '全部插画组', noGroups: '选择插画组', emptyGroups: '暂无插画组。',
    searchGroups: '搜索插画组', noGroupMatches: '没有匹配的插画组。', selectMatches: '全选结果', clearMatches: '清除结果',
    dates: '日期范围', allDates: '不限日期', today: '今天',
    dateStart: '开始日期', dateEnd: '结束日期', dateParts: ['年', '月', '日'],
    openCalendar: '打开日历', dateError: '请选择有效的日期范围。',
    fileTypes: '文件类型', allTypes: '所有类型', noTypes: '选择类型', noExtension: '无扩展名',
    emptyTypes: '没有可选的文件类型。', selectAll: '全选', selectNone: '清除',
    organize: '整理文件', pattern: '文件名与相对路径', patternPlaceholder: '例如 画集/春日/窗边',
    insertField: '插入字段', patternHint: '用 / 分隔文件夹，原图扩展名会自动保留。',
    aggregation: '聚合键', data: '数据键', removeKey: '移除字段', searchKeys: '搜索字段', noKeys: '没有匹配的字段。',
    keyGroups: { group: '插画组与颜色组', archived: '导入与导出时间', file: '文件', image: '图片属性', sequence: '文件序号' },
    preview: '目录预览', fileLimit: '每层预览上限', root: 'Artifex.zip', other: '其他',
    emptyPreview: '这个范围内暂无可导出的文件。', adjustPreview: '修正路径后即可预览。',
    shownMore: (count) => `… 另有 ${count} 个文件`, files: (count) => `${count} 个文件`, selected: (count) => `已选 ${count} 项`,
    errors: { empty: '请填写文件名。', key: '存在不可用字段，请移除后再试。', characters: '路径中包含不允许的字符。',
      relative: '路径各段不能为空，也不能使用保留名称或以点、空格结尾。', length: '相对路径过长，请缩短文件名或减少目录层级。' },
    close: '关闭', cancel: '取消', submit: '下载 ZIP', preparing: '正在准备', started: '已交给浏览器下载。',
    loading: '正在读取馆藏…', loadError: '无法读取导出数据。', retry: '重试', saveError: '无法保存导出设置。',
    downloadError: '无法开始下载。请检查原图是否可用后重试。',
  },
  en: {
    title: 'Batch export', subtitle: 'Arrange original illustrations in folders and download them as a ZIP.',
    collection: 'Export scope', groups: 'Groups', allGroups: 'All groups', noGroups: 'Choose groups', emptyGroups: 'There are no groups yet.',
    searchGroups: 'Search groups', noGroupMatches: 'No matching groups.', selectMatches: 'Select results', clearMatches: 'Clear results',
    dates: 'Date range', allDates: 'All dates', today: 'Today',
    dateStart: 'Start date', dateEnd: 'End date', dateParts: ['Year', 'Month', 'Day'],
    openCalendar: 'Open calendar', dateError: 'Choose a valid date range.',
    fileTypes: 'File types', allTypes: 'All types', noTypes: 'Choose file types', noExtension: 'No extension',
    emptyTypes: 'There are no file types to choose from.', selectAll: 'Select all', selectNone: 'Clear',
    organize: 'Arrange the files', pattern: 'Filename and relative path', patternPlaceholder: 'e.g. Album/Spring/Window',
    insertField: 'Insert field', patternHint: 'Use / to separate folders. Original file extensions are preserved.',
    aggregation: 'Grouping fields', data: 'Data fields', removeKey: 'Remove field', searchKeys: 'Search fields', noKeys: 'No matching fields.',
    keyGroups: { group: 'Groups and color groups', archived: 'Import and export time', file: 'File', image: 'Image properties', sequence: 'File sequence' },
    preview: 'Folder preview', fileLimit: 'Preview limit per folder', root: 'Artifex.zip', other: 'Other',
    emptyPreview: 'There are no files in this selection.', adjustPreview: 'Correct the path to see a preview.',
    shownMore: (count) => `… ${count} more files`, files: (count) => `${count} ${count === 1 ? 'file' : 'files'}`, selected: (count) => `${count} selected`,
    errors: { empty: 'Enter a filename.', key: 'Remove the unavailable field to continue.', characters: 'The path contains an unsupported character.',
      relative: 'Use nonempty path segments and avoid reserved names, trailing dots and spaces.', length: 'Shorten the names or use fewer folders in the relative path.' },
    close: 'Close', cancel: 'Cancel', submit: 'Download ZIP', preparing: 'Preparing', started: 'Download sent to your browser.',
    loading: 'Reading the collection…', loadError: 'Could not load export data.', retry: 'Retry', saveError: 'Could not save the export settings.',
    downloadError: 'Could not start the download. Check that the original files are available and try again.',
  },
};

const icons = { archive: Archive, 'arrow-right': ArrowRight, calendar: CalendarDays, 'chevron-down': ChevronDown,
  'chevron-right': ChevronRight, file: File, folder: Folder, image: Image, layers: Layers, plus: Plus, search: Search };

function Icon({ name, ...props }) {
  const Glyph = icons[name];
  return <Glyph aria-hidden="true" {...props} />;
}

function toggleSelection(selection, options, value) {
  const next = new Set(selection ?? options);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next.size === options.length && options.every((option) => next.has(option)) ? null : [...next];
}

function OptionPicker({ label, summary, minWidth, maxWidth, children }) {
  const id = useId();
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="export-field">
      <span className="export-label" id={`${id}-label`}>{label}</span>
      <button type="button" ref={anchor} className="export-input export-picker" aria-labelledby={`${id}-label ${id}-summary`}
        aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <span id={`${id}-summary`}>{summary}</span><Icon name="chevron-down" size={16} />
      </button>
      <ExportPopover open={open} anchorRef={anchor} onDismiss={(reason) => {
        setOpen(false);
        if (reason === 'escape') anchor.current.focus({ preventScroll: true });
      }} className="export-picker-panel" id={id}
        minWidth={minWidth} maxWidth={maxWidth}>{children}</ExportPopover>
    </div>
  );
}

function SelectionActions({ onAll, onNone, t, matches }) {
  return (
    <div className="export-selection-actions">
      <button type="button" onClick={onAll}>{matches ? t.selectMatches : t.selectAll}</button>
      <button type="button" onClick={onNone}>{matches ? t.clearMatches : t.selectNone}</button>
    </div>
  );
}

function GroupPicker({ groups, selection, onChange, t }) {
  const [search, setSearch] = useState('');
  const list = useRef(null);
  const ids = useMemo(() => groups.map(({ id }) => id), [groups]);
  const selected = useMemo(() => new Set(selection ?? ids), [selection, ids]);
  const chosen = groups.filter(({ id }) => selected.has(id));
  const terms = search.normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = groups.filter(({ id, name }) => {
    const text = (name + ' ' + id).normalize('NFKC').toLowerCase();
    return terms.every((term) => text.includes(term));
  });
  const summary = selection === null ? t.allGroups : chosen.length === 0 ? t.noGroups
    : chosen.length === 1 ? chosen[0].name : t.selected(chosen.length);

  function selectMatches(include) {
    const next = new Set(selected);
    for (const { id } of matches) {
      if (include) next.add(id);
      else next.delete(id);
    }
    onChange(ids.every((id) => next.has(id)) ? null : [...next]);
  }

  return (
    <OptionPicker label={t.groups} summary={summary} minWidth={380} maxWidth={530}>
      {groups.length ? <>
        <label className="export-key-search export-group-search">
          <Icon name="search" size={16} />
          <input type="search" aria-label={t.searchGroups} placeholder={t.searchGroups} value={search} onChange={(event) => {
            setSearch(event.target.value);
            if (list.current) list.current.scrollTop = 0;
          }} />
        </label>
        <div className="export-group-toolbar">
          <span role="status">{t.selected(chosen.length)} / {ids.length}</span>
          <SelectionActions onAll={() => selectMatches(true)} onNone={() => selectMatches(false)} matches={terms.length > 0} t={t} />
        </div>
        <div className="export-option-list export-group-options" ref={list}>
          {matches.length ? matches.map(({ id, name, illustration_count }) => (
            <label className="export-choice" key={id} title={name}>
              <input type="checkbox" checked={selected.has(id)} onChange={() => onChange(toggleSelection(selection, ids, id))} />
              <span>{name}</span><small>{illustration_count}</small>
            </label>
          )) : <p className="export-panel-empty">{t.noGroupMatches}</p>}
        </div>
      </> : <p className="export-panel-empty">{t.emptyGroups}</p>}
    </OptionPicker>
  );
}

function ExtensionPicker({ extensions, selection, onChange, t }) {
  const chosen = extensions.filter((extension) => selection?.includes(extension));
  const summary = selection === null ? t.allTypes : chosen.length === 0 ? t.noTypes
    : chosen.length === 1 ? chosen[0] || t.noExtension : t.selected(chosen.length);

  return (
    <OptionPicker label={t.fileTypes} summary={summary}>
      {extensions.length ? <>
        <SelectionActions onAll={() => onChange(null)} onNone={() => onChange([])} t={t} />
        <div className="export-option-list export-option-columns">
          {extensions.map((extension) => (
            <label className="export-choice" key={extension}>
              <input type="checkbox" checked={selection === null || selection.includes(extension)}
                onChange={() => onChange(toggleSelection(selection, extensions, extension))} />
              <span>{extension ? `.${extension}` : t.noExtension}</span>
            </label>
          ))}
        </div>
      </> : <p className="export-panel-empty">{t.emptyTypes}</p>}
    </OptionPicker>
  );
}

const datePlaceholders = ['YYYY', 'MM', 'DD'];

function DateField({ label, value, min, invalid, errorId, onChange, t }) {
  const id = useId();
  const segments = useRef([]);
  const calendar = useRef(null);
  const showCalendar = typeof HTMLInputElement.prototype.showPicker === 'function';
  const parts = value.split('-');

  function setPart(index, part) {
    const next = datePlaceholders.map((_, partIndex) => partIndex === index ? part : parts[partIndex] ?? '');
    onChange(next.some(Boolean) ? next.join('-') : '');
  }

  function pasteDate(event) {
    const pasted = event.clipboardData.getData('text').normalize('NFKC').trim();
    const date = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(pasted) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(pasted);
    if (!date && !/[-/]/.test(pasted)) return;
    event.preventDefault();
    if (date) onChange(`${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`);
  }

  return (
    <div className="export-date-field">
      <label id={`${id}-label`} htmlFor={`${id}-0`}>{label}</label>
      <div className="export-input export-date-control" role="group" aria-labelledby={`${id}-label`} data-invalid={invalid || undefined}>
        {datePlaceholders.map((placeholder, index) => (
          <span className="export-date-part" key={placeholder}>
            {index > 0 && <span aria-hidden="true">/</span>}
            <input ref={(element) => { segments.current[index] = element; }} id={`${id}-${index}`}
              className="export-date-segment" type="text" inputMode="numeric" autoComplete="off"
              maxLength={placeholder.length} placeholder={placeholder} value={parts[index] ?? ''}
              aria-label={`${label} · ${t.dateParts[index]}`} aria-invalid={invalid}
              aria-describedby={invalid ? errorId : undefined} onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                const part = event.currentTarget.value.normalize('NFKC').replace(/\D/g, '').slice(0, placeholder.length);
                setPart(index, part);
                if (part.length === placeholder.length) segments.current[index + 1]?.focus();
              }} onBlur={(event) => {
                const part = event.currentTarget.value;
                if (index > 0 && /^\d$/.test(part)) setPart(index, `0${part}`);
              }} onKeyDown={(event) => {
                if (event.key !== '/' && event.key !== '-') return;
                event.preventDefault();
                const { value: part, selectionStart, selectionEnd } = event.currentTarget;
                if (part && selectionStart === selectionEnd) {
                  segments.current[index + 1]?.focus();
                }
              }} onPaste={pasteDate} />
          </span>
        ))}
        {showCalendar && <>
          <input ref={calendar} className="export-native-date" type="date" min={min || '0001-01-01'} max="9999-12-31"
            tabIndex={-1} aria-hidden="true" value={isExportDate(value) ? value : ''} onChange={(event) => {
              if (isExportDate(event.target.value)) onChange(event.target.value);
            }} />
          <button type="button" className="export-date-calendar" title={t.openCalendar} aria-label={`${t.openCalendar} · ${label}`}
            onClick={() => calendar.current.showPicker()}>
            <Icon name="calendar" size={17} />
          </button>
        </>}
      </div>
    </div>
  );
}

function DateScope({ draft, update, t }) {
  const allDates = draft.dateMode === 'all';
  const start = allDates ? '' : draft.start;
  const end = allDates ? '' : draft.end;
  const today = localDate();
  const [editing, setEditing] = useState(false);
  const dateError = !allDates && !editing && !isExportDateRange(start, end);
  const errorId = useId();

  function setDates(nextStart, nextEnd) {
    const dateMode = nextStart || nextEnd ? 'range' : 'all';
    if (dateMode !== draft.dateMode || nextStart !== start || nextEnd !== end) {
      update({ dateMode, start: nextStart, end: nextEnd });
    }
  }

  return (
    <fieldset className="export-field export-date-scope"
      onFocus={(event) => setEditing(event.target.classList.contains('export-date-segment'))}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setEditing(false);
      }}>
      <legend className="export-label">{t.dates}</legend>
      <div className="export-date-card">
        <div className="export-date-inputs">
          <DateField label={t.dateStart} value={start} invalid={dateError} errorId={errorId} t={t}
            onChange={(value) => setDates(value, end)} />
          <Icon name="arrow-right" size={15} />
          <DateField label={t.dateEnd} value={end} min={isExportDate(start) ? start : undefined}
            invalid={dateError} errorId={errorId} t={t} onChange={(value) => setDates(start, value)} />
        </div>
        <div className="export-date-toolbar">
          <button type="button" aria-pressed={allDates} onClick={() => setDates('', '')}>{t.allDates}</button>
          <button type="button" aria-pressed={start === today && end === today} onClick={() => setDates(today, today)}>
            <Icon name="calendar" size={14} />{t.today}
          </button>
        </div>
      </div>
      {dateError && <p className="export-error" role="alert" id={errorId}>{t.dateError}</p>}
    </fieldset>
  );
}

function selectionRange(editor) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return editor.contains(range.startContainer) && editor.contains(range.endContainer) ? range : null;
}

function selectRange(range) {
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function createToken(key) {
  const chip = document.createElement('span');
  chip.className = 'export-token';
  chip.dataset.key = key;
  chip.contentEditable = 'false';

  const label = document.createElement('span');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'export-token-remove';
  chip.append(label, remove);
  return chip;
}

function labelToken(chip, labels, t) {
  const name = labels.get(chip.dataset.key);
  const label = name ?? chip.dataset.key.split(':').at(-1);
  chip.firstChild.textContent = label;
  chip.lastChild.setAttribute('aria-label', `${t.removeKey} · ${label}`);
  chip.classList.toggle('is-unavailable', !name);
}

function* patternNodes(container) {
  for (const node of container.childNodes) {
    if (node.nodeType === Node.TEXT_NODE || (node instanceof HTMLElement && node.dataset.key)) yield node;
    else yield* patternNodes(node);
  }
}

function readPattern(editor) {
  const pattern = [];
  for (const node of patternNodes(editor)) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.data) continue;
      if (typeof pattern.at(-1) === 'string') pattern[pattern.length - 1] += node.data;
      else pattern.push(node.data);
    } else pattern.push({ key: node.dataset.key });
  }
  return pattern;
}

function markPatternErrors(editor, errorRanges) {
  const registry = window.CSS?.highlights;
  const highlight = registry && window.Highlight ? new window.Highlight() : null;
  let offset = 0;
  let firstRange = 0;
  for (const node of patternNodes(editor)) {
    const isText = node.nodeType === Node.TEXT_NODE;
    const end = offset + (isText ? node.length : 1);
    while (errorRanges[firstRange]?.[1] <= offset) firstRange++;

    if (!isText) node.classList.toggle('has-path-error', errorRanges[firstRange]?.[0] < end);
    else if (highlight) {
      for (let index = firstRange; errorRanges[index]?.[0] < end; index++) {
        const [start, finish] = errorRanges[index];
        const range = document.createRange();
        range.setStart(node, Math.max(start, offset) - offset);
        range.setEnd(node, Math.min(finish, end) - offset);
        highlight.add(range);
      }
    }
    offset = end;
  }
  if (!highlight?.size) return undefined;
  registry.set('export-path-error', highlight);
  return () => {
    if (registry.get('export-path-error') === highlight) registry.delete('export-path-error');
  };
}

function adjacentToken(editor, range, before) {
  if (!range?.collapsed) return null;
  let { startContainer: node, startOffset: offset } = range;
  if (node.nodeType === Node.TEXT_NODE && (before ? offset > 0 : offset < node.length)) return null;
  const step = before ? 'previousSibling' : 'nextSibling';
  let neighbor = node.childNodes[offset - (before ? 1 : 0)];
  while (node && (!neighbor || (neighbor.nodeType === Node.TEXT_NODE && neighbor.length === 0))) {
    if (neighbor) node = neighbor;
    if (node === editor) return null;
    neighbor = node[step];
    if (!neighbor) node = node.parentNode;
  }
  return neighbor instanceof HTMLElement && neighbor.classList.contains('export-token') ? neighbor : null;
}

function KeyPalette({ columns, insertKey, t }) {
  const [search, setSearch] = useState('');
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);

  return (
    <>
      <label className="export-key-search">
        <Icon name="search" size={16} />
        <input type="search" aria-label={t.searchKeys} placeholder={t.searchKeys} value={search}
          onChange={(event) => setSearch(event.target.value)} />
      </label>
      <div className="export-key-columns">
        {columns.map((keys, index) => {
          const title = index === 0 ? t.aggregation : t.data;
          const groups = new Map();
          for (const key of keys) {
            const text = `${key.keywords} ${t.keyGroups[key.group]} ${title}`.toLowerCase();
            if (!terms.every((term) => text.includes(term))) continue;
            if (!groups.has(key.group)) groups.set(key.group, []);
            groups.get(key.group).push(key);
          }
          return <section key={title} className="export-key-column" aria-label={title}>
            <h4><Icon name={index === 0 ? 'layers' : 'file'} size={15} />{title}</h4>
            <div className="export-key-options">
              {[...groups].map(([group, fields]) => (
                <div className="export-key-group" key={group}>
                  <h5>{t.keyGroups[group]}</h5>
                  <div className="export-key-tiles">
                    {fields.map(({ id, label }) => (
                      <button type="button" key={id} onPointerDown={(event) => event.preventDefault()}
                        onClick={() => insertKey(id)}>{label}</button>
                    ))}
                  </div>
                </div>
              ))}
              {groups.size === 0 && <p className="export-panel-empty">{t.noKeys}</p>}
            </div>
          </section>;
        })}
      </div>
    </>
  );
}

function FilenameEditor({ pattern, columns, labels, onChange, error, errorRanges, t }) {
  const id = useId();
  const anchor = useRef(null);
  const editor = useRef(null);
  const initialPattern = useRef(pattern);
  const caret = useRef(null);
  const composing = useRef(false);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const element = editor.current;
    element.replaceChildren(...initialPattern.current.map((part) =>
      typeof part === 'string' ? document.createTextNode(part) : createToken(part.key)));

    function preventFormatting(event) {
      if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak' || event.inputType?.startsWith('format')) {
        event.preventDefault();
      }
    }
    element.addEventListener('beforeinput', preventFormatting);
    return () => element.removeEventListener('beforeinput', preventFormatting);
  }, []);

  useLayoutEffect(() => {
    editor.current.querySelectorAll('.export-token').forEach((chip) => labelToken(chip, labels, t));
  }, [labels, t]);

  useLayoutEffect(() => markPatternErrors(editor.current, errorRanges), [errorRanges]);

  function rememberCaret() {
    const range = selectionRange(editor.current);
    if (range) caret.current = range.cloneRange();
  }

  function syncPattern() {
    if (composing.current) return;
    onChange(readPattern(editor.current));
    rememberCaret();
  }

  function insert(node) {
    const range = selectionRange(editor.current) ?? caret.current ?? document.createRange();
    if (!editor.current.contains(range.startContainer)) {
      range.selectNodeContents(editor.current);
      range.collapse(false);
    }
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    editor.current.focus({ preventScroll: true });
    selectRange(range);
    syncPattern();
  }

  function remove(chip) {
    const range = document.createRange();
    range.setStartBefore(chip);
    range.collapse(true);
    chip.remove();
    editor.current.focus({ preventScroll: true });
    selectRange(range);
    syncPattern();
  }

  function insertKey(key) {
    const chip = createToken(key);
    labelToken(chip, labels, t);
    insert(chip);
  }

  function onKeyDown(event) {
    if (event.target !== editor.current || event.nativeEvent.isComposing) return;
    if (!['Backspace', 'Delete', 'Enter'].includes(event.key)) return;
    const range = selectionRange(editor.current);
    const chip = adjacentToken(editor.current, range, event.key !== 'Delete');
    if (event.key === 'Enter' || chip) event.preventDefault();
    if (chip && event.key !== 'Enter') remove(chip);
  }

  return (
    <div className="export-field">
      <span className="export-label" id={`${id}-label`}>{t.pattern}</span>
      <div className="export-pattern-wrap" ref={anchor}>
        <div ref={editor} className="export-input export-pattern" role="textbox" tabIndex={0} contentEditable
          suppressContentEditableWarning spellCheck={false} aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-help`} aria-invalid={Boolean(error)} aria-placeholder={t.patternPlaceholder} data-empty={!pattern.some(Boolean)}
          data-placeholder={t.patternPlaceholder} onFocus={() => setOpen(true)} onPointerUp={rememberCaret} onBlur={rememberCaret}
          onKeyDown={onKeyDown} onKeyUp={rememberCaret} onInput={syncPattern} onDrop={(event) => event.preventDefault()}
          onClick={(event) => {
            setOpen(true);
            const removeButton = event.target.closest('.export-token-remove');
            if (removeButton) remove(removeButton.parentElement);
          }}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; syncPattern(); }}
          onPaste={(event) => {
            event.preventDefault();
            const value = event.clipboardData.getData('text/plain');
            if (value) insert(document.createTextNode(value));
          }} />
        <button type="button" className="export-open-keys" aria-label={t.insertField} aria-expanded={open}
          aria-controls={`${id}-keys`} onPointerDown={(event) => event.preventDefault()} onClick={() => setOpen((value) => !value)}>
          <Icon name="plus" size={15} /><span>{t.insertField}</span>
        </button>
      </div>
      <ExportPopover open={open} anchorRef={anchor} onDismiss={(reason) => {
        if (reason === 'escape' && !anchor.current.contains(document.activeElement)) {
          editor.current.focus({ preventScroll: true });
          if (caret.current) selectRange(caret.current);
        }
        setOpen(false);
      }} className="export-key-palette" id={`${id}-keys`} minWidth={590} maxWidth={700}>
        <KeyPalette columns={columns} insertKey={insertKey} t={t} />
      </ExportPopover>
      <p id={`${id}-help`} className={error ? 'export-error' : 'export-field-hint'} role={error ? 'alert' : undefined}>
        {error ? t.errors[error] : t.patternHint}
      </p>
    </div>
  );
}

function PreviewFolder({ folder, level, firstBranch, limit, t }) {
  const [open, setOpen] = useState(level === 0 || firstBranch);
  return (
    <details open={open} className="export-tree-folder" onToggle={(event) => {
      if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
    }}>
      <summary className="export-tree-row">
        <Icon className="export-tree-caret" name="chevron-right" size={13} />
        <Icon className="export-folder-icon" name="folder" size={16} /><span title={folder.name}>{folder.name}</span>
      </summary>
      {open && <FolderContents folder={folder} level={level + 1} firstBranch={firstBranch} limit={limit} t={t} />}
    </details>
  );
}

function FolderContents({ folder, level, firstBranch, limit, t }) {
  return (
    <ul className="export-tree-level">
      {[...folder.folders.values()].map((child, index) => (
        <li key={child.path}>
          <PreviewFolder folder={child} level={level} firstBranch={firstBranch && index === 0} limit={limit} t={t} />
        </li>
      ))}
      {folder.files.slice(0, limit).map(({ name }) => (
        <li className="export-tree-row export-tree-file" key={name}>
          <Icon name="image" size={15} />
          <span title={name}>{name}</span>
        </li>
      ))}
      {folder.files.length > limit && <li className="export-tree-more">{t.shownMore(folder.files.length - limit)}</li>}
    </ul>
  );
}

function ExportPreview({ preview, fileLimit, update, headingRef, t }) {
  const id = useId();
  const { root, entries, error } = preview;
  const limit = previewLimit(fileLimit);
  return (
    <aside className="export-preview" aria-labelledby={id}>
      <h3 id={id} ref={headingRef} tabIndex={-1}>{t.preview}</h3>
      <div className="export-preview-paper">
        <div className="export-tree-root">
          <Icon name="folder" size={18} /><strong title={root.name}>{root.name || t.root}</strong>
        </div>
        <div className="export-tree-scroll">
          {entries.length ? <FolderContents folder={root} level={0} firstBranch limit={limit} t={t} /> : (
            <p className="export-tree-empty"><Icon name="archive" size={23} />{error ? t.adjustPreview : t.emptyPreview}</p>
          )}
        </div>
        <div className="export-preview-footer">
          <label>{t.fileLimit}
            <input type="number" min="1" max="100" step="1" className="export-input" value={fileLimit}
              onChange={(event) => update({ fileLimit: event.target.value })}
              onBlur={() => update({ fileLimit: limit })} />
          </label>
        </div>
      </div>
    </aside>
  );
}


const draftWrites = new Map();

function queueDraft(scope, draft) {
  const previous = draftWrites.get(scope);
  const write = (previous ?? Promise.resolve()).catch(() => {}).then(() => saveExportDraft(scope, getExportDraft(draft)));
  draftWrites.set(scope, write);
  const clear = () => { if (draftWrites.get(scope) === write) draftWrites.delete(scope); };
  write.then(clear, clear);
  return write;
}

function ExportDialog({ onClose, t, children }) {
  const id = useId();
  const ref = useRef(null);
  const backdropPointer = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  function isBackdrop(event) {
    if (event.target !== event.currentTarget) return false;
    const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
    return event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom;
  }

  return (
    <dialog ref={ref} className="export-dialog" aria-labelledby={id} onCancel={(event) => {
      event.preventDefault();
      onClose();
    }} onPointerDown={(event) => {
      backdropPointer.current = event.button === 0 && isBackdrop(event) ? event.pointerId : null;
    }} onPointerUp={(event) => {
      if (backdropPointer.current === event.pointerId && isBackdrop(event)) onClose();
      backdropPointer.current = null;
    }} onPointerCancel={() => { backdropPointer.current = null; }}>
      <header className="export-dialog-heading">
        <div>
          <h2 id={id}>{t.title}</h2>
          <p>{t.subtitle}</p>
        </div>
        <button type="button" className="export-close" aria-label={t.close} onClick={onClose}><X size={17} /></button>
      </header>
      {children}
    </dialog>
  );
}

function ExportForm({ scope, groups, items, groupSettings, savedDraft, onClose, language, t }) {
  const [draft, setDraft] = useState(() => getExportDraft(savedDraft));
  const draftRef = useRef(draft);
  const saveTimer = useRef(null);
  const downloadRequest = useRef(null);
  const previewHeading = useRef(null);
  const [preparing, setPreparing] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const { addToast } = useToast();
  const groupItems = useMemo(() => {
    if (draft.groupIds === null || scope !== 'all') return items;
    const selected = new Set(draft.groupIds);
    return items.filter(({ group_id: id }) => selected.has(id));
  }, [draft.groupIds, items, scope]);
  const extensions = useMemo(() => getExtensionOptions(items), [items]);
  const dateItems = useMemo(() => {
    if (draft.dateMode === 'all') return groupItems;
    if (!isExportDateRange(draft.start, draft.end)) return [];
    return groupItems.filter((item) => {
      const day = archiveDay(item);
      return day >= draft.start && day <= draft.end;
    });
  }, [draft.dateMode, draft.start, draft.end, groupItems]);
  const colorGroups = useMemo(() => getColorGroups(items, groupSettings, t.other), [groupSettings, items, t.other]);
  const columns = useMemo(() => getExportKeys(language), [language]);
  const labels = useMemo(() => new Map(columns.flat().map(({ id, label }) => [id, label])), [columns]);
  const preview = useMemo(() => buildExportTree({
    illustrations: dateItems, draft, keys: labels, language, colorGroups, other: t.other,
  }), [colorGroups, dateItems, draft, labels, language, t.other]);

  useEffect(() => () => {
    downloadRequest.current?.abort();
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
      void queueDraft(scope, draftRef.current).catch(() => {});
    }
  }, [scope]);

  function update(fields) {
    const next = { ...draftRef.current, ...fields };
    draftRef.current = next;
    setDraft(next);
    setDownloadError(false);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      queueDraft(scope, next).then(() => setSaveError(false), () => setSaveError(true));
    }, 220);
  }

  async function startDownload() {
    if (downloadRequest.current) return;
    const controller = new AbortController();
    downloadRequest.current = controller;
    setPreparing(true);
    setDownloadError(false);
    try {
      const { url } = await prepareExport(preview.entries, controller.signal);
      if (controller.signal.aborted) return;
      const link = document.createElement('a');
      link.href = backendUrl(url);
      link.download = '';
      link.rel = 'noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
      addToast(t.started);
      onClose();
    } catch {
      if (!controller.signal.aborted) setDownloadError(true);
    } finally {
      downloadRequest.current = null;
      if (!controller.signal.aborted) setPreparing(false);
    }
  }

  return (
    <>
      <div className="export-layout">
        <div className="export-config">
          <section className="export-section" aria-label={t.collection}>
            <h3>{t.collection}</h3>
            <div className="export-scope-filters">
              {scope === 'all' ? <GroupPicker groups={groups} selection={draft.groupIds} t={t}
                onChange={(groupIds) => update({ groupIds })} /> : (
                <div className="export-field">
                  <span className="export-label">{t.groups}</span>
                  <span className="export-input export-fixed-scope" title={groups[0].name}>{groups[0].name}</span>
                </div>
              )}
              <ExtensionPicker extensions={extensions} selection={draft.extensions} t={t}
                onChange={(value) => update({ extensions: value })} />
            </div>
            <DateScope draft={draft} update={update} t={t} />
          </section>
          <section className="export-section" aria-label={t.organize}>
            <h3>{t.organize}</h3>
            <FilenameEditor pattern={draft.pattern} columns={columns} labels={labels} error={preview.error} errorRanges={preview.errorRanges}
              onChange={(pattern) => update({ pattern })} t={t} />
          </section>
        </div>
        <ExportPreview preview={preview} fileLimit={draft.fileLimit} update={update} headingRef={previewHeading} t={t} />
      </div>
      <footer>
        <div className="export-actions">
          <div className="export-summary">
            <span className="export-file-count" role="status"><File size={16} />{t.files(preview.entries.length)}</span>
            <button type="button" className="export-preview-link" onClick={() => {
              const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
              previewHeading.current.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'instant' : 'smooth' });
              previewHeading.current.focus({ preventScroll: true });
            }}>{t.preview}<ArrowRight size={14} /></button>
          </div>
          <div className="export-action-buttons">
            <button type="button" className="export-button" onClick={onClose}>{t.cancel}</button>
            <button type="button" className="export-button export-submit" disabled={preparing || !preview.entries.length}
              aria-busy={preparing} onClick={startDownload}>
              {preparing ? <LoaderCircle className="motion-safe:animate-spin" size={17} /> : <Download size={17} />}
              {preparing ? t.preparing : t.submit}
            </button>
          </div>
        </div>
        {(downloadError || saveError) && <p className="export-error export-footer-error" role="alert">{downloadError ? t.downloadError : t.saveError}</p>}
      </footer>
    </>
  );
}

export default function BatchExportModal({ groups, groupId, onClose }) {
  const { locale } = useLocale();
  const t = copy[locale] ?? copy.en;
  const scope = groupId ?? 'all';
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([
      getExportCatalog(scope, signal),
      (draftWrites.get(scope) ?? Promise.resolve()).catch(() => {}).then(() => loadExportDraft(scope, signal)),
      loadGroupSettings(),
    ]).then(([items, savedDraft, groupSettings]) => {
      if (!signal.aborted) setData({ items, savedDraft, groupSettings });
    }, () => {
      if (!signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [attempt, scope]);

  return (
    <ExportDialog t={t} onClose={onClose}>
      {data ? <ExportForm scope={scope} groups={groups} onClose={onClose} language={locale} t={t} {...data} /> : (
        <div className="export-status">
          {failed ? <>
            <p role="alert">{t.loadError}</p>
            <button type="button" className="export-button" onClick={() => {
              setFailed(false);
              setAttempt((value) => value + 1);
            }}>{t.retry}</button>
          </> : <>
            <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" size={23} />
            <p role="status">{t.loading}</p>
          </>}
        </div>
      )}
    </ExportDialog>
  );
}
