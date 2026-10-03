/**
 * Page context — telling Aurixa which screen the user is looking at.
 *
 * "Ask about this page" is the difference between an assistant in a corner
 * and one working beside you: a person on a client's record should be able to
 * say "what's outstanding here?" without first typing the client's name.
 *
 * Nothing about the server changes. The context travels as one plain line at
 * the head of the user's message, which the model reads like any other text
 * and which the browser strips back out into a chip when the message is drawn
 * (`splitPageContext`). Three rules:
 *
 * - **Opt-in, per message.** The line is added only while the user has the
 *   page chip switched on; nothing is sent about a screen behind their back.
 * - **Idempotent.** A retry re-sends a message that already carries the line,
 *   so `withPageContext` never adds a second one.
 * - **The path is kept whole.** A record id in the URL is exactly what lets
 *   the agent's tools open the right client, so it is not shortened.
 */

export interface PageContext {
  label: string;
  path: string;
}

const MARKER_RE = /^\[Viewing: ([^\]\n]{1,240}?) — ([^\]\n]{1,400})\]\s*\n?/;
const MARKER_ANYWHERE_RE = /(^|\n)\[Viewing: ([^\]\n]{1,240}?) — ([^\]\n]{1,400})\]\s*(?=\n|$)/;

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{20,}|\d{3,}|rec[A-Za-z0-9]{14})$/i;

const SEGMENT_LABELS: Record<string, string> = {
  admin: 'Admin',
  aml: 'AML/CTF',
  austrac: 'AUSTRAC',
  qa: 'Q&A',
  ci: 'C&I',
  crm: 'CRM',
  ghl: 'GHL',
};

function humanizeSegment(segment: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  })();
  const key = decoded.toLowerCase();
  if (SEGMENT_LABELS[key]) return SEGMENT_LABELS[key];
  const words = decoded.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

/**
 * A short, human label for the current screen. A heading the page itself
 * draws (a client's name, a report's title) is better than anything derived
 * from the URL, so it wins when it is present and sensible.
 */
export function describePage(pathname: string, heading?: string | null): PageContext {
  const path = pathname || '/';
  const cleanHeading = (heading ?? '').replace(/\s+/g, ' ').trim();
  const segments = path.split('?')[0].split('/').filter(Boolean);
  const named = segments.filter((s) => !ID_SEGMENT.test(s)).map(humanizeSegment).filter(Boolean);
  const hasRecord = segments.some((s) => ID_SEGMENT.test(s));

  let label: string;
  if (cleanHeading && cleanHeading.length <= 80) {
    label = cleanHeading;
  } else if (named.length === 0) {
    label = 'Dashboard';
  } else {
    const tail = named.slice(-2).join(' › ');
    label = hasRecord ? `${tail} record` : tail;
  }
  return { label: label.replace(/[\][]/g, ''), path };
}

export function hasPageContext(message: string): boolean {
  return MARKER_RE.test(message.trimStart()) || MARKER_ANYWHERE_RE.test(message);
}

export function withPageContext(message: string, ctx: PageContext | null): string {
  if (!ctx || hasPageContext(message)) return message;
  const line = `[Viewing: ${ctx.label.replace(/[\][\n]/g, ' ').trim()} — ${ctx.path.replace(/[\]\n]/g, '')}]`;
  return message ? `${line}\n\n${message}` : line;
}

export function splitPageContext(content: string): { context: PageContext | null; rest: string } {
  const m = content.match(MARKER_ANYWHERE_RE);
  if (!m || m.index === undefined) return { context: null, rest: content };
  const start = m.index + m[1].length;
  const end = m.index + m[0].length;
  const rest = (content.slice(0, start) + content.slice(end)).replace(/^\s+/, '').replace(/\n{3,}/g, '\n\n');
  return { context: { label: m[2].trim(), path: m[3].trim() }, rest };
}
