import { useState, useRef, useCallback, useId, useLayoutEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Tags, X } from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';
import { NAMING_TAGS } from '../hooks/useDownloadConfig';

const FORBIDDEN_INPUT_RE = /[:"/\\|?*]/g;
const NULL_CHARACTER = String.fromCharCode(0);

function sanitizeTextInput(value) {
  return value.replace(FORBIDDEN_INPUT_RE, '').split(NULL_CHARACTER).join('');
}

function parseSegments(format) {
  const segments = [];
  const re = /<([^>]+)>/g;
  let lastIdx = 0;
  let match;
  while ((match = re.exec(format)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: 'text', value: format.slice(lastIdx, match.index) });
    }
    segments.push({ type: 'tag', value: match[1] });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < format.length) {
    segments.push({ type: 'text', value: format.slice(lastIdx) });
  }
  return segments;
}

function removeTagAt(value, tagIndex) {
  const re = /<([^>]+)>/g;
  let count = 0;
  let match;
  while ((match = re.exec(value)) !== null) {
    if (count === tagIndex) {
      return value.slice(0, match.index) + value.slice(match.index + match[0].length);
    }
    count++;
  }
  return value;
}

export default function NamingFormatInput({ value, onChange, onBlur, placeholder }) {
  const { t } = useLocale();
  const reduceMotion = useReducedMotion();
  const [textInput, setTextInput] = useState('');
  const [showTags, setShowTags] = useState(false);
  const [placement, setPlacement] = useState({ above: true, maxHeight: 0 });
  const fieldRef = useRef(null);
  const textInputRef = useRef(null);
  const panelId = useId();
  const tagsLabel = t('settings.download.namingTags');

  const segments = parseSegments(value);

  const insertTag = useCallback((tagKey) => {
    onChange(value + textInput + `<${tagKey}>`);
    setTextInput('');
    textInputRef.current?.focus({ preventScroll: true });
    setShowTags(false);
  }, [value, textInput, onChange]);

  const handleRemoveTag = useCallback((tagIndex) => {
    onChange(removeTagAt(value, tagIndex));
  }, [value, onChange]);

  const handleTextKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const clean = sanitizeTextInput(textInput);
      if (clean) {
        onChange(value + clean);
        setTextInput('');
      }
    } else if (e.key === 'Backspace' && textInput === '' && segments.length > 0) {
      const last = segments[segments.length - 1];
      if (last.type === 'tag') {
        const tagCount = segments.filter((s) => s.type === 'tag').length;
        onChange(removeTagAt(value, tagCount - 1));
      } else {
        onChange(value.slice(0, -last.value.length));
      }
    }
  }, [textInput, value, segments, onChange]);

  const handleTextChange = useCallback((e) => {
    setTextInput(sanitizeTextInput(e.target.value));
    setShowTags(true);
  }, []);

  const handleContainerClick = useCallback(() => {
    textInputRef.current?.focus();
    setShowTags(true);
  }, []);

  useLayoutEffect(() => {
    if (!showTags) return;
    const field = fieldRef.current;
    const viewport = window.visualViewport;
    const placePanel = () => {
      const rect = field.getBoundingClientRect();
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const above = rect.top - viewportTop > viewportBottom - rect.bottom;
      const room = above ? rect.top - viewportTop : viewportBottom - rect.bottom;
      const maxHeight = Math.max(0, Math.floor(room - 20));
      setPlacement((current) => current.above === above && current.maxHeight === maxHeight
        ? current
        : { above, maxHeight });
    };
    placePanel();
    const observer = window.ResizeObserver ? new ResizeObserver(placePanel) : null;
    observer?.observe(field);
    window.addEventListener('scroll', placePanel, { passive: true });
    window.addEventListener('resize', placePanel);
    viewport?.addEventListener('resize', placePanel);
    viewport?.addEventListener('scroll', placePanel);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', placePanel);
      window.removeEventListener('resize', placePanel);
      viewport?.removeEventListener('resize', placePanel);
      viewport?.removeEventListener('scroll', placePanel);
    };
  }, [showTags]);

  const handleBlur = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setShowTags(false);
    const clean = sanitizeTextInput(textInput);
    if (clean) {
      onChange(value + clean);
      setTextInput('');
    }
    onBlur?.();
  };

  return (
    <div
      className="relative"
      ref={fieldRef}
      onBlur={handleBlur}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !showTags) return;
        event.stopPropagation();
        if (event.target.closest('[data-naming-tags]')) {
          textInputRef.current?.focus({ preventScroll: true });
        }
        setShowTags(false);
      }}
    >
      <div className="flex min-h-[42px] w-full items-center gap-2 rounded-xl border border-edge-secondary bg-surface-tertiary py-1.5 pl-3 pr-1.5 transition-colors focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/30">
        <div onClick={handleContainerClick} className="flex min-w-0 flex-1 cursor-text flex-wrap items-center gap-1 py-0.5">
          {segments.map((seg, i) => {
            if (seg.type === 'tag') {
              const tagIdx = segments.slice(0, i).filter((s) => s.type === 'tag').length;
              return (
                <span
                  key={`tag-${i}`}
                  className="inline-flex max-w-full items-center gap-0.5 rounded-md border border-accent/20 bg-accent/15 px-2 py-0.5 text-sm font-medium text-accent"
                >
                  <span className="min-w-0 break-words">&lt;{seg.value}&gt;</span>
                  <button
                    type="button"
                    aria-label={t('settings.download.removeNamingTag', { tag: seg.value })}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (e.detail === 0) textInputRef.current?.focus({ preventScroll: true });
                      handleRemoveTag(tagIdx);
                    }}
                    className="ml-0.5 shrink-0 rounded p-0.5 transition-colors hover:bg-accent/30"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              );
            }
            return (
              <span key={`txt-${i}`} className="max-w-full whitespace-pre-wrap break-words text-sm text-content-primary">
                {seg.value}
              </span>
            );
          })}
          <input
            ref={textInputRef}
            type="text"
            value={textInput}
            onChange={handleTextChange}
            onKeyDown={handleTextKeyDown}
            onFocus={() => setShowTags(true)}
            aria-label={t('settings.download.namingFormat')}
            autoComplete="off"
            className="min-w-[60px] flex-1 border-none bg-transparent text-sm text-content-primary outline-none placeholder-content-muted"
            placeholder={segments.length === 0 ? placeholder : '…'}
          />
        </div>
        <button
          type="button"
          aria-label={tagsLabel}
          aria-expanded={showTags}
          aria-controls={showTags ? panelId : undefined}
          title={tagsLabel}
          onClick={() => setShowTags((open) => !open)}
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
            showTags ? 'bg-accent/10 text-accent' : 'text-content-tertiary hover:bg-accent/10 hover:text-accent'
          }`}
        >
          <Tags className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {showTags && (
        <motion.div
          id={panelId}
          data-naming-tags=""
          role="group"
          aria-label={tagsLabel}
          initial={reduceMotion ? false : { opacity: 0, y: placement.above ? 4 : -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          style={{ maxHeight: placement.maxHeight }}
          className={`artifex-scrollbar absolute inset-x-0 z-50 overflow-y-auto overscroll-contain rounded-xl border border-edge-primary bg-surface-secondary shadow-xl ${
            placement.above ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          <p className="border-b border-edge-primary px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-content-tertiary">
            {tagsLabel}
          </p>
          <div className="grid grid-cols-1 gap-1 p-2 sm:grid-cols-2">
            {NAMING_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertTag(tag)}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-content-secondary transition-colors hover:bg-surface-tertiary focus-visible:bg-surface-tertiary focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              >
                <span className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-xs text-accent">&lt;{tag}&gt;</span>
                <span className="text-xs">{t(`settings.download.namingTag.${tag}`)}</span>
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
