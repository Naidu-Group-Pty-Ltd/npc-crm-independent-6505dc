/**
 * Reading a stored file reference.
 *
 * `investment_reports.pdf_url`, `client_files.file_path`,
 * `portfolio_analysis_reports.pdf_file_path` and
 * `client_portal_reports.storage_path` are all "where the file is", and over
 * time each has been written in a different shape by a different writer:
 *
 *   1. `generated/2026-07-08/uuid-report.pdf`      — a storage key (correct)
 *   2. `https://…/storage/v1/object/public/investment-reports/<key>`
 *   3. `https://…/storage/v1/object/sign/investment-reports/<key>?token=…`
 *   4. `{"path":"…","fullPath":"client-files/…"}`  — a stringified upload result
 *
 * `ClientReportsTab` handled 1 and 4 and passed 2 and 3 through untouched — so
 * a full URL was handed to `secureStorageDownload(bucket, path)` where a key
 * belongs. Both the primary call and its fallback failed, and the user got
 * "Failed to download report" on every report that had one of those URLs.
 *
 * Shape 2 is worse than it looks: the `investment-reports` bucket is
 * **private**, so a `/object/public/` URL does not resolve for anyone, in a
 * browser or otherwise. Those rows were never downloadable by following the
 * link either. The key inside the URL is still good, which is what makes them
 * recoverable — extract it and sign it.
 */

/** A file, as somewhere to fetch it from. */
export interface StorageRef {
  /** `null` when the reference did not name one and the caller must decide. */
  bucket: string | null;
  /** The object key within the bucket. Never a URL. */
  path: string;
}

/**
 * Matches the two Supabase object routes.
 *
 * `/object/public/<bucket>/<key>`, `/object/sign/<bucket>/<key>` and the
 * authenticated `/object/<bucket>/<key>` all appear in this database.
 */
const SUPABASE_OBJECT = /\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?([^/]+)\/(.+)$/;

/**
 * Turn whatever is stored into a bucket and a key.
 *
 * Never throws and never returns a URL: a caller that gets a `path` back can
 * always hand it to the storage client. When the shape is unrecognisable the
 * input is returned as the path, which is the old behaviour and is right for a
 * bare key.
 */
export function parseStorageRef(raw: string | null | undefined): StorageRef {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { bucket: null, path: '' };

  // A stringified `secureStorageUpload` response. `fullPath` includes the
  // bucket; `path` does not.
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { path?: unknown; fullPath?: unknown };
      if (typeof parsed.fullPath === 'string' && parsed.fullPath) {
        const [bucket, ...rest] = parsed.fullPath.split('/');
        if (rest.length) return { bucket, path: rest.join('/') };
      }
      if (typeof parsed.path === 'string' && parsed.path) {
        return { bucket: null, path: parsed.path };
      }
    } catch {
      // Not JSON after all; fall through and treat it as a key.
    }
    return { bucket: null, path: trimmed };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const match = SUPABASE_OBJECT.exec(trimmed.split('?')[0]);
    if (match) {
      // The key is percent-encoded in a URL and must not be when it goes back
      // to the storage client — a file with a space in its name round-trips as
      // `%20` and 404s.
      let path = match[2];
      try {
        path = decodeURIComponent(path);
      } catch {
        // A malformed escape sequence: keep the raw form rather than throwing.
      }
      return { bucket: match[1], path };
    }
    // Some other host entirely. There is no key to extract, and the caller
    // needs to know that rather than being handed a broken path.
    return { bucket: null, path: trimmed };
  }

  return { bucket: null, path: trimmed };
}

/** True when the reference points somewhere this app cannot sign. */
export function isExternalUrl(raw: string | null | undefined): boolean {
  const ref = parseStorageRef(raw);
  return /^https?:\/\//i.test(ref.path);
}

/**
 * The buckets to try, in order.
 *
 * When the reference named one, that is the only sensible candidate. When it
 * did not, the caller's preferred bucket is tried first and the other after —
 * which is what the existing download already did, kept because the two
 * buckets genuinely both hold report files from different eras.
 */
export function bucketCandidates(ref: StorageRef, preferred: string, fallback: string): string[] {
  if (ref.bucket) return [ref.bucket];
  return preferred === fallback ? [preferred] : [preferred, fallback];
}
