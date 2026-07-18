import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocaleProvider } from '../contexts/LocaleContext';
import IllustrationCard from './IllustrationCard';

jest.mock('framer-motion', () => ({
  motion: { div: ({ children, layout, initial, animate, exit, transition, ...props }) => <div {...props}>{children}</div> },
}));

const illustration = {
  id: 1,
  width: 600,
  height: 900,
  original_filename: 'portrait.png',
  thumbnail_url: '/api/illustrations/1/thumbnail',
};

function renderCard(preserveAspectRatio = false) {
  render(
    <LocaleProvider>
      <IllustrationCard
        illustration={illustration}
        onClick={jest.fn()}
        preserveAspectRatio={preserveAspectRatio}
      />
    </LocaleProvider>,
  );
}

describe('IllustrationCard display modes', () => {
  beforeEach(() => localStorage.setItem('gallery-locale', 'en'));

  test('uses the existing cropped square presentation by default', () => {
    renderCard();
    const image = screen.getByRole('img', { name: 'portrait.png' });
    expect(image).toHaveClass('object-cover');
    expect(image.parentElement).toHaveClass('aspect-square');
  });

  test('uses the source aspect ratio without cropping when enabled', () => {
    renderCard(true);
    const image = screen.getByRole('img', { name: 'portrait.png' });
    expect(image).toHaveClass('object-contain');
    expect(image).not.toHaveClass('group-hover:scale-105');
    expect(image.parentElement).not.toHaveClass('aspect-square');
    expect(image.parentElement.style.aspectRatio).toBe('600 / 900');
    expect(image.parentElement.parentElement).toHaveClass('self-start');
  });
});
