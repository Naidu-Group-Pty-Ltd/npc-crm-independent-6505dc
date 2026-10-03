/**
 * A user message, read back the way the user wrote it.
 *
 * What is stored for a user turn is what the MODEL was sent: every attached
 * document's extracted text inlined as `[FILE: name (mime, size)] … [/FILE]`,
 * an image-only turn rewritten as "[User attached 2 images: …]", and — when
 * the page chip was on — a `[Viewing: …]` line. So after the conversation
 * refreshed from the server, a bubble that said "Summarise this" became pages
 * of a PDF's raw text. This parser splits the stored content back into what a
 * person sees: the files as chips, the page as a chip, and their own words.
 *
 * It never drops words the user typed: anything it cannot recognise as one of
 * those three wrappers stays in `text`.
 */
import { splitPageContext, type PageContext } from './pageContext.pure';

export interface MessageAttachment {
  name: string;
  /** e.g. "application/pdf, 1.2MB" — absent for display-only indicators. */
  meta?: string;
}

export interface ParsedUserMessage {
  text: string;
  files: MessageAttachment[];
  page: PageContext | null;
}

const FILE_BLOCK_RE = /\[FILE: ([^\n]+?) \(([^)\n]*)\)\]\n[\s\S]*?\n\[\/FILE\]/g;
const ATTACHED_RE = /^\[User attached \d+ (?:image|file)s?: ([^\]]+?)\. Please (?:analyze|review) the attached (?:image|file)s?\.\]$/;
const INDICATOR_RE = /^📎 (.+)$/;

export function parseUserMessage(content: string | null | undefined): ParsedUserMessage {
  let body = content ?? '';
  const files: MessageAttachment[] = [];

  body = body.replace(FILE_BLOCK_RE, (_m, name: string, meta: string) => {
    files.push({ name: name.trim(), meta: meta.trim() });
    return '';
  });

  // Display-only "📎 name" lines the widget prepends while a send is in flight.
  const lines = body.replace(/^\s+/, '').split('\n');
  let i = 0;
  let sawIndicator = false;
  while (i < lines.length) {
    const m = lines[i].match(INDICATOR_RE);
    if (m) {
      const name = m[1].trim();
      if (!files.some((f) => f.name === name)) files.push({ name });
      sawIndicator = true;
      i += 1;
      continue;
    }
    if (sawIndicator && lines[i].trim() === '') {
      i += 1;
      continue;
    }
    break;
  }
  body = lines.slice(i).join('\n');

  const { context, rest } = splitPageContext(body.trim());
  body = rest.trim();

  const attached = body.match(ATTACHED_RE);
  if (attached) {
    for (const name of attached[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!files.some((f) => f.name === name)) files.push({ name });
    }
    body = '';
  }

  return { text: body.replace(/\n{3,}/g, '\n\n').trim(), files, page: context };
}
