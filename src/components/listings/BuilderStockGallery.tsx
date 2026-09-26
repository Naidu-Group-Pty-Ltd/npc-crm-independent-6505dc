import { useCallback, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { StockPicture } from '@/components/stock/StockPicture';
import type { BuilderStockImage } from '@/lib/builderStock';
import { galleryPictures } from '@/lib/builderStockGallery';
import { marketplaceStockImageUrl, type MarketplaceStockPhoto } from '@/lib/marketplaceBuilderStock';
import { cn } from '@/lib/utils';

/**
 * A BUILDER PROPERTY'S GALLERY — WHAT THE BUILDER PUBLISHED, IN THEIR ORDER.
 *
 * The photographs are the ones the Builders Network sent for this property,
 * converged by the media sweep. Nothing here decides which pictures are a
 * property's photographs: that is the Builder Portal's election, made once
 * there, and a second copy of it here is how two screens come to disagree.
 *
 * WHERE NOTHING HAS ARRIVED YET, THE CARD'S OWN PICTURE. A property synced
 * before the network sent media still has the picture its card draws, and the
 * page must not show less than the card — so the card's image, chosen by the
 * card's own rule, stands in until the network's list arrives.
 *
 * EVERY PICTURE IS DRAWN BY `StockPicture`, the card's fit-and-ground
 * treatment, so the page never draws a photograph differently from the card.
 *
 * The furniture follows the count. One picture is one picture: no arrows that
 * go nowhere, no strip of one thumbnail. Two or more get a counter, previous
 * and next (which wrap), and a thumbnail strip, all keyboard-operable.
 */

export function BuilderStockGallery({
  photos, fallback, alt,
}: {
  photos: MarketplaceStockPhoto[] | null | undefined;
  fallback: BuilderStockImage | null | undefined;
  alt: string;
}) {
  const pictures = galleryPictures(photos, fallback);
  const count = pictures.length;
  const [chosen, setChosen] = useState(0);
  // A gallery that shrinks under the reader keeps a picture selected.
  const selected = chosen < count ? chosen : 0;

  const step = useCallback((delta: number) => {
    setChosen((current) => ((current < count ? current : 0) + delta + count) % count);
  }, [count]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count < 2) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
  };

  const current = pictures[selected] ?? null;

  return (
    <div className="space-y-3">
      <div
        className="relative overflow-hidden rounded-2xl border border-border/60"
        role={count > 1 ? 'group' : undefined}
        aria-roledescription={count > 1 ? 'gallery' : undefined}
        aria-label={count > 1 ? `Photographs of ${alt}` : undefined}
        tabIndex={count > 1 ? 0 : undefined}
        onKeyDown={onKeyDown}
      >
        <StockPicture
          key={current?.id ?? 'none'}
          image={current?.image ?? null}
          resolveUrl={marketplaceStockImageUrl}
          alt={count > 1 ? `${alt} — photograph ${selected + 1} of ${count}` : alt}
          aspectClassName="aspect-[4/3] sm:aspect-[16/9]"
          emptyLabel="No photograph from the builder yet"
        />
        {count > 1 ? (
          <>
            <Button
              type="button" variant="secondary" size="icon"
              className="absolute left-2 top-1/2 z-20 h-10 w-10 -translate-y-1/2 rounded-full shadow-md"
              onClick={() => step(-1)}
              aria-label="Previous photograph"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </Button>
            <Button
              type="button" variant="secondary" size="icon"
              className="absolute right-2 top-1/2 z-20 h-10 w-10 -translate-y-1/2 rounded-full shadow-md"
              onClick={() => step(1)}
              aria-label="Next photograph"
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </Button>
            <span
              className="absolute bottom-2 right-2 z-20 rounded-full border border-border/60 bg-background/85 px-2.5 py-0.5 text-xs font-medium text-foreground"
              aria-live="polite"
            >
              {`${selected + 1} of ${count}`}
            </span>
          </>
        ) : null}
      </div>

      {count > 1 ? (
        <ul
          aria-label="Photographs"
          className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]"
        >
          {pictures.map((picture, index) => (
            <li key={picture.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setChosen(index)}
                aria-current={index === selected ? 'true' : undefined}
                aria-label={`Show photograph ${index + 1} of ${count}`}
                className={cn(
                  'block h-16 w-24 overflow-hidden rounded-lg border-2 bg-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-20 sm:w-28',
                  index === selected ? 'border-primary' : 'border-transparent opacity-80 hover:opacity-100',
                )}
              >
                {picture.url ? (
                  <img
                    src={picture.url}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
