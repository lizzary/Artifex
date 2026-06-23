const BASE_URL = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:8000';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, options);
  if (res.status === 204) return null;
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail.detail || `Request failed: ${res.status}`);
  }
  return res.json();
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

export function getGroup(groupId) {
  return request(`/api/groups/${groupId}`);
}

export function updateGroup(groupId, data) {
  return request(`/api/groups/${groupId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function deleteGroup(groupId) {
  return request(`/api/groups/${groupId}`, { method: 'DELETE' });
}

// ── Illustrations ──────────────────────────────────────

export function listIllustrations(groupId, offset = 0, limit = 200) {
  return request(`/api/groups/${groupId}/illustrations?offset=${offset}&limit=${limit}`);
}

export function uploadIllustrations(groupId, files, skipAutoTag = false, conflictPolicy) {
  const formData = new FormData();
  files.forEach((f) => formData.append('files', f));
  formData.append('skip_auto_tag', skipAutoTag ? 'true' : 'false');
  if (conflictPolicy) formData.append('conflict_policy', conflictPolicy);
  return request(
    `/api/groups/${groupId}/illustrations/upload`,
    { method: 'POST', body: formData },
  );
}

export function uploadSingleIllustration(groupId, file, skipAutoTag = false, conflictPolicy) {
  const formData = new FormData();
  formData.append('files', file);
  formData.append('skip_auto_tag', skipAutoTag ? 'true' : 'false');
  if (conflictPolicy) formData.append('conflict_policy', conflictPolicy);
  return request(
    `/api/groups/${groupId}/illustrations/upload`,
    { method: 'POST', body: formData },
  );
}

export function retagIllustrations(ids) {
  return request('/api/illustrations/retag', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

export function getIllustration(illustrationId) {
  return request(`/api/illustrations/${illustrationId}`);
}

export function updateIllustration(illustrationId, data) {
  return request(`/api/illustrations/${illustrationId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function deleteIllustration(illustrationId) {
  return request(`/api/illustrations/${illustrationId}`, { method: 'DELETE' });
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
