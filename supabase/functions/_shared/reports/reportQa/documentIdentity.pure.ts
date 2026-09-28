/**
 * What an Intelligence Hub document is called, and what it is about.
 *
 * ## One name, on every document the Hub hands somebody
 *
 * The Hub's downloads used to name themselves four different ways, and none of
 * them was the product's name. The typeset route printed "Report Q&A" as its
 * eyebrow and running head and named the file `Q_and_A_Answer_…`; the two
 * in-browser editors printed "Investment Property Analysis" under the cover —
 * over a suburb shortlist, a strategy memo, anything at all — and fell back to
 * `Q&A Summary - 28/09/2026.pdf`; the chat toolbar's export printed "Q&A
 * Conversation Export". The page a person asks from is called the Intelligence
 * Hub, so the document they carry away says so: `HUB_DOCUMENT_NAME`, here and
 * nowhere else.
 *
 * ## And it says what it is about
 *
 * "Intelligence Hub Summary" alone names the product, not the document: three
 * downloads from one afternoon's work would be three files with the same name
 * and a date. So every document carries its TOPIC — a few words saying what it
 * covers — on its cover and in its filename.
 *
 * The topic is read from the document's own words, in the order a reader would
 * name it: the first heading the answer wrote (a model that writes a report
 * titles it — "Investment Property Suburb Shortlist Report"), then the
 * conversation's title where somebody gave it one, then the question that was
 * asked. Nothing here calls a model: the topic is a statement about what is on
 * the page, so it is taken from the page.
 *
 * Pure: no clock, no I/O.
 */
import {
  clipAtWord,
  fileSafe,
  MAX_FILE_TOPIC_CHARS,
  readableFileName,
  storageSafeFileName,
} from '../readableFileName.pure.ts';

// The generic filename rules moved to `readableFileName.pure.ts` when the
// comparison reports took the same naming; re-exported so every caller of this
// module keeps working.
export { clipAtWord, fileSafe, MAX_FILE_TOPIC_CHARS, storageSafeFileName };

/** What the product calls these documents, on the cover and in the filename. */
export const HUB_DOCUMENT_NAME = 'Intelligence Hub Summary';

/** The longest topic a cover title carries. A title, not a sentence. */
export const MAX_TOPIC_CHARS = 90;


/**
 * Conversation titles that say nothing about the conversation — what a new chat
 * is called before anybody names it, and the format names this module replaces.
 * Matched whole, so a real title that merely starts with one of these words is
 * kept.
 */
const PLACEHOLDER_TITLES = /^(?:new (?:chat|conversation)|untitled(?: (?:chat|conversation))?|conversation|chat|report q&a|q&a|intelligence hub(?: summary)?|aurixa intelligence hub)$/i;

/** Inline Markdown off a line: emphasis, code, links, images, escapes. */
function plainInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A heading's words as a title: numbering and trailing punctuation off.
 *
 * "1. Executive recommendation" is a section, not a topic — but it is only ever
 * reached when the answer has no unnumbered heading above it, and a numbered
 * heading is still more about the document than the conversation's title. The
 * number is dropped either way.
 */
function asTitle(text: string): string {
  return plainInline(text)
    // Only a number that is punctuated as one ("1.", "2)", "Section 3") —
    // "2026 outlook" and "3.5 bedroom homes" start with a figure, not a number.
    .replace(/^(?:section\s+\d+(?:\.\d+)*[.):]?|\d+(?:\.\d+)*[.):])\s+/i, '')
    .replace(/[\s:;,.–—-]+$/u, '')
    .trim();
}

/**
 * The first heading a Markdown body wrote, as a title.
 *
 * `#` through `###` only: a fourth-level heading is a label inside a section,
 * and taking one would name a whole document after a table caption. A heading
 * inside a fenced code block is not a heading.
 */
export function firstHeadingOf(markdown: string): string {
  let fenced = false;
  for (const raw of String(markdown ?? '').split('\n')) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = /^#{1,3}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      const title = asTitle(m[1]);
      if (title) return title;
    }
  }
  return '';
}

export interface TopicSources {
  /** The document's own Markdown — the answer, or the structured write-up. */
  body?: string | null;
  /** What the conversation is called. */
  conversationTitle?: string | null;
  /** The question that produced the answer. */
  question?: string | null;
}

/**
 * What the document is about, in a few words. `''` when nothing says.
 *
 * In reading order: the body's first heading, a conversation title somebody
 * actually gave, then the question — its first sentence, since a question is
 * often a paragraph.
 */
export function hubDocumentTopic(sources: TopicSources): string {
  const heading = firstHeadingOf(sources.body ?? '');
  if (heading) return clipAtWord(heading, MAX_TOPIC_CHARS);

  const title = plainInline(String(sources.conversationTitle ?? ''));
  if (title && !PLACEHOLDER_TITLES.test(title)) return clipAtWord(asTitle(title) || title, MAX_TOPIC_CHARS);

  const question = plainInline(String(sources.question ?? ''));
  if (question) {
    const firstSentence = /^(.+?[.?!])(?:\s|$)/.exec(question)?.[1] ?? question;
    return clipAtWord(firstSentence.replace(/[.?!]+$/, ''), MAX_TOPIC_CHARS);
  }
  return '';
}

export type HubDocumentKind = 'summary' | 'transcript';

/**
 * The filename: `Intelligence Hub Summary - <topic> - 28 Sep 2026.pdf`.
 *
 * Readable rather than underscored, because it is the one line of the document
 * somebody reads before they open it — in a downloads folder, an email's
 * attachment row, a portal's list. A transcript says so, since it is a record of
 * the conversation rather than a summary of it. With no topic the name is the
 * document's name and the date, never a placeholder word
 * (`readableFileName.pure.ts`).
 */
export function hubDocumentFileName(
  topic: string,
  isoDate: string,
  options: { kind?: HubDocumentKind; extension?: string } = {},
): string {
  return readableFileName({
    name: HUB_DOCUMENT_NAME,
    qualifier: (options.kind ?? 'summary') === 'transcript' ? 'Transcript' : null,
    topic,
    isoDate,
    extension: options.extension,
  });
}

/**
 * An email subject for a Hub document, from its filename or title.
 *
 * `Q&A Conversation Export - <file>` put a storage key in front of a client
 * (`qa-export-<uuid>-<ms>.pdf`) under a name the product no longer uses. A name
 * this module wrote already says what the document is, so it is the subject
 * as it stands, less its extension; anything else is introduced by the
 * product's name.
 */
export function hubEmailSubject(fileNameOrTitle: string): string {
  const bare = String(fileNameOrTitle ?? '').replace(/\.(pdf|md|txt|csv|json)$/i, '').trim();
  if (!bare) return HUB_DOCUMENT_NAME;
  return bare.startsWith(HUB_DOCUMENT_NAME) ? bare : `${HUB_DOCUMENT_NAME} - ${bare}`;
}
