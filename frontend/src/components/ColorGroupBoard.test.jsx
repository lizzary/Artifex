import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ColorGroupBoard, { buildColorBoardLayout } from './ColorGroupBoard';
import { LocaleProvider } from '../contexts/LocaleContext';

jest.mock('framer-motion', () => {
  const ReactModule = require('react');
  const MotionDiv = ReactModule.forwardRef(({
    children, initial, animate, exit, ...props
  }, ref) => <div ref={ref} {...props}>{children}</div>);
  return { motion: { div: MotionDiv } };
});

const illustration = (id, tags = '') => ({
  id,
  tags,
  width: 600,
  height: 900,
  original_filename: `${id}.png`,
  thumbnail_url: `/api/illustrations/${id}/thumbnail`,
  extended_data: {},
});

const automaticTerm = (value) => ({
  value,
  scope: 'tag',
  operator: 'and',
  negated: false,
  open: 0,
  close: 0,
});

describe('color group board layout', () => {
  beforeEach(() => {
    localStorage.setItem('gallery-locale', 'en');
    localStorage.removeItem('color-board-free-row-limit');
  });

  test('places every illustration by effective group while keeping manual-only circles', () => {
    const pairs = [
      { id: 'warm', customName: 'Warm', terms: [automaticTerm('warm')] },
      { id: 'curated', customName: 'Curated', terms: [] },
    ];
    const layout = buildColorBoardLayout(
      [illustration(1, 'warm'), illustration(2, 'warm'), illustration(3)],
      pairs,
      ['warm', 'curated'],
      { 2: 'curated' },
      (index) => `Color group ${index}`,
    );

    expect(layout.circles.map((circle) => ({
      id: circle.id,
      items: circle.items.map((item) => item.id),
      manualCount: circle.manualCount,
      computedCount: circle.computedCount,
    }))).toEqual([
      { id: 'warm', items: [1], manualCount: 0, computedCount: 1 },
      { id: 'curated', items: [2], manualCount: 1, computedCount: 0 },
    ]);
    expect(layout.freeItems.map((item) => item.id)).toEqual([3]);
    expect(layout.cards).toHaveLength(3);
  });

  test('caps the Other row by both the user limit and responsive width', () => {
    const pair = { id: 'warm', customName: 'Warm', terms: [automaticTerm('warm')] };
    const layout = buildColorBoardLayout(
      Array.from({ length: 8 }, (_, index) => illustration(index + 1)),
      [pair],
      ['warm'],
      {},
      (index) => `Color group ${index}`,
      { freeRowLimit: 12, maxFreeWidth: 286 },
    );

    expect(layout.freeColumns).toBe(3);
    expect(layout.freeContentWidth).toBeLessThanOrEqual(286);
    expect(layout.cards[3].x).toBe(layout.cards[0].x);
    expect(layout.cards[3].y).toBeGreaterThan(layout.cards[0].y);
  });

  test('lets the user persist the maximum number of Other thumbnails per row', () => {
    const pair = { id: 'warm', customName: 'Warm', terms: [automaticTerm('warm')] };
    render(
      <LocaleProvider>
        <ColorGroupBoard
          groupName="Studio"
          illustrations={[illustration(1)]}
          pairs={[pair]}
          matchOrder={['warm']}
          manualAssignments={{}}
          onAssign={jest.fn()}
          onConfigure={jest.fn()}
          onClose={jest.fn()}
        />
      </LocaleProvider>,
    );

    const rowLimit = screen.getByRole('slider', { name: 'Maximum thumbnails per row' });
    expect(rowLimit).toHaveValue('10');
    fireEvent.change(rowLimit, { target: { value: '16' } });
    expect(rowLimit).toHaveValue('16');
    expect(localStorage.getItem('color-board-free-row-limit')).toBe('16');
  });

  test('opens color-group configuration from the empty-board action', () => {
    const onConfigure = jest.fn();
    render(
      <LocaleProvider>
        <ColorGroupBoard
          groupName="Empty studio"
          illustrations={[]}
          pairs={[]}
          matchOrder={[]}
          manualAssignments={{}}
          quality="low"
          onAssign={jest.fn()}
          onConfigure={onConfigure}
          onClose={jest.fn()}
        />
      </LocaleProvider>,
    );

    const action = screen.getByRole('button', { name: 'Configure color groups' });
    fireEvent.pointerDown(action, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(action, { button: 0, pointerId: 1 });
    fireEvent.click(action);

    expect(onConfigure).toHaveBeenCalledTimes(1);
  });

  test('shows the entire illustration in its original aspect ratio on hover', () => {
    const pair = { id: 'warm', customName: 'Warm', terms: [automaticTerm('warm')] };
    render(
      <LocaleProvider>
        <ColorGroupBoard
          groupName="Studio"
          illustrations={[illustration(1, 'warm')]}
          pairs={[pair]}
          matchOrder={['warm']}
          manualAssignments={{}}
          quality="original"
          onAssign={jest.fn()}
          onConfigure={jest.fn()}
          onClose={jest.fn()}
        />
      </LocaleProvider>,
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: /1\.png/ }), {
      clientX: 160,
      clientY: 140,
    });
    const boardThumbnail = document.querySelector('[data-board-card] img');
    expect(boardThumbnail).toHaveAttribute('src', '/api/illustrations/1/thumbnail?quality=low');
    expect(boardThumbnail).toHaveAttribute('loading', 'lazy');
    expect(boardThumbnail).toHaveAttribute('decoding', 'async');
    const previewImage = screen.getByRole('img', { name: '1.png' });
    expect(previewImage).toHaveClass('object-contain');
    expect(previewImage.parentElement).toHaveStyle({ height: '360px' });
    expect(previewImage).toHaveAttribute('src', '/api/illustrations/1/thumbnail?quality=normal');
    fireEvent.error(previewImage);
    expect(previewImage).toHaveAttribute('src', '/api/illustrations/1/thumbnail?quality=low');
  });

  test('zooms with the wheel and clamps the board between 50% and 200%', () => {
    const pair = { id: 'warm', customName: 'Warm', terms: [automaticTerm('warm')] };
    const { container } = render(
      <LocaleProvider>
        <ColorGroupBoard
          groupName="Studio"
          illustrations={[illustration(1, 'warm')]}
          pairs={[pair]}
          matchOrder={['warm']}
          manualAssignments={{}}
          onAssign={jest.fn()}
          onConfigure={jest.fn()}
          onClose={jest.fn()}
        />
      </LocaleProvider>,
    );
    const viewport = container.querySelector('[data-color-board-viewport]');

    for (let index = 0; index < 30; index += 1) {
      fireEvent.wheel(viewport, { deltaY: -120, clientX: 500, clientY: 300 });
    }
    expect(screen.getByText('200%')).toBeInTheDocument();

    for (let index = 0; index < 60; index += 1) {
      fireEvent.wheel(viewport, { deltaY: 120, clientX: 500, clientY: 300 });
    }
    expect(screen.getByText('50%')).toBeInTheDocument();
  });
});
