/**
 * Sub-reports of a Compass base — generated and read the same way from every
 * surface.
 *
 * Two switchers used to choose engines independently (audit F9): the page
 * header forked "Financial" (deterministic) while the modal viewer condensed
 * it (a model) — two documents under one name, attached to the parent by two
 * different columns. `generateSubReport` asks the ONE mapping
 * (`engineForVariant`, shared with the engines themselves), so a surface
 * cannot route a variant to the wrong machinery again.
 *
 * The family is read through the server (`get-investment-reports` with
 * `familyOf`) because `investment_reports` is service-role-only: a browser
 * `.from('investment_reports')` returns `[]` with HTTP 200 — the trap that
 * made the tier switcher regenerate an existing child on every click. The
 * server also derives per-child staleness (audit F10): a sub-report is a
 * projection of its parent at a moment in time, and the read says whether
 * that moment has passed.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  engineForVariant,
  type FamilyChild,
  type ReportFamily,
  type SubReportVariant,
} from '@/lib/reports/investment/subReportFamily.pure';

export type { FamilyChild, ReportFamily, SubReportVariant };

/**
 * Produce (or refresh, both engines are idempotent per family+variant) one
 * sub-report of the given parent. Resolves to the child report's id.
 */
export async function generateSubReport(
  parentReportId: string,
  variant: SubReportVariant,
): Promise<{ reportId: string; refreshed: boolean }> {
  const engine = engineForVariant(variant);
  if (!engine) throw new Error(`Unknown report variant: ${variant}`);

  if (engine === 'fork-investment-report') {
    const { data, error } = await invokeSecureFunction<any>('fork-investment-report', {
      composite_report_id: parentReportId,
      variants: [variant],
    });
    if (error) throw new Error(error.message);
    const child = data?.[variant];
    if (data?.ok !== true || !child?.id) {
      throw new Error(data?.error || 'The generated report could not be retrieved.');
    }
    return { reportId: child.id, refreshed: child.refreshed === true };
  }

  const { data, error } = await invokeSecureFunction<any>('condense-investment-report', {
    parentReportId,
    targetTier: variant,
  });
  if (error) throw new Error(error.message);
  if (data?.success !== true || !data?.reportId) {
    throw new Error(data?.error || 'The generated report could not be retrieved.');
  }
  return { reportId: data.reportId, refreshed: true };
}

/** One variant's outcome in a family preparation. */
export type PreparedVariant =
  | { ok: true; reportId: string }
  | { ok: false; error: string };

/**
 * Prepare several sub-reports of one Compass at once.
 *
 * Financial and Strategic come from ONE fork call (the fork writes both from
 * the same read of the parent), and Briefing and Snapshot are condensed in
 * parallel beside it, so the set takes as long as its slowest member rather
 * than the sum of four. Each outcome is reported on its own: one failure
 * never discards the others.
 */
export async function prepareReportFamily(
  parentReportId: string,
  variants: readonly SubReportVariant[],
): Promise<Partial<Record<SubReportVariant, PreparedVariant>>> {
  const wanted = [...new Set(variants)];
  const forked = wanted.filter((v) => engineForVariant(v) === 'fork-investment-report');
  const condensed = wanted.filter((v) => engineForVariant(v) === 'condense-investment-report');
  const reasonOf = (err: unknown) => (err instanceof Error && err.message ? err.message : 'The report could not be prepared.');
  const out: Partial<Record<SubReportVariant, PreparedVariant>> = {};

  const forkJob = forked.length
    ? invokeSecureFunction<any>('fork-investment-report', { composite_report_id: parentReportId, variants: forked })
      .then(({ data, error }) => {
        for (const v of forked) {
          const child = data?.[v];
          out[v] = !error && data?.ok === true && child?.id
            ? { ok: true, reportId: child.id }
            : { ok: false, error: error?.message || data?.error || 'The report could not be prepared.' };
        }
      })
      .catch((err) => { for (const v of forked) out[v] = { ok: false, error: reasonOf(err) }; })
    : Promise.resolve();

  const condenseJobs = condensed.map((v) => generateSubReport(parentReportId, v)
    .then(({ reportId }) => { out[v] = { ok: true, reportId }; })
    .catch((err) => { out[v] = { ok: false, error: reasonOf(err) }; }));

  await Promise.all([forkJob, ...condenseJobs]);
  return out;
}

/** The report's Compass family, with per-child staleness, from the server. */
export async function fetchReportFamily(reportId: string): Promise<ReportFamily | null> {
  const { data, error } = await invokeSecureFunction<{ success: boolean; family?: ReportFamily }>(
    'get-investment-reports',
    { familyOf: reportId },
  );
  if (error || !data?.success || !data.family) return null;
  return data.family;
}
