import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import useIllustrationFileDrop, {
  isIllustrationImageFile,
  partitionIllustrationFiles,
} from './useIllustrationFileDrop';

function DropHarness({ disabled = false, onFiles, onRejected }) {
  const { isDraggingFiles, dropTargetProps } = useIllustrationFileDrop({
    disabled,
    onFiles,
    onRejected,
  });
  return (
    <div data-testid="drop-target" {...dropTargetProps}>
      {isDraggingFiles ? 'Drop now' : 'Idle'}
    </div>
  );
}

describe('illustration file drop', () => {
  test('recognizes image MIME types and image extensions', () => {
    expect(isIllustrationImageFile(new File(['x'], 'drawing.bin', { type: 'image/png' }))).toBe(true);
    expect(isIllustrationImageFile(new File(['x'], 'drawing.WEBP'))).toBe(true);
    expect(isIllustrationImageFile(new File(['x'], 'notes.txt', { type: 'text/plain' }))).toBe(false);
  });

  test('partitions a mixed drop and uploads only illustrations', () => {
    const image = new File(['image'], 'drawing.png', { type: 'image/png' });
    const textFile = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    expect(partitionIllustrationFiles([image, textFile])).toEqual({
      accepted: [image],
      rejected: [textFile],
    });
  });

  test('shows drop state and dispatches accepted and rejected files', () => {
    const onFiles = jest.fn();
    const onRejected = jest.fn();
    render(<DropHarness onFiles={onFiles} onRejected={onRejected} />);
    const target = screen.getByTestId('drop-target');
    const image = new File(['image'], 'drawing.png', { type: 'image/png' });
    const textFile = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    const dataTransfer = { types: ['Files'], files: [image, textFile], dropEffect: 'none' };

    fireEvent.dragEnter(target, { dataTransfer });
    expect(target).toHaveTextContent('Drop now');
    fireEvent.dragOver(target, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe('copy');
    fireEvent.drop(target, { dataTransfer });

    expect(target).toHaveTextContent('Idle');
    expect(onFiles).toHaveBeenCalledWith([image]);
    expect(onRejected).toHaveBeenCalledWith([textFile]);
  });

  test('prevents browser navigation but does not upload while disabled', () => {
    const onFiles = jest.fn();
    render(<DropHarness disabled onFiles={onFiles} />);
    const target = screen.getByTestId('drop-target');
    const image = new File(['image'], 'drawing.png', { type: 'image/png' });
    const dataTransfer = { types: ['Files'], files: [image], dropEffect: 'copy' };

    fireEvent.dragEnter(target, { dataTransfer });
    expect(target).toHaveTextContent('Idle');
    fireEvent.dragOver(target, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe('none');
    fireEvent.drop(target, { dataTransfer });
    expect(onFiles).not.toHaveBeenCalled();
  });
});
