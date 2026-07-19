export const MAX_UPLOAD_BATCH_BYTES = 256 * 1024 * 1024;

// The backend parallelizes files within one multipart request. Batching keeps
// browser connection pressure low while still allowing all configured image
// preparation workers to run.
export function createUploadBatches(
  files,
  maxFiles,
  maxBytes = MAX_UPLOAD_BATCH_BYTES,
) {
  const fileLimit = Math.max(1, Math.floor(Number(maxFiles) || 1));
  const byteLimit = Math.max(1, Number(maxBytes) || MAX_UPLOAD_BATCH_BYTES);
  const batches = [];
  let current = [];
  let currentBytes = 0;

  Array.from(files || []).forEach((file) => {
    const fileBytes = Number.isFinite(file?.size) ? Math.max(0, file.size) : 0;
    if (
      current.length > 0
      && (current.length >= fileLimit || currentBytes + fileBytes > byteLimit)
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += fileBytes;
  });

  if (current.length > 0) batches.push(current);
  return batches;
}
