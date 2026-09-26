/**
 * Deleting a report removes what it kept in storage.
 *
 * The owner's commercial-readiness item (26 Sep 2026): a report's
 * photographs, floor plans and kept document stayed in the private
 * `listing-images` bucket after the report was deleted, with nothing left that
 * could read them. A derived report reaches its parent's folder only through
 * `parent_report_id` / `derived_from_report_id`, and both are
 * `ON DELETE SET NULL`, so the folder of a deleted report belongs to nobody.
 *
 * What is held here:
 *
 *   - the folders are a report's own and nobody else's, and only objects are
 *     ever removed;
 *   - the removal is bounded, never throws, and a failure costs the files and
 *     never the delete;
 *   - every server path that deletes a report row removes its storage, for
 *     the rows the statement returned and no others;
 *   - "delete every report in this state" is an administrator's act.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPORT_STORAGE_BUCKET,
  deletedReportIds,
  isReportStoragePath,
  objectPathsIn,
  reportStorageFolders,
} from '../reportStorage.pure';
import {
  removeDeletedReportStorage,
  type ReportStorageClient,
} from '../../../../../supabase/functions/_shared/reports/investment/reportStorageRemoval';

const A = '0b8a2c6e-1f3d-4a5b-9c7d-2e4f6a8b0c1d';
const B = '7d1e3f5a-9b2c-4d6e-8f0a-1b3c5d7e9f20';
const root = resolve(__dirname, '../../../../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

/** An in-memory bucket that lists one level, as the storage client does. */
function memoryStore(paths: string[], behaviour: {
  listError?: (folder: string) => boolean;
  removeError?: boolean;
  hang?: boolean;
} = {}) {
  const objects = new Set(paths);
  const removed: string[][] = [];
  const buckets: string[] = [];
  const pending = () => new Promise<never>(() => undefined);
  const client: ReportStorageClient = {
    storage: {
      from: (bucket: string) => {
        buckets.push(bucket);
        return {
          list: async (folder: string, options?: { limit?: number; offset?: number }) => {
            if (behaviour.hang) return pending();
            if (behaviour.listError?.(folder)) return { data: null, error: { message: 'unavailable' } };
            const prefix = `${folder}/`;
            const files = new Map<string, { name: string; id: string | null; metadata: object | null }>();
            for (const path of objects) {
              if (!path.startsWith(prefix)) continue;
              const rest = path.slice(prefix.length);
              const [head, ...tail] = rest.split('/');
              files.set(head, tail.length ? { name: head, id: null, metadata: null } : { name: head, id: `id-${path}`, metadata: { size: 1 } });
            }
            const all = [...files.values()].sort((x, y) => x.name.localeCompare(y.name));
            const offset = options?.offset ?? 0;
            return { data: all.slice(offset, offset + (options?.limit ?? 100)), error: null };
          },
          remove: async (batch: string[]) => {
            if (behaviour.hang) return pending();
            if (behaviour.removeError) return { data: null, error: { message: 'refused' } };
            removed.push(batch);
            const gone = batch.filter((path) => objects.delete(path));
            return { data: gone.map((name) => ({ name })), error: null };
          },
        };
      },
    },
  };
  return { client, objects, removed, buckets };
}

const reportFiles = (id: string) => [
  `report-photographs/${id}/00-1600x1067-aaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb.jpg`,
  `report-photographs/${id}/01-1600x1067-cccccccccccccccc-dddddddddddddddd.jpg`,
  `report-photographs/${id}/capture.json`,
  `report-photographs/${id}/brochure.json`,
  `report-photographs/${id}/plans/00-1400x1000-eeeeeeeeeeeeeeee-ffffffffffffffff.png`,
  `report-sources/${id}/document.json`,
];

describe('a report’s storage is its own', () => {
  it('is three folders in the listing-images bucket, plans before the photographs that hold them', () => {
    expect(REPORT_STORAGE_BUCKET).toBe('listing-images');
    expect(reportStorageFolders(A)).toEqual([
      `report-photographs/${A}/plans`,
      `report-photographs/${A}`,
      `report-sources/${A}`,
    ]);
    expect(reportStorageFolders(`  ${A.toUpperCase()} `)).toEqual(reportStorageFolders(A));
  });

  it('is nothing at all for anything that is not a report id', () => {
    for (const bad of ['', '   ', 'report-photographs', '../etc', `${A}/..`, `${A}x`, null, undefined, 42, {}]) {
      expect(reportStorageFolders(bad), String(bad)).toBeNull();
    }
  });

  it('removes objects and never a listed sub-folder or a name that steps outside', () => {
    const folder = `report-photographs/${A}`;
    expect(objectPathsIn(folder, [
      { name: 'capture.json', id: 'x1', metadata: { size: 1 } },
      { name: 'plans', id: null, metadata: null },
      { name: '00-1x1-a-b.jpg', metadata: { size: 1 } },
      { name: '../B/capture.json', id: 'x2', metadata: {} },
      { name: 'a/b.jpg', id: 'x3', metadata: {} },
      { name: '..', id: 'x4', metadata: {} },
      { name: '', id: 'x5', metadata: {} },
      { name: 42, id: 'x6', metadata: {} },
    ])).toEqual([`${folder}/capture.json`, `${folder}/00-1x1-a-b.jpg`]);
    expect(objectPathsIn(folder, null)).toEqual([]);
  });

  it('holds every path to one of the report’s own folders, one level deep', () => {
    for (const path of reportFiles(A)) expect(isReportStoragePath(path, A), path).toBe(true);
    for (const path of [
      ...reportFiles(B),
      `report-photographs/${A}/plans/extra/x.png`,
      `report-photographs/${A}/../${B}/capture.json`,
      `report-photographs/${A}`,
      'report-photographs',
      `listing-images/${A}/capture.json`,
      `${A}/capture.json`,
    ]) {
      expect(isReportStoragePath(path, A), path).toBe(false);
    }
  });

  it('takes the ids a delete returned, once each', () => {
    expect(deletedReportIds([{ id: A }, { id: A.toUpperCase() }, { id: 'nope' }, null, {}, { id: B }])).toEqual([A, B]);
    expect(deletedReportIds(null)).toEqual([]);
  });
});

describe('removing a deleted report’s storage', () => {
  it('removes exactly that report’s photographs, plans, records and kept document', async () => {
    const others = [...reportFiles(B), 'listings/rec123/photo.jpg', `report-photographs/${B}/capture.json`];
    const store = memoryStore([...reportFiles(A), ...others]);
    const outcome = await removeDeletedReportStorage(store.client, [{ id: A }]);
    expect(outcome).toEqual({ reports: 1, removed: reportFiles(A).length, failed: 0, unfinished: false });
    expect(store.buckets.every((bucket) => bucket === 'listing-images')).toBe(true);
    expect([...store.objects].sort()).toEqual([...new Set(others)].sort());
  });

  it('does nothing where the delete removed nothing', async () => {
    const store = memoryStore(reportFiles(A));
    expect(await removeDeletedReportStorage(store.client, [])).toEqual({ reports: 0, removed: 0, failed: 0, unfinished: false });
    expect(await removeDeletedReportStorage(store.client, null)).toEqual({ reports: 0, removed: 0, failed: 0, unfinished: false });
    expect(store.removed).toEqual([]);
    expect(store.objects.size).toBe(reportFiles(A).length);
  });

  it('empties every report a bulk delete removed', async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `${String(i).padStart(8, '0')}-1f3d-4a5b-9c7d-2e4f6a8b0c1d`);
    const store = memoryStore(ids.flatMap(reportFiles));
    const outcome = await removeDeletedReportStorage(store.client, ids.map((id) => ({ id })), 10_000);
    expect(outcome).toEqual({ reports: 9, removed: 9 * reportFiles(A).length, failed: 0, unfinished: false });
    expect(store.objects.size).toBe(0);
  });

  it('a folder that cannot be listed costs that folder, and the rest still goes', async () => {
    const store = memoryStore(reportFiles(A), { listError: (folder) => folder.startsWith('report-sources/') });
    const outcome = await removeDeletedReportStorage(store.client, [{ id: A }]);
    expect(outcome).toMatchObject({ reports: 1, failed: 1, unfinished: false });
    expect([...store.objects]).toEqual([`report-sources/${A}/document.json`]);
  });

  it('a removal the store refuses is counted, and nothing throws', async () => {
    const store = memoryStore(reportFiles(A), { removeError: true });
    await expect(removeDeletedReportStorage(store.client, [{ id: A }])).resolves.toMatchObject({ reports: 1, removed: 0, failed: 1 });
    const broken: ReportStorageClient = { storage: { from: () => { throw new Error('no storage'); } } };
    await expect(removeDeletedReportStorage(broken, [{ id: A }, { id: B }])).resolves.toMatchObject({ failed: 2 });
  });

  it('a store that never answers cannot hold the delete past its budget', async () => {
    const store = memoryStore(reportFiles(A), { hang: true });
    const started = Date.now();
    const outcome = await removeDeletedReportStorage(store.client, [{ id: A }, { id: B }], 150);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(outcome.unfinished).toBe(true);
    expect(outcome.removed).toBe(0);
  });
});

// ── The functions that delete report rows ─────────────────────────────────

const FUNCTIONS = 'supabase/functions';

function functionFiles(): string[] {
  const out: string[] = [];
  for (const dir of readdirSync(resolve(root, FUNCTIONS))) {
    if (dir.startsWith('_') || !statSync(resolve(root, FUNCTIONS, dir)).isDirectory()) continue;
    try {
      statSync(resolve(root, FUNCTIONS, dir, 'index.ts'));
      out.push(`${FUNCTIONS}/${dir}/index.ts`);
    } catch { /* no entry point */ }
  }
  return out;
}

/** The statements in a file that delete `investment_reports` rows. */
function reportDeletes(text: string): string[] {
  const found: string[] = [];
  const re = /from\(\s*['"]investment_reports['"]\s*\)\s*\.delete\(\)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) found.push(text.slice(m.index, m.index + 400));
  return found;
}

describe('every server path that deletes a report removes its storage', () => {
  it('is these two functions, and each removes storage for the rows it deleted', () => {
    const deleters = functionFiles().filter((path) => reportDeletes(source(path)).length > 0);
    expect(deleters.sort()).toEqual([
      `${FUNCTIONS}/manage-automation-settings/index.ts`,
      `${FUNCTIONS}/manage-investment-reports/index.ts`,
    ]);
    for (const path of deleters) {
      const text = source(path);
      const statements = reportDeletes(text);
      // One removal per delete statement, and each is handed what that
      // statement returned, never an id taken from the request.
      const removals = text.match(/removeDeletedReportStorage\(/g) ?? [];
      expect(removals.length, path).toBe(statements.length);
      for (const call of text.match(/removeDeletedReportStorage\([^)]*\)/g) ?? []) {
        expect(call, path).toMatch(/^removeDeletedReportStorage\(supabase, (removedRows|deleted)[,)]/);
      }
      // Each delete returns the rows it removed, and those are what is emptied.
      for (const statement of statements) expect(statement, path).toMatch(/\.select\('id'\)/);
    }
  });

  it('the single delete empties only after the row is gone, and a failure never fails it', () => {
    const text = source(`${FUNCTIONS}/manage-investment-reports/index.ts`);
    const body = text.slice(text.indexOf("case 'delete': {"), text.indexOf("case 'bulkDelete': {"));
    const deleted = body.indexOf(".delete()\n          .eq('id', reportId)\n          .select('id');");
    const failed = body.indexOf('if (deleteError) {');
    const removal = body.indexOf('await removeDeletedReportStorage(supabase, removedRows);');
    expect(deleted).toBeGreaterThan(0);
    expect(failed).toBeGreaterThan(deleted);
    expect(removal).toBeGreaterThan(failed);
    // Nothing is emptied before the delete is known to have worked.
    expect(body.indexOf('removeDeletedReportStorage(')).toBe(removal + 'await '.length);
    expect(body).toContain("JSON.stringify({ success: true, deleted: reportId })");
  });

  it('a delete by status is an administrator’s act; a delete by id is unchanged', () => {
    const text = source(`${FUNCTIONS}/manage-investment-reports/index.ts`);
    const body = text.slice(text.indexOf("case 'bulkDelete': {"), text.indexOf("case 'archive': {"));
    const gate = body.indexOf('const admin = await requireAdmin(supabase, { userId, authMethod });');
    const query = body.indexOf("let query = supabase.from('investment_reports').delete();");
    expect(gate).toBeGreaterThan(0);
    expect(query).toBeGreaterThan(gate);
    expect(body.slice(body.indexOf('if (statusFilter && Array.isArray(statusFilter)) {'), gate)).not.toContain('reportIds');
    expect(body).toContain('return createForbiddenResponse(admin.error');
  });

  it('never removes a rendered PDF: a client portal can still hold it', () => {
    const pure = source(`${FUNCTIONS}/_shared/reports/investment/reportStorage.pure.ts`);
    const store = source(`${FUNCTIONS}/_shared/reports/investment/reportStorageRemoval.ts`);
    for (const text of [pure.replace(/\/\*\*[\s\S]*?\*\//g, ''), store.replace(/\/\*\*[\s\S]*?\*\//g, '')]) {
      expect(text).not.toMatch(/pdf/i);
    }
  });
});
