/**
 * Design Brief pipeline for the Template Design Agent.
 *
 * Stage 1: analyzeReferenceImage(imageDataUrl) → DesignBrief (GPT-5 vision)
 * Stage 2: integrateBriefTokens(template, brief)  → tokens + auto-contrast guarded
 * Stage 3: synthesisSystemPrompt(brief, tokens, pageSize) → SYSTEM addendum used
 *          when the existing apply_changes tool is called for layout synthesis.
 *
 * Stages 1 and 3 both go through Lovable AI Gateway (openai/gpt-5).
 */

import { hexToRgb, contrastRatioHex, pickContrastingFg, nearestHex } from './colorScience.ts';
import { callAnthropic } from './anthropicAdapter.ts';
import { resolveAnthropicCredential } from './anthropicCredential.ts';

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const VISION_MODEL = 'openai/gpt-5';
/*
 * Whether Claude draws the brief is asked AT CALL TIME, never at module load.
 *
 * This was `const USE_CLAUDE = !!Deno.env.get('ANTHROPIC_API_KEY')`, evaluated
 * once when the module was imported — which is wrong twice over. A deployment
 * that reaches Anthropic by federation holds no key at all, so the constant
 * resolved false and the whole brief silently fell through to the Lovable
 * gateway: a different vendor, a different model, a different answer, and
 * nothing anywhere reporting that it had happened. And even on a key, a value
 * read at import is a value that cannot be refreshed.
 */


export type BriefPaletteRole = 'bg' | 'surface' | 'text' | 'accent' | 'muted';
export interface BriefPaletteEntry { role: BriefPaletteRole; hex: string; label?: string }
export interface BriefSection { role: string; title: string; span: number; notes?: string }
export interface DesignBrief {
  palette: BriefPaletteEntry[];
  typography: { heading: string; body: string; vibe: string };
  layout: { grid: '12col'; density: 'sparse' | 'balanced' | 'dense'; sections: BriefSection[] };
  content: { headline?: string; deck?: string; body?: string; labels?: string[] };
  motifs: string[];
}

const BRIEF_TOOL = {
  type: 'function',
  function: {
    name: 'emit_design_brief',
    description: 'Produce a structured design brief describing the reference image so a downstream layout engine can recreate it on a token-driven PDF page.',
    parameters: {
      type: 'object',
      properties: {
        palette: {
          type: 'array',
          description: '4–6 colours extracted from the image. Use uppercase 6-digit hex.',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['bg', 'surface', 'text', 'accent', 'muted'] },
              hex: { type: 'string', description: '#RRGGBB' },
              label: { type: 'string' },
            },
            required: ['role', 'hex'],
            additionalProperties: false,
          },
        },
        typography: {
          type: 'object',
          properties: {
            heading: { type: 'string', description: 'Heading style family, e.g. "serif display", "geometric sans".' },
            body: { type: 'string', description: 'Body style family, e.g. "humanist sans", "modern serif".' },
            vibe: { type: 'string', description: 'editorial | brutalist | minimal | maximalist | corporate | luxe | playful' },
          },
          required: ['heading', 'body', 'vibe'],
          additionalProperties: false,
        },
        layout: {
          type: 'object',
          properties: {
            grid: { type: 'string', enum: ['12col'] },
            density: { type: 'string', enum: ['sparse', 'balanced', 'dense'] },
            sections: {
              type: 'array',
              description: 'Vertical sections, top to bottom. span = column count (1–12).',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string', description: 'hero | header | kpi-strip | body | gallery | quote | footer | callout | data-table | divider' },
                  title: { type: 'string' },
                  span: { type: 'number' },
                  notes: { type: 'string' },
                },
                required: ['role', 'title', 'span'],
                additionalProperties: false,
              },
            },
          },
          required: ['grid', 'density', 'sections'],
          additionalProperties: false,
        },
        content: {
          type: 'object',
          properties: {
            headline: { type: 'string' },
            deck: { type: 'string' },
            body: { type: 'string' },
            labels: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
        motifs: {
          type: 'array',
          description: 'Short labels for visual motifs: large_hero, gold_rule, pill_badges, gradient_panel, oversized_numeral, etc.',
          items: { type: 'string' },
        },
      },
      required: ['palette', 'typography', 'layout', 'motifs'],
      additionalProperties: false,
    },
  },
};

const BRIEF_SYSTEM = `You are a senior art director. Examine the reference image and translate it into a STRUCTURED DESIGN BRIEF for a PDF page builder.

RULES:
- Output ONLY via the emit_design_brief tool. Do not reply with prose.
- Palette: extract 4–6 distinct colours actually visible in the image. Use uppercase 6-digit hex (#RRGGBB). Roles:
  • bg = dominant page background
  • surface = secondary panel/card background (may equal bg if none)
  • text = main type colour against bg
  • accent = highest-saturation brand/accent colour
  • muted = low-contrast secondary text colour
- Typography: describe the family vibe, not specific fonts. Heading vs body must be distinguishable.
- Layout: read the image top-to-bottom; emit 3–7 sections with role + short title + column span (1–12).
- Content: extract any visible headline / deck / body / labels (verbatim, max 240 chars each).
- Motifs: 2–6 short snake_case tags for distinctive visual moves.

IF the image is unreadable, still emit your best-effort brief — never refuse.`;

export async function analyzeReferenceImage(
  imageDataUrl: string,
  apiKey: string,
  hint?: string,
): Promise<{ brief: DesignBrief; raw: any } | { error: string; raw?: any }> {
  const messages = [
    { role: 'system', content: BRIEF_SYSTEM },
    {
      role: 'user',
      content: [
        { type: 'text', text: hint ? `Designer hint: ${hint}\n\nAnalyse this reference image.` : 'Analyse this reference image.' },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ];

  let data: any;
  const anthropic = await resolveAnthropicCredential();
  if (anthropic.ok) {
    const r = await callAnthropic({
      credential: anthropic.credential,
      messages: messages as any,
      tools: [BRIEF_TOOL as any],
      tool_choice: { type: 'function', function: { name: 'emit_design_brief' } },
      max_tokens: 4096,
    });
    if (!r.ok) return { error: `claude vision ${r.status}: ${(r.errorText || '').slice(0, 300)}` };
    data = r.data;
  } else {
    const resp = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages,
        tools: [BRIEF_TOOL],
        tool_choice: { type: 'function', function: { name: 'emit_design_brief' } },
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { error: `vision gateway ${resp.status}: ${text.slice(0, 300)}` };
    }
    data = await resp.json();
  }
  const call = data?.choices?.[0]?.message?.tool_calls?.[0];

  if (!call?.function?.arguments) {
    return { error: 'no tool_call from vision model', raw: data };
  }
  try {
    const parsed = JSON.parse(call.function.arguments) as DesignBrief;
    // Normalise hex casing
    parsed.palette = (parsed.palette || []).map((p) => ({ ...p, hex: String(p.hex || '').toUpperCase() }));
    return { brief: parsed, raw: data };
  } catch (e) {
    return { error: `bad JSON: ${(e as Error).message}`, raw: data };
  }
}

/**
 * Stage 2 — merge the brief's palette into template tokens under a `brief.*`
 * namespace, then run a WCAG contrast guard to make sure the synthesis pass
 * has at least one valid (bg, text) pairing it can reference.
 *
 * Returns the additive token patch plus a swap log for the chat UI.
 */
export function integrateBriefTokens(
  templateTokens: Record<string, any>,
  brief: DesignBrief,
): { tokenPatch: Record<string, string>; pairings: { bg: string; text: string; ratio: number; swapped: boolean }[]; swaps: string[] } {
  const existing = (templateTokens?.colors ?? {}) as Record<string, string>;
  const allHex = [
    ...Object.values(existing).filter((v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)),
    '#FFFFFF', '#000000',
  ];
  const tokenPatch: Record<string, string> = {};
  for (const entry of brief.palette) {
    if (!hexToRgb(entry.hex)) continue;
    tokenPatch[`brief.${entry.role}`] = entry.hex;
  }

  const bgHex = tokenPatch['brief.bg'] || existing.bg || '#FFFFFF';
  const textHex = tokenPatch['brief.text'] || existing.text || '#111111';
  const accentHex = tokenPatch['brief.accent'] || existing.primary || '#BF9B50';

  const swaps: string[] = [];
  const pairings: { bg: string; text: string; ratio: number; swapped: boolean }[] = [];

  // Ensure text passes 4.5:1 on bg
  let safeText = textHex;
  const textRatio = contrastRatioHex(textHex, bgHex);
  if (textRatio < 4.5) {
    const candidates = [...new Set([...Object.values(existing), ...brief.palette.map((p) => p.hex), '#FFFFFF', '#111111'])];
    const swap = pickContrastingFg(bgHex, candidates, 4.5);
    if (swap && swap.toUpperCase() !== safeText.toUpperCase()) {
      swaps.push(`text ${textHex} → ${swap} on bg ${bgHex} (was ${textRatio.toFixed(2)}:1, needed ≥4.5)`);
      safeText = swap;
      tokenPatch['brief.text'] = swap;
    }
  }
  pairings.push({ bg: bgHex, text: safeText, ratio: contrastRatioHex(safeText, bgHex), swapped: safeText !== textHex });

  // Ensure accent passes 3:1 on bg (non-text decorative)
  const accentRatio = contrastRatioHex(accentHex, bgHex);
  if (accentRatio < 3) {
    const candidates = [...new Set([...Object.values(existing), ...brief.palette.map((p) => p.hex), '#FFFFFF', '#111111'])];
    const swap = pickContrastingFg(bgHex, candidates, 3);
    if (swap && swap.toUpperCase() !== accentHex.toUpperCase()) {
      swaps.push(`accent ${accentHex} → ${swap} on bg ${bgHex} (was ${accentRatio.toFixed(2)}:1, needed ≥3)`);
      tokenPatch['brief.accent'] = swap;
    }
  }
  pairings.push({ bg: bgHex, text: tokenPatch['brief.accent'] || accentHex, ratio: contrastRatioHex(tokenPatch['brief.accent'] || accentHex, bgHex), swapped: !!tokenPatch['brief.accent'] && tokenPatch['brief.accent'] !== accentHex });

  return { tokenPatch, pairings, swaps };
}

/**
 * Stage 3 — system addendum that turns the brief into precise instructions for
 * the existing apply_changes tool. The orchestrator forces clear_page first
 * and binds colours through tokens.brief.* (set in stage 2).
 */
export function synthesisSystemAddendum(
  brief: DesignBrief,
  activePageId: string,
  pageSize: { width: number; height: number },
  tokenPatch: Record<string, string>,
): string {
  const palette = Object.entries(tokenPatch).map(([k, v]) => `  token:${k} = ${v}`).join('\n');
  const sections = (brief.layout.sections || [])
    .map((s, i) => `  ${i + 1}. [${s.role}] "${s.title}" span=${s.span}/12${s.notes ? ` — ${s.notes}` : ''}`)
    .join('\n');
  const labels = brief.content?.labels?.length ? brief.content.labels.join(' · ') : '—';

  const W = pageSize.width;
  const H = pageSize.height;
  const margin = 48;
  const innerW = W - margin * 2;
  const headline = brief.content?.headline?.trim();
  const deck = brief.content?.deck?.trim();
  const body = brief.content?.body?.trim();
  const contentThin = !headline && !deck && !body && !(brief.content?.labels?.length);

  return `
[BRIEF-DRIVEN SYNTHESIS — STRICT]
Recreate the active page (id=${activePageId}, ${W}×${H}pt) from this DESIGN BRIEF.

PALETTE (use ONLY these via "token:<key>" references — never hard-code these hexes):
${palette || '  (none)'}

TYPOGRAPHY:
  heading vibe: ${brief.typography.heading}
  body vibe:    ${brief.typography.body}
  overall vibe: ${brief.typography.vibe}

LAYOUT (top to bottom, 12-col grid; outer margin ${margin}pt; inner width ${innerW}pt):
${sections || '  (single hero section)'}

CONTENT TO PLACE${contentThin ? ' (BRIEF IS THIN — you MUST invent plausible report copy that matches the motifs & vibe)' : ''}:
  headline: ${JSON.stringify(headline ?? '')}
  deck:     ${JSON.stringify(deck ?? '')}
  body:     ${JSON.stringify(body ?? '')}
  labels:   ${labels}

MOTIFS to incorporate: ${brief.motifs?.join(', ') || '—'}
DENSITY: ${brief.layout.density}

═══ HARD REQUIREMENTS — violating any one of these means FAILURE ═══

1. FIRST OP must be: { "op": "clear_page", "pageId": "${activePageId}" }

2. THEN one set_token per palette entry, e.g.:
   { "op": "set_token", "path": "colors.brief.bg", "value": "<hex>" }
   { "op": "set_token", "path": "colors.brief.text", "value": "<hex>" }
   …etc. (path is the full dotted key after "colors.")

3. THEN update the page background:
   { "op": "update_page", "pageId": "${activePageId}", "patch": { "background": { "color": "token:brief.bg" } } }

4. THEN add ONE block per section in the LAYOUT list (use op=add_block, type="free", pageId="${activePageId}").
   Each block must contain overlays placed inside its share of the page.

5. ★ MINIMUM TEXT QUOTA ★ — The page MUST end up with AT LEAST 4 TEXT OVERLAYS, including:
   • exactly 1 headline overlay  (fontSize 44–72, fontWeight "bold", color "token:brief.text")
   • exactly 1 deck/sub-headline overlay (fontSize 16–22, color "token:brief.text", opacity 0.85)
   • at least 1 eyebrow/label overlay (fontSize 10, UPPERCASE, letterSpacing 1.5, color "token:brief.accent")
   • at least 1 body or caption overlay (fontSize 10–12, color "token:brief.text", opacity 0.75)

6. ★ NO ORPHAN SHAPES ★ — A shape overlay wider OR taller than 120pt is BANNED unless a text overlay sits on top of it inside the same block. Decorative shapes ≤120pt are fine (rules, dots, badges).

7. COORDINATES — every overlay must use ABSOLUTE PAGE coordinates:
   • x in [${margin}, ${W - margin}]
   • y in [${margin}, ${H - margin}]
   • width + x ≤ ${W - margin}
   • height + y ≤ ${H - margin}
   • snap x/y/width/height to a 6pt grid

8. COLOURS — every fill, stroke, and text color MUST be "token:brief.*" (never raw hex in this turn). Use:
   • bg            → page background only
   • surface       → card/panel backgrounds
   • text          → body & headline text
   • accent        → eyebrow text, rules, one CTA pill, single decorative shape
   • muted         → secondary text, captions

9. CONTRAST GUARD — text on bg uses token:brief.text. If you place text on a token:brief.accent surface, use token:brief.bg for the text (inverted).

10. TYPOGRAPHY FAMILIES — set fontFamily on every text overlay:
    • headings → "Playfair Display, Georgia, serif"  (or geometric sans if vibe says so)
    • body/eyebrow → "Inter, Helvetica, sans-serif"

11. Emit EVERYTHING in ONE apply_changes call (≤ 30 ops total). The "reply" string should be 1 sentence describing what you built.

═══ EXAMPLE skeleton for inspiration (DO NOT copy verbatim — adapt to brief) ═══
After clear_page + set_token ops + update_page background:
  add_block (hero):
    text overlay "EYEBROW LABEL"      x=48  y=80   w=400 h=14  size=10 accent UPPERCASE
    text overlay "Headline goes here" x=48  y=110  w=500 h=90  size=56 bold text
    text overlay "Deck/sub-headline"  x=48  y=210  w=460 h=60  size=18 text opacity=0.85
    shape rect (gold rule)            x=48  y=290  w=120 h=2   fill=accent
  add_block (body):
    text overlay "Body paragraph…"    x=48  y=340  w=500 h=180 size=11 text opacity=0.8 lineHeight=1.5
  add_block (footer):
    text overlay "Footer meta"        x=48  y=${H - 80} w=500 h=20 size=9 muted

If the BRIEF content is empty, invent crisp report-style copy that matches motifs (${brief.motifs?.join(', ') || 'editorial property report'}) and the ${brief.typography.vibe} vibe. NEVER ship a layout that is only shapes.`;
}

/**
 * Validates a synthesised set of ops meets the minimum content quota
 * (≥1 clear_page, ≥4 text overlays). Used by the orchestrator to retry
 * if the model emits an empty layout.
 */
export function validateBriefSynthesis(ops: any[]): { ok: boolean; reason?: string; stats: { textOverlays: number; shapeOverlays: number; hasClearPage: boolean; hasBgUpdate: boolean } } {
  let textOverlays = 0;
  let shapeOverlays = 0;
  let hasClearPage = false;
  let hasBgUpdate = false;
  for (const op of ops || []) {
    if (op?.op === 'clear_page') hasClearPage = true;
    if (op?.op === 'update_page' && op?.patch?.background) hasBgUpdate = true;
    if (op?.op === 'add_overlay') {
      if (op?.overlay?.type === 'text' && String(op?.overlay?.content || '').trim()) textOverlays++;
      else if (op?.overlay?.type === 'shape') shapeOverlays++;
    }
    if (op?.op === 'add_block') {
      for (const ov of op?.block?.overlays || []) {
        if (ov?.type === 'text' && String(ov?.content || '').trim()) textOverlays++;
        else if (ov?.type === 'shape') shapeOverlays++;
      }
    }
  }
  const stats = { textOverlays, shapeOverlays, hasClearPage, hasBgUpdate };
  if (!hasClearPage) return { ok: false, reason: 'missing clear_page', stats };
  if (textOverlays < 4) return { ok: false, reason: `only ${textOverlays} text overlays (need ≥4)`, stats };
  return { ok: true, stats };
}
