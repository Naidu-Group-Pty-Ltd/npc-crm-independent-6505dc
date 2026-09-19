import { act, render, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PropertyListing } from '@/lib/airtable';

const invokeSecureFunction = vi.hoisted(() => vi.fn());
vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction }));

// Imported after the mock is registered.
const { useListingCoordinates } = await import('@/hooks/useListingCoordinates');

// Resolved coordinates are cached for the lifetime of the module so that
// flipping between table and map view does not re-request them. Each test
// therefore uses its own listing ids rather than sharing them.
let idSeed = 0;
const uniqueId = (name: string) => `${name}-${(idSeed += 1)}`;

function listing(id: string, overrides: Partial<PropertyListing> = {}): PropertyListing {
  return {
    id,
    title: id,
    price: null,
    location: '',
    bedrooms: null,
    bathrooms: null,
    propertyType: 'House',
    listingDate: '',
    status: 'active',
    confidence: null,
    source: 'test',
    description: '',
    images: [],
    agent: '',
    features: [],
    address: `${id} Example Street`,
    suburb: 'Newtown',
    state: 'NSW',
    zipCode: '2042',
    ...overrides,
  } as PropertyListing;
}

interface HookState {
  points: Record<string, { lat: number; lng: number; source: string }>;
  isResolving: boolean;
}

/** Renders the hook and lets the test swap the listings array identity. */
function Harness({
  listings,
  onState,
  bumpAfterMount = false,
}: {
  listings: PropertyListing[];
  onState: (state: HookState) => void;
  bumpAfterMount?: boolean;
}) {
  const [rows, setRows] = useState(listings);
  const state = useListingCoordinates(rows);

  // Mirrors Listings.tsx: a react-query refetch / filter change hands the map a
  // brand new array with the same contents.
  useEffect(() => {
    if (bumpAfterMount) setRows((r) => [...r]);
  }, [bumpAfterMount]);

  onState(state as HookState);
  return null;
}

function okResponse(ids: string[], extra: Record<string, unknown> = {}) {
  return {
    data: {
      success: true,
      results: ids.map((id, i) => ({
        id,
        lat: -33.8 - i * 0.01,
        lng: 151.2 + i * 0.01,
        source: 'cache',
      })),
      ...extra,
    },
    error: null,
  };
}

/** Lets any queued promise callbacks and re-renders settle. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('useListingCoordinates', () => {
  beforeEach(() => {
    invokeSecureFunction.mockReset();
  });

  it('uses coordinates already on the record without calling the server', async () => {
    const id = uniqueId('record');
    let latest: HookState['points'] = {};
    render(
      <Harness
        listings={[listing(id, { latitude: -33.87, longitude: 151.2 })]}
        onState={(s) => {
          latest = s.points;
        }}
      />,
    );

    await waitFor(() => expect(latest[id]).toEqual({ lat: -33.87, lng: 151.2, source: 'record' }));
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });

  it('still plots when the listings array changes identity mid-request', async () => {
    // The regression: a refetch used to cancel the in-flight batch, drop the
    // results it had already fetched, and never ask again — "0 of N plotted"
    // for the rest of the session.
    const a = uniqueId('race');
    const b = uniqueId('race');
    let release: ((value: unknown) => void) | null = null;
    invokeSecureFunction.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    let latest: HookState['points'] = {};
    render(
      <Harness
        listings={[listing(a), listing(b)]}
        bumpAfterMount
        onState={(s) => {
          latest = s.points;
        }}
      />,
    );

    await waitFor(() => expect(invokeSecureFunction).toHaveBeenCalled());
    await act(async () => {
      release?.(okResponse([a, b]));
      await Promise.resolve();
    });

    await waitFor(() => expect(Object.keys(latest).sort()).toEqual([a, b].sort()));
  });

  it('keeps asking for the listings the server had to defer', async () => {
    // The edge function geocodes a bounded number of fresh addresses per call
    // and reports the remainder via pendingLookups; those were never looked at,
    // so they must not count as a failed attempt.
    const a = uniqueId('defer');
    const b = uniqueId('defer');
    invokeSecureFunction
      .mockResolvedValueOnce(okResponse([a], { pendingLookups: 1 }))
      .mockResolvedValueOnce(okResponse([b], { pendingLookups: 0 }));

    let latest: HookState['points'] = {};
    render(
      <Harness
        listings={[listing(a), listing(b)]}
        onState={(s) => {
          latest = s.points;
        }}
      />,
    );

    await waitFor(() => expect(Object.keys(latest).sort()).toEqual([a, b].sort()));
    expect(invokeSecureFunction).toHaveBeenCalledTimes(2);
  });

  it('gives up on a listing the server fully processed but could not place', async () => {
    const id = uniqueId('nowhere');
    invokeSecureFunction.mockResolvedValue(okResponse([], { pendingLookups: 0 }));

    let resolving = false;
    render(
      <Harness
        listings={[listing(id)]}
        onState={(s) => {
          resolving = s.isResolving;
        }}
      />,
    );

    // Two attempts, then the listing is left unmapped instead of looping.
    await waitFor(() => expect(invokeSecureFunction).toHaveBeenCalledTimes(2));
    await settle();
    expect(invokeSecureFunction).toHaveBeenCalledTimes(2);
    expect(resolving).toBe(false);
  });

  it('backs off instead of hammering a rate-limited endpoint', async () => {
    vi.useFakeTimers();
    const a = uniqueId('limited');
    const b = uniqueId('limited');
    invokeSecureFunction
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'rate_limited', status: 429 },
      })
      .mockResolvedValueOnce(okResponse([a, b], { pendingLookups: 0 }));

    render(<Harness listings={[listing(a), listing(b)]} onState={() => undefined} />);

    await act(async () => { await Promise.resolve(); });
    expect(invokeSecureFunction).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(invokeSecureFunction).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('never asks about listings with too little address to place', async () => {
    const id = uniqueId('blank');
    render(
      <Harness
        listings={[listing(id, { address: '', suburb: '', state: '', zipCode: '' })]}
        onState={() => undefined}
      />,
    );

    await settle();
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });

  it('reuses resolved coordinates after a remount instead of re-requesting', async () => {
    const id = uniqueId('sticky');
    invokeSecureFunction.mockResolvedValue(okResponse([id], { pendingLookups: 0 }));

    let latest: HookState['points'] = {};
    const first = render(
      <Harness
        listings={[listing(id)]}
        onState={(s) => {
          latest = s.points;
        }}
      />,
    );
    await waitFor(() => expect(latest[id]).toBeDefined());
    expect(invokeSecureFunction).toHaveBeenCalledTimes(1);
    first.unmount();

    // Switching back to the map view must not re-resolve what we already know.
    latest = {};
    render(
      <Harness
        listings={[listing(id)]}
        onState={(s) => {
          latest = s.points;
        }}
      />,
    );
    await settle();
    expect(latest[id]).toBeDefined();
    expect(invokeSecureFunction).toHaveBeenCalledTimes(1);
  });
});
