const ABSOLUTE_URL_PATTERN = /^[a-z][a-z\d+.-]*:/i;

function configuredBaseUrl() {
  return (process.env.REACT_APP_API_BASE_URL || '').trim().replace(/\/+$/, '');
}

// Relative backend paths use the page's current origin, so packaged builds
// automatically follow whichever port the Artifex server selected at startup.
export function backendUrl(path = '') {
  if (ABSOLUTE_URL_PATTERN.test(path) || path.startsWith('//')) {
    return path;
  }

  const baseUrl = configuredBaseUrl();
  if (!path) return baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}
