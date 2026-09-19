// import-from-url — safely fetch a public document by link, server-side.
//
// The client normalises a share link (Google Drive/Docs/Slides/Sheets, Dropbox,
// OneDrive/SharePoint, generic) into a direct `fetchUrl` and posts it here.
// This function does the cross-origin fetch the browser can't, behind:
//   - auth (same session check as the rest of the app),
//   - SSRF guards (block private/reserved hosts on every redirect hop),
//   - size + time limits,
// and returns the bytes as base64 (or guidance when the link isn't a file).
// Figma links are exported via the Figma API when FIGMA_TOKEN is configured.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
// The SSRF guard this function's header promises. It was CALLED and never
// imported: `assertPublicUrl` and `DnsRecordType` sat in
// `functions-registry/edge-missing-names.txt` as known-absent identifiers,
// so every redirect hop threw ReferenceError instead of being checked.
import { assertPublicUrl, type DnsRecordType } from '../_shared/ssrfGuard.ts';
import { verifyAuthOrNativeUser, createTokenAuthCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { csrfDenied, enforceCsrf } from '../_shared/csrfGuard.ts';
import { sanitizeFigmaFrame, type SanitizedFigmaNode } from '../_shared/figma.ts';
import { internalError } from '../_shared/errorResponse.ts';

const MAX_BYTES = 30 * 1024 * 1024; // 30 MB
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 20000;

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const resolveDns = (hostname: string, recordType: DnsRecordType) => Deno.resolveDns(hostname, recordType);

function base64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

function filenameFrom(url: URL, contentType: string): string {
  const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
  if (/\.[a-z0-9]{2,5}$/i.test(last)) return last;
  const ext = contentType.includes('pdf') ? 'pdf'
    : contentType.includes('png') ? 'png'
    : contentType.includes('jpeg') ? 'jpg'
    : contentType.includes('webp') ? 'webp' : 'bin';
  return `import.${ext}`;
}

/** Fetch following redirects manually so every hop is SSRF-checked. */
async function safeFetch(startUrl: string): Promise<{ res: Response; finalUrl: URL }> {
  let current = await assertPublicUrl(startUrl, resolveDns);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'NPC-Importer/1.0', Accept: '*/*' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const loc = new URL(res.headers.get('location')!, current);
      current = await assertPublicUrl(loc.toString(), resolveDns);
      continue;
    }
    return { res, finalUrl: current };
  }
  throw new Error('Too many redirects');
}

/**
 * Best-effort Figma export (needs FIGMA_TOKEN). Returns the first frame as a PNG
 * and a minimal, visible-only node projection (`figmaFrame`) so the client can
 * ground on exact text/positions/colours without exposing provider metadata.
 * The PNG fields stay for backwards compatibility (older clients use the image flow).
 */
async function figmaExport(key: string, cors: Record<string, string>): Promise<Response | null> {
  const token = Deno.env.get('FIGMA_TOKEN');
  if (!token || !key) return null;
  try {
    const fileRes = await fetch(`https://api.figma.com/v1/files/${key}?depth=1`, { headers: { 'X-Figma-Token': token } });
    if (!fileRes.ok) return null;
    const file = await fileRes.json();
    const firstPage = file?.document?.children?.[0];
    const pageId: string | undefined = firstPage?.id;
    const name: string = file?.name || 'Figma import';
    if (!pageId) return null;

    // Deep-fetch the page subtree → ground on the first frame's real nodes.
    let figmaFrame: SanitizedFigmaNode | null = null;
    let exportNodeId = pageId;
    try {
      const nodesRes = await fetch(`https://api.figma.com/v1/files/${key}/nodes?ids=${encodeURIComponent(pageId)}`, { headers: { 'X-Figma-Token': token } });
      if (nodesRes.ok) {
        const nodesJson = await nodesRes.json();
        const pageNode = nodesJson?.nodes?.[pageId]?.document;
        const firstFrame = pageNode?.children?.find((c: any) => c?.type === 'FRAME');
        if (firstFrame) {
          figmaFrame = sanitizeFigmaFrame(firstFrame);
          exportNodeId = firstFrame.id;
        }
      }
    } catch { /* grounding is best-effort; PNG path still works */ }

    const imgRes = await fetch(`https://api.figma.com/v1/images/${key}?ids=${encodeURIComponent(exportNodeId)}&format=png&scale=2`, { headers: { 'X-Figma-Token': token } });
    if (!imgRes.ok) return null;
    const imgJson = await imgRes.json();
    const imageUrl: string | undefined = imgJson?.images?.[exportNodeId];
    if (!imageUrl) return null;
    const { res, finalUrl } = await safeFetch(imageUrl);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return null;
    return json({
      kind: 'image',
      provider: 'figma',
      contentType: res.headers.get('content-type') || 'image/png',
      filename: `${name}.png`,
      dataBase64: base64(buf),
      finalUrl: finalUrl.toString(),
      figmaFrame,
    }, 200, cors);
  } catch (_e) {
    return null;
  }
}

Deno.serve(async (req) => {
  // Origin-aware: an allowlisted origin gets an exact ACAO + credentials so the
  // HttpOnly `__Host-session_token` cookie authenticates the import. Anyone else
  // keeps the historical wildcard token-auth answer.
  const cors = createTokenAuthCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  // Ambient cookie authority requires an exact-origin check; no-ops for
  // token-only callers, which send no cookie.
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(cors, csrf);

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const { error: authError } = await verifyAuthOrNativeUser(supabase, req, body);
    if (authError) return createUnauthorizedResponse(authError, cors);

    const provider: string = String(body.provider || 'generic');
    const fetchUrl: string = String(body.fetchUrl || body.url || '').trim();
    const resourceId: string = String(body.resourceId || '');
    if (!fetchUrl) return json({ error: 'Missing url' }, 400, cors);

    // Figma: try a programmatic export first (falls through to guidance).
    if (provider === 'figma') {
      const exported = await figmaExport(resourceId, cors);
      if (exported) return exported;
      return json({
        kind: 'needs_export', provider,
        guidance: 'This Figma link needs an export. Configure a FIGMA_TOKEN to import frames automatically, or use File → Export → PDF and paste that link.',
      }, 200, cors);
    }

    let result: { res: Response; finalUrl: URL };
    try {
      result = await safeFetch(fetchUrl);
    } catch (e) {
      return json({ error: (e as Error).message || 'Fetch failed' }, 400, cors);
    }
    const { res, finalUrl } = result;
    if (!res.ok) {
      return json({ error: `Source returned ${res.status}. Make sure the link is set to “anyone with the link”.` }, 400, cors);
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const lenHeader = Number(res.headers.get('content-length') || '0');
    if (lenHeader && lenHeader > MAX_BYTES) {
      return json({ error: `File too large (${Math.round(lenHeader / 1024 / 1024)} MB, max 30 MB).` }, 400, cors);
    }

    // A login/preview wall returns HTML instead of the file.
    if (contentType.includes('text/html')) {
      return json({
        kind: 'needs_export', provider,
        finalUrl: finalUrl.toString(),
        guidance: 'The link returned a web page, not a file — it likely needs sign-in or isn’t publicly shared. Set sharing to “anyone with the link”, or export to PDF and paste that link.',
      }, 200, cors);
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      return json({ error: 'File too large (max 30 MB).' }, 400, cors);
    }

    const kind = contentType.includes('pdf') ? 'pdf'
      : contentType.startsWith('image/') ? 'image'
      : /\.pdf($|\?)/i.test(finalUrl.pathname) ? 'pdf'
      : /\.(png|jpe?g|webp|gif|bmp|avif)($|\?)/i.test(finalUrl.pathname) ? 'image'
      : 'file';

    return json({
      kind,
      provider,
      contentType: contentType || 'application/octet-stream',
      filename: filenameFrom(finalUrl, contentType),
      dataBase64: base64(buf),
      finalUrl: finalUrl.toString(),
    }, 200, cors);
  } catch (e) {
    return json({ ...internalError(e, 'import-from-url') }, 500, cors);
  }
});
