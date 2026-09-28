/**
 * The Strategy Rationale Brief, as the words it prints.
 *
 * The brief is the What-If tab's hand-off to finance: what the scenario does,
 * why each lever earns its place, how the arithmetic reconciles, and the order
 * to execute it in. Its content is composed in the browser from the scenario
 * the adviser is modelling — unsaved, so nothing on the server holds it — by
 * `strategyRationaleEngine`, and until 28 Sep 2026 it was drawn there by
 * `StrategyRationalePDF.ts` with jsPDF: Helvetica, hand-placed boxes, and a
 * template choice it could only honour as a palette.
 *
 * The owner's instruction for moving it onto the typeset route was exact: the
 * content "is predominantly just a transition of that information into the new
 * template structure" — nothing added, nothing reworded. So this module is the
 * one statement of **what the brief prints**, string for string what the jsPDF
 * generator prints from the same report, and the typeset renderer draws only
 * what it is handed:
 *
 *   - `composeStrategyRationale` runs in the browser, over the engine's report
 *     and the panel's context, and produces the document.
 *   - `readStrategyRationale` runs on the server over what arrived, and keeps
 *     only fields of the right shape and size — a request body is not trusted
 *     just because a browser built it.
 *
 * Everything here is text or a small closed vocabulary. There is no figure the
 * server recomputes, because the scenario is not the server's to know.
 *
 * Pure: no clock, no I/O. The generated time is formatted by the caller, as
 * the jsPDF generator formats it (`dd MMMM yyyy, HH:mm`, the adviser's own
 * time zone), because a server in UTC would print a different hour.
 */

export const STRATEGY_RATIONALE_NAME = 'Strategy Rationale Brief';
export const STRATEGY_RATIONALE_STANDFIRST = 'Borrowing Capacity Scenario — Finance Hand-off';

export type RationaleSeverity = 'info' | 'positive' | 'caution' | 'critical';
export type RationaleTone = 'neutral' | 'positive' | 'negative';

// ── What the engine hands the panel (structural; the engine lives in `src/`) ─

export interface RationaleReportInput {
  headline: string;
  subHeadline?: string;
  bullets: Array<{
    what: string;
    why: string;
    capacityImpact: number;
    cashflowNote?: string;
    severity: RationaleSeverity;
  }>;
  reconciliation: string;
  sequence: Array<{ step: number; action: string; detail?: string; owner: 'broker' | 'finance' | 'client' }>;
  caveats: string[];
  capitalFlow?: {
    totalRouted: number;
    totalAvailable: number;
    monthlyServicingDelta: number;
    debtBalanceDelta: number;
    overcommitted: boolean;
    remainder: number;
    legs: Array<{
      sourceLabel: string;
      sinkLabel: string;
      sinkType: string;
      amount: number;
      monthlyServicingDelta: number;
      debtBalanceDelta: number;
      note?: string;
    }>;
  };
}

export interface RationaleContextInput {
  baseCapacity: number;
  scenarioCapacity: number;
  effectivePurchasePower?: number | null;
  targetPurchasePrice?: number | null;
  meetsTarget?: boolean | null;
  scenarioName?: string;
  valuationAssumptions?: Array<{
    address: string;
    originalValue: number;
    newValue: number;
    basis: 'manual' | 'desktop' | 'avm' | 'comparable_sales';
    source?: string;
  }>;
  crossCollatPool?: {
    enabled: boolean;
    propertyAddresses: string[];
    blendedTargetLVR: number;
    lenderMaxLVR: number;
    allocationStrategy: 'highest_equity_first' | 'pro_rata';
    totalPoolValue: number;
    totalPoolDebt: number;
    poolReleaseAmount: number;
  } | null;
  /**
   * The Strategy Advisor's own account of the scenario it proposed, where the
   * levers on screen came from one of its cards. Absent for a scenario the
   * adviser built by hand, and the brief then prints exactly what it printed
   * before this field existed.
   */
  advisor?: RationaleAdvisorInput | null;
}

/**
 * What the Strategy Advisor wrote for the scenario that was applied — the
 * client-specific explanation its system prompt tells it to write "as if it
 * will be quoted directly into a finance handoff (because it will)".
 *
 * Its `estimatedImpact` is deliberately not carried: it is the model's guess
 * at the uplift, and the brief already prints the engine's own figure in the
 * capacity boxes. Two capacity figures for one scenario is how a finance team
 * comes to ask which one to believe.
 */
export interface RationaleAdvisorInput {
  scenarioName: string;
  reasoning: string;
  executionRisk?: 'low' | 'medium' | 'high' | null;
  evidenceRequired?: string[];
  rejectedLevers?: Array<{ lever: string; reason: string }>;
  /**
   * The levers were changed after the card was applied, so the reasoning
   * describes the scenario as the advisor proposed it rather than as modelled.
   */
  adjustedSince?: boolean;
  /**
   * Every option the advisor put forward in the same answer, the applied one
   * marked, with the calculation engine's own figures for each as proposed.
   * A decision is between options, and the brief used to name only one.
   */
  options?: RationaleAdvisorOptionInput[];
  /**
   * What the calculation engine said about the proposal as it measured it:
   * a clamp, a lever it withheld. Engine wording, chosen by the caller.
   */
  cautions?: string[];
}

export interface RationaleAdvisorOptionInput {
  name: string;
  applied: boolean;
  capacity?: number | null;
  purchasePower?: number | null;
  targetPrice?: number | null;
  meetsTarget?: boolean | null;
  shortfall?: number | null;
  executionRisk?: 'low' | 'medium' | 'high' | null;
}

// ── The document ────────────────────────────────────────────────────────────

export interface RationaleKpi {
  label: string;
  value: string;
  foot: string;
  tone: RationaleTone;
}

export interface RationaleBulletLine {
  what: string;
  why: string;
  severity: RationaleSeverity;
  /** `POSITIVE`, `CAUTION`, `CRITICAL`, `INFO` — as the jsPDF generator labels it. */
  severityLabel: string;
  /** `+$120,000 capacity`, or null where the lever moves no capacity. */
  impactLabel: string | null;
  /** `Cash-flow: …`, or null. */
  cashflowLine: string | null;
}

export interface RationaleStepLine {
  step: string;
  action: string;
  detail: string | null;
  /** `FINANCE`, `BROKER`, `CLIENT`. */
  owner: string;
}

export interface RationaleLegLine {
  label: string;
  amount: string;
  servicing: string | null;
  debt: string | null;
  note: string | null;
  unallocated: boolean;
}

export interface RationaleAdvisorSection {
  title: string;
  /** `Scenario: …` */
  scenarioLine: string;
  /** The reasoning, one paragraph per entry. */
  paragraphs: string[];
  /** `Execution risk: MEDIUM`, or null where the advisor gave none. */
  riskLine: string | null;
  risk: 'low' | 'medium' | 'high' | null;
  evidenceTitle: string;
  evidence: string[];
  rejectedTitle: string;
  rejected: string[];
  /** `Options the advisor put forward (3)`, or '' where it offered one. */
  optionsTitle: string;
  options: RationaleAdvisorOption[];
  /** `What the calculation engine flagged`, or '' where it flagged nothing. */
  cautionsTitle: string;
  cautions: string[];
  /** Who wrote this, and — where the levers moved — what it now describes. */
  notes: string[];
}

/** One option as a row of print: every figure already formatted. */
export interface RationaleAdvisorOption {
  name: string;
  applied: boolean;
  /** `$856,932`, or '' where the engine measured none. */
  capacity: string;
  purchasePower: string;
  /** `Clears $900,000`, `Short by $56,107`, or '' where no target was set. */
  target: string;
  /** `LOW`, `MEDIUM`, `HIGH`, or ''. */
  risk: string;
}

export interface StrategyRationaleDocument {
  /** `28 September 2026, 20:15`, formatted by the caller. */
  generatedLabel: string;
  scenarioName: string | null;
  headline: string;
  subHeadline: string | null;
  kpis: RationaleKpi[];
  proposeTitle: string;
  bullets: RationaleBulletLine[];
  /** Printed where there are no bullets. */
  proposeEmpty: string | null;
  reconcileTitle: string;
  reconciliation: string;
  sequenceTitle: string;
  steps: RationaleStepLine[];
  sequenceEmpty: string | null;
  caveatsTitle: string;
  caveats: string[];
  capitalFlow: {
    title: string;
    available: string;
    routed: string;
    residual: string;
    overcommitted: string | null;
    legs: RationaleLegLine[];
    netImpact: string;
  } | null;
  valuations: { title: string; note: string; lines: string[] } | null;
  crossCollat: { title: string; text: string } | null;
  /**
   * How to read the capacity figure beside the purchase-power figure, where
   * the scenario lowers capacity and still reports purchase power. Null
   * otherwise.
   */
  readingNote?: string | null;
  /** The Strategy Advisor's reasoning, where the scenario is one of its cards. */
  advisor?: RationaleAdvisorSection | null;
}

// ── Formatting, as the jsPDF generator formats ─────────────────────────────

/** `1234567` → `1,234,567`, by hand: `toLocaleString` depends on the runtime's ICU build. */
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** `fmtAud` in `StrategyRationalePDF.ts`: whole dollars, `-$` for a negative. */
export function fmtAud(v: number): string {
  const n = Number.isFinite(v) ? v : 0;
  const s = grouped(Math.round(Math.abs(n)));
  return n < 0 ? `-$${s}` : `$${s}`;
}

/** `fmtSigned`: `+$0` for nothing, as the generator prints it. */
export function fmtSigned(v: number): string {
  return v >= 0 ? `+${fmtAud(v)}` : fmtAud(v);
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export const SEVERITY_LABEL: Record<RationaleSeverity, string> = {
  positive: 'POSITIVE',
  caution: 'CAUTION',
  critical: 'CRITICAL',
  info: 'INFO',
};

const BASIS_LABEL: Record<string, string> = {
  avm: 'AVM',
  desktop: 'Desktop val',
  comparable_sales: 'Comp sales',
  manual: 'Manual',
};

export const ADVISOR_SECTION_TITLE = 'Strategy Advisor — why this scenario';
export const ADVISOR_PROVENANCE_NOTE =
  'Written by the Strategy Advisor (AI) for this client\'s position. Every figure elsewhere in this brief is the calculation engine\'s own.';
export const ADVISOR_OPTIONS_NOTE =
  'Each option\'s figures are the calculation engine\'s, for the option as the advisor proposed it.';
export const ADVISOR_CAUTIONS_TITLE = 'What the calculation engine flagged';

/**
 * Borrowing capacity and purchase power answer different questions, and a
 * scenario that releases equity moves them in opposite directions. The brief
 * printed both figures side by side and said nothing about that, so a
 * scenario that lifted purchase power read as a loss.
 */
export const CAPACITY_READING_NOTE =
  'Borrowing capacity is what a lender would lend on this income and these commitments. '
  + 'Purchase power is what could be paid for a property once cash and released equity are added and purchase costs are taken off.';
export const EQUITY_RELEASE_READING_NOTE =
  'Released equity is new debt the lender has to service, so capacity falls while the cash it frees raises purchase power. '
  + 'Judge this scenario by its purchase power against the target.';

/**
 * The note beside the capacity figures, or null. Said where the scenario
 * lowers capacity and purchase power is reported, because that is where the
 * two figures seem to disagree; the equity sentence only where equity is
 * released, because that is the one cause it names.
 */
export function rationaleReadingNote(context: RationaleContextInput): string | null {
  if (!(context.scenarioCapacity < context.baseCapacity) || context.effectivePurchasePower == null) return null;
  const pool = context.crossCollatPool;
  const releases = Boolean(pool && pool.enabled && pool.poolReleaseAmount > 0);
  return [CAPACITY_READING_NOTE, ...(releases ? [EQUITY_RELEASE_READING_NOTE] : [])].join(' ');
}

export const ADVISOR_ADJUSTED_NOTE =
  'The levers were changed after this scenario was applied, so this reasoning describes the scenario as the advisor proposed it; the figures in this brief are for the levers as they now stand.';

/**
 * A paragraph the model wrote, as a line of print: its Markdown emphasis
 * marks removed (the brief is not Markdown) and its whitespace closed up.
 */
function plainParagraph(t: string): string {
  return t
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^\s*(?:[-*•]|#{1,6})\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The reasoning as paragraphs: split on blank lines, never merged or reworded. */
export function advisorParagraphs(reasoning: string): string[] {
  return reasoning
    .split(/\n\s*\n/)
    .map(plainParagraph)
    .filter(Boolean);
}

/**
 * The advisor's part of the brief, or null where there is nothing of its to
 * print. Shared by the typeset brief, the jsPDF brief and the panel's copied
 * text, so the three cannot word it differently.
 */
export function composeAdvisorSection(advisor: RationaleAdvisorInput | null | undefined): RationaleAdvisorSection | null {
  if (!advisor) return null;
  const paragraphs = advisorParagraphs(advisor.reasoning ?? '');
  if (paragraphs.length === 0) return null;
  const risk = advisor.executionRisk === 'low' || advisor.executionRisk === 'medium' || advisor.executionRisk === 'high'
    ? advisor.executionRisk
    : null;
  const evidence = (advisor.evidenceRequired ?? []).map(plainParagraph).filter(Boolean);
  const rejected = (advisor.rejectedLevers ?? [])
    .filter((r) => r && (r.lever || r.reason))
    .map((r) => [plainParagraph(r.lever ?? ''), plainParagraph(r.reason ?? '')].filter(Boolean).join(' — '));
  const options = advisorOptions(advisor.options);
  const cautions = (advisor.cautions ?? []).map(plainParagraph).filter(Boolean);
  return {
    title: ADVISOR_SECTION_TITLE,
    scenarioLine: `Scenario: ${plainParagraph(advisor.scenarioName || '') || 'Suggested scenario'}`,
    paragraphs,
    riskLine: risk ? `Execution risk: ${risk.toUpperCase()}` : null,
    risk,
    evidenceTitle: `Evidence required before submission (${plural(evidence.length, 'item')})`,
    evidence,
    rejectedTitle: `Levers considered and set aside (${plural(rejected.length, 'lever')})`,
    rejected,
    optionsTitle: options.length > 0 ? `Options the advisor put forward (${options.length})` : '',
    options,
    cautionsTitle: cautions.length > 0 ? ADVISOR_CAUTIONS_TITLE : '',
    cautions,
    notes: [ADVISOR_PROVENANCE_NOTE, ...(advisor.adjustedSince ? [ADVISOR_ADJUSTED_NOTE] : [])],
  };
}

/** An option as one line of print, where a table does not fit (a list, copied text). */
export function advisorOptionLine(o: RationaleAdvisorOption): string {
  const figures = [
    o.capacity && `capacity ${o.capacity}`,
    o.purchasePower && `purchase power ${o.purchasePower}`,
    o.target,
    o.risk && `${o.risk} risk`,
  ].filter(Boolean).join(' · ');
  return `${o.name}${o.applied ? ' (applied)' : ''}${figures ? ` — ${figures}` : ''}`;
}

const RISK_WORD: Record<string, string> = { low: 'LOW', medium: 'MEDIUM', high: 'HIGH' };
const money = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? fmtAud(v) : '');

/**
 * The options as rows. Offered only where there was a choice: one option is
 * the scenario itself, and a table of one says nothing the brief does not.
 */
function advisorOptions(input: RationaleAdvisorOptionInput[] | undefined): RationaleAdvisorOption[] {
  const rows = (input ?? [])
    .filter((o) => o && typeof o.name === 'string' && plainParagraph(o.name))
    .map((o) => {
      const target = typeof o.targetPrice === 'number' && o.targetPrice > 0
        ? o.meetsTarget === true
          ? `Clears ${fmtAud(o.targetPrice)}`
          : o.meetsTarget === false && typeof o.shortfall === 'number' && o.shortfall > 0
            ? `Short by ${fmtAud(o.shortfall)}`
            : ''
        : '';
      return {
        name: plainParagraph(o.name),
        applied: o.applied === true,
        capacity: money(o.capacity),
        purchasePower: money(o.purchasePower),
        target,
        risk: RISK_WORD[o.executionRisk ?? ''] ?? '',
      };
    });
  return rows.length >= 2 ? rows : [];
}

/**
 * The document, from the engine's report and the panel's context.
 *
 * Every string is the jsPDF generator's, built the same way from the same
 * fields; `strategyRationale.spec.ts` reads that generator's source and asserts
 * each literal it prints is one this module prints too.
 */
export function composeStrategyRationale(
  report: RationaleReportInput,
  context: RationaleContextInput,
  generatedLabel: string,
): StrategyRationaleDocument {
  const change = context.scenarioCapacity - context.baseCapacity;
  const kpis: RationaleKpi[] = [
    { label: 'Base capacity', value: fmtAud(context.baseCapacity), foot: 'Pre-scenario', tone: 'neutral' },
    {
      label: 'Scenario capacity',
      value: fmtAud(context.scenarioCapacity),
      foot: `${fmtSigned(change)} vs base`,
      tone: change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral',
    },
  ];
  if (context.effectivePurchasePower != null) {
    const target = context.targetPurchasePrice ?? 0;
    let foot = 'Loan + cash − costs';
    if (target > 0) {
      foot = context.meetsTarget ? `Target ${fmtAud(target)} ✓` : `Short of ${fmtAud(target)}`;
    }
    kpis.push({
      label: 'Purchase power',
      value: fmtAud(context.effectivePurchasePower),
      foot,
      tone: context.meetsTarget === false ? 'negative' : 'neutral',
    });
  }

  const bullets: RationaleBulletLine[] = report.bullets.map((b) => ({
    what: b.what,
    why: b.why,
    severity: b.severity,
    severityLabel: SEVERITY_LABEL[b.severity] ?? 'INFO',
    impactLabel: b.capacityImpact !== 0 ? `${fmtSigned(b.capacityImpact)} capacity` : null,
    cashflowLine: b.cashflowNote ? `Cash-flow: ${b.cashflowNote}` : null,
  }));

  const steps: RationaleStepLine[] = report.sequence.map((s) => ({
    step: String(s.step),
    action: s.action,
    detail: s.detail ?? null,
    owner: s.owner.toUpperCase(),
  }));

  const cf = report.capitalFlow;
  const signed = (v: number, suffix: string) =>
    `${v < 0 ? '−' : '+'}${fmtAud(Math.abs(v))}${suffix}`;
  const capitalFlow = cf && cf.legs.length > 0
    ? {
        title: `Capital allocation flow (${plural(cf.legs.length, 'leg')})`,
        available: fmtAud(cf.totalAvailable),
        routed: fmtAud(cf.totalRouted),
        residual: fmtAud(cf.remainder),
        overcommitted: cf.overcommitted ? 'POOL OVERCOMMITTED — sinks were clamped to available pool.' : null,
        legs: cf.legs.map((leg) => ({
          label: `${leg.sourceLabel} → ${leg.sinkLabel}`,
          amount: fmtAud(leg.amount),
          servicing: leg.monthlyServicingDelta !== 0 ? signed(leg.monthlyServicingDelta, '/mo') : null,
          debt: leg.debtBalanceDelta !== 0 ? signed(leg.debtBalanceDelta, ' debt') : null,
          note: leg.note ?? null,
          unallocated: leg.sinkType === 'unallocated',
        })),
        netImpact: `Net capital impact: ${signed(cf.monthlyServicingDelta, '/mo servicing')}  ·  ${signed(cf.debtBalanceDelta, ' debt balance')}`,
      }
    : null;

  const vals = context.valuationAssumptions ?? [];
  const valuations = vals.length > 0
    ? {
        title: `Valuation assumptions (${plural(vals.length, 'override')})`,
        note: 'Finance must validate each basis before submission. AVM/desktop figures are advisory only.',
        lines: vals.map((v) => {
          const delta = v.newValue - v.originalValue;
          return `${v.address}: ${fmtAud(v.originalValue)} → ${fmtAud(v.newValue)} (${fmtSigned(delta)}) — basis: ${BASIS_LABEL[v.basis] ?? 'Manual'}${v.source ? ` · source: ${v.source}` : ''}`;
        }),
      }
    : null;

  const pool = context.crossCollatPool;
  const crossCollat = pool && pool.enabled
    ? {
        title: 'Equity release methodology — cross-collateralised',
        text: (() => {
          const blendedActual = pool.totalPoolValue > 0
            ? ((pool.totalPoolDebt + pool.poolReleaseAmount) / pool.totalPoolValue) * 100
            : 0;
          return `Pool of ${pool.propertyAddresses.length} ${pool.propertyAddresses.length === 1 ? 'security' : 'securities'} (${pool.propertyAddresses.join('; ')}). `
            + `Total pool value: ${fmtAud(pool.totalPoolValue)}. Existing pool debt: ${fmtAud(pool.totalPoolDebt)}. `
            + `Target blended LVR: ${(pool.blendedTargetLVR * 100).toFixed(0)}% (achieved ${blendedActual.toFixed(1)}%). `
            + `Per-security cap: ${(pool.lenderMaxLVR * 100).toFixed(0)}%. Allocation: ${pool.allocationStrategy.replace(/_/g, ' ')}. `
            + `Pool release: ${fmtAud(pool.poolReleaseAmount)}.`;
        })(),
      }
    : null;

  return {
    generatedLabel,
    scenarioName: context.scenarioName ?? null,
    headline: report.headline,
    subHeadline: report.subHeadline ?? null,
    kpis,
    proposeTitle: `What we propose & why (${plural(report.bullets.length, 'lever')})`,
    bullets,
    proposeEmpty: bullets.length === 0 ? 'Baseline scenario — no levers applied.' : null,
    reconcileTitle: 'How the math reconciles',
    reconciliation: report.reconciliation,
    sequenceTitle: `Recommended execution sequence (${plural(report.sequence.length, 'step')})`,
    steps,
    sequenceEmpty: steps.length === 0 ? 'No execution steps required — baseline scenario.' : null,
    caveatsTitle: 'Caveats & assumptions',
    caveats: [...report.caveats],
    capitalFlow,
    valuations,
    crossCollat,
    readingNote: rationaleReadingNote(context),
    advisor: composeAdvisorSection(context.advisor),
  };
}

// ── Reading it back on the server ───────────────────────────────────────────

/** Bounds on what a request may carry. Generous against the engine, tight against abuse. */
export const RATIONALE_LIMITS = {
  shortText: 240,
  longText: 4_000,
  kpis: 3,
  bullets: 40,
  steps: 40,
  caveats: 40,
  legs: 40,
  valuationLines: 40,
  advisorText: 12_000,
  advisorParagraphs: 24,
  evidence: 30,
  rejected: 30,
  options: 6,
  cautions: 12,
} as const;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  return t ? t.slice(0, max) : null;
}

function list<T>(v: unknown, max: number, read: (item: unknown) => T | null): T[] {
  return (Array.isArray(v) ? v : []).slice(0, max).map(read).filter((x): x is T => x !== null);
}

const SEVERITIES: readonly RationaleSeverity[] = ['info', 'positive', 'caution', 'critical'];
const TONES: readonly RationaleTone[] = ['neutral', 'positive', 'negative'];

export type RationaleRead =
  | { ok: true; document: StrategyRationaleDocument }
  | { ok: false; error: string };

/**
 * A request body's brief, kept only where it has the shape the composer makes.
 *
 * Unknown fields are dropped, strings are bounded and stripped of control
 * characters, and a brief with no headline is refused — it is the one line the
 * document cannot open without. Escaping is the renderer's (`escapeHtml` on
 * every string), so nothing here needs to know about markup.
 */
export function readStrategyRationale(raw: unknown): RationaleRead {
  if (!isRec(raw)) return { ok: false, error: 'rationale must be an object' };
  const L = RATIONALE_LIMITS;

  const headline = text(raw.headline, L.longText);
  if (!headline) return { ok: false, error: 'rationale.headline is required' };

  const kpis = list(raw.kpis, L.kpis, (k): RationaleKpi | null => {
    if (!isRec(k)) return null;
    const label = text(k.label, L.shortText);
    const value = text(k.value, L.shortText);
    if (!label || !value) return null;
    return {
      label,
      value,
      foot: text(k.foot, L.shortText) ?? '',
      tone: TONES.includes(k.tone as RationaleTone) ? (k.tone as RationaleTone) : 'neutral',
    };
  });

  const bullets = list(raw.bullets, L.bullets, (b): RationaleBulletLine | null => {
    if (!isRec(b)) return null;
    const what = text(b.what, L.longText);
    if (!what) return null;
    const severity = SEVERITIES.includes(b.severity as RationaleSeverity) ? (b.severity as RationaleSeverity) : 'info';
    return {
      what,
      why: text(b.why, L.longText) ?? '',
      severity,
      severityLabel: SEVERITY_LABEL[severity],
      impactLabel: text(b.impactLabel, L.shortText),
      cashflowLine: text(b.cashflowLine, L.longText),
    };
  });

  const steps = list(raw.steps, L.steps, (s): RationaleStepLine | null => {
    if (!isRec(s)) return null;
    const action = text(s.action, L.longText);
    if (!action) return null;
    return {
      step: text(s.step, 8) ?? '',
      action,
      detail: text(s.detail, L.longText),
      owner: (text(s.owner, 24) ?? '').toUpperCase(),
    };
  });

  const cfRaw = isRec(raw.capitalFlow) ? raw.capitalFlow : null;
  const capitalFlow = cfRaw && text(cfRaw.title, L.shortText)
    ? {
        title: text(cfRaw.title, L.shortText)!,
        available: text(cfRaw.available, L.shortText) ?? '',
        routed: text(cfRaw.routed, L.shortText) ?? '',
        residual: text(cfRaw.residual, L.shortText) ?? '',
        overcommitted: text(cfRaw.overcommitted, L.shortText),
        legs: list(cfRaw.legs, L.legs, (g): RationaleLegLine | null => {
          if (!isRec(g)) return null;
          const label = text(g.label, L.longText);
          if (!label) return null;
          return {
            label,
            amount: text(g.amount, L.shortText) ?? '',
            servicing: text(g.servicing, L.shortText),
            debt: text(g.debt, L.shortText),
            note: text(g.note, L.longText),
            unallocated: g.unallocated === true,
          };
        }),
        netImpact: text(cfRaw.netImpact, L.longText) ?? '',
      }
    : null;

  const valRaw = isRec(raw.valuations) ? raw.valuations : null;
  const valuations = valRaw && text(valRaw.title, L.shortText)
    ? {
        title: text(valRaw.title, L.shortText)!,
        note: text(valRaw.note, L.longText) ?? '',
        lines: list(valRaw.lines, L.valuationLines, (l) => text(l, L.longText)),
      }
    : null;

  const advRaw = isRec(raw.advisor) ? raw.advisor : null;
  const advParagraphs = advRaw ? list(advRaw.paragraphs, L.advisorParagraphs, (t) => text(t, L.advisorText)) : [];
  const advRisk = advRaw && (advRaw.risk === 'low' || advRaw.risk === 'medium' || advRaw.risk === 'high') ? advRaw.risk : null;
  const advisor: RationaleAdvisorSection | null = advRaw && advParagraphs.length > 0
    ? {
        title: text(advRaw.title, L.shortText) ?? ADVISOR_SECTION_TITLE,
        scenarioLine: text(advRaw.scenarioLine, L.shortText) ?? '',
        paragraphs: advParagraphs,
        riskLine: advRisk ? `Execution risk: ${advRisk.toUpperCase()}` : null,
        risk: advRisk,
        evidenceTitle: text(advRaw.evidenceTitle, L.shortText) ?? '',
        evidence: list(advRaw.evidence, L.evidence, (t) => text(t, L.longText)),
        rejectedTitle: text(advRaw.rejectedTitle, L.shortText) ?? '',
        rejected: list(advRaw.rejected, L.rejected, (t) => text(t, L.longText)),
        optionsTitle: text(advRaw.optionsTitle, L.shortText) ?? '',
        options: list(advRaw.options, L.options, (o): RationaleAdvisorOption | null => {
          if (!isRec(o)) return null;
          const name = text(o.name, L.shortText);
          if (!name) return null;
          const risk = typeof o.risk === 'string' && ['LOW', 'MEDIUM', 'HIGH'].includes(o.risk) ? o.risk : '';
          return {
            name,
            applied: o.applied === true,
            capacity: text(o.capacity, L.shortText) ?? '',
            purchasePower: text(o.purchasePower, L.shortText) ?? '',
            target: text(o.target, L.shortText) ?? '',
            risk,
          };
        }),
        cautionsTitle: text(advRaw.cautionsTitle, L.shortText) ?? '',
        cautions: list(advRaw.cautions, L.cautions, (t) => text(t, L.longText)),
        // Always the provenance line, whatever arrived: a brief that quotes a
        // model must say so, and the request cannot talk it out of that.
        notes: [
          ADVISOR_PROVENANCE_NOTE,
          ...list(advRaw.notes, 4, (t) => text(t, L.longText)).filter((n) => n === ADVISOR_ADJUSTED_NOTE),
        ],
      }
    : null;

  const ccRaw = isRec(raw.crossCollat) ? raw.crossCollat : null;
  const crossCollat = ccRaw && text(ccRaw.title, L.shortText) && text(ccRaw.text, L.longText)
    ? { title: text(ccRaw.title, L.shortText)!, text: text(ccRaw.text, L.longText)! }
    : null;

  return {
    ok: true,
    document: {
      generatedLabel: text(raw.generatedLabel, L.shortText) ?? '',
      scenarioName: text(raw.scenarioName, L.shortText),
      headline,
      subHeadline: text(raw.subHeadline, L.longText),
      kpis,
      proposeTitle: text(raw.proposeTitle, L.shortText) ?? 'What we propose & why',
      bullets,
      proposeEmpty: bullets.length === 0 ? text(raw.proposeEmpty, L.shortText) : null,
      reconcileTitle: text(raw.reconcileTitle, L.shortText) ?? 'How the math reconciles',
      reconciliation: text(raw.reconciliation, L.longText) ?? '',
      sequenceTitle: text(raw.sequenceTitle, L.shortText) ?? 'Recommended execution sequence',
      steps,
      sequenceEmpty: steps.length === 0 ? text(raw.sequenceEmpty, L.shortText) : null,
      caveatsTitle: text(raw.caveatsTitle, L.shortText) ?? 'Caveats & assumptions',
      caveats: list(raw.caveats, L.caveats, (c) => text(c, L.longText)),
      capitalFlow,
      valuations,
      crossCollat,
      readingNote: text(raw.readingNote, L.longText),
      advisor,
    },
  };
}

/**
 * The filename, as the jsPDF generator has always named it:
 * `Strategy_Rationale_<Name>_<yyyy-MM-dd>.pdf`, runs of anything but letters,
 * digits, `_` and `-` collapsed to one `_`.
 */
export function strategyRationaleFileName(clientName: string, isoDate: string): string {
  const safe = (clientName || 'Client').replace(/[^a-zA-Z0-9_-]+/g, '_');
  const date = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? '';
  return `Strategy_Rationale_${safe}_${date}.pdf`;
}
