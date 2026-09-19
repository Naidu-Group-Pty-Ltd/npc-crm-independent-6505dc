import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ListingLightbox } from './ListingLightbox';
import type { StoredListingImage } from '@/lib/listingImages';

afterEach(cleanup);

const photo = (n: number): StoredListingImage =>
  ({ url: `https://cdn.example.com/p${n}.jpg`, position: n, origin: 'scraped' }) as StoredListingImage;

const THREE = [photo(1), photo(2), photo(3)];

describe('ListingLightbox', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<ListingLightbox images={THREE} openAt={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('opens at the photo that was clicked, not at the first one', () => {
    render(<ListingLightbox images={THREE} openAt={2} onClose={vi.fn()} label="13 Larundel Road" />);
    expect(screen.getByText('3 / 3')).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('src')).toContain('p3.jpg');
  });

  it('wraps in both directions', () => {
    render(<ListingLightbox images={THREE} openAt={0} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Previous photo'));
    expect(screen.getByText('3 / 3')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Next photo'));
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });

  it('navigates and dismisses from the keyboard', () => {
    const onClose = vi.fn();
    render(<ListingLightbox images={THREE} openAt={0} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('2 / 3')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('1 / 3')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses on the backdrop but not on the photograph itself', () => {
    const onClose = vi.fn();
    render(<ListingLightbox images={THREE} openAt={0} onClose={onClose} />);

    fireEvent.click(screen.getByRole('img'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides the arrows and the counter for a single photograph', () => {
    render(<ListingLightbox images={[photo(1)]} openAt={0} onClose={vi.fn()} />);
    expect(screen.queryByLabelText('Next photo')).toBeNull();
    expect(screen.queryByText('1 / 1')).toBeNull();
  });

  it('locks the page behind it and gives the scroll position back on close', () => {
    const { rerender } = render(<ListingLightbox images={THREE} openAt={0} onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<ListingLightbox images={THREE} openAt={null} onClose={vi.fn()} />);
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('stays closed when there are no photographs, whatever index it is handed', () => {
    // The hero offers `onExpand` on the Street View slide too; opening an empty
    // overlay there would trap the reader behind a black screen.
    const { container } = render(<ListingLightbox images={[]} openAt={0} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('clamps an out-of-range index rather than rendering nothing', () => {
    render(<ListingLightbox images={THREE} openAt={9} onClose={vi.fn()} />);
    expect(screen.getByText('3 / 3')).toBeTruthy();
  });
});
