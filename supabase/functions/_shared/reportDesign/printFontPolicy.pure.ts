/**
 * Which typeface a *printed* document may name.
 *
 * ## The failure this exists to stop
 *
 * `render-template-pdf` runs `assertSafeRenderResources` over the HTML before
 * it invokes WeasyPrint, and that gate admits exactly two things: `data:`
 * payloads and objects under this project's own Supabase storage origin. Every
 * other URL — of any host, for any purpose — throws
 * "Remote render resources must be normalized into project storage".
 *
 * All 500 Investment Compass masters carry `tokens.fontFaces` entries with a
 * Google Fonts `cssUrl`, because that is how a template names a webfont for the
 * **browser** preview. `tokensToFontFaceCss` emitted each one as
 * `@import url('https://fonts.googleapis.com/…')`, so every design-system
 * render this product attempted was rejected at that boundary — 2,838 `cssUrl`
 * references across the seeded catalogue, and one is enough to fail a document.
 *
 * The rejection left no trace. The assertion ran *before* `templateId` was read
 * and before the `template_render_jobs` row was inserted, so a refused render
 * wrote neither a job row nor a `template_events` row; the route reported
 * `render_failed`, the caller fell through to its legacy generator, and a
 * perfectly good document came out in the standard layout. Measured on 14
 * August 2026: 10 of 10 downloads that day came from the composer, `0`
 * `template_render_jobs` rows since 11 August, and `0` `template_events`
 * failures since 6 August. A person choosing a template got a picker that
 * remembered the choice and a document that never used it.
 *
 * ## The rule
 *
 * **For print, the container is the font source.** The image installs its faces
 * and `typography.pure.ts` is the contract for what it has; a printed document
 * names a family and fontconfig resolves it, with no network involved. That is
 * already how the ten legacy WeasyPrint report formats work, and it is why they
 * render while the design system does not.
 *
 * So the print path emits **no remote stylesheet at all**. What it must not do
 * is drop the link and say nothing: a `font-family` naming a face the image
 * does not have produces no warning from the engine, no log line, and a
 * document set in the default serif that only a client discovers. So a family
 * the container lacks is **substituted for one it has, explicitly, here** —
 * never left to fontconfig's guess.
 *
 * ## Why the substitution applies to the preview as well
 *
 * Two of the catalogue's nine families are not in the image, so a preview that
 * fetched them from Google would show a document the printer cannot produce.
 * The substitution is therefore applied wherever the template is drawn, and the
 * *stylesheet* is the only thing the print path removes. What you see is what
 * prints, which is the whole reason the preview exists.
 *
 * ## Retiring a row
 *
 * A substitution is a stopgap for a face the image lacks, not a design
 * decision. Ship the real face — a Debian package in the Dockerfile's
 * `apt-get`, or a TTF in `weasyprint-service/fonts/` with its OFL — add it to
 * `CONTAINER_FONT_PACKAGES` / `CONTAINER_FONT_FILES`, and delete the row. The
 * container ships on its own deploy and is promoted by hand
 * (`docs/reports/CONTAINER_RELEASE.md`), which is why the map exists rather
 * than a container change being a prerequisite for the render working at all.
 */
import { CONTAINER_INSTALLED_FAMILIES } from './typography.pure.ts';

/**
 * Families the seeded catalogue names that the WeasyPrint image does not have,
 * and the installed face each is drawn with instead.
 *
 * Both substitutes are chosen for the same *role and shape* as the original, so
 * the page's colour and rhythm survive: the stack's generic (`serif` /
 * `sans-serif`) is what a fontconfig fallback would honour, and this keeps a
 * designed face in front of it.
 *
 * - **Fraunces** (24 references) is a high-contrast display serif. Playfair
 *   Display is the image's display serif and the closest thing it carries. The
 *   Dockerfile's own note records Fraunces being dropped from the report type
 *   stacks for exactly this reason — no Debian binary package exists — and the
 *   catalogue was generated afterwards without being told.
 * - **Public Sans** (84 references) is a neutral grotesque cut for US federal
 *   use. Inter is the image's neutral grotesque, and the two share a near
 *   identical x-height and set width, so line breaks move very little.
 *
 * Keys are matched case-insensitively on the family name only, never on the
 * whole stack.
 */
export const PRINT_FONT_SUBSTITUTIONS: Readonly<Record<string, string>> = {
  'Fraunces': 'Playfair Display',
  'Public Sans': 'Inter',
};

const INSTALLED = new Set(CONTAINER_INSTALLED_FAMILIES.map((f) => f.toLowerCase()));
const SUBSTITUTIONS = new Map(
  Object.entries(PRINT_FONT_SUBSTITUTIONS).map(([from, to]) => [from.toLowerCase(), to]),
);

/** Is this family one the render container can actually set type in? */
export function isContainerInstalledFamily(family: string): boolean {
  return INSTALLED.has(String(family ?? '').trim().replace(/^['"]|['"]$/g, '').toLowerCase());
}

/**
 * The family a printed document should name in place of this one.
 *
 * Returns the family unchanged when the container has it, or when nothing here
 * knows a substitute — an unknown family is left alone rather than guessed at,
 * because a wrong substitution is worse than the generic fallback and
 * `unsubstitutedPrintFamilies` is what turns the gap into a failing spec.
 */
export function substitutePrintFamily(family: string): string {
  const name = String(family ?? '').trim().replace(/^['"]|['"]$/g, '');
  if (!name || isContainerInstalledFamily(name)) return name;
  return SUBSTITUTIONS.get(name.toLowerCase()) ?? name;
}

/**
 * Rewrite a CSS font stack — `"Fraunces, serif"` → `"Playfair Display, serif"`.
 *
 * Only the leading family is considered. The rest of a stack is the fallback
 * chain, which is generic in every template this repo generates, and rewriting
 * a fallback would change what happens when the leading face genuinely cannot
 * carry a glyph.
 */
export function substitutePrintFontStack(stack: string): string {
  const raw = String(stack ?? '');
  if (!raw.trim()) return raw;
  const parts = raw.split(',');
  const head = parts[0].trim();
  const quoted = /^['"]/.test(head);
  const replaced = substitutePrintFamily(head);
  if (replaced === head.replace(/^['"]|['"]$/g, '')) return raw;
  parts[0] = quoted ? `'${replaced}'` : replaced;
  return parts.map((p, i) => (i === 0 ? p : p.trim())).join(', ');
}

/** Apply the stack rewrite to a `tokens.fonts` map. */
export function substitutePrintTokenFonts<T extends Record<string, unknown>>(fonts: T): T {
  if (!fonts || typeof fonts !== 'object') return fonts;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fonts)) {
    if (typeof value !== 'string') { out[key] = value; continue; }
    const next = substitutePrintFontStack(value);
    if (next !== value) changed = true;
    out[key] = next;
  }
  return (changed ? out : fonts) as T;
}

/**
 * Drop the `fontFaces` entries whose family was substituted away.
 *
 * A face declaration for a family nothing names any more is dead weight in the
 * preview and one more remote fetch; keeping it would also let the preview
 * download Fraunces and then set the page in Playfair Display.
 */
export function substitutePrintFontFaces<T extends { family?: unknown }>(
  faces: readonly T[] | undefined | null,
): T[] {
  if (!Array.isArray(faces)) return [];
  return faces.filter((face) => {
    const family = String((face as { family?: unknown })?.family ?? '').trim();
    if (!family) return true;
    return substitutePrintFamily(family) === family;
  });
}

/**
 * Families a document names that the container has **and** this module has no
 * substitute for — the set that would silently print as the engine default.
 *
 * Empty is the only acceptable answer for the seeded catalogue, and
 * `printFontPolicy.spec.ts` asserts it over every family the seed migrations
 * declare. That assertion is the thing that would have caught Fraunces the day
 * the catalogue was generated.
 */
export function unsubstitutedPrintFamilies(families: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const family of families) {
    const name = String(family ?? '').trim().replace(/^['"]|['"]$/g, '');
    if (!name) continue;
    if (isContainerInstalledFamily(name)) continue;
    if (SUBSTITUTIONS.has(name.toLowerCase())) continue;
    out.add(name);
  }
  return [...out].sort();
}
