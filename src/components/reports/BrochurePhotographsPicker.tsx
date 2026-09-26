/**
 * The photographs an uploaded brochure offers a report, for the adviser to
 * confirm before the report is made.
 *
 * Everything here is presentation. What is offered, what is suggested and the
 * order the report uses are decided in `brochurePhotographs.pure.ts`; this
 * shows that decision and lets the adviser change the ticks. Nothing is sent
 * from here: the ticked set is filed under the report once it exists.
 *
 * Two things are said rather than left to be inferred, because each changes
 * what the adviser should do: which ticked photograph becomes the cover (the
 * first, in the order shown), and why a picture the adviser can see in the
 * brochure is not here — its page names no property or another lot, it is a
 * plan or a graphic, or the brochure's address cannot vouch for one property
 * at all.
 */
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { brochurePageLabel, type BrochureOffer } from '@/lib/reports/brochurePhotographs.pure';
import {
  REPORT_FLOOR_PLAN_LIMIT,
  REPORT_PHOTOGRAPH_LIMIT,
} from '../../../supabase/functions/_shared/reportPhotographs.pure';

export type BrochurePickerStatus = 'reading' | 'ready' | 'failed';

export interface BrochurePhotographsPickerProps {
  status: BrochurePickerStatus;
  offer: BrochureOffer | null;
  /** Object URLs of the encoded photographs, by candidate key. */
  previews: ReadonlyMap<string, string>;
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
  /** The floor plans ticked; a plan is printed whole, on a page of its own. */
  selectedPlans?: ReadonlySet<string>;
  onSelectedPlansChange?: (next: Set<string>) => void;
  /** Whether the brochure's address names a street and a suburb, so its photographs can be tied to one property. */
  addressUsable: boolean;
  disabled?: boolean;
}

function Heading() {
  return <p className="text-sm font-semibold text-foreground">Photographs from the brochure</p>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-5 text-muted-foreground">{children}</p>;
}

export function BrochurePhotographsPicker({
  status,
  offer,
  previews,
  selected,
  onSelectedChange,
  selectedPlans = new Set<string>(),
  onSelectedPlansChange = () => {},
  addressUsable,
  disabled = false,
}: BrochurePhotographsPickerProps) {
  if (status === 'reading') {
    return (
      <div className="space-y-1" data-testid="brochure-photographs" aria-live="polite">
        <Heading />
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Reading the brochure&apos;s photographs…
        </p>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="space-y-1" data-testid="brochure-photographs">
        <Heading />
        <Note>The brochure&apos;s pictures couldn&apos;t be read, so the report will be made without photographs.</Note>
      </div>
    );
  }

  if (!addressUsable) {
    return (
      <div className="space-y-1" data-testid="brochure-photographs">
        <Heading />
        <Note>
          The brochure&apos;s address has no street and suburb, so its photographs can&apos;t be tied to this
          property. The report will be made without them.
        </Note>
      </div>
    );
  }

  const offered = (offer?.offered ?? []).filter((candidate) => previews.has(candidate.key));
  const plans = (offer?.plans ?? []).filter((candidate) => previews.has(candidate.key));
  const leftOut = offer?.leftOut;

  if (offer && !offer.namesProperty) {
    return (
      <div className="space-y-1" data-testid="brochure-photographs">
        <Heading />
        <Note>
          No page of the brochure names this address, so none of its pictures can be tied to this property. The
          report will be made without them.
        </Note>
      </div>
    );
  }

  const notes = (
    <>
      {offer?.multiProperty ? (
        <Note>This brochure covers other lots too. Only pictures from pages naming this one are shown.</Note>
      ) : Boolean(leftOut?.unnamedPages) && (
        <Note>
          Pictures on pages that don&apos;t name this address aren&apos;t shown, because nothing ties them to this
          property.
        </Note>
      )}
      {Boolean(leftOut?.notPhotographs) && (
        <Note>Logos and other graphics aren&apos;t used.</Note>
      )}
    </>
  );

  if (!offered.length && !plans.length) {
    return (
      <div className="space-y-1" data-testid="brochure-photographs">
        <Heading />
        <Note>The pages naming this address carry no photograph or floor plan of it.</Note>
        {notes}
      </div>
    );
  }

  const chosen = offered.filter((candidate) => selected.has(candidate.key));
  const coverKey = chosen[0]?.key ?? null;
  const full = chosen.length >= REPORT_PHOTOGRAPH_LIMIT;
  const plansChosen = plans.filter((candidate) => selectedPlans.has(candidate.key)).length;
  const plansFull = plansChosen >= REPORT_FLOOR_PLAN_LIMIT;

  const togglePlan = (key: string, on: boolean) => {
    const next = new Set([...selectedPlans].filter((picked) => plans.some((candidate) => candidate.key === picked)));
    if (on) {
      if (next.size >= REPORT_FLOOR_PLAN_LIMIT) return;
      next.add(key);
    } else {
      next.delete(key);
    }
    onSelectedPlansChange(next);
  };

  const toggle = (key: string, on: boolean) => {
    const next = new Set([...selected].filter((picked) => offered.some((candidate) => candidate.key === picked)));
    if (on) {
      if (next.size >= REPORT_PHOTOGRAPH_LIMIT) return;
      next.add(key);
    } else {
      next.delete(key);
    }
    onSelectedChange(next);
  };

  return (
    <div className="space-y-3" data-testid="brochure-photographs">
      <div className="space-y-1">
        <Heading />
        {offered.length > 0
          ? <Note>Ticked photographs go into the report, in this order. The first is its cover.</Note>
          : <Note>The pages naming this address carry no photograph of it.</Note>}
      </div>
      {offered.length > 0 && (
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Photographs from the brochure">
        {offered.map((candidate) => {
          const checked = selected.has(candidate.key);
          const locked = disabled || (!checked && full);
          const where = brochurePageLabel(candidate);
          const id = `brochure-photograph-${candidate.key}`;
          return (
            <li key={candidate.key}>
              <label
                htmlFor={id}
                className={cn(
                  'relative block overflow-hidden rounded-2xl border transition-colors',
                  checked ? 'border-primary ring-2 ring-primary/40' : 'border-border/60',
                  locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-primary/40',
                )}
              >
                <img
                  src={previews.get(candidate.key)}
                  alt={`Photograph from the brochure, ${where.toLowerCase()}`}
                  className="aspect-[4/3] w-full object-cover"
                  loading="lazy"
                  draggable={false}
                />
                <span className="absolute left-2 top-2 flex rounded-md bg-background/85 p-1">
                  <Checkbox
                    id={id}
                    checked={checked}
                    disabled={locked}
                    onCheckedChange={(value) => toggle(candidate.key, value === true)}
                    aria-label={`Use the photograph from ${where.toLowerCase()}`}
                  />
                </span>
                {checked && candidate.key === coverKey && (
                  <Badge className="absolute right-2 top-2">Cover</Badge>
                )}
                <span className="block px-2 py-1.5 text-xs text-muted-foreground">{where}</span>
              </label>
            </li>
          );
        })}
      </ul>
      )}
      {full && <Note>A report carries up to {REPORT_PHOTOGRAPH_LIMIT} photographs.</Note>}
      {plans.length > 0 && (
        <div className="space-y-2" data-testid="brochure-floor-plans">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">{plans.length === 1 ? 'Floor plan' : 'Floor plans'}</p>
            <Note>A ticked plan is printed whole, on a page of its own.</Note>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Floor plans from the brochure">
            {plans.map((candidate) => {
              const checked = selectedPlans.has(candidate.key);
              const locked = disabled || (!checked && plansFull);
              const where = brochurePageLabel(candidate);
              const id = `brochure-plan-${candidate.key}`;
              return (
                <li key={candidate.key}>
                  <label
                    htmlFor={id}
                    className={cn(
                      'relative block overflow-hidden rounded-2xl border transition-colors',
                      checked ? 'border-primary ring-2 ring-primary/40' : 'border-border/60',
                      locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-primary/40',
                    )}
                  >
                    {/* Contained, never cropped: the preview shows the whole plan, as the page will. */}
                    <img
                      src={previews.get(candidate.key)}
                      alt={`Floor plan from the brochure, ${where.toLowerCase()}`}
                      className="aspect-[4/3] w-full bg-muted/40 object-contain p-2"
                      loading="lazy"
                      draggable={false}
                    />
                    <span className="absolute left-2 top-2 flex rounded-md bg-background/85 p-1">
                      <Checkbox
                        id={id}
                        checked={checked}
                        disabled={locked}
                        onCheckedChange={(value) => togglePlan(candidate.key, value === true)}
                        aria-label={`Use the floor plan from ${where.toLowerCase()}`}
                      />
                    </span>
                    <span className="block px-2 py-1.5 text-xs text-muted-foreground">{where}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {plansFull && plans.length > REPORT_FLOOR_PLAN_LIMIT && (
            <Note>A report carries up to {REPORT_FLOOR_PLAN_LIMIT} floor plans.</Note>
          )}
        </div>
      )}
      {notes}
    </div>
  );
}

export default BrochurePhotographsPicker;
