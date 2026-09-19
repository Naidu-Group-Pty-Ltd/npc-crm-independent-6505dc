import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useAutoFindPhotos } from './useAutoFindPhotos';
import { clearAutoSearchMemory, recordAutoSearch, shouldAutoSearch } from '@/lib/autoPhotoMemory';
import type { PropertyListing } from '@/lib/airtable';
import type { StoredListingImage } from '@/lib/listingImages';

const invokeSecureFunction = vi.fn();
vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: (...args: unknown[]) => invokeSecureFunction(...args),
}));

const listing = (id: string, url: string | null = `https://agency.example/l/${id}`) =>
  ({ id, url }) as PropertyListing;

const stored = (id: string): StoredListingImage[] => [
  { listingId: id, url: 'https://cdn/x.jpg', position: 0, origin: 'scraped', width: null, height: null, expiresAt: Date.now() + 60_000 },
];

/**
 * The hook is exercised through a probe component so effects, refs and the
 * true→false resolution gate behave exactly as they will in the grid.
 */
function Probe({
  listings,
  images,
  isResolving,
  onFound,
}: {
  listings: PropertyListing[];
  images: Record<string, StoredListingImage[]>;
  isResolving: boolean;
  onFound: (id: string) => void;
}) {
  const { searchingId } = useAutoFindPhotos(listings, images, isResolving, onFound);
  return <div data-testid="searching">{searchingId ?? ''}</div>;
}

describe('useAutoFindPhotos', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAutoSearchMemory();
    invokeSecureFunction.mockReset();
    invokeSecureFunction.mockResolvedValue({ data: { success: true, images: 0 }, error: null });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const settle = async () => {
    // Drain the microtask queue without advancing the inter-search gap timer.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it('does nothing before the first resolution pass has concluded', async () => {
    // `isResolving` starts false before the pass begins — that must read as
    // "not answered yet", not "answered with nothing", or the cascade would
    // scrape pages for listings whose photos are one request away.
    render(
      <Probe listings={[listing('a')]} images={{}} isResolving={false} onFound={() => {}} />,
    );
    await settle();
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });

  it('searches a photo-less listing once resolution has actually concluded', async () => {
    const { rerender } = render(
      <Probe listings={[listing('a')]} images={{}} isResolving={false} onFound={() => {}} />,
    );
    rerender(<Probe listings={[listing('a')]} images={{}} isResolving onFound={() => {}} />);
    rerender(
      <Probe listings={[listing('a')]} images={{}} isResolving={false} onFound={() => {}} />,
    );
    await settle();
    expect(invokeSecureFunction).toHaveBeenCalledWith('listing-enrichment', {
      op: 'enrich',
      listingId: 'a',
    });
  });

  const resolveThenRender = async (
    listings: PropertyListing[],
    images: Record<string, StoredListingImage[]> = {},
    onFound: (id: string) => void = () => {},
  ) => {
    const { rerender } = render(
      <Probe listings={listings} images={images} isResolving={false} onFound={onFound} />,
    );
    rerender(<Probe listings={listings} images={images} isResolving onFound={onFound} />);
    rerender(<Probe listings={listings} images={images} isResolving={false} onFound={onFound} />);
    await settle();
    return rerender;
  };

  it('skips listings that already have photographs', async () => {
    await resolveThenRender([listing('a'), listing('b')], { a: stored('a') });
    expect(invokeSecureFunction).toHaveBeenCalledTimes(1);
    expect(invokeSecureFunction).toHaveBeenCalledWith('listing-enrichment', {
      op: 'enrich',
      listingId: 'b',
    });
  });

  it('skips listings with no followable source link — there is nothing to search', async () => {
    await resolveThenRender([listing('a', null), listing('b', 'see attached flyer')]);
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });

  it('skips a listing whose fruitless search is still fresh in memory', async () => {
    recordAutoSearch('a', 0, Date.now());
    await resolveThenRender([listing('a')]);
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });

  it('reports found photographs and remembers the attempt', async () => {
    invokeSecureFunction.mockResolvedValue({ data: { success: true, images: 4 }, error: null });
    const onFound = vi.fn();
    await resolveThenRender([listing('a')], {}, onFound);
    expect(onFound).toHaveBeenCalledWith('a');
    expect(shouldAutoSearch('a')).toBe(false);
  });

  it('spaces searches out instead of firing them together', async () => {
    await resolveThenRender([listing('a'), listing('b')]);
    // Only the first has gone; the second waits for the gap timer.
    expect(invokeSecureFunction).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(invokeSecureFunction).toHaveBeenCalledTimes(2);
    expect(invokeSecureFunction).toHaveBeenLastCalledWith('listing-enrichment', {
      op: 'enrich',
      listingId: 'b',
    });
  });

  it('stops the queue when the service refuses, and forgets nothing', async () => {
    // A rate limit or kill switch is about the service, not the listing. The
    // queue must not hammer on, and the listing deserves a fresh try later.
    invokeSecureFunction.mockResolvedValue({ data: { success: false, error: 'rate_limited' }, error: null });
    await resolveThenRender([listing('a'), listing('b')]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(invokeSecureFunction).toHaveBeenCalledTimes(1);
    expect(shouldAutoSearch('a')).toBe(true);
  });
});
