/**
 * Phase 3 — Storage-backed raster artifact helpers.
 *
 * Template schema only ever stores Storage object paths (never base64 / data
 * URLs / signed URLs). At render time, call `getArtifactSignedUrl(path)` to
 * resolve a short-lived signed URL via the `pdf-parse-dispatch { operation:
 * 'download' }` edge function. The URL is cached in-memory; refresh on 4xx.
 */
import { invokeSecureFunction, describeAuthError } from '@/lib/secureInvoke';
import type {
  PdfImportRasterRef,
  RasterManifest,
} from './docling/doclingTypes';

const artifactSignedUrlCache = new Map<string, string>();

/** Resolve a Storage path to a short-lived signed URL (cached in memory). */
export async function getArtifactSignedUrl(path: string): Promise<string> {
  const cached = artifactSignedUrlCache.get(path);
  if (cached) return cached;

  const { data, error } = await invokeSecureFunction(
    'pdf-parse-dispatch',
    { operation: 'download', path },
    { timeoutMs: 30_000 },
  );

  if (error) {
    throw new Error(
      `Artifact signing failed for ${path}: ${describeAuthError(error.message) ?? error.message ?? 'unknown'}`,
    );
  }

  const payload = data as {
    signed_url?: string;
    signedUrl?: string;
    error?: string;
  } | null;

  if (payload?.error) {
    throw new Error(`Artifact signing failed for ${path}: ${payload.error}`);
  }

  const signedUrl = payload?.signed_url ?? payload?.signedUrl;
  if (!signedUrl) throw new Error(`Artifact signing returned no URL for ${path}`);

  artifactSignedUrlCache.set(path, signedUrl);
  return signedUrl;
}

/** Force re-sign (call this if an image load fails because the URL expired). */
export function invalidateArtifactSignedUrl(path: string) {
  artifactSignedUrlCache.delete(path);
}

/** Resolve a `sourceRasterRef` to a fresh signed background image URL. */
export async function resolveRasterRefUrl(ref: PdfImportRasterRef): Promise<string> {
  try {
    return await getArtifactSignedUrl(ref.path);
  } catch (e) {
    invalidateArtifactSignedUrl(ref.path);
    throw e;
  }
}

/** Download the Phase 3 raster manifest JSON via the same signed-URL bridge. */
export async function downloadRasterManifest(path: string): Promise<RasterManifest> {
  const signedUrl = await getArtifactSignedUrl(path);
  const res = await fetch(signedUrl);
  if (!res.ok) {
    invalidateArtifactSignedUrl(path);
    throw new Error(`Raster manifest fetch failed for ${path}: HTTP ${res.status}`);
  }
  return (await res.json()) as RasterManifest;
}
