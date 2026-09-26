/**
 * Which cover the standard presentation opens on, and who the document says
 * made it.
 *
 * ## The defect this closes
 *
 * The standard presentation is the document a report comes out in when no
 * template is chosen, and the one every deployment falls back to. It is drawn
 * over `public/templates/npc_template.pdf`, and that file's first page is not a
 * layout. It is finished brand artwork: NPC's monogram over the words NAIDU
 * PROPERTY CONSULTING SERVICES · YOUR DEDICATED PROPERTY PARTNER. Nothing chose
 * it per deployment, so every clone's standard document opened on another
 * business's name, with `NPC Services` as its author and `NPC Command Centre`
 * as the software that made it. `issuerIdentity.pure.ts` already decided who
 * a report is issued by, and the closing page already asked it, but the cover
 * is the first page a reader sees, and it never asked.
 *
 * ## The rule
 *
 * The artwork is drawn only where it is true: on NPC's own deployment, for a
 * document NPC issues. Everywhere else the cover is drawn from the issuer the
 * deployment's settings resolve to — its name, and its own mark where it has
 * one — through the same resolver as the closing page. So the first and last
 * pages of a document cannot name two different businesses.
 *
 * Both conditions, because each alone is wrong once:
 *  - a clone seeded from the prime's settings carries NPC's name in its rows,
 *    and must still not print NPC's artwork. The prime is recognised by the
 *    backend it talks to (`isPrimeDeployment`), never by a name a row can hold;
 *  - the prime renamed on its Branding or Report Settings page is issuing as
 *    somebody else, and a cover that ignored that would not be white-labelled.
 *
 * Nothing here reads a network or a page; the drawing is
 * `src/lib/reports/investment/investmentPdfCover.ts`. Deno-compatible, like
 * every canonical module beside it, though only the browser's standard
 * presentation reads it today.
 */

import { isHouseName } from '../issuerIdentity.pure.ts';

/**
 * Who a document is issued by, as `resolveReportIssuer` answers it
 * (`reports/issuerIdentity.pure.ts`). Stated by shape so a caller holding the
 * resolver's own issuer type passes it straight through.
 */
export interface CoverIssuer {
  /** The name printed on the document. Never empty. */
  name: string;
  kind: 'workspace' | 'platform';
}

/** The first page the standard document opens on. */
export type StandardCoverKind =
  /** The template's own first page: NPC's artwork. */
  | 'template'
  /** A cover drawn for whoever the deployment says is issuing. */
  | 'issuer';

/**
 * The names the template cover's artwork stands for are the house's
 * (`issuerIdentity.pure.ts`): the artwork reads NAIDU PROPERTY CONSULTING
 * SERVICES, and the business also trades as NPC Services. One list, so the
 * cover, the issuer and the disclaimer cannot disagree about who the house is.
 */
export { normaliseCompanyName } from '../issuerIdentity.pure.ts';

/** Is this the business the template cover's artwork names? */
export function isTemplateCoverOwner(name: unknown): boolean {
  return isHouseName(name);
}

/**
 * The cover for this document: the artwork only on the prime and only for its
 * own name, otherwise the issuer's.
 */
export function standardCoverFor(
  issuer: CoverIssuer,
  deployment: { prime: boolean },
): StandardCoverKind {
  if (!deployment.prime) return 'issuer';
  if (issuer.kind !== 'workspace') return 'issuer';
  return isTemplateCoverOwner(issuer.name) ? 'template' : 'issuer';
}

/** The document information dictionary's three "who" fields. */
export interface StandardDocumentMetadata {
  author: string;
  creator: string;
  producer: string;
}

/**
 * Who the file says wrote it and what made it.
 *
 * Under the artwork it is what the document has always said, word for word.
 * Under an issuer's cover it is the issuer, in all three fields: a document
 * issued under a tenant's name must not carry another business's name in its
 * properties, and an unbranded one is issued by the platform and says so.
 */
export function standardDocumentMetadata(
  cover: StandardCoverKind,
  issuer: CoverIssuer,
): StandardDocumentMetadata {
  if (cover === 'template') {
    return { author: 'NPC Services', creator: 'NPC Command Centre', producer: 'NPC Command Centre' };
  }
  return { author: issuer.name, creator: issuer.name, producer: issuer.name };
}

/** How the issuer's name is set on its cover. */
export interface IssuerNameSetting {
  lines: string[];
  size: number;
  /** Extra space after each character, in points. */
  tracking: number;
}

/** Points of tracking per point of size — the airy capitals of a lockup. */
const NAME_TRACKING_PER_PT = 0.12;

/**
 * Every way to break `words` into `count` lines, keeping their order.
 * A company name is a handful of words, so trying them all costs nothing.
 */
function breaks(words: string[], count: number): string[][] {
  if (count === 1) return [[words.join(' ')]];
  const out: string[][] = [];
  for (let i = 1; i <= words.length - (count - 1); i += 1) {
    for (const rest of breaks(words.slice(i), count - 1)) out.push([words.slice(0, i).join(' '), ...rest]);
  }
  return out;
}

/**
 * Words set in as few lines as `room` allows, broken where the longest line is
 * shortest — so a two-line sentence never ends on one stranded word. Never
 * breaks a word; a word wider than `room` gets a line of its own.
 */
export function balanceLines(text: string, measure: (line: string) => number, room: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  let count = 1;
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && measure(next) > room) {
      count += 1;
      current = word;
    } else {
      current = next;
    }
  }
  if (count === 1 || count > 6) {
    return count === 1 ? [words.join(' ')] : greedyLines(words, measure, room);
  }
  let best: string[] = greedyLines(words, measure, room);
  let bestWidest = Math.max(...best.map(measure));
  for (const lines of breaks(words, count)) {
    const widest = Math.max(...lines.map(measure));
    if (widest <= room && widest < bestWidest) {
      best = lines;
      bestWidest = widest;
    }
  }
  return best;
}

function greedyLines(words: string[], measure: (line: string) => number, room: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && measure(next) > room) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * The largest setting of the name, in capitals, that fits `maxWidth`.
 *
 * One line where it fits at a display size; otherwise two, broken where the
 * longer line is shortest, so a lockup never reads as a title that ran out of
 * room; three only for a name longer than any a business trades under. Never
 * below 16pt, and never cut inside a word: past everything, the last word that
 * fits is followed by an ellipsis.
 */
export function fitIssuerName(
  name: string,
  measure: (text: string, size: number) => number,
  maxWidth: number,
): IssuerNameSetting | null {
  const words = name.toUpperCase().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const widthOf = (text: string, size: number) =>
    measure(text, size) + size * NAME_TRACKING_PER_PT * Math.max(0, text.length - 1);
  const attempts: Array<[number, number]> = [];
  for (const size of [30, 28, 26, 24, 22]) attempts.push([1, size]);
  for (const size of [26, 24, 22, 20, 18]) attempts.push([2, size]);
  for (const size of [20, 18, 16]) attempts.push([3, size]);
  for (const [count, size] of attempts) {
    if (words.length < count) continue;
    let best: string[] | null = null;
    let bestWidest = Infinity;
    for (const lines of breaks(words, count)) {
      const widest = Math.max(...lines.map((line) => widthOf(line, size)));
      if (widest <= maxWidth && widest < bestWidest) {
        best = lines;
        bestWidest = widest;
      }
    }
    if (best) return { lines: best, size, tracking: size * NAME_TRACKING_PER_PT };
  }
  // Longer than any trading name: as many whole words as three lines hold.
  const size = 16;
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (widthOf(next, size) <= maxWidth || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === 3) break;
  }
  if (lines.length < 3 && current) lines.push(current);
  if (lines.length === 3 && lines.join(' ').split(' ').length < words.length) {
    while (lines[2].includes(' ') && widthOf(`${lines[2]}...`, size) > maxWidth) {
      lines[2] = lines[2].slice(0, lines[2].lastIndexOf(' '));
    }
    lines[2] = `${lines[2]}...`;
  }
  return { lines, size, tracking: size * NAME_TRACKING_PER_PT };
}
