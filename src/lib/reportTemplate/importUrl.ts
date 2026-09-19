/**
 * Pure URL-import normalisation (import a reference by link).
 *
 * Turns a pasted share/view link into a directly-fetchable file/export URL and
 * classifies what we expect back, so the importer can route a Google Drive PDF,
 * a Google Slides deck, a Dropbox image, etc. straight into the reconstruction
 * pipeline — and give clear guidance for app links (Figma/Canva/Gamma) that
 * have no public file URL.
 *
 * Pure + unit-tested. The actual cross-origin fetch (with SSRF guards) happens
 * server-side in the `import-from-url` edge function, which mirrors these rules.
 */

export type ImportProvider =
  | 'google-drive'
  | 'google-doc'
  | 'google-slides'
  | 'google-sheets'
  | 'dropbox'
  | 'onedrive'
  | 'sharepoint'
  | 'figma'
  | 'canva'
  | 'gamma'
  | 'generic';

export type ImportKind = 'pdf' | 'image' | 'html' | 'file' | 'unknown';

export interface NormalizedImport {
  provider: ImportProvider;
  /** A directly-fetchable download/export URL (or the original if no rewrite). */
  fetchUrl: string;
  /** Best guess of the content kind after fetching. */
  expectedKind: ImportKind;
  /** True when the provider has no public file URL — needs a manual export. */
  needsExport: boolean;
  /** Human guidance shown when export is needed or handling is special. */
  guidance?: string;
  /** Provider resource id/key when extractable (Drive id, Figma key, …). */
  resourceId?: string;
}

export function isHttpUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Detect known providers so the UI can hint + the normaliser can rewrite. */
export function detectProvider(rawUrl: string): ImportProvider {
  let u: URL;
  try { u = new URL(rawUrl.trim()); } catch { return 'generic'; }
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  if (host.includes('drive.google.com')) return 'google-drive';
  if (host.includes('docs.google.com')) {
    if (path.includes('/document/')) return 'google-doc';
    if (path.includes('/presentation/')) return 'google-slides';
    if (path.includes('/spreadsheets/')) return 'google-sheets';
    return 'google-drive';
  }
  if (host.endsWith('dropbox.com') || host.includes('dropboxusercontent.com')) return 'dropbox';
  if (host.includes('1drv.ms') || host.includes('onedrive.live.com')) return 'onedrive';
  if (host.includes('sharepoint.com')) return 'sharepoint';
  if (host.includes('figma.com')) return 'figma';
  if (host.includes('canva.com')) return 'canva';
  if (host.includes('gamma.app')) return 'gamma';
  return 'generic';
}

function kindFromExtension(pathname: string): ImportKind {
  const p = pathname.toLowerCase();
  if (/\.pdf$/.test(p)) return 'pdf';
  if (/\.(png|jpe?g|webp|gif|bmp|heic|heif|avif|svg)$/.test(p)) return 'image';
  if (/\.(html?|aspx)$/.test(p)) return 'html';
  return 'unknown';
}

const firstMatch = (s: string, res: RegExp[]): string | undefined => {
  for (const re of res) { const m = s.match(re); if (m?.[1]) return m[1]; }
  return undefined;
};

const googleId = (url: string): string | undefined =>
  firstMatch(url, [/\/d\/([a-zA-Z0-9_-]{10,})/, /[?&]id=([a-zA-Z0-9_-]{10,})/]);

const figmaKey = (url: string): string | undefined =>
  firstMatch(url, [/figma\.com\/(?:file|design|proto|board)\/([a-zA-Z0-9]{10,})/i]);

/**
 * Normalise a share/view link into a fetchable URL + expectations. Unknown
 * hosts pass through unchanged (kind guessed from the extension).
 */
export function normalizeImportUrl(rawUrl: string): NormalizedImport {
  const url = rawUrl.trim();
  const provider = detectProvider(url);
  let parsed: URL | null = null;
  try { parsed = new URL(url); } catch { /* keep null */ }
  const pathname = parsed?.pathname ?? '';

  switch (provider) {
    case 'google-drive': {
      const id = googleId(url);
      if (id) {
        return {
          provider, resourceId: id, needsExport: false, expectedKind: 'file',
          fetchUrl: `https://drive.google.com/uc?export=download&id=${id}`,
        };
      }
      return { provider, fetchUrl: url, expectedKind: 'unknown', needsExport: false };
    }
    case 'google-doc': {
      const id = googleId(url);
      return id
        ? { provider, resourceId: id, needsExport: false, expectedKind: 'pdf', fetchUrl: `https://docs.google.com/document/d/${id}/export?format=pdf` }
        : { provider, fetchUrl: url, expectedKind: 'pdf', needsExport: false };
    }
    case 'google-slides': {
      const id = googleId(url);
      return id
        ? { provider, resourceId: id, needsExport: false, expectedKind: 'pdf', fetchUrl: `https://docs.google.com/presentation/d/${id}/export/pdf` }
        : { provider, fetchUrl: url, expectedKind: 'pdf', needsExport: false };
    }
    case 'google-sheets': {
      const id = googleId(url);
      return id
        ? { provider, resourceId: id, needsExport: false, expectedKind: 'pdf', fetchUrl: `https://docs.google.com/spreadsheets/d/${id}/export?format=pdf` }
        : { provider, fetchUrl: url, expectedKind: 'pdf', needsExport: false };
    }
    case 'dropbox': {
      // Force a direct download (dl=1) on the content host.
      let fetchUrl = url
        .replace('://www.dropbox.com', '://dl.dropboxusercontent.com')
        .replace('://dropbox.com', '://dl.dropboxusercontent.com');
      if (/[?&]dl=0/.test(fetchUrl)) fetchUrl = fetchUrl.replace(/([?&])dl=0/, '$1dl=1');
      else if (!/[?&]dl=1/.test(fetchUrl)) fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'dl=1';
      return { provider, fetchUrl, expectedKind: kindFromExtension(pathname), needsExport: false };
    }
    case 'onedrive':
    case 'sharepoint': {
      // Best-effort direct download; many OneDrive/SharePoint share links honour download=1.
      const fetchUrl = /[?&]download=1/.test(url) ? url : url + (url.includes('?') ? '&' : '?') + 'download=1';
      return {
        provider, fetchUrl, expectedKind: kindFromExtension(pathname) === 'unknown' ? 'file' : kindFromExtension(pathname),
        needsExport: false,
        guidance: 'OneDrive/SharePoint links must be set to “Anyone with the link”. If it fails, use Download and paste the direct file link.',
      };
    }
    case 'figma': {
      const key = figmaKey(url);
      return {
        provider, resourceId: key, fetchUrl: url, expectedKind: 'html', needsExport: true,
        guidance: 'Figma designs are rendered, not files. If a Figma access token is configured we export the frames automatically; otherwise use File → Export → PDF and paste that link.',
      };
    }
    case 'canva':
      return {
        provider, fetchUrl: url, expectedKind: 'html', needsExport: true,
        guidance: 'Canva has no public file link. Use Share → Download → PDF, then paste that download link (or drop the file).',
      };
    case 'gamma':
      return {
        provider, fetchUrl: url, expectedKind: 'html', needsExport: true,
        guidance: 'Gamma has no public file link. Export to PDF (or PNG) and paste that link, or drop the file.',
      };
    default:
      return { provider: 'generic', fetchUrl: url, expectedKind: kindFromExtension(pathname), needsExport: false };
  }
}

/** A reasonable template name derived from the link. */
export function suggestedName(rawUrl: string, provider: ImportProvider): string {
  try {
    const u = new URL(rawUrl.trim());
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    const base = last.replace(/\.[a-z0-9]+$/i, '');
    const generic = /^(d|view|edit|preview|present|pub)$/i.test(base) || /^[a-z0-9_-]{20,}$/i.test(base);
    if (base && !generic) return base.replace(/[-_]+/g, ' ').trim();
    return `${provider.replace(/-/g, ' ')} import`;
  } catch {
    return 'URL import';
  }
}

/**
 * SSRF guard: reject hostnames that resolve to local/private/reserved space.
 * Used server-side on every fetch hop (mirrored in the edge function); also
 * lets the client pre-warn. Conservative — when unsure, treat as private.
 */
export function isLikelyPrivateHost(hostname: string): boolean {
  const h = (hostname || '').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === '::1' || h === '::' ) return true;
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true; // IPv6 link-local / ULA
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;     // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true;                    // multicast / reserved
  }
  return false;
}
