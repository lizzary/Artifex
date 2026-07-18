import { useState, useRef, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
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
  const [focused, setFocused] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [showTags, setShowTags] = useState(false);
  const textInputRef = useRef(null);
  const blurTimeoutRef = useRef(null);

  const segments = parseSegments(value);

  const insertTag = useCallback((tagKey) => {
    onChange(value + textInput + `<${tagKey}>`);
    setTextInput('');
    setShowTags(false);
    textInputRef.current?.focus();
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
  }, []);

  const handleContainerClick = useCallback(() => {
    textInputRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  const handleBlur = useCallback(() => {
    // Commit any pending text before blurring
    const clean = sanitizeTextInput(textInput);
    blurTimeoutRef.current = setTimeout(() => {
      setFocused(false);
      setShowTags(false);
      if (onBlur) {
        if (clean) {
          onChange(value + clean);
          setTextInput('');
        }
        onBlur();
      } else if (clean) {
        onChange(value + clean);
        setTextInput('');
      }
    }, 200);
  }, [textInput, value, onChange, onBlur]);

  const handleFocus = useCallback(() => {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    setFocused(true);
    setShowTags(true);
  }, []);

  return (
    <div className="relative">
      <div
        onClick={handleContainerClick}
        className={`min-h-[42px] w-full px-3 py-2 rounded-xl bg-surface-tertiary border transition-colors cursor-text flex flex-wrap items-center gap-1 ${
          focused ? 'border-accent ring-1 ring-accent/30' : 'border-edge-secondary'
        }`}
      >
        {segments.length === 0 && !focused && (
          <span className="text-sm text-content-muted pointer-events-none select-none">{placeholder}</span>
        )}
        {segments.map((seg, i) => {
          if (seg.type === 'tag') {
            const tagIdx = segments.slice(0, i).filter((s) => s.type === 'tag').length;
            return (
              <span
                key={`tag-${i}`}
                className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-accent/15 text-accent text-sm font-medium border border-accent/20"
              >
                <span>&lt;{seg.value}&gt;</span>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleRemoveTag(tagIdx);
                  }}
                  className="ml-0.5 p-0.5 rounded hover:bg-accent/30 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          }
          return (
            <span key={`txt-${i}`} className="text-sm text-content-primary whitespace-pre-wrap">
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
          onFocus={handleFocus}
          onBlur={handleBlur}
          className="flex-1 min-w-[60px] bg-transparent border-none outline-none text-sm text-content-primary placeholder-content-muted"
          placeholder={segments.length === 0 ? '' : '...'}
        />
      </div>

      {/* Tag suggestion dropdown */}
      {showTags && (
        <div className="absolute z-50 mt-1 w-full bg-surface-secondary border border-edge-primary rounded-xl shadow-xl overflow-hidden">
          <div className="p-2">
            <p className="text-[10px] font-medium text-content-muted uppercase tracking-wide px-2 py-1">
              Available Tags
            </p>
            <div className="grid grid-cols-2 gap-1">
              {NAMING_TAGS.map((tag) => (
                <button
                  key={tag.key}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertTag(tag.key)}
                  className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-tertiary text-sm text-content-secondary hover:text-content-primary transition-colors text-left"
                >
                  <span className="font-mono text-xs">&lt;{tag.key}&gt;</span>
                  <span className="text-[10px] text-content-muted ml-1.5">{tag.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
