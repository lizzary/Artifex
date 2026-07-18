import { useEffect, useState } from 'react';

const STORAGE_KEY = 'gallery-download-naming-format';

export const NAMING_TAGS = [
  { key: 'date', label: 'date' },
  { key: 'Resolution', label: 'Resolution' },
  { key: 'File Size', label: 'File Size' },
  { key: 'Date Created', label: 'Date Created' },
  { key: 'group', label: 'group' },
  { key: 'Model', label: 'model' },
  { key: 'Seed', label: 'seed' },
  { key: 'Sampler', label: 'sampler' },
  { key: 'Steps', label: 'step' },
  { key: 'CFG Scale', label: 'cfg scale' },
  { key: 'Lora', label: 'lora' },
];

const FORBIDDEN_RE = /[<>:"/\\|?*]/g;
const NULL_CHARACTER = String.fromCharCode(0);

function sanitizeFilename(name) {
  return name.replace(FORBIDDEN_RE, '').split(NULL_CHARACTER).join('').trim();
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatDateStr(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function formatFileSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function resolveFilename(format, illustration) {
  if (!format || !format.trim()) return illustration.original_filename;

  const originalName = illustration.original_filename || '';
  const dotIdx = originalName.lastIndexOf('.');
  const ext = dotIdx >= 0 ? originalName.slice(dotIdx + 1) : '';
  const extData = illustration.extended_data || {};

  const now = new Date();
  const created = illustration.created_at ? new Date(illustration.created_at) : now;

  const replacements = {
    '<date>': formatDateStr(now),
    '<Resolution>': `${illustration.width || 0}x${illustration.height || 0}`,
    '<File Size>': formatFileSize(illustration.file_size),
    '<Date Created>': formatDateStr(created),
    '<group>': illustration.group_name || '',
    '<Model>': extData['Model'] || '',
    '<Seed>': extData['Seed'] != null ? String(extData['Seed']) : '',
    '<Sampler>': extData['Sampler'] || '',
    '<Steps>': extData['Steps'] != null ? String(extData['Steps']) : '',
    '<CFG Scale>': extData['CFG Scale'] != null ? String(extData['CFG Scale']) : '',
  };

  // LoRA: check multiple key variants
  let loraVal = '';
  for (const k of ['Lora', 'LoRA', 'LoRAs', 'lora']) {
    if (extData[k]) { loraVal = String(extData[k]); break; }
  }
  replacements['<Lora>'] = loraVal;

  let filename = format;
  for (const [placeholder, value] of Object.entries(replacements)) {
    filename = filename.split(placeholder).join(value);
  }

  // Remove any unresolved <tag> placeholders
  filename = filename.replace(/<[^>]*>/g, '');

  filename = sanitizeFilename(filename);

  if (!filename) return illustration.original_filename;
  return ext ? `${filename}.${ext}` : filename;
}

export default function useDownloadConfig() {
  const [format, setFormat] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, format);
    } catch { /* ignore */ }
  }, [format]);

  return { format, setFormat };
}
