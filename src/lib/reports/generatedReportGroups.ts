import type { InvestmentReport } from '@/components/reports/library/types';
import { resolveReportAddress } from './reportAddress';
import { getReportPackageKey, normalizeReportVariant, REPORT_VARIANT_ORDER } from './reportVariants';

export interface GeneratedReportGroup {
  groupId: string;
  propertyId: string | null;
  propertyAddress: string;
  latestGeneratedAt: string | null;
  latestStatus: string;
  isArchived: boolean;
  isPartiallyArchived: boolean;
  reportCount: number;
  reportTypes: readonly string[];
  reports: InvestmentReport[];
  latestReport: InvestmentReport | null;
  generatedBy: string | null;
  version: number | null;
}

const timestamp = (value?: string | null) => {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : 0;
};

/** Canonical, defensive package selector shared by the cards and table. */
export function buildGeneratedReportGroups(reports: readonly InvestmentReport[]): GeneratedReportGroup[] {
  const packages = new Map<string, InvestmentReport[]>();
  for (const report of reports) {
    if (!report || typeof report.id !== 'string') continue;
    const safeReport = { ...report, property_address: resolveReportAddress(report) };
    const key = getReportPackageKey(safeReport);
    packages.set(key, [...(packages.get(key) || []), safeReport]);
  }
  return [...packages.entries()].map(([groupId, packageReports]) => {
    const ordered = [...packageReports].sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at));
    const latest = ordered[0] || null;
    const archivedCount = ordered.filter(report => report.is_archived === true).length;
    return {
      groupId,
      propertyId: latest?.property_listing_id || null,
      propertyAddress: latest?.property_address || 'Address unavailable',
      latestGeneratedAt: latest?.created_at || null,
      latestStatus: latest?.status || 'Unknown',
      isArchived: ordered.length > 0 && archivedCount === ordered.length,
      isPartiallyArchived: archivedCount > 0 && archivedCount < ordered.length,
      reportCount: ordered.length,
      reportTypes: REPORT_VARIANT_ORDER.filter(type => ordered.some(report => normalizeReportVariant(report) === type)),
      reports: ordered,
      latestReport: latest,
      generatedBy: latest?.generated_by || null,
      version: latest?.current_version || null,
    };
  }).sort((a, b) => timestamp(b.latestGeneratedAt) - timestamp(a.latestGeneratedAt));
}
