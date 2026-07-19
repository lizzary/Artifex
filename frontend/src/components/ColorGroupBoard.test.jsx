import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ColorGroupBoard, { buildColorBoardLayout } from './ColorGroupBoard';
import { LocaleProvider } from '../contexts/LocaleContext';
import {
  cardsInBoardViewport,
  hitTestColorBoardCard,
} from '../utils/colorBoardLayout';
import {
  COLOR_BOARD_RENDERER_OPTIONS,
  COLOR_BOARD_RENDERER_STORAGE_KEY,
} from '../utils/colorBoardRendererPreference';

jest.mock('framer-motion', () => {
  const ReactModule = require('react');
  const MotionDiv = ReactModule.forwardRef(({
    children, initial, animate, exit, ...props
  }, ref) => <div ref={ref} {...props}>{children}</div>);
  return { motion: { div: MotionDiv } };
});

jest.mock('./color-board/WebGLBoardRenderer', () => {
  const ReactModule = require('react');
  const MockWebGLBoardRenderer = ReactModule.forwardRef(({ onUnavailable }, ref) => {
    ReactModule.useImperativeHandle(ref, () => ({
      beginDrag() {},
      drawSelectionRect() {},
      endDrag() {},
      hideSelectionRect() {},
      setDragOffset() {},
      setHoveredCard() {},
      setView() {},
      usesPointerHitTesting: true,
    }), []);
    return ReactModule.createElement(
      'div',
      { 'data-board-renderer': 'webgl', 'data-testid': 'mock-webgl-renderer' },
      ReactModule.createElement(
        'button',
        { onClick: () => onUnavailable(new Error('mock WebGL failure')), type: 'button' },
        'Simulate WebGL failure',
      ),
    );
  });
  return { __esModule: true, default: MockWebGLBoardRenderer };
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
    localStorage.removeItem(COLOR_BOARD_RENDERER_STORAGE_KEY);
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

  test('keeps expanding a dense color circle instead of stacking thousands of cards into the legacy radius', () => {
    const pair = { id: 'warm', customName: 'Warm', terms: [automaticTerm('warm')] };
    const illustrations = Array.from({ length: 2000 }, (_, index) => illustration(index + 1, 'warm'));
    const layout = buildColorBoardLayout(
      illustrations,
      [pair],
      ['warm'],
      {},
      (index) => `Color group ${index}`,
    );

    expect(layout.circles[0].radius).toBeGreaterThan(2000);
    expect(layout.cards).toHaveLength(2000);
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

  test('shares rotated-card hit testing across renderers', () => {
    const pair = { id: 'warm', customName: 'Warm', terms: [automaticTerm('warm')] };
    const layout = buildColorBoardLayout(
      [illustration(1, 'warm')],
      [pair],
      ['warm'],
      {},
      (index) => `Color group ${index}`,
    );
    const card = layout.cards[0];

    expect(hitTestColorBoardCard(layout.cards, {
      x: card.x + 39,
      y: card.y + 39,
    })).toBe(card);
    expect(hitTestColorBoardCard(layout.cards, {
      x: card.x - 100,
      y: card.y - 100,
    })).toBeNull();
    expect(hitTestColorBoardCard([{
      ...card,
      rotation: 0,
    }], {
      x: card.x + 1,
      y: card.y + 1,
    })).toBeNull();
  });

  test('culls only cards outside the WebGL viewport without changing layout coordinates', () => {
    const cards = [
      { illustration: illustration(1), x: 10, y: 20, rotation: 0 },
      { illustration: illustration(2), x: 500, y: 500, rotation: 3 },
    ];

    const visible = cardsInBoardViewport(cards, {
      left: 0, top: 0, right: 200, bottom: 200,
    }, 0);

    expect(visible).toEqual([cards[0]]);
    expect(visible[0]).toBe(cards[0]);
    expect(cardsInBoardViewport(cards, {
      left: 0, top: 0, right: 200, bottom: 200,
    }, 0, (card) => (card === cards[1] ? { x: -400, y: -400 } : null)))
      .toEqual(cards);
  });

  test('mounts only WebGL when requested and falls back to DOM without changing the device preference', async () => {
    localStorage.setItem(
      COLOR_BOARD_RENDERER_STORAGE_KEY,
      COLOR_BOARD_RENDERER_OPTIONS.WEBGL,
    );
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

    expect(await screen.findByTestId('mock-webgl-renderer')).toBeInTheDocument();
    expect(container.querySelector('[data-board-renderer="dom"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-board-card]')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Simulate WebGL failure' }));

    expect(await screen.findByText(/Switched to DOM compatibility mode/)).toBeInTheDocument();
    expect(container.querySelector('[data-board-renderer="webgl"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-board-renderer="dom"]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-board-card]')).toHaveLength(1);
    expect(localStorage.getItem(COLOR_BOARD_RENDERER_STORAGE_KEY)).toBe(
      COLOR_BOARD_RENDERER_OPTIONS.WEBGL,
    );
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

  test('updates drag offsets only on the cards participating in the drag', () => {
    const pair = { id: 'warm', customName: 'Warm', terms: [automaticTerm('warm')] };
    const frameCallbacks = [];
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = jest.fn((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });

    try {
      render(
        <LocaleProvider>
          <ColorGroupBoard
            groupName="Studio"
            illustrations={[illustration(1, 'warm'), illustration(2, 'warm')]}
            pairs={[pair]}
            matchOrder={['warm']}
            manualAssignments={{}}
            onAssign={jest.fn()}
            onConfigure={jest.fn()}
            onClose={jest.fn()}
          />
        </LocaleProvider>,
      );

      const firstCard = screen.getByRole('button', { name: /1\.png/ });
      const secondCard = screen.getByRole('button', { name: /2\.png/ });
      firstCard.setPointerCapture = jest.fn();
      firstCard.hasPointerCapture = jest.fn(() => false);

      const pointerDown = new MouseEvent('pointerdown', {
        bubbles: true, button: 0, clientX: 20, clientY: 20,
      });
      const pointerMove = new MouseEvent('pointermove', {
        bubbles: true, clientX: 60, clientY: 60,
      });
      Object.defineProperty(pointerDown, 'pointerId', { value: 7 });
      Object.defineProperty(pointerMove, 'pointerId', { value: 7 });
      fireEvent(firstCard, pointerDown);
      fireEvent(firstCard, pointerMove);
      frameCallbacks.shift()?.();

      expect(firstCard.style.getPropertyValue('--board-drag-x')).not.toBe('');
      expect(secondCard.style.getPropertyValue('--board-drag-x')).toBe('');
      expect(firstCard.parentElement.style.getPropertyValue('--board-drag-x')).toBe('');
      expect(firstCard).toHaveAttribute('data-dragging', 'true');
      expect(secondCard).not.toHaveAttribute('data-dragging');
      expect(firstCard.parentElement).toHaveAttribute('data-drag-active', 'true');
      expect(document.querySelector('[data-board-circle="warm"]').style.filter).toBe('');

      const pointerCancel = new MouseEvent('pointercancel', { bubbles: true });
      Object.defineProperty(pointerCancel, 'pointerId', { value: 7 });
      fireEvent(firstCard, pointerCancel);
      expect(firstCard.parentElement).not.toHaveAttribute('data-drag-active');
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });
});
