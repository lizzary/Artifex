import { useState, useEffect, useRef, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import { loadMixedItems } from '../utils/suggestData';
import { isValidExpression } from '../utils/grouping';
import { useLocale } from '../contexts/LocaleContext';

const BOUNDARY = new Set([' ', '\t', '\n', '\r', '(', ')', '"']);

// Extract the "word" currently under the caret so we can autocomplete it
// without clobbering the rest of the boolean expression.
function tokenAtCaret(value, caret) {
  let start = caret;
  while (start > 0 && !BOUNDARY.has(value[start - 1])) start--;
  let end = caret;
  while (end < value.length && !BOUNDARY.has(value[end])) end++;
  return { start, end, prefix: value.slice(start, caret) };
}

const OPERATORS = [
  { key: 'and', insert: 'AND', symbol: 'AND' },
  { key: 'or', insert: 'OR', symbol: 'OR' },
  { key: 'not', insert: 'NOT', symbol: 'NOT' },
  { key: 'group', insert: '()', symbol: '( )' },
];

export default function ExpressionInput({ value, onChange, placeholder = '', inputClassName = '' }) {
  const { t } = useLocale();
  const [allItems, setAllItems] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const caretRef = useRef(0);
  const tokenRef = useRef({ start: 0, end: 0, prefix: '' });
  const pendingCaretRef = useRef(null);

  useEffect(() => { loadMixedItems().then(setAllItems).catch(() => {}); }, []);

  // Re-apply caret after a programmatic value change (insert / complete).
  useEffect(() => {
    if (pendingCaretRef.current != null && inputRef.current) {
      const pos = pendingCaretRef.current;
      pendingCaretRef.current = null;
      inputRef.current.focus();
      inputRef.current.setSelectionRange(pos, pos);
      caretRef.current = pos;
    }
  }, [value]);

  const refreshSuggestions = useCallback((val, caret) => {
    const token = tokenAtCaret(val, caret);
    tokenRef.current = token;
    const prefix = token.prefix.trim().toLowerCase();
    if (!prefix || !allItems.length) {
      setSuggestions([]);
      setShowDropdown(false);
      setActiveIndex(-1);
      return;
    }
    const matches = allItems
      .filter((item) => item.text.toLowerCase().includes(prefix))
      .slice(0, 8);
    setSuggestions(matches);
    setShowDropdown(matches.length > 0);
    setActiveIndex(-1);
  }, [allItems]);

  const handleInput = (e) => {
    const val = e.target.value;
    const caret = e.target.selectionStart ?? val.length;
    caretRef.current = caret;
    onChange(val);
    refreshSuggestions(val, caret);
  };

  const syncCaret = () => {
    if (inputRef.current) caretRef.current = inputRef.current.selectionStart ?? 0;
  };

  const commitSuggestion = useCallback((item) => {
    const { start, end } = tokenRef.current;
    const text = /\s/.test(item.text) ? `"${item.text}"` : item.text;
    const before = value.slice(0, start);
    const after = value.slice(end);
    // Ensure a single trailing space so the next term can be typed immediately.
    const insert = `${text} `;
    const next = before + insert + after;
    pendingCaretRef.current = (before + insert).length;
    onChange(next);
    setShowDropdown(false);
    setActiveIndex(-1);
  }, [value, onChange]);

  const insertOperator = useCallback((op) => {
    const input = inputRef.current;
    const caret = input ? (input.selectionStart ?? value.length) : value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    let insert;
    let caretShift;
    if (op.insert === '()') {
      const needSpaceBefore = before && !before.endsWith(' ') && !before.endsWith('(');
      insert = `${needSpaceBefore ? ' ' : ''}()`;
      caretShift = insert.length - 1; // land the caret inside the parentheses
    } else {
      const needSpaceBefore = before && !before.endsWith(' ');
      const needSpaceAfter = !after.startsWith(' ');
      insert = `${needSpaceBefore ? ' ' : ''}${op.insert}${needSpaceAfter ? ' ' : ''}`;
      caretShift = insert.length;
    }
    const next = before + insert + after;
    pendingCaretRef.current = before.length + caretShift;
    onChange(next);
    setShowDropdown(false);
  }, [value, onChange]);

  const handleKeyDown = (e) => {
    if (!showDropdown) {
      syncCaret();
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < suggestions.length) {
          commitSuggestion(suggestions[activeIndex]);
        } else {
          // Accept the typed text as-is and dismiss the suggestions.
          setShowDropdown(false);
          setActiveIndex(-1);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowDropdown(false);
        setActiveIndex(-1);
        break;
      default:
        break;
    }
  };

  // Close the dropdown on outside clicks.
  useEffect(() => {
    const handler = (e) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        inputRef.current && !inputRef.current.contains(e.target)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const typeLabel = (item) => {
    if (item.types.length === 2) return t('tagPromptSuggest.tagAndPrompt');
    return item.types[0] === 'tag' ? t('tagPromptSuggest.tag') : t('tagPromptSuggest.prompt');
  };

  const valid = isValidExpression(value);

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onFocus={() => refreshSuggestions(value, inputRef.current?.selectionStart ?? value.length)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className={inputClassName}
          style={!valid ? { borderColor: 'rgb(var(--clr-danger) / 0.6)' } : undefined}
        />
        {!valid && (
          <AlertCircle className="w-3.5 h-3.5 text-danger absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        )}

        {showDropdown && (
          <div
            ref={dropdownRef}
            className="absolute top-full left-0 right-0 mt-1 bg-surface-tertiary border border-edge-secondary rounded-lg shadow-xl z-50 overflow-hidden"
          >
            {suggestions.map((item, idx) => (
              <button
                key={item.text}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); commitSuggestion(item); }}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                  idx === activeIndex ? 'bg-accent/30' : 'hover:bg-edge-secondary'
                }`}
              >
                <span className={`truncate ${idx === activeIndex ? 'text-accent' : 'text-content-secondary'}`}>
                  {item.text}
                </span>
                <span className="text-xs text-content-muted shrink-0 ml-3">{typeLabel(item)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Operator toolbar */}
      <div className="flex items-center gap-1 mt-1.5">
        {OPERATORS.map((op) => (
          <button
            key={op.key}
            type="button"
            onClick={() => insertOperator(op)}
            title={t(`groupConfig.op.${op.key}`)}
            className="px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold tracking-wide bg-surface-tertiary border border-edge-secondary text-content-muted hover:text-accent hover:border-accent/50 transition-colors"
          >
            {op.symbol}
          </button>
        ))}
        {!valid && (
          <span className="ml-auto text-[11px] text-danger/90 truncate">{t('groupConfig.exprInvalid')}</span>
        )}
      </div>
    </div>
  );
}
