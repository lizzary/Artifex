import useGroupViewSetting from './useGroupSettings';
const DEFAULT_SIZE = 3; // medium

const GRID_CLASSES = {
  1: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10',
  2: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8',
  3: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
  4: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
  5: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
};

export function getCardSizeGrid(size) {
  return GRID_CLASSES[size] || GRID_CLASSES[DEFAULT_SIZE];
}

export const CARD_SIZE_MIN = 1;
export const CARD_SIZE_MAX = 5;

export default function useCardSize(groupId) {
  const [size, setSize] = useGroupViewSetting(groupId, 'card_size');

  return [size, setSize, getCardSizeGrid(size)];
}
