/**
 * Removing what a deleted report kept in storage (`reportStorage.pure.ts`).
 *
 * Called after a delete statement has returned the rows it removed, and only
 * for those. It never throws and never fails the delete that called it: a
 * report that is gone is gone, and a file that could not be removed costs a
 * few kilobytes in a private bucket, which is what every delete cost before.
 *
 * It is bounded in time as a whole, so a slow store cannot hold a delete's
 * answer. Whatever the budget did not reach is reported as `unfinished`.
 */

import {
  REPORT_STORAGE_BUCKET,
  deletedReportIds,
  isReportStoragePath,
  objectPathsIn,
  reportStorageFolders,
  type StorageListEntry,
} from './reportStorage.pure.ts';

interface StorageBucket {
  list: (
    path: string,
    options?: { limit?: number; offset?: number },
  ) => Promise<{ data: StorageListEntry[] | null; error: { message?: string } | null }>;
  remove: (paths: string[]) => Promise<{ data: unknown; error: { message?: string } | null }>;
}

export interface ReportStorageClient {
  storage: { from: (bucket: string) => StorageBucket };
}

export interface ReportStorageRemoval {
  /** Reports whose folders this call looked in. */
  reports: number;
  /** Objects removed. */
  removed: number;
  /** Reports with a folder that could not be listed or emptied. */
  failed: number;
  /** True when the budget ran out before every report was reached. */
  unfinished: boolean;
}

/** A single report's folders on a healthy store take a few hundred milliseconds. */
export const SINGLE_DELETE_BUDGET_MS = 5_000;
/** A bulk delete visits reports a few at a time within this. */
export const BULK_DELETE_BUDGET_MS = 20_000;

const PAGE = 1_000;
const MAX_PAGES = 5;
const CONCURRENCY = 4;

class OutOfTime extends Error {}

async function within<T>(work: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new OutOfTime();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new OutOfTime()), remaining);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Every object in one folder, or null where the folder could not be listed. */
async function objectsIn(bucket: StorageBucket, folder: string, deadline: number): Promise<string[] | null> {
  const paths: string[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await within(bucket.list(folder, { limit: PAGE, offset: page * PAGE }), deadline);
    if (error) return null;
    paths.push(...objectPathsIn(folder, data));
    if ((data?.length ?? 0) < PAGE) return paths;
  }
  return paths;
}

/** Empty one report's folders. True when every folder was listed and emptied. */
async function removeOne(
  bucket: StorageBucket,
  reportId: string,
  deadline: number,
  tally: { removed: number },
): Promise<boolean> {
  const folders = reportStorageFolders(reportId);
  if (!folders) return true;
  let complete = true;
  const paths: string[] = [];
  for (const folder of folders) {
    const found = await objectsIn(bucket, folder, deadline);
    if (found === null) complete = false;
    else paths.push(...found);
  }
  // Nothing outside this report's own folders is ever handed to a removal.
  const owned = paths.filter((path) => isReportStoragePath(path, reportId));
  if (owned.length !== paths.length) complete = false;
  for (let i = 0; i < owned.length; i += PAGE) {
    const batch = owned.slice(i, i + PAGE);
    const { data, error } = await within(bucket.remove(batch), deadline);
    if (error) {
      complete = false;
      continue;
    }
    tally.removed += Array.isArray(data) ? data.length : batch.length;
  }
  return complete;
}

/**
 * Remove the photographs, floor plans and kept document of the reports a
 * delete removed. `rows` is what the delete statement returned.
 */
export async function removeDeletedReportStorage(
  client: ReportStorageClient,
  rows: ReadonlyArray<{ id?: unknown } | null | undefined> | null | undefined,
  budgetMs: number = SINGLE_DELETE_BUDGET_MS,
): Promise<ReportStorageRemoval> {
  const ids = deletedReportIds(rows);
  const outcome: ReportStorageRemoval = { reports: 0, removed: 0, failed: 0, unfinished: false };
  if (ids.length === 0) return outcome;
  const deadline = Date.now() + budgetMs;
  let bucket: StorageBucket;
  try {
    bucket = client.storage.from(REPORT_STORAGE_BUCKET);
  } catch {
    return { ...outcome, failed: ids.length };
  }
  const tally = { removed: 0 };
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      if (Date.now() >= deadline) {
        outcome.unfinished = true;
        return;
      }
      const reportId = ids[next++];
      outcome.reports += 1;
      try {
        if (!(await removeOne(bucket, reportId, deadline, tally))) outcome.failed += 1;
      } catch (error) {
        outcome.failed += 1;
        if (error instanceof OutOfTime) outcome.unfinished = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  outcome.removed = tally.removed;
  if (outcome.reports < ids.length) outcome.unfinished = true;
  return outcome;
}
