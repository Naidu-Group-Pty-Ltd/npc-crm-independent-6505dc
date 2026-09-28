/**
 * The condition records a report's property holds, read for scoring.
 *
 * A condition record describes the PROPERTY, so it is found by the report it
 * was filed against AND by the property's canonical key — two plain equality
 * reads merged by id, never a composed `.or()` string (CLAUDE.md, "Never
 * compose a filter as a string").
 *
 * It never fails the report it serves. A deployment that has not applied the
 * table (`isMissingTableError`), a read that failed and a property with no
 * record all answer an empty list with a reason, and the building question
 * then stays unanswered exactly as it did before the table existed.
 */
import {
  isMissingTableError,
  recordFromRow,
} from './conditionRecordSubmission.pure.ts';
import type { ConditionRecord, ConditionSubject } from './conditionRecord.pure.ts';

export interface ConditionRecordsForReport {
  records: ConditionRecord[];
  /** The property the records are judged against, from the report row. */
  subject: ConditionSubject | null;
  /** Why the list is empty where it is, for the log. */
  note: string | null;
}

// deno-lint-ignore no-explicit-any
type Client = any;

export async function readConditionRecordsForReport(
  supabase: Client,
  reportId: string | null | undefined,
): Promise<ConditionRecordsForReport> {
  if (!reportId) return { records: [], subject: null, note: 'no report id' };
  try {
    const { data: row, error: rowError } = await supabase
      .from('investment_reports')
      .select('id, property_address, canonical_property_key, client_property_id, derived_from_report_id, parent_report_id')
      .eq('id', reportId)
      .maybeSingle();
    if (rowError || !row) {
      return { records: [], subject: null, note: rowError ? `report read failed: ${rowError.message}` : 'report not found' };
    }
    const subject: ConditionSubject = {
      propertyAddress: String(row.property_address ?? ''),
      propertyId: (row.client_property_id as string | null) ?? null,
      reportId,
    };

    const byId = new Map<string, Record<string, unknown>>();
    // Filed against this report, or against the Compass it was derived from.
    const reportIds = [...new Set([reportId, row.derived_from_report_id, row.parent_report_id]
      .filter((v): v is string => typeof v === 'string' && v.length > 0))];
    for (const id of reportIds) {
      const read = await supabase.from('property_condition_records').select('*').eq('report_id', id);
      if (read.error) {
        if (isMissingTableError(read.error)) {
          return { records: [], subject, note: 'the condition-record table is not applied on this deployment' };
        }
        return { records: [], subject, note: `condition-record read failed: ${read.error.message}` };
      }
      for (const r of read.data ?? []) byId.set(String(r.id), r);
    }
    if (typeof row.canonical_property_key === 'string' && row.canonical_property_key) {
      const read = await supabase
        .from('property_condition_records')
        .select('*')
        .eq('canonical_property_key', row.canonical_property_key);
      if (!read.error) for (const r of read.data ?? []) byId.set(String(r.id), r);
    }
    const records = [...byId.values()].map(recordFromRow);
    return { records, subject, note: records.length ? null : 'no condition record is recorded for this property' };
  } catch (error) {
    return { records: [], subject: null, note: `condition-record read threw: ${error instanceof Error ? error.message : String(error)}` };
  }
}
