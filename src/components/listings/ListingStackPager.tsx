/**
 * The control that reaches a property standing underneath another one.
 *
 * The marketplace map draws one mark per COORDINATE, and the corpus stacks
 * properties on identical points: twenty-six listings share `104 Grubb Avenue,
 * Traralgon`, sixteen builder releases share the Armstrong Creek suburb
 * centroid. Only the top pin of such a stack is clickable — the rest are
 * exactly underneath it, at the same pixel, and no amount of zooming separates
 * them, because they are not merely close, they are the same point.
 *
 * `leaflet.markercluster` used to solve this by spiderfying identical points
 * apart on click. Proximity clustering was removed because its bubble is drawn
 * at one member's coordinate while standing for properties hundreds of
 * kilometres apart — a mark whose position means nothing, and one that was read
 * as a misplaced pin every time it was looked at. Removing it took the spiderfy
 * with it, so this is what replaces it: the count on the pin is a promise that
 * N properties are there, and this is how a reader gets to all N of them.
 *
 * Deliberately never rendered for a stack of one — a "1 of 1" with two arrows
 * is a control that cannot be operated, which reads as a broken one.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface StackPager {
  /** Zero-based position of the open listing within the stack. */
  index: number;
  total: number;
  /** Move by ±1. The caller wraps, so neither arrow is ever a dead end. */
  onStep: (delta: number) => void;
}

export function ListingStackPager({
  pager,
  where,
}: {
  pager: StackPager;
  /** The address or suburb every member shares, when there is one. */
  where?: string | null;
}) {
  if (pager.total < 2) return null;

  return (
    <div
      className="flex items-center justify-between gap-1 rounded-md border border-border/60 bg-muted/40 px-1 py-1"
      role="group"
      aria-label={`Property ${pager.index + 1} of ${pager.total} at this location`}
    >
      <Button
        size="sm"
        variant="ghost"
        className="h-6 w-6 shrink-0 p-0"
        aria-label="Previous property at this location"
        onClick={() => pager.onStep(-1)}
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      <div className="min-w-0 text-center">
        <p className="text-[11px] font-semibold leading-tight text-foreground">
          <span className="tabular-nums">{pager.index + 1}</span> of{' '}
          <span className="tabular-nums">{pager.total}</span> here
        </p>
        {where ? (
          <p className="truncate text-[10px] leading-tight text-muted-foreground">{where}</p>
        ) : null}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 w-6 shrink-0 p-0"
        aria-label="Next property at this location"
        onClick={() => pager.onStep(1)}
      >
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}
