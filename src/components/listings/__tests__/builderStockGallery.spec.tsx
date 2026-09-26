/**
 * A PROPERTY'S GALLERY SHOWS WHAT THE BUILDER PUBLISHED — NO MORE, NO LESS.
 *
 * The gallery is drawn from the photographs the Builders Network sent, in the
 * order it sent them. The Command Centre elects nothing: which pictures are a
 * property's photographs is the Builder Portal's decision, made once there.
 *
 * What these pin is the shape at every count a property can actually have.
 * Today almost every property has exactly one photograph, so the one-photo
 * case is the one a client sees: one picture, and no carousel furniture — no
 * arrows that go nowhere, no strip of one thumbnail, no second copy.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BuilderStockGallery } from '@/components/listings/BuilderStockGallery';
import { galleryPictures } from '@/lib/builderStockGallery';
import type { MarketplaceStockPhoto } from '@/lib/marketplaceBuilderStock';
import type { BuilderStockImage } from '@/lib/builderStock';

const photo = (n: number): MarketplaceStockPhoto => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  position: n,
  url: `https://network.example/functions/v1/builder-network-stock-image?id=photo-${n}`,
  content_type: 'image/jpeg',
});
const many = (count: number) => Array.from({ length: count }, (_, n) => photo(n));

const cardImage = {
  id: 'card-image', stock_item_id: 'item', source_stage: 'uploaded_document',
  source_reference: null, source_provider: null, source_page_url: null,
  external_url: 'https://network.example/functions/v1/builder-network-stock-image?id=card-image',
  storage_path: null, content_type: 'image/jpeg', verification_status: 'source_supplied',
  confidence: null, processing_status: 'ready', error_message: null, position: 0,
  source_detail: null, created_at: '2026-09-25T00:00:00Z',
} as BuilderStockImage;

const drawnSources = () => screen.queryAllByRole('img')
  .map((img) => img.getAttribute('src'))
  .filter(Boolean);

describe('which pictures a gallery holds', () => {
  it('holds the network\'s photographs in the order sent', () => {
    const photos = [photo(2), photo(0), photo(1)];
    expect(galleryPictures(photos, cardImage).map((p) => p.id)).toEqual(photos.map((p) => p.id));
  });

  it('falls back to the card\'s own picture only when no photographs have arrived', () => {
    expect(galleryPictures([], cardImage).map((p) => p.id)).toEqual(['card-image']);
    expect(galleryPictures([], null)).toEqual([]);
  });

  it('never holds the card picture twice beside the network\'s copy of it', () => {
    const same = { ...photo(0), id: 'card-image' };
    expect(galleryPictures([same], cardImage)).toHaveLength(1);
  });

  it('holds at most twelve', () => {
    expect(galleryPictures(many(15), null)).toHaveLength(12);
  });
});

describe('the gallery on the page', () => {
  it('0 photos: says so, and draws no controls', () => {
    render(<BuilderStockGallery photos={[]} fallback={null} alt="12 Proof Street" />);
    expect(screen.getByText(/no photograph/i)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('1 photo: one picture, no carousel controls, no thumbnails, no duplicate', () => {
    render(<BuilderStockGallery photos={[photo(0)]} fallback={cardImage} alt="12 Proof Street" />);
    expect(screen.queryByRole('button', { name: /previous|next/i })).toBeNull();
    expect(screen.queryByRole('list', { name: /photographs/i })).toBeNull();
    expect(drawnSources()).toEqual([photo(0).url]);
  });

  it('1 legacy card picture and nothing from the network: the same single picture as the card', () => {
    render(<BuilderStockGallery photos={[]} fallback={cardImage} alt="12 Proof Street" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(drawnSources()).toEqual([cardImage.external_url]);
  });

  it('several photos: a clear selected picture, thumbnails in order, and it moves', () => {
    const photos = many(3);
    render(<BuilderStockGallery photos={photos} fallback={null} alt="12 Proof Street" />);
    const strip = screen.getByRole('list', { name: /photographs/i });
    const thumbs = within(strip).getAllByRole('button');
    expect(thumbs).toHaveLength(3);
    expect(thumbs[0].getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('1 of 3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /next photograph/i }));
    expect(screen.getByText('2 of 3')).toBeTruthy();
    expect(within(strip).getAllByRole('button')[1].getAttribute('aria-current')).toBe('true');

    fireEvent.click(thumbs[2]);
    expect(screen.getByText('3 of 3')).toBeTruthy();
    // Wraps rather than dead-ending.
    fireEvent.click(screen.getByRole('button', { name: /next photograph/i }));
    expect(screen.getByText('1 of 3')).toBeTruthy();
  });

  it('12 photos: every one reachable, in order', () => {
    const photos = many(12);
    render(<BuilderStockGallery photos={photos} fallback={null} alt="12 Proof Street" />);
    const thumbs = within(screen.getByRole('list', { name: /photographs/i })).getAllByRole('button');
    expect(thumbs).toHaveLength(12);
    fireEvent.click(thumbs[11]);
    expect(screen.getByText('12 of 12')).toBeTruthy();
  });
});
