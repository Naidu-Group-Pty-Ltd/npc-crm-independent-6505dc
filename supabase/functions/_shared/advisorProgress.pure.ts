/**
 * What the Strategy Advisor says while it works.
 *
 * A request to the advisor takes 20–90 seconds: one model call, sometimes a
 * second one when the borrowing engine rejects the first set, and a check of
 * every scenario against the engine. For all of that the chat drew one
 * spinning circle, so a broker could not tell a slow answer from a stalled one.
 *
 * The advisor now reports each stage it actually reaches, as a
 * `data: { "progress": … }` event on the stream it already sends. The words
 * for every stage are here, so the server and the browser cannot describe the
 * same moment two ways. Three rules:
 *
 * - **A stage is reported only when it is reached.** Nothing here runs on a
 *   timer pretending to be progress. The elapsed clock ticks, and the stage
 *   line changes only when the server says so.
 * - **The line under the stage states a fact from the brief, never a thought.**
 *   While the model drafts, nothing tells us what it is weighing at that
 *   second. What is known is what it was handed, so the rotating line says
 *   "In the brief: Money Me, $10,000 balance, $862/mo", never "Considering
 *   paying out Money Me".
 * - **Either side may be older than the other.** An older browser ignores an
 *   event it does not know: it reads only `error` and `choices`. A newer
 *   browser moves itself to "reading" when the stream opens, and to
 *   "drafting" if the server has reported nothing within
 *   `LOCAL_DRAFTING_AFTER_MS`, which is what an older server does. The
 *   stage never moves backwards (`acceptsStage`), so a late report is ignored.
 */

export const ADVISOR_PROGRESS_STAGES = [
  'sending',
  'reading',
  'drafting',
  'validating',
  'revising',
  'finishing',
] as const;
export type AdvisorProgressStage = typeof ADVISOR_PROGRESS_STAGES[number];

/** `scenarios` generates three cards; `answer` replies in prose to a question about them. */
export type AdvisorProgressMode = 'scenarios' | 'answer';

export interface AdvisorProgressEvent {
  stage: AdvisorProgressStage;
  detail?: string | null;
  mode?: AdvisorProgressMode;
}

const STAGE_ORDER: Record<AdvisorProgressStage, number> = {
  sending: 0,
  reading: 1,
  drafting: 2,
  validating: 3,
  revising: 4,
  finishing: 5,
};

/** Past a stage, a report of an earlier one is late news, not a step back. */
export function acceptsStage(current: AdvisorProgressStage, next: AdvisorProgressStage): boolean {
  return STAGE_ORDER[next] >= STAGE_ORDER[current];
}

const DETAIL_MAX = 200;

/** The event on the wire, or null for anything that is not one. */
export function readProgressEvent(parsed: unknown): AdvisorProgressEvent | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const progress = (parsed as Record<string, unknown>).progress;
  if (!progress || typeof progress !== 'object') return null;
  const rec = progress as Record<string, unknown>;
  const stage = rec.stage;
  if (typeof stage !== 'string' || !(ADVISOR_PROGRESS_STAGES as readonly string[]).includes(stage)) return null;
  const detail = typeof rec.detail === 'string' && rec.detail.trim()
    ? rec.detail.trim().slice(0, DETAIL_MAX)
    : null;
  const mode = rec.mode === 'answer' || rec.mode === 'scenarios' ? rec.mode : undefined;
  return { stage: stage as AdvisorProgressStage, detail, ...(mode ? { mode } : {}) };
}

/** The wire form the server sends. */
export function progressEvent(stage: AdvisorProgressStage, detail?: string | null, mode?: AdvisorProgressMode) {
  return { progress: { stage, ...(detail ? { detail } : {}), ...(mode ? { mode } : {}) } };
}

// ── The binding constraint ─────────────────────────────────────────────
//
// The advisor's prompt names the constraint that limits this client's
// capacity. That classification lives here so the progress line and the
// prompt cannot disagree about it. The prompt's own wording is unchanged and
// stays in the function.

export type BindingConstraint = 'dti_cap' | 'monthly_surplus' | 'low_capacity' | 'serviceability';

export function bindingConstraintOf(input: {
  dtiCapEnabled: boolean;
  dtiHeadroom: number;
  surplus: number;
  capacity: number;
}): BindingConstraint {
  if (input.dtiCapEnabled && input.dtiHeadroom < 0.05) return 'dti_cap';
  if (input.surplus < 500) return 'monthly_surplus';
  if (input.capacity < 100000) return 'low_capacity';
  return 'serviceability';
}

const CONSTRAINT_PHRASE: Record<BindingConstraint, (dtiCap: number) => string> = {
  dti_cap: (cap) => `the ${formatMultiple(cap)} debt-to-income cap is what limits capacity`,
  monthly_surplus: () => 'monthly surplus is what limits capacity',
  low_capacity: () => 'capacity is low, so commitments come first',
  serviceability: () => 'serviceability is what limits capacity',
};

// ── Server wording ─────────────────────────────────────────────────────

const aud = (n: number): string =>
  `$${Math.round(n).toLocaleString('en-AU')}`;

function formatMultiple(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}x`;
}

/** Said once the client's position has been read and the brief written. */
export function readingDetail(input: {
  capacity: number | null;
  constraint: BindingConstraint | null;
  dtiCap: number;
}): string | null {
  const parts: string[] = [];
  if (typeof input.capacity === 'number' && Number.isFinite(input.capacity) && input.capacity > 0) {
    parts.push(`Capacity today ${aud(input.capacity)}`);
  }
  if (input.constraint) parts.push(CONSTRAINT_PHRASE[input.constraint](input.dtiCap));
  return parts.length ? parts.join(' · ') : null;
}

/** Said as the model call starts. */
export function draftingDetail(input: { mode: AdvisorProgressMode; targetPrice: number | null }): string {
  if (input.mode === 'answer') return 'Answering from the scenarios already on screen';
  return typeof input.targetPrice === 'number' && input.targetPrice > 0
    ? `Aiming three scenarios at the ${aud(input.targetPrice)} purchase`
    : 'Drafting three scenarios to lift borrowing capacity';
}

/** Said as the drafted scenarios go through the borrowing engine. */
export function validatingDetail(count: number): string {
  return `Running ${count === 1 ? 'the scenario' : `all ${count} scenarios`} through the borrowing engine`;
}

/** Said when the engine rejected enough of the first set to ask for a second. */
export function revisingDetail(flagged: number, total: number): string {
  return `The engine flagged ${flagged} of ${total} scenarios, so the advisor is revising them`;
}

// ── Browser wording ────────────────────────────────────────────────────

const STAGE_TEXT: Record<AdvisorProgressStage, { active: string; step: string }> = {
  sending: { active: "Sending the client's position to the advisor", step: 'Sent' },
  reading: { active: "Reading the client's position", step: 'Read position' },
  drafting: { active: 'Drafting three scenarios', step: 'Drafting' },
  validating: { active: 'Checking the scenarios against the borrowing engine', step: 'Engine check' },
  revising: { active: 'Revising the scenarios the engine flagged', step: 'Revising' },
  finishing: { active: 'Checking each scenario against the live calculator', step: 'Finishing' },
};

const ANSWER_TEXT: Partial<Record<AdvisorProgressStage, { active: string; step: string }>> = {
  drafting: { active: 'Writing the answer', step: 'Answering' },
  finishing: { active: 'Finishing the answer', step: 'Finishing' },
};

export interface AdvisorBriefInput {
  capacity?: number | null;
  monthlySurplus?: number | null;
  dtiRatio?: number | string | null;
  liabilities?: Array<{ label?: string; balance?: number; monthlyServicing?: number }>;
  properties?: Array<{ address?: string; current_value?: number; loan_remaining?: number }>;
}

const MAX_LIABILITY_FACTS = 5;
const MAX_PROPERTY_FACTS = 5;

/**
 * What the advisor was handed, one line at a time. These are the figures
 * the browser itself sent, so every line is a fact about the brief.
 */
export function briefFacts(input: AdvisorBriefInput): string[] {
  const facts: string[] = [];
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

  const capacity = num(input.capacity);
  const surplus = num(input.monthlySurplus);
  if (capacity !== null && capacity > 0) {
    facts.push(surplus !== null
      ? `Capacity today ${aud(capacity)}, monthly surplus ${aud(surplus)}`
      : `Capacity today ${aud(capacity)}`);
  }
  const dti = typeof input.dtiRatio === 'string' ? Number(input.dtiRatio) : num(input.dtiRatio);
  if (dti !== null && Number.isFinite(dti) && dti > 0) {
    facts.push(`Debt-to-income ratio ${dti.toFixed(2)}x`);
  }
  for (const l of (input.liabilities ?? []).slice(0, MAX_LIABILITY_FACTS)) {
    const label = (l.label ?? '').trim();
    if (!label) continue;
    const bits: string[] = [];
    const balance = num(l.balance);
    const servicing = num(l.monthlyServicing);
    if (balance !== null) bits.push(`${aud(balance)} balance`);
    if (servicing !== null) bits.push(`${aud(servicing)}/mo`);
    facts.push(bits.length ? `${label}, ${bits.join(', ')}` : label);
  }
  for (const p of (input.properties ?? []).slice(0, MAX_PROPERTY_FACTS)) {
    const address = (p.address ?? '').trim();
    if (!address) continue;
    const value = num(p.current_value);
    const loan = num(p.loan_remaining);
    const bits: string[] = [];
    if (value !== null && value > 0) bits.push(`valued ${aud(value)}`);
    if (loan !== null) bits.push(`loan ${aud(loan)}`);
    if (value !== null && value > 0 && loan !== null) bits.push(`LVR ${Math.round((loan / value) * 100)}%`);
    facts.push(bits.length ? `${address}, ${bits.join(', ')}` : address);
  }
  return facts;
}

/** With no report from the server this long after the stream opens, the browser assumes drafting. */
export const LOCAL_DRAFTING_AFTER_MS = 2500;
/** How long each brief fact stays on screen while the model works. */
export const FACT_ROTATION_MS = 4000;
/** Past this, the line says a full answer can take longer. */
export const PATIENCE_AFTER_MS = 40_000;

export interface AdvisorProgressState {
  stage: AdvisorProgressStage;
  detail: string | null;
  mode: AdvisorProgressMode;
  startedAt: number;
  stageAt: number;
  /** Whether the server reported a revision pass on this request. */
  revised: boolean;
}

export function initialProgress(now: number): AdvisorProgressState {
  return { stage: 'sending', detail: null, mode: 'scenarios', startedAt: now, stageAt: now, revised: false };
}

/** The state after an event, or the same state when the event is late news. */
export function advanceProgress(
  state: AdvisorProgressState,
  event: AdvisorProgressEvent,
  now: number,
): AdvisorProgressState {
  if (!acceptsStage(state.stage, event.stage)) return state;
  const sameStage = event.stage === state.stage;
  return {
    ...state,
    stage: event.stage,
    // A repeat of the current stage may add detail; it never clears it.
    detail: event.detail ?? (sameStage ? state.detail : null),
    mode: event.mode ?? state.mode,
    stageAt: sameStage ? state.stageAt : now,
    revised: state.revised || event.stage === 'revising',
  };
}

export type ProgressStepState = 'done' | 'active' | 'pending';

export interface AdvisorProgressView {
  headline: string;
  detail: string | null;
  /** A fact from the brief, shown only while the model is working. */
  briefLine: string | null;
  elapsed: string;
  patienceNote: string | null;
  steps: Array<{ stage: AdvisorProgressStage; label: string; state: ProgressStepState }>;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function textFor(stage: AdvisorProgressStage, mode: AdvisorProgressMode) {
  return (mode === 'answer' ? ANSWER_TEXT[stage] : undefined) ?? STAGE_TEXT[stage];
}

/** Everything the progress bubble draws, from the state and the clock. */
export function advisorProgressView(
  state: AdvisorProgressState,
  now: number,
  facts: readonly string[],
): AdvisorProgressView {
  const visible: AdvisorProgressStage[] = state.mode === 'answer'
    ? ['sending', 'reading', 'drafting', 'finishing']
    : ['sending', 'reading', 'drafting', 'validating', ...(state.revised ? ['revising' as const] : []), 'finishing'];
  const at = STAGE_ORDER[state.stage];
  const steps = visible.map((stage) => ({
    stage,
    label: textFor(stage, state.mode).step,
    state: (STAGE_ORDER[stage] < at ? 'done' : stage === state.stage ? 'active' : 'pending') as ProgressStepState,
  }));

  const modelWorking = state.stage === 'drafting' || state.stage === 'revising';
  const inStage = Math.max(0, now - state.stageAt);
  const briefLine = modelWorking && facts.length > 0
    ? facts[Math.floor(inStage / FACT_ROTATION_MS) % facts.length]
    : null;

  let patienceNote: string | null = null;
  if (state.stage === 'revising') {
    patienceNote = 'A revision adds up to 45 seconds.';
  } else if (modelWorking && now - state.startedAt >= PATIENCE_AFTER_MS) {
    patienceNote = state.mode === 'answer'
      ? 'Still writing. A detailed answer can take up to a minute and a half.'
      : 'Still drafting. A full set of three scenarios can take up to a minute and a half.';
  }

  return {
    headline: textFor(state.stage, state.mode).active,
    detail: state.detail,
    briefLine,
    elapsed: formatElapsed(now - state.startedAt),
    patienceNote,
    steps,
  };
}
