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

// ── The title block a model writes above a report ──────────────────────────
//
// Asked to make an answer "a report we would hand to a client", a model writes
// a title block before the first section: the firm's name as a heading, then
// the report's title, then a subtitle, then a column of `**Label:** value`
// lines — measured on the owner's export of 30 Sep 2026:
//
//   # NAIDU PROPERTY CONSULTING SERVICES
//   ## Strategic Investment Acquisition Report
//   ### $750,000 Residential Investment Property Mandate
//   **Prepared for:** [Client Name]
//   **Prepared by:** Naidu Property Consulting Services
//   **Date:** [Insert Date]
//   **Investment Budget:** Up to $750,000 … — *to be confirmed*
//
// Read as a first heading, that named the document after the firm that issued
// it: the cover, the PDF title, the filename, the contents page's first entry
// and "Section 01" all read "NAIDU PROPERTY CONSULTING SERVICES", while the
// report's real title sat inside the first section as a subhead, and
// `[Client Name]` and `[Insert Date]` printed on a client's document. So the
// block is read as what it is: the letterhead is the issuer's (the masthead
// already carries it), the title and subtitle belong on the cover, "Prepared
// for" is a cover fact, "Prepared by" the issuer and "Date" are what the cover
// already states, a value that is only a slot for a value is omitted — the
// house rule for an absence — and what remains is the document's own brief.
//
// Structure only. No sentence is reworded and no word of the body is touched:
// what is not recognised as a title block is left exactly where it was.

/** `1. Executive summary`, `Section 3: Risks` — a numbered section, never a title. */
const SECTION_NUMBERED = /^(?:section\s+\d+(?:\.\d+)*[.):]?|\d+(?:\.\d+)*[.):])\s+\S/i;

/**
 * The name of a SECTION, which any document could open on: "Executive
 * summary", "Overview", "Recommendation", "The short answer".
 *
 * An answer that opens on one is opening on its first section, not on its
 * title, and a cover reading "Executive summary" (and a file named after it)
 * says nothing about what the document covers. The conversation's own title is
 * a better one — the Hub gives each conversation a short descriptive title
 * after its first exchange — so a heading like this is kept in the body as the
 * section it is, and stands as the title only where nothing better exists.
 */
const GENERIC_SECTION_HEADING = /^(?:executive\s+summary|summary|overview|introduction|background|context|key\s+(?:findings|points|takeaways|insights|considerations)|findings|analysis|discussion|assessment|recommendations?|conclusions?|(?:the\s+)?short\s+answer|(?:the\s+)?answer|response|next\s+steps|in\s+(?:summary|brief)|at\s+a\s+glance|details|notes)[.:]?$/i;

/** Whether a heading names a section any document could have, not this one. */
export function isGenericSectionHeading(text: string | null | undefined): boolean {
  return GENERIC_SECTION_HEADING.test(plainInline(String(text ?? '')).trim());
}

const TITLE_BLOCK_HEADING = /^(#{1,3})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const THEMATIC_BREAK = /^(?:-{3,}|\*{3,}|_{3,})$/;

/** A front-matter line's label may not be a sentence. */
const MAX_LABEL_CHARS = 40;
/** Nor its value a paragraph: a longer one is prose, and prose stays where it is. */
const MAX_FACT_VALUE_CHARS = 240;
const MAX_FRONT_MATTER_LINES = 10;

const PREPARED_FOR = /^(?:prepared for|client|client name|for|recipient|attention|attn)$/;
const PREPARED_BY = /^(?:prepared by|author|adviser|advisor|consultant|analyst|from)$/;
const DATED = /^(?:date|dated|report date|prepared on|date prepared|issue date|date of issue)$/;

/**
 * A slot for a value rather than a value: `[Client Name]`, `[Insert Date]`,
 * `[XX]`, `TBC`, an empty cell.
 */
const BRACKET_SLOT = /^\[(?!\^)(?=[^\]]*[A-Za-z]{2})[A-Za-z][^\]\n]{0,39}\]\.?$/;
const ABSENT_VALUE = /^(?:tbc|tba|tbd|n\/?a|to be (?:confirmed|advised|determined)|x{2,}|\?+|[-–—]+)\.?$/i;

/** Whether a value only marks where a value should go. */
export function isPlaceholderValue(value: string | null | undefined): boolean {
  const v = plainInline(String(value ?? ''));
  return !v || BRACKET_SLOT.test(v) || ABSENT_VALUE.test(v) || /^\[x{2,}\]$/i.test(v);
}

/** `Pty Ltd`, `Limited`, case and punctuation do not make two names two firms. */
function issuerKey(value: string): string {
  return plainInline(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(?:pty|ltd|limited|proprietary|inc|llc|plc)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Whether a line of text is the issuer's own name — a letterhead, not a title. */
export function namesTheIssuer(text: string, issuerNames: readonly (string | null | undefined)[] = []): boolean {
  const key = issuerKey(text);
  if (!key) return false;
  return issuerNames.some((name) => {
    const other = issuerKey(String(name ?? ''));
    return Boolean(other) && other === key;
  });
}

/** `**Label:** value`, `**Label**: value` or `- **Label:** value`. Null for anything else. */
function frontMatterLine(line: string): { label: string; value: string } | null {
  const m = /^(?:[-*+][ \t]+)?(\*\*|__)([^*_\n]{1,80}?)\1[ \t]*(:?)[ \t]*(.*?)[ \t]*\\?$/.exec(line.trim());
  if (!m) return null;
  const inside = m[2].trim();
  const colonInside = inside.endsWith(':');
  if (!colonInside && !m[3]) return null;
  const label = inside.replace(/:\s*$/, '').trim();
  if (!label || label.length > MAX_LABEL_CHARS || label.split(/\s+/).length > 6) return null;
  const value = m[4].trim();
  if (value.length > MAX_FACT_VALUE_CHARS) return null;
  return { label, value };
}

export interface TitleBlockFact {
  label: string;
  value: string;
}

export interface TitleBlock {
  /** The issuer's own name, set as the answer's first heading. The masthead already carries it. */
  letterhead: string;
  /** The report's own title, for the cover. `''` when the answer wrote none. */
  title: string;
  /** The line the answer set under its title. */
  subtitle: string;
  /** "Prepared for", when it names somebody rather than a slot. */
  preparedFor: string;
  /** "Prepared by", when it names a person rather than the issuer. */
  preparedBy: string;
  /** The rest of the front matter, as label and plain-text value. */
  facts: TitleBlockFact[];
  /** Labels whose value was only a placeholder, and which are therefore not printed. */
  omitted: string[];
  /** The Markdown under the title block: what the document's sections are drawn from. */
  body: string;
}

/**
 * Read the title block off the top of an answer.
 *
 * The heading run is up to three headings with nothing but blank lines
 * between them, stopping at a numbered heading, which opens a section. The
 * letterhead is the first of them where it names the issuer. When no front
 * matter follows the run and prose does, the run's last heading heads that
 * prose — a section, not a subtitle — and stays in the body. Everything the
 * block does not recognise is left exactly as written.
 */
export function readTitleBlock(
  markdown: string | null | undefined,
  options: { issuerNames?: readonly (string | null | undefined)[] } = {},
): TitleBlock {
  const source = String(markdown ?? '').replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const n = lines.length;
  const skipBlank = (k: number): number => {
    let at = k;
    while (at < n && !lines[at].trim()) at += 1;
    return at;
  };
  const untouched: TitleBlock = {
    letterhead: '', title: '', subtitle: '', preparedFor: '', preparedBy: '', facts: [], omitted: [], body: source,
  };

  // The heading run: each deeper than the one before, as a title block
  // cascades. A heading at the same level or shallower is a sibling section.
  const run: Array<{ text: string; line: number }> = [];
  let at = skipBlank(0);
  let lastLevel = 0;
  while (at < n && run.length < 3) {
    const heading = TITLE_BLOCK_HEADING.exec(lines[at].trim());
    if (!heading || heading[1].length <= lastLevel) break;
    const text = plainInline(heading[2]);
    if (!text || SECTION_NUMBERED.test(text)) break;
    run.push({ text, line: at });
    lastLevel = heading[1].length;
    at = skipBlank(at + 1);
  }
  // Front matter with no title above it is an answer that opens on labelled
  // points, which is prose; only a title block has front matter.
  if (!run.length) return untouched;

  // The front matter under it.
  const front: Array<{ label: string; value: string }> = [];
  let afterFront = at;
  while (afterFront < n && front.length < MAX_FRONT_MATTER_LINES) {
    const parsed = frontMatterLine(lines[afterFront]);
    if (!parsed) break;
    front.push(parsed);
    afterFront = skipBlank(afterFront + 1);
  }

  const issuerNames = options.issuerNames ?? [];
  const letterhead = namesTheIssuer(run[0].text, issuerNames) ? run.shift()!.text : '';

  const next = afterFront < n ? lines[afterFront].trim() : '';
  const nextKind = !next
    ? 'end'
    : THEMATIC_BREAK.test(next.replace(/\s/g, ''))
      ? 'rule'
      : TITLE_BLOCK_HEADING.test(next) || /^#{4,6}\s/.test(next)
        ? 'heading'
        : 'prose';

  let consumedTo: number;
  if (!front.length && nextKind !== 'rule' && run[0] && isGenericSectionHeading(run[0].text)) {
    // "## Executive summary" over prose is the answer's first section. The
    // letterhead above it (if any) is still the issuer's; the section keeps
    // its heading, where the answer wrote it.
    consumedTo = run[0].line;
    run.length = 0;
  } else if (front.length || nextKind === 'rule' || nextKind === 'end') {
    // A whole title block: its headings, its front matter and the rule under it.
    consumedTo = afterFront;
    if (consumedTo < n && THEMATIC_BREAK.test(lines[consumedTo].trim().replace(/\s/g, ''))) {
      consumedTo = skipBlank(consumedTo + 1);
    }
  } else {
    // Prose or another heading straight under the run: only the first heading
    // is certainly a title — the answer's own, as it has always been read. A
    // deeper heading in the run heads the prose, or an empty section, and
    // stays exactly where it was written. A subtitle is only ever read where
    // front matter or a rule closes the block.
    consumedTo = run.length >= 2 ? run[1].line : at;
    run.length = Math.min(run.length, 1);
  }

  const block: TitleBlock = {
    letterhead,
    title: run[0]?.text ?? '',
    subtitle: run.slice(1).map((h) => h.text).join(' — '),
    preparedFor: '',
    preparedBy: '',
    facts: [],
    omitted: [],
    body: lines.slice(consumedTo).join('\n'),
  };

  for (const { label, value } of front) {
    const key = label.toLowerCase();
    if (isPlaceholderValue(value)) {
      block.omitted.push(label);
      continue;
    }
    const plain = plainInline(value);
    if (PREPARED_FOR.test(key)) {
      if (!block.preparedFor) block.preparedFor = plain;
      continue;
    }
    if (PREPARED_BY.test(key)) {
      if (!namesTheIssuer(plain, issuerNames) && !block.preparedBy) block.preparedBy = plain;
      continue;
    }
    if (DATED.test(key)) continue;
    block.facts.push({ label, value: plain });
  }
  return block;
}

/**
 * Placeholders still in the text — `[Client Name]`, `[Insert Date]`, `[XX]%`.
 *
 * Said to the person before they export, because a slot in a sentence cannot
 * be taken out without rewording it: the front matter's slots are omitted from
 * the page, and every other one prints as written unless it is filled in.
 * In order, each once.
 */
export function findPlaceholders(markdown: string | null | undefined): string[] {
  const text = String(markdown ?? '');
  const found: Array<{ at: number; slot: string }> = [];
  const patterns = [
    /\[(?:insert|enter|add|your)\b[^\]\n]{1,36}\](?![(:])/gi,
    /\[[A-Z][a-z]+(?:[ /](?:[A-Z][a-z]+|of|and|or|&))*\](?![(:])/g,
    /\[[Xx]{2,}(?:[.,][Xx0-9]+)?\]/g,
  ];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) found.push({ at: m.index ?? 0, slot: m[0] });
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.at - b.at)
    .map((f) => f.slot)
    .filter((slot) => (seen.has(slot) ? false : (seen.add(slot), true)));
}

export interface TopicSources {
  /** The document's own Markdown — the answer, or the structured write-up. */
  body?: string | null;
  /** What the conversation is called. */
  conversationTitle?: string | null;
  /** The question that produced the answer. */
  question?: string | null;
  /**
   * The issuer's names — company and trading name. A first heading that is
   * one of them is the letterhead, and the title is the heading under it.
   */
  issuerNames?: readonly (string | null | undefined)[];
}

/**
 * What the document is about, in a few words. `''` when nothing says.
 *
 * In reading order: the title the answer wrote (under its letterhead, where it
 * set the issuer's name above it), else its first heading, then a conversation
 * title somebody actually gave, then the question — its first sentence, since
 * a question is often a paragraph. A heading that only names a section
 * (`isGenericSectionHeading`) yields to the conversation's title and stands
 * ahead of the question.
 */
export function hubDocumentTopic(sources: TopicSources): string {
  const block = readTitleBlock(sources.body ?? '', { issuerNames: sources.issuerNames });
  const heading = block.title || firstHeadingOf(block.body);
  if (heading && !isGenericSectionHeading(heading)) return clipAtWord(heading, MAX_TOPIC_CHARS);

  const title = plainInline(String(sources.conversationTitle ?? ''));
  if (title && !PLACEHOLDER_TITLES.test(title)) return clipAtWord(asTitle(title) || title, MAX_TOPIC_CHARS);

  // A section's name says less than a conversation title, and more than a
  // question typed to the Hub — which can be a paragraph of instructions.
  if (heading) return clipAtWord(heading, MAX_TOPIC_CHARS);

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
