import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useListingGallery } from './useListingGallery';
import type { ImageInspection } from '@/lib/imageKind';
import type { StoredListingImage } from '@/lib/listingImages';

const verdicts = new Map<string, Partial<ImageInspection>>();
vi.mock('@/lib/imageKind', async () => {
  const actual = await vi.importActual<typeof import('@/lib/imageKind')>('@/lib/imageKind');
  return {
    ...actual,
    inspectImageUrl: (url: string) =>
      Promise.resolve({
        kind: 'unknown',
        signature: null,
        width: null,
        height: null,
        ...(verdictsRef.get(url) ?? {}),
      }),
  };
});
const verdictsRef = verdicts;

const image = (url: string, extra: Partial<StoredListingImage> & Record<string, unknown> = {}): StoredListingImage =>
  ({ url, position: 0, origin: 'scraped', ...extra }) as StoredListingImage;

function Probe({ images }: { images: StoredListingImage[] }) {
  const { images: ordered, kindOf } = useListingGallery(images);
  return (
    <ol>
      {ordered.map((entry) => (
        <li key={entry.url}>
          {entry.url}:{kindOf(entry.url)}
        </li>
      ))}
    </ol>
  );
}

const order = () => screen.getAllByRole('listitem').map((li) => li.textContent);

describe('useListingGallery — ordering', () => {
  beforeEach(() => verdicts.clear());
  afterEach(cleanup);

  it('demotes URL-labelled floor plans immediately, before any pixels load', async () => {
    await act(async () => {
      render(<Probe images={[image('https://x.com/floorplan.jpg'), image('https://x.com/a.jpg')]} />);
    });
    expect(order()).toEqual([
      'https://x.com/a.jpg:unknown',
      'https://x.com/floorplan.jpg:floorplan',
    ]);
  });

  it('reorders when the visual classifier recognises an anonymous plan', async () => {
    // Hashed CDN paths carry no hint; the verdict arrives from the pixels a
    // moment later and the plan quietly steps to the back.
    verdicts.set('https://cdn.example/1a2b3c', { kind: 'floorplan' });
    verdicts.set('https://cdn.example/9f8e7d', { kind: 'photo' });
    await act(async () => {
      render(<Probe images={[image('https://cdn.example/1a2b3c'), image('https://cdn.example/9f8e7d')]} />);
    });
    expect(order()).toEqual([
      'https://cdn.example/9f8e7d:photo',
      'https://cdn.example/1a2b3c:floorplan',
    ]);
  });

  it('keeps the original order when nothing is recognisably a plan', async () => {
    await act(async () => {
      render(<Probe images={[image('https://x.com/b.jpg'), image('https://x.com/a.jpg')]} />);
    });
    expect(order()).toEqual(['https://x.com/b.jpg:unknown', 'https://x.com/a.jpg:unknown']);
  });
});

describe('useListingGallery — de-duplication', () => {
  beforeEach(() => verdicts.clear());
  afterEach(cleanup);

  it('shows one slide for two renditions of one photograph', async () => {
    const base = 'https://images.listonce.com.au/custom';
    const tail = 'listings/26-moscript-street-campbells-creek-vic-3451/728/01909728_img_01.jpg';
    await act(async () => {
      render(
        <Probe
          images={[
            image(`${base}/m/${tail}`, { position: 0, bytes: 139_844 }),
            image(`${base}/l/${tail}`, { position: 1, bytes: 819_767 }),
            image('https://images.listonce.com.au/custom/l/x/728/01909728_img_02.jpg', {
              position: 2,
              bytes: 167_406,
            }),
          ]}
        />,
      );
    });
    // The large rendition survives — it is inside the card band and sharper —
    // and it takes the place the medium one held.
    expect(order()).toEqual([
      `${base}/l/${tail}:unknown`,
      'https://images.listonce.com.au/custom/l/x/728/01909728_img_02.jpg:unknown',
    ]);
  });

  it('collapses a re-encode that shares neither bytes nor URL shape', async () => {
    // Nothing in either URL relates them and the checksums differ; only the
    // pixels can say. Signatures four bits apart are the same picture.
    verdicts.set('https://a.test/one.jpg', { signature: 'f0e1d2c3b4a59687' });
    verdicts.set('https://b.test/two.jpg', { signature: 'f0e1d2c3b4a59683' });
    await act(async () => {
      render(
        <Probe
          images={[
            image('https://a.test/one.jpg', { position: 0, checksum: 'aaa', bytes: 200_000 }),
            image('https://b.test/two.jpg', { position: 1, checksum: 'bbb', bytes: 180_000 }),
          ]}
        />,
      );
    });
    expect(order()).toEqual(['https://a.test/one.jpg:unknown']);
  });

  it('keeps two genuinely different photographs apart', async () => {
    verdicts.set('https://a.test/one.jpg', { signature: 'ffffffffffffffff' });
    verdicts.set('https://b.test/two.jpg', { signature: '0000000000000000' });
    await act(async () => {
      render(
        <Probe
          images={[
            image('https://a.test/one.jpg', { position: 0, checksum: 'aaa' }),
            image('https://b.test/two.jpg', { position: 1, checksum: 'bbb' }),
          ]}
        />,
      );
    });
    expect(order()).toHaveLength(2);
  });

  it('demotes a measured headshot behind the photographs', async () => {
    // 150×150 `fit: cover` — the shape every agent portrait in this corpus has.
    verdicts.set('https://cdn.test/face', { width: 150, height: 150 });
    verdicts.set('https://cdn.test/room', { width: 1200, height: 800 });
    await act(async () => {
      render(
        <Probe
          images={[
            image('https://cdn.test/face', { position: 0, checksum: 'a' }),
            image('https://cdn.test/room', { position: 1, checksum: 'b' }),
          ]}
        />,
      );
    });
    expect(order()[0]).toBe('https://cdn.test/room:unknown');
  });

  it('never empties a gallery, even when every image looks like furniture', async () => {
    await act(async () => {
      render(
        <Probe images={[image('https://cdn.test/logo.png', { position: 0, checksum: 'a' })]} />,
      );
    });
    expect(order()).toEqual(['https://cdn.test/logo.png:unknown']);
  });
});
