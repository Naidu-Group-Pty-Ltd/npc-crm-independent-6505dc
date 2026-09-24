/**
 * What reports exist for a client, and which of them can be put on the portal.
 *
 * A client's finished work is scattered across five tables — `client_files`
 * (client-detail forms and property reports), `investment_reports`,
 * `portfolio_analysis_reports`, `borrowing_capacity_assessments` and
 * `client_portal_reports` — and the Reports tab already merged all five into
 * one list. This module is that merge, lifted out so the Sent Reports tab can
 * offer the same set without building a second one beside it. Two lists of the
 * same reports is how one comes to be missing a source nobody noticed.
 *
 * It also answers the question the picker exists to ask: **can this report be
 * put in front of the client right now?** That is not the same as "is it
 * finished". Three different answers are possible and each needs saying:
 *
 *   • `ready`      — a file is stored and the portal can be pointed at it.
 *   • `on_publish` — nothing is stored, but publishing renders one. This is
 *                    the borrowing capacity assessment, which has no PDF until
 *                    somebody asks for one.
 *   • `unavailable`— there is nothing to publish and nothing that would make
 *                    one: a report still generating, one that failed, or a
 *                    reference that points at a host this deployment cannot
 *                    sign. Offering it would produce the "No PDF available to
 *                    send" dead end that the row action gives today.
 *
 * The rule that matters most here is the LAST one. A stored reference is not
 * automatically a file the portal can serve: `storageRef.ts` records four
 * different shapes these columns have been written in over the years, two of
 * them absolute URLs, and one of those pointing at a `/object/public/` route
 * on a bucket that is private. Publishing such a reference produces a portal
 * row that looks healthy in every list and fails on the client's click. So the
 * reference is parsed BEFORE it is offered, and one that cannot be resolved is
 * declared unavailable rather than published and discovered later.
 *
 * A sixth source, Commercial & Industrial Capacity Reports, came later and
 * arrives differently: its ledgers admit the service role only, so it is read
 * through `manage-ci-assessments` (`client_documents`), which hands back the
 * documents drawn FOR this client from both of the format's render routes. Its
 * files download through that function too — never through `secure-storage`,
 * which holds no binding for them — so it carries no `fileUrl`, and it is not
 * offered for the portal (see `publishVerdict`).
 */

import { parseStorageRef, isExternalUrl } from './storageRef';
import type { ListedDocument } from '../ciAssessment/issuedDocuments';

export type ClientReportKind =
  | 'formara'
  | 'portfolio'
  | 'property'
  | 'investment'
  | 'borrowing'
  | 'published'
  | 'commercial';

export type ClientReportSource =
  | 'file'
  | 'investment_report'
  | 'portfolio_report'
  | 'borrowing_assessment'
  | 'portal_report'
  | 'ci_document';

export interface UnifiedReport {
  id: string;
  type: ClientReportKind;
  name: string;
  generatedAt: string;
  status: 'completed' | 'pending' | 'failed';
  fileUrl?: string | null;
  propertyAddress?: string;
  source: ClientReportSource;
  healthScore?: number | null;
  overallHealth?: string | null;
  portfolioValue?: number | null;
  /** A Commercial & Industrial document: what its download asks the server for. */
  ciDocument?: ListedDocument;
}

export interface InventorySources {
  reportFiles: any[];
  investmentReports: any[];
  portfolioReports: any[];
  bcAssessments: any[];
  portalReports: any[];
  /** Commercial & Industrial documents drawn for this client. Optional: a workspace without the module has none. */
  ciDocuments?: ListedDocument[];
}

/** `dd MMM yyyy`, the shape the Reports tab has always used for a portfolio row. */
export type DateFormatter = (iso: string) => string;

/**
 * The five sources, merged. Lifted verbatim from `ClientReportsTab`'s own
 * `useMemo` so the list it draws does not change.
 */
export function buildClientReportInventory(
  sources: InventorySources,
  formatDate: DateFormatter,
): UnifiedReport[] {
  const { reportFiles, investmentReports, portfolioReports, bcAssessments, portalReports } = sources;
  const reports: UnifiedReport[] = [];

  reportFiles
    .filter((f: any) => f.is_formara_form)
    .forEach((f: any) => {
      reports.push({
        id: f.id,
        type: 'formara',
        name: f.file_name || 'Client Detail Form',
        generatedAt: f.uploaded_at,
        status: 'completed',
        fileUrl: f.file_path,
        source: 'file',
      });
    });

  reportFiles
    .filter((f: any) => f.report_type && !f.is_formara_form && f.report_type !== 'portfolio')
    .forEach((f: any) => {
      reports.push({
        id: f.id,
        type: f.report_type as 'property' | 'investment',
        name: f.file_name || `${f.report_type} Report`,
        generatedAt: f.uploaded_at,
        status: 'completed',
        fileUrl: f.file_path,
        propertyAddress: f.description,
        source: 'file',
      });
    });

  investmentReports.forEach((r: any) => {
    reports.push({
      id: r.id,
      type: 'investment',
      name: `Investment Report - ${r.property_address}`,
      generatedAt: r.created_at,
      status: (r.status === 'completed' ? 'completed' : r.status === 'failed' ? 'failed' : 'pending') as any,
      fileUrl: r.pdf_url || null,
      propertyAddress: r.property_address,
      source: 'investment_report',
    });
  });

  portfolioReports.forEach((r: any) => {
    reports.push({
      id: r.id,
      type: 'portfolio',
      name: `Portfolio Analysis - ${formatDate(r.created_at)}`,
      generatedAt: r.created_at,
      status: 'completed',
      fileUrl: r.pdf_file_path,
      source: 'portfolio_report',
      healthScore: r.health_score,
      overallHealth: r.overall_health,
      portfolioValue: r.portfolio_value,
    });
  });

  bcAssessments.forEach((r: any) => {
    const formattedCap = r.borrowing_capacity
      ? `$${Number(r.borrowing_capacity).toLocaleString('en-AU', { maximumFractionDigits: 0 })}`
      : '';
    reports.push({
      id: r.id,
      type: 'borrowing',
      name: `Borrowing Capacity${formattedCap ? ` – ${formattedCap}` : ''}${r.serviceability_band ? ` (${r.serviceability_band})` : ''}`,
      generatedAt: r.created_at,
      status: 'completed',
      source: 'borrowing_assessment',
    });
  });

  portalReports.forEach((r: any) => {
    reports.push({
      id: `portal-${r.id}`,
      type: 'published',
      name: r.report_title || 'Published Report',
      generatedAt: r.published_at || r.created_at,
      status: 'completed',
      fileUrl: r.storage_path,
      source: 'portal_report',
    });
  });

  // Last, and defaulted: the five sources above keep their order.
  (sources.ciDocuments ?? []).forEach((doc) => {
    reports.push({
      // Two ledgers, each with its own ids: the ledger is part of the identity.
      id: `ci-${doc.ledger}-${doc.id}`,
      type: 'commercial',
      name: `Commercial & Industrial Capacity – ${doc.assessmentTitle}`,
      generatedAt: doc.createdAt,
      status: doc.state === 'ready' ? 'completed' : doc.state === 'in_progress' ? 'pending' : 'failed',
      fileUrl: null,
      source: 'ci_document',
      ciDocument: doc,
    });
  });

  return reports;
}

/** How a generated report maps onto `client_portal_reports.report_type`. */
export const PORTAL_REPORT_TYPE: Record<string, string> = {
  investment: 'investment',
  portfolio: 'portfolio',
  borrowing: 'borrowing_capacity',
  formara: 'cash_flow',
  property: 'investment',
};

export type PublishReadiness = 'ready' | 'on_publish' | 'unavailable';

export interface PublishVerdict {
  readiness: PublishReadiness;
  /** Said to the operator. Never a database word. */
  reason: string;
  /** The object this publish would point the portal at. Null when nothing is stored yet. */
  storagePath: string | null;
  /** Set when the reference named a bucket of its own. */
  bucket: string | null;
  /** A portal row already points at this same file. */
  alreadyPublished: boolean;
  publishedAt: string | null;
}

/**
 * Identity of a stored file, for "is this already on the portal".
 *
 * Two references name the same object when they resolve to the same bucket and
 * key — which is why this compares the PARSED form and not the raw column. The
 * same PDF is written as a bare key by one generator and as a signed URL by
 * another, and comparing the strings would call those two different files.
 */
export function storedFileKey(raw: string | null | undefined): string | null {
  const ref = parseStorageRef(raw);
  if (!ref.path) return null;
  if (/^https?:\/\//i.test(ref.path)) return null; // Somewhere we cannot address.
  return `${ref.bucket ?? '*'}::${ref.path}`;
}

/** The files the portal already holds for this client, by stored-file identity. */
export function publishedFileIndex(portalReports: any[]): Map<string, string | null> {
  const index = new Map<string, string | null>();
  for (const row of portalReports ?? []) {
    const key = storedFileKey(row?.storage_path);
    if (!key) continue;
    // Keep the EARLIEST publication: that is when the client first got it,
    // which is what "already shared" should report. A row with no date at all
    // still records the fact, so a second row that has one can replace it.
    const at = row?.published_at ?? row?.created_at ?? null;
    if (!index.has(key)) {
      index.set(key, at);
      continue;
    }
    const seen = index.get(key);
    if (at && (!seen || at < seen)) index.set(key, at);
  }
  return index;
}

/**
 * Whether this report can go to the portal, and what publishing it would do.
 *
 * `alreadyPublished` is never a refusal — a report legitimately gets re-issued
 * after a correction, and the operator is the one who knows. It is said, and
 * the decision is left where it belongs.
 */
export function publishVerdict(
  report: UnifiedReport,
  publishedFiles: Map<string, string | null>,
): PublishVerdict {
  const key = storedFileKey(report.fileUrl);
  const alreadyPublished = key !== null && publishedFiles.has(key);
  const publishedAt = key !== null ? publishedFiles.get(key) ?? null : null;

  const base = { alreadyPublished, publishedAt };

  if (report.source === 'portal_report') {
    return {
      ...base,
      readiness: 'unavailable',
      reason: 'Already on the portal.',
      storagePath: null,
      bucket: null,
    };
  }

  // Stored, and deliberately not offered. Its file is served by the
  // Commercial & Industrial function under that module's access rule, and the
  // portal has no route to it — publishing would point a client at a file they
  // could not open. Checked before the "no file" branch below, whose words
  // ("nothing has been generated") would be false here.
  if (report.source === 'ci_document') {
    return {
      ...base,
      readiness: 'unavailable',
      reason: 'Commercial & Industrial reports are downloaded from here and sent directly; they are not published to the portal.',
      storagePath: null,
      bucket: null,
    };
  }

  // No stored file, but publishing renders one.
  if (!report.fileUrl) {
    if (report.source === 'borrowing_assessment') {
      return {
        ...base,
        readiness: 'on_publish',
        reason: 'The PDF is produced when you publish it.',
        storagePath: null,
        bucket: null,
      };
    }
    // Audit item 6. Half the stored portfolio analyses have no file — every
    // browser upload failed 403 until `secure-storage` learned this bucket's
    // binding, so the analysis was stored and its PDF was not (13 of 26 rows,
    // measured in production, every one with `report_data` intact). Declaring
    // them unavailable is what produced "No PDF available to send. Generate
    // the report PDF first" — a dead end asking the operator to re-run a
    // whole analysis this table already holds. The typeset review renders
    // from `report_data` on the server (`portfolioReviewBlob`), so publishing
    // renders one, exactly as the borrowing capacity row above has always
    // done. A row still generating or failed keeps refusing below.
    if (report.source === 'portfolio_report' && report.status === 'completed') {
      return {
        ...base,
        readiness: 'on_publish',
        reason: 'The typeset review is produced when you publish it.',
        storagePath: null,
        bucket: null,
      };
    }
    if (report.status === 'pending') {
      return { ...base, readiness: 'unavailable', reason: 'Still being generated.', storagePath: null, bucket: null };
    }
    if (report.status === 'failed') {
      return { ...base, readiness: 'unavailable', reason: 'This report did not finish generating.', storagePath: null, bucket: null };
    }
    return { ...base, readiness: 'unavailable', reason: 'No document has been generated for this yet.', storagePath: null, bucket: null };
  }

  // A reference that points at another host cannot be signed, and a portal row
  // built on one fails on the client's click rather than here.
  if (isExternalUrl(report.fileUrl)) {
    return {
      ...base,
      readiness: 'unavailable',
      reason: 'Its file is stored somewhere this workspace cannot serve from.',
      storagePath: null,
      bucket: null,
    };
  }

  const ref = parseStorageRef(report.fileUrl);
  return {
    ...base,
    readiness: 'ready',
    reason: alreadyPublished ? 'Already shared — publishing again re-issues it.' : 'Ready to publish.',
    storagePath: ref.path,
    bucket: ref.bucket,
  };
}

/** Reports a person may reasonably choose from, newest first. */
export function publishableReports(
  reports: UnifiedReport[],
  publishedFiles: Map<string, string | null>,
): Array<{ report: UnifiedReport; verdict: PublishVerdict }> {
  return reports
    .filter((r) => r.source !== 'portal_report')
    .map((report) => ({ report, verdict: publishVerdict(report, publishedFiles) }))
    .filter(({ verdict }) => verdict.readiness !== 'unavailable')
    .sort((a, b) => new Date(b.report.generatedAt).getTime() - new Date(a.report.generatedAt).getTime());
}

/**
 * Free-text matching over the picker's list.
 *
 * Every word must match, and they may match different fields — the same rule
 * `caseSearch.pure.ts` applies to the AUSTRAC customer field, because an
 * operator typing "portfolio aug" means both words and does not mean one
 * string.
 */
export function matchesReportSearch(report: UnifiedReport, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [report.name, report.propertyAddress, report.type]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
}

/** The title the picker proposes. The operator can still change it. */
export function suggestedPortalTitle(report: UnifiedReport): string {
  return report.name;
}
