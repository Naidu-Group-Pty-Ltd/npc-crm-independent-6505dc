import DOMPurify from 'dompurify';

/**
 * Sanitize a complete generated PDF document before it is parsed in the app origin.
 * Layout HTML and inline styles are retained, while executable/embed content and
 * inline event handlers are removed by DOMPurify.
 */
export const sanitizePdfHtml = (html: string): string => DOMPurify.sanitize(html, {
  WHOLE_DOCUMENT: true,
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'form'],
  ALLOW_UNKNOWN_PROTOCOLS: false,
}) as string;
