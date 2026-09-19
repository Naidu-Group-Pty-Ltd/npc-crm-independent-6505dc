import { describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach } from 'vitest';
import { ListingHero } from './ListingHero';
import type { StoredListingImage } from '@/lib/listingImages';

// Street View fetches a static panorama through an edge function. The hero's
// job is where the panel goes and what happens on each verdict; whether Google
// answers is the panel's problem, so it is stubbed — but the stub reports a
// controllable status, because the hero's automatic mode branches on it.
let mockPanelStatus = 'available';
vi.mock('@/components/listings/StreetViewPanel', async () => {
  const { useEffect } = await import('react');
  return {
    StreetViewPanel: ({
      label,
      onStatus,
    }: {
      label?: string;
      onStatus?: (status: string) => void;
    }) => {
      useEffect(() => {
        onStatus?.(mockPanelStatus);
      }, [onStatus]);
      return <div data-testid="street-view">{label ?? 'street view'}</div>;
    },
  };
});

// The visual half of floor-plan detection needs a canvas; the hero's part is
// only the ordering and the label, so it is answered from a stub.
vi.mock('@/lib/imageKind', async () => {
  const actual = await vi.importActual<typeof import('@/lib/imageKind')>('@/lib/imageKind');
  return { ...actual, classifyImageUrl: () => Promise.resolve('unknown') };
});

afterEach(() => {
  cleanup();
  mockPanelStatus = 'available';
});

const photo = (n: number): StoredListingImage =>
  ({ url: `https://cdn.example.com/p${n}.jpg`, position: n, origin: 'scraped' }) as StoredListingImage;

const POINT = { lat: -31.94, lng: 115.76 };

const LISTING = {
  address: '13 Larundel Road',
  suburb: 'City Beach',
  state: 'WA',
  propertyType: 'House',
  price: 850_000,
} as any;

describe('ListingHero', () => {
  it('says so when there is no photo, rather than showing an empty frame', () => {
    // On a grid, a blank tile reads as "still loading" indefinitely. Most of
    // this corpus has no photograph yet, so this is the common case.
    render(<ListingHero images={[]} />);
    expect(screen.getByText('No photo on record')).toBeTruthy();
  });

  it('draws the cover during the resolution pass instead of a blank frame', () => {
    // The pass over a thousand listings runs for minutes. Blanking every
    // unresolved card for that long made whole screenfuls read as broken —
    // the exact page a screenshot caught in production.
    render(<ListingHero images={[]} isResolving listing={LISTING} />);
    expect(screen.getByText('City Beach WA')).toBeTruthy();
    expect(screen.getByText('Checking for photos…')).toBeTruthy();
    // And no premature claims or actions while the answer is unknown:
    expect(screen.queryByText('No photo on record')).toBeNull();
    expect(screen.queryByRole('button', { name: /find photos/i })).toBeNull();
  });

  it('still shows a plain skeleton while resolving when it cannot draw a cover', () => {
    const { container } = render(<ListingHero images={[]} isResolving />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByText('Checking for photos…')).toBeNull();
  });

  it('keeps the cover on screen while a source search runs, and says what is happening', () => {
    // The search is automatic now — nobody pressed anything — so the card must
    // narrate itself: photographs appearing seconds later need an explanation,
    // and a spinner over a blank frame is the white-rectangle bug again.
    render(<ListingHero images={[]} isFindingPhotos listing={LISTING} />);
    expect(screen.getByText('City Beach WA')).toBeTruthy();
    expect(screen.getByText('Searching the source listing…')).toBeTruthy();
    expect(screen.queryByText('No photo on record')).toBeNull();
  });

  it('offers no manual imagery controls anywhere in the empty state', () => {
    // The cascade decides: record photos, else the source page, else Street
    // View. A person browsing properties is not operating an imagery pipeline.
    render(<ListingHero images={[]} point={POINT} streetViewMode="auto" listing={LISTING} />);
    expect(screen.queryByRole('button', { name: /find photos/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /street view/i })).toBeNull();
  });

  it('loads the street frontage automatically once the cascade has nothing else', () => {
    // The failsafe stage: no stored photos, no search in flight — the frame
    // shows the street without being asked, and the caption bar stands down.
    render(<ListingHero images={[]} point={POINT} streetViewMode="auto" listing={LISTING} />);
    expect(screen.getByTestId('street-view')).toBeTruthy();
    expect(screen.queryByText('No photo on record')).toBeNull();
  });

  it('puts the cover back when the panorama fails, rather than apologising in the frame', () => {
    mockPanelStatus = 'no_coverage';
    render(<ListingHero images={[]} point={POINT} streetViewMode="auto" listing={LISTING} />);
    // The panel is abandoned for good and the drawn cover stands, with the
    // honest caption — not an error message where imagery was promised.
    expect(screen.queryByTestId('street-view')).toBeNull();
    expect(screen.getByText('City Beach WA')).toBeTruthy();
    expect(screen.getByText('No photo on record')).toBeTruthy();
  });

  it('does not spend street view calls while earlier cascade stages are still running', () => {
    // Photographs may be seconds away — from the resolution pass or from the
    // source search. Loading a panorama that a photo immediately replaces
    // wastes a metered call on imagery nobody sees.
    const { rerender } = render(
      <ListingHero images={[]} point={POINT} streetViewMode="auto" listing={LISTING} isResolving />,
    );
    expect(screen.queryByTestId('street-view')).toBeNull();

    rerender(
      <ListingHero images={[]} point={POINT} streetViewMode="auto" listing={LISTING} isFindingPhotos />,
    );
    expect(screen.queryByTestId('street-view')).toBeNull();
  });

  it('keeps Street View as an always-present slide where one listing is on screen', () => {
    // The property page and the map popup render a single listing, so there is
    // no fan-out to protect against and the panorama should just be there.
    render(<ListingHero images={[]} point={POINT} listing={LISTING} label="12 Example St" />);
    expect(screen.getByTestId('street-view')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Street View' })).toBeNull();
  });

  it('does not carry one listing\u2019s panorama verdict onto the next', () => {
    // Cards are recycled as the reader filters and scrolls. A previous
    // property's "no coverage" must not condemn the next one to a cover when
    // its own street is photographed.
    mockPanelStatus = 'no_coverage';
    const { rerender } = render(
      <ListingHero images={[]} point={POINT} streetViewMode="auto" listing={LISTING} />,
    );
    expect(screen.queryByTestId('street-view')).toBeNull();

    mockPanelStatus = 'available';
    rerender(
      <ListingHero
        images={[]}
        point={POINT}
        streetViewMode="auto"
        listing={{ ...LISTING, address: '9 Birch Road', suburb: 'Aubin Grove' }}
      />,
    );
    expect(screen.getByTestId('street-view')).toBeTruthy();
  });

  it('opens on a photograph and pushes the floor plan to the back, labelled', async () => {
    // Agencies upload the plan first, so harvested order led with it — a hero
    // slot opening on a line drawing. The photograph must lead; the plan is
    // reference material at the end of the carousel, named for what it is.
    const plan = {
      url: 'https://cdn.example.com/floorplan-main.jpg',
      position: 0,
      origin: 'scraped',
    } as StoredListingImage;
    render(<ListingHero images={[plan, photo(1), photo(2)]} label="12 Example St" />);

    // Slide 1 is a photograph, not the plan.
    expect(screen.getByText('1/3')).toBeTruthy();
    const first = screen.getByAltText('12 Example St — photo 1') as HTMLImageElement;
    expect(first.src).toContain('p1.jpg');

    // The plan sits last, and the counter names it.
    fireEvent.click(screen.getByRole('button', { name: 'Previous photo' }));
    expect(screen.getByText('3/3 · Floor plan')).toBeTruthy();
  });

  it('draws a cover instead of a blank frame when the record can describe itself', () => {
    render(<ListingHero images={[]} listing={LISTING} />);
    // Still honest about the photograph...
    expect(screen.getByText('No photo on record')).toBeTruthy();
    // ...but the frame carries the locality rather than being dead grey space.
    expect(screen.getByText('City Beach WA')).toBeTruthy();
  });

  it('shows a counter and advances through the photos', async () => {
    render(<ListingHero images={[photo(1), photo(2), photo(3)]} label="12 Example St" />);

    expect(screen.getByText('1/3')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Next photo'));
    expect(screen.getByText('2/3')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Previous photo'));
    expect(screen.getByText('1/3')).toBeTruthy();
  });

  it('wraps at both ends', async () => {
    render(<ListingHero images={[photo(1), photo(2)]} />);
    fireEvent.click(screen.getByLabelText('Previous photo'));
    expect(screen.getByText('2/2')).toBeTruthy();
  });

  it('offers no controls for a single photo', () => {
    render(<ListingHero images={[photo(1)]} />);
    expect(screen.queryByLabelText('Next photo')).toBeNull();
  });

  /**
   * The behaviour the map popup needed. It previously showed EITHER one
   * photograph OR Street View in one frame, behind a toggle that only appeared
   * when a photograph existed — so with no photos it silently showed Street View
   * and gave no hint a photograph was ever expected.
   */
  it('adds Street View as the last slide without displacing the photos', async () => {
    render(<ListingHero images={[photo(1), photo(2)]} point={POINT} label="12 Example St" />);

    // A photograph leads.
    expect(screen.getByText('1/2')).toBeTruthy();
    expect(screen.queryByTestId('street-view')).toBeNull();

    fireEvent.click(screen.getByLabelText('Next photo'));
    fireEvent.click(screen.getByLabelText('Next photo'));
    expect(screen.getByTestId('street-view')).toBeTruthy();
    expect(screen.getByText('Street View')).toBeTruthy();
  });

  it('jumps straight to Street View from the shortcut', async () => {
    render(<ListingHero images={[photo(1), photo(2)]} point={POINT} />);
    fireEvent.click(screen.getByRole('button', { name: /street/i }));
    expect(screen.getByTestId('street-view')).toBeTruthy();
  });

  it('falls back to Street View alone when there are no photos', () => {
    // Which is the honest answer for a listing we have not harvested yet: the
    // location is known, the property is not.
    render(<ListingHero images={[]} point={POINT} />);
    expect(screen.getByTestId('street-view')).toBeTruthy();
    expect(screen.queryByText('No photo on record')).toBeNull();
  });

  it('drops a photo whose signed url has expired instead of leaving a broken frame', async () => {
    render(<ListingHero images={[photo(1), photo(2)]} />);
    expect(screen.getByRole('img').getAttribute('src')).toContain('p1.jpg');

    fireEvent.error(screen.getByRole('img'));

    // The dead one leaves the set and the next photo takes its place, rather
    // than the reader being left looking at a broken frame.
    expect(screen.getByRole('img').getAttribute('src')).toContain('p2.jpg');
    // One photo left, so the counter and arrows go away.
    expect(screen.queryByLabelText('Next photo')).toBeNull();
  });

  it('restarts at the first slide when it is handed a different listing', async () => {
    // The map popup reuses one component across markers. Without this, slide 5
    // of the previous listing becomes slide 5 of a two-photo one.
    const { rerender } = render(<ListingHero images={[photo(1), photo(2), photo(3)]} />);
    fireEvent.click(screen.getByLabelText('Next photo'));
    expect(screen.getByText('2/3')).toBeTruthy();

    rerender(<ListingHero images={[photo(7), photo(8)]} />);
    expect(screen.getByText('1/2')).toBeTruthy();
  });

  it('is keyboard operable', async () => {
    render(<ListingHero images={[photo(1), photo(2), photo(3)]} />);
    const carousel = screen.getByRole('group');
    carousel.focus();
    fireEvent.keyDown(carousel, { key: 'ArrowRight' });
    expect(screen.getByText('2/3')).toBeTruthy();
    fireEvent.keyDown(carousel, { key: 'ArrowLeft' });
    expect(screen.getByText('1/3')).toBeTruthy();
  });

  it('reports which slide was open when it is expanded', async () => {
    const onExpand = vi.fn();
    render(<ListingHero images={[photo(1), photo(2)]} onExpand={onExpand} label="12 Example St" />);
    fireEvent.click(screen.getByLabelText('Next photo'));
    fireEvent.click(screen.getByLabelText('Enlarge 12 Example St'));
    expect(onExpand).toHaveBeenCalledWith(1);
  });
});
