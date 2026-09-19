import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StoredListingImage } from '@/lib/listingImages';

export interface ListingLightboxProps {
  images: StoredListingImage[];
  /** Index to open at, or `null` when closed. */
  openAt: number | null;
  onClose: () => void;
  label?: string;
}

/**
 * A listing's photographs at full size.
 *
 * The hero carousel is sized to a card; it is for deciding whether to look
 * closer. This is the looking closer — the photograph on black, at whatever
 * resolution the agency published, with the rest of the interface out of the
 * way.
 *
 * Built directly rather than on the shared `Dialog`. That component is sized and
 * padded for forms and caps its own width, which is the opposite of what a
 * photograph wants, and its close affordance would land on top of the image. The
 * two things a dialog is genuinely needed for — focus containment and dismissal
 * — are cheaper to do here than to override.
 */
export function ListingLightbox({ images, openAt, onClose, label }: ListingLightboxProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (openAt !== null) setIndex(Math.min(Math.max(openAt, 0), Math.max(images.length - 1, 0)));
  }, [openAt, images.length]);

  const go = useCallback(
    (delta: number) => {
      setIndex((current) => {
        if (images.length === 0) return 0;
        return (current + delta + images.length) % images.length;
      });
    },
    [images.length],
  );

  const isOpen = openAt !== null && images.length > 0;

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft') go(-1);
      else if (event.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    // The page behind must not scroll while a full-screen overlay is up —
    // otherwise dismissing it returns the reader somewhere they did not choose.
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = priorOverflow;
    };
  }, [isOpen, onClose, go]);

  if (!isOpen) return null;

  const current = images[index];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label ? `${label} — photographs` : 'Listing photographs'}
      className="fixed inset-0 z-[100] flex flex-col bg-foreground/95 backdrop-blur-sm"
      // Clicking the backdrop dismisses; clicking the photograph must not.
      onClick={onClose}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 text-background">
        <span className="min-w-0 truncate text-sm font-medium">{label}</span>
        <span className="flex items-center gap-3">
          {images.length > 1 && (
            <span className="text-xs font-semibold tabular-nums opacity-80">
              {index + 1} / {images.length}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 transition-colors hover:bg-background/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background/60"
            autoFocus
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </span>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6">
        <img
          src={current.url}
          alt={label ? `${label} — photo ${index + 1}` : `Listing photo ${index + 1}`}
          className="max-h-full max-w-full object-contain"
          onClick={(event) => event.stopPropagation()}
        />

        {images.length > 1 && (
          <>
            <LightboxArrow side="left" onClick={() => go(-1)} />
            <LightboxArrow side="right" onClick={() => go(1)} />
          </>
        )}
      </div>
    </div>
  );
}

function LightboxArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={side === 'left' ? 'Previous photo' : 'Next photo'}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        'absolute top-1/2 -translate-y-1/2 rounded-full bg-background/15 p-2 text-background transition-colors',
        'hover:bg-background/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background/60',
        side === 'left' ? 'left-2 sm:left-6' : 'right-2 sm:right-6',
      )}
    >
      <Icon className="h-6 w-6" aria-hidden="true" />
    </button>
  );
}

export default ListingLightbox;
