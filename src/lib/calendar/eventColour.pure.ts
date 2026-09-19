/**
 * One colour vocabulary for the calendar.
 *
 * The calendar draws the same events in four places — the month grid, the
 * events tool list, the heatmap and the analytics breakdown — and each had
 * decided independently what colour meant. The audit caught all three ways that
 * went wrong:
 *
 *  - item 23: every booking on the grid was green, because the pill was
 *    coloured by STATUS and `confirmed` is the normal state of a live booking,
 *    so the calendar's own colour was never reached. The events list beside it
 *    coloured by calendar, so the two views disagreed on screen.
 *  - item 24: "Confirmed" in the status breakdown wore the same green dot as
 *    the "Strategy Session" calendar beside it, so one mark meant two things.
 *  - item 19: a day with a single meeting was painted red for "Very Busy".
 *
 * The rule underneath all three: **colour marks identity, and only an
 * exceptional state may override it.** A healthy booking shows whose calendar
 * it belongs to, which is the thing you scan a month for. That mirrors the
 * badge rule the compliance surfaces already keep — a colour has to mean
 * something is unmet, or it means nothing at all.
 */

/** Appointment states that are not "this is going ahead". */
const EXCEPTIONAL_STATUSES = new Set([
  'cancelled',
  'canceled',
  'no_show',
  'noshow',
  'no-show',
  'rescheduled',
]);

export type EventColourSource = 'calendar' | 'status';

/**
 * Does this event's status override its calendar's colour?
 *
 * `confirmed` deliberately does NOT. It is how a healthy booking looks, and
 * treating it as a state worth colouring is what painted every live event on
 * the grid the same green. Cancelled and no-show mean the appointment is not
 * happening, and rescheduled means this slot is not the one — those are worth
 * saying in colour, and each also carries a non-colour signal (strikethrough,
 * reduced opacity) so the meaning does not rest on hue alone.
 */
export function eventColourSource(
  status: string | null | undefined,
): EventColourSource {
  const normalised = (status ?? '').trim().toLowerCase();
  return EXCEPTIONAL_STATUSES.has(normalised) ? 'status' : 'calendar';
}

/**
 * Absolute workload bands for a day, in number of appointments.
 *
 * These are counts, never a share of the busiest day in view. The heatmap
 * divided by its own maximum, so on a month whose busiest day held one meeting
 * that day scored 1.0 and was painted "Very Busy" in red. Relative shading
 * answers "which day is busiest", which a heatmap of a quiet month should be
 * allowed to answer with "none of them".
 *
 * The numbers are a working day at this business: appointments run 30–60
 * minutes, so five in a day is a full one and seven leaves no room.
 */
export const WORKLOAD_BANDS = [
  { id: 'free', label: 'Free', min: 0 },
  { id: 'light', label: 'Light', min: 1 },
  { id: 'moderate', label: 'Moderate', min: 3 },
  { id: 'busy', label: 'Busy', min: 5 },
  { id: 'full', label: 'Very Busy', min: 7 },
] as const;

export type WorkloadBandId = (typeof WORKLOAD_BANDS)[number]['id'];

export interface WorkloadBand {
  id: WorkloadBandId;
  label: string;
  /** Tailwind classes for the day cell. */
  cell: string;
  /** Tailwind classes for the legend swatch. */
  swatch: string;
}

/**
 * Fills are strong enough to read on the dark ground.
 *
 * The previous scale ran 20–50% alpha and was reported as faded, and `free` was
 * `bg-muted/30` — indistinguishable from the page behind it, so an empty day
 * looked like a rendering fault rather than an empty day.
 */
const BAND_STYLE: Record<WorkloadBandId, { cell: string; swatch: string }> = {
  free: {
    cell: 'bg-muted/70 border-border',
    swatch: 'bg-muted/70 border border-border',
  },
  light: {
    cell: 'bg-success/45 border-success/60',
    swatch: 'bg-success/45 border border-success/60',
  },
  // Two steps of one gold rather than two different golds. `--brand` was used
  // here and is white-labelled — gold by default, so it rendered as a second
  // `--warning` and "Moderate" and "Busy" became the same swatch. A token whose
  // hue a tenant can change cannot carry a step on a fixed scale.
  moderate: {
    cell: 'bg-warning/35 border-warning/55',
    swatch: 'bg-warning/35 border border-warning/55',
  },
  busy: {
    cell: 'bg-warning/85 border-warning/95',
    swatch: 'bg-warning/85 border border-warning/95',
  },
  full: {
    cell: 'bg-destructive/75 border-destructive/90',
    swatch: 'bg-destructive/75 border border-destructive/90',
  },
};

/** The band a day of `count` appointments falls in. */
export function workloadBand(count: number): WorkloadBand {
  const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  // Highest band whose floor the count reaches.
  const band = [...WORKLOAD_BANDS].reverse().find((b) => safe >= b.min)
    ?? WORKLOAD_BANDS[0];
  return { id: band.id, label: band.label, ...BAND_STYLE[band.id] };
}

/** The legend, in order, so it cannot drift from what the cells are painted. */
export function workloadLegend(): WorkloadBand[] {
  return WORKLOAD_BANDS.map((b) => workloadBand(b.min));
}

/**
 * How an appointment STATUS is drawn.
 *
 * A status is a badge; a calendar is a coloured dot. That distinction is the
 * fix for audit item 24, where the analytics panel drew "Confirmed" as a green
 * round dot directly beneath the "Strategy Session" calendar's green round dot
 * — one mark meaning two different things, side by side.
 *
 * Colour alone could not separate them and never will: a calendar's colour is
 * assigned from an open palette that contains greens, ambers and reds, so any
 * status hue can collide with some calendar. Form is what carries the
 * distinction, and hue is then free to say something within each vocabulary.
 *
 * These are semantic tokens rather than the six hardcoded hexes the panel used,
 * so they follow the theme and the white-label brand.
 */
export function statusBadgeClass(status: string | null | undefined): string {
  switch ((status ?? '').trim().toLowerCase()) {
    case 'confirmed':
    case 'showed':
      return 'rounded-full border-success/25 bg-success/15 text-success';
    case 'booked':
      return 'rounded-full border-info/25 bg-info/15 text-info';
    case 'noshow':
    case 'no_show':
    case 'no-show':
      return 'rounded-full border-destructive/25 bg-destructive/15 text-destructive';
    case 'cancelled':
    case 'canceled':
      return 'rounded-full border-border bg-muted text-muted-foreground';
    case 'pending':
      return 'rounded-full border-brand-400/25 bg-brand-500/15 text-brand-300';
    default:
      return 'rounded-full border-border bg-card/85 text-muted-foreground';
  }
}

/** Sentence-case a raw status for display. Never shows an underscored token. */
export function statusLabel(status: string): string {
  const cleaned = status.replace(/[_-]+/g, ' ').trim();
  if (!cleaned) return 'Unknown';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
