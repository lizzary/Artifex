import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_SCROLL_SPEED = 1.15;

function pointOnTray(gesture, clientX, clientY) {
  const { bounds, element } = gesture;
  return {
    x: Math.max(bounds.left, Math.min(clientX, bounds.right)) - bounds.left,
    y: Math.max(bounds.top, Math.min(clientY, bounds.bottom)) - bounds.top + element.scrollTop,
  };
}

function intersectsCard(from, to, card) {
  let start = 0;
  let end = 1;
  for (const [origin, delta, minimum, maximum] of [
    [from.x, to.x - from.x, card.left, card.right],
    [from.y, to.y - from.y, card.top, card.bottom],
  ]) {
    if (delta === 0) {
      if (origin < minimum || origin > maximum) return false;
      continue;
    }
    const enter = (minimum - origin) / delta;
    const exit = (maximum - origin) / delta;
    start = Math.max(start, Math.min(enter, exit));
    end = Math.min(end, Math.max(enter, exit));
    if (start > end) return false;
  }
  return true;
}

function collectCards(gesture, clientX, clientY) {
  const to = pointOnTray(gesture, clientX, clientY);
  const from = gesture.lastPoint ?? to;
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);
  for (const card of gesture.cards) {
    if (card.top > maxY) break;
    if (card.bottom < minY || gesture.visited.has(card.id)) continue;
    if (!intersectsCard(from, to, card)) continue;
    gesture.visited.add(card.id);
    gesture.pending.add(card.id);
  }
  gesture.lastPoint = to;
  gesture.clientX = clientX;
  gesture.clientY = clientY;
  gesture.scrollTop = gesture.element.scrollTop;
}

function flushSelection(gesture, onSelectCards) {
  if (gesture.pending.size === 0) return;
  onSelectCards([...gesture.pending], true);
  gesture.pending.clear();
}

export default function useTraySweepSelection(enabled, onSelectCards) {
  const gestureRef = useRef(null);
  const [sweeping, setSweeping] = useState(false);

  const stop = useCallback((commit = false) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    gestureRef.current = null;
    cancelAnimationFrame(gesture.frame);
    if (commit) flushSelection(gesture, onSelectCards);
    if (gesture.element.hasPointerCapture?.(gesture.pointerId)) {
      gesture.element.releasePointerCapture(gesture.pointerId);
    }
    setSweeping(false);
  }, [onSelectCards]);

  useEffect(() => {
    if (!enabled) return undefined;
    const cancel = () => stop();
    const escape = (event) => {
      if (event.key !== 'Escape' || !gestureRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      stop();
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      window.removeEventListener('keydown', escape, true);
      stop();
    };
  }, [enabled, stop]);

  function onPointerDown(event) {
    if (!enabled || gestureRef.current || event.button !== 2) return;
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget;
    const bounds = element.getBoundingClientRect();
    const { scrollTop } = element;
    const cards = Array.from(element.querySelectorAll('[data-tray-card-id]'), (card) => {
      const rect = card.getBoundingClientRect();
      return {
        id: Number(card.dataset.trayCardId),
        top: rect.top - bounds.top + scrollTop,
        bottom: rect.bottom - bounds.top + scrollTop,
        left: rect.left - bounds.left,
        right: rect.right - bounds.left,
      };
    });
    const gesture = {
      element,
      bounds,
      cards,
      pointerId: event.pointerId,
      visited: new Set(),
      pending: new Set(),
      lastFrame: performance.now(),
    };
    gestureRef.current = gesture;
    element.setPointerCapture?.(event.pointerId);
    collectCards(gesture, event.clientX, event.clientY);
    flushSelection(gesture, onSelectCards);
    setSweeping(true);

    function tick(now) {
      if (gestureRef.current !== gesture) return;
      const { clientX, clientY } = gesture;
      const elapsed = Math.min(32, now - gesture.lastFrame);
      gesture.lastFrame = now;
      if (clientX >= bounds.left && clientX <= bounds.right) {
        const edge = Math.min(36, bounds.height / 4);
        const bottomPressure = Math.max(0, (clientY - bounds.bottom + edge) / edge);
        const topPressure = Math.max(0, (bounds.top + edge - clientY) / edge);
        const pressure = Math.min(1, bottomPressure) - Math.min(1, topPressure);
        if (pressure) {
          const distance = Math.max(1, pressure ** 2 * MAX_SCROLL_SPEED * elapsed);
          element.scrollTop += Math.sign(pressure) * distance;
        }
      }
      if (element.scrollTop !== gesture.scrollTop) collectCards(gesture, clientX, clientY);
      flushSelection(gesture, onSelectCards);
      gesture.frame = requestAnimationFrame(tick);
    }
    gesture.frame = requestAnimationFrame(tick);
  }

  function onPointerMove(event) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!(event.buttons & 2)) {
      stop(true);
      return;
    }
    for (const point of event.nativeEvent.getCoalescedEvents?.() ?? []) {
      collectCards(gesture, point.clientX, point.clientY);
    }
    collectCards(gesture, event.clientX, event.clientY);
  }

  function onPointerUp(event) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    collectCards(gesture, event.clientX, event.clientY);
    stop(true);
  }

  function cancelPointer(event) {
    if (gestureRef.current?.pointerId === event.pointerId) stop();
  }

  return {
    sweeping,
    sweepHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: cancelPointer,
      onLostPointerCapture: cancelPointer,
    },
  };
}
