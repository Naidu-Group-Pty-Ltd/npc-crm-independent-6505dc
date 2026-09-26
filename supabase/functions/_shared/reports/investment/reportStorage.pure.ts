/**
 * What a report keeps in storage, and what deleting the report removes.
 *
 * A report owns three folders in the private `listing-images` bucket:
 *
 *  - `report-photographs/<id>/`: the photographs captured from its listing or
 *    chosen from its brochure, with the record that vouches for them
 *    (`capture.json` or `brochure.json`);
 *  - `report-photographs/<id>/plans/`: its floor plans;
 *  - `report-sources/<id>/`: the document context its first invocation kept
 *    (`reportDocumentContext.pure.ts`).
 *
 * Deleting a report used to delete its row and nothing else, so every one of
 * those files stayed in the bucket with nothing left that could read it: a
 * derived report reads its parent's folder only through `parent_report_id`
 * or `derived_from_report_id`, and both are `ON DELETE SET NULL`. The moment
 * the row goes, the folder belongs to nobody.
 *
 * Three rules:
 *
 *  - **Only what a delete actually removed.** The folders are those of the
 *    ids the delete statement returned, never of an id a caller merely asked
 *    about.
 *  - **Only a report's own folders.** A folder is built from an id that is a
 *    row id or from nothing, so no path here can name another report, a
 *    listing's images or the top of the bucket.
 *  - **Only objects.** A listed sub-folder is a prefix, not an object, and is
 *    never passed to a removal. The floor plans are listed in their own right.
 *
 * The rendered PDF is deliberately not here. A client portal can hold a copy
 * of a report someone later deletes, and removing it would take the document
 * out of that client's portal.
 *
 * Pure: no Deno, no network. `reportStorageRemoval.ts` lists and removes.
 */

import { captureFolder, floorPlanFolder, isRecordId } from '../../reportPhotographs.pure.ts';
import { REPORT_SOURCES_BUCKET, REPORT_SOURCES_PREFIX } from './reportDocumentContext.pure.ts';

/** The bucket a report's photographs, plans and kept document live in. */
export const REPORT_STORAGE_BUCKET = REPORT_SOURCES_BUCKET;

/**
 * The folders one report owns, the plans before the photographs that hold
 * them. Null for anything that is not a report id.
 */
export function reportStorageFolders(reportId: unknown): string[] | null {
  if (!isRecordId(reportId)) return null;
  const id = reportId.trim().toLowerCase();
  const photographs = captureFolder(id);
  const plans = floorPlanFolder(id);
  if (!photographs || !plans) return null;
  return [plans, photographs, `${REPORT_SOURCES_PREFIX}/${id}`];
}

/** One entry of a storage listing, as the client returns it. */
export interface StorageListEntry {
  name?: unknown;
  id?: unknown;
  metadata?: unknown;
}

/**
 * The objects a folder listing names, as full paths.
 *
 * A sub-folder comes back as an entry with no id and no metadata: it is a
 * prefix, and removing it would remove nothing, so it is left out. A name that
 * could step outside the folder is never produced, however it was listed.
 */
export function objectPathsIn(folder: string, entries: readonly StorageListEntry[] | null | undefined): string[] {
  const paths: string[] = [];
  for (const entry of entries ?? []) {
    const name = typeof entry?.name === 'string' ? entry.name : '';
    if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) continue;
    const isObject = (typeof entry?.id === 'string' && entry.id !== '')
      || (entry?.metadata !== null && typeof entry?.metadata === 'object');
    if (!isObject) continue;
    paths.push(`${folder}/${name}`);
  }
  return paths;
}

/** Whether a path is inside one of a report's own folders. */
export function isReportStoragePath(path: unknown, reportId: unknown): boolean {
  const folders = reportStorageFolders(reportId);
  if (!folders || typeof path !== 'string') return false;
  if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
  return folders.some((folder) => path.startsWith(`${folder}/`) && !path.slice(folder.length + 1).includes('/'));
}

/** The report ids a delete returned, once each, as row ids. */
export function deletedReportIds(rows: ReadonlyArray<{ id?: unknown } | null | undefined> | null | undefined): string[] {
  const ids = new Set<string>();
  for (const row of rows ?? []) {
    if (isRecordId(row?.id)) ids.add(row.id.trim().toLowerCase());
  }
  return [...ids];
}
