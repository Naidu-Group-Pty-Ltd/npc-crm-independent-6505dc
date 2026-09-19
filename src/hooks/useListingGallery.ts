import { useEffect, useMemo, useRef, useState } from 'react';
import type { StoredListingImage } from '@/lib/listingImages';
import { looksLikeFloorplanUrl } from '../../supabase/functions/_shared/listingImageOrder.pure';
import { selectListingGallery } from '../../supabase/functions/_shared/listingImageSelection.pure';
import { inspectImageUrl, type ImageInspection, type ImageKind } from '@/lib/imageKind';

/**
 * A listing's photographs as the reader should see them: each picture once,
 * photographs before floor plans, page furniture last.
 *
 * **The deciding happens on the server.** `listing-images` de-duplicates before
 * it signs, looks at every photograph's pixels once, and knows how many other
 * listings hold the same picture — so what arrives here is one row per
 * photograph, each carrying a verdict, and the card is right on its first
 * paint. That placement is the whole point: this used to be a browser-only job
 * that ran *after* the card had drawn, which meant the most consequential
 * decision the marketplace makes was taken with no visual information at all.
 * A random sample of sixteen listings had six floor plans as their hero.
 *
 * What is left for the browser is filling gaps the server has not reached:
 *
 * - a photograph harvested before the analyser got to it, or a deployment where
 *   the analysis migration has not been applied;
 * - **the natural dimensions**, which tell a 150×150 agent headshot from a room;
 * - **a perceptual signature** for anything the server has not signed, the last
 *   de-duplication layer — the only one that catches one photograph re-encoded
 *   into two files sharing neither bytes nor URL shape.
 *
 * Those arrive after the frame has drawn, so the rule still holds: the order may
 * only *improve*. Nothing here reorders two plausible photographs relative to
 * each other, so a carousel the reader is already paging through never shuffles
 * under their thumb — it can only move a plan, a duplicate or a headshot they
 * had not reached yet further back.
 *
 * `kindOf` is exposed so the frame can label a plan slide as what it is: a
 * reader flicking through should never wonder whether the beige rectangle is a
 * badly lit bedroom.
 */
export function useListingGallery(images: StoredListingImage[] | undefined): {
  images: StoredListingImage[];
  kindOf: (url: string) => ImageKind;
} {
  const [inspections, setInspections] = useState<Record<string, ImageInspection>>({});
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const signature = useMemo(() => (images ?? []).map((i) => i.url).join('|'), [images]);

  useEffect(() => {
    const list = images ?? [];
    if (list.length === 0) return;
    let cancelled = false;
    // Only what the server has not already answered, and bounded per listing:
    // twelve decodes is what a card can justify on a page of 148 of them.
    // Anything past the bound keeps the place the server gave it.
    const unanswered = list.filter((image) => !image.kind).slice(0, 12);
    for (const image of unanswered) {
      void inspectImageUrl(image.url).then((inspection) => {
        if (cancelled || unmountedRef.current) return;
        // A decode that learned nothing — tainted canvas, network failure —
        // must not be recorded: it would re-render the gallery to say the same
        // thing. Dimensions alone count as learning something; they are the
        // only evidence that separates an agent's headshot from a room.
        const learned =
          inspection.kind !== 'unknown' || Boolean(inspection.signature) || Boolean(inspection.width);
        if (!learned) return;
        setInspections((prior) =>
          prior[image.url] === inspection ? prior : { ...prior, [image.url]: inspection },
        );
      });
    }
    return () => {
      cancelled = true;
    };
    // `signature` is the dependency, not `images`: the parent rebuilds that
    // array on most renders and a pass restarted on each one never finishes.
  }, [signature]);

  // The server's verdict wins where it exists: it saw the same pixels with the
  // same rules and it saw them before the page loaded.
  const serverKinds = useMemo(() => {
    const map = new Map<string, ImageKind>();
    for (const image of images ?? []) if (image.kind) map.set(image.url, image.kind);
    return map;
  }, [images]);

  const kindOf = useMemo(() => {
    return (url: string): ImageKind => {
      const stored = serverKinds.get(url);
      if (stored) return stored;
      if (looksLikeFloorplanUrl(url)) return 'floorplan';
      return inspections[url]?.kind ?? 'unknown';
    };
  }, [inspections, serverKinds]);

  const ordered = useMemo(() => {
    const list = images ?? [];
    if (list.length === 0) return list;
    const measured = list.map((image) => {
      const inspection = inspections[image.url];
      const kind = kindOf(image.url);
      return {
        ...image,
        // Resolved, and kept on the way out. `ListingDetail` orders once and
        // hands the result to both the hero and the lightbox, and the hero runs
        // this hook again — carrying the verdict through means the second pass
        // decodes nothing.
        kind: kind === 'unknown' ? null : kind,
        signature: inspection?.signature ?? null,
        // The stored row wins where it has an answer; the decode fills the gap.
        width: image.width ?? inspection?.width ?? null,
        height: image.height ?? inspection?.height ?? null,
      };
    });
    return selectListingGallery(measured).images.map(({ signature: _signature, ...image }) => image);
  }, [images, inspections, kindOf]);

  return { images: ordered, kindOf };
}

export default useListingGallery;
