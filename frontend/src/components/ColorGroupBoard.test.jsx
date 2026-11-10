import { useState } from 'react';
import {
  fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocaleProvider } from '../contexts/LocaleContext';
import ColorGroupBoard from './ColorGroupBoard';

jest.mock('../hooks/useProjectSettings', () => (key, defaultValue) => [defaultValue, jest.fn()]);
jest.mock('../api', () => ({ listTags: jest.fn().mockResolvedValue([]) }));

const illustration = (id) => ({
  id,
  original_filename: `${id}.png`,
  thumbnail_url: `/api/illustrations/${id}/thumbnail`,
});

const pairs = Array.from({ length: 8 }, (_, index) => ({
  id: `group-${index + 1}`,
  customName: `Color ${index + 1}`,
}));

function pointer(target, type, {
  x = 0, y = 0, button = 0, ctrlKey = false,
} = {}) {
  const event = new MouseEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, button, ctrlKey,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
}

function BoardHarness({ ids, onDelete, ...actions }) {
  const [illustrations, setIllustrations] = useState(() => ids.map(illustration));
  async function deleteIllustrations(targetIds) {
    const result = await onDelete(targetIds);
    const deleted = new Set(result.deleted);
    setIllustrations((current) => current.filter(({ id }) => !deleted.has(id)));
    return result;
  }

  return (
    <ColorGroupBoard
      groupName="Archive"
      illustrations={illustrations}
      pairs={pairs}
      matchOrder={[]}
      manualAssignments={Object.fromEntries(ids.map((id) => [id, 'group-1']))}
      onDelete={deleteIllustrations}
      {...actions}
    />
  );
}

function renderBoard(onAssign = jest.fn().mockResolvedValue(true), {
  ids = [1, 2], onDownload, onDelete, onUpdateTags, onClose = jest.fn(),
} = {}) {
  render(
    <LocaleProvider>
      <BoardHarness
        ids={ids}
        onAssign={onAssign}
        onClose={onClose}
        onDelete={onDelete}
        onDownload={onDownload}
        onUpdateTags={onUpdateTags}
      />
    </LocaleProvider>,
  );
  const boardSurface = (selector) => {
    // The canvas layers have no accessible roles and are needed to simulate screen-space hit tests.
    // eslint-disable-next-line testing-library/no-node-access
    return screen.getByRole('dialog').querySelector(selector);
  };
  const viewport = boardSurface('[data-color-board-viewport]');
  const toggle = screen.getByRole('button', { name: 'Illustration tray' });
  document.elementFromPoint = jest.fn((x, y) => (x > 875 && y < 150 ? toggle : viewport));
  return {
    viewport,
    toggle,
    onAssign,
    boardCard: (id) => screen.queryByRole('button', { name: new RegExp(`^${id}\\.png ·`) }),
    center: (id) => {
      const circle = boardSurface(`[data-board-circle="${id}"]`);
      const world = boardSurface('[data-color-board-world]');
      const values = world.style.transform.match(/-?\d+(?:\.\d+)?/g).map(Number);
      const [, offsetX, offsetY, , scale] = values;
      const radius = parseFloat(circle.style.width) / 2;
      return {
        x: offsetX + (parseFloat(circle.style.left) + radius) * scale,
        y: offsetY + (parseFloat(circle.style.top) + radius) * scale,
      };
    },
  };
}

const elementFromPoint = document.elementFromPoint;

beforeEach(() => localStorage.setItem('gallery-locale', 'en'));
afterEach(() => {
  document.elementFromPoint = elementFromPoint;
});

test('holds a multi-selection when dropped on the collapsed tray and moves it after panning', async () => {
  const { viewport, toggle, onAssign, boardCard, center } = renderBoard();
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(boardCard(1), { detail: 0 });
  pointer(boardCard(2), 'pointerdown', { ...center('group-1'), ctrlKey: true });
  pointer(viewport, 'pointerup', center('group-1'));
  pointer(boardCard(1), 'pointerdown', center('group-1'));
  pointer(viewport, 'pointermove', { x: 920, y: 110 });
  expect(toggle).toHaveAttribute('data-drop-active', 'true');
  pointer(viewport, 'pointerup', { x: 920, y: 110 });

  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(boardCard(1)).toBeNull();
  expect(boardCard(2)).toBeNull();
  expect(onAssign).not.toHaveBeenCalled();

  const destination = center('group-8');
  pointer(viewport, 'pointerdown', { x: 200, y: 500, button: 2 });
  pointer(viewport, 'pointermove', { x: 700 - destination.x, y: 810 - destination.y, button: 2 });
  pointer(viewport, 'pointerup', { x: 700 - destination.x, y: 810 - destination.y, button: 2 });

  pointer(screen.getByRole('button', { name: '1.png' }), 'pointerdown', { x: 920, y: 160 });
  pointer(viewport, 'pointermove', center('group-8'));
  pointer(viewport, 'pointerup', center('group-8'));

  await waitFor(() => expect(boardCard(1)).toBeInTheDocument());
  expect(onAssign).toHaveBeenCalledWith([1, 2], 'group-8');
  expect(boardCard(2)).toBeInTheDocument();
});

test('leaves an illustration in the tray on an invalid drop or failed save and can return it to the board', async () => {
  const onAssign = jest.fn().mockRejectedValue(new Error('Offline'));
  const { viewport, toggle, boardCard } = renderBoard(onAssign);
  fireEvent.click(toggle);
  fireEvent.click(boardCard(1), { detail: 0 });
  fireEvent.click(screen.getByRole('button', { name: 'Add selected' }));

  const staged = screen.getByRole('button', { name: '1.png' });
  pointer(staged, 'pointerdown', { x: 920, y: 160 });
  pointer(viewport, 'pointermove', { x: 20, y: 30 });
  pointer(viewport, 'pointerup', { x: 20, y: 30 });
  expect(onAssign).not.toHaveBeenCalled();
  expect(staged).toBeInTheDocument();

  fireEvent.change(screen.getByRole('combobox', { name: 'Choose a color group' }), { target: { value: 'group-8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Place' }));
  await waitFor(() => expect(staged).toBeEnabled());
  expect(onAssign).toHaveBeenCalledWith([1], 'group-8');
  expect(boardCard(1)).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Return selected illustrations to the board' }));
  expect(boardCard(1)).toBeInTheDocument();
  expect(onAssign).toHaveBeenCalledTimes(1);
});

test('uses the batch dock for staged items without including an existing board selection', async () => {
  const onDownload = jest.fn().mockResolvedValue({ downloaded: [1, 2], failed: [] });
  const onUpdateTags = jest.fn().mockResolvedValue({ updated: [], missing: [] });
  const { toggle, boardCard } = renderBoard(undefined, { ids: [1, 2, 3], onDownload, onUpdateTags });

  fireEvent.click(toggle);
  fireEvent.click(boardCard(1));
  fireEvent.click(boardCard(2), { ctrlKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'Add selected' }));
  expect(screen.getByText('2 selected in tray')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();

  fireEvent.click(boardCard(3));
  expect(screen.getByText('1 selected')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '1.png' }));
  fireEvent.click(screen.getByRole('button', { name: '2.png' }), { ctrlKey: true });
  expect(screen.getByText('2 selected in tray')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Tags' }));
  fireEvent.change(screen.getByPlaceholderText('Add a tag to every selected illustration…'), {
    target: { value: 'archive' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add to all' }));
  expect(onUpdateTags).toHaveBeenCalledWith([1, 2], 'add', ['archive']);

  const download = screen.getByRole('button', { name: 'Download' });
  await waitFor(() => expect(download).toBeEnabled());
  fireEvent.click(download);
  expect(onDownload).toHaveBeenCalledWith([illustration(1), illustration(2)]);
  await waitFor(() => expect(download).toBeEnabled());
});

test('confirms tray deletion and retains selected items whose deletion failed', async () => {
  const onDelete = jest.fn().mockResolvedValue({ deleted: [1], failed: [{ id: 2 }] });
  const onClose = jest.fn();
  const { toggle, boardCard } = renderBoard(undefined, { onDelete, onClose });
  fireEvent.click(toggle);
  fireEvent.click(boardCard(1));
  fireEvent.click(boardCard(2), { ctrlKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'Add selected' }));

  const remove = screen.getByRole('button', { name: 'Delete', exact: true });
  fireEvent.click(remove);
  expect(screen.getByText('Delete selected illustrations?')).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByText('Delete selected illustrations?')).not.toBeInTheDocument();
  expect(onDelete).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(toggle).toHaveAttribute('aria-expanded', 'true');

  fireEvent.click(remove);
  fireEvent.click(screen.getByRole('button', { name: 'Delete illustrations' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '1.png' })).not.toBeInTheDocument());
  expect(onDelete).toHaveBeenCalledWith([1, 2]);
  expect(screen.getByRole('button', { name: '2.png' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('1 selected in tray')).toBeInTheDocument();
  expect(remove).toBeEnabled();
});
