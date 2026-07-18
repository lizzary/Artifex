import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import GroupConfigModal from './GroupConfigModal';
import { LocaleProvider } from '../contexts/LocaleContext';

jest.mock('framer-motion', () => {
  const ReactModule = require('react');
  const MotionDiv = ReactModule.forwardRef(({ children }, ref) => <div ref={ref}>{children}</div>);
  const ReorderGroup = ({ children }) => <div>{children}</div>;
  const ReorderItem = ReactModule.forwardRef(({ children }, ref) => <div ref={ref}>{children}</div>);

  return {
    motion: { div: MotionDiv },
    AnimatePresence: ({ children }) => children,
    Reorder: { Group: ReorderGroup, Item: ReorderItem },
    useDragControls: () => ({ start: jest.fn() }),
  };
});

function createConfig() {
  const pair = {
    id: 'pair-1',
    terms: [
      { value: 'portrait', scope: 'prompt', operator: 'and', negated: false, open: 0, close: 0 },
      { value: '1girl', scope: 'tag', operator: 'and', negated: false, open: 0, close: 0 },
      { value: 'monochrome', scope: 'tag', operator: 'or', negated: false, open: 0, close: 0 },
    ],
    color: 'rgb(var(--clr-surface-tertiary))',
    borderColor: 'rgb(var(--clr-accent))',
  };

  return {
    sets: [{ id: 'set-1', name: 'Default', pairs: [pair], match_order: [pair.id] }],
    activeSetId: 'set-1',
    switchSet: jest.fn(),
    addSet: jest.fn(),
    removeSet: jest.fn(),
    renameSet: jest.fn(),
    setPairs: jest.fn(),
    palette: [{ bg: 'rgb(var(--clr-surface-tertiary))', border: 'rgb(var(--clr-accent))' }],
    matchOrder: [pair.id],
    otherColor: { bg: 'rgb(var(--clr-surface-tertiary))', border: 'rgb(var(--clr-edge-primary))' },
  };
}

describe('GroupConfigModal progressive logic editor', () => {
  beforeEach(() => localStorage.setItem('gallery-locale', 'en'));

  test('keeps NOT and grouping tools hidden until requested, then leaves only active state', () => {
    render(
      <LocaleProvider>
        <GroupConfigModal config={createConfig()} onClose={jest.fn()} />
      </LocaleProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Apply NOT' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select condition' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit this logic group' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Logic$/ }));
    const selectors = screen.getAllByRole('button', { name: 'Select condition' });
    expect(selectors).toHaveLength(3);

    fireEvent.click(selectors[0]);
    fireEvent.click(selectors[1]);
    fireEvent.click(screen.getByRole('button', { name: "Group (…)" }));

    const selectorsAfterGrouping = screen.getAllByRole('button', { name: 'Select condition' });
    fireEvent.click(selectorsAfterGrouping[2]);
    fireEvent.click(screen.getByRole('button', { name: 'Apply NOT' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('button', { name: 'Select condition' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit this logic group' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove NOT from this condition' })).toHaveTextContent('NOT');
  });

  test('shows manual grouping as the fixed first step while keeping rules visually primary', () => {
    render(
      <LocaleProvider>
        <GroupConfigModal config={createConfig()} onClose={jest.fn()} />
      </LocaleProvider>,
    );

    const logicOrder = screen.getByRole('complementary', { name: 'Grouping logic order' });
    expect(within(logicOrder).getByText('Manual grouping')).toBeInTheDocument();
    expect(within(logicOrder).getByText('FIXED FIRST')).toBeInTheDocument();
    expect(within(logicOrder).getByText('Color group 1')).toBeInTheDocument();
    expect(within(logicOrder).getByText('Other')).toBeInTheDocument();
    expect(screen.getByText(/Board placements still enter this group first/)).toBeInTheDocument();
  });

  test('renders automatic inference as an image-backed icon instead of standalone fx text', () => {
    const { container } = render(
      <LocaleProvider>
        <GroupConfigModal config={createConfig()} onClose={jest.fn()} />
      </LocaleProvider>,
    );

    const ruleTitle = screen.getByText('Automatic entry rule').closest('span');
    const icon = ruleTitle.querySelector('[data-icon="automatic-inference"]');

    expect(icon).toBeInTheDocument();
    expect(icon).toBeEmptyDOMElement();
    expect(icon.style.maskImage).toContain('data:image/png;base64');
    expect(container).not.toHaveTextContent(/(^|\s)fx(\s|$)/i);
  });

  test('saves an independently selected custom color for the group', () => {
    const config = createConfig();
    render(
      <LocaleProvider>
        <GroupConfigModal config={config} onClose={jest.fn()} />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Change group color' }));
    expect(screen.getByRole('dialog', { name: 'Group color' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Custom color'), { target: { value: '#123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(config.setPairs).toHaveBeenCalledTimes(1);
    const [savedPairs] = config.setPairs.mock.calls[0];
    expect(savedPairs[0]).toMatchObject({
      color: 'rgba(18, 52, 86, 0.08)',
      borderColor: 'rgba(18, 52, 86, 0.35)',
    });
  });

  test('keeps a named color group when its automatic rule is empty', () => {
    const config = createConfig();
    config.sets[0].pairs[0] = {
      ...config.sets[0].pairs[0],
      customName: 'Curated picks',
      terms: [],
    };

    render(
      <LocaleProvider>
        <GroupConfigModal config={config} onClose={jest.fn()} />
      </LocaleProvider>,
    );

    expect(screen.getByText('Manual-only color group')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const [savedPairs] = config.setPairs.mock.calls[0];
    expect(savedPairs).toHaveLength(1);
    expect(savedPairs[0]).toMatchObject({ customName: 'Curated picks', terms: [] });
  });
});
