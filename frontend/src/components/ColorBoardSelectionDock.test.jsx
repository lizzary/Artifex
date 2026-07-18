import React from 'react';
import {
  act, fireEvent, render, screen, within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocaleProvider } from '../contexts/LocaleContext';
import ColorBoardSelectionDock from './ColorBoardSelectionDock';

jest.mock('./TagPromptSuggest', () => function MockTagSuggest({
  value, onChange, onEnter, placeholder, inputClassName,
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      className={inputClassName}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onEnter(value);
      }}
    />
  );
});

const illustration = (id, tags) => ({
  id,
  tags,
  width: 600,
  height: 900,
  original_filename: `${id}.png`,
  thumbnail_url: `/api/illustrations/${id}/thumbnail`,
});

function renderDock(overrides = {}) {
  const props = {
    selectedIllustrations: [
      illustration(1, 'portrait, warm, studio'),
      illustration(2, 'portrait, warm'),
      illustration(3, 'portrait, night'),
    ],
    quality: 'low',
    resolveColorGroupName: (item) => (item.id === 3 ? 'Cool tones' : 'Warm tones'),
    onClear: jest.fn(),
    onDownload: jest.fn().mockResolvedValue({ downloaded: [1, 2, 3], failed: [] }),
    onDelete: jest.fn().mockResolvedValue({ deleted: [1, 2, 3], failed: [] }),
    onUpdateTags: jest.fn().mockResolvedValue({ updated: [], missing: [] }),
    tagPanelOpen: true,
    onTagPanelChange: jest.fn(),
    ...overrides,
  };

  render(
    <LocaleProvider>
      <ColorBoardSelectionDock {...props} />
    </LocaleProvider>,
  );
  return props;
}

describe('ColorBoardSelectionDock', () => {
  beforeEach(() => localStorage.setItem('gallery-locale', 'en'));

  test('highlights common tags before the partial union and adds a tag to every selection item', async () => {
    const props = renderDock();

    expect(screen.getByText('Held by everyone')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Held by everyone' })).toHaveClass(
      'artifex-scrollbar',
      'artifex-scrollbar-quiet',
      'flex-1',
      'overflow-y-auto',
    );
    expect(screen.getByText('portrait')).toBeInTheDocument();
    expect(screen.getByText('Held by some')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Held by some' })).toHaveClass(
      'artifex-scrollbar',
      'artifex-scrollbar-quiet',
      'flex-1',
      'overflow-y-auto',
    );
    expect(screen.getByText('2/3')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Add a tag to every selected illustration…'), {
      target: { value: 'cinematic' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add to all' }));
      await Promise.resolve();
    });

    expect(props.onUpdateTags).toHaveBeenCalledWith([1, 2, 3], 'add', ['cinematic']);
  });

  test('resizes the tag panel with its drag handle and keyboard controls', () => {
    renderDock();
    const panel = screen.getByRole('region', { name: 'Tags in this selection' });
    const handle = screen.getByRole('separator', { name: 'Drag to adjust the tag panel height' });

    expect(panel).toHaveStyle({ height: '336px' });
    fireEvent(handle, new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientY: 420,
    }));
    fireEvent(handle, new MouseEvent('pointermove', {
      bubbles: true, clientY: 360,
    }));
    fireEvent(handle, new MouseEvent('pointerup', {
      bubbles: true, clientY: 360,
    }));
    expect(panel).toHaveStyle({ height: '396px' });
    expect(handle).toHaveAttribute('aria-valuenow', '396');

    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(panel).toHaveStyle({ height: '372px' });
  });

  test('removes a common tag from all selected illustrations', async () => {
    const props = renderDock();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove portrait' }));
      await Promise.resolve();
    });
    expect(props.onUpdateTags).toHaveBeenCalledWith([1, 2, 3], 'remove', ['portrait']);
  });

  test('shows partial holders, removes one holder, and previews immediately', async () => {
    const props = renderDock();
    const removeWarm = screen.getByRole('button', { name: 'Remove warm' });
    fireEvent.mouseEnter(removeWarm.parentElement.parentElement);

    const popover = screen.getByRole('dialog', { name: 'Illustrations with warm' });
    expect(within(popover).getByText('1.png')).toBeInTheDocument();
    expect(within(popover).getAllByText('Warm tones')).toHaveLength(2);

    const firstRow = within(popover).getByText('1.png').parentElement.parentElement;
    fireEvent.mouseEnter(firstRow);
    const previewImage = screen.getByRole('img', { name: '1.png' });
    expect(previewImage).toHaveClass('object-contain');
    expect(previewImage.parentElement).toHaveStyle({ height: '320px' });
    expect(previewImage).toHaveAttribute('src', '/api/illustrations/1/thumbnail?quality=normal');
    fireEvent.error(previewImage);
    expect(previewImage).toHaveAttribute('src', '/api/illustrations/1/thumbnail?quality=low');

    await act(async () => {
      fireEvent.click(within(popover).getAllByRole('button', { name: 'Remove tag' })[0]);
      await Promise.resolve();
    });
    expect(props.onUpdateTags).toHaveBeenCalledWith([1], 'remove', ['warm']);
  });

  test('shows at most seven holders until the popover is expanded', () => {
    const selected = Array.from({ length: 9 }, (_, index) => (
      illustration(index + 1, index < 8 ? 'shared, partial' : 'shared')
    ));
    renderDock({ selectedIllustrations: selected });
    const removePartial = screen.getByRole('button', { name: 'Remove partial' });
    fireEvent.mouseEnter(removePartial.parentElement.parentElement);

    const popover = screen.getByRole('dialog', { name: 'Illustrations with partial' });
    expect(within(popover).queryByText('8.png')).not.toBeInTheDocument();
    fireEvent.click(within(popover).getByRole('button', { name: 'Show all 8' }));
    expect(within(popover).getByText('8.png')).toBeInTheDocument();
    expect(within(popover).getByRole('list', { name: 'Illustrations with partial' })).toHaveClass(
      'artifex-scrollbar',
      'artifex-scrollbar-quiet',
      'max-h-72',
      'overflow-y-auto',
    );
  });
});
