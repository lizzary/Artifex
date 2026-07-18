import { act, renderHook } from '@testing-library/react';
import useOriginalRatio from './useOriginalRatio';

describe('useOriginalRatio', () => {
  beforeEach(() => localStorage.removeItem('gallery-original-ratio'));

  test('persists the gallery display preference', () => {
    const { result } = renderHook(() => useOriginalRatio());
    expect(result.current[0]).toBe(false);

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('gallery-original-ratio')).toBe('true');
  });
});
