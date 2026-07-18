import { useCallback, useEffect, useRef, useState } from 'react';

const IMAGE_FILE_EXTENSION = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i;

export function isIllustrationImageFile(file) {
  if (!file) return false;
  if (file.type?.startsWith('image/')) return true;
  return IMAGE_FILE_EXTENSION.test(file.name || '');
}

export function partitionIllustrationFiles(files) {
  return Array.from(files || []).reduce((result, file) => {
    result[isIllustrationImageFile(file) ? 'accepted' : 'rejected'].push(file);
    return result;
  }, { accepted: [], rejected: [] });
}

function containsExternalFiles(dataTransfer) {
  if (!dataTransfer) return false;
  if (dataTransfer.files?.length > 0) return true;
  return Array.from(dataTransfer.types || []).includes('Files');
}

export default function useIllustrationFileDrop({ onFiles, onRejected, disabled = false }) {
  const dragDepthRef = useRef(0);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  const resetDragState = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
  }, []);

  useEffect(() => {
    if (disabled) resetDragState();
  }, [disabled, resetDragState]);

  const onDragEnter = useCallback((event) => {
    if (!containsExternalFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    if (!disabled) setIsDraggingFiles(true);
  }, [disabled]);

  const onDragOver = useCallback((event) => {
    if (!containsExternalFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
  }, [disabled]);

  const onDragLeave = useCallback((event) => {
    if (dragDepthRef.current === 0) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  }, []);

  const onDrop = useCallback((event) => {
    if (!containsExternalFiles(event.dataTransfer)) return;
    event.preventDefault();
    resetDragState();
    if (disabled) return;

    const { accepted, rejected } = partitionIllustrationFiles(event.dataTransfer.files);
    if (rejected.length > 0) onRejected?.(rejected);
    if (accepted.length > 0) onFiles?.(accepted);
  }, [disabled, onFiles, onRejected, resetDragState]);

  return {
    isDraggingFiles,
    dropTargetProps: {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
    },
  };
}
