/** Resource policy for HTML sent to the server-side PDF renderer.
 *
 * Render HTML is client supplied, so every network URL the renderer could
 * FETCH must be treated as an SSRF primitive. Render jobs may use embedded
 * data resources or objects from this project's Supabase origin; all other
 * network/file references must be normalized by the client before the HTML
 * reaches this trust boundary.
 *
 * ## What "could fetch" means, and why it is the whole rule
 *
 * This scanned the entire document as one string and refused any URL-shaped
 * substring anywhere in it — including in the visible text of the report. That
 * is not a boundary, it is a text filter, and it was refusing documents on
 * their prose: **808 of 1,182 investment reports carry a URL in their
 * content**, so a Compass report that cited a planning portal, or an
 * introduction that printed the firm's own website, failed to render at all.
 * The failure was invisible for the reason `docs/reports/RENDER_BOUNDARY.md`
 * records — the caller fell back to its legacy generator and a document still
 * arrived.
 *
 * WeasyPrint has no JavaScript engine and resolves a URL in exactly three
 * kinds of place: an element attribute, a CSS `url()` / `@import`, and the
 * inline `style` attribute that is a special case of the second. A URL sitting
 * in a text node is drawn as characters on a page. Nothing requests it, so
 * there is nothing to defend against, and refusing it protects nobody while
 * costing two thirds of the report catalogue.
 *
 * So the scan is now positional: **attribute values and stylesheet bodies are
 * judged; text between tags is not.**
 *
 * ## It is still generous about what counts as a position
 *
 * Deliberately, every attribute is judged rather than a list of the ones
 * WeasyPrint is known to fetch. Getting that list wrong in the narrow
 * direction reintroduces exactly the SSRF this exists to stop, and the cost of
 * being wrong in the generous direction is a refused document — loud, and
 * recoverable. `<img data-xmlns="http://169.254.169.254/…">` is refused for
 * that reason: `data-*` is not fetched by anything, and it is judged anyway.
 *
 * Two attributes are exempt, and only two:
 *
 * - `xmlns` / `xmlns:prefix` — an identifier compared as a string, never
 *   fetched. Every inline SVG in this codebase opens with one, and rejecting
 *   it rejected the whole document: the Borrowing Capacity Snapshot never
 *   rendered once, and any template carrying a QR code failed the same way.
 * - `href` on `<a>` — a link annotation in the output PDF, not a request. The
 *   renderer emits one for every link overlay and for each table-of-contents
 *   row, so refusing it made an external hyperlink unrenderable.
 *
 * `href` anywhere else — on `<link>`, on SVG `<image>` and `<use>` — is a
 * fetch, and is judged.
 */

const URL_TOKEN = /(?:https?:)?\/\/[^\s"'<>),]+|(?:file|ftp|gopher):[^\s"'<>),]+/gi;

/** A tag and its raw attribute text; quoted values may contain `>`. */
const TAG = /<([a-zA-Z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

/** One attribute inside a tag's attribute text. */
const ATTRIBUTE = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/** `<style>…</style>` bodies, which are CSS and therefore fetch positions. */
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;

/** `xmlns` and `xmlns:prefix`, which are identifiers rather than resources. */
const XMLNS_ATTRIBUTE = /^xmlns(?::|$)/i;

/**
 * The base64 payload of a `data:` URI, which is opaque bytes and not markup.
 *
 * The base64 alphabet includes `/`, so any embedded image large enough will
 * eventually contain `//` — and `URL_TOKEN` reads that as a scheme-relative
 * URL and rejects the document. A 240 KB logo hits it essentially every time,
 * which is why inlining a brand asset (the thing `assets.pure.ts` requires)
 * made the render fail with "Remote render resources must be normalized into
 * project storage" and pointed at nothing.
 *
 * Only the **base64** form is skipped. A `data:` URI without `;base64` carries
 * percent-encoded text — an SVG document, say — which can name a real host and
 * therefore stays under the policy. The media type prefix is left in the text
 * being scanned too, so nothing about *what* the URI claims to be is hidden.
 */
const DATA_URI_BASE64_PAYLOAD = /;base64,[A-Za-z0-9+/=]*/g;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);?/g, (_match, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([\da-f]+);?/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&colon;/gi, ':')
    .replace(/&sol;/gi, '/')
    .replace(/&amp;/gi, '&');
}

function configuredOrigin(rawSupabaseUrl: string): string {
  try {
    const url = new URL(rawSupabaseUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

/** Why a single reference may not be fetched, or `null` when it may. */
export type ResourceRefusal =
  | 'forbidden_scheme'
  | 'invalid_url'
  | 'off_origin';

/**
 * Judge ONE reference — the whole rule, in one place.
 *
 * Exported because the client normalises assets against the same rule before
 * sending them (`imagePreloader.ts`). Two copies of a boundary is how the two
 * ends come to disagree about what is admissible, and the disagreement shows
 * up as a document that renders in preview and 500s in production.
 */
export function refuseRenderResource(
  token: string,
  supabaseUrl: string,
): ResourceRefusal | null {
  const allowedOrigin = configuredOrigin(supabaseUrl);
  if (!token.startsWith('http://') && !token.startsWith('https://') && !token.startsWith('//')) {
    return 'forbidden_scheme';
  }
  let url: URL;
  try {
    url = new URL(token, allowedOrigin || undefined);
  } catch {
    return 'invalid_url';
  }
  const isProjectStorageObject = allowedOrigin
    && url.origin === allowedOrigin
    && url.pathname.startsWith('/storage/v1/object/');
  return isProjectStorageObject ? null : 'off_origin';
}

/**
 * May this URL be handed to the renderer as-is?
 *
 * The positive form of `refuseRenderResource`, for the client-side normaliser:
 * an asset that answers false must be inlined as a `data:` URI or dropped
 * before it reaches the render call.
 */
export function isAdmissibleRenderResource(url: string, supabaseUrl: string): boolean {
  if (!url) return true;
  // A `data:` URI travels with the document and is never fetched.
  if (/^data:/i.test(url)) return true;
  // A relative reference resolves against the document, which has no base — it
  // is not a network fetch and the renderer treats it as unresolvable.
  if (!/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url)) return true;
  return refuseRenderResource(url, supabaseUrl) === null;
}

/** Every reference the renderer could fetch, in document order. */
function fetchableReferences(html: string): string[] {
  const decoded = decodeHtmlEntities(html).replace(DATA_URI_BASE64_PAYLOAD, ';base64,');
  const out: string[] = [];
  const collect = (text: string): void => {
    for (const token of text.match(URL_TOKEN) ?? []) out.push(token);
  };

  // Stylesheet bodies. Scanned whole rather than by `url()` / `@import`: CSS
  // has several fetching properties and vendor-prefixed spellings of them, and
  // a missed one is an SSRF while a false positive is a refused document.
  for (const [, body] of decoded.matchAll(STYLE_BLOCK)) collect(body);

  // Attribute values, everywhere. Text between tags is deliberately not read;
  // see this file's header.
  for (const [, tagName, attributeText] of decoded.matchAll(TAG)) {
    const isAnchor = tagName.toLowerCase() === 'a';
    for (const attr of attributeText.matchAll(ATTRIBUTE)) {
      const name = attr[1];
      if (XMLNS_ATTRIBUTE.test(name)) continue;
      if (isAnchor && name.toLowerCase() === 'href') continue;
      collect(attr[2] ?? attr[3] ?? attr[4] ?? '');
    }
  }
  return out;
}

/**
 * The first reference the renderer may not fetch, or null when the document is
 * safe. Non-throwing, so a caller can report rather than fail.
 */
export function findForbiddenRenderResource(
  html: string,
  supabaseUrl: string,
): { url: string; reason: ResourceRefusal } | null {
  for (const token of fetchableReferences(html)) {
    const reason = refuseRenderResource(token, supabaseUrl);
    if (reason) return { url: token, reason };
  }
  return null;
}

/** Throws before WeasyPrint is invoked if HTML could make a network request. */
export function assertSafeRenderResources(html: string, supabaseUrl: string): void {
  const forbidden = findForbiddenRenderResource(html, supabaseUrl);
  if (!forbidden) return;
  if (forbidden.reason === 'forbidden_scheme') {
    throw new Error('Render HTML contains a forbidden resource scheme');
  }
  if (forbidden.reason === 'invalid_url') {
    throw new Error('Render HTML contains an invalid resource URL');
  }
  // Name the offender.
  //
  // This threw a bare sentence for three years and it pointed at nothing — the
  // caller got a 500 whose text could not distinguish a stray import from an
  // un-normalised logo, and the comments above record two separate occasions
  // when that cost a debugging session. The third was worse: all 500 seeded
  // masters emit `@import url('https://fonts.googleapis.com/…')` from
  // `tokens.fontFaces`, so every design-system render was refused here,
  // silently, and the message said only that something remote was present. The
  // URL came from the caller's own HTML, so echoing it back discloses nothing
  // it did not send.
  let named = forbidden.url;
  try {
    const parsed = new URL(forbidden.url, configuredOrigin(supabaseUrl) || undefined);
    named = `${parsed.origin}${parsed.pathname}`;
  } catch { /* keep the raw token */ }
  throw new Error(
    'Remote render resources must be normalized into project storage; '
    + `refused ${named}`,
  );
}
