import { getIllustrationMemberships, groupDisplayName } from './grouping';

const groupKeys = [
  ['groupName', '插画组名称', 'Group name'], ['groupId', '插画组 ID', 'Group ID'],
  ['colorName', '颜色组名称', 'Color group name'], ['colorId', '颜色组 ID', 'Color group ID'],
];
const archiveKeys = [
  ['created', '导入日期', 'Import date'], ['year', '导入年', 'Import year'],
  ['month', '导入月', 'Import month'], ['day', '导入日', 'Import day'],
];
const extensionKey = ['extension', '扩展名', 'Extension'];
const keyGroups = [
  {
    group: groupKeys,
    archived: [
      ...archiveKeys, ['yearMonth', '导入年月', 'Import year and month'],
      ['yearDay', '导入年日', 'Import year and day'], ['monthDay', '导入月日', 'Import month and day'],
    ],
    file: [extensionKey],
  },
  {
    file: [
      ['original', '原文件名', 'Original name'], extensionKey, ['bytes', '文件大小字节', 'Size in bytes'],
      ['mimeType', '媒体类型', 'Media type'],
    ],
    image: [
      ['id', '插画 ID', 'Illustration ID'], ['width', '图片宽度', 'Image width'], ['height', '图片高度', 'Image height'],
    ],
    group: groupKeys,
    archived: [
      ...archiveKeys, ['exportDate', '导出日期', 'Export date'], ['exportTime', '导出时间', 'Export time'],
    ],
    sequence: [['exportIndex', '导出序号', 'Export number']],
  },
];

const invalidLiteral = /[<>:"|?*\p{Cc}]+/gu;
const invalidSegment = /[<>:"|?*\\/\p{Cc}]/gu;
const pathSeparator = /[\\/]/;
const deviceName = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³]) *(?:\.|$)/i;
const maxSegments = 24;
const maxSegmentBytes = 200;
const maxPathBytes = 4096;

const pad = (value, digits = 2) => String(value).padStart(digits, '0');
const keyType = ['aggregation', 'data'];

export function localDate(date = new Date()) {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isExportDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value);
}

export function isExportDateRange(start, end) {
  return isExportDate(start) && isExportDate(end) && start <= end;
}

export function archiveDay(illustration) {
  return illustration.created_at?.slice(0, 10) || '';
}

export function getExportDraft(saved) {
  const readArray = (value, test) => Array.isArray(value) ? [...new Set(value.filter(test))] : null;
  const readDate = (value) => typeof value === 'string' && /^\d{0,4}(?:-\d{0,2}){0,2}$/.test(value) ? value : '';
  return {
    groupIds: readArray(saved?.groupIds, Number.isSafeInteger),
    extensions: readArray(saved?.extensions, (value) => typeof value === 'string'),
    dateMode: saved?.dateMode === 'range' ? 'range' : 'all',
    start: readDate(saved?.start),
    end: readDate(saved?.end),
    pattern: Array.isArray(saved?.pattern)
      ? saved.pattern.filter((part) => typeof part === 'string' || typeof part?.key === 'string')
      : [{ key: 'aggregation:groupName' }, '/', { key: 'data:original' }],
    fileLimit: previewLimit(saved?.fileLimit),
  };
}

export function previewLimit(value) {
  return Math.min(100, Math.max(1, Math.floor(Number(value) || 5)));
}

function splitFileName(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1
    ? { original: name.slice(0, dot), extension: name.slice(dot + 1) }
    : { original: name, extension: '' };
}

export function getExtensionOptions(illustrations) {
  return [...new Set(illustrations.map(({ original_filename: name }) => splitFileName(name).extension.toLowerCase()))].sort();
}

export function getExportKeys(language) {
  return keyGroups.map((keys, index) => Object.entries(keys).flatMap(([group, fields]) => fields.map(([id, zh, en]) => ({
    id: `${keyType[index]}:${id}`,
    label: language === 'zh' ? zh : en,
    group,
    keywords: `${zh} ${en} ${id}`,
  }))));
}

export function getColorGroups(illustrations, settings, other) {
  const byGroup = new Map();
  for (const illustration of illustrations) {
    const id = illustration.group_id;
    if (!byGroup.has(id)) byGroup.set(id, []);
    byGroup.get(id).push(illustration);
  }

  const result = new Map();
  for (const [id, items] of byGroup) {
    const config = settings.groups[id]?.colors;
    const active = config?.sets.find((set) => set.id === config.active_id);
    if (!active?.pairs.length) continue;
    const names = new Map(active.pairs.map((pair) => [pair.id, groupDisplayName(pair)]));
    const memberships = getIllustrationMemberships(items, active.pairs, active.match_order, active.manual_assignments);
    for (const [illustrationId, { effectiveGroupId, source }] of memberships) {
      result.set(illustrationId, { id: effectiveGroupId, name: source === 'other' ? other : names.get(effectiveGroupId) || other });
    }
  }
  return result;
}

function pathParts(path) {
  let offset = 0;
  return path.split(pathSeparator).map((text) => {
    const part = { text, start: offset, end: offset + text.length };
    offset = part.end + 1;
    return part;
  });
}

function relativePathErrors(parts, length) {
  return parts.flatMap(({ text, start, end }) => {
    if (!text) {
      const separator = Math.min(start, length - 1);
      return [[separator, separator + 1]];
    }
    if (deviceName.test(text)) return [[start, end]];
    const trailing = text.match(/[. ]+$/);
    return trailing ? [[start + trailing.index, end]] : [];
  });
}

// Text offsets use UTF-16, with one position reserved for each field chip.
function validatePattern(pattern, sample, keys) {
  if (!sample.trim()) return { error: 'empty', errorRanges: sample ? [[0, sample.length]] : [] };

  let offset = 0;
  const unavailable = [];
  for (const part of pattern) {
    if (typeof part === 'string') offset += part.length;
    else {
      if (!keys.has(part.key)) unavailable.push([offset, offset + 1]);
      offset += 1;
    }
  }
  if (unavailable.length) return { error: 'key', errorRanges: unavailable };

  const characters = Array.from(sample.matchAll(invalidLiteral), (match) => [match.index, match.index + match[0].length]);
  if (characters.length) return { error: 'characters', errorRanges: characters };

  const parts = pathParts(sample);
  if (parts.length > maxSegments) {
    return { error: 'length', errorRanges: [[parts[maxSegments].start - 1, sample.length]] };
  }
  if (utf8Length(sample) > maxPathBytes) {
    return { error: 'length', errorRanges: [[trimUTF8(sample, maxPathBytes).length, sample.length]] };
  }
  const longNames = parts.filter(({ text }) => utf8Length(text) > maxSegmentBytes).map(({ start, end }) => [start, end]);
  if (longNames.length) return { error: 'length', errorRanges: longNames };

  const invalidParts = relativePathErrors(parts, sample.length);
  return invalidParts.length ? { error: 'relative', errorRanges: invalidParts } : { error: '', errorRanges: [] };
}

function utf8CharacterLength(character) {
  const point = character.codePointAt(0);
  if (point < 0x80) return 1;
  if (point < 0x800) return 2;
  return point < 0x10000 ? 3 : 4;
}

function utf8Length(value) {
  let bytes = 0;
  for (const character of value) bytes += utf8CharacterLength(character);
  return bytes;
}

function trimUTF8(value, maxBytes) {
  let length = 0;
  let bytes = 0;
  for (const character of value) {
    bytes += utf8CharacterLength(character);
    if (bytes > maxBytes) break;
    length += character.length;
  }
  return value.slice(0, length);
}

function safeName(value) {
  const normalized = trimUTF8(value.normalize('NFC').replace(invalidSegment, '_'), maxSegmentBytes).replace(/[. ]+$/, '');
  if (!normalized) return '_';
  return deviceName.test(normalized) ? `_${normalized}` : normalized;
}

function formatDateParts(parts, indices, language) {
  const suffixes = ['年', '月', '日'];
  return indices.filter((index) => parts[index]).map((index) => language === 'zh'
    ? `${parts[index].replace(/^0/, '')}${suffixes[index]}`
    : parts[index]).join(language === 'zh' ? '' : '-');
}

function makeFields(illustration, colorGroup, exportIndex, language, now, other) {
  const created = archiveDay(illustration);
  const parts = created.split('-');
  const [year, month, day] = parts;
  const exportDate = localDate(now);
  return {
    ...splitFileName(illustration.original_filename),
    groupName: illustration.group_name, groupId: illustration.group_id,
    colorName: colorGroup?.name || other, colorId: colorGroup?.id || 'other',
    id: illustration.id, width: illustration.width, height: illustration.height,
    bytes: illustration.file_size, mimeType: illustration.mime_type,
    created, year, month, day, exportDate,
    yearMonth: formatDateParts(parts, [0, 1], language),
    yearDay: formatDateParts(parts, [0, 2], language),
    monthDay: formatDateParts(parts, [1, 2], language),
    exportTime: `${exportDate}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`,
    exportIndex: pad(exportIndex, 3),
  };
}

function makeFolder(name, path = '') {
  return { name, path, folders: new Map(), files: [], usedNames: new Set(), nextDuplicates: new Map() };
}

// Match Go's simple Unicode lowercase mapping when comparing archive paths.
const pathKey = (name) => Array.from(name, (character) => character === 'İ' ? 'i' : character.toLowerCase()).join('');

function ensureFolders(root, parts) {
  let current = root;
  for (const name of parts) {
    const key = pathKey(name);
    if (!current.folders.has(key)) {
      current.folders.set(key, makeFolder(name, current.path + name + '/'));
      current.usedNames.add(key);
    }
    current = current.folders.get(key);
  }
  return current;
}

function insertFile(folder, name, id) {
  const { original, extension } = splitFileName(name);
  const suffix = extension ? `.${extension}` : '';
  const key = pathKey(name);
  let candidate = name;
  let duplicate = folder.nextDuplicates.get(key) ?? 1;
  while (folder.usedNames.has(pathKey(candidate))) {
    candidate = `${original}(${duplicate})${suffix}`;
    duplicate += 1;
  }
  folder.nextDuplicates.set(key, duplicate);
  folder.usedNames.add(pathKey(candidate));
  folder.files.push({ name: candidate });
  return { id, path: folder.path + candidate };
}

export function buildExportTree({ illustrations, draft, keys, language, colorGroups, other, now = new Date() }) {
  const root = makeFolder('');
  const sample = draft.pattern.map((part) => typeof part === 'string' ? part : '_').join('');
  const validation = validatePattern(draft.pattern, sample, keys);
  if (validation.error) return { root, entries: [], ...validation };

  const extensions = draft.extensions && new Set(draft.extensions);
  const files = [];
  for (const illustration of illustrations) {
    const fields = makeFields(illustration, colorGroups.get(illustration.id), files.length + 1, language, now, other);
    const extension = fields.extension.toLowerCase();
    if (extensions && !extensions.has(extension)) continue;
    const path = draft.pattern.map((part) => typeof part === 'string' ? part
      : String(fields[part.key.split(':')[1]] ?? '').replace(invalidSegment, '_')).join('').split(pathSeparator).map(safeName);
    const basename = path.pop();
    const suffix = extension && !basename.toLowerCase().endsWith(`.${extension}`) ? `.${safeName(fields.extension)}` : '';
    const name = trimUTF8(basename, maxSegmentBytes - utf8Length(suffix)) + suffix;
    files.push({ folder: ensureFolders(root, path), name: name || '_', id: illustration.id });
  }

  // Reserve every directory name before naming files, so a later folder can
  // never replace an earlier file whose generated name happened to match it.
  const entries = files.map(({ folder, name, id }) => insertFile(folder, name, id));
  const oversized = entries.find(({ path }) => utf8Length(path) > maxPathBytes);
  if (oversized) {
    const allowed = trimUTF8(oversized.path, maxPathBytes);
    const firstOverflow = allowed.split('/').length - 1;
    const parts = pathParts(sample);
    return { root: makeFolder(''), entries: [], error: 'length', errorRanges: [[parts[firstOverflow].start, sample.length]] };
  }
  return { root, entries, ...validation };
}
