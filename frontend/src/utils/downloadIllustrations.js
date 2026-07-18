import { backendUrl } from '../api/url';
import { resolveFilename } from '../hooks/useDownloadConfig';

function triggerDownload(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function downloadIllustrations(illustrations, namingFormat) {
  const downloaded = [];
  const failed = [];

  for (const illustration of illustrations || []) {
    try {
      const response = await fetch(backendUrl(illustration.file_url));
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const filename = resolveFilename(namingFormat, illustration);
      triggerDownload(await response.blob(), filename || illustration.original_filename);
      downloaded.push(illustration.id);
    } catch (error) {
      failed.push({ id: illustration.id, error });
    }
  }

  return { downloaded, failed };
}
