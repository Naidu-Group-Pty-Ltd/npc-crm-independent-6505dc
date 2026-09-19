/**
 * The Compass family — one parent, its sub-reports, and the three questions
 * every surface kept answering differently:
 *
 *   1. **Which engine produces this variant?** Two engines answered to
 *      "Financial" (audit F9): `ReportVariantControls` forked it
 *      (deterministic) while `TierSwitcher` condensed it (a model) — and the
 *      two used DIFFERENT linkage columns with different idempotency keys,
 *      so neither could see the other's child. One parent could hold two
 *      contradictory "Financial" documents. `engineForVariant` is the one
 *      mapping now: fork for financial/strategic (a deterministic split of
 *      the parent), condense for briefing/snapshot (a model summarisation),
 *      imported by both switchers and enforced by the engines themselves.
 *
 *   2. **Who belongs to this family?** History wrote the parent link in two
 *      columns — fork children carry `derived_from_report_id`, condense
 *      children carry `parent_report_id` — so the family is the union over
 *      BOTH, resolved here. New rows write both columns; historic rows are
 *      found either way.
 *
 *   3. **Is this child still true?** (audit F10) A sub-report is a
 *      projection of its parent at a moment in time, and nothing compared
 *      the two moments — children went stale silently whenever the parent
 *      regenerated or its overrides recalculated. Staleness is DERIVED at
 *      read, never stored (nothing has to remember to close it): a child is
 *      stale when the parent moved after the child was generated.
 */

export type SubReportVariant = 'financial' | 'strategic' | 'briefing' | 'snapshot';

export const SUB_REPORT_VARIANTS: readonly SubReportVariant[] = [
  'financial', 'strategic', 'briefing', 'snapshot',
];

export type SubReportEngine = 'fork-investment-report' | 'condense-investment-report';

/**
 * The one answer to "which engine produces this variant".
 *
 * Financial and Strategic are deterministic SPLITS of the parent document —
 * the same words, re-arranged by the split registry, no model call — so a
 * regeneration is free and cannot drift from the parent. Briefing and
 * Snapshot are model SUMMARISATIONS. A variant produced by the wrong engine
 * is a different document under the same name.
 */
export const ENGINE_FOR_VARIANT: Record<SubReportVariant, SubReportEngine> = {
  financial: 'fork-investment-report',
  strategic: 'fork-investment-report',
  briefing: 'condense-investment-report',
  snapshot: 'condense-investment-report',
};

export function engineForVariant(variant: unknown): SubReportEngine | null {
  return typeof variant === 'string' && variant in ENGINE_FOR_VARIANT
    ? ENGINE_FOR_VARIANT[variant as SubReportVariant]
    : null;
}

/** The minimal vocabulary a family read needs — a subset of the client's alias map. */
const VARIANT_ALIASES: Record<string, SubReportVariant | 'compass'> = {
  compass: 'compass', composite: 'compass', base: 'compass', investment: 'compass',
  financial: 'financial', finance: 'financial', fin: 'financial',
  strategic: 'strategic', strategy: 'strategic', pldd: 'strategic', due_diligence: 'strategic',
  briefing: 'briefing', brief: 'briefing',
  snapshot: 'snapshot', snap: 'snapshot',
};

export function normaliseFamilyVariant(value: unknown): SubReportVariant | 'compass' | null {
  if (typeof value !== 'string') return null;
  return VARIANT_ALIASES[value.trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? null;
}

export interface FamilyRowLike {
  id?: unknown;
  status?: unknown;
  report_variant?: unknown;
  report_tier?: unknown;
  parent_report_id?: unknown;
  derived_from_report_id?: unknown;
  variant_generated_at?: unknown;
  updated_at?: unknown;
  created_at?: unknown;
  [key: string]: unknown;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function rowVariant(row: FamilyRowLike): SubReportVariant | 'compass' | null {
  return normaliseFamilyVariant(row.report_variant) ?? normaliseFamilyVariant(row.report_tier);
}

export function isBaseReport(row: FamilyRowLike): boolean {
  return rowVariant(row) === 'compass';
}

/** The parent this row derives from, whichever column history wrote it in. */
export function familyParentId(row: FamilyRowLike): string | null {
  return str(row.derived_from_report_id) ?? str(row.parent_report_id);
}

export interface ChildStaleness {
  stale: boolean;
  /** When the parent last changed, when known. */
  parentChangedAt: string | null;
  /** The child's generation stamp the comparison used, when known. */
  childGeneratedAt: string | null;
}

const parseTime = (v: unknown): number | null => {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

/**
 * A child is stale when the parent moved after the child was generated.
 *
 * The child's stamp is `variant_generated_at` (both engines write it now);
 * older condense children fall back to their own `updated_at`, then
 * `created_at`. The parent's `updated_at` moves on regeneration AND on an
 * overrides recalculation — both change the numbers a child carries, so both
 * are staleness by intent. Missing stamps answer NOT stale: an unverifiable
 * warning cried on every historic row teaches people to ignore the real one.
 */
export function childStaleness(parent: FamilyRowLike | null, child: FamilyRowLike): ChildStaleness {
  const parentAt = parseTime(parent?.updated_at) ?? parseTime(parent?.created_at);
  const childAt = parseTime(child.variant_generated_at)
    ?? parseTime(child.updated_at)
    ?? parseTime(child.created_at);
  if (parentAt === null || childAt === null) {
    return { stale: false, parentChangedAt: str(parent?.updated_at), childGeneratedAt: null };
  }
  return {
    stale: parentAt > childAt,
    parentChangedAt: str(parent?.updated_at) ?? str(parent?.created_at),
    childGeneratedAt: str(child.variant_generated_at) ?? str(child.updated_at) ?? str(child.created_at),
  };
}

const VARIANT_ORDER: Record<string, number> = {
  financial: 1, strategic: 2, snapshot: 3, briefing: 4,
};

export interface FamilyChild extends ChildStaleness {
  id: string;
  variant: SubReportVariant | null;
  status: string | null;
  row: FamilyRowLike;
}

export interface ReportFamily {
  /** The Compass base's id, when it could be established. */
  parentId: string | null;
  parent: FamilyRowLike | null;
  children: FamilyChild[];
  /** Children whose parent has moved since they were generated. */
  staleChildren: FamilyChild[];
}

/**
 * Shape a bag of rows (the anchor, its parent, everything linked by either
 * column) into one family. Rows that belong to some other family — a
 * mis-swept sibling — are excluded by linkage, and duplicates collapse by id.
 */
export function shapeFamily(anchorId: string, rows: FamilyRowLike[]): ReportFamily {
  const byId = new Map<string, FamilyRowLike>();
  for (const row of rows) {
    const id = str(row.id);
    if (id && !byId.has(id)) byId.set(id, row);
  }

  const anchor = byId.get(anchorId) ?? null;
  const parentId = anchor
    ? (isBaseReport(anchor) ? anchorId : familyParentId(anchor))
    : null;
  const parent = parentId ? byId.get(parentId) ?? null : null;

  const children: FamilyChild[] = [];
  for (const row of byId.values()) {
    const id = str(row.id);
    if (!id || id === parentId) continue;
    // No resolvable parent means no resolvable family: an orphaned child is
    // shown alone rather than presented as a family of itself.
    if (!parentId || familyParentId(row) !== parentId) continue;
    const variant = rowVariant(row);
    children.push({
      id,
      variant: variant === 'compass' ? null : variant,
      status: str(row.status),
      row,
      ...childStaleness(parent, row),
    });
  }
  children.sort((a, b) => (VARIANT_ORDER[a.variant ?? ''] ?? 99) - (VARIANT_ORDER[b.variant ?? ''] ?? 99));

  return {
    parentId,
    parent,
    children,
    staleChildren: children.filter((c) => c.stale && c.status === 'completed'),
  };
}
