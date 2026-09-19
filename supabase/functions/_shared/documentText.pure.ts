/**
 * document-text-v1 — canonical shared pure module for document text hygiene.
 *
 * Everything that turns *extracted* document bytes into text a human or an LLM
 * can actually read lives here, so the browser extractors (PDF.js, DOCX, XLSX),
 * the checklist/template importers and the Edge Function parsers all clean,
 * de-hyphenate, truncate and chunk text the same way.
 *
 * The defects this module exists to fix, all observed in the parsers it backs:
 *   - ligatures (`ﬁ`, `ﬂ`) and soft hyphens survive into embeddings and LLM
 *     prompts, so `identiﬁed` never matches `identified`;
 *   - PDF line wrapping leaves `develop-\nment`, which tokenises as two words;
 *   - text is truncated mid-word (or mid-number) with no marker, so the model
 *     silently reads `$1,2` as the price;
 *   - RAG chunking slices on a fixed character window, cutting sentences and
 *     tables in half and orphaning headings from their content.
 *
 * Pure + deterministic + JSON-safe: no DOM, network, secrets or clocks.
 */

export const DOCUMENT_TEXT_VERSION = 'document-text-v1';

// ── Normalisation ────────────────────────────────────────────────────────────

/** Ligatures PDF fonts emit as a single glyph. Expanded so tokens match. */
const LIGATURES: ReadonlyArray<readonly [RegExp, string]> = [
  [/ﬀ/g, 'ff'], [/ﬁ/g, 'fi'], [/ﬂ/g, 'fl'],
  [/ﬃ/g, 'ffi'], [/ﬄ/g, 'ffl'], [/ﬅ/g, 'st'], [/ﬆ/g, 'st'],
  [/Ĳ/g, 'IJ'], [/ĳ/g, 'ij'], [/Œ/g, 'OE'], [/œ/g, 'oe'],
  [/Æ/g, 'AE'], [/æ/g, 'ae'],
];

/** Space-like code points that are not U+0020 (PDF/Word emit these constantly). */
const SPACE_LIKE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

/** Zero-width and bidi marks that break token matching but carry no meaning here. */
const INVISIBLE = /[\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/g;

/** C0/C1 controls except tab and newline. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export interface NormalizeDocumentTextOptions {
  /** Expand `ﬁ`/`ﬂ`/`æ`-style ligatures to their ASCII sequences. Default true. */
  expandLigatures?: boolean;
  /** Collapse runs of spaces/tabs inside a line to a single space. Default false. */
  collapseInlineWhitespace?: boolean;
  /** Maximum consecutive blank lines to keep. Default 2 (one blank line). */
  maxConsecutiveNewlines?: number;
  /** Normalise curly quotes/dashes to ASCII. Default false — they are content. */
  asciiPunctuation?: boolean;
}

/**
 * Make extracted text safe to embed, diff, match and feed to an LLM without
 * changing what it says. Idempotent: normalising twice equals normalising once.
 */
export function normalizeDocumentText(
  input: string | null | undefined,
  options: NormalizeDocumentTextOptions = {},
): string {
  if (input == null) return '';
  const {
    expandLigatures = true,
    collapseInlineWhitespace = false,
    maxConsecutiveNewlines = 2,
    asciiPunctuation = false,
  } = options;

  let text = String(input);

  // Unicode canonical composition first so the class-based passes below see one
  // shape per character (e.g. combining acute + e → é).
  try {
    text = text.normalize('NFC');
  } catch {
    /* environments without full ICU keep the original string */
  }

  text = text.replace(/\r\n?/g, '\n');
  text = text.replace(/\u00AD/g, ''); // soft hyphen: a rendering hint, never content
  text = text.replace(INVISIBLE, '');
  text = text.replace(CONTROL_CHARS, '');
  text = text.replace(SPACE_LIKE, ' ');

  if (expandLigatures) {
    for (const [pattern, replacement] of LIGATURES) text = text.replace(pattern, replacement);
  }

  if (asciiPunctuation) {
    text = text
      .replace(/[‘’‚‛′]/g, "'")
      .replace(/[“”„‟″]/g, '"')
      .replace(/[‐‑‒–—―]/g, '-')
      .replace(/…/g, '...');
  }

  if (collapseInlineWhitespace) text = text.replace(/[ \t]{2,}/g, ' ');

  // Trailing whitespace on a line is never meaningful and defeats line dedupe.
  text = text.replace(/[ \t]+$/gm, '');

  const maxNewlines = Math.max(1, Math.floor(maxConsecutiveNewlines));
  text = text.replace(
    new RegExp(`\\n{${maxNewlines + 1},}`, 'g'),
    '\n'.repeat(maxNewlines),
  );

  return text.trim();
}

/**
 * Re-join words a PDF/Word renderer split across a line break
 * (`develop-\nment` → `development`).
 *
 * Deliberately conservative: only fires when the fragment before the hyphen and
 * the fragment after are both lower-case letter runs, which leaves real
 * compounds (`arm's-length\nvaluation`, `NSW-\nQLD`, `pre-\nGST`) intact.
 */
export function dehyphenateWrappedLines(text: string): string {
  if (!text) return '';
  return text.replace(/([a-z]{2,})[-‐‑]\n[ \t]*([a-z]{2,})/g, '$1$2');
}

// ── Quality signals ──────────────────────────────────────────────────────────

export interface TextQualitySignals {
  /** Total characters inspected. */
  length: number;
  /** Share of characters that are letters or digits (0–1). */
  alphanumericRatio: number;
  /** Share of characters that are U+FFFD replacement chars (0–1). */
  replacementRatio: number;
  /** Share of characters that are whitespace (0–1). */
  whitespaceRatio: number;
  /** Mean length of whitespace-separated tokens. */
  meanTokenLength: number;
  /**
   * True when the text is almost certainly a broken decode (bad CMap, wrong
   * encoding, binary read as text) rather than real content — the signal to
   * fall back to OCR / vision instead of shipping mojibake to an LLM.
   */
  likelyGarbled: boolean;
}

/**
 * Cheap heuristics for "did this extraction actually work?". Callers use
 * `likelyGarbled` to decide between trusting a text layer and rasterising the
 * page for vision/OCR.
 */
export function assessTextQuality(text: string | null | undefined): TextQualitySignals {
  const value = String(text ?? '');
  const length = value.length;
  if (length === 0) {
    return {
      length: 0,
      alphanumericRatio: 0,
      replacementRatio: 0,
      whitespaceRatio: 0,
      meanTokenLength: 0,
      likelyGarbled: false,
    };
  }

  let alphanumeric = 0;
  let replacement = 0;
  let whitespace = 0;
  for (const char of value) {
    if (char === '�') replacement += 1;
    else if (/\s/.test(char)) whitespace += 1;
    else if (/[\p{L}\p{N}]/u.test(char)) alphanumeric += 1;
  }

  const tokens = value.split(/\s+/).filter(Boolean);
  const meanTokenLength = tokens.length
    ? tokens.reduce((sum, token) => sum + token.length, 0) / tokens.length
    : 0;

  const alphanumericRatio = alphanumeric / length;
  const replacementRatio = replacement / length;
  const whitespaceRatio = whitespace / length;

  // Real prose sits around 0.75–0.85 alphanumeric with 3–7 char mean tokens.
  // Garbled decodes show up as symbol soup, replacement chars, or one giant token.
  const likelyGarbled =
    length >= 40 &&
    (replacementRatio > 0.05 ||
      alphanumericRatio < 0.45 ||
      (whitespaceRatio < 0.02 && length > 200) ||
      meanTokenLength > 40);

  return {
    length,
    alphanumericRatio,
    replacementRatio,
    whitespaceRatio,
    meanTokenLength,
    likelyGarbled,
  };
}

// ── Boundary-aware truncation ────────────────────────────────────────────────

export interface TruncateResult {
  text: string;
  truncated: boolean;
  originalLength: number;
  keptLength: number;
}

/**
 * Truncate to a character budget without cutting through a word or a number.
 *
 * Prefers, in order: a paragraph break, a sentence end, then a word boundary —
 * each searched only within the tail of the budget so a document with no such
 * boundary still yields ~`maxChars`. The marker is appended so downstream
 * consumers (and the LLM) can see the text is incomplete, which a raw
 * `slice()` never told them.
 */
export function truncateOnBoundary(
  input: string | null | undefined,
  maxChars: number,
  options: { marker?: string | null; searchWindowRatio?: number } = {},
): TruncateResult {
  const text = String(input ?? '');
  const limit = Math.max(0, Math.floor(maxChars));
  const originalLength = text.length;

  if (limit === 0) {
    return { text: '', truncated: originalLength > 0, originalLength, keptLength: 0 };
  }
  if (originalLength <= limit) {
    return { text, truncated: false, originalLength, keptLength: originalLength };
  }

  const windowRatio = Math.min(0.9, Math.max(0.05, options.searchWindowRatio ?? 0.2));
  const window = Math.max(1, Math.floor(limit * windowRatio));
  const head = text.slice(0, limit);
  const searchFrom = limit - window;

  const cutAt = (index: number): number => (index > searchFrom ? index : -1);

  let cut = cutAt(head.lastIndexOf('\n\n'));
  if (cut < 0) {
    const sentence = /[.!?][)"'’”]?\s/g;
    let lastSentence = -1;
    let match: RegExpExecArray | null;
    while ((match = sentence.exec(head)) !== null) lastSentence = match.index + match[0].length;
    cut = cutAt(lastSentence);
  }
  if (cut < 0) cut = cutAt(head.lastIndexOf('\n'));
  if (cut < 0) cut = cutAt(head.lastIndexOf(' '));
  if (cut < 0) cut = limit;

  const kept = text.slice(0, cut).replace(/\s+$/, '');
  const marker =
    options.marker === null
      ? ''
      : options.marker ??
        `\n\n[... truncated: ${kept.length.toLocaleString('en-AU')} of ${originalLength.toLocaleString('en-AU')} characters shown ...]`;

  return {
    text: kept + marker,
    truncated: true,
    originalLength,
    keptLength: kept.length,
  };
}

// ── Structure-aware chunking (RAG) ───────────────────────────────────────────

export interface ChunkDocumentOptions {
  /** Soft maximum characters per chunk. Default 3000. */
  maxChars?: number;
  /** Characters of trailing context repeated at the head of the next chunk. Default 300. */
  overlapChars?: number;
  /** Chunks shorter than this are merged into their neighbour. Default 200. */
  minChars?: number;
  /** Repeat the nearest preceding markdown heading at the top of each chunk. Default true. */
  repeatHeading?: boolean;
}

const MARKDOWN_HEADING = /^(#{1,6})\s+\S/;

/** Split text into blocks that must not be broken apart if it can be helped. */
function splitIntoBlocks(text: string): string[] {
  const blocks: string[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const joined = buffer.join('\n').trim();
    if (joined) blocks.push(joined);
    buffer = [];
  };

  for (const line of text.split('\n')) {
    if (!line.trim()) {
      flush();
      continue;
    }
    // A heading starts a new block so it stays glued to the text beneath it.
    if (MARKDOWN_HEADING.test(line) && buffer.length) flush();
    buffer.push(line);
  }
  flush();
  return blocks;
}

/** Break an oversized block on sentence, then line, then word, then hard. */
function splitOversizedBlock(block: string, maxChars: number): string[] {
  if (block.length <= maxChars) return [block];

  const pieces: string[] = [];
  const sentences = block.match(/[^.!?\n]+(?:[.!?]+["'’”)]*|\n|$)/g) ?? [block];
  let current = '';

  const push = (piece: string) => {
    const trimmed = piece.trim();
    if (trimmed) pieces.push(trimmed);
  };

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      push(current);
      current = '';
      // Sentence itself is too long — fall back to words, then hard slicing.
      let wordBuffer = '';
      for (const word of sentence.split(/(\s+)/)) {
        if (wordBuffer.length + word.length > maxChars) {
          push(wordBuffer);
          wordBuffer = '';
          if (word.length > maxChars) {
            for (let i = 0; i < word.length; i += maxChars) push(word.slice(i, i + maxChars));
            continue;
          }
        }
        wordBuffer += word;
      }
      push(wordBuffer);
      continue;
    }
    if (current.length + sentence.length > maxChars) {
      push(current);
      current = '';
    }
    current += sentence;
  }
  push(current);
  return pieces.length ? pieces : [block.slice(0, maxChars)];
}

/** Take up to `chars` of trailing whole sentences/words for the overlap window. */
function tailContext(text: string, chars: number): string {
  if (chars <= 0 || !text) return '';
  if (text.length <= chars) return text;
  const tail = text.slice(-chars);
  const sentenceStart = tail.search(/(?<=[.!?][)"'’”]?\s)\S/);
  if (sentenceStart > 0) return tail.slice(sentenceStart);
  const wordStart = tail.indexOf(' ');
  return wordStart > 0 ? tail.slice(wordStart + 1) : tail;
}

/**
 * Split a document into overlapping chunks that respect its structure.
 *
 * Unlike a fixed character window this never cuts mid-sentence when a boundary
 * exists, keeps a markdown heading with the prose it introduces, and repeats
 * that heading at the top of continuation chunks so an embedding of chunk 4
 * still knows which section it came from — the single biggest retrieval-quality
 * win for template/report RAG.
 */
export function chunkDocumentText(
  input: string | null | undefined,
  options: ChunkDocumentOptions = {},
): string[] {
  const maxChars = Math.max(200, Math.floor(options.maxChars ?? 3000));
  const overlapChars = Math.max(0, Math.min(Math.floor(options.overlapChars ?? 300), Math.floor(maxChars / 2)));
  const minChars = Math.max(0, Math.floor(options.minChars ?? 200));
  const repeatHeading = options.repeatHeading ?? true;

  const text = String(input ?? '').trim();
  if (!text) return [];

  const blocks = splitIntoBlocks(text);
  if (!blocks.length) return [];

  const chunks: string[] = [];
  let current = '';
  let currentHeading = '';
  let pendingHeading = '';

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = '';
  };

  const startChunk = (heading: string, piece: string) => {
    // A piece that opens with its own heading needs no borrowed context.
    const pieceOpensSection = MARKDOWN_HEADING.test(piece.split('\n', 1)[0] ?? '');
    const parts: string[] = [];
    if (repeatHeading && heading && !pieceOpensSection && !piece.startsWith(heading)) {
      parts.push(heading);
    }
    if (!pieceOpensSection) {
      const overlap = tailContext(chunks[chunks.length - 1] ?? '', overlapChars);
      if (overlap && overlap !== heading && !piece.startsWith(overlap)) parts.push(overlap);
    }
    current = parts.length ? `${parts.join('\n\n')}\n\n` : '';
  };

  for (const block of blocks) {
    const isHeading = MARKDOWN_HEADING.test(block.split('\n', 1)[0] ?? '');
    if (isHeading) pendingHeading = block.split('\n', 1)[0]!.trim();

    for (const piece of splitOversizedBlock(block, maxChars)) {
      const candidate = current ? `${current}\n\n${piece}` : piece;
      if (candidate.length > maxChars && current.trim()) {
        flush();
        startChunk(currentHeading, piece);
        current += piece;
      } else {
        current = candidate;
      }
      if (isHeading) currentHeading = pendingHeading;
    }
  }
  flush();

  // Fold a runt tail chunk back into its predecessor rather than embedding a
  // fragment that retrieves against everything and means nothing.
  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1]!;
    const previous = chunks[chunks.length - 2]!;
    if (last.length < minChars && previous.length + last.length <= maxChars * 1.25) {
      chunks.splice(chunks.length - 2, 2, `${previous}\n\n${last}`);
    }
  }

  return chunks;
}
