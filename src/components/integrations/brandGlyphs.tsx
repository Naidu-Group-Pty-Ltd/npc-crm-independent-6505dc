// Inline SVG marks for brands NOT hosted on Simple Icons (trademark removals).
// Paths are single-color; consumer sets fill via `color` prop.
import type { SVGProps } from 'react';

type GlyphProps = SVGProps<SVGSVGElement> & { color?: string; size?: number };

const base = (size: number, color: string): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: color,
  xmlns: 'http://www.w3.org/2000/svg',
  'aria-hidden': true,
  focusable: false,
});

export function OpenAIGlyph({ size = 24, color = '#10A37F', ...rest }: GlyphProps) {
  return (
    <svg {...base(size, color)} {...rest}>
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v3l-2.597 1.5-2.607-1.5Z" />
    </svg>
  );
}

export function TwilioGlyph({ size = 24, color = '#F22F46', ...rest }: GlyphProps) {
  return (
    <svg {...base(size, color)} {...rest}>
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 20.406A8.406 8.406 0 1 1 20.406 12 8.415 8.415 0 0 1 12 20.406zm5.211-10.303a2.354 2.354 0 1 1-2.354-2.354 2.354 2.354 0 0 1 2.354 2.354zm0 3.794a2.354 2.354 0 1 1-2.354-2.354 2.354 2.354 0 0 1 2.354 2.354zm-3.794 0a2.354 2.354 0 1 1-2.354-2.354 2.354 2.354 0 0 1 2.354 2.354zm0-3.794a2.354 2.354 0 1 1-2.354-2.354 2.354 2.354 0 0 1 2.354 2.354z" />
    </svg>
  );
}

export function MicrosoftGlyph({ size = 24, ...rest }: GlyphProps) {
  // Microsoft's mark is 4-color; ignores `color` prop.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      focusable={false}
      {...rest}
    >
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M13 1h10v10H13z" />
      <path fill="#00A4EF" d="M1 13h10v10H1z" />
      <path fill="#FFB900" d="M13 13h10v10H13z" />
    </svg>
  );
}

export function XAIGlyph({ size = 24, color = '#000000', ...rest }: GlyphProps) {
  return (
    <svg {...base(size, color)} {...rest}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export const INLINE_GLYPHS: Record<string, (p: GlyphProps) => JSX.Element> = {
  openai: OpenAIGlyph,
  twilio: TwilioGlyph,
  microsoft: MicrosoftGlyph,
  xai: XAIGlyph,
  // OpenRouter family aliases
  'x-ai': XAIGlyph,
};

export function getInlineGlyph(id: string): ((p: GlyphProps) => JSX.Element) | undefined {
  return Object.prototype.hasOwnProperty.call(INLINE_GLYPHS, id) ? INLINE_GLYPHS[id] : undefined;
}
