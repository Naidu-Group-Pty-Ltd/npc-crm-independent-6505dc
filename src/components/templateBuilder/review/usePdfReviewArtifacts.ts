/**
 * PDF Extraction V3 · E11 — bounded, lazy artifact hydration hook.
 *
 * Signs and hydrates ONLY the requested (page, region, kind) artifacts — never
 * all pages, never an arbitrary path. The hydrated URL is RUNTIME-ONLY:
 *   - it is held in a ref-backed map, never in React Query persistence, never in
 *     localStorage/sessionStorage, never logged;
 *   - concurrent requests for the same key are de-duplicated;
 *   - stale page requests are cancelled on page change;
 *   - object/blob URLs are revoked and the map cleared on unmount.
 *
 * The signer is INJECTED (`signArtifact`) so this hook is testable without a live
 * backend and never hardcodes an endpoint. The default signer calls the
 * authenticated Edge Function via `invokeSecureFunction`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type ArtifactKind,
  type ArtifactSelectionRequest,
  validateArtifactSelection,
} from '@/lib/reportTemplate/pdfImport/review';

export interface SignedArtifact {
  /** Runtime-only signed URL. NEVER persist this. */
  url: string;
  expiresAt: string | null;
  widthPx: number | null;
  heightPx: number | null;
  hashVerified: boolean | null;
}

export type ArtifactSigner = (req: ArtifactSelectionRequest, signal: AbortSignal) => Promise<SignedArtifact>;

export interface ArtifactEntry {
  state: 'idle' | 'loading' | 'ready' | 'expired' | 'missing' | 'invalid' | 'forbidden' | 'error';
  url: string | null;
  expiresAt: string | null;
  widthPx: number | null;
  heightPx: number | null;
  hashVerified: boolean | null;
}

const IDLE: ArtifactEntry = { state: 'idle', url: null, expiresAt: null, widthPx: null, heightPx: null, hashVerified: null };

function artifactKey(req: ArtifactSelectionRequest): string {
  return `${req.importId}|${req.pageNumber}|${req.kind}|${req.regionId ?? ''}`;
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t <= Date.now();
}

export interface UsePdfReviewArtifactsOptions {
  importId: string;
  signArtifact: ArtifactSigner;
}

export interface UsePdfReviewArtifacts {
  get: (pageNumber: number, kind: ArtifactKind, regionId?: string | null) => ArtifactEntry;
  request: (pageNumber: number, kind: ArtifactKind, regionId?: string | null) => void;
  /** Cancel in-flight requests for pages outside the given active set (bounded window). */
  retainPages: (pages: number[]) => void;
}

/**
 * Manage runtime-only artifact hydration. The returned entries carry a signed URL
 * only in memory; nothing here writes to any persistent store.
 */
export function usePdfReviewArtifacts(opts: UsePdfReviewArtifactsOptions): UsePdfReviewArtifacts {
  const { importId, signArtifact } = opts;
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);

  // Runtime-only stores — refs so URLs never enter React state serialization.
  const entries = useRef<Map<string, ArtifactEntry>>(new Map());
  const inflight = useRef<Map<string, AbortController>>(new Map());
  const objectUrls = useRef<Set<string>>(new Set());
  const mounted = useRef(true);

  const setEntry = useCallback((key: string, entry: ArtifactEntry) => {
    entries.current.set(key, entry);
    if (mounted.current) rerender();
  }, [rerender]);

  const request = useCallback((pageNumber: number, kind: ArtifactKind, regionId: string | null = null) => {
    const req: ArtifactSelectionRequest = { importId, pageNumber, kind, regionId };
    const problems = validateArtifactSelection(req);
    const key = artifactKey(req);
    if (problems.length > 0) {
      setEntry(key, { ...IDLE, state: 'invalid' });
      return;
    }
    const existing = entries.current.get(key);
    // Serve a still-valid ready entry; refresh an expired one exactly once.
    if (existing && existing.state === 'ready' && !isExpired(existing.expiresAt)) return;
    if (inflight.current.has(key)) return; // de-duplicate concurrent requests

    const controller = new AbortController();
    inflight.current.set(key, controller);
    setEntry(key, { ...IDLE, state: 'loading' });

    signArtifact(req, controller.signal)
      .then((signed) => {
        if (controller.signal.aborted || !mounted.current) return;
        if (signed.url.startsWith('blob:')) objectUrls.current.add(signed.url);
        setEntry(key, {
          state: 'ready',
          url: signed.url,
          expiresAt: signed.expiresAt,
          widthPx: signed.widthPx,
          heightPx: signed.heightPx,
          hashVerified: signed.hashVerified,
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || !mounted.current) return;
        const code = (err as { code?: string })?.code;
        const state = code === 'forbidden' ? 'forbidden' : code === 'missing' ? 'missing' : 'error';
        setEntry(key, { ...IDLE, state });
      })
      .finally(() => {
        inflight.current.delete(key);
      });
  }, [importId, signArtifact, setEntry]);

  const get = useCallback((pageNumber: number, kind: ArtifactKind, regionId: string | null = null): ArtifactEntry => {
    const key = artifactKey({ importId, pageNumber, kind, regionId });
    const entry = entries.current.get(key) ?? IDLE;
    if (entry.state === 'ready' && isExpired(entry.expiresAt)) return { ...entry, state: 'expired' };
    return entry;
  }, [importId]);

  const retainPages = useCallback((pages: number[]) => {
    const keep = new Set(pages);
    // Abort in-flight requests for pages outside the retained window.
    for (const [key, controller] of inflight.current.entries()) {
      const pageNum = Number(key.split('|')[1]);
      if (!keep.has(pageNum)) {
        controller.abort();
        inflight.current.delete(key);
      }
    }
  }, []);

  // Cleanup: abort everything, revoke object URLs, clear the map on unmount.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const controller of inflight.current.values()) controller.abort();
      inflight.current.clear();
      for (const url of objectUrls.current) {
        try { URL.revokeObjectURL(url); } catch { /* noop */ }
      }
      objectUrls.current.clear();
      entries.current.clear();
    };
  }, []);

  return { get, request, retainPages };
}
