import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '../contexts/LocaleContext';
import { getIllustrationMemberships, groupDisplayName } from '../utils/grouping';
import { persistIllustrationOrder, refreshGroupSettings } from './useGroupSettings';

const CARD = '[data-illustration-reorder-card]';
const PANEL = '[data-illustration-drop-group]';
const HEADING = '[data-illustration-drop-heading]';
const REORDER_TYPE = 'application/x-artifex-illustrations';
const CARD_GAP = 24;

const messages = {
  zh: {
    grip: '拖动调整默认顺序',
    unnamed: '未命名颜色组',
    changed: '图库已发生变更，请重新拖动。',
    reloadFailed: '顺序已保存，请刷新查看最新结果。',
  },
  en: {
    grip: 'Drag to change the default order',
    unnamed: 'Unnamed color group',
    changed: 'The library changed. Try dragging again.',
    reloadFailed: 'Order saved. Refresh to see the latest result.',
  },
};

function closestCard(container, x, y, movingIds) {
  let closest = null;
  let distance = CARD_GAP ** 2;
  for (const card of container.querySelectorAll(CARD)) {
    if (movingIds.has(Number(card.dataset.illustrationReorderCard))) continue;
    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const dx = Math.max(0, rect.left - x, x - rect.right);
    const dy = Math.max(0, rect.top - y, y - rect.bottom);
    const nextDistance = dx ** 2 + dy ** 2;
    if (nextDistance < distance) {
      closest = card;
      distance = nextDistance;
    }
  }
  return closest;
}

function findDestination(event, groupsById, movingIds) {
  const zone = event.currentTarget;
  const element = event.target;
  const panel = element.closest?.(PANEL);
  const groupId = panel?.dataset.illustrationDropGroup ?? null;
  if (groupsById.size && !panel) return null;

  const heading = element.closest?.(HEADING);
  const firstCard = panel?.querySelector(CARD);
  if (panel && (heading || !firstCard)) {
    const anchorId = firstCard
      ? [...panel.querySelectorAll(CARD)].map((card) => Number(card.dataset.illustrationReorderCard))
        .find((id) => !movingIds.has(id))
      : groupsById.get(groupId)?.items.find((item) => !movingIds.has(item.id))?.id;
    if (!anchorId) return null;
    const rect = (heading || panel).getBoundingClientRect();
    return {
      anchorId,
      groupId,
      side: 'before',
      position: { axis: 'horizontal', x: rect.left + 8, y: rect.bottom - 2, length: rect.width - 16 },
    };
  }

  const card = element.closest?.(CARD) ?? closestCard(panel || zone, event.clientX, event.clientY, movingIds);
  if (!card || !zone.contains(card)) return null;
  const anchorId = Number(card.dataset.illustrationReorderCard);
  if (!anchorId || movingIds.has(anchorId)) return null;
  const rect = card.getBoundingClientRect();
  const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
  const x = side === 'before' ? rect.left - 5 : rect.right + 5;
  const top = Math.max(4, rect.top + 3);
  const bottom = Math.min(window.innerHeight - 4, rect.bottom - 3);
  return {
    anchorId,
    groupId,
    side,
    position: { axis: 'vertical', x, y: top, length: Math.max(0, bottom - top) },
  };
}

function changesOrder(items, ids, movingIds, { anchorId, side }) {
  const remaining = items.filter((item) => !movingIds.has(item.id)).map((item) => item.id);
  const anchorIndex = remaining.indexOf(anchorId);
  if (anchorIndex === -1) return false;
  if (remaining.length + ids.length !== items.length) return true;
  const insertAt = anchorIndex + Number(side === 'after');
  return items.some((item, index) => {
    if (index < insertAt) return remaining[index] !== item.id;
    if (index < insertAt + ids.length) return ids[index - insertAt] !== item.id;
    return remaining[index - ids.length] !== item.id;
  });
}

export default function useIllustrationReorder({
  groupId, enabled, illustrations, groups, selectedIds, activeConfig, onCommitted, onError,
}) {
  const { locale, t } = useLocale();
  const copy = messages[locale] || messages.en;
  const session = useRef(null);
  const submitting = useRef(false);
  const [movingIds, setMovingIds] = useState(null);
  const [marker, setMarker] = useState(null);
  const [request, setRequest] = useState(null);
  const [pending, setPending] = useState(false);
  const groupsById = useMemo(() => new Map(groups?.map((group) => [group.id, group])), [groups]);
  const illustrationsById = useMemo(() => new Map(illustrations.map((item) => [item.id, item])), [illustrations]);

  const describeGroup = useCallback((id) => {
    const pair = activeConfig?.pairs.find((item) => item.id === id);
    return {
      name: id === 'other' ? t('colorGroup.other') : groupDisplayName(pair) || copy.unnamed,
      color: pair?.borderColor,
    };
  }, [activeConfig?.pairs, copy.unnamed, t]);

  const finishDrag = useCallback(() => {
    session.current = null;
    setMovingIds(null);
    setMarker(null);
  }, []);

  useEffect(() => {
    if (!enabled) finishDrag();
  }, [enabled, finishDrag]);

  useEffect(() => {
    if (!movingIds) return undefined;
    window.addEventListener('dragend', finishDrag);
    window.addEventListener('blur', finishDrag);
    return () => {
      window.removeEventListener('dragend', finishDrag);
      window.removeEventListener('blur', finishDrag);
    };
  }, [finishDrag, movingIds]);

  const startDrag = useCallback((event, illustration) => {
    if (!enabled || request || submitting.current) {
      event.preventDefault();
      return;
    }
    const selected = selectedIds.has(illustration.id)
      ? [...selectedIds].map((id) => illustrationsById.get(id)).filter(Boolean)
      : [illustration];
    const ids = selected.map((item) => item.id);
    const idSet = new Set(ids);
    const memberships = groups && getIllustrationMemberships(
      selected, activeConfig.pairs, activeConfig.matchOrder, activeConfig.manualAssignments,
    );
    event.dataTransfer.setData(REORDER_TYPE, String(illustration.id));
    event.dataTransfer.effectAllowed = 'move';
    session.current = { ids, idSet, memberships, setId: activeConfig?.activeSetId };
    setMovingIds(idSet);
  }, [activeConfig, enabled, groups, illustrationsById, request, selectedIds]);

  const cardDrag = useCallback((illustration) => enabled && !request && !pending ? {
    label: copy.grip,
    moving: movingIds?.has(illustration.id) ?? false,
    onStart: (event) => startDrag(event, illustration),
    onEnd: finishDrag,
  } : undefined, [copy.grip, enabled, finishDrag, movingIds, pending, request, startDrag]);

  const submit = useCallback(async (move) => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    try {
      await persistIllustrationOrder(groupId, move);
      setRequest(null);
      try {
        await onCommitted?.();
      } catch {
        onError?.(new Error(copy.reloadFailed));
      }
    } catch (error) {
      setRequest(null);
      if (error.status === 409 || error.status === 404) {
        await Promise.allSettled([refreshGroupSettings(), onCommitted?.()]);
        onError?.(new Error(copy.changed));
      } else {
        onError?.(error);
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }, [copy.changed, copy.reloadFailed, groupId, onCommitted, onError]);

  function getDestination(event, active) {
    if (!enabled || !active || (active.memberships && active.setId !== activeConfig?.activeSetId)) return null;
    return findDestination(event, groupsById, active.idSet);
  }

  function onDragOver(event) {
    const active = session.current;
    if (!active) return;
    event.preventDefault();
    const destination = getDestination(event, active);
    event.dataTransfer.dropEffect = destination ? 'move' : 'none';
    if (!destination) {
      setMarker(null);
      return;
    }
    const group = destination.groupId != null ? describeGroup(destination.groupId) : null;
    const changesGroup = group && active.ids.some((id) => (
      active.memberships?.get(id)?.effectiveGroupId !== destination.groupId
    ));
    const next = {
      ...destination.position,
      count: active.ids.length,
      group: changesGroup ? group.name : null,
    };
    setMarker((previous) => previous?.axis === next.axis && previous.x === next.x
      && previous.y === next.y && previous.length === next.length && previous.group === next.group
      ? previous : next);
  }

  function onDragLeave(event) {
    if (!session.current || event.currentTarget.contains(event.relatedTarget)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.relatedTarget || event.clientX < rect.left || event.clientX >= rect.right
      || event.clientY < rect.top || event.clientY >= rect.bottom) setMarker(null);
  }

  function onDrop(event) {
    const active = session.current;
    if (!active) return;
    event.preventDefault();
    const destination = getDestination(event, active);
    finishDrag();
    if (!destination) return;
    const { anchorId, groupId: targetId, side } = destination;
    const move = { ids: active.ids, anchor_id: anchorId, side };
    const sourceCounts = new Map();
    const assignments = {};
    for (const id of active.ids) {
      const sourceId = active.memberships?.get(id)?.effectiveGroupId;
      if (!sourceId || targetId == null || sourceId === targetId) continue;
      sourceCounts.set(sourceId, (sourceCounts.get(sourceId) || 0) + 1);
      assignments[id] = targetId === 'other' ? null : targetId;
    }
    const changedCount = Object.keys(assignments).length;
    if (changedCount) {
      setRequest({
        move: { ...move, color: { set_id: active.setId, assignments } },
        target: describeGroup(targetId),
        sources: [...sourceCounts].map(([id, count]) => ({ id, count, ...describeGroup(id) })),
        changedCount,
        anchorName: illustrationsById.get(anchorId)?.original_filename,
      });
    } else if (changesOrder(groupsById.get(targetId)?.items ?? illustrations, active.ids, active.idSet, destination)) {
      void submit(move);
    }
  }

  return {
    busy: Boolean(movingIds || request || pending),
    zoneProps: { onDragOver, onDragLeave, onDrop },
    cardDrag,
    marker,
    confirmationProps: {
      request,
      pending,
      onCancel: () => { if (!submitting.current) setRequest(null); },
      onConfirm: () => { if (request) void submit(request.move); },
    },
  };
}
