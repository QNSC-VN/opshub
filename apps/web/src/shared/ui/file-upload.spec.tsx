// @vitest-environment jsdom
/**
 * `FileUploadWidget`, on the reading side.
 *
 * WHAT THESE PIN. The widget used to be handed a `currentUrl` that was always null — nothing fetched the
 * file already on the record, and the confirm response's URL was being misread — so it only ever showed a
 * local preview of a file just chosen. These assert that a URL which DOES arrive reaches the DOM, which is
 * the half the readback hooks now supply.
 *
 * THE DOCUMENT CASE IS A LINK, and that is the point of reading the URL back at all: before this it was
 * plain text, so a document already attached could be seen to exist and not opened.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/api/use-upload', () => ({
  useUpload: () => ({ upload: vi.fn(), uploading: false }),
}));

import { FileUploadWidget } from './file-upload';

const base = {
  presignUrl: '/v1/x/presign',
  confirmUrl: '/v1/x/confirm',
  accept: 'application/pdf,image/jpeg,image/png',
  onSuccess: () => {},
};

describe('FileUploadWidget', () => {
  it('renders an existing document as a link you can open', () => {
    render(<FileUploadWidget {...base} mode="document" currentUrl="https://s3/fitnote.pdf" />);

    const link = screen.getByRole('link', { name: /view document/i });
    expect(link.getAttribute('href')).toBe('https://s3/fitnote.pdf');
    // A new tab, and `noreferrer` — the href is a presigned storage URL and must not leak as a referrer.
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('shows nothing to open when the record has no document', () => {
    render(<FileUploadWidget {...base} mode="document" currentUrl={null} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders an existing photo from the URL read back off the record', () => {
    render(<FileUploadWidget {...base} mode="image" currentUrl="https://s3/photo.jpg" />);
    // `alt` is "Preview" for both a local preview and a stored photo; the src is what distinguishes them.
    expect(screen.getByAltText('Preview').getAttribute('src')).toBe('https://s3/photo.jpg');
  });

  it('shows the empty prompt when an image record has none', () => {
    render(<FileUploadWidget {...base} mode="image" currentUrl={null} />);
    expect(screen.queryByAltText('Preview')).toBeNull();
    expect(screen.getByText(/click or drag/i)).toBeTruthy();
  });
});
