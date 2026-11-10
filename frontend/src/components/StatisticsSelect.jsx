import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import './StatisticsSelect.css';

const MENU_GUTTER = 10;
const MENU_GAP = 6;
const MENU_HEIGHT = 320;

export default function StatisticsSelect({
  value,
  onChange,
  options,
  label,
  ariaLabel,
  icon: Icon,
  compact = false,
  className = '',
  menuMinWidth = 200,
  align = 'start',
  disabled = false,
}) {
  const id = useId();
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const typeaheadRef = useRef({ text: '', time: 0 });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState(null);
  const selectedIndex = options.findIndex(option => option.value === value);
  const selected = options[selectedIndex];
  const active = Math.max(0, Math.min(activeIndex, options.length - 1));
  const isOpen = open && !disabled && options.length > 0;
  const accessibleLabel = ariaLabel || label;

  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const trigger = triggerRef.current;
    const panel = menuRef.current;

    function place() {
      const bounds = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? document.documentElement.clientWidth;
      const viewportHeight = viewport?.height ?? document.documentElement.clientHeight;
      const leftEdge = viewportLeft + MENU_GUTTER;
      const rightEdge = viewportLeft + viewportWidth - MENU_GUTTER;
      const topEdge = viewportTop + MENU_GUTTER;
      const bottomEdge = viewportTop + viewportHeight - MENU_GUTTER;
      if (bounds.bottom < topEdge || bounds.top > bottomEdge) {
        setOpen(false);
        return;
      }
      const width = Math.min(Math.max(menuMinWidth, bounds.width), rightEdge - leftEdge);
      panel.style.width = `${width}px`;
      const below = Math.max(0, bottomEdge - bounds.bottom - MENU_GAP);
      const above = Math.max(0, bounds.top - topEdge - MENU_GAP);
      const desiredHeight = Math.min(MENU_HEIGHT, panel.scrollHeight + 2);
      const flip = below < desiredHeight && above > below;
      const maxHeight = Math.min(MENU_HEIGHT, flip ? above : below);
      const left = align === 'end' ? bounds.right - width : bounds.left;
      setPosition({
        left: Math.max(leftEdge, Math.min(left, rightEdge - width)),
        top: flip ? Math.max(topEdge, bounds.top - MENU_GAP - Math.min(desiredHeight, maxHeight)) : bounds.bottom + MENU_GAP,
        width,
        maxHeight,
        placement: flip ? 'above' : 'below',
      });
    }

    function handleScroll(event) {
      if (!panel.contains(event.target)) place();
    }

    place();
    const resize = new ResizeObserver(place);
    resize.observe(trigger);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', handleScroll, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      resize.disconnect();
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', handleScroll, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [isOpen, menuMinWidth, align, options.length]);

  useEffect(() => {
    if (!isOpen) return undefined;
    function dismissOutside(event) {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    }
    function dismissOnWindowBlur() {
      setOpen(false);
    }
    document.addEventListener('pointerdown', dismissOutside);
    window.addEventListener('blur', dismissOnWindowBlur);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      window.removeEventListener('blur', dismissOnWindowBlur);
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const panel = menuRef.current;
    const option = panel?.querySelector('[data-active="true"]');
    if (!option) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < panel.scrollTop) panel.scrollTop = top;
    else if (bottom > panel.scrollTop + panel.clientHeight) panel.scrollTop = bottom - panel.clientHeight;
  }, [isOpen, active]);

  function openMenu(index = Math.max(0, selectedIndex)) {
    setActiveIndex(index);
    setPosition(null);
    typeaheadRef.current = { text: '', time: 0 };
    setOpen(true);
  }

  function choose(index) {
    const option = options[index];
    if (!option) return;
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
    onChange(option.value);
  }

  function handleKeyDown(event) {
    if (event.isComposing || options.length === 0) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!isOpen) openMenu();
        else setActiveIndex(Math.max(0, Math.min(active + (event.key === 'ArrowDown' ? 1 : -1), options.length - 1)));
        return;
      }
      case 'Home':
      case 'End': {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : options.length - 1;
        if (isOpen) setActiveIndex(next);
        else openMenu(next);
        return;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        if (isOpen) choose(active);
        else openMenu();
        return;
      }
      case 'Escape':
        if (isOpen) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
        return;
      case 'Tab':
        setOpen(false);
        return;
      default:
        break;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const now = Date.now();
    const previous = now - typeaheadRef.current.time < 650 ? typeaheadRef.current.text : '';
    const text = previous + event.key.toLocaleLowerCase();
    typeaheadRef.current = { text, time: now };
    const query = [...text].every(character => character === text[0]) ? text[0] : text;
    const from = isOpen ? active : Math.max(0, selectedIndex);
    const start = query.length > 1 ? from : from + 1;
    for (let offset = 0; offset < options.length; offset += 1) {
      const index = (start + offset) % options.length;
      if (String(options[index].label).toLocaleLowerCase().startsWith(query)) {
        setActiveIndex(index);
        if (!isOpen) {
          setPosition(null);
          setOpen(true);
        }
        break;
      }
    }
  }

  return (
    <div className={`statistics-dropdown ${compact ? 'statistics-dropdown-compact' : ''} ${className}`}>
      {label && <label htmlFor={id} className="statistics-dropdown-label">{label}</label>}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-label={accessibleLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? `${id}-options` : undefined}
        aria-activedescendant={isOpen ? `${id}-option-${active}` : undefined}
        className="statistics-dropdown-trigger"
        disabled={disabled || options.length === 0}
        title={selected?.label}
        onClick={() => isOpen ? setOpen(false) : openMenu()}
        onKeyDown={handleKeyDown}
        onBlur={event => {
          if (event.relatedTarget && !menuRef.current?.contains(event.relatedTarget)) setOpen(false);
        }}
      >
        {Icon && <Icon className="statistics-dropdown-icon" size={15} aria-hidden="true" />}
        <span className="statistics-dropdown-value">{selected?.label ?? '—'}</span>
        <ChevronDown className="statistics-dropdown-chevron" size={14} aria-hidden="true" />
      </button>
      {isOpen && createPortal(
        <div
          ref={menuRef}
          id={`${id}-options`}
          role="listbox"
          aria-label={accessibleLabel}
          className="statistics-dropdown-menu artifex-scrollbar artifex-scrollbar-quiet"
          data-placement={position?.placement}
          style={{
            left: position?.left,
            top: position?.top,
            width: position?.width,
            maxHeight: position?.maxHeight ?? MENU_HEIGHT,
            visibility: position ? 'visible' : 'hidden',
          }}
        >
          {options.map((option, index) => (
            <div
              key={String(option.value)}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === selectedIndex}
              data-active={index === active}
              className="statistics-dropdown-option"
              onMouseDown={event => event.preventDefault()}
              onPointerMove={event => {
                if (event.pointerType !== 'touch') setActiveIndex(index);
              }}
              onClick={() => choose(index)}
            >
              <span className="statistics-dropdown-check" aria-hidden="true">
                {index === selectedIndex && <Check size={14} strokeWidth={2} />}
              </span>
              <span className="statistics-dropdown-option-copy">
                <span>{option.label}</span>
                {option.description && <small>{option.description}</small>}
              </span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
