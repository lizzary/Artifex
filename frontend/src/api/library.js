import { backendUrl } from './url';

let libraryId = null;

// Keep the identity for this page until reload. Queued uploads and downloads
// must not cross into a newly selected database that happens to reuse IDs.
export async function fetchLibrary(path, options = {}) {
  const headers = { ...options.headers };
  if (libraryId) headers['X-Artifex-Library'] = libraryId;
  const response = await fetch(backendUrl(path), { ...options, headers });
  if (!libraryId) libraryId = response.headers?.get('X-Artifex-Library') || null;
  return response;
}
