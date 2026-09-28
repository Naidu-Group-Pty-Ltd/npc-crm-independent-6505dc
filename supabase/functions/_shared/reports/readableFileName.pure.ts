/**
 * The name a person reads before they open a document.
 *
 * A filename is the one line of a report somebody reads first — in a downloads
 * folder, an email's attachment row, a portal's list — and the typeset routes
 * used to write it for a machine: `Q_and_A_Answer_<title>_2026-09-28.pdf`,
 * `Property_Comparison_3_Properties_2026-09-28_5B1C0A3E.pdf`,
 * `Cash_Flow_Comparison_2_Properties_2026-09-28_1A2B3C4D.pdf`. Three downloads
 * from one afternoon's work were three files differing in a count and a hash.
 *
 * So a readable name is `<Document> - <what it covers> - 28 Sep 2026.pdf`: the
 * product's name for the document, the topic in a few words, and the day. The
 * topic is the caller's — an answer's own heading, the properties compared —
 * because what a document covers is read from the document, not guessed here.
 *
 * The object's STORAGE key is a different thing and keeps to URL-safe
 * characters (`storageSafeFileName`): the readable name is what a person is
 * handed, the key is where the bytes live, and a key travels in signed URLs.
 *
 * Pure: no clock, no I/O.
 */
import { formatReportDateShort } from './reportDate.pure.ts';

/** The longest topic a filename carries, cut at a word. */
export const MAX_FILE_TOPIC_CHARS = 60;

/** Clip at a word, never mid-word, and say nothing about the cut. */
export function clipAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  const clipped = (space > max * 0.5 ? cut.slice(0, space) : text.slice(0, max)).trim();
  return clipped.replace(/[\s:;,.–—&-]+$/u, '');
}

/** Characters no common filesystem accepts in a name, and the ones that trip mail clients. */
const UNSAFE_FILE_CHARS = /[\\/:*?"<>|#%{}^~[\]`\u0000-\u001f]/g;

/** A topic made safe to sit inside a filename. */
export function fileSafe(text: string): string {
  return text
    .replace(/&/g, 'and')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '')
    .replace(/[–—]/g, '-')
    .replace(UNSAFE_FILE_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `2026-09-28T…` → `28 Sep 2026`, through the one date reader
 * (`reportDate.pure.ts`). An unreadable date is left out of the name rather
 * than printed as whatever was passed.
 */
function fileDate(isoDate: string): string {
  const short = formatReportDateShort(isoDate ?? '');
  return short && short !== isoDate ? short : '';
}

export interface ReadableFileNameParts {
  /** What the product calls the document: "Property Comparison". */
  name: string;
  /** A second word about the document, where it has kinds: "Transcript". */
  qualifier?: string | null;
  /** What this one covers, in a few words. Clipped at a word. */
  topic?: string | null;
  isoDate: string;
  /** Without the dot. Defaults to `pdf`. */
  extension?: string;
  /** Defaults to `MAX_FILE_TOPIC_CHARS`. */
  maxTopicChars?: number;
}

/**
 * `<name>[ - <qualifier>][ - <topic>][ - <date>].<ext>`.
 *
 * With no topic the name is the document's name and the date, never a
 * placeholder word, and a topic that only restates the name is dropped rather
 * than printed twice.
 */
export function readableFileName(parts: ReadableFileNameParts): string {
  const extension = (parts.extension ?? 'pdf').replace(/^\./, '');
  const name = fileSafe(parts.name);
  const rawTopic = clipAtWord(fileSafe(parts.topic ?? ''), parts.maxTopicChars ?? MAX_FILE_TOPIC_CHARS);
  const topic = rawTopic.toLowerCase() === name.toLowerCase() ? '' : rawTopic;
  const qualifier = fileSafe(parts.qualifier ?? '');
  const date = fileDate(parts.isoDate);
  return `${[name, qualifier, topic, date].filter(Boolean).join(' - ')}.${extension}`;
}

/**
 * The same name as a storage key segment.
 *
 * Object keys travel in URLs, signed and otherwise, so the key keeps to
 * characters no encoder rewrites.
 */
export function storageSafeFileName(fileName: string): string {
  return fileName.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_');
}

/**
 * Places in a sentence: `A`, `A and B`, `A, B and C`, and past `max`,
 * `A, B, C and 2 more`. For a topic that is a list of properties.
 */
export function joinPlaces(places: readonly string[], max = 3): string {
  const list = places.map((p) => p.trim()).filter(Boolean);
  if (list.length <= 1) return list[0] ?? '';
  if (list.length > max) {
    const rest = list.length - max;
    return `${list.slice(0, max).join(', ')} and ${rest} more`;
  }
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}
