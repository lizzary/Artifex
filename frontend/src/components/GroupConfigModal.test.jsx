import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import GroupConfigModal from './GroupConfigModal';
import { diffColorSet } from '../utils/colorConfig';
import { LocaleProvider } from '../contexts/LocaleContext';

jest.mock('./TagPromptSuggest', () => ({
  __esModule: true,
  default: ({ value, onChange, placeholder }) => <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />,
}));

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
    customName: '',
    terms: [
      { value: 'portrait', scope: 'prompt', operator: 'and', negated: false, open: 0, close: 0 },
      { value: '1girl', scope: 'tag', operator: 'and', negated: false, open: 0, close: 0 },
      { value: 'monochrome', scope: 'tag', operator: 'or', negated: false, open: 0, close: 0 },
    ],
    color: '#112233',
    borderColor: '#445566',
  };

  return {
    sets: [{ id: 'set-1', name: 'Default', pairs: [pair], match_order: [pair.id], manual_assignments: {} }],
    activeSetId: 'set-1',
    switchSet: jest.fn(),
    addSet: jest.fn(),
    removeSet: jest.fn(),
    saveSetChanges: jest.fn().mockResolvedValue(true),
    palette: [{ bg: '#112233', border: '#445566' }],
    matchOrder: [pair.id],
    otherColor: { bg: '#112233', border: '#556677' },
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

  test('saves an independently selected custom color for the group', async () => {
    const config = createConfig();
    render(
      <LocaleProvider>
        <GroupConfigModal config={config} onClose={jest.fn()} />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Change group color' }));
    expect(screen.getByRole('dialog', { name: 'Group color' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Custom color'), { target: { value: '#123456' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));

    expect(config.saveSetChanges).toHaveBeenCalledTimes(1);
    const [, { pairs: savedPairs }] = config.saveSetChanges.mock.calls[0];
    expect(savedPairs[0]).toMatchObject({
      color: 'rgba(18, 52, 86, 0.08)',
      borderColor: 'rgba(18, 52, 86, 0.35)',
    });
  });

  test('keeps a named color group when its automatic rule is empty', async () => {
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
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));

    const [, { pairs: savedPairs }] = config.saveSetChanges.mock.calls[0];
    expect(savedPairs).toHaveLength(1);
    expect(savedPairs[0]).toMatchObject({ customName: 'Curated picks', terms: [] });
  });

  test('retains local draft and original target when server fields and active set change', async () => {
    const config = createConfig();
    config.sets[0].pairs[0].customName = 'Original';
    const onClose = jest.fn();
    const { rerender } = render(<LocaleProvider><GroupConfigModal config={config} onClose={onClose} /></LocaleProvider>);
    const nameInput = screen.getByDisplayValue('Original');
    fireEvent.change(nameInput, { target: { value: 'My edit' } });
    const updated = {
      ...config,
      activeSetId: 'set-2',
      sets: [
        { ...config.sets[0], pairs: [{ ...config.sets[0].pairs[0], color: '#ff0000', borderColor: '#ff0000' }] },
        { id: 'set-2', name: 'Other set', pairs: [], match_order: [], manual_assignments: {} },
      ],
    };
    rerender(<LocaleProvider><GroupConfigModal config={updated} onClose={onClose} /></LocaleProvider>);
    expect(screen.getByDisplayValue('My edit')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    const [baseline, draft] = config.saveSetChanges.mock.calls[0];
    expect(diffColorSet(baseline, draft)).toEqual([
      { type: 'update_pair', set_id: 'set-1', pair_id: 'pair-1', changes: { customName: 'My edit' } },
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('keeps the editor and draft when saving fails', async () => {
    const config = createConfig();
    config.sets[0].pairs[0].customName = 'Original';
    config.saveSetChanges.mockRejectedValue(new Error('Color group no longer exists'));
    const onClose = jest.fn();
    render(<LocaleProvider><GroupConfigModal config={config} onClose={onClose} /></LocaleProvider>);
    fireEvent.change(screen.getByDisplayValue('Original'), { target: { value: 'My edit' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    expect(screen.getByRole('alert')).toHaveTextContent('Color group no longer exists');
    expect(screen.getByDisplayValue('My edit')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('waits for saved changes before switching sets', async () => {
    const config = createConfig();
    config.sets.push({ id: 'set-2', name: 'Other set', pairs: [], match_order: [], manual_assignments: {} });
    let finishSaving;
    config.saveSetChanges.mockReturnValue(new Promise((resolve) => { finishSaving = resolve; }));
    render(<LocaleProvider><GroupConfigModal config={config} onClose={jest.fn()} /></LocaleProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Other set' }));
    expect(config.switchSet).not.toHaveBeenCalled();
    await act(async () => finishSaving(true));
    await waitFor(() => expect(config.switchSet).toHaveBeenCalledWith('set-2'));
  });


  test('keeps default initialization after a no-op save followed by failed set creation', async () => {
    const config = createConfig();
    config.sets = [{ id: 'default', name: 'Default', pairs: [], match_order: [], manual_assignments: {} }];
    config.activeSetId = 'default';
    config.isDraftSet = true;
    config.saveSetChanges.mockResolvedValue(false);
    config.addSet.mockRejectedValue(new Error('Create failed'));
    render(<LocaleProvider><GroupConfigModal config={config} onClose={jest.fn()} /></LocaleProvider>);
    await act(async () => fireEvent.click(screen.getByTitle('New Set')));
    expect(screen.getByRole('alert')).toHaveTextContent('Create failed');
    fireEvent.change(screen.getByDisplayValue('Default'), { target: { value: 'Renamed default' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    expect(config.saveSetChanges.mock.calls[1][2]).toBe(true);
  });


  test('reopens an empty default draft when the confirmed deletion has no successor', async () => {
    const config = createConfig();
    config.activeSetId = 'default';
    config.sets[0] = { ...config.sets[0], id: 'default' };
    config.sets[0].pairs[0].customName = 'Deleted pair';
    config.sets.push({ id: 'set-b', name: 'B', pairs: [], match_order: [], manual_assignments: {} });
    let finishDeleting;
    config.removeSet.mockReturnValue(new Promise((resolve) => { finishDeleting = resolve; }));
    const { rerender } = render(<LocaleProvider><GroupConfigModal config={config} onClose={jest.fn()} /></LocaleProvider>);
    fireEvent.click(screen.getByTitle('Delete Set'));
    fireEvent.click(screen.getByTitle('Delete Set'));
    const empty = { ...config, isDraftSet: true, sets: [{ id: 'default', name: 'Default', pairs: [], match_order: [], manual_assignments: {} }] };
    rerender(<LocaleProvider><GroupConfigModal config={empty} onClose={jest.fn()} /></LocaleProvider>);
    await act(async () => finishDeleting(null));
    expect(screen.queryByDisplayValue('Deleted pair')).not.toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Default'), { target: { value: 'New default' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    expect(config.saveSetChanges.mock.calls[0][2]).toBe(true);
  });

});
