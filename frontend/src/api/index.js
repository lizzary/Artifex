import { fetchLibrary } from './library';
import { invalidateTagPromptSuggestions } from '../utils/tagPromptCache';

async function request(path, options = {}) {
  const res = await fetchLibrary(path, options);
  if (res.status === 204) return null;
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function requestAndInvalidateSuggestions(path, options) {
  const result = await request(path, options);
  invalidateTagPromptSuggestions();
  return result;
}

// ── Groups ────────────────────────────────────────────

export function listGroups() {
  return request('/api/groups');
}

export function createGroup(name) {
  return request('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function updateGroup(groupId, data) {
  return request(`/api/groups/${groupId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function deleteGroup(groupId) {
  return requestAndInvalidateSuggestions(`/api/groups/${groupId}`, { method: 'DELETE' });
}

// ── Illustrations ──────────────────────────────────────

function listIllustrations(groupId, offset = 0, limit = 200) {
  return request(`/api/groups/${groupId}/illustrations?offset=${offset}&limit=${limit}`);
}

// Color-group inference is evaluated in the browser, so pagination based on the
// resulting group order needs the complete illustration set first. Fetch in
// bounded batches instead of relying on one oversized request.
export async function listAllIllustrations(groupId, batchSize = 5000) {
  const items = [];
  let total = 0;

  do {
    const data = await listIllustrations(groupId, items.length, batchSize);
    const batch = Array.isArray(data.items) ? data.items : [];
    items.push(...batch);
    total = Number.isFinite(data.total) ? data.total : items.length;

    // Avoid an infinite loop if the server reports a stale total or returns no
    // progress for an out-of-range offset.
    if (batch.length === 0) break;
  } while (items.length < total);

  return { items, total };
}

export function uploadIllustrations(groupId, files, skipAutoTag = false, conflictPolicy) {
  const formData = new FormData();
  Array.from(files || []).forEach((file) => formData.append('files', file));
  formData.append('skip_auto_tag', skipAutoTag ? 'true' : 'false');
  if (conflictPolicy) formData.append('conflict_policy', conflictPolicy);
  return requestAndInvalidateSuggestions(
    `/api/groups/${groupId}/illustrations/upload`,
    { method: 'POST', body: formData },
  );
}

export function uploadSingleIllustration(groupId, file, skipAutoTag = false, conflictPolicy) {
  return uploadIllustrations(groupId, [file], skipAutoTag, conflictPolicy);
}

export function retagIllustrations(ids) {
  return requestAndInvalidateSuggestions('/api/illustrations/retag', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

export function updateIllustration(illustrationId, data) {
  return requestAndInvalidateSuggestions(`/api/illustrations/${illustrationId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

function deleteIllustrationRequest(illustrationId) {
  return request(`/api/illustrations/${illustrationId}`, { method: 'DELETE' });
}

export function deleteIllustration(illustrationId) {
  return requestAndInvalidateSuggestions(
    `/api/illustrations/${illustrationId}`,
    { method: 'DELETE' },
  );
}

export async function deleteIllustrations(illustrationIds) {
  const ids = [...new Set(illustrationIds || [])];
  const result = { deleted: [], failed: [] };
  for (const id of ids) {
    try {
      await deleteIllustrationRequest(id);
      result.deleted.push(id);
    } catch {
      result.failed.push(id);
    }
  }
  if (result.deleted.length > 0) invalidateTagPromptSuggestions();
  return result;
}

export function updateIllustrationTags(illustrationIds, operation, tags) {
  return requestAndInvalidateSuggestions('/api/illustrations/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: illustrationIds, operation, tags }),
  });
}

export function getIllustrationMetadata(illustrationId) {
  return request(`/api/illustrations/${illustrationId}/metadata`);
}

// ── Tags & Prompts ─────────────────────────────────────

export function listTags() {
  return request('/api/tags');
}

export function listPrompts() {
  return request('/api/prompts');
}

// ── Search ─────────────────────────────────────────────

export function searchIllustrations(query, offset = 0, limit = 100) {
  const q = encodeURIComponent(query);
  return request(`/api/search?q=${q}&offset=${offset}&limit=${limit}`);
}

// ── Statistics ────────────────────────────────────────

export function getStatistics(signal) {
  return request('/api/statistics', { signal });
}

export function getStatisticsGroupStorage(groupId, signal) {
  return request(`/api/statistics/groups/${groupId}/storage`, { signal });
}

// ── Batch export ──────────────────────────────────────

export function getExportCatalog(scope, signal) {
  return request('/api/export/catalog?scope=' + scope, { signal });
}

export function getExportDraft(scope, signal) {
  return request('/api/export/draft/' + scope, { signal });
}

export function saveExportDraft(scope, draft) {
  return request('/api/export/draft/' + scope, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  });
}

export function prepareExport(entries, signal) {
  return request('/api/export/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entries),
    signal,
  });
}

// ── Model ───────────────────────────────────────────────

export function checkModelStatus() {
  return request('/api/model/status');
}

export function downloadModel() {
  return request('/api/model/download', { method: 'POST' });
}

export function deleteDefaultModel() {
  return request('/api/model/default', { method: 'DELETE' });
}

export function listModels() {
  return request('/api/models');
}

export function uploadModel(file) {
  const formData = new FormData();
  formData.append('file', file);
  return request('/api/models/upload', {
    method: 'POST',
    body: formData,
  });
}

export function deleteModel(modelName) {
  return request(`/api/models/${encodeURIComponent(modelName)}`, { method: 'DELETE' });
}

// ── Settings ──────────────────────────────────────────────

export function getSettings() {
  return request('/api/settings');
}

export function updateSettings(data) {
  return request('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function getGroupConfig(signal) {
  return request('/api/group-config', { signal });
}

export function updateGroupConfig(data) {
  return request('/api/group-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function updateColorConfig(groupId, operations) {
  return request(`/api/groups/${groupId}/color-operations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operations }),
  });
}
