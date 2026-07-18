import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { listTags, listPrompts } from '../api';
import { useLocale } from '../contexts/LocaleContext';
import {
  getTagPromptSuggestionRevision,
  loadTagPromptSuggestions,
  subscribeToTagPromptSuggestions,
} from '../utils/tagPromptCache';

function mergeTagsAndPrompts(tags, prompts) {
  const items = new Map();
  tags.forEach((tag) => items.set(tag.toLowerCase(), { text: tag, types: ['tag'] }));
  prompts.forEach((prompt) => {
    const key = prompt.toLowerCase();
    const existing = items.get(key);
    if (existing) existing.types.push('prompt');
    else items.set(key, { text: prompt, types: ['prompt'] });
  });
  return [...items.values()];
}

export default function TagPromptSuggest({
  type,
  value,
  onChange,
  placeholder = '',
  className = '',
  inputClassName = '',
  onEnter,
  onSelect,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const suppressRef = useRef(true);
  const skipFocusRef = useRef(false);
  const listboxId = useId();
  const { t } = useLocale();
  const cacheRevision = useSyncExternalStore(
    subscribeToTagPromptSuggestions,
    getTagPromptSuggestionRevision,
    getTagPromptSuggestionRevision,
  );

  useEffect(() => {
    let cancelled = false;
    const loader = type === 'mixed'
      ? () => Promise.all([listTags(), listPrompts()]).then(([tags, prompts]) => (
        mergeTagsAndPrompts(tags, prompts)
      ))
      : (type === 'tag' ? listTags : listPrompts);

    loadTagPromptSuggestions(type, loader)
      .then((items) => {
        if (!cancelled) setAllItems(items);
      })
      .catch(() => {
        if (!cancelled) setAllItems([]);
      });
    return () => { cancelled = true; };
  }, [cacheRevision, type]);

  // Filter suggestions based on input
  useEffect(() => {
    if (!value || !allItems.length) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    const lower = value.toLowerCase();
    const getText = (item) => (type === 'mixed' ? item.text : item);
    const matches = allItems
      .filter((item) => getText(item).toLowerCase().includes(lower))
      .slice(0, 8);
    setSuggestions(matches);
    if (!suppressRef.current) {
      setShowDropdown(matches.length > 0);
    }
    setActiveIndex(-1);
  }, [value, allItems, type]);

  // Click outside closes dropdown
  useEffect(() => {
    const handler = (e) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target) &&
        inputRef.current &&
        !inputRef.current.contains(e.target)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectSuggestion = useCallback(
    (item) => {
      suppressRef.current = true;
      if (type === 'mixed') {
        onChange(item.text);
        const scope = item.types.length === 2 ? 'all' : item.types[0];
        if (onSelect) onSelect(item.text, scope);
      } else {
        onChange(item);
      }
      setShowDropdown(false);
      setActiveIndex(-1);
      skipFocusRef.current = true;
      inputRef.current?.focus();
    },
    [onChange, onSelect, type]
  );

  const handleKeyDown = (e) => {
    if (!showDropdown) {
      if (e.key === 'Enter' && onEnter && value.trim()) {
        e.preventDefault();
        onEnter(value.trim());
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) =>
          prev > 0 ? prev - 1 : suggestions.length - 1
        );
        break;
      case 'Enter':
        if (activeIndex >= 0 && activeIndex < suggestions.length) {
          e.preventDefault();
          selectSuggestion(suggestions[activeIndex]);
        } else if (onEnter && value.trim()) {
          e.preventDefault();
          onEnter(value.trim());
        }
        break;
      case 'Escape':
        setShowDropdown(false);
        setActiveIndex(-1);
        break;
      default:
        break;
    }
  };

  const resolveItemText = (item) => (type === 'mixed' ? item.text : item);

  const typeLabel = (item) => {
    if (type !== 'mixed') return type === 'tag' ? t('tagPromptSuggest.tag') : t('tagPromptSuggest.prompt');
    if (item.types.length === 2) return t('tagPromptSuggest.tagAndPrompt');
    return item.types[0] === 'tag' ? t('tagPromptSuggest.tag') : t('tagPromptSuggest.prompt');
  };

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          suppressRef.current = false;
          onChange(e.target.value);
        }}
        onFocus={() => {
          if (skipFocusRef.current) {
            skipFocusRef.current = false;
            return;
          }
          suppressRef.current = false;
          if (value && suggestions.length > 0) setShowDropdown(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        aria-controls={listboxId}
        className={inputClassName}
      />
      {showDropdown && (() => {
        const lower = value.toLowerCase();
        const isExact = (item) => resolveItemText(item).toLowerCase() === lower;
        return (
        <div
          ref={dropdownRef}
          id={listboxId}
          className="absolute top-full left-0 right-0 mt-1 bg-surface-tertiary border border-edge-secondary rounded-lg shadow-xl z-50 overflow-hidden"
          role="listbox"
        >
          {suggestions.map((item, idx) => {
            const exact = isExact(item);
            return (
            <button
              key={resolveItemText(item)}
              onClick={() => selectSuggestion(item)}
              role="option"
              aria-selected={idx === activeIndex}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                idx === activeIndex
                  ? 'bg-accent/30'
                  : exact
                    ? 'bg-accent/10'
                    : 'hover:bg-edge-secondary'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                {exact && (
                  <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                )}
                <span className={`truncate ${
                  idx === activeIndex ? 'text-accent' : exact ? 'text-accent/80' : 'text-content-secondary'
                }`}>
                  {resolveItemText(item)}
                </span>
              </span>
              <span className="text-xs text-content-muted shrink-0 ml-3">{typeLabel(item)}</span>
            </button>
            );
          })}
        </div>
        );
      })()}
    </div>
  );
}
