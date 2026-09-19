/** The canonical client-facing report type system shared by report library and workspaces. */
import { Calculator, Compass, FileText, Target, Zap, type LucideIcon } from 'lucide-react';

export const REPORT_VARIANT_ORDER = ['compass', 'financial', 'strategic', 'snapshot', 'briefing'] as const;
export type ReportVariant = typeof REPORT_VARIANT_ORDER[number];
export type ReportType = ReportVariant | 'other';
export const CLIENT_REPORT_VARIANTS = ['financial', 'strategic', 'briefing', 'snapshot'] as const;
export type ClientReportVariant = typeof CLIENT_REPORT_VARIANTS[number];

export type ReportVariantSource = {
  report_variant?: unknown; report_subtype?: unknown; variant?: unknown; report_type?: unknown; report_tier?: unknown;
  template_id?: unknown; template_identifier?: unknown; template?: unknown; generation_job?: unknown;
  generation_job_variant?: unknown; generation_mode?: unknown; engine?: unknown; generation_engine?: unknown;
  metadata?: unknown; report_metadata?: unknown; legacy_report_code?: unknown; report_code?: unknown; title?: unknown; report_title?: unknown;
};

export const REPORT_TYPE_CONFIG: Record<ReportType, { label: string; icon: LucideIcon; order: number; className: string; }> = {
  // Each variant owns one slot of the categorical chart ramp. ReportVariantControls
  // renders the same pathways with the same accents, so a variant looks the same
  // wherever it appears.
  compass: { label: 'Compass', icon: Compass, order: 0, className: 'border-chart-5/45 bg-chart-5/15 text-foreground hover:bg-chart-5/25 focus-visible:ring-chart-5' },
  financial: { label: 'Financial', icon: Calculator, order: 1, className: 'border-chart-3/45 bg-chart-3/15 text-foreground hover:bg-chart-3/25 focus-visible:ring-chart-3' },
  strategic: { label: 'Strategic', icon: Target, order: 2, className: 'border-chart-1/45 bg-chart-1/15 text-foreground hover:bg-chart-1/25 focus-visible:ring-chart-1' },
  snapshot: { label: 'Snapshot', icon: Zap, order: 3, className: 'border-chart-8/45 bg-chart-8/15 text-foreground hover:bg-chart-8/25 focus-visible:ring-chart-8' },
  briefing: { label: 'Briefing', icon: FileText, order: 4, className: 'border-chart-7/45 bg-chart-7/15 text-foreground hover:bg-chart-7/25 focus-visible:ring-chart-7' },
  other: { label: 'Other', icon: FileText, order: 99, className: 'border-border bg-muted/50 text-muted-foreground hover:bg-muted focus-visible:ring-ring' },
};

const aliases: Record<string, ReportVariant> = {
  compass: 'compass', composite: 'compass', base: 'compass', investment: 'compass', investment_report: 'compass', primary: 'compass', full: 'compass',
  financial: 'financial', finance: 'financial', fin: 'financial', financial_report: 'financial',
  strategic: 'strategic', strategy: 'strategic', pldd: 'strategic', property_level_due_diligence: 'strategic', due_diligence: 'strategic',
  briefing: 'briefing', brief: 'briefing', brf: 'briefing', client_briefing: 'briefing',
  snapshot: 'snapshot', snap: 'snapshot', snp: 'snapshot', overview: 'snapshot', quick_snapshot: 'snapshot',
};

export const REPORT_VARIANT_LABELS: Record<ReportVariant, string> = Object.fromEntries(REPORT_VARIANT_ORDER.map(type => [type, REPORT_TYPE_CONFIG[type].label])) as Record<ReportVariant, string>;
export function normalizeReportType(value: unknown): ReportVariant | undefined { if (typeof value !== 'string') return undefined; return aliases[value.trim().toLowerCase().replace(/[\s-]+/g, '_')]; }
/** Comparison identity comes from persisted `report_tier`, never a display title. */
export function normalizeComparableReportType(report?: Pick<ReportVariantSource, 'report_tier'> | string | null): ReportVariant | undefined {
  return normalizeReportType(typeof report === 'string' ? report : report?.report_tier);
}
export function isClientReportVariant(value: unknown): value is ClientReportVariant { return typeof value === 'string' && (CLIENT_REPORT_VARIANTS as readonly string[]).includes(value); }
function metadataCandidates(value: unknown): unknown[] { if (!value || typeof value !== 'object' || Array.isArray(value)) return []; const metadata = value as Record<string, unknown>; return [metadata.report_variant, metadata.report_subtype, metadata.variant, metadata.reportType, metadata.reportSubtype, metadata.tier, metadata.report_type, metadata.report_tier, metadata.report_code, metadata.template_type, metadata.template_id, metadata.generation_mode]; }
function findSpecific(candidates: unknown[]): ReportVariant | undefined { for (const candidate of candidates) { const variant = normalizeReportType(candidate); if (variant && variant !== 'compass') return variant; } return undefined; }
function hasKnownBase(candidates: unknown[]): boolean { return candidates.some((candidate) => normalizeReportType(candidate) === 'compass'); }
/** Resolves canonical type without letting an engine parent mask a child variant. */
export function resolveInvestmentReportType(report?: ReportVariantSource | string | null): ReportVariant | undefined {
  if (typeof report === 'string') return normalizeReportType(report); if (report == null) return undefined;
  const metadata = [...metadataCandidates(report.metadata), ...metadataCandidates(report.report_metadata), ...metadataCandidates(report.generation_job)];
  const specific = [report.report_variant, report.report_subtype, report.variant, ...metadata, report.report_tier, report.legacy_report_code, report.report_code, report.template_id, report.template_identifier, report.template, report.generation_job_variant, report.generation_mode];
  const specificMatch = findSpecific(specific); if (specificMatch) return specificMatch;
  const title = [report.report_title, report.title].filter((value): value is string => typeof value === 'string').join(' ').toLowerCase();
  if (/\b(financial|finance|fin)\b/.test(title)) return 'financial'; if (/\b(strategic|strategy|pldd|due diligence)\b/.test(title)) return 'strategic'; if (/\b(briefing|brief|client briefing)\b/.test(title)) return 'briefing'; if (/\b(snapshot|quick snapshot|overview)\b/.test(title)) return 'snapshot';
  const base = [report.report_type, report.engine, report.generation_engine, report.report_variant, ...metadata, report.report_tier]; if (hasKnownBase(base)) return 'compass';
  const hasIdentifier = [...specific, ...base].some((value) => typeof value === 'string' && value.trim().length > 0); return hasIdentifier ? undefined : 'compass';
}
export function getCanonicalReportType(report?: ReportVariantSource | string | null): ReportType { return resolveInvestmentReportType(report) || 'other'; }
/** Compatibility helper for legacy callers that treat missing type as Compass. */
export function normalizeReportVariant(report?: ReportVariantSource | string | null): ReportVariant { return resolveInvestmentReportType(report) || 'compass'; }
export function getReportVariantLabel(report?: ReportVariantSource | string | null): string { return REPORT_TYPE_CONFIG[getCanonicalReportType(report)].label; }
/**
 * Uses the identity resolved and persisted by the database. Lineage deliberately
 * never forms a package key: it describes how a report was created, not the
 * physical property it belongs to. The address branch is a compatibility
 * fallback for rows returned by an older API during a rolling deployment.
 */
export function getReportPackageKey(report: {
  canonical_property_key?: string | null;
  property_listing_id?: string | null;
  client_property_id?: string | null;
  property_address: string;
}): string {
  if (report.canonical_property_key?.trim()) return report.canonical_property_key.trim();
  if (report.property_listing_id?.trim()) return `listing:${report.property_listing_id.trim()}`;
  if (report.client_property_id?.trim()) return `client:${report.client_property_id.trim()}`;
  return `address:${report.property_address.toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').trim()}`;
}
