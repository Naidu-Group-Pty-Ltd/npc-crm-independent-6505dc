import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';

interface SanitizedEmailHtmlProps {
  html: string;
  /** Render the document in slices to keep the main thread responsive on huge emails. */
  chunkSize?: number;
  className?: string;
}

/**
 * Strict allowlist for Outlook content.
 * - Preserves: paragraph, line break, lists, tables, links, images, basic formatting (bold/italic/underline/strike), headings, blockquote, code, hr, span/div with style.
 * - Drops: scripts, iframes, forms, event handlers, javascript: / data: (non-image) URLs, style/link tags.
 */
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup', 'small',
    'p', 'br', 'hr', 'div', 'span',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'q', 'pre', 'code',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'img', 'figure', 'figcaption',
  ],
  ALLOWED_ATTR: [
    'href', 'name', 'target', 'rel', 'title',
    'src', 'alt', 'width', 'height',
    'colspan', 'rowspan', 'align', 'valign',
    'style', 'class',
    'cellpadding', 'cellspacing', 'border', 'bgcolor',
  ],
  // Block dangerous URL schemes everywhere; allow http(s), mailto, tel, and data:image.
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid):|data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,)/i,
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'input', 'button', 'textarea', 'select', 'option', 'base'],
  FORBID_ATTR: ['srcset'],
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  KEEP_CONTENT: true,
  USE_PROFILES: { html: true },
};

// Force every external link to open in a new tab safely; strip remaining
// inline event handlers and dangerous style values that DOMPurify left behind.
function hardenLinksAndAttrs(root: HTMLElement) {
  root.querySelectorAll('a[href]').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer nofollow');
  });
  root.querySelectorAll('*').forEach((el) => {
    // Remove any leftover on* handlers (defense in depth).
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
      if (attr.name === 'style' && /expression\s*\(|javascript:|behavior\s*:/i.test(attr.value)) {
        el.removeAttribute('style');
      }
    }
  });
}

function sanitize(html: string): string {
  if (!html) return '';
  const clean = DOMPurify.sanitize(html, SANITIZE_CONFIG as any) as unknown as string;
  // Post-process with a detached DOM to harden links and strip residuals.
  const tpl = document.createElement('template');
  tpl.innerHTML = clean;
  hardenLinksAndAttrs(tpl.content as unknown as HTMLElement);
  const wrapper = document.createElement('div');
  wrapper.appendChild(tpl.content.cloneNode(true));
  return wrapper.innerHTML;
}

/**
 * Split sanitized HTML into top-level chunks so we can mount them in
 * batches via requestIdleCallback. This keeps the main thread responsive
 * for very large emails (long quoted threads, marketing emails).
 */
function splitIntoChunks(html: string, chunkSize: number): string[] {
  if (!html) return [];
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const children = Array.from(tpl.content.childNodes);
  if (children.length === 0) return [html];

  const chunks: string[] = [];
  let buffer = document.createElement('div');
  let bufferSize = 0;

  for (const node of children) {
    buffer.appendChild(node.cloneNode(true));
    bufferSize += (node.textContent?.length || 0) + 32;
    if (bufferSize >= chunkSize) {
      chunks.push(buffer.innerHTML);
      buffer = document.createElement('div');
      bufferSize = 0;
    }
  }
  if (buffer.childNodes.length > 0) chunks.push(buffer.innerHTML);
  return chunks;
}

type IdleHandle = number;
const requestIdle: (cb: () => void) => IdleHandle =
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? (cb) => (window as any).requestIdleCallback(cb, { timeout: 100 })
    : (cb) => window.setTimeout(cb, 16);
const cancelIdle: (h: IdleHandle) => void =
  typeof window !== 'undefined' && 'cancelIdleCallback' in window
    ? (h) => (window as any).cancelIdleCallback(h)
    : (h) => window.clearTimeout(h);

export default function SanitizedEmailHtml({
  html,
  chunkSize = 6000,
  className = '',
}: SanitizedEmailHtmlProps) {
  const sanitized = useMemo(() => sanitize(html), [html]);
  const chunks = useMemo(() => splitIntoChunks(sanitized, chunkSize), [sanitized, chunkSize]);

  // Incrementally reveal chunks across idle frames so the UI never blocks.
  const [rendered, setRendered] = useState(() => Math.min(chunks.length, 1));
  const handleRef = useRef<IdleHandle | null>(null);

  useEffect(() => {
    setRendered(Math.min(chunks.length, 1));
  }, [chunks]);

  useEffect(() => {
    if (rendered >= chunks.length) return;
    handleRef.current = requestIdle(() => {
      setRendered((n) => Math.min(chunks.length, n + 1));
    });
    return () => {
      if (handleRef.current !== null) {
        cancelIdle(handleRef.current);
        handleRef.current = null;
      }
    };
  }, [rendered, chunks.length]);

  return (
    // Email HTML from Outlook/Gmail ships with its own inline colors (typically dark
    // text on light backgrounds). In our dark theme those colors become invisible.
    // Render every rich email on a fixed light surface so branded emails always read
    // correctly — matches Gmail/Outlook web behaviour.
    <div
      className={`email-html-body overflow-x-auto rounded-lg border border-border/50 bg-white p-3 text-neutral-900 shadow-sm [&_*]:!leading-relaxed [&_a]:text-brand-700 [&_a]:underline [&_img]:h-auto [&_img]:max-w-full [&_table]:max-w-full ${className}`}
    >
      {chunks.slice(0, rendered).map((chunk, i) => (
        // eslint-disable-next-line react/no-danger
        <div key={i} dangerouslySetInnerHTML={{ __html: chunk }} />
      ))}
      {rendered < chunks.length && (
        <div className="mt-2 text-xs text-muted-foreground" aria-live="polite">
          Rendering email… ({rendered}/{chunks.length})
        </div>
      )}
    </div>
  );
}
