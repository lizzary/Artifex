import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowDownToLine, ArrowRight, Layers, Loader2 } from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';
import { toHexColor } from '../utils/groupColors';
import './IllustrationReorder.css';

const messages = {
  zh: {
    insert: (count) => `插入 ${count} 张`,
    into: (group) => `移入「${group}」`,
    title: '确认跨颜色组移动',
    summary: (count, changed) => `将按选取顺序插入 ${count} 张插画，其中 ${changed} 张会更改颜色组归属。`,
    sources: '原颜色组',
    target: '目标颜色组',
    count: (count) => `${count} 张`,
    before: '插在此插画之前',
    after: '插在此插画之后',
    confirm: '确认移动',
    saving: '正在移动…',
  },
  en: {
    insert: (count) => `Insert ${count}`,
    into: (group) => `Move to “${group}”`,
    title: 'Move to another color group',
    summary: (count, changed) => `This inserts ${count} illustrations in order and assigns ${changed} to the destination color group.`,
    sources: 'From',
    target: 'To',
    count: (count) => `${count} ${count === 1 ? 'illustration' : 'illustrations'}`,
    before: 'Insert before',
    after: 'Insert after',
    confirm: 'Move illustrations',
    saving: 'Moving…',
  },
};

export function IllustrationDropMarker({ marker }) {
  const { locale } = useLocale();
  const copy = messages[locale] || messages.en;
  if (!marker || marker.length <= 0) return null;
  const horizontal = marker.axis === 'horizontal';
  const center = horizontal ? marker.x + marker.length / 2 : marker.x;
  return createPortal(
    <div className="illustration-reorder-preview" aria-hidden="true">
      <i
        className="illustration-reorder-line"
        data-axis={marker.axis}
        style={{ left: marker.x, top: marker.y, [horizontal ? 'width' : 'height']: marker.length }}
      />
      <span
        className="illustration-reorder-caption"
        style={{
          left: `clamp(6rem, ${center}px, calc(100vw - 6rem))`,
          top: `clamp(1rem, ${marker.y + 10}px, calc(100vh - 2.5rem))`,
        }}
      >
        <ArrowDownToLine size={12} />
        <span>{copy.insert(marker.count)}{marker.group && ` · ${copy.into(marker.group)}`}</span>
      </span>
    </div>,
    document.body,
  );
}

function GroupSwatch({ color }) {
  return (
    <span className="illustration-move-swatch" data-colored={Boolean(color)}
      style={{ '--illustration-move-swatch': toHexColor(color, null) }} aria-hidden="true" />
  );
}

function MoveDialog({ request, pending, onCancel, onConfirm }) {
  const { locale, t } = useLocale();
  const copy = messages[locale] || messages.en;
  const titleId = useId();
  const summaryId = useId();
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="illustration-move-dialog"
      aria-labelledby={titleId}
      aria-describedby={summaryId}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <header className="illustration-move-header">
        <span className="illustration-move-emblem"><Layers size={19} strokeWidth={1.65} aria-hidden="true" /></span>
        <div>
          <h2 id={titleId}>{copy.title}</h2>
          <p id={summaryId}>{copy.summary(request.move.ids.length, request.changedCount)}</p>
        </div>
      </header>

      <div className="illustration-move-transfer">
        <div className="illustration-move-side">
          <h3>{copy.sources}</h3>
          <ul className="illustration-move-sources artifex-scrollbar artifex-scrollbar-quiet">
            {request.sources.map(({ id, name, color, count }) => (
              <li key={id}>
                <GroupSwatch color={color} />
                <span title={name}>{name}</span>
                <small>{copy.count(count)}</small>
              </li>
            ))}
          </ul>
        </div>
        <ArrowRight className="illustration-move-arrow" size={17} aria-hidden="true" />
        <ArrowDown className="illustration-move-arrow-mobile" size={17} aria-hidden="true" />
        <div className="illustration-move-side">
          <h3>{copy.target}</h3>
          <div className="illustration-move-destination">
            <GroupSwatch color={request.target.color} />
            <span title={request.target.name}>{request.target.name}</span>
            <small>{copy.count(request.changedCount)}</small>
          </div>
        </div>
      </div>

      {request.anchorName && (
        <div className="illustration-move-anchor">
          <span>{copy[request.move.side]}</span>
          <strong title={request.anchorName}>{request.anchorName}</strong>
        </div>
      )}
      <footer className="illustration-move-actions">
        <button type="button" ref={cancelRef} onClick={onCancel} disabled={pending}>
          {t('confirmModal.cancel')}
        </button>
        <button type="button" className="illustration-move-apply" onClick={onConfirm} disabled={pending} aria-busy={pending}>
          {pending && <Loader2 className="animate-spin motion-reduce:animate-none" size={14} aria-hidden="true" />}
          {pending ? copy.saving : copy.confirm}
        </button>
      </footer>
    </dialog>
  );
}

export function IllustrationMoveConfirmation({ request, pending, onCancel, onConfirm }) {
  if (!request) return null;
  return <MoveDialog request={request} pending={pending} onCancel={onCancel} onConfirm={onConfirm} />;
}
