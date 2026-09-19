/**
 * ME-5 — the Historical Fact Authority.
 *
 * One place that answers "what is this report's purchase price, and how do we
 * know?" — with the value, its source, whether it was observed or derived, and
 * what it superseded. Nothing downstream picks a path silently.
 *
 * ## What the conflict audit found, and why it changes the precedence
 *
 * ME-4 read `financial_calculations` alone and reported purchase price on 203
 * of 1,204 reports. That was true of the column and wrong about the record:
 * **431 reports carry a purchase price in `manual_overrides`**, giving 493
 * between them — 2.4× the coverage, from data already stored.
 *
 * The obvious worry is that an "override" is a competing opinion. Measured, it
 * is not:
 *
 * | field | both present | exact agreement | material disagreement |
 * | --- | ---: | ---: | ---: |
 * | purchase price | 140 | **140** | 0 |
 * | weekly rent | 150 | **150** | 0 |
 * | LVR | 153 | **153** | 0 |
 *
 * Zero disagreements, maximum difference zero. That is not two sources
 * agreeing — it is **one fact at two stages of one pipeline**, and the code
 * says so: `manage-investment-reports` runs
 * `buildCalculatorInput(manual_overrides, existing)` into
 * `financial-calculator-service`, and the answer becomes
 * `financial_calculations`.
 *
 * So `manual_overrides` is neither "the operator overruling a source" nor
 * "another editable field". It is **the calculator's input record** — the
 * operator's stated parameters — and `financial_calculations` is its
 * derivative. That makes the override the OBSERVED value and the financial
 * block the DERIVED one, which is the reverse of what the name suggests and
 * the reason this module exists rather than a one-line `??`.
 *
 * It also explains the 228 reports holding an override with no financial
 * block: the same handler records `financialsRecalcSkipped` for
 * `display_only_overrides`, `inputs_unresolved` and `recalc_failed`, **and
 * lets the save proceed**. The operator's parameters are real; the
 * calculation simply never completed.
 *
 * ## Two rules
 *
 * **Precedence is per field, never universal.** Purchase price is observed in
 * the override and derived in the financial block; a cash-flow figure exists
 * only as a calculator output and has no operator-stated counterpart. One
 * global ordering would be wrong for one of them.
 *
 * **A superseded value is kept, never erased.** Where two stages disagree the
 * resolution records both, so a reader can see what was set aside and why. The
 * corpus currently has no such case, and the field exists so that the first one
 * is visible rather than silently resolved.
 *
 * **No model-written narrative is ever a source.** The report prose is not
 * consulted here at any precedence. `DERIVED_FIGURES.md` records what reading
 * figures out of generated text costs.
 */

/** How a value came to be known. */
export type FactProvenanceKind =
  | 'observed'      // stated by an operator or read from a structured source
  | 'derived'       // computed by the platform from observed inputs
  | 'unavailable';

/** The stores a historical fact can come from, strongest first per field. */
export type FactSource =
  | 'manual_overrides'
  | 'financial_calculations'
  | 'property_specs'
  | 'report_geography'
  | 'none';

export interface ResolvedFact<T> {
  field: string;
  value: T | null;
  source: FactSource;
  /** The exact path read, so a backtest is auditable to the byte. */
  sourcePath: string | null;
  kind: FactProvenanceKind;
  /** How the value was produced, when derived. */
  derivation: string | null;
  /** A value from a lower-precedence source that disagreed. Never erased. */
  supersededValue: T | null;
  supersededSource: FactSource | null;
  /** Why this resolution is what it is, in one sentence. */
  note: string;
}

/** Per-field precedence, with the reason it differs from the others. */
export interface FieldAuthority {
  field: string;
  /** Candidate paths, strongest first. */
  order: ReadonlyArray<{ source: FactSource; path: string; kind: FactProvenanceKind }>;
  rationale: string;
}

/**
 * The precedence table.
 *
 * Deliberately not one ordering for everything: the audit showed the override
 * is the calculator's INPUT for the parameters an operator states, while
 * figures the calculator alone produces have no operator-stated form at all.
 */
export const FIELD_AUTHORITY: ReadonlyArray<FieldAuthority> = [
  {
    field: 'purchasePrice',
    order: [
      { source: 'manual_overrides', path: 'manual_overrides.purchasePrice', kind: 'observed' },
      { source: 'financial_calculations', path: 'financial_calculations.initialCosts.propertyValue', kind: 'derived' },
    ],
    rationale:
      'The override is the operator-stated parameter the calculator was run on; the financial block '
      + 'is its output. Measured 140 of 140 exact agreement where both exist.',
  },
  {
    field: 'weeklyRent',
    order: [
      { source: 'manual_overrides', path: 'manual_overrides.weeklyRent', kind: 'observed' },
      { source: 'financial_calculations', path: 'financial_calculations.income.weeklyRent', kind: 'derived' },
    ],
    rationale: 'Same pipeline. Measured 150 of 150 exact agreement.',
  },
  {
    field: 'lvr',
    order: [
      { source: 'manual_overrides', path: 'manual_overrides.loanToValueRatio', kind: 'observed' },
      { source: 'financial_calculations', path: 'financial_calculations.keyMetrics.lvr', kind: 'derived' },
    ],
    rationale: 'Same pipeline. Measured 153 of 153 exact agreement.',
  },
  {
    field: 'weeklyCashFlow',
    order: [
      { source: 'financial_calculations', path: 'financial_calculations.keyMetrics.weeklyNet', kind: 'derived' },
    ],
    rationale:
      'A calculator OUTPUT with no operator-stated counterpart — it is computed from rent, costs and '
      + 'the loan. There is deliberately no override path: this is why precedence is per field.',
  },
  {
    field: 'annualOutgoings',
    order: [
      { source: 'financial_calculations', path: 'financial_calculations.annualCosts.totalAnnualExcludingLandTax', kind: 'derived' },
      { source: 'financial_calculations', path: 'financial_calculations.annualCosts.total', kind: 'derived' },
    ],
    rationale:
      'A total the calculator assembles from the individual cost overrides. The operator states the '
      + 'parts (council rates, management fees, insurance); the total is derived from them.',
  },
  {
    field: 'dwellingType',
    order: [
      { source: 'property_specs', path: 'property_specs.property_type', kind: 'observed' },
    ],
    rationale:
      'Stored snake_case. The live scorer reads camelCase `propertyType` and therefore has never '
      + 'read it at all. Placeholder values ("Residential Property", "Other") resolve to unavailable '
      + 'rather than to a default.',
  },
  {
    field: 'suburb',
    order: [
      { source: 'report_geography', path: 'report_geography.suburb', kind: 'derived' },
    ],
    rationale:
      'Derived by ABS point-in-polygon from the report’s own coordinate, which remains the source '
      + 'fact. The free-text address is never a source: ADDRESS_COMPOSITION.md records why, and 183 '
      + 'reports prove it by having been geocoded to London, Lisbon and Washington State.',
  },
];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function at(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of path.split('.').slice(1)) {   // first segment names the store
    if (!isObj(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Placeholders that must resolve to unavailable rather than to a value. */
const PLACEHOLDER_TYPES = /^(residential property|other|unknown|n\/a)$/i;

function coerce(field: string, raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (field === 'dwellingType') {
    if (typeof raw !== 'string' || !raw.trim() || PLACEHOLDER_TYPES.test(raw.trim())) return null;
    return raw.trim();
  }
  if (field === 'suburb') return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** Everything a resolution may read. Nothing else is consulted. */
export interface FactStores {
  manual_overrides?: unknown;
  financial_calculations?: unknown;
  property_specs?: unknown;
  report_geography?: unknown;
}

/**
 * Resolve one field to a value with its provenance.
 *
 * Walks the field's own precedence, takes the first store that yields a usable
 * value, and records any lower-precedence value that DISAGREES as superseded.
 * A lower value that agrees is not noise worth carrying.
 */
export function resolveFact<T = number>(
  field: string,
  stores: FactStores,
): ResolvedFact<T> {
  const authority = FIELD_AUTHORITY.find((a) => a.field === field);
  if (!authority) {
    return {
      field, value: null, source: 'none', sourcePath: null, kind: 'unavailable',
      derivation: null, supersededValue: null, supersededSource: null,
      note: `No authority is declared for "${field}", so no value is resolved. Adding a field is a `
        + 'change to FIELD_AUTHORITY, never a read at a call site.',
    };
  }

  const found: Array<{ source: FactSource; path: string; kind: FactProvenanceKind; value: unknown }> = [];
  for (const step of authority.order) {
    const store = (stores as Record<string, unknown>)[step.source];
    const value = coerce(field, at(store, step.path));
    if (value !== null) found.push({ ...step, value });
  }

  if (found.length === 0) {
    return {
      field, value: null, source: 'none', sourcePath: null, kind: 'unavailable',
      derivation: null, supersededValue: null, supersededSource: null,
      note: `No store carries ${field}. Absent, not zero.`,
    };
  }

  const [winner, ...rest] = found;
  const disagreeing = rest.find((r) => r.value !== winner.value);

  return {
    field,
    value: winner.value as T,
    source: winner.source,
    sourcePath: winner.path,
    kind: winner.kind,
    derivation: winner.kind === 'derived'
      ? `Computed by the platform and read from ${winner.path}.`
      : null,
    supersededValue: (disagreeing?.value ?? null) as T | null,
    supersededSource: disagreeing?.source ?? null,
    note: disagreeing
      ? `Resolved from ${winner.source}; ${disagreeing.source} held a different value, kept as `
        + 'superseded rather than discarded.'
      : `Resolved from ${winner.source}.`
      + (rest.length ? ` ${rest.length} lower-precedence source(s) agreed.` : ''),
  };
}

/** Resolve every declared field for one report. */
export function resolveAllFacts(stores: FactStores): Record<string, ResolvedFact<unknown>> {
  const out: Record<string, ResolvedFact<unknown>> = {};
  for (const a of FIELD_AUTHORITY) out[a.field] = resolveFact(a.field, stores);
  return out;
}
