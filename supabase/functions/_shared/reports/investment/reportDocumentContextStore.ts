/**
 * Keeping and reading a report's document context (`reportDocumentContext.pure.ts`).
 *
 * Both halves are bounded in time and never throw: the kept copy is a benefit
 * to the sections written after the first invocation, and neither losing it nor
 * waiting on storage may cost a report anything more than that.
 */

import {
  REPORT_SOURCES_BUCKET,
  documentContextPath,
  parseReportDocumentContext,
  type ReportDocumentContext,
} from './reportDocumentContext.pure.ts';

/** Long enough for a small object on a healthy store; short beside a run's budget. */
const STORE_TIMEOUT_MS = 5_000;

interface StorageBucket {
  upload: (
    path: string,
    body: Blob,
    options: { upsert: boolean; contentType: string },
  ) => Promise<{ error: { message?: string } | null }>;
  download: (path: string) => Promise<{ data: Blob | null; error: { message?: string } | null }>;
}

export interface ReportSourcesClient {
  storage: { from: (bucket: string) => StorageBucket };
}

async function within<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} took longer than ${STORE_TIMEOUT_MS}ms`)), STORE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Keep the first invocation's document context. True when it was written. */
export async function keepReportDocumentContext(
  client: ReportSourcesClient,
  record: ReportDocumentContext,
): Promise<boolean> {
  const path = documentContextPath(record.reportId);
  if (!path) return false;
  try {
    const body = new Blob([JSON.stringify(record)], { type: 'application/json' });
    const { error } = await within(
      client.storage.from(REPORT_SOURCES_BUCKET).upload(path, body, { upsert: true, contentType: 'application/json' }),
      'Keeping the document context',
    );
    if (error) {
      console.warn(`[report-document-context] not kept for ${record.reportId}: ${error.message ?? 'storage refused the write'}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[report-document-context] not kept for ${record.reportId}: ${(e as Error)?.message ?? e}`);
    return false;
  }
}

/**
 * The kept document context for a report, or null: nothing kept, a store that
 * cannot be read, or an object this module did not write.
 */
export async function readReportDocumentContext(
  client: ReportSourcesClient,
  reportId: string,
): Promise<ReportDocumentContext | null> {
  const path = documentContextPath(reportId);
  if (!path) return null;
  try {
    const { data, error } = await within(
      client.storage.from(REPORT_SOURCES_BUCKET).download(path),
      'Reading the document context',
    );
    if (error || !data) return null;
    return parseReportDocumentContext(JSON.parse(await data.text()));
  } catch {
    return null;
  }
}
