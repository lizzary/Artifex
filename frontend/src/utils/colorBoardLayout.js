import { getIllustrationMemberships, groupDisplayName } from './grouping';
import { clamp } from './illustrationPreview';

export const CARD_SIZE = 78;
export const CARD_RADIUS = 16;
export const WORLD_MARGIN = 180;
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2;
export const FREE_CARD_COLUMN_GAP = 26;
export const FREE_ROW_LIMIT_MIN = 1;
export const FREE_ROW_LIMIT_MAX = 20;
export const FREE_ROW_LIMIT_DEFAULT = 10;

const CIRCLE_GAP = 150;
const FREE_CARD_ROW_GAP = 28;
const MAX_CIRCLE_RADIUS = 3200;

function circleRadius(itemCount) {
  return clamp(230 + Math.sqrt(Math.max(itemCount, 1)) * 48, 258, MAX_CIRCLE_RADIUS);
}

export function pointInCircle(point, circle) {
  return Math.hypot(point.x - circle.x, point.y - circle.y) <= circle.radius;
}

export function rectFromPoints(start, end) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
}

export function pointInBoardCard(point, card) {
  const centerX = card.x + CARD_SIZE / 2;
  const centerY = card.y + CARD_SIZE / 2;
  const radians = -(card.rotation || 0) * Math.PI / 180;
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians);
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians);
  const halfSize = CARD_SIZE / 2;
  const absoluteX = Math.abs(localX);
  const absoluteY = Math.abs(localY);
  if (absoluteX > halfSize || absoluteY > halfSize) return false;
  const cornerStart = halfSize - CARD_RADIUS;
  if (absoluteX <= cornerStart || absoluteY <= cornerStart) return true;
  return Math.hypot(absoluteX - cornerStart, absoluteY - cornerStart) <= CARD_RADIUS;
}

export function hitTestColorBoardCard(cards, point) {
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    if (pointInBoardCard(point, cards[index])) return cards[index];
  }
  return null;
}

export function cardsInBoardViewport(
  cards,
  bounds,
  margin = CARD_SIZE,
  offsetForCard = null,
) {
  const left = bounds.left - margin;
  const top = bounds.top - margin;
  const right = bounds.right + margin;
  const bottom = bounds.bottom + margin;
  return cards.filter((card) => {
    const offset = offsetForCard?.(card);
    const x = card.x + (offset?.x || 0);
    const y = card.y + (offset?.y || 0);
    return (
      x + CARD_SIZE >= left
      && y + CARD_SIZE >= top
      && x <= right
      && y <= bottom
    );
  });
}

export function buildColorBoardLayout(
  illustrations,
  pairs,
  matchOrder,
  manualAssignments,
  untitledLabel,
  options = {},
) {
  const memberships = getIllustrationMemberships(
    illustrations,
    pairs,
    matchOrder,
    manualAssignments,
  );
  const itemsByGroup = new Map(pairs.map((pair) => [pair.id, []]));
  const freeItems = [];

  illustrations.forEach((illustration) => {
    const membership = memberships.get(illustration.id);
    const target = itemsByGroup.get(membership?.effectiveGroupId);
    if (target) target.push(illustration);
    else freeItems.push(illustration);
  });

  const rawCircles = pairs.map((pair, index) => {
    const items = itemsByGroup.get(pair.id) || [];
    const manualCount = items.filter((item) => memberships.get(item.id)?.source === 'manual').length;
    return {
      ...pair,
      index,
      items,
      manualCount,
      computedCount: items.length - manualCount,
      label: groupDisplayName(pair) || untitledLabel(index + 1),
      radius: circleRadius(items.length),
    };
  });

  const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(Math.max(rawCircles.length, 1)))));
  const circles = [];
  let cursorY = WORLD_MARGIN;
  let widestRow = 0;

  for (let rowStart = 0; rowStart < rawCircles.length; rowStart += columns) {
    const row = rawCircles.slice(rowStart, rowStart + columns);
    const rowRadius = Math.max(...row.map((circle) => circle.radius));
    const rowCenterY = cursorY + rowRadius;
    let cursorX = WORLD_MARGIN;
    row.forEach((circle) => {
      circles.push({
        ...circle,
        x: cursorX + circle.radius,
        y: rowCenterY,
      });
      cursorX += circle.radius * 2 + CIRCLE_GAP;
    });
    widestRow = Math.max(widestRow, cursorX - CIRCLE_GAP + WORLD_MARGIN);
    cursorY += rowRadius * 2 + CIRCLE_GAP;
  }

  const cards = [];
  circles.forEach((circle) => {
    const usableRadius = Math.max(90, circle.radius - 112);
    const count = circle.items.length;
    circle.items.forEach((illustration, index) => {
      const angle = index * 2.3999632297 + circle.index * 0.57;
      const distance = count <= 1 ? 0 : Math.sqrt((index + 0.35) / count) * usableRadius;
      cards.push({
        illustration,
        membership: memberships.get(illustration.id),
        x: circle.x + Math.cos(angle) * distance - CARD_SIZE / 2,
        y: circle.y + Math.sin(angle) * distance - CARD_SIZE / 2,
        rotation: ((Number(illustration.id) || index) % 7) - 3,
      });
    });
  });

  const circleBottom = circles.length
    ? Math.max(...circles.map((circle) => circle.y + circle.radius))
    : WORLD_MARGIN + 240;
  const minimumWorldWidth = Math.max(widestRow, 1500);
  const freeTop = circleBottom + 210;
  const requestedFreeColumns = clamp(
    Math.round(Number(options.freeRowLimit) || FREE_ROW_LIMIT_DEFAULT),
    FREE_ROW_LIMIT_MIN,
    FREE_ROW_LIMIT_MAX,
  );
  const requestedMaxFreeWidth = Number(options.maxFreeWidth);
  const maxFreeWidth = Number.isFinite(requestedMaxFreeWidth)
    ? Math.max(CARD_SIZE, requestedMaxFreeWidth)
    : Number.POSITIVE_INFINITY;
  const freeColumnStride = CARD_SIZE + FREE_CARD_COLUMN_GAP;
  const responsiveFreeColumns = Number.isFinite(maxFreeWidth)
    ? Math.max(1, Math.floor((maxFreeWidth - CARD_SIZE) / freeColumnStride) + 1)
    : requestedFreeColumns;
  const freeColumns = Math.min(requestedFreeColumns, responsiveFreeColumns);
  const freeContentWidth = CARD_SIZE + Math.max(0, freeColumns - 1) * freeColumnStride;
  const worldWidth = Math.max(minimumWorldWidth, freeContentWidth + WORLD_MARGIN * 2);
  const freeLeft = (worldWidth - freeContentWidth) / 2;
  freeItems.forEach((illustration, index) => {
    cards.push({
      illustration,
      membership: memberships.get(illustration.id),
      x: freeLeft + (index % freeColumns) * freeColumnStride,
      y: freeTop + Math.floor(index / freeColumns) * (CARD_SIZE + FREE_CARD_ROW_GAP),
      rotation: ((Number(illustration.id) || index) % 7) - 3,
    });
  });

  const freeRows = Math.ceil(freeItems.length / freeColumns);
  const worldHeight = Math.max(
    circleBottom + 360,
    freeTop + Math.max(1, freeRows) * (CARD_SIZE + FREE_CARD_ROW_GAP) + WORLD_MARGIN,
  );

  return {
    cards,
    circles,
    freeItems,
    freeColumns,
    freeContentWidth,
    freeLeft,
    freeTop,
    memberships,
    worldWidth,
    worldHeight,
  };
}
