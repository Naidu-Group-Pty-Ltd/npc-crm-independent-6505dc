/**
 * The deal journey — ONE derivation of "where is this deal" that every
 * surface renders from.
 *
 * ## Why this module exists
 *
 * The product used to answer "what stage is this deal at" three different
 * ways at once. The pipeline board's *column* derived position from the
 * stages array (first in-progress stage, else first pending); the card
 * *badge* printed the stored `client_deals.current_stage`, which exactly one
 * code path ever updated (setting a stage to in-progress from the detail
 * view — completing a stage never moved it); and the card's "Next:" line
 * used a third rule again. A deal whose operator only ever ticked
 * "Completed" sat in the right column wearing a stage-1 badge.
 *
 * Two columns were also dishonest. `Settlement` and `Commission` stage
 * categories mapped to no column at all, so a House & Land deal at "Land
 * Settlement" — its final stage — fell through a numeric heuristic into
 * Finance. And Construction was unreachable: no stage template carries that
 * category (the build lives in `build_progress_payments`), so a deal whose
 * land had settled but whose build was at Frame read as Finalised.
 *
 * ## The rules
 *
 * - **Current stage** is the first `in_progress` stage by display order,
 *   else the first `pending`. The stored `current_stage` is a legacy
 *   denormalisation: display never depends on it while a stages array
 *   exists, and the detail view heals it after every stage edit.
 * - **Phase** comes from the current stage's category. `Land` is
 *   acquisition, `Commission` is finalised (post-settlement bookkeeping has
 *   its own dashboard), `Settlement` is a phase of its own.
 * - **Construction is derived, not declared**: a House & Land deal whose
 *   stages are finished but whose build payments are not all paid to the
 *   builder is *in construction*, and its stage label names the build stage.
 * - A deal with no stages at all keeps the stored stage text and the old
 *   numeric phase heuristic, so legacy rows behave exactly as before.
 *
 * The portal renders the same derivation with client vocabulary — the
 * audience changes the words, never the position.
 */

export type JourneyPhaseId =
  | 'onboarding'
  | 'advisory'
  | 'acquisition'
  | 'deposit'
  | 'finance'
  | 'legal'
  | 'settlement'
  | 'construction'
  | 'finalised';

export interface JourneyPhase {
  id: JourneyPhaseId;
  label: string;
  icon: string;
  /** Board column accent (a `border-t-*` semantic token class). */
  accent: string;
  /** One client-safe sentence — shown to staff and clients alike. */
  blurb: string;
}

/** Canonical order: the journey as a left-to-right story. */
export const JOURNEY_PHASES: JourneyPhase[] = [
  { id: 'onboarding', label: 'Onboarding', icon: '📋', accent: 'border-t-chart-3', blurb: 'Engagement signed and the file opened.' },
  { id: 'advisory', label: 'Advisory', icon: '🧭', accent: 'border-t-chart-1', blurb: 'Strategy agreed before anything is committed.' },
  { id: 'acquisition', label: 'Acquisition', icon: '🏠', accent: 'border-t-primary', blurb: 'The property or lot is secured.' },
  { id: 'deposit', label: 'Deposit', icon: '💰', accent: 'border-t-warning', blurb: 'Deposits paid and receipted.' },
  { id: 'finance', label: 'Finance', icon: '🏦', accent: 'border-t-chart-6', blurb: 'The loan approved and finance unconditional.' },
  { id: 'legal', label: 'Legal', icon: '⚖️', accent: 'border-t-chart-4', blurb: 'Contracts reviewed, signed and exchanged.' },
  { id: 'settlement', label: 'Settlement', icon: '🏁', accent: 'border-t-info', blurb: 'The transaction completes and funds settle.' },
  { id: 'construction', label: 'Construction', icon: '🔨', accent: 'border-t-chart-2', blurb: 'The build moves through its payment stages.' },
  { id: 'finalised', label: 'Finalised', icon: '✅', accent: 'border-t-success', blurb: 'Everything is done and the file is closed.' },
];

export const JOURNEY_PHASE_BY_ID: Record<JourneyPhaseId, JourneyPhase> = Object.fromEntries(
  JOURNEY_PHASES.map((p) => [p.id, p]),
) as Record<JourneyPhaseId, JourneyPhase>;

/**
 * Every stage_category the three templates spell, mapped onto a phase.
 * `land` is acquisition; `commission` is finalised — the deal has settled
 * and commission tracking has its own surface; `settlement` is its own
 * phase rather than the Finance fall-through it used to be.
 */
const CATEGORY_TO_PHASE: Record<string, JourneyPhaseId> = {
  onboarding: 'onboarding',
  advisory: 'advisory',
  acquisition: 'acquisition',
  land: 'acquisition',
  deposit: 'deposit',
  finance: 'finance',
  legal: 'legal',
  settlement: 'settlement',
  construction: 'construction',
  commission: 'finalised',
  finalised: 'finalised',
};

export function phaseForCategory(category: string | null | undefined): JourneyPhaseId | null {
  if (!category) return null;
  return CATEGORY_TO_PHASE[category.trim().toLowerCase()] ?? null;
}

/** Structural inputs — Deal, DealWithClient and the portal's payloads all fit. */
export interface JourneyStage {
  stage_number: number;
  stage_name: string;
  stage_category: string | null;
  status: 'pending' | 'in_progress' | 'complete' | 'skipped';
  display_order: number;
  completed_at?: string | null;
  client_action?: string | null;
  internal_action?: string | null;
  responsible?: string | null;
  key_date?: string | null;
}

export interface JourneyBuildPayment {
  stage_name: string;
  paid_to_builder: boolean;
  display_order: number;
}

export interface JourneyDealInput {
  deal_type?: string | null;
  current_stage?: string | null;
  current_stage_number?: number | null;
  stages?: JourneyStage[] | null;
  buildPayments?: JourneyBuildPayment[] | null;
}

export type JourneyPhaseStateKind = 'done' | 'current' | 'upcoming';

export interface JourneyPhaseState {
  phase: JourneyPhase;
  state: JourneyPhaseStateKind;
  /** Stages mapped to this phase (0 for derived phases like Construction). */
  total: number;
  done: number;
}

export interface DealJourney {
  phaseId: JourneyPhaseId;
  phase: JourneyPhase;
  /** First in-progress stage, else first pending. Null when finished or no stages. */
  currentStage: JourneyStage | null;
  /** The first pending stage after the current one — "then". */
  nextStage: JourneyStage | null;
  /** What a badge or card prints for the deal's position. */
  stageLabel: string;
  stageNumber: number | null;
  totalStages: number;
  completedStages: number;
  progressPct: number;
  /** Every lifecycle stage is complete or skipped (and at least one exists). */
  stagesComplete: boolean;
  /** stagesComplete AND — for House & Land — the build fully paid too. */
  isSettled: boolean;
  build: { total: number; paid: number; pct: number; currentName: string | null } | null;
  /** The phase strip: this deal's phases in canonical order, with states. */
  phases: JourneyPhaseState[];
}

function sortByDisplayOrder<T extends { display_order: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.display_order - b.display_order);
}

/** The legacy fallback for deals with no stages array (or none loaded). */
function phaseFromStageNumber(stageNumber: number | null | undefined): JourneyPhaseId {
  const n = stageNumber ?? 0;
  if (n <= 1) return 'onboarding';
  if (n <= 2) return 'advisory';
  return 'finance';
}

export function deriveDealJourney(deal: JourneyDealInput): DealJourney {
  const stages = sortByDisplayOrder(deal.stages ?? []);
  const payments = sortByDisplayOrder(deal.buildPayments ?? []);
  const isHnL = deal.deal_type === 'house_and_land';

  const completedStages = stages.filter((s) => s.status === 'complete').length;
  const totalStages = stages.length;
  const progressPct = totalStages > 0 ? Math.round((completedStages / totalStages) * 100) : 0;
  const stagesComplete = totalStages > 0 && stages.every((s) => s.status === 'complete' || s.status === 'skipped');

  const build = payments.length > 0
    ? {
        total: payments.length,
        paid: payments.filter((p) => p.paid_to_builder).length,
        pct: Math.round((payments.filter((p) => p.paid_to_builder).length / payments.length) * 100),
        currentName: payments.find((p) => !p.paid_to_builder)?.stage_name ?? null,
      }
    : null;
  const buildComplete = !build || build.paid === build.total;

  const currentStage = stagesComplete
    ? null
    : stages.find((s) => s.status === 'in_progress') ?? stages.find((s) => s.status === 'pending') ?? null;
  const nextStage = currentStage
    ? stages.slice(stages.indexOf(currentStage) + 1).find((s) => s.status === 'pending') ?? null
    : null;

  let phaseId: JourneyPhaseId;
  let stageLabel: string;
  let stageNumber: number | null;

  if (totalStages === 0) {
    // Legacy rows: keep the stored text and the old numeric heuristic.
    phaseId = phaseFromStageNumber(deal.current_stage_number);
    stageLabel = deal.current_stage || 'Not started';
    stageNumber = deal.current_stage_number ?? null;
  } else if (currentStage) {
    phaseId = phaseForCategory(currentStage.stage_category)
      ?? phaseFromStageNumber(currentStage.stage_number);
    stageLabel = currentStage.stage_name;
    stageNumber = currentStage.stage_number;
  } else if (isHnL && !buildComplete) {
    // Land settled, build under way: the deal is in construction and its
    // position is the first unpaid build stage.
    phaseId = 'construction';
    stageLabel = build?.currentName ? `Build: ${build.currentName}` : 'Build in progress';
    stageNumber = null;
  } else {
    phaseId = 'finalised';
    const lastCompleted = [...stages].reverse().find((s) => s.status === 'complete');
    stageLabel = lastCompleted?.stage_name ?? deal.current_stage ?? 'Completed';
    stageNumber = lastCompleted?.stage_number ?? null;
  }

  const isSettled = stagesComplete && (!isHnL || buildComplete);

  // ── Phase strip ────────────────────────────────────────────────────────
  const stagesByPhase = new Map<JourneyPhaseId, JourneyStage[]>();
  for (const s of stages) {
    const p = phaseForCategory(s.stage_category);
    if (!p) continue;
    if (!stagesByPhase.has(p)) stagesByPhase.set(p, []);
    stagesByPhase.get(p)!.push(s);
  }

  const phases: JourneyPhaseState[] = [];
  for (const phase of JOURNEY_PHASES) {
    const own = stagesByPhase.get(phase.id) ?? [];
    const isConstruction = phase.id === 'construction';
    const isFinalised = phase.id === 'finalised';
    const present = own.length > 0
      || (isConstruction && isHnL && payments.length > 0)
      // Every journey ends somewhere: the Finalised chip is always drawn.
      || isFinalised;
    if (!present) continue;

    const done = own.filter((s) => s.status === 'complete' || s.status === 'skipped').length;
    let state: JourneyPhaseStateKind;
    if (isSettled) {
      state = 'done';
    } else if (phase.id === phaseId) {
      state = 'current';
    } else if (isConstruction && own.length === 0) {
      state = buildComplete && payments.length > 0 ? 'done' : 'upcoming';
    } else if (isFinalised && own.length === 0) {
      state = 'upcoming';
    } else {
      state = own.length > 0 && done === own.length ? 'done' : 'upcoming';
    }

    phases.push({ phase, state, total: own.length, done });
  }

  return {
    phaseId,
    phase: JOURNEY_PHASE_BY_ID[phaseId],
    currentStage,
    nextStage,
    stageLabel,
    stageNumber,
    totalStages,
    completedStages,
    progressPct,
    stagesComplete,
    isSettled,
    build,
    phases,
  };
}

/** One-line convenience for list rows and search: what the badge would say. */
export function stageDisplayOf(deal: JourneyDealInput): string {
  return deriveDealJourney(deal).stageLabel;
}
