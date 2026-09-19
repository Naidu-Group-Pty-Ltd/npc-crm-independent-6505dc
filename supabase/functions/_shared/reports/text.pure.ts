/**
 * Text handling shared by every report format.
 *
 * Nothing here is here for tidiness. Each function is a repair for text that
 * arrives from somewhere this repo does not control — a model's prose, a
 * transcribed PDF, a textarea somebody typed into — and each one is here rather
 * than in a format module because a second copy is the defect this programme
 * removes.
 */

/**
 * Turn a URL in model prose back into plain text.
 *
 * Not hygiene — a correctness fix for a failure that takes the whole document
 * down. `assertSafeRenderResources` decodes HTML entities *first*
 * (`renderResourcePolicy.pure.ts:68`) and then throws on any `//host`,
 * `http(s)://`, `file:`, `ftp:` or `gopher:` token **anywhere in the HTML**,
 * including inside escaped body text:
 *
 *     Remote render resources must be normalized into project storage
 *
 * So a model that writes "per corelogic.com.au/median-values" with a scheme on
 * the front fails the render with an error naming no field and no line. Escaping
 * does not help: the policy undoes it before it looks.
 *
 * The scheme and its slashes are removed and the rest of the token kept, so the
 * sentence still reads and still says where the claim came from — `URL_TOKEN`
 * does not match a bare host. Dropping the whole token would silently delete a
 * citation from a client's document, which is a worse answer than a link that
 * is not clickable in a PDF anyway.
 *
 * ## Run this *after* any pass that removes characters
 *
 * Stripping zero-width characters is what *creates* a scheme-relative URL. A
 * slash, a U+200B, a slash is inert until the zero-width space goes, and then it
 * is a live `//` the policy throws on. Any sanitiser that deletes codepoints —
 * the Q&A export's glyph pass is the one that does — must run before this,
 * never after.
 */
export function neutraliseUrls(value: string): string {
  return value
    .replace(/(?:https?:)?\/\/+/gi, '')
    .replace(/\b(?:file|ftp|gopher):\/*/gi, '');
}

/** How many URL tokens `neutraliseUrls` would rewrite. For a ledger count. */
export function countUrlTokens(value: string): number {
  const schemeRelative = value.match(/(?:https?:)?\/\/+/gi)?.length ?? 0;
  const otherSchemes = value.match(/\b(?:file|ftp|gopher):\/*/gi)?.length ?? 0;
  return schemeRelative + otherSchemes;
}

/**
 * Eight or more fraction digits is not precision, it is a binary float printed
 * raw. Nothing this repo reports — a rate, a dollar, a ratio — carries that.
 */
const LONG_DECIMAL = /\b(\d{1,15})\.(\d{8,})\b/g;

/**
 * Repair IEEE-754 artefacts in transcribed text.
 *
 * `9.440000000000001%` is what a rate looks like when it was summed before it
 * was displayed, and a real Borrowing Capacity Snapshot printed exactly that in
 * its assumptions table. The converter transcribes what it is given, so the
 * artefact came through onto a page a client would read.
 *
 * Twelve significant figures is comfortably more than any figure in this
 * product needs and comfortably fewer than the seventeen at which the artefact
 * appears, so the round trip removes the noise and cannot touch the value:
 * `9.440000000000001` and `9.44` are the same number to any use anybody has for
 * it. Applied at *extraction*, before the faithfulness snapshot is taken, so
 * the guard and the output are comparing the same string — normalising later
 * would make the design pass look as though it had invented a figure.
 *
 * Non-numeric text, ordinary decimals and version strings are untouched: the
 * pattern needs eight fraction digits before it looks at anything.
 */
export function repairFloatArtefacts(value: string): string {
  return String(value ?? '').replace(LONG_DECIMAL, (whole, int: string, frac: string) => {
    const n = Number(`${int}.${frac}`);
    if (!Number.isFinite(n)) return whole;
    const tidied = Number(n.toPrecision(12));
    // Only when the long form really was noise. A number that needs all those
    // digits keeps them.
    return String(tidied).length < whole.length ? String(tidied) : whole;
  });
}
