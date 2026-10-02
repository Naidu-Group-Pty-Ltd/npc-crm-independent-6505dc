/**
 * Speech text — what of a Markdown reply is worth saying out loud, and when.
 *
 * Aurixa's replies are written for the eye: headings, bold, tables, `:::tip`
 * fences, chart blocks, emoji bullets. Read verbatim by a speech engine that
 * is "hash hash Pipeline asterisk asterisk". Two jobs live here.
 *
 * - `toSpeakable` turns a finished piece of Markdown into plain sentences. It
 *   keeps words and drops scaffolding: a table is described, never read cell
 *   by cell, a code or chart block is skipped, and a link says its text.
 * - `takeSpeakable` is what lets Aurixa start talking while the reply is
 *   still streaming. It reads forward from the last point spoken and hands
 *   back only text that ends on a sentence boundary, so the voice never says
 *   half a sentence and then the other half a beat later. It will not cross
 *   into an open code fence, because what is inside one is not prose.
 *
 * Both are pure, so the boundary rules are tested without a speech engine.
 */

const ABBREVIATIONS = new Set([
  'st', 'rd', 'ave', 'dr', 'mr', 'mrs', 'ms', 'no', 'vs', 'approx', 'est', 'e.g', 'i.e', 'etc', 'pty', 'ltd', 'inc', 'co',
]);

const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

export interface SpeakableOptions {
  /**
   * The text before this fragment ended inside a table, so rows at the head
   * of the fragment continue a table that was already announced.
   */
  continuesTable?: boolean;
}

/** Plain sentences from Markdown. Safe on a fragment as well as a whole reply. */
export function toSpeakable(markdown: string, options: SpeakableOptions = {}): string {
  if (!markdown) return '';
  let text = markdown;

  // Fenced code / chart blocks carry data, not prose.
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/```[\s\S]*$/g, ' ');

  const lines = text.split('\n');
  const kept: string[] = [];
  let tableAnnounced = options.continuesTable === true;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      tableAnnounced = false;
      continue;
    }
    // :::tip / ::: fence markers — the content between them is kept.
    if (/^:::/.test(line)) continue;
    // Tables are described once rather than read.
    if (/^\|/.test(line)) {
      if (!tableAnnounced) {
        kept.push('I have put the details in a table.');
        tableAnnounced = true;
      }
      continue;
    }
    // Horizontal rules.
    if (/^([-*_]\s*){3,}$/.test(line)) continue;
    tableAnnounced = false;
    kept.push(
      line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^>\s?/, '')
        .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '')
        .replace(/^\d+[.)]\s+/, ''),
    );
  }
  text = kept.join('. ').replace(/([.!?:;])\.\s/g, '$1 ');

  text = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/[*_#`~]/g, '')
    .replace(EMOJI_RE, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/^[.,;:\s]+/, '')
    .trim();

  return text;
}

function isAbbreviationBefore(text: string, dotIndex: number): boolean {
  const before = text.slice(Math.max(0, dotIndex - 8), dotIndex);
  const m = before.match(/([A-Za-z.]+)$/);
  if (!m) return false;
  return ABBREVIATIONS.has(m[1].toLowerCase());
}

/** Indices (exclusive ends) in `text` where a sentence may be cut. */
export function sentenceBoundaries(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\n') {
      out.push(i + 1);
      continue;
    }
    if (ch === '.' || ch === '!' || ch === '?' || ch === '…') {
      const next = text[i + 1];
      if (next === undefined) continue; // the end of a still-streaming buffer is not a boundary
      if (!/\s/.test(next)) continue; // 4.5%, e.g.x, $1.2m
      if (ch === '.' && isAbbreviationBefore(text, i)) continue;
      out.push(i + 1);
    }
  }
  return out;
}

function fenceCount(text: string): number {
  return (text.match(/```/g) || []).length;
}

export interface SpeakableTake {
  /** Cleaned text to hand to the speech engine. May be empty. */
  text: string;
  /** Index in the raw buffer up to which the text has now been consumed. */
  next: number;
}

/** Whether the consumed text ends inside a table (its last line is a row). */
function endsInTable(consumed: string): boolean {
  if (!consumed || /\n\s*\n\s*$/.test(consumed)) return false;
  const lines = consumed.split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  return !!last && last.startsWith('|');
}

/**
 * Take the next speakable stretch of `raw` starting at `from`.
 *
 * While streaming (`final` false) only text ending on a sentence boundary is
 * taken, and never past an unclosed code fence. Once the reply is complete
 * (`final` true) everything remaining is taken.
 */
export function takeSpeakable(raw: string, from: number, final: boolean): SpeakableTake {
  if (from >= raw.length) return { text: '', next: from };
  const options = { continuesTable: endsInTable(raw.slice(0, from)) };
  if (final) {
    return { text: toSpeakable(raw.slice(from), options), next: raw.length };
  }
  const tail = raw.slice(from);
  const boundaries = sentenceBoundaries(tail);
  for (let k = boundaries.length - 1; k >= 0; k -= 1) {
    const end = from + boundaries[k];
    if (fenceCount(raw.slice(0, end)) % 2 === 0) {
      return { text: toSpeakable(raw.slice(from, end), options), next: end };
    }
  }
  return { text: '', next: from };
}

/**
 * Break cleaned text into utterances short enough that a speech engine starts
 * quickly and can be interrupted between them. Chrome stops speaking silently
 * on utterances much over ~200 characters, so long sentences are cut at a
 * comma or a space.
 */
export function chunkUtterances(text: string, max = 180): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g) ?? [clean];
  const out: string[] = [];
  for (const raw of sentences) {
    let s = raw.trim();
    while (s.length > max) {
      let cut = s.lastIndexOf(', ', max);
      if (cut < max * 0.4) cut = s.lastIndexOf(' ', max);
      if (cut <= 0) cut = max;
      out.push(s.slice(0, cut + 1).trim());
      s = s.slice(cut + 1).trim();
    }
    if (s) out.push(s);
  }
  return out;
}
