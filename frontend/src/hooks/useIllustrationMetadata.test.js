import { act, renderHook, waitFor } from '@testing-library/react';
import { getIllustrationMetadata } from '../api';
import useIllustrationMetadata from './useIllustrationMetadata';

jest.mock('../api', () => ({ getIllustrationMetadata: jest.fn() }));

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe('useIllustrationMetadata', () => {
  test('ignores a stale response after navigating to another illustration', async () => {
    const first = deferred();
    const second = deferred();
    getIllustrationMetadata.mockImplementation((id) => (
      id === 1 ? first.promise : second.promise
    ));

    const { result, rerender } = renderHook(
      ({ id }) => useIllustrationMetadata(id, true),
      { initialProps: { id: 1 } },
    );
    rerender({ id: 2 });

    await act(async () => { second.resolve({ Seed: 'second' }); });
    await waitFor(() => expect(result.current.metadata).toEqual({ Seed: 'second' }));

    await act(async () => { first.resolve({ Seed: 'stale' }); });
    expect(result.current.metadata).toEqual({ Seed: 'second' });
  });
});
