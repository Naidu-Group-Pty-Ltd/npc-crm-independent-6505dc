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
          return `Pool of ${pool.propertyAddresses.length} security${pool.propertyAddresses.length === 1 ? '' : 'ies'} (${pool.propertyAddresses.join('; ')}). `
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
