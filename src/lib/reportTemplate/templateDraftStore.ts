/**
 * Local draft persistence for the Template Builder (Phase 3B).
 *
 * Autosaved editor state is kept in IndexedDB (chosen over localStorage so large
 * imported templates with embedded images don't blow the ~5MB synchronous quota).
 * One draft is stored per authenticated user and template id; the base server
 * version it was branched from is recorded so recovery can warn when the server
 * has since moved on.
 *
 * The store degrades gracefully: if IndexedDB is unavailable (SSR, private mode,
 * blocked) every operation becomes a safe no-op rather than throwing.
 */
import { type ReportTemplate } from './templateSchema';

const DB_NAME = 'template-builder';
const STORE_NAME = 'drafts';
const DB_VERSION = 2;

export interface TemplateDraft {
  /** Authenticated user that owns this browser-local draft. */
  ownerId: string;
  templateId: string;
  /** The server `version` the draft was based on when first autosaved. */
  baseServerVersion: number;
  /** ISO timestamp of the most recent local autosave. */
  savedAt: string;
  name: string;
  description: string;
  reportType: string;
  tier: string;
  variant: string;
  scope: string;
  priority: number;
  customCss: string;
  /** Raw sample-data JSON text from the Data tab (preview only). */
  sampleDataText: string;
  schema: ReportTemplate;
}

interface StoredTemplateDraft extends TemplateDraft {
  draftKey: string;
}

/** A collision-safe, user-scoped key for browser-local draft records. */
export function makeTemplateDraftKey(ownerId: string, templateId: string): string {
  return JSON.stringify([ownerId, templateId]);
}

/** Fields that participate in the draft-vs-server comparison. */
export interface DraftComparableFields {
  name: string;
  description: string;
  reportType: string;
  tier: string;
  variant: string;
  scope: string;
  priority: number;
  customCss: string;
  schema: ReportTemplate;
}

/**
 * Canonical serialization used to decide whether a draft differs from the saved
 * server copy. Pure and deterministic so the recovery decision is unit-testable.
 * Only content fields are included — `savedAt`, `ownerId`, `templateId` and
 * `baseServerVersion` are deliberately excluded.
 */
export function makeDraftSignature(fields: DraftComparableFields): string {
  return JSON.stringify({
    name: fields.name ?? '',
    description: fields.description ?? '',
    reportType: fields.reportType ?? '',
    tier: fields.tier ?? '',
    variant: fields.variant ?? '',
    scope: fields.scope ?? 'global',
    priority: Number.isFinite(fields.priority) ? fields.priority : 0,
    customCss: fields.customCss ?? '',
    schema: fields.schema,
  });
}

export interface DraftRecoveryDecision {
  /** The draft differs from the saved server copy and is worth recovering. */
  recover: boolean;
  /** The draft was based on an older server version than the one now loaded. */
  staleBase: boolean;
}

/**
 * Pure recovery decision: should we offer to restore `draft`, and was it based on
 * a now-superseded server version? `serverSignature` must be produced by
 * {@link makeDraftSignature} for the currently loaded server row.
 */
export function evaluateDraftRecovery(params: {
  draft: TemplateDraft | null | undefined;
  serverSignature: string;
  currentServerVersion: number;
}): DraftRecoveryDecision {
  const { draft, serverSignature, currentServerVersion } = params;
  if (!draft) return { recover: false, staleBase: false };
  const recover = makeDraftSignature(draft) !== serverSignature;
  const staleBase = Number(draft.baseServerVersion) !== Number(currentServerVersion);
  return { recover, staleBase };
}

// ─── IndexedDB plumbing ─────────────────────────────────────────────────────

function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!isIndexedDbAvailable()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      // Version 1 records were keyed only by template id and cannot be safely
      // attributed to a user. Drop them rather than exposing them after login.
      if (db.objectStoreNames.contains(STORE_NAME)) db.deleteObjectStore(STORE_NAME);
      db.createObjectStore(STORE_NAME, { keyPath: 'draftKey' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function runTx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const transaction = db.transaction(STORE_NAME, mode);
          const store = transaction.objectStore(STORE_NAME);
          const request = run(store);
          request.onsuccess = () => resolve((request.result as T) ?? null);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export async function saveTemplateDraft(draft: TemplateDraft): Promise<void> {
  if (!draft.ownerId || !draft.templateId) return;
  const stored: StoredTemplateDraft = {
    ...draft,
    draftKey: makeTemplateDraftKey(draft.ownerId, draft.templateId),
  };
  await runTx('readwrite', (store) => store.put(stored) as IDBRequest<IDBValidKey>);
}

export async function loadTemplateDraft(ownerId: string, templateId: string): Promise<TemplateDraft | null> {
  if (!ownerId || !templateId) return null;
  const stored = await runTx<StoredTemplateDraft>(
    'readonly',
    (store) => store.get(makeTemplateDraftKey(ownerId, templateId)) as IDBRequest<StoredTemplateDraft>,
  );
  if (!stored) return null;
  const { draftKey: _draftKey, ...draft } = stored;
  return draft;
}

export async function deleteTemplateDraft(ownerId: string, templateId: string): Promise<void> {
  if (!ownerId || !templateId) return;
  await runTx(
    'readwrite',
    (store) => store.delete(makeTemplateDraftKey(ownerId, templateId)) as IDBRequest<undefined>,
  );
}

export async function listTemplateDrafts(ownerId: string): Promise<TemplateDraft[]> {
  if (!ownerId) return [];
  const result = await runTx<StoredTemplateDraft[]>(
    'readonly',
    (store) => store.getAll() as IDBRequest<StoredTemplateDraft[]>,
  );
  return (result ?? [])
    .filter((draft) => draft.ownerId === ownerId)
    .map(({ draftKey: _draftKey, ...draft }) => draft);
}
