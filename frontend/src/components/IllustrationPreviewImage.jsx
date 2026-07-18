import { backendUrl } from '../api/url';

export default function IllustrationPreviewImage({
  illustration,
  quality,
  height,
  className = '',
}) {
  return (
    <div
      className={`flex w-full items-center justify-center overflow-hidden rounded-xl bg-surface-tertiary ${className}`}
      style={{ height }}
    >
      <img
        key={illustration.id}
        src={backendUrl(`${illustration.thumbnail_url}?quality=${quality === 'low' ? 'normal' : quality}`)}
        alt={illustration.original_filename}
        className="h-full w-full object-contain"
        onError={(event) => {
          if (event.currentTarget.dataset.lowQualityFallback) return;
          event.currentTarget.dataset.lowQualityFallback = 'true';
          event.currentTarget.src = backendUrl(`${illustration.thumbnail_url}?quality=low`);
        }}
      />
    </div>
  );
}
