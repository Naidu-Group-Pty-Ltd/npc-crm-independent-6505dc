/**
 * Composing a forwarded message.
 *
 * ## The defect
 *
 * Forwarding sent ONLY the note the operator typed. The original message —
 * its HTML, its layout, its calls to action — was never attached to the
 * outgoing mail at all, so what the recipient opened bore no resemblance to
 * what the operator was looking at: "when I receive the forwarded email from
 * copilot it doesn't have the CTAs and the email structure is a little
 * different". It was not *different*; it was absent, and only the operator's
 * covering note survived.
 *
 * ## What this builds
 *
 * The convention every mail client uses: the covering note, a rule, an
 * attribution block naming who sent what to whom and when, then the original
 * message reproduced as it was. `send-email-reply` already sends HTML when
 * the body looks like HTML, so the forward can carry the original's own
 * markup rather than a flattened transcript of it.
 *
 * Two rules:
 *
 * - **The original is reproduced, never rewritten.** Its HTML is passed
 *   through as the author wrote it. Rewriting it is what produced the
 *   complaint; a mail client is the right thing to render it, not us.
 * - **Only the parts we compose are escaped.** The operator's note and the
 *   attribution values are ours and are escaped; the original body is the
 *   remote author's markup and is not. Where no HTML was stored, the plain
 *   body IS escaped, because a plain-text body dropped into HTML unescaped
 *   would render its angle brackets as tags.
 */

export interface ForwardedSource {
  sender: string;
  subject: string | null;
  received_at: string | null;
  to_recipients?: string[] | null;
  cc_recipients?: string[] | null;
  body: string;
  body_html?: string | null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `en-AU`, like every other date this product prints. */
function formatSentAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function attributionRows(source: ForwardedSource): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [
    { label: 'From', value: source.sender },
  ];
  const sentAt = formatSentAt(source.received_at);
  if (sentAt) rows.push({ label: 'Date', value: sentAt });
  if (source.subject) rows.push({ label: 'Subject', value: source.subject });
  const to = (source.to_recipients || []).filter(Boolean);
  if (to.length > 0) rows.push({ label: 'To', value: to.join(', ') });
  const cc = (source.cc_recipients || []).filter(Boolean);
  if (cc.length > 0) rows.push({ label: 'Cc', value: cc.join(', ') });
  return rows;
}

/**
 * The HTML body to send. `note` is what the operator typed; it may be empty,
 * because forwarding something without comment is a normal thing to do.
 */
export function buildForwardedHtml(note: string, source: ForwardedSource): string {
  const noteHtml = note.trim()
    ? `<div>${escapeHtml(note).replace(/\r?\n/g, '<br />')}</div>`
    : '';

  const attribution = attributionRows(source)
    .map(r => `<div><strong>${escapeHtml(r.label)}:</strong> ${escapeHtml(r.value)}</div>`)
    .join('');

  // The remote author's markup, reproduced. Only when none was stored do we
  // fall back to the plain body — which must be escaped, since it is text.
  const originalHtml = source.body_html?.trim()
    ? source.body_html
    : `<div style="white-space:pre-wrap">${escapeHtml(source.body || '')}</div>`;

  return [
    noteHtml,
    '<br />',
    '<div style="border-top:1px solid #d0d0d0;margin:16px 0;padding-top:12px">',
    '<div style="font-size:12px;color:#666;margin-bottom:8px">---------- Forwarded message ----------</div>',
    `<div style="font-size:13px;color:#444;margin-bottom:12px">${attribution}</div>`,
    originalHtml,
    '</div>',
  ].filter(Boolean).join('\n');
}

/** `Fwd: ` is added once, however many times a message is forwarded on. */
export function buildForwardedSubject(subject: string | null): string {
  // Trim BEFORE the fallback: a whitespace-only subject is truthy, so
  // `subject || '(No Subject)'` kept it and sent "Fwd: " with nothing after it.
  const base = (subject || '').trim() || '(No Subject)';
  return /^fwd:/i.test(base) ? base : `Fwd: ${base}`;
}
