/**
 * Looking at the rendered page — and checking what the model says it saw.
 *
 * WHAT THE PIPELINE HAD
 * ---------------------
 * The import quality gate renders every reconstructed page and diffs it against
 * the source raster, then reports a NUMBER. Those numbers were shown to be
 * untrustworthy on their own: the same document scored 0.507 on the visual gate
 * and 1.0 on CDIR fidelity, and 74% of pages come back "needing review" with no
 * statement of what is wrong with any of them. A reviewer gets a score, opens
 * the page, and has to find the defect themselves.
 *
 * There was supposed to be a second channel. `template-design-agent` carries a
 * mode called `layout_reconciliation_repair` described as "page-scoped AI visual
 * repair" — and it contains no model. It reads `body.candidatePatches`, a field
 * the client has never sent, so `sanitize(undefined ?? [])` returns an empty
 * list and the endpoint answers "no changes" to every request ever made of it.
 * The operator sees "AI repair produced no changes", which is indistinguishable
 * from "the page was fine".
 *
 * WHAT THIS IS
 * ------------
 * A judge, not a fixer. The model is shown the source page and the rendered page
 * and asked what is WRONG with the reconstruction. It returns typed, located
 * findings. It never proposes geometry and never edits the document.
 *
 * That split is deliberate and follows the rest of this programme: a model is
 * good at NOTICING and bad at MEASURING — grounding the PDF path exists because
 * of exactly that. So every claim geometry can adjudicate, geometry adjudicates:
 *
 *     "the title is clipped"        → measure the text against its box
 *     "the logo is hidden"          → do the boxes intersect, and what paints on top
 *     "nothing is in this region"   → is there an overlay covering it
 *     "this row is duplicated"      → same box, same words
 *     "this colour is wrong"        → unverifiable without pixels; say so
 *
 * A finding geometry refutes is not shown as a defect. A finding geometry cannot
 * reach is shown as unverified, never as fact. This mirrors the table and chart
 * integrity gates: a claim that cannot be corroborated does not get to act.
 *
 * Pure and deterministic: no fetch, no DOM, no clock. Loaded by the edge runtime
 * (which forces the tool schema) and by the browser (which corroborates).
 */

export const VISUAL_CRITIQUE_VERSION = 'visual-critique-v1';

/**
 * The closed vocabulary of defects a critique may report.
 *
 * Closed on purpose. An open `kind` field means the model invents categories,
 * nothing downstream can corroborate them, and the review surface fills with
 * prose. Every kind here either has a geometric check below or is explicitly
 * marked as one only pixels can settle.
 */
export const CRITIQUE_KINDS = [
  /** Text is cut off by its box. */
  'text_clipped',
  /** Text runs outside its box, over its neighbours or off the page. */
  'text_overflow',
  /** Something is hidden behind something else. */
  'occluded',
  /** Something in the source is not in the reconstruction at all. */
  'missing_element',
  /** Something is in the reconstruction that is not in the source. */
  'spurious_element',
  /** The same content appears twice. */
  'duplicated',
  /** Elements that share an edge in the source do not in the render. */
  'misaligned',
  /** A colour differs from the source. */
  'wrong_colour',
  /** A typeface or weight differs from the source. */
  'wrong_typeface',
  /** Rendering noise: a stray rule, a box outline, a placeholder. */
  'artifact',
] as const;

export type CritiqueKind = typeof CRITIQUE_KINDS[number];

export const CRITIQUE_SEVERITIES = ['critical', 'major', 'minor'] as const;
export type CritiqueSeverity = typeof CRITIQUE_SEVERITIES[number];

export interface CritiqueRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualCritiqueFinding {
  kind: CritiqueKind;
  severity: CritiqueSeverity;
  /** The overlay this concerns, when the model could name one from the inventory. */
  overlayId?: string;
  /** The other party, for relational kinds — what occludes, what duplicates. */
  relatedOverlayId?: string;
  /** Page-point box, for a finding with no overlay to name (a missing element). */
  region?: CritiqueRegion;
  /** One sentence, in a reviewer's words. */
  note: string;
}

/**
 * What measurement had to say about a claim.
 *
 * `unverifiable` is not a soft `confirmed`. It means the evidence this module
 * holds cannot reach the claim, and the review surface must present it as an
 * unchecked observation.
 */
export type CritiqueVerdict = 'confirmed' | 'refuted' | 'unverifiable';

export interface CorroboratedFinding extends VisualCritiqueFinding {
  verdict: CritiqueVerdict;
  /** Why measurement agreed, disagreed, or could not say. Shown to the reviewer. */
  basis: string;
}

/** Most findings one page may carry, so a critique cannot flood a review. */
export const MAX_CRITIQUE_FINDINGS = 24;

/** Note length beyond which a finding is prose rather than a finding. */
export const MAX_CRITIQUE_NOTE_LENGTH = 240;

// ─── The tool the model is forced to call ────────────────────────────────────

/**
 * The tool schema. Forced, so the model cannot answer in prose — a critique
 * that has to be parsed out of a paragraph is a critique that silently becomes
 * zero findings the first time the wording changes.
 */
export const CRITIQUE_TOOL_SCHEMA = {
  name: 'report_visual_findings',
  description:
    'Report what is WRONG with the reconstructed page compared with the source page. '
    + 'Report only differences you can actually see. Do not report anything you are unsure of, '
    + 'and do not propose fixes or coordinates — a separate measurement step decides those.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      findings: {
        type: 'array',
        maxItems: MAX_CRITIQUE_FINDINGS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'severity', 'note'],
          properties: {
            kind: { type: 'string', enum: [...CRITIQUE_KINDS] },
            severity: {
              type: 'string',
              enum: [...CRITIQUE_SEVERITIES],
              description:
                'critical = a reader would be misled or cannot read the content; '
                + 'major = clearly visible and wrong; minor = a small cosmetic difference.',
            },
            overlayId: {
              type: 'string',
              description: 'The id from the ELEMENT INVENTORY this concerns. Omit if none applies.',
            },
            relatedOverlayId: {
              type: 'string',
              description: 'For occluded/duplicated: the other element involved.',
            },
            region: {
              type: 'object',
              additionalProperties: false,
              required: ['x', 'y', 'width', 'height'],
              description: 'Page-point box (top-left origin) when no element id applies.',
              properties: {
                x: { type: 'number' }, y: { type: 'number' },
                width: { type: 'number' }, height: { type: 'number' },
              },
            },
            note: {
              type: 'string',
              maxLength: MAX_CRITIQUE_NOTE_LENGTH,
              description: 'One sentence naming the difference, as a reviewer would say it.',
            },
          },
        },
      },
    },
    required: ['findings'],
  },
} as const;

// ─── Parsing what came back ──────────────────────────────────────────────────

export interface CritiqueParseContext {
  /** Ids the model was shown. A finding naming anything else is a hallucination. */
  overlayIds: readonly string[];
  pageWidth: number;
  pageHeight: number;
  maxFindings?: number;
}

export interface CritiqueParseResult {
  findings: VisualCritiqueFinding[];
  /** Dropped findings and why, so a rejection is never silent. */
  rejected: Array<{ index: number; reason: string }>;
}

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readRegion(value: unknown, pageWidth: number, pageHeight: number): CritiqueRegion | null | 'invalid' {
  if (value == null) return null;
  if (typeof value !== 'object') return 'invalid';
  const r = value as Record<string, unknown>;
  const x = finite(r.x); const y = finite(r.y);
  const width = finite(r.width); const height = finite(r.height);
  if (x == null || y == null || width == null || height == null) return 'invalid';
  if (!(width > 0) || !(height > 0)) return 'invalid';
  // A box off the sheet describes a different page than the one under review.
  const pad = 1;
  if (x < -pad || y < -pad) return 'invalid';
  if (x + width > pageWidth + pad || y + height > pageHeight + pad) return 'invalid';
  return { x, y, width, height };
}

/**
 * Validate the model's findings against what it was actually shown.
 *
 * The important rejection is an unknown `overlayId`. A finding that names an
 * element the page does not contain is an invented one, and it would reach a
 * reviewer looking exactly like a real defect — with an id they cannot find.
 */
export function parseCritiqueFindings(
  raw: unknown,
  context: CritiqueParseContext,
): CritiqueParseResult {
  const findings: VisualCritiqueFinding[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  const list = (raw as { findings?: unknown } | null | undefined)?.findings ?? raw;
  if (!Array.isArray(list)) {
    return { findings, rejected: [{ index: -1, reason: 'findings payload is not an array' }] };
  }
  const known = new Set(context.overlayIds);
  const cap = Math.max(1, Math.floor(context.maxFindings ?? MAX_CRITIQUE_FINDINGS));
  const kinds = new Set<string>(CRITIQUE_KINDS);
  const severities = new Set<string>(CRITIQUE_SEVERITIES);

  list.forEach((item, index) => {
    if (findings.length >= cap) { rejected.push({ index, reason: `exceeds max ${cap} findings` }); return; }
    const entry = (item ?? {}) as Record<string, unknown>;
    const kind = text(entry.kind);
    if (!kinds.has(kind)) { rejected.push({ index, reason: `unknown kind ${JSON.stringify(kind)}` }); return; }
    const severity = text(entry.severity);
    if (!severities.has(severity)) { rejected.push({ index, reason: `unknown severity ${JSON.stringify(severity)}` }); return; }
    const note = text(entry.note);
    if (!note) { rejected.push({ index, reason: 'empty note' }); return; }

    const overlayId = text(entry.overlayId);
    if (overlayId && !known.has(overlayId)) {
      rejected.push({ index, reason: `names an element that is not on this page: ${overlayId}` });
      return;
    }
    const relatedOverlayId = text(entry.relatedOverlayId);
    if (relatedOverlayId && !known.has(relatedOverlayId)) {
      rejected.push({ index, reason: `names a related element that is not on this page: ${relatedOverlayId}` });
      return;
    }
    const region = readRegion(entry.region, context.pageWidth, context.pageHeight);
    if (region === 'invalid') { rejected.push({ index, reason: 'region is unusable or off the page' }); return; }

    // Something has to locate the finding, or a reviewer cannot act on it.
    if (!overlayId && !region) { rejected.push({ index, reason: 'finding locates nothing' }); return; }

    findings.push({
      kind: kind as CritiqueKind,
      severity: severity as CritiqueSeverity,
      ...(overlayId ? { overlayId } : {}),
      ...(relatedOverlayId ? { relatedOverlayId } : {}),
      ...(region ? { region } : {}),
      note: note.slice(0, MAX_CRITIQUE_NOTE_LENGTH),
    });
  });

  return { findings, rejected };
}

// ─── Checking the claims against measurement ─────────────────────────────────

/** The measured facts about one overlay that corroboration can use. */
export interface CritiqueOverlayEvidence {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Paint rank, lower paints first. From the renderer's own ordering. */
  paintOrder?: number;
  content?: string;
  fontSizePt?: number;
  lineHeight?: number;
  letterSpacingPt?: number;
  fontFamily?: string;
  fontWeight?: number | string;
  /** True when the overlay is set not to wrap. */
  nowrap?: boolean;
}

/** Natural width of a string at a size in a family. Browser: canvas. */
export type CritiqueWidthMeasurer = (
  text: string,
  fontSizePt: number,
  fontFamily: string,
  fontWeight?: number | string,
) => number;

export interface CritiqueEvidence {
  overlays: readonly CritiqueOverlayEvidence[];
  pageWidth: number;
  pageHeight: number;
  measure?: CritiqueWidthMeasurer | null;
}

/**
 * Slack, in points, before a box is called too small for its text.
 *
 * Measurement and rendering disagree at the sub-point level — a canvas measures
 * a different rasteriser's advance widths than WeasyPrint lays out with — so a
 * claim is only refuted when the text fits with room to spare, and only
 * confirmed when it misses by more than the noise.
 */
export const FIT_TOLERANCE_PT = 1.5;

/** Fraction of a region an overlay must cover to count as "something is there". */
export const REGION_COVERAGE_SHARE = 0.5;

/** Boxes within this many points on an edge are aligned, not misaligned. */
export const ALIGNMENT_TOLERANCE_PT = 1;

function intersection(a: CritiqueOverlayEvidence | CritiqueRegion, b: CritiqueOverlayEvidence | CritiqueRegion): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

/** Width one line of this overlay's text needs, including its tracking. */
function naturalLineWidth(overlay: CritiqueOverlayEvidence, measure: CritiqueWidthMeasurer): number {
  const content = overlay.content ?? '';
  const size = overlay.fontSizePt ?? 11;
  const natural = measure(content, size, overlay.fontFamily ?? 'Helvetica', overlay.fontWeight);
  const tracking = Number(overlay.letterSpacingPt);
  // Layout width is natural + spacing × n, not × (n − 1): the trailing letter's
  // advance carries its space too. That distinction is why an imported box
  // copied from the source's ink extent is always one space short.
  if (Number.isFinite(tracking) && tracking > 0) return natural + tracking * content.length;
  return natural;
}

function fitVerdict(
  overlay: CritiqueOverlayEvidence | undefined,
  measure: CritiqueWidthMeasurer | null | undefined,
): { verdict: CritiqueVerdict; basis: string } {
  if (!overlay) return { verdict: 'unverifiable', basis: 'no element named, so nothing to measure' };
  if (overlay.type !== 'text') {
    return { verdict: 'refuted', basis: `${overlay.id} is a ${overlay.type}, not text` };
  }
  if (!measure) return { verdict: 'unverifiable', basis: 'no text measurer available' };
  const content = overlay.content ?? '';
  if (!content.trim()) return { verdict: 'unverifiable', basis: 'the element has no text to measure' };

  const needed = naturalLineWidth(overlay, measure);
  if (overlay.nowrap) {
    // One line by construction: it either fits the box's width or it does not.
    if (needed > overlay.width + FIT_TOLERANCE_PT) {
      return {
        verdict: 'confirmed',
        basis: `set on one line, needs ${needed.toFixed(1)}pt in a ${overlay.width.toFixed(1)}pt box`,
      };
    }
    return {
      verdict: 'refuted',
      basis: `fits: needs ${needed.toFixed(1)}pt in a ${overlay.width.toFixed(1)}pt box`,
    };
  }

  // Wrapping text: estimate the lines the width forces, and compare the stack
  // against the box height. An estimate can confirm a bad overflow; it is not
  // precise enough to refute a marginal one.
  const lines = Math.max(1, Math.ceil(needed / Math.max(1, overlay.width)));
  const size = overlay.fontSizePt ?? 11;
  const stack = lines * size * (overlay.lineHeight ?? 1.3);
  if (stack > overlay.height + FIT_TOLERANCE_PT) {
    return {
      verdict: 'confirmed',
      basis: `wraps to about ${lines} line(s) needing ${stack.toFixed(1)}pt in a ${overlay.height.toFixed(1)}pt box`,
    };
  }
  if (lines === 1 && stack <= overlay.height) {
    return { verdict: 'refuted', basis: `one line of ${stack.toFixed(1)}pt fits a ${overlay.height.toFixed(1)}pt box` };
  }
  return { verdict: 'unverifiable', basis: 'wrapped text fits by estimate, which cannot refute a marginal case' };
}

function occlusionVerdict(
  subject: CritiqueOverlayEvidence | undefined,
  other: CritiqueOverlayEvidence | undefined,
): { verdict: CritiqueVerdict; basis: string } {
  if (!subject) return { verdict: 'unverifiable', basis: 'no element named, so nothing to compare' };
  if (!other) return { verdict: 'unverifiable', basis: 'no second element named, so nothing to compare against' };
  const overlap = intersection(subject, other);
  if (overlap <= 0) {
    return { verdict: 'refuted', basis: `${subject.id} and ${other.id} do not overlap at all` };
  }
  const a = Number(subject.paintOrder);
  const b = Number(other.paintOrder);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { verdict: 'unverifiable', basis: `they overlap, but the paint order of one is unknown` };
  }
  if (b > a) {
    return { verdict: 'confirmed', basis: `${other.id} paints above ${subject.id} and covers part of it` };
  }
  return { verdict: 'refuted', basis: `${subject.id} paints above ${other.id}, so it is not the one hidden` };
}

function missingVerdict(
  finding: VisualCritiqueFinding,
  evidence: CritiqueEvidence,
): { verdict: CritiqueVerdict; basis: string } {
  const region = finding.region;
  if (!region) return { verdict: 'unverifiable', basis: 'no region given, so nothing to look in' };
  const area = region.width * region.height;
  for (const overlay of evidence.overlays) {
    if (intersection(region, overlay) >= area * REGION_COVERAGE_SHARE) {
      return { verdict: 'refuted', basis: `${overlay.id} already covers that region` };
    }
  }
  // Nothing is there — which agrees with the claim, but only pixels can say the
  // SOURCE had something there, and the source is what "missing" is measured
  // against.
  return { verdict: 'unverifiable', basis: 'nothing is placed there, but only the source pixels can say something should be' };
}

function duplicateVerdict(
  subject: CritiqueOverlayEvidence | undefined,
  other: CritiqueOverlayEvidence | undefined,
): { verdict: CritiqueVerdict; basis: string } {
  if (!subject || !other) return { verdict: 'unverifiable', basis: 'a duplicate claim needs both elements named' };
  const a = (subject.content ?? '').trim();
  const b = (other.content ?? '').trim();
  if (!a || !b) return { verdict: 'unverifiable', basis: 'one of the elements carries no text to compare' };
  if (a !== b) return { verdict: 'refuted', basis: 'the two elements do not carry the same text' };
  return { verdict: 'confirmed', basis: 'both elements carry identical text' };
}

function alignmentVerdict(
  subject: CritiqueOverlayEvidence | undefined,
  other: CritiqueOverlayEvidence | undefined,
): { verdict: CritiqueVerdict; basis: string } {
  if (!subject || !other) return { verdict: 'unverifiable', basis: 'an alignment claim needs both elements named' };
  const edges: Array<[string, number, number]> = [
    ['left', subject.x, other.x],
    ['right', subject.x + subject.width, other.x + other.width],
    ['top', subject.y, other.y],
    ['bottom', subject.y + subject.height, other.y + other.height],
  ];
  const shared = edges.find(([, p, q]) => Math.abs(p - q) <= ALIGNMENT_TOLERANCE_PT);
  if (shared) {
    return { verdict: 'refuted', basis: `their ${shared[0]} edges agree to within ${ALIGNMENT_TOLERANCE_PT}pt` };
  }
  return { verdict: 'unverifiable', basis: 'no edge matches, but the source decides which edge should' };
}

/**
 * Check every finding against what we measured.
 *
 * The model noticed; this decides whether the geometry bears it out. A refuted
 * finding stays in the list — a reviewer is better served knowing the model
 * claimed something and measurement disagreed than by a silently shorter list —
 * but it is never presented as a defect.
 */
export function corroborateFindings(
  findings: readonly VisualCritiqueFinding[],
  evidence: CritiqueEvidence,
): CorroboratedFinding[] {
  const byId = new Map(evidence.overlays.map((o) => [o.id, o]));
  return findings.map((finding) => {
    const subject = finding.overlayId ? byId.get(finding.overlayId) : undefined;
    const other = finding.relatedOverlayId ? byId.get(finding.relatedOverlayId) : undefined;
    let outcome: { verdict: CritiqueVerdict; basis: string };
    switch (finding.kind) {
      case 'text_clipped':
      case 'text_overflow':
        outcome = fitVerdict(subject, evidence.measure);
        break;
      case 'occluded':
        outcome = occlusionVerdict(subject, other);
        break;
      case 'missing_element':
        outcome = missingVerdict(finding, evidence);
        break;
      case 'duplicated':
        outcome = duplicateVerdict(subject, other);
        break;
      case 'misaligned':
        outcome = alignmentVerdict(subject, other);
        break;
      // Colour, typeface, spurious elements and artifacts are all claims about
      // what the SOURCE looks like. Nothing in this module has the source's
      // pixels, so saying "unverifiable" is the honest answer rather than
      // passing the model's word through as a measurement.
      default:
        outcome = { verdict: 'unverifiable', basis: 'only the source pixels can settle this' };
    }
    return { ...finding, ...outcome };
  });
}

export interface CritiqueSummary {
  version: typeof VISUAL_CRITIQUE_VERSION;
  total: number;
  confirmed: number;
  refuted: number;
  unverifiable: number;
  /** Confirmed findings at critical severity — the ones that should block. */
  confirmedCritical: number;
}

export function summariseCritique(findings: readonly CorroboratedFinding[]): CritiqueSummary {
  let confirmed = 0; let refuted = 0; let unverifiable = 0; let confirmedCritical = 0;
  for (const finding of findings) {
    if (finding.verdict === 'confirmed') {
      confirmed += 1;
      if (finding.severity === 'critical') confirmedCritical += 1;
    } else if (finding.verdict === 'refuted') refuted += 1;
    else unverifiable += 1;
  }
  return {
    version: VISUAL_CRITIQUE_VERSION,
    total: findings.length,
    confirmed, refuted, unverifiable, confirmedCritical,
  };
}

/**
 * Order for a reviewer: what measurement backs, then what it could not reach,
 * then what it contradicted — severity first within each, then source order so
 * the same critique always reads the same way.
 */
const VERDICT_RANK: Record<CritiqueVerdict, number> = { confirmed: 0, unverifiable: 1, refuted: 2 };
const SEVERITY_RANK: Record<CritiqueSeverity, number> = { critical: 0, major: 1, minor: 2 };

export function orderFindingsForReview(findings: readonly CorroboratedFinding[]): CorroboratedFinding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) =>
      VERDICT_RANK[a.finding.verdict] - VERDICT_RANK[b.finding.verdict]
      || SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity]
      || a.index - b.index)
    .map((entry) => entry.finding);
}
