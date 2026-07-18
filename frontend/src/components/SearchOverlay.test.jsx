import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { deleteIllustrations, searchIllustrations } from '../api';
import { removeManualAssignmentsForIllustrations } from '../hooks/useGroupConfig';
import SearchOverlay from './SearchOverlay';

const mockRemoveManualGroupIds = jest.fn();
const mockAddToast = jest.fn();

jest.mock('../api', () => ({
  checkModelStatus: jest.fn(),
  deleteIllustration: jest.fn(),
  deleteIllustrations: jest.fn(),
  retagIllustrations: jest.fn(),
  searchIllustrations: jest.fn(),
}));
jest.mock('../hooks/useGroupConfig', () => ({
  __esModule: true,
  default: () => ({
    pairs: [],
    matchOrder: [],
    manualAssignments: {},
    otherColor: { bg: '', border: '' },
    removeManualGroupIds: mockRemoveManualGroupIds,
  }),
  removeManualAssignmentsForIllustrations: jest.fn().mockResolvedValue(false),
}));
jest.mock('../hooks/useQuality', () => () => ['low', jest.fn()]);
jest.mock('../hooks/useCardSize', () => {
  const hook = () => [3, jest.fn(), 'grid-cols-3'];
  hook.CARD_SIZE_MIN = 1;
  hook.CARD_SIZE_MAX = 6;
  return { __esModule: true, default: hook, CARD_SIZE_MIN: 1, CARD_SIZE_MAX: 6 };
});
jest.mock('../hooks/useDownloadConfig', () => () => ({ format: '' }));
jest.mock('../hooks/useOriginalRatio', () => () => [false, jest.fn()]);
jest.mock('../contexts/LocaleContext', () => ({
  useLocale: () => ({
    t: (key, params = {}) => Object.entries(params).reduce(
      (text, [name, value]) => `${text} ${name}=${value}`,
      key,
    ),
  }),
}));
jest.mock('./Toast', () => ({ useToast: () => ({ addToast: mockAddToast }) }));
jest.mock('./IllustrationCard', () => function IllustrationCard({ illustration, onCtrlClick, isSelected }) {
  return (
    <button
      type="button"
      aria-label={`illustration-${illustration.id}`}
      data-selected={String(isSelected)}
      onClick={() => onCtrlClick(illustration)}
    >
      {illustration.original_filename}
    </button>
  );
});
jest.mock('./TagPromptSuggest', () => () => null);
jest.mock('./SettingsSelect', () => () => null);
jest.mock('./ColorGroup', () => ({ children }) => children);
jest.mock('./ConfirmModal', () => () => null);
jest.mock('./Lightbox', () => () => null);
jest.mock('./GroupConfigModal', () => () => null);

describe('SearchOverlay batch deletion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.removeItem('gallery-group-by');
    removeManualAssignmentsForIllustrations.mockResolvedValue(false);
    searchIllustrations.mockResolvedValue({
      total: 2,
      items: [
        { id: 1, original_filename: 'one.png' },
        { id: 2, original_filename: 'two.png' },
      ],
    });
    deleteIllustrations.mockResolvedValue({ deleted: [1], failed: [2] });
  });

  test('removes only successful deletions and keeps failed items selected', async () => {
    render(<SearchOverlay query="cat" onClose={jest.fn()} />);
    const first = await screen.findByRole('button', { name: 'illustration-1' });
    const second = screen.getByRole('button', { name: 'illustration-2' });
    fireEvent.click(first);
    fireEvent.click(second);

    fireEvent.click(screen.getByRole('button', { name: /searchOverlay\.batch\.delete/ }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'illustration-1' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'illustration-2' })).toHaveAttribute('data-selected', 'true');
    expect(mockRemoveManualGroupIds).toHaveBeenCalledWith([1]);
    expect(removeManualAssignmentsForIllustrations).toHaveBeenCalledWith([1]);
  });
});
