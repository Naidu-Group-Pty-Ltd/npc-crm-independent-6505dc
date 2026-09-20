// Premium investment report PDF renderer.
// Pipeline: fetch report row → build hybrid HTML (marketing cover + editorial body)
// → POST to Api2PDF Headless Chrome HTML endpoint → return hosted FileUrl.
//
// Side-by-side with the legacy jsPDF (PixelPerfectPDFGenerator) renderer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { marked } from "https://esm.sh/marked@12.0.2";
import { createCorsHeaders, createForbiddenResponse, createUnauthorizedResponse, verifyAuth } from "../_shared/auth.ts";
import { requireModulePermission } from "../_shared/authz.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { signStoragePaths } from "../_shared/storageSign.ts";
import { escapeRawHtmlInMarkdown, removeUnsafeRenderedUrls } from "./markdownSafety.ts";
import { collectFootnoteDefinitions } from "./footnotes.ts";
import { statCardHasValue } from "../_shared/reports/investment/blockHygiene.pure.ts";
import { dimensionWasScored } from "../_shared/reports/investment/scoreSections.pure.ts";
import { publishableGrade } from "../_shared/reports/investment/scoreSections.pure.ts";
import { presentStoredMarkdown } from "../_shared/reports/investment/derivedHygiene.pure.ts";
import { readEvidenceInventory } from "../_shared/reports/investment/chartEvidence.pure.ts";
import { PLATFORM_ISSUER_NAME, resolveReportDisclaimer, resolveReportIssuer } from "../_shared/reports/issuerIdentity.pure.ts";
import { governedAuthorityBlockFromFlags } from "../_shared/reports/contract/governedNarrativeAuthority.pure.ts";
// Both are called by `wrapInsightSections` below and neither was imported, so
// every call to `buildHtml` threw `ReferenceError: wrapInsightHeadingSections is
// not defined` before WeasyPrint was ever reached. The modules exist and are
// covered by `insightHeadingSections.test.ts` and
// `src/security/renderInvestmentReportPdf.security.test.ts` — those import them
// directly, which is why the tests kept passing while the function could not
// produce a single PDF.
import { wrapInsightHeadingSections } from "./insightHeadingSections.ts";
import { wrapInlineInsightParagraphs } from "./insightSections.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { reconcileStoredFinancials } from '../_shared/reports/investment/financialEngine.pure.ts';
import { contentPolicyFor } from '../_shared/reports/investment/tierContent.pure.ts';
// The house cover artwork used to be inlined here as ~490 KB of base64
// (`_shared/reportDesign/defaultAssets.generated.ts`). Every file under
// `supabase/functions/` counts toward *every* function's deploy upload, so those
// bytes pushed `manage-partner-agreements`, `aml-client-portal` and
// `generate-investment-report` past Supabase's ~4.5 MB cap — they could not be
// deployed at all. The bytes now live in `public.report_default_assets` and are
// loaded here at request time (see `loadHouseCoverArt`). Still no external
// network and still a `data:` URI by the time WeasyPrint sees it, so the
// "a report must render without the network" policy in `assets.pure.ts` holds.
// Source of truth for regeneration is unchanged:
// `scripts/reportDesign/buildDefaultAssets.ts` →
// `scripts/reportDesign/generated/defaultAssets.generated.ts`, re-seeded via the
// one-off `seed-report-assets` function.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API2PDF_KEY = (Deno.env.get("API2PDF_API_KEY") || "").trim();
const PDF_BUCKET = "investment-reports";
// Fail fast rather than letting paid Api2PDF retries consume the full Edge timeout.
const MAX_RENDER_WAIT_MS = 115_000;
// (Hero-image generation is now offloaded to `prepare-report-hero-images`.)
const API2PDF_REQUEST_TIMEOUT_MS = 45_000;
const WEASYPRINT_REQUEST_TIMEOUT_MS = 600_000;
const MAX_CHART_INJECTION_HTML_CHARS = 2_000_000;
const MAX_CHART_INJECTION_TABLES = 100;

// Dark-gold theme tokens mirrored from the app.
const THEME = {
  bg: "#0D0D0D",
  surface: "#161616",
  surfaceAlt: "#1C1C1C",
  border: "#2A2A2A",
  text: "#F3EFE6",
  muted: "#9C9486",
  gold: "#D4A843",
  goldSoft: "#B8902F",
  success: "#6FBF73",
  paper: "#F7F2E8",
  paperAlt: "#EEE5D6",
  ink: "#17130D",
  inkMuted: "#5F5546",
  rule: "#D8CBB6",
  // Navy accents for editorial headings
  navy: "#0A2540",
  navyDeep: "#061A33",
  navyMid: "#1E4A7C",
  navyAccent: "#2E6CB0",
  // Rating pill palette
  good: "#3F8A4F",
  goodBg: "#E2EFD9",
  warn: "#B07A1F",
  warnBg: "#F5E6C6",
  risk: "#A23A28",
  riskBg: "#F1D6CF",
  neutralBg: "#E6E0D2",
  neutralInk: "#4A4030",
};

// Reusable navy gradient (applied via background-clip:text on headings)
const NAVY_GRADIENT = `linear-gradient(135deg, ${THEME.navyDeep} 0%, ${THEME.navyMid} 50%, ${THEME.navyAccent} 100%)`;

type PdfDesignPreset = "signature" | "editorial_navy" | "minimal_ink" | "high_contrast";
type PdfDensity = "compact" | "balanced" | "spacious";
type PdfChapterStyle = "classic" | "opener_band" | "minimal";
type PdfTableStyle = "classic" | "ledger" | "minimal";
type PdfCoverStyle = "image" | "title_overlay" | "editorial";
type PdfDesignOptions = {
  preset: PdfDesignPreset;
  density: PdfDensity;
  chapterStyle: PdfChapterStyle;
  tableStyle: PdfTableStyle;
  coverStyle: PdfCoverStyle;
  bodyScale: number;
  visualIntensity: number;
  showDropCaps: boolean;
  showSectionNumbers: boolean;
  justifyText: boolean;
};

const DEFAULT_PDF_DESIGN: PdfDesignOptions = {
  preset: "signature",
  density: "balanced",
  chapterStyle: "classic",
  tableStyle: "classic",
  coverStyle: "title_overlay",
  bodyScale: 100,
  visualIntensity: 70,
  showDropCaps: false,
  showSectionNumbers: true,
  justifyText: true,
};

const DESIGN_PALETTES: Record<PdfDesignPreset, { paper: string; paperAlt: string; ink: string; muted: string; accent: string; accentSoft: string; heading: string; heading2: string; cover: string }> = {
  signature: { paper: THEME.paper, paperAlt: THEME.paperAlt, ink: THEME.ink, muted: THEME.inkMuted, accent: THEME.gold, accentSoft: THEME.goldSoft, heading: THEME.navyDeep, heading2: THEME.navyAccent, cover: THEME.bg },
  editorial_navy: { paper: "#F3F0E7", paperAlt: "#E8E1D2", ink: "#111A24", muted: "#5C6570", accent: "#B9923E", accentSoft: "#8B6B23", heading: "#061A33", heading2: "#275F9C", cover: "#061A33" },
  minimal_ink: { paper: "#FAF8F2", paperAlt: "#EFEAE0", ink: "#151515", muted: "#62605A", accent: "#151515", accentSoft: "#4A4740", heading: "#151515", heading2: "#4A4740", cover: "#151515" },
  high_contrast: { paper: "#FFFFFF", paperAlt: "#F0F0F0", ink: "#080808", muted: "#3A3A3A", accent: "#D4A843", accentSoft: "#8A6418", heading: "#000000", heading2: "#2B2B2B", cover: "#000000" },
};

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizePdfDesign(input: unknown): PdfDesignOptions {
  const raw = typeof input === "object" && input ? input as Record<string, unknown> : {};
  return {
    preset: pick(raw.preset, ["signature", "editorial_navy", "minimal_ink", "high_contrast"] as const, DEFAULT_PDF_DESIGN.preset),
    density: pick(raw.density, ["compact", "balanced", "spacious"] as const, DEFAULT_PDF_DESIGN.density),
    chapterStyle: pick(raw.chapterStyle, ["classic", "opener_band", "minimal"] as const, DEFAULT_PDF_DESIGN.chapterStyle),
    tableStyle: pick(raw.tableStyle, ["classic", "ledger", "minimal"] as const, DEFAULT_PDF_DESIGN.tableStyle),
    coverStyle: pick(raw.coverStyle, ["image", "title_overlay", "editorial"] as const, DEFAULT_PDF_DESIGN.coverStyle),
    bodyScale: clampNumber(raw.bodyScale, 90, 112, DEFAULT_PDF_DESIGN.bodyScale),
    visualIntensity: clampNumber(raw.visualIntensity, 0, 100, DEFAULT_PDF_DESIGN.visualIntensity),
    showDropCaps: raw.showDropCaps === true,
    showSectionNumbers: raw.showSectionNumbers !== false,
    justifyText: raw.justifyText !== false,
  };
}

function fmtMoney(v: unknown): string {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(n);
}
function fmtPct(v: unknown, digits = 2): string {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escAttr(s: unknown): string {
  return esc(s)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function websiteHref(value: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function cssString(s: unknown): string {
  return esc(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n|\f/g, "\\A ");
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Aggressively strip leftover branding boilerplate and duplicated report titles
 * that the AI generator tends to bake into the markdown. Runs anywhere in the
 * document, not just at the top.
 */
function cleanReportMarkdown(markdown: string, address: string): string {
  const addressPattern = escapeRegExp(address).replace(/\s+/g, "\\s+");
  let out = markdown;

  // Remove company-branding blocks wherever they appear.
  out = out.replace(
    /^\s*#{0,3}\s*NAIDU PROPERTY CONSULTING(\s+SERVICES)?\s*\n+/gim,
    "",
  );
  out = out.replace(/^\s*#{0,3}\s*YOUR DEDICATED PROPERTY PARTNER\s*\n+/gim, "");
  // Duplicate "Investment Report: <address>" titles inside the body.
  out = out.replace(
    new RegExp(`^\\s*#{0,3}\\s*Investment Report:\\s*${addressPattern}\\s*\\n+`, "gim"),
    "",
  );

  // Strip raw citation placeholders the model leaves behind.
  out = out.replace(/\[\s*citation\s*\]/gi, "");
  out = out.replace(/\[\s*sources?\s*\]/gi, "");
  out = out.replace(/\[\s*ref(?:erence)?\s*\]/gi, "");

  // Normalise everything to h2 so chapter numbering is consistent.
  out = out.replace(/^\s*#\s+/gm, "## ");

  // Collapse 3+ blank lines down to 2.
  out = out.replace(/\n{3,}/g, "\n\n");

  return out.trim();
}

const INSIGHT_LABEL_RE =
  /^(what\s+this\s+means|why\s+it\s+matters|why\s+it'?s\s+important|takeaway|takeaways|key\s+takeaway|the\s+takeaway|watch|what\s+to\s+watch|things?\s+to\s+watch|bottom\s+line|so\s+what|implication|implications|key\s+insight|insight|in\s+plain\s+english|npc\s+view|our\s+view|the\s+bottom\s+line)$/i;

/**
 * Wrap narrative subsections into a styled callout box. Supports both:
 *   1. h3/h4 heading form  →  ### What This Means
 *   2. Inline bold-prefix form  →  **What This Means:** body…
 */
function wrapInsightSections(html: string): string {
  // Form 0 (normaliser): rewrite italic/underline/plain insight-label paragraphs
  // into the <strong> form so Forms 2/4 catch them. Covers the variants where
  // the model emits "What This Means:" in italics or as plain text.
  html = html.replace(
    /<p>\s*(?:<(em|i|u)>\s*)?([A-Za-z][A-Za-z'\s]{2,40}?)\s*[:：]\s*(?:<\/\1>)?\s*([\s\S]*?)<\/p>/gi,
    (match, _tag, rawLabel, rest) => {
      const label = String(rawLabel).trim();
      if (!INSIGHT_LABEL_RE.test(label)) return match;
      // Already strong? leave as-is for Form 2/4.
      if (/^<\s*(strong|b)\b/i.test(match.replace(/^<p>\s*/i, ""))) return match;
      const body = String(rest).trim();
      return `<p><strong>${label}:</strong> ${body}</p>`;
    },
  );

  // Form 1: h3 / h4 heading captures content until next h1–h4. This uses a
  // linear tag scan so malformed stored HTML cannot trigger repeated rescans.
  let out = wrapInsightHeadingSections(html, (title) => INSIGHT_LABEL_RE.test(title), esc);

  // Form 2: <p><strong>Label[:]</strong>[:] rest…</p> + ALL following block siblings
  // (paragraphs, lists, blockquotes, tables) until the next heading, hr,
  // another insight-box, section boundary, or another bold-prefix insight label.
  out = wrapInlineInsightParagraphs(out, {
    isInsightLabel: (label) => INSIGHT_LABEL_RE.test(label),
    escapeLabel: (label) => esc(label),
  });

  // Form 3: list-item bold-prefix form  →  <li><strong>What This Means:</strong> body…</li>
  // Many narrative bullets in the report use this pattern. Style the <li> as an
  // inline gold callout so it visually matches the .insight-box panels above.
  out = out.replace(
    /<li([^>]*)>\s*<(?:strong|b)>\s*([^<:：]+?)\s*[:：]?\s*<\/(?:strong|b)>\s*[:：]?\s*([\s\S]*?)<\/li>/gi,
    (match, attrs, rawLabel, body) => {
      const label = String(rawLabel).trim();
      if (!INSIGHT_LABEL_RE.test(label)) return match;
      return `<li${attrs} class="insight-li"><span class="insight-label-inline">${esc(label)}</span><span class="insight-li-body">${body}</span></li>`;
    },
  );

  // Form 4: bare label paragraph  →  <p><strong>What This Means:</strong></p><p>body…</p>
  // (Form 2 sometimes fails to catch this when the lookahead does not match.)
  out = out.replace(
    /<p>\s*<(?:strong|b)>\s*([^<:：]+?)\s*[:：]?\s*<\/(?:strong|b)>\s*[:：]?\s*<\/p>\s*(<p>[\s\S]*?<\/p>)/gi,
    (match, rawLabel, bodyPara) => {
      const label = String(rawLabel).trim();
      if (!INSIGHT_LABEL_RE.test(label)) return match;
      return `<div class="insight-box"><div class="insight-label">${esc(label)}</div>${bodyPara}</div>`;
    },
  );

  return out;
}

/**
 * Colour-code rating-style cells (Strong / Moderate / High / Low / etc.) by
 * wrapping their text in a tinted pill.
 */
const RATING_MAP: Array<{ test: RegExp; cls: string }> = [
  { test: /^(strong|very\s+strong|excellent|high\s+confidence|low\s+risk|low|stable|positive|good|established|mature)$/i, cls: "pill-good" },
  { test: /^(moderate(?:[\u2013\u2014-]\s*strong)?|medium|developing|early\s+to\s+developing|catching\s+up|emerging|fair|mixed|within\s+your\s+control)$/i, cls: "pill-warn" },
  { test: /^(weak|low\s+demand|high(?:\s+risk)?|very\s+high|elevated|cautious|poor|undersupplied|oversupplied|medium[\u2013\u2014-]high|high[\u2013\u2014-]very\s+high)$/i, cls: "pill-risk" },
];

function colourCodeTableCells(html: string): string {
  return html.replace(/<td([^>]*)>([\s\S]*?)<\/td>/gi, (match, attrs, inner) => {
    const plain = String(inner).replace(/<[^>]+>/g, "").trim();
    if (!plain || plain.length > 28) return match;
    for (const rule of RATING_MAP) {
      if (rule.test.test(plain)) {
        return `<td${attrs}><span class="pill ${rule.cls}">${esc(plain)}</span></td>`;
      }
    }
    return match;
  });
}

/** Strip trailing "[1]" / "[12]" citation markers that leak into prose. */
function stripBareCitations(html: string): string {
  return html.replace(/\[\s*\d{1,3}\s*\](?=[\s.,;:!?)]|<)/g, "");
}

// ─────────────────────────────────────────────────────────────
// Premium chart engine — Chart.js v4 via QuickChart's /chart endpoint
// (editorial palette, soft shadows, rounded bars, premium typography)
// ─────────────────────────────────────────────────────────────
// Editorial infographic palette — high-contrast, magazine-grade colour story.
// Anchored by the brand gold; supporting hues chosen for legibility on cream
// paper and visual distinctness on small bars / slices.
const CHART_PALETTE = [
  "#C9962B", // signature gold
  "#1F3A5F", // deep navy
  "#6FA86E", // muted sage
  "#A23A28", // burnt sienna
  "#8B6F4A", // walnut
  "#5B4A82", // aubergine
  "#3F8FA8", // teal
];
const FONT_STACK = "Inter, Helvetica, Arial, sans-serif";
const SERIF_STACK = "Playfair Display, Georgia, serif";
const MAX_AUTO_TABLE_CHARTS = 10;

/** Convert #RRGGBB to rgba(r,g,b,a). */
function withAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

const chartImageCache = new Map<string, string | null>();

function svgEsc(s: unknown): string {
  return esc(s).replace(/"/g, "&quot;");
}

function compactDataUri(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function datasetValues(dataset: any): number[] {
  return Array.isArray(dataset?.data)
    ? dataset.data.map((v: unknown) => num(v)).filter((v: number | null): v is number => v !== null)
    : [];
}

function formatAxisValue(value: number, mode: "money" | "percent" | "plain"): string {
  if (mode === "percent") return `${value.toFixed(Math.abs(value) < 10 ? 1 : 0)}%`;
  if (mode === "money") {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`;
    if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
    return `$${value.toFixed(0)}`;
  }
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(0)}k` : value.toFixed(0);
}

function inferAxisMode(config: any): "money" | "percent" | "plain" {
  const blob = JSON.stringify(config || {}).toLowerCase();
  if (blob.includes("$") || /price|cost|value|rent|income|cash|loan|equity|deposit/.test(blob)) return "money";
  if (blob.includes("%") || /yield|rate|growth|return|roi|lvr|ratio/.test(blob)) return "percent";
  return "plain";
}

/**
 * Standardised editorial chart sizes used across the report.
 * Callers should prefer these over ad-hoc dimensions so all charts read as a
 * coherent family.
 *   TREND_WIDE    — line / multi-series time series
 *   BAR_WIDE      — horizontal-feel bar groups, KPI bar comparisons
 *   DONUT_WIDE    — donut/pie with side legend
 *   COMPACT       — small in-flow visualisations
 */
const CHART_PRESETS = {
  TREND_WIDE:  { width: 820, height: 360 },
  BAR_WIDE:    { width: 820, height: 360 },
  DONUT_WIDE:  { width: 780, height: 340 },
  COMPACT:     { width: 520, height: 280 },
} as const;

/** Top-rounded bar path — editorial bar style. */
function topRoundedBarPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

/**
 * Wilkinson-style "nice" axis ticks. Rounds to 1/2/2.5/5 × 10^n so gridlines
 * land on memorable numbers rather than arbitrary fractions.
 */
function niceTicks(min: number, max: number, target = 5): { min: number; max: number; step: number; ticks: number[] } {
  if (!isFinite(min) || !isFinite(max) || min === max) {
    const v = isFinite(max) ? max : 1;
    return { min: 0, max: v || 1, step: (v || 1) / 4, ticks: [0, v / 4, v / 2, (3 * v) / 4, v] };
  }
  const range = max - min;
  const rough = range / Math.max(1, target - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step * 0.0001; v += step) ticks.push(Number(v.toFixed(10)));
  return { min: niceMin, max: niceMax, step, ticks };
}

function renderSvgChart(config: Record<string, unknown>, width: number, height: number): string {
  const cfg: any = config || {};
  const type = String(cfg.type || "bar").toLowerCase();
  const labels = (cfg.data?.labels || []).map((l: unknown) => String(l ?? ""));
  const datasets = Array.isArray(cfg.data?.datasets) ? cfg.data.datasets : [];
  const axisMode = inferAxisMode(cfg);

  // Editorial palette
  const bg = "#FFFDF8";
  const ink = "#1A1612";
  const inkSoft = "#3A2F22";
  const muted = "#7A6E58";
  const gridSolid = "#E4D9C0";
  const gridSoft = "#EFE7D2";
  const baseline = "#B8A678";

  const title = String(cfg.options?.plugins?.title?.text || "");
  const titleH  = title ? 30 : 12;
  const legendH = datasets.length > 1 ? 28 : 10;
  const xLabelH = 26;

  // Typography
  const axisFontStyle  = `font-family="Inter,Arial,sans-serif" font-size="10.5" font-weight="500"`;
  const tabular        = `style="font-variant-numeric:tabular-nums;font-feature-settings:'tnum' 1;letter-spacing:0.01em;"`;
  const titleFontStyle = `font-family="Playfair Display,Georgia,serif" font-size="15.5" font-weight="700"`;
  const legendFontStyle = `font-family="Inter,Arial,sans-serif" font-size="10.5" font-weight="500"`;
  const valueFontStyle = `font-family="Inter,Arial,sans-serif" font-size="10" font-weight="700"`;

  const titleSvg = title
    ? `<text x="32" y="22" ${titleFontStyle} fill="${ink}">${svgEsc(title)}</text>`
    : "";

  // Soft paper background, no border frame
  const frame = `<rect x="0" y="0" width="${width}" height="${height}" fill="${bg}"/>`;

  // ── Sparkline ────────────────────────────────────────────────────────────
  if (type === "sparkline") {
    const values = datasetValues(datasets[0]);
    if (values.length < 2) return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`;
    const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    const pts = values.map((v, i) => {
      const x = 8 + (i / (values.length - 1)) * (width - 16);
      const y = height - 8 - ((v - min) / span) * (height - 16);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const color = String(datasets[0]?.borderColor || THEME.gold);
    const gradId = `sg-${Math.random().toString(36).slice(2, 8)}`;
    const area = `${pts.join(" ")} ${width - 8},${height - 7} 8,${height - 7}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.32"/><stop offset="1" stop-color="${color}" stop-opacity="0.02"/></linearGradient></defs><polygon points="${area}" fill="url(#${gradId})"/><polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // ── Donut / Pie with side legend ─────────────────────────────────────────
  if (type === "doughnut" || type === "pie") {
    const values = datasetValues(datasets[0]);
    const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const ringCx = width * 0.28;
    const ringCy = (titleH + height - 18) / 2 + 4;
    const r = Math.min(width * 0.21, (height - titleH - 18) * 0.40);
    const sw = type === "doughnut" ? Math.max(22, r * 0.46) : r;

    let startA = -Math.PI / 2;
    const slices: string[] = [];
    const sliceLabels: string[] = [];
    values.forEach((v, i) => {
      const pct = Math.max(0, v) / total;
      if (pct <= 0) return;
      const endA = startA + pct * Math.PI * 2;
      const color = CHART_PALETTE[i % CHART_PALETTE.length];
      if (type === "doughnut") {
        const rMid = r;
        const x1 = ringCx + rMid * Math.cos(startA);
        const y1 = ringCy + rMid * Math.sin(startA);
        const x2 = ringCx + rMid * Math.cos(endA);
        const y2 = ringCy + rMid * Math.sin(endA);
        const large = pct > 0.5 ? 1 : 0;
        if (pct >= 0.999) {
          slices.push(`<circle cx="${ringCx}" cy="${ringCy}" r="${rMid}" fill="none" stroke="${color}" stroke-width="${sw}"/>`);
        } else {
          slices.push(`<path d="M${x1.toFixed(2)},${y1.toFixed(2)} A${rMid},${rMid} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="butt"/>`);
        }
      } else {
        const x1 = ringCx + r * Math.cos(startA);
        const y1 = ringCy + r * Math.sin(startA);
        const x2 = ringCx + r * Math.cos(endA);
        const y2 = ringCy + r * Math.sin(endA);
        const large = pct > 0.5 ? 1 : 0;
        slices.push(`<path d="M${ringCx},${ringCy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${color}"/>`);
      }
      // In-slice % label when slice ≥ 7%
      if (pct >= 0.07) {
        const midA = (startA + endA) / 2;
        const labelR = type === "doughnut" ? r : r * 0.62;
        const lx = ringCx + labelR * Math.cos(midA);
        const ly = ringCy + labelR * Math.sin(midA);
        sliceLabels.push(`<text x="${lx.toFixed(2)}" y="${(ly + 3.5).toFixed(2)}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="11" font-weight="700" fill="#FFFDF8" ${tabular}>${(pct * 100).toFixed(0)}%</text>`);
      }
      startA = endA;
    });

    // Center label for donut: top slice %
    let centerLabel = "";
    if (type === "doughnut") {
      const topIdx = values.indexOf(Math.max(...values));
      const topPct = ((values[topIdx] || 0) / total * 100).toFixed(0);
      centerLabel = `
        <text x="${ringCx}" y="${ringCy - 4}" text-anchor="middle" font-family="Playfair Display,Georgia,serif" font-size="24" font-weight="800" fill="${ink}" ${tabular}>${topPct}%</text>
        <text x="${ringCx}" y="${ringCy + 14}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="8.5" font-weight="600" fill="${muted}" letter-spacing="1.6">${svgLabelUpper(labels[topIdx] || "TOP").slice(0, 18)}</text>
      `;
    }

    const legendX = ringCx + r + sw / 2 + 32;
    const lineH = 22;
    const startY = ringCy - (values.length - 1) * lineH / 2 - 4;
    const legend = values.map((v, i) => {
      const pct = ((Math.max(0, v) / total) * 100).toFixed(1);
      const y = startY + i * lineH;
      const valueLabel = `${formatAxisValue(v, axisMode)}  ·  ${pct}%`;
      return `<g transform="translate(${legendX},${y})">
        <rect x="0" y="-9" width="11" height="11" rx="2" fill="${CHART_PALETTE[i % CHART_PALETTE.length]}"/>
        <text x="20" y="0" ${legendFontStyle} fill="${ink}">${svgLabel(labels[i] || "")}</text>
        <text x="20" y="14" font-family="Inter,Arial,sans-serif" font-size="9.5" font-weight="500" ${tabular} fill="${muted}">${svgEsc(valueLabel)}</text>
      </g>`;
    }).join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${frame}${titleSvg}${slices.join("")}${centerLabel}${sliceLabels.join("")}${legend}</svg>`;
  }

  // ── Line / Bar ───────────────────────────────────────────────────────────
  const series = datasets.map((d: any, i: number) => ({
    label: String(d?.label || ""),
    values: datasetValues(d),
    color: String(d?.borderColor || (Array.isArray(d?.backgroundColor) ? d.backgroundColor[0] : d?.backgroundColor) || CHART_PALETTE[i % CHART_PALETTE.length]),
  })).filter((d: any) => d.values.length);
  const all = series.flatMap((s: any) => s.values);
  if (!all.length || !labels.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${frame}</svg>`;

  const rawMin = Math.min(0, ...all), rawMax = Math.max(...all, rawMin + 1);
  const nice = niceTicks(rawMin, rawMax, 5);
  const yMin = nice.min, yMax = nice.max;
  const ySpan = yMax - yMin || 1;

  const sampleLabels = nice.ticks.map((t) => formatAxisValue(t, axisMode));
  const maxTickChars = Math.max(...sampleLabels.map((s) => s.length));
  const padL = Math.max(56, 18 + maxTickChars * 6.2);
  const padR = 28;
  const plot = {
    x: padL,
    y: titleH + 10,
    w: Math.max(160, width - padL - padR),
    h: Math.max(80, height - titleH - 10 - xLabelH - (series.length > 1 ? legendH : 8) - 12),
  };
  const yOf = (v: number) => plot.y + plot.h - ((v - yMin) / ySpan) * plot.h;

  const gridLines = nice.ticks.map((tv, i) => {
    const y = yOf(tv);
    const isZero = Math.abs(tv) < 1e-9;
    const stroke = isZero ? baseline : (i % 2 === 0 ? gridSolid : gridSoft);
    const sw2 = isZero ? 0.8 : 0.5;
    return `<line x1="${plot.x}" x2="${plot.x + plot.w}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${stroke}" stroke-width="${sw2}"/>` +
      `<text x="${plot.x - 12}" y="${y.toFixed(1)}" dy="3.4" text-anchor="end" ${axisFontStyle} ${tabular} fill="${muted}">${svgEsc(formatAxisValue(tv, axisMode))}</text>`;
  }).join("");

  let marks = "";
  let valueLabels = "";
  const defs: string[] = [];

  if (type === "line") {
    marks = series.map((s: any, si: number) => {
      const gradId = `lg-${si}-${Math.random().toString(36).slice(2, 6)}`;
      defs.push(`<linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity="0.28"/><stop offset="1" stop-color="${s.color}" stop-opacity="0.02"/></linearGradient>`);
      const pts = s.values.map((v: number, i: number) => `${(plot.x + (i / Math.max(1, labels.length - 1)) * plot.w).toFixed(1)},${yOf(v).toFixed(1)}`);
      const fill = si === 0 && s.values.length > 1
        ? `<polygon points="${pts.join(" ")} ${plot.x + plot.w},${yOf(yMin)} ${plot.x},${yOf(yMin)}" fill="url(#${gradId})"/>`
        : "";
      const dots = pts.map((p: string) => {
        const [px, py] = p.split(",");
        return `<circle cx="${px}" cy="${py}" r="3" fill="${bg}" stroke="${s.color}" stroke-width="1.8"/>`;
      }).join("");
      return `${fill}<polyline points="${pts.join(" ")}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>${dots}`;
    }).join("");
  } else {
    const groups = labels.length;
    const groupW = plot.w / groups;
    const innerW = groupW * 0.72;
    const barW = Math.max(8, Math.min(46, innerW / Math.max(1, series.length)));
    const corner = Math.min(4, barW / 3);
    const allBarRects: string[] = [];
    const allLabels: string[] = [];
    labels.forEach((_, i) => {
      series.forEach((s: any, si: number) => {
        const v = s.values[i] ?? 0;
        const y = yOf(Math.max(v, 0));
        const zero = yOf(0);
        const x = plot.x + i * groupW + (groupW - barW * series.length) / 2 + si * barW;
        const h = Math.max(1.5, Math.abs(zero - y));
        const isNeg = v < 0;
        const path = isNeg
          ? topRoundedBarPath(x, zero, barW - 2, h, corner)
          : topRoundedBarPath(x, Math.min(y, zero), barW - 2, h, corner);
        allBarRects.push(`<path d="${path}" fill="${s.color}" fill-opacity="0.95"/>`);
        if (series.length === 1 && Math.abs(v) > 0 && h > 14) {
          const lbl = formatAxisValue(v, axisMode);
          const ly = isNeg ? y + h + 12 : y - 6;
          allLabels.push(`<text x="${(x + (barW - 2) / 2).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" ${valueFontStyle} ${tabular} fill="${inkSoft}">${svgEsc(lbl)}</text>`);
        }
      });
    });
    marks = allBarRects.join("");
    valueLabels = allLabels.join("");
  }

  // X-axis labels — auto-thin when crowded
  const maxXLabels = Math.floor(plot.w / 56);
  const xStep = labels.length > maxXLabels ? Math.ceil(labels.length / maxXLabels) : 1;
  const xLabels = labels.map((label, i) => {
    if (i % xStep !== 0 && i !== labels.length - 1) return "";
    const x = type === "line"
      ? plot.x + (i / Math.max(1, labels.length - 1)) * plot.w
      : plot.x + (i + 0.5) * (plot.w / labels.length);
    const txt = label.length > 16 ? label.slice(0, 14) + "…" : label;
    return `<text x="${x.toFixed(1)}" y="${(plot.y + plot.h + 18).toFixed(1)}" text-anchor="middle" ${axisFontStyle} fill="${muted}">${svgEsc(txt)}</text>`;
  }).join("");

  // Centered legend (multi-series only)
  const legendY = height - 14;
  const legend = series.length > 1
    ? (() => {
        const itemWs = series.map((s: any) => 26 + s.label.length * 6.2);
        const totalW = itemWs.reduce((a: number, b: number) => a + b + 18, -18);
        let cursor = (width - totalW) / 2;
        return `<g transform="translate(0,${legendY})">${series.map((s: any, i: number) => {
          const x = cursor;
          cursor += itemWs[i] + 18;
          return `<g transform="translate(${x.toFixed(1)},0)"><circle cx="5" cy="-4" r="5" fill="${s.color}"/><text x="16" y="0" ${legendFontStyle} fill="${ink}">${svgEsc(s.label)}</text></g>`;
        }).join("")}</g>`;
      })()
    : "";

  const defsBlock = defs.length ? `<defs>${defs.join("")}</defs>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${frame}${defsBlock}${titleSvg}<g>${gridLines}</g>${marks}${valueLabels}${xLabels}${legend}</svg>`;
}


/**
 * Serialize a Chart.js config to a JS (not JSON) string so that function-string
 * values — tick callbacks, datalabels formatters, etc. — appear unquoted in the
 * payload and are evaluated by QuickChart's Node/JSDOM sandbox rather than being
 * treated as inert string literals.
 *
 * Rules:
 *  • String values that look like function/arrow-fn expressions → emitted unquoted
 *  • All other string values → JSON-quoted (safe, handles special chars)
 *  • Objects / arrays → recursed
 *  • Primitives (number, boolean, null) → toString as-is
 */
function isFnStr(s: string): boolean {
  const t = s.trim();
  // function(...){...}  |  (v) => ...  |  v => ...
  return /^function[\s(]/.test(t) || /^\(.*\)\s*=>/.test(t) || /^\w+\s*=>/.test(t);
}
function configToJs(val: unknown): string {
  if (val === null || val === undefined) return "null";
  if (typeof val === "boolean" || typeof val === "number") return String(val);
  if (typeof val === "string") return isFnStr(val) ? val : JSON.stringify(val);
  if (Array.isArray(val)) return "[" + val.map(configToJs).join(",") + "]";
  if (typeof val === "object") {
    const pairs = Object.entries(val as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
        return `${key}:${configToJs(v)}`;
      });
    return "{" + pairs.join(",") + "}";
  }
  return String(val);
}

/**
 * Render charts as compact inline SVG. This avoids QuickChart/Api2PDF network
 * fan-out inside one Edge Function request, which was the root cause of 504s.
 */
async function chartDataUri(config: Record<string, unknown>, width = 720, height = 340, purpose = "chart"): Promise<string | null> {
  const chartJs = configToJs(config);
  const cacheKey = chartJs + `|${width}x${height}`;
  if (chartImageCache.has(cacheKey)) return chartImageCache.get(cacheKey) ?? null;
  try {
    const uri = compactDataUri(renderSvgChart(config, width, height));
    chartImageCache.set(cacheKey, uri);
    return uri;
  } catch (err) {
    console.warn("[charts] inline SVG render error", { purpose, error: err instanceof Error ? err.message : String(err) });
    chartImageCache.set(cacheKey, null);
    return null;
  }
}


async function quickSparklineUrl(values: number[], color: string = THEME.gold): Promise<string | null> {
  const cfg = {
    type: "sparkline",
    data: {
      datasets: [{
        data: values,
        borderColor: color,
        backgroundColor: withAlpha(color, 0.18),
        fill: true,
        borderWidth: 2.2,
        pointRadius: 0,
        tension: 0.4,
      }],
    },
    options: { plugins: { legend: { display: false } } },
  };
  return chartDataUri(cfg, 260, 60, "sparkline");
}

function parseLooseNumber(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[,$%\s]/g, "")
    .replace(/[a-zA-Z]+/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Detect whether a column header suggests a monetary axis. */
function isMoneyHeader(h: string): boolean {
  return /\$|price|cost|value|rent|income|cash|loan|equity|deposit|repay/i.test(h);
}
function isPctHeader(h: string): boolean {
  return /%|yield|rate|growth|return|roi|lvr|ratio/i.test(h);
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") return parseLooseNumber(v);
  return null;
}

function projectionRows(fin: any): any[] {
  const p = fin?.projections || fin?.tenYearProjections || fin?.yearByYear || fin?.yearOneToTen;
  if (Array.isArray(p)) return p;
  if (p && typeof p === "object") {
    for (const key of ["moderate", "base", "baseline", "conservative", "optimistic"]) {
      if (Array.isArray(p[key])) return p[key];
    }
    const firstArray = Object.values(p).find((v) => Array.isArray(v));
    if (Array.isArray(firstArray)) return firstArray;
  }
  return [];
}

function pickSeries(rows: any[], keys: string[]): number[] | null {
  const vals = rows.map((row) => {
    for (const key of keys) {
      const picked = num(row?.[key]);
      if (picked !== null) return picked;
    }
    return null;
  });
  return vals.length >= 3 && vals.every((v) => v !== null) ? vals as number[] : null;
}

// ─── Section-aware chart selection ──────────────────────────────────────────
// Classify a chapter/section title into a domain hint that drives chart-type
// selection and section-level chart suppression.
export type SectionHint =
  | "financial"      // cashflow, projections, equity, ROI, lending — favour LINE
  | "sensitivity"    // rate-shock, scenarios, what-if — favour GROUPED BAR
  | "comparison"     // suburb / property / lender compare — favour GROUPED BAR
  | "distribution"   // age/income/share/composition — favour DONUT (if shares)
  | "demographics"   // population, household, tenure — favour BAR
  | "score"          // risk register, scoring, indices — favour HORIZONTAL BAR
  | "trend"          // growth, yield over time, indices — favour LINE
  | "ranking"        // top suburbs, lender ranking — favour HORIZONTAL BAR
  | "skip"           // disclaimer / glossary / methodology / appendix
  | "generic";

function classifySection(title: string): SectionHint {
  const t = (title || "").toLowerCase();
  if (!t) return "generic";
  if (/(disclaimer|glossary|methodolog|appendix|about\s+(this|us)|notes?$|sources?$|references?)/.test(t)) return "skip";
  if (/(sensitivity|rate\s*shock|stress|scenario|what[-\s]*if)/.test(t)) return "sensitivity";
  if (/(cash\s*flow|cashflow|projection|equity|loan|lending|finance|borrowing|repay|serviceab|p\s*&\s*l|cost\s+of\s+ownership|holding\s+cost|tax|depreciation|negative\s+gearing|return|roi|irr)/.test(t)) return "financial";
  if (/(compare|comparison|versus|vs\.?|side[-\s]*by|benchmark|peer)/.test(t)) return "comparison";
  if (/(demograph|population|household|tenure|occupation|employment|migration|age\s+profile|family\s+composition|languages?\s+spoken)/.test(t)) return "demographics";
  if (/(composition|distribution|breakdown|mix|share|split|allocation|property\s+type|dwelling\s+type|bedroom)/.test(t)) return "distribution";
  if (/(risk(\s+register)?|score|rating|index|indices|grade|signal|confidence)/.test(t)) return "score";
  if (/(trend|growth|history|historical|over\s+time|yoy|year[-\s]*on[-\s]*year|forecast|outlook|10[-\s]*year|5[-\s]*year)/.test(t)) return "trend";
  if (/(top\s+\d|ranking|leaderboard|highest|lowest|best\s+performing)/.test(t)) return "ranking";
  return "generic";
}

async function tableToChartHtml(
  headers: string[],
  rows: string[][],
  ctx: { sectionTitle?: string; sectionHint?: SectionHint } = {},
): Promise<string | null> {
  const hint: SectionHint = ctx.sectionHint ?? classifySection(ctx.sectionTitle || "");
  // Section-level suppression: never visualise tables in reference/legal pages.
  if (hint === "skip") return null;

  // Tightened heuristics: only chart tables that will actually read as a chart.
  if (rows.length < 3 || rows.length > 14) return null;
  if (headers.length < 2 || headers.length > 6) return null;

  // Drop summary rows (Total / Subtotal / Average / Sum / Mean) before charting —
  // these are scale-distorting and produce nonsensical bars.
  const SUMMARY_RX = /^\s*(total|subtotal|sum|average|avg|mean|grand\s*total|all\s*years?|overall)\b/i;
  const filteredRows = rows.filter((r) => !SUMMARY_RX.test(r[0] || ""));
  if (filteredRows.length < 3) return null;

  const labels = filteredRows.map((r) => (r[0] || "").slice(0, 28));
  // Reject if first-column labels look like placeholders ("Item 1", "Row 2", "—", blank)
  const placeholderCount = labels.filter((l) => !l || /^(item|row|note|n\/?a|—|-)\s*\d*$/i.test(l)).length;
  if (placeholderCount > labels.length / 3) return null;

  const numericCols: Array<{ header: string; values: number[]; isPct: boolean; isMoney: boolean }> = [];
  for (let c = 1; c < headers.length; c++) {
    const vals = filteredRows.map((r) => parseLooseNumber(r[c] || ""));
    if (vals.every((v) => v !== null) && vals.length === filteredRows.length) {
      const colCells = filteredRows.map((r) => r[c] || "").join(" ");
      numericCols.push({
        header: headers[c],
        values: vals as number[],
        isPct: /%/.test(colCells) || isPctHeader(headers[c]),
        isMoney: /\$/.test(colCells) || isMoneyHeader(headers[c]),
      });
    }
  }
  if (numericCols.length === 0) return null;

  // Reject mixed-unit columns (e.g. some % and some $) — they don't share an axis.
  const unitTypes = new Set(numericCols.map((c) => c.isPct ? "pct" : c.isMoney ? "money" : "plain"));
  if (unitTypes.size > 1) return null;

  // Reject columns with no variance (all same value) — flat bars are useless.
  if (numericCols.every((c) => Math.max(...c.values) === Math.min(...c.values))) return null;

  const cellBlob = filteredRows.map((r) => r.join(" ")).join(" ");
  const headerBlob = headers.join(" ");
  const looksPct = /%/.test(cellBlob) || isPctHeader(headerBlob);
  const looksMoney = /\$/.test(cellBlob) || isMoneyHeader(headerBlob);
  const singleSeries = numericCols.length === 1;
  const isTimeSeries = labels.every((l) => /^(19|20)\d{2}$|^yr\s*\d+$|^year\s*\d+$/i.test(l.trim()));

  // Rebind rows to filtered set for downstream code
  rows = filteredRows;

  const tickCallback = looksPct
    ? "function(v){return v.toFixed(1)+'%';}"
    : looksMoney
      ? "function(v){return Math.abs(v)>=1000?'$'+(v/1000).toFixed(0)+'k':'$'+v.toFixed(0);}"
      : null;

  const commonFont = { family: FONT_STACK, size: 11 };
  const titleFont = { family: SERIF_STACK, size: 14, weight: "600" };
  const gridColor = "rgba(181, 165, 128, 0.25)";
  const tickColor = "#5F5546";

  // ── Decide preferred chart type from section context ──
  // Force-line for trend/financial when we have ≥4 labels (even if labels aren't pure years —
  // e.g. "Yr 1, Yr 2, ..." or quarter labels).
  const forceLine = (hint === "financial" || hint === "trend") && labels.length >= 4 && !looksPct;
  // Force horizontal bar for ranking & score sections (better readability for long labels).
  const forceHBar = hint === "ranking" || hint === "score";
  // Force grouped bar for comparison & sensitivity (avoid line — categorical x-axis).
  const forceGroupedBar = hint === "comparison" || hint === "sensitivity";

  let config: Record<string, unknown>;

  // ── Donut: distributions that genuinely sum to ~100, single % series, ≤7 rows ──
  const donutSum = numericCols[0].values.reduce((a, b) => a + Math.max(0, b), 0);
  const donutIsShare = donutSum >= 80 && donutSum <= 120;
  const donutAllowed =
    singleSeries &&
    rows.length <= 7 &&
    looksPct &&
    donutIsShare &&
    (hint === "distribution" || hint === "demographics" || hint === "generic") &&
    !forceLine && !forceHBar && !forceGroupedBar;
  if (donutAllowed) {
    config = {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data: numericCols[0].values,
          backgroundColor: labels.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
          borderColor: "#FFFDF8",
          borderWidth: 2,
        }],
      },
      options: {
        cutout: "58%",
        plugins: {
          title: { display: true, text: numericCols[0].header, color: "#2A2317", font: titleFont, padding: { top: 8, bottom: 14 } },
          legend: { position: "right", labels: { color: "#17130D", font: commonFont, boxWidth: 12, padding: 10 } },
          datalabels: {
            color: "#FFFDF8", font: { ...commonFont, weight: "600" },
            formatter: "(v)=>v.toFixed(1)+'%'",
          },
        },
      },
    };
    const uri = await chartDataUri(config, CHART_PRESETS.DONUT_WIDE.width, CHART_PRESETS.DONUT_WIDE.height, `donut:${numericCols[0].header}`);
    if (!uri) return null;
    return `<figure class="auto-chart"><img src="${uri}" alt="Distribution chart"/></figure>`;
  }

  // ── Line: explicit time series, OR financial/trend sections with enough points ──
  if ((isTimeSeries || forceLine) && !forceHBar && !forceGroupedBar) {
    config = {
      type: "line",
      data: {
        labels,
        datasets: numericCols.map((col, i) => {
          const c = CHART_PALETTE[i % CHART_PALETTE.length];
          return {
            label: col.header,
            data: col.values,
            borderColor: c,
            backgroundColor: i === 0 ? withAlpha(c, 0.18) : withAlpha(c, 0.05),
            borderWidth: 2.4,
            tension: 0.4,
            pointRadius: 3,
            pointBackgroundColor: c,
            pointBorderColor: "#FFFDF8",
            pointBorderWidth: 1.5,
            fill: i === 0,
          };
        }),
      },
      options: {
        plugins: {
          legend: numericCols.length > 1
            ? { position: "bottom", labels: { color: "#17130D", font: commonFont, boxWidth: 12, padding: 12, usePointStyle: true } }
            : { display: false },
        },
        scales: {
          x: { ticks: { color: tickColor, font: commonFont }, grid: { color: "transparent" }, border: { color: "#B5A580" } },
          y: {
            ticks: tickCallback
              ? { color: tickColor, font: commonFont, callback: tickCallback }
              : { color: tickColor, font: commonFont },
            grid: { color: gridColor, drawBorder: false },
            border: { display: false },
          },
        },
      },
    };
    const uri = await chartDataUri(config, CHART_PRESETS.TREND_WIDE.width, CHART_PRESETS.TREND_WIDE.height, `line:${numericCols.map((c) => c.header).join(",")}`);
    if (!uri) return null;
    return `<figure class="auto-chart"><img src="${uri}" alt="Trend chart"/></figure>`;
  }

  // ── Horizontal bar for rankings and score-style tables ──
  if (forceHBar && singleSeries) {
    config = {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: numericCols[0].header,
          data: numericCols[0].values,
          backgroundColor: withAlpha(CHART_PALETTE[0], 0.92),
          borderColor: CHART_PALETTE[0],
          borderWidth: 0,
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 22,
        }],
      },
      options: {
        indexAxis: "y",
        plugins: {
          legend: { display: false },
          datalabels: { anchor: "end", align: "end", color: "#2A2317", font: { ...commonFont, weight: "600" }, formatter: tickCallback || "(v)=>v" },
        },
        scales: {
          x: {
            ticks: tickCallback
              ? { color: tickColor, font: commonFont, callback: tickCallback }
              : { color: tickColor, font: commonFont },
            grid: { color: gridColor, drawBorder: false },
            border: { display: false },
          },
          y: { ticks: { color: tickColor, font: commonFont }, grid: { color: "transparent" }, border: { color: "#B5A580" } },
        },
      },
    };
    const uri = await chartDataUri(config, CHART_PRESETS.BAR_WIDE.width, CHART_PRESETS.BAR_WIDE.height, `hbar:${numericCols[0].header}`);
    if (!uri) return null;
    return `<figure class="auto-chart"><img src="${uri}" alt="${hint === "ranking" ? "Ranking chart" : "Score chart"}"/></figure>`;
  }

  // ── Vertical / grouped bar (default + comparison + sensitivity + demographics) ──
  config = {
    type: "bar",
    data: {
      labels,
      datasets: numericCols.map((col, i) => {
        const c = CHART_PALETTE[i % CHART_PALETTE.length];
        return {
          label: col.header,
          data: col.values,
          backgroundColor: withAlpha(c, 0.92),
          borderColor: c,
          borderWidth: 0,
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 42,
        };
      }),
    },
    options: {
      plugins: {
        legend: numericCols.length > 1
          ? { position: "bottom", labels: { color: "#17130D", font: commonFont, boxWidth: 12, padding: 12, usePointStyle: true } }
          : { display: false },
        datalabels: singleSeries
          ? { anchor: "end", align: "top", color: "#2A2317", font: { ...commonFont, weight: "600" },
              formatter: tickCallback || "(v)=>v" }
          : { display: false },
      },
      scales: {
        x: {
          ticks: { color: tickColor, font: commonFont, maxRotation: 30, minRotation: labels.some((l) => l.length > 10) ? 25 : 0 },
          grid: { color: "transparent" },
          border: { color: "#B5A580" },
        },
        y: {
          ticks: tickCallback
            ? { color: tickColor, font: commonFont, callback: tickCallback }
            : { color: tickColor, font: commonFont },
          grid: { color: gridColor, drawBorder: false },
          border: { display: false },
        },
      },
    },
  };
  const uri = await chartDataUri(config, CHART_PRESETS.BAR_WIDE.width, CHART_PRESETS.BAR_WIDE.height, `bar:${numericCols.map((c) => c.header).join(",")}`);
  if (!uri) return null;
  const alt =
    hint === "comparison" ? "Comparison chart" :
    hint === "sensitivity" ? "Sensitivity chart" :
    hint === "demographics" ? "Demographics chart" :
    "Data chart";
  return `<figure class="auto-chart"><img src="${uri}" alt="${alt}"/></figure>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// EDITORIAL PRIMITIVES (Tier 2 — items 5–8)
//   • Pull-quotes, sidenotes, multi-column wrappers          (#5)
//   • Inline SVG heatmaps + score wheels                     (#6)
//   • Custom visualisations: gauge + waterfall + compare      (#7)
//   • Footnotes (CSS Paged Media) + "See p. X" cross-refs    (#8)
//
// All shortcodes live in markdown and survive `marked.parse()` because they
// emit block-level HTML, which GFM passes through verbatim. SVG figures are
// rendered server-side so they print at infinite resolution.
// ─────────────────────────────────────────────────────────────────────────────

const VIZ_GOLD     = "#D4A843";
const VIZ_GOLD_SOFT = "#B8893A";
const VIZ_NAVY     = "#0A2540";
const VIZ_INK      = "#2A2317";
const VIZ_INK_MUTED = "#6B604F";
const VIZ_PAPER    = "#FFFDF8";
const VIZ_PAPER_ALT = "#F7EFD9";
const VIZ_RULE     = "#CFC1A8";
const VIZ_GOOD     = "#4F7A33";
const VIZ_WARN     = "#C58A2E";
const VIZ_RISK     = "#A8401C";

// Editorial shortcodes expand stored markdown into SVG. Keep their render cost
// predictably small even when report content is attacker-controlled.
const MAX_VISUAL_SHORTCODE_CHARS = 16_384;
const MAX_WATERFALL_ITEMS = 50;
const MAX_HEATMAP_ROWS = 50;
const MAX_HEATMAP_COLS = 50;
const MAX_HEATMAP_CELLS = 400;
const MAX_WHEEL_SCORES = 24;
const MAX_COMPLEX_VISUAL_UNITS = 800;

function svgEscape(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Label text arriving from the report's markdown has ALREADY been HTML-escaped
 * — `marked` turns `Infrastructure & amenity` into `Infrastructure &amp;
 * amenity` before any shortcode is read. Two things then go wrong on the way
 * into an SVG, and the second is the visible one:
 *
 *  - `svgEscape` escapes the `&` again, so the entity prints literally;
 *  - `.toUpperCase()`, which fourteen chart labels apply, mangles the entity
 *    ITSELF — `&amp;` becomes `&AMP;`, which is not an entity at all.
 *
 * Rendered, the Executive Verdict's radar label read **`&AMP; AMENITY`** on a
 * client's page. The chapter-heading path already decodes (that is why the
 * Contents page reads correctly and the charts do not); this is that same
 * decode, named once so every label can share it.
 *
 * Decode-then-escape is not a widening: the text is escaped again on the way
 * out, so nothing the model wrote can become markup.
 */
function decodeHtmlEntities(s: unknown): string {
  return String(s ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    // `&amp;` last, so `&amp;lt;` decodes to `&lt;` rather than to `<`.
    .replace(/&amp;/g, "&");
}

/** A label drawn into an SVG: decoded once, then escaped for the SVG. */
function svgLabel(s: unknown): string {
  return svgEscape(decodeHtmlEntities(s));
}

/** The same, for the chart labels this renderer sets in capitals. */
function svgLabelUpper(s: unknown): string {
  return svgEscape(decodeHtmlEntities(s).toUpperCase());
}

/** Half-circle gauge — KPI score visualiser. */
function renderGaugeSvg(value: number, max = 100, label = "", caption = ""): string {
  const v = Math.max(0, Math.min(max, Number(value) || 0));
  const pct = v / max;
  const w = 460, h = 260;
  const cx = w / 2, cy = 180, r = 130;
  // Arc geometry: 180° (left -180°) → 0° (right). Sweep `pct` of that.
  const startA = Math.PI;          // left
  const endA   = Math.PI + Math.PI * pct;
  const polarX = (a: number) => cx + r * Math.cos(a);
  const polarY = (a: number) => cy + r * Math.sin(a);
  const largeArc = pct > 0.5 ? 1 : 0;
  const trackPath = `M ${polarX(Math.PI)} ${polarY(Math.PI)} A ${r} ${r} 0 1 1 ${polarX(2 * Math.PI - 0.0001)} ${polarY(2 * Math.PI - 0.0001)}`;
  const valuePath = pct > 0
    ? `M ${polarX(startA)} ${polarY(startA)} A ${r} ${r} 0 ${largeArc} 1 ${polarX(endA)} ${polarY(endA)}`
    : "";
  // Tick marks every 10%
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const a = Math.PI + (i / 10) * Math.PI;
    const x1 = cx + (r - 10) * Math.cos(a), y1 = cy + (r - 10) * Math.sin(a);
    const x2 = cx + (r + 2)  * Math.cos(a), y2 = cy + (r + 2)  * Math.sin(a);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${VIZ_RULE}" stroke-width="${i % 5 === 0 ? 1.4 : 0.6}"/>`;
  }).join("");
  // A verdict word, on a 0-100 score and nowhere else. These thresholds are
  // calibrated for a score out of a hundred; applied to `v / max` for any
  // other denominator they mint a grading no record holds — a SEIFA decile
  // handed in as `{{gauge: 7/10}}` printed "7 / 10 · SOLID". Same guard as
  // `renderGauge` in charts.pure.ts.
  const banded = max === 100;
  const band = !banded ? null
             : v / max >= 0.8 ? "Strong"
             : v / max >= 0.65 ? "Solid"
             : v / max >= 0.5 ? "Mixed" : "Cautious";
  const bandColor = !banded ? VIZ_GOLD
                  : v / max >= 0.65 ? VIZ_GOOD : v / max >= 0.5 ? VIZ_WARN : VIZ_RISK;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="gauge-fill" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${VIZ_GOLD_SOFT}"/><stop offset="1" stop-color="${VIZ_GOLD}"/>
      </linearGradient>
    </defs>
    <path d="${trackPath}" stroke="${VIZ_PAPER_ALT}" stroke-width="22" fill="none" stroke-linecap="round"/>
    ${valuePath ? `<path d="${valuePath}" stroke="url(#gauge-fill)" stroke-width="22" fill="none" stroke-linecap="round"/>` : ""}
    <g>${ticks}</g>
    <text x="${cx}" y="${cy - 6}" text-anchor="middle" font-family="Playfair Display,Georgia,serif" font-weight="800" font-size="62" fill="${VIZ_INK}" style="font-variant-numeric:lining-nums tabular-nums;">${Math.round(v)}</text>
    <text x="${cx}" y="${cy + 20}" text-anchor="middle" font-family="Inter,sans-serif" font-size="11" letter-spacing="2.6" fill="${VIZ_INK_MUTED}">${svgEscape((band ? "/" + max + "  ·  " + band : "/" + max).toUpperCase())}</text>
    <rect x="${cx - 38}" y="${cy + 30}" width="76" height="3" fill="${bandColor}" rx="1.5"/>
    ${label ? `<text x="${cx}" y="42" text-anchor="middle" font-family="Playfair Display,Georgia,serif" font-weight="700" font-size="18" fill="${VIZ_INK}">${svgEscape(label)}</text>` : ""}
    ${caption ? `<text x="${cx}" y="62" text-anchor="middle" font-family="Inter,sans-serif" font-size="9.5" fill="${VIZ_INK_MUTED}" letter-spacing="1.4">${svgLabelUpper(caption)}</text>` : ""}
  </svg>`;
}

/** Waterfall chart — show cumulative cash-flow build-up (positive + negative bars). */
function renderWaterfallSvg(items: Array<{ label: string; value: number; total?: boolean }>): string {
  if (!items.length || items.length > MAX_WATERFALL_ITEMS) return "";
  const w = 760, h = 360, padL = 70, padR = 24, padT = 30, padB = 70;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  // Compute running totals to find y-range
  let running = 0;
  const bars = items.map((it) => {
    const start = it.total ? 0 : running;
    const end   = it.total ? it.value : running + it.value;
    if (!it.total) running += it.value;
    else running = it.value;
    return { ...it, start, end };
  });
  const allY = bars.flatMap((b) => [b.start, b.end, 0]);
  const yMin = Math.min(...allY), yMax = Math.max(...allY);
  const span = (yMax - yMin) || 1;
  const yOf = (v: number) => padT + plotH - ((v - yMin) / span) * plotH;
  const barW = Math.max(18, Math.min(58, (plotW / bars.length) * 0.62));
  const groupW = plotW / bars.length;
  // Gridlines
  const grid = Array.from({ length: 5 }, (_, i) => {
    const t = i / 4;
    const yv = yMax - t * span;
    const y = padT + t * plotH;
    return `<line x1="${padL}" x2="${w - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${VIZ_RULE}" stroke-opacity="0.5" stroke-width="0.5"/>
      <text x="${padL - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-family="Inter,sans-serif" font-size="9.5" fill="${VIZ_INK_MUTED}" style="font-variant-numeric:tabular-nums;">${formatAxisValue(yv, "money")}</text>`;
  }).join("");
  const zeroY = yOf(0);
  // Bars + connectors
  let connectors = "";
  const rects = bars.map((b, i) => {
    const cx = padL + i * groupW + groupW / 2;
    const x = cx - barW / 2;
    const yTop = yOf(Math.max(b.start, b.end));
    const yBot = yOf(Math.min(b.start, b.end));
    const isUp = b.end >= b.start;
    const color = b.total ? VIZ_NAVY : isUp ? VIZ_GOOD : VIZ_RISK;
    const valTxt = formatAxisValue(b.end - b.start, "money");
    const labelY = yTop - 8;
    if (i < bars.length - 1) {
      const nextStart = bars[i + 1].start;
      connectors += `<line x1="${x + barW}" y1="${yOf(b.end)}" x2="${padL + (i + 1) * groupW + groupW / 2 - barW / 2}" y2="${yOf(nextStart)}" stroke="${VIZ_RULE}" stroke-dasharray="3 3" stroke-width="0.7"/>`;
    }
    return `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW}" height="${Math.max(2, yBot - yTop).toFixed(1)}" fill="${color}" fill-opacity="0.92" rx="2"/>
      <text x="${cx}" y="${labelY.toFixed(1)}" text-anchor="middle" font-family="Inter,sans-serif" font-weight="600" font-size="9.5" fill="${VIZ_INK}" style="font-variant-numeric:tabular-nums;">${svgEscape(valTxt)}</text>
      <text x="${cx}" y="${(h - padB + 16).toFixed(1)}" text-anchor="middle" font-family="Inter,sans-serif" font-size="9" fill="${VIZ_INK_MUTED}">${svgEscape(b.label.length > 16 ? b.label.slice(0, 14) + "…" : b.label)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet">
    <rect x="0" y="0" width="${w}" height="${h}" rx="6" fill="${VIZ_PAPER}"/>
    <g>${grid}</g>
    <line x1="${padL}" x2="${w - padR}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="${VIZ_INK_MUTED}" stroke-width="0.8"/>
    ${connectors}
    ${rects}
  </svg>`;
}

/** Heatmap — m×n grid with gold-saturation cells. Useful for suburb growth matrices. */
function renderHeatmapSvg(grid: number[][], rowLabels: string[] = [], colLabels: string[] = [], title = ""): string {
  if (!grid.length || !grid[0]?.length) return "";
  const rows = grid.length, cols = grid[0].length;
  if (
    rows > MAX_HEATMAP_ROWS ||
    cols > MAX_HEATMAP_COLS ||
    rows * cols > MAX_HEATMAP_CELLS ||
    grid.some((row) => row.length !== cols)
  ) return "";
  const flat = grid.flat();
  let lo = Infinity, hi = -Infinity;
  for (const value of flat) {
    lo = Math.min(lo, value);
    hi = Math.max(hi, value);
  }
  const span = (hi - lo) || 1;

  // Approximate text width @ 9pt Inter ≈ 5.2px / char; cap labels and grow cells.
  const charPx = 5.4;
  const maxRowLabelLen = rowLabels.reduce((m, l) => Math.max(m, String(l ?? "").length), 0);
  const maxColLabelLen = colLabels.reduce((m, l) => Math.max(m, String(l ?? "").length), 0);
  const maxCellValLen = Math.max(
    ...flat.map((v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)).length),
    3,
  );

  const padL = Math.max(110, Math.ceil(maxRowLabelLen * charPx) + 24);
  const padT = title ? 56 : 36;
  const padR = 22, padB = 28;
  // Cell must fit both its numeric value AND its column-label (with breathing room).
  const cellW = Math.max(64, Math.ceil(maxColLabelLen * charPx) + 18, Math.ceil(maxCellValLen * charPx) + 22);
  const cellH = 38;
  const w = padL + padR + cols * cellW;
  const h = padT + padB + rows * cellH;
  const colorFor = (v: number) => {
    const t = (v - lo) / span;
    const a = Math.round(0.08 + t * 0.82 * 100) / 100;
    return `rgba(212,168,67,${a.toFixed(2)})`;
  };
  let cells = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid[r][c];
      const x = padL + c * cellW, y = padT + r * cellH;
      cells += `<rect x="${x}" y="${y}" width="${cellW - 2}" height="${cellH - 2}" rx="1.5" fill="${colorFor(v)}" stroke="${VIZ_PAPER}" stroke-width="1"/>`;
      cells += `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 3.5}" text-anchor="middle" font-family="Inter,sans-serif" font-size="9.5" font-weight="600" fill="${VIZ_INK}" style="font-variant-numeric:tabular-nums;">${svgEscape(Number.isInteger(v) ? String(v) : v.toFixed(1))}</text>`;
    }
  }
  const rowL = rowLabels.map((lbl, r) => `<text x="${padL - 10}" y="${padT + r * cellH + cellH / 2 + 3.5}" text-anchor="end" font-family="Inter,sans-serif" font-size="9.5" fill="${VIZ_INK_MUTED}">${svgLabel(lbl)}</text>`).join("");
  const colL = colLabels.map((lbl, c) => `<text x="${padL + c * cellW + cellW / 2}" y="${padT - 10}" text-anchor="middle" font-family="Inter,sans-serif" font-size="9" fill="${VIZ_INK_MUTED}" letter-spacing="0.3">${svgLabel(lbl)}</text>`).join("");
  const t = title ? `<text x="${padL}" y="22" font-family="Playfair Display,Georgia,serif" font-weight="700" font-size="14" fill="${VIZ_INK}">${svgEscape(title)}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet"><rect width="${w}" height="${h}" rx="6" fill="${VIZ_PAPER}"/>${t}${colL}${rowL}${cells}</svg>`;
}

/**
 * A scorecard is bars on a common baseline. It used to be a radar.
 *
 * The Executive Verdict drew its five named dimensions as a filled pentagon.
 * Two of the objections are about the data rather than about taste: the
 * polygon's **area depends on the arbitrary order of the axes**, so the
 * chart's most dominant property carried no information; and area scales with
 * the **square** of the values, so a dimension at 86 beside one at 64
 * contributed ~1.8× the area rather than 1.34× and the picture overstated
 * every gap it drew. The space between two spokes also means nothing — there
 * is no continuum between "tenant appeal" and "risk profile" — and radial
 * labels crowd the corners, which is what printed `INFRASTRUCTURE & AMENITY`
 * as `ASTRUCTURE` on a client's page.
 *
 * `renderBarsSvg` fixes all of it: one baseline, length proportional to value,
 * nothing enclosed, labels set horizontally. The full reasoning is on
 * `renderScoreBars` in `_shared/reportDesign/charts.pure.ts`, which is the
 * same change on the design-system path.
 *
 * One accent rather than `renderBarsSvg`'s magnitude ramp: the measured spread
 * on a real scorecard is 64–86, and a red-to-green ramp over 22 points of a
 * 100-point scale paints an ordinary dimension as a failure.
 */
function renderScoreBarsSvg(scores: number[], labels: string[] = [], max = 100): string {
  if (scores.length < 2 || scores.length > MAX_WHEEL_SCORES) return "";
  return renderBarsSvg(
    scores.map((value, i) => ({
      label: String(labels[i] ?? `D${i + 1}`).trim(),
      value: Number(value) || 0,
      display: String(Math.round(Number(value) || 0)),
      accent: VIZ_GOLD,
    })),
    { max },
  );
}

/** Bullet chart — compact KPI with actual / target / range bands (Tufte-style). */
function renderBulletSvg(opts: { value: number; target?: number; max?: number; ranges?: number[]; label?: string; sub?: string }): string {
  const max = opts.max ?? Math.max(opts.value, opts.target ?? 0, ...(opts.ranges || []), 1);
  const w = 520, h = 78;
  const padL = 150, padR = 14, padT = 26, padB = 14;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const xOf = (v: number) => padL + (Math.max(0, Math.min(max, v)) / max) * plotW;
  const ranges = (opts.ranges && opts.ranges.length ? opts.ranges : [max * 0.4, max * 0.7, max]).slice().sort((a, b) => a - b);
  const bands = ranges.map((r, i) => {
    const prev = i === 0 ? 0 : ranges[i - 1];
    const alpha = 0.18 + (i / Math.max(1, ranges.length - 1)) * 0.42;
    return `<rect x="${xOf(prev).toFixed(1)}" y="${padT}" width="${(xOf(r) - xOf(prev)).toFixed(1)}" height="${plotH}" fill="${VIZ_GOLD}" fill-opacity="${alpha.toFixed(2)}"/>`;
  }).join("");
  const barH = plotH * 0.42;
  const barY = padT + (plotH - barH) / 2;
  const bar = `<rect x="${padL}" y="${barY}" width="${(xOf(opts.value) - padL).toFixed(1)}" height="${barH}" fill="${VIZ_INK}" rx="1"/>`;
  const tgt = opts.target != null
    ? `<line x1="${xOf(opts.target).toFixed(1)}" x2="${xOf(opts.target).toFixed(1)}" y1="${padT + 2}" y2="${padT + plotH - 2}" stroke="${VIZ_RISK}" stroke-width="3"/>`
    : "";
  const label = opts.label ? `<text x="${padL - 12}" y="${padT + plotH / 2 - 2}" text-anchor="end" font-family="Playfair Display,Georgia,serif" font-weight="700" font-size="12" fill="${VIZ_INK}">${svgEscape(opts.label)}</text>` : "";
  const sub = opts.sub ? `<text x="${padL - 12}" y="${padT + plotH / 2 + 13}" text-anchor="end" font-family="Inter,sans-serif" font-size="8.5" fill="${VIZ_INK_MUTED}" letter-spacing="0.6">${svgLabelUpper(opts.sub)}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet">
    <rect width="${w}" height="${h}" fill="${VIZ_PAPER}" rx="4"/>${bands}${bar}${tgt}${label}${sub}
  </svg>`;
}

/** Marimekko — variable-width stacked bars (composition + magnitude). */
function renderMarimekkoSvg(rows: Array<{ label: string; weight: number; segments: number[] }>, segLabels: string[] = []): string {
  if (!rows.length) return "";
  const w = 760, h = 360, padL = 90, padR = 20, padT = 32, padB = 50;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const totalWeight = rows.reduce((a, r) => a + (r.weight || 0), 0) || 1;
  const palette = [VIZ_GOLD, VIZ_NAVY, VIZ_GOOD, VIZ_WARN, VIZ_RISK, VIZ_INK_MUTED];
  let x = padL;
  const groups = rows.map((row) => {
    const colW = ((row.weight || 0) / totalWeight) * plotW;
    const sum = row.segments.reduce((a, b) => a + b, 0) || 1;
    let y = padT;
    const segs = row.segments.map((v, i) => {
      const segH = (v / sum) * plotH;
      const r = `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(colW - 1).toFixed(1)}" height="${segH.toFixed(1)}" fill="${palette[i % palette.length]}" fill-opacity="0.85"/>
        ${segH > 16 ? `<text x="${(x + colW / 2).toFixed(1)}" y="${(y + segH / 2 + 3.5).toFixed(1)}" text-anchor="middle" font-family="Inter,sans-serif" font-weight="700" font-size="10" fill="${VIZ_PAPER}">${Math.round((v / sum) * 100)}%</text>` : ""}`;
      y += segH;
      return r;
    }).join("");
    const lbl = `<text x="${(x + colW / 2).toFixed(1)}" y="${(h - padB + 16).toFixed(1)}" text-anchor="middle" font-family="Inter,sans-serif" font-size="9" fill="${VIZ_INK}">${svgLabel(row.label)}</text>`;
    const x0 = x; x += colW;
    return segs + lbl;
  }).join("");
  const legend = segLabels.map((lbl, i) => {
    const lx = padL + i * 110;
    return `<rect x="${lx}" y="10" width="10" height="10" fill="${palette[i % palette.length]}"/><text x="${lx + 14}" y="19" font-family="Inter,sans-serif" font-size="9" fill="${VIZ_INK_MUTED}" letter-spacing="0.5">${svgLabelUpper(lbl)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet">
    <rect width="${w}" height="${h}" fill="${VIZ_PAPER}" rx="6"/>${legend}${groups}
  </svg>`;
}

/** Micro-map — abstract suburb locator (concentric rings + cardinal markers + pin). */
function renderMicroMapSvg(opts: { suburb: string; state?: string; postcode?: string; neighbours?: string[] }): string {
  const w = 460, h = 320, cx = w / 2, cy = h / 2 + 6;
  const rings = [120, 84, 50].map((r, i) =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${i === 2 ? withAlphaHex(VIZ_GOLD, 0.18) : "none"}" stroke="${VIZ_RULE}" stroke-width="0.7" stroke-dasharray="${i === 0 ? "3 4" : "1 2"}"/>`).join("");
  const compass = `
    <text x="${cx}" y="${cy - 128}" text-anchor="middle" font-family="Inter,sans-serif" font-size="9" fill="${VIZ_INK_MUTED}" letter-spacing="2">N</text>
    <text x="${cx}" y="${cy + 138}" text-anchor="middle" font-family="Inter,sans-serif" font-size="9" fill="${VIZ_INK_MUTED}" letter-spacing="2">S</text>
    <text x="${cx + 132}" y="${cy + 4}" text-anchor="start" font-family="Inter,sans-serif" font-size="9" fill="${VIZ_INK_MUTED}" letter-spacing="2">E</text>
    <text x="${cx - 132}" y="${cy + 4}" text-anchor="end" font-family="Inter,sans-serif" font-size="9" fill="${VIZ_INK_MUTED}" letter-spacing="2">W</text>`;
  const neighbours = (opts.neighbours || []).slice(0, 6);
  const nbDots = neighbours.map((nb, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, neighbours.length)) * Math.PI * 2;
    const r = 100;
    const nx = cx + r * Math.cos(a), ny = cy + r * Math.sin(a);
    return `<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="3" fill="${VIZ_INK_MUTED}"/>
      <text x="${(nx + (Math.cos(a) > 0 ? 6 : -6)).toFixed(1)}" y="${(ny + 3.5).toFixed(1)}" text-anchor="${Math.cos(a) > 0.1 ? "start" : Math.cos(a) < -0.1 ? "end" : "middle"}" font-family="Inter,sans-serif" font-size="8.5" fill="${VIZ_INK_MUTED}">${svgEscape(nb)}</text>`;
  }).join("");
  const pin = `
    <path d="M ${cx} ${cy - 18} C ${cx - 14} ${cy - 18} ${cx - 14} ${cy + 2} ${cx} ${cy + 14} C ${cx + 14} ${cy + 2} ${cx + 14} ${cy - 18} ${cx} ${cy - 18} Z" fill="${VIZ_GOLD}" stroke="${VIZ_INK}" stroke-width="1.2"/>
    <circle cx="${cx}" cy="${cy - 8}" r="4.5" fill="${VIZ_PAPER}"/>`;
  const title = `<text x="${cx}" y="28" text-anchor="middle" font-family="Playfair Display,Georgia,serif" font-weight="700" font-size="16" fill="${VIZ_INK}">${svgEscape(opts.suburb)}</text>
    <text x="${cx}" y="44" text-anchor="middle" font-family="Inter,sans-serif" font-size="9" letter-spacing="2.5" fill="${VIZ_INK_MUTED}">${svgEscape([opts.state, opts.postcode].filter(Boolean).join(" · ").toUpperCase())}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet">
    <rect width="${w}" height="${h}" fill="${VIZ_PAPER}" rx="6"/>${title}${rings}${compass}${nbDots}${pin}
  </svg>`;
}

/** Calendar heatmap — 12-month grid (or arbitrary cells). */
function renderCalendarHeatmapSvg(values: number[], title = "", monthLabels: string[] = []): string {
  if (!values.length) return "";
  const months = monthLabels.length === values.length ? monthLabels : ["J","F","M","A","M","J","J","A","S","O","N","D"].slice(0, values.length);
  const lo = Math.min(...values), hi = Math.max(...values), span = (hi - lo) || 1;
  const cellW = 44, cellH = 44, gap = 4;
  const cols = Math.min(12, values.length);
  const rows = Math.ceil(values.length / cols);
  const padL = 16, padT = title ? 40 : 18, padR = 16, padB = 22;
  const w = padL + padR + cols * (cellW + gap) - gap;
  const h = padT + padB + rows * (cellH + gap) - gap;
  const cells = values.map((v, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = padL + c * (cellW + gap), y = padT + r * (cellH + gap);
    const t = (v - lo) / span;
    const fill = `rgba(212,168,67,${(0.12 + t * 0.78).toFixed(2)})`;
    return `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="3" fill="${fill}" stroke="${VIZ_RULE}" stroke-width="0.4"/>
      <text x="${x + cellW / 2}" y="${y + 16}" text-anchor="middle" font-family="Inter,sans-serif" font-size="9" fill="${VIZ_INK_MUTED}" letter-spacing="0.5">${svgEscape(months[i] || "")}</text>
      <text x="${x + cellW / 2}" y="${y + cellH - 10}" text-anchor="middle" font-family="Playfair Display,Georgia,serif" font-weight="700" font-size="12" fill="${VIZ_INK}" style="font-variant-numeric:tabular-nums;">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`;
  }).join("");
  const t = title ? `<text x="${padL}" y="22" font-family="Playfair Display,Georgia,serif" font-weight="700" font-size="14" fill="${VIZ_INK}">${svgEscape(title)}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet">
    <rect width="${w}" height="${h}" fill="${VIZ_PAPER}" rx="6"/>${t}${cells}
  </svg>`;
}

function withAlphaHex(hex: string, alpha: number): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Collapse all whitespace between tags / inside the SVG so that `marked`
 *  cannot misinterpret indented lines as code blocks (which causes raw SVG
 *  markup to leak into the rendered output). */
function minifySvg(svg: string): string {
  return String(svg)
    .replace(/>\s+</g, "><")     // strip whitespace between tags
    .replace(/\s{2,}/g, " ")     // collapse runs of whitespace inside attrs
    .replace(/\n+/g, "")          // drop any remaining newlines
    .trim();
}

/** Wrap an SVG into a print-ready figure with optional caption. */
function vizFigure(svg: string, caption = ""): string {
  return `<figure class="vis-figure">${minifySvg(svg)}${caption ? `<figcaption>${esc(caption)}</figcaption>` : ""}</figure>`;
}

/**
 * Tufte-style horizontal comparator bars. Each bar = label + value + bar +
 * numeric tag.
 *
 * The label goes through `svgLabel` rather than `svgEscape`: these labels
 * arrive from a `{{bars:}}` / `{{wheel:}}` directive in prose that `marked`
 * has already escaped, so `Infrastructure & amenity` reaches here as
 * `Infrastructure &amp; amenity` and escaping it a second time prints the
 * entity. Latent on `{{bars:}}` — no production bar label had ever carried an
 * ampersand — and immediate the moment the scorecard moved onto this
 * primitive, which is how it was found.
 */
function renderBarsSvg(
  items: Array<{ label: string; value: number; display?: string; accent?: string }>,
  opts: { title?: string; max?: number; unit?: string } = {},
): string {
  if (!items.length) return "";
  const w = 760;
  const rowH = 28;
  const padT = opts.title ? 36 : 14;
  const padB = 14;
  const padL = 0;
  const padR = 0;
  const labelW = 180;
  const valueW = 76;
  const barX = labelW + 12;
  const barW = w - barX - valueW - 16;
  const h = padT + items.length * rowH + padB;
  const max = (opts.max ?? Math.max(...items.map((i) => Math.abs(i.value)))) || 1;
  const rows = items.map((it, i) => {
    const y = padT + i * rowH;
    const pct = Math.max(0, Math.min(1, Math.abs(it.value) / max));
    const bw = Math.max(2, pct * barW);
    const fill = it.accent || (pct >= 0.66 ? VIZ_GOOD : pct >= 0.4 ? VIZ_GOLD : pct >= 0.2 ? VIZ_WARN : VIZ_RISK);
    const display = it.display ?? (Number.isInteger(it.value) ? String(it.value) : it.value.toFixed(1)) + (opts.unit || "");
    return `
      <text x="${labelW}" y="${y + 17}" text-anchor="end" font-family="Inter,sans-serif" font-size="10" fill="${VIZ_INK}">${svgLabel(it.label)}</text>
      <rect x="${barX}" y="${y + 8}" width="${barW}" height="12" fill="${VIZ_PAPER_ALT}" rx="2"/>
      <rect x="${barX}" y="${y + 8}" width="${bw.toFixed(1)}" height="12" fill="${fill}" rx="2"/>
      <text x="${barX + barW + 10}" y="${y + 17}" font-family="Inter,sans-serif" font-weight="700" font-size="10" fill="${VIZ_INK}" style="font-variant-numeric:tabular-nums;">${svgEscape(display)}</text>
    `;
  }).join("");
  const title = opts.title
    ? `<text x="0" y="22" font-family="Playfair Display,Georgia,serif" font-weight="700" font-size="14" fill="${VIZ_INK}">${svgEscape(opts.title)}</text>
       <line x1="0" x2="${w}" y1="30" y2="30" stroke="${VIZ_RULE}" stroke-width="0.6"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet">${title}${rows}</svg>`;
}

/** 2×2 quadrant matrix — plot labelled dots on Risk×Return / Growth×Yield style axes. */
function renderQuadrantSvg(
  points: Array<{ x: number; y: number; label: string; highlight?: boolean }>,
  opts: { xLabel?: string; yLabel?: string; xMax?: number; yMax?: number; title?: string;
          q1?: string; q2?: string; q3?: string; q4?: string } = {},
): string {
  const w = 560, h = 420, padT = opts.title ? 50 : 24, padB = 56, padL = 60, padR = 20;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const xMax = opts.xMax ?? Math.max(...points.map((p) => p.x), 10);
  const yMax = opts.yMax ?? Math.max(...points.map((p) => p.y), 10);
  const xOf = (v: number) => padL + (v / xMax) * plotW;
  const yOf = (v: number) => padT + plotH - (v / yMax) * plotH;
  const midX = padL + plotW / 2, midY = padT + plotH / 2;
  const title = opts.title
    ? `<text x="${padL}" y="24" font-family="Playfair Display,Georgia,serif" font-weight="700" font-size="14" fill="${VIZ_INK}">${svgEscape(opts.title)}</text>`
    : "";
  const quadLabels = [
    { x: midX + plotW / 4, y: padT + 16, text: opts.q1 || "" },
    { x: midX - plotW / 4, y: padT + 16, text: opts.q2 || "" },
    { x: midX - plotW / 4, y: padT + plotH - 8, text: opts.q3 || "" },
    { x: midX + plotW / 4, y: padT + plotH - 8, text: opts.q4 || "" },
  ].filter((q) => q.text).map((q) =>
    `<text x="${q.x}" y="${q.y}" text-anchor="middle" font-family="Inter,sans-serif" font-size="8.5" font-weight="700" fill="${VIZ_INK_MUTED}" letter-spacing="1.6">${svgLabelUpper(q.text)}</text>`
  ).join("");
  const dots = points.map((p) => {
    const cx = xOf(p.x), cy = yOf(p.y);
    const fill = p.highlight ? VIZ_GOLD : VIZ_NAVY;
    const r = p.highlight ? 7.5 : 5;
    return `<g>
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="${fill}" stroke="${VIZ_PAPER}" stroke-width="2"/>
      <text x="${cx + 10}" y="${cy + 4}" font-family="Inter,sans-serif" font-size="9.5" font-weight="${p.highlight ? 700 : 500}" fill="${VIZ_INK}">${svgEscape(p.label)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet">
    ${title}
    <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="${VIZ_PAPER}" stroke="${VIZ_RULE}" stroke-width="0.5"/>
    <line x1="${midX}" x2="${midX}" y1="${padT}" y2="${padT + plotH}" stroke="${VIZ_RULE}" stroke-dasharray="3 3" stroke-width="0.6"/>
    <line x1="${padL}" x2="${padL + plotW}" y1="${midY}" y2="${midY}" stroke="${VIZ_RULE}" stroke-dasharray="3 3" stroke-width="0.6"/>
    ${quadLabels}
    ${dots}
    <text x="${padL + plotW / 2}" y="${h - 18}" text-anchor="middle" font-family="Inter,sans-serif" font-size="10" fill="${VIZ_INK_MUTED}" letter-spacing="1.6">${svgLabelUpper(opts.xLabel || "")} →</text>
    <text x="20" y="${padT + plotH / 2}" text-anchor="middle" font-family="Inter,sans-serif" font-size="10" fill="${VIZ_INK_MUTED}" letter-spacing="1.6" transform="rotate(-90 20 ${padT + plotH / 2})">${svgLabelUpper(opts.yLabel || "")} →</text>
  </svg>`;
}

/** Icon-array pictograph — N glyphs in a grid, first K filled gold. */
function renderPictographSvg(
  filled: number,
  total: number,
  opts: { icon?: "person" | "house" | "dollar"; label?: string; sub?: string; cols?: number } = {},
): string {
  const t = Math.max(1, Math.min(100, Math.floor(total)));
  const f = Math.max(0, Math.min(t, Math.floor(filled)));
  const cols = Math.min(opts.cols ?? Math.min(t, 10), 20);
  const rows = Math.ceil(t / cols);
  const cell = 38;
  const padT = opts.label ? 40 : 14;
  const padB = opts.sub ? 26 : 12;
  const w = cols * cell + 24;
  const h = padT + rows * cell + padB;
  // Glyph paths (kept inside a 28×28 box at 5,5)
  const glyphs: Record<string, string> = {
    person: `<path d="M14 6 a4 4 0 1 1 0 8 a4 4 0 1 1 0 -8 z M6 26 q0 -8 8 -8 q8 0 8 8 z"/>`,
    house:  `<path d="M14 4 L25 13 L25 26 L17 26 L17 19 L11 19 L11 26 L3 26 L3 13 z"/>`,
    dollar: `<path d="M14 4 L14 26 M19 9 q-1 -3 -5 -3 q-5 0 -5 4 q0 4 5 4 q5 0 5 4 q0 4 -5 4 q-4 0 -5 -3"
                    stroke-width="2.5" stroke-linecap="round" fill="none" stroke="currentColor"/>`,
  };
  const glyph = glyphs[opts.icon ?? "house"];
  const isStroke = (opts.icon ?? "house") === "dollar";
  const tiles = Array.from({ length: t }, (_, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = 12 + c * cell, y = padT + r * cell;
    const color = i < f ? VIZ_GOLD : VIZ_RULE;
    return `<g transform="translate(${x} ${y})" ${isStroke ? `stroke="${color}"` : `fill="${color}"`} color="${color}">${glyph}</g>`;
  }).join("");
  const label = opts.label
    ? `<text x="12" y="22" font-family="Playfair Display,Georgia,serif" font-weight="700" font-size="14" fill="${VIZ_INK}">${svgEscape(opts.label)}</text>
       <text x="${w - 12}" y="22" text-anchor="end" font-family="Inter,sans-serif" font-weight="700" font-size="13" fill="${VIZ_GOLD_SOFT}" style="font-variant-numeric:tabular-nums;">${f} / ${t}</text>` : "";
  const sub = opts.sub
    ? `<text x="12" y="${h - 8}" font-family="Inter,sans-serif" font-size="9" fill="${VIZ_INK_MUTED}" letter-spacing="0.6">${svgEscape(opts.sub)}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet">${label}${tiles}${sub}</svg>`;
}

/** Inline sparkline — meant to flow next to text. */
function renderInlineSparkSvg(vals: number[]): string {
  if (vals.length < 2) return "";
  const w = 64, h = 16;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = (hi - lo) || 1;
  const pts = vals.map((v, i) =>
    `${((i / (vals.length - 1)) * (w - 2) + 1).toFixed(1)},${(h - 2 - ((v - lo) / span) * (h - 4)).toFixed(1)}`
  ).join(" ");
  const last = vals[vals.length - 1];
  const lastX = w - 2, lastY = h - 2 - ((last - lo) / span) * (h - 4);
  const trend = vals[vals.length - 1] >= vals[0] ? VIZ_GOOD : VIZ_RISK;
  return `<svg class="spark-inline" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="vertical-align:-2px;margin:0 2px;"><polyline points="${pts}" fill="none" stroke="${trend}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="1.6" fill="${trend}"/></svg>`;
}

/** Donut / ring chart — for tenure mix, demographic splits, allocation. */
function renderDonutSvg(
  segments: Array<{ label: string; value: number; color?: string }>,
  opts: { title?: string; centerLabel?: string; centerSub?: string } = {},
): string {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  const palette = [VIZ_GOLD, "#7A5A2E", "#B58A3C", VIZ_INK_MUTED, "#9E8862", "#C9B07A"];
  const w = 460, h = 240, cx = 120, cy = 120, R = 92, r = 56;
  const TAU = Math.PI * 2;
  let a0 = -Math.PI / 2;
  const arcs = segments.map((s, i) => {
    const frac = Math.max(0, s.value) / total;
    if (frac <= 0) return "";
    const a1 = a0 + frac * TAU;
    const large = frac > 0.5 ? 1 : 0;
    const xo0 = cx + R * Math.cos(a0), yo0 = cy + R * Math.sin(a0);
    const xo1 = cx + R * Math.cos(a1), yo1 = cy + R * Math.sin(a1);
    const xi1 = cx + r * Math.cos(a1), yi1 = cy + r * Math.sin(a1);
    const xi0 = cx + r * Math.cos(a0), yi0 = cy + r * Math.sin(a0);
    const fill = s.color || palette[i % palette.length];
    const d = `M ${xo0.toFixed(1)} ${yo0.toFixed(1)} A ${R} ${R} 0 ${large} 1 ${xo1.toFixed(1)} ${yo1.toFixed(1)} L ${xi1.toFixed(1)} ${yi1.toFixed(1)} A ${r} ${r} 0 ${large} 0 ${xi0.toFixed(1)} ${yi0.toFixed(1)} Z`;
    a0 = a1;
    return `<path d="${d}" fill="${fill}" stroke="${VIZ_PAPER}" stroke-width="1.2"/>`;
  }).join("");
  const centerVal = opts.centerLabel ?? `${Math.round((segments[0]?.value || 0) / total * 100)}%`;
  const centerSub = svgLabelUpper(opts.centerSub ?? segments[0]?.label ?? "");
  const legend = segments.map((s, i) => {
    const pct = Math.round((Math.max(0, s.value) / total) * 100);
    const y = 48 + i * 22;
    const fill = s.color || palette[i % palette.length];
    return `<rect x="250" y="${y - 9}" width="10" height="10" rx="2" fill="${fill}"/>
      <text x="266" y="${y}" font-family="Inter,sans-serif" font-size="10" fill="${VIZ_INK}">${svgEscape(s.label)}</text>
      <text x="${w - 12}" y="${y}" text-anchor="end" font-family="Inter,sans-serif" font-weight="700" font-size="10" fill="${VIZ_INK}" style="font-variant-numeric:tabular-nums;">${pct}%</text>`;
  }).join("");
  const title = opts.title
    ? `<text x="250" y="28" font-family="Playfair Display,Georgia,serif" font-weight="700" font-size="14" fill="${VIZ_INK}">${svgEscape(opts.title)}</text>
       <line x1="250" x2="${w - 12}" y1="34" y2="34" stroke="${VIZ_RULE}" stroke-width="0.5"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet">
    ${title}${arcs}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-family="Playfair Display,Georgia,serif" font-weight="800" font-size="28" fill="${VIZ_INK}" style="font-variant-numeric:lining-nums tabular-nums;">${svgEscape(centerVal)}</text>
    <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-family="Inter,sans-serif" font-size="9" letter-spacing="1.6" fill="${VIZ_INK_MUTED}">${centerSub}</text>
    ${legend}
  </svg>`;
}

/** Suburb-tiles grid — small multiples that read like a faux-choropleth. */
function renderTilesSvg(
  tiles: Array<{ label: string; value: string; sub?: string; intensity?: number }>,
  opts: { title?: string; cols?: number } = {},
): string {
  if (!tiles.length) return "";
  const cols = Math.min(opts.cols ?? Math.min(tiles.length, 4), 6);
  const rows = Math.ceil(tiles.length / cols);
  const cellW = 130, cellH = 88, gap = 8;
  const padL = 12, padT = opts.title ? 38 : 12, padB = 12;
  const w = padL * 2 + cols * cellW + (cols - 1) * gap;
  const h = padT + rows * cellH + (rows - 1) * gap + padB;
  const intensities = tiles.map((t) => Math.max(0, Math.min(1, t.intensity ?? 0.5)));
  const cells = tiles.map((t, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = padL + c * (cellW + gap), y = padT + r * (cellH + gap);
    const alpha = 0.08 + intensities[i] * 0.42;
    const fill = `rgba(212,168,67,${alpha.toFixed(2)})`;
    return `<g>
      <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="4" fill="${fill}" stroke="${VIZ_RULE}" stroke-width="0.6"/>
      <text x="${x + 12}" y="${y + 20}" font-family="Inter,sans-serif" font-size="8.5" letter-spacing="1.2" fill="${VIZ_INK_MUTED}">${svgLabelUpper(t.label || "")}</text>
      <text x="${x + 12}" y="${y + 50}" font-family="Playfair Display,Georgia,serif" font-weight="800" font-size="22" fill="${VIZ_INK}" style="font-variant-numeric:lining-nums tabular-nums;">${svgEscape(t.value)}</text>
      ${t.sub ? `<text x="${x + 12}" y="${y + cellH - 12}" font-family="Inter,sans-serif" font-size="8.5" fill="${VIZ_INK_MUTED}">${svgEscape(t.sub)}</text>` : ""}
    </g>`;
  }).join("");
  const title = opts.title
    ? `<text x="${padL}" y="24" font-family="Playfair Display,Georgia,serif" font-weight="700" font-size="14" fill="${VIZ_INK}">${svgEscape(opts.title)}</text>
       <line x1="${padL}" x2="${w - padL}" y1="30" y2="30" stroke="${VIZ_RULE}" stroke-width="0.5"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet">${title}${cells}</svg>`;
}

/** Tiny margin-chart sparkline used inside .sidenote-margin asides. */
function renderMarginSparkSvg(vals: number[]): string {
  if (vals.length < 2) return "";
  const w = 180, h = 38;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = (hi - lo) || 1;
  const pts = vals.map((v, i) =>
    `${((i / (vals.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 4 - ((v - lo) / span) * (h - 8)).toFixed(1)}`
  ).join(" ");
  const area = `${pts} ${(w - 2).toFixed(1)},${h - 2} 2,${h - 2}`;
  const trend = vals[vals.length - 1] >= vals[0] ? VIZ_GOOD : VIZ_RISK;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="none">
    <polygon points="${area}" fill="${trend}" fill-opacity="0.12"/>
    <polyline points="${pts}" fill="none" stroke="${trend}" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>`;
}

/** Infrastructure ribbon — compact phase timeline for Existing → 0-2y → 3-5y → 5y+. */
function renderTimelineRibbonSvg(items: Array<{ phase: string; label: string; confidence?: string }>, title = "Infrastructure pipeline"): string {
  const phases = ["Existing", "0-2y", "3-5y", "5y+"];
  const w = 760, h = 176, padX = 44, axisY = 86;
  const step = (w - padX * 2) / (phases.length - 1);
  const phaseNorm = (p: string) => {
    const s = p.toLowerCase();
    if (/existing|now|current/.test(s)) return "Existing";
    if (/0\s*-?\s*2|short/.test(s)) return "0-2y";
    if (/3\s*-?\s*5|medium/.test(s)) return "3-5y";
    return "5y+";
  };
  const grouped = new Map(phases.map((p) => [p, [] as typeof items]));
  items.forEach((it) => grouped.get(phaseNorm(it.phase))?.push(it));
  const markers = phases.map((phase, i) => {
    const x = padX + i * step;
    const list = (grouped.get(phase) || []).slice(0, 2);
    const labels = list.map((it, j) => `<text x="${x}" y="${axisY + 36 + j * 15}" text-anchor="middle" font-family="Inter,sans-serif" font-size="9" fill="${VIZ_INK}" font-weight="${j === 0 ? 700 : 500}">${svgEscape(it.label.length > 28 ? it.label.slice(0, 26) + "…" : it.label)}</text>`).join("");
    return `<g>
      <circle cx="${x}" cy="${axisY}" r="8" fill="${i === 0 ? VIZ_NAVY : VIZ_GOLD}" stroke="${VIZ_PAPER}" stroke-width="2"/>
      <text x="${x}" y="${axisY - 24}" text-anchor="middle" font-family="Inter,sans-serif" font-size="9" letter-spacing="1.4" fill="${VIZ_INK_MUTED}" font-weight="700">${svgLabelUpper(phase)}</text>
      ${labels}
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet">
    <rect width="${w}" height="${h}" rx="6" fill="${VIZ_PAPER}"/>
    <text x="24" y="26" font-family="Playfair Display,Georgia,serif" font-weight="700" font-size="15" fill="${VIZ_INK}">${svgEscape(title)}</text>
    <path d="M ${padX} ${axisY} C ${padX + step * 0.5} ${axisY - 18}, ${padX + step * 0.5} ${axisY + 18}, ${padX + step} ${axisY} S ${padX + step * 1.5} ${axisY + 18}, ${padX + step * 2} ${axisY} S ${padX + step * 2.5} ${axisY - 18}, ${padX + step * 3} ${axisY}" fill="none" stroke="${VIZ_RULE}" stroke-width="8" stroke-linecap="round"/>
    <path d="M ${padX} ${axisY} C ${padX + step * 0.5} ${axisY - 18}, ${padX + step * 0.5} ${axisY + 18}, ${padX + step} ${axisY} S ${padX + step * 1.5} ${axisY + 18}, ${padX + step * 2} ${axisY} S ${padX + step * 2.5} ${axisY - 18}, ${padX + step * 3} ${axisY}" fill="none" stroke="${VIZ_GOLD}" stroke-width="3" stroke-linecap="round"/>
    ${markers}
  </svg>`;
}

function renderKpiStripHtml(items: Array<{ label: string; value: string; delta?: string; spark?: number[] }>): string {
  if (!items.length) return "";
  return `<div class="kpi-strip kpi-strip-inline">${items.slice(0, 4).map((it) => `
    <div class="kpi big-number-card">
      <div class="kpi-label">${esc(it.label)}</div>
      <div class="kpi-value">${esc(it.value)}</div>
      ${it.delta ? `<div class="kpi-delta">${esc(it.delta)}</div>` : ""}
      ${it.spark && it.spark.length >= 2 ? `<div class="kpi-inline-spark">${renderMarginSparkSvg(it.spark)}</div>` : ""}
    </div>`).join("")}</div>`;
}

function extractScoreBreakdownItems(score: any): Array<{ label: string; value: number; display: string; accent: string }> {
  const raw = score?.breakdown || score?.scores || score?.components || {};
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw).map(([key, val]: [string, any]) => {
    // A dimension the engine could not score carries a placeholder `score` of
    // 50 beside `excluded: true`, `hasData: false` and `weight: 0`. Plotting it
    // draws a mid-range bar that looks exactly like a measurement — on
    // `6 Acer Court` the chart showed demand 50 and growth 50 between a real
    // risk 60 and a real location 65. `dimensionWasScored` is the same
    // predicate the binding projection and the composed scorecard ask.
    if (val && typeof val === "object" && !dimensionWasScored(val)) return null;
    const n = typeof val === "number" ? val : Number(val?.score ?? val?.value ?? val?.rating);
    if (!Number.isFinite(n)) return null;
    const label = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/\bscore\b/ig, "").trim();
    // Sentence case. `dimensionLabel`'s lowercase is for PROSE — "weighted
    // across growth, location and yield" — and reads as a typo in a chart's
    // label column beside the Qualitative Scorecard's "Location strength".
    const shown = label ? label.charAt(0).toUpperCase() + label.slice(1) : key;
    // One accent, like the scorecard. `renderBarsSvg`'s default ramp colours by
    // magnitude and turns green (`VIZ_GOOD`) above 0.66 — a colour this
    // gold-and-cream document uses nowhere else, and one that would paint four
    // of the scorecard's five dimensions on the page opposite. The bars' own
    // lengths carry the comparison, which is the entire argument for bars.
    return { label: shown, value: n, display: `${Math.round(n)}`, accent: VIZ_GOLD };
  }).filter(Boolean) as Array<{ label: string; value: number; display: string; accent: string }>;
}

function recursiveNumberByKey(obj: unknown, patterns: RegExp[], seen = new Set<unknown>()): number | null {
  if (!obj || typeof obj !== "object" || seen.has(obj)) return null;
  seen.add(obj);
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (patterns.some((p) => p.test(key))) {
      const n = typeof val === "number" ? val : typeof val === "string" ? parseLooseNumber(val) : null;
      if (n != null && Number.isFinite(n)) return n;
    }
    const nested = recursiveNumberByKey(val, patterns, seen);
    if (nested != null) return nested;
  }
  return null;
}

function normaliseShare(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value > 0 && value <= 1 ? value * 100 : value;
}

function chapterGlanceLabels(title: string): { sym: string; label: string }[] {
  const lower = title.toLowerCase();
  if (lower.includes("risk") || lower.includes("safety"))
    return [{ sym: "✓", label: "Risk register" }, { sym: "⚠", label: "Verify" }, { sym: "▲", label: "Mitigants" }, { sym: "★", label: "Decision lens" }];
  if (lower.includes("transport") || lower.includes("infrastructure"))
    return [{ sym: "✓", label: "Access driver" }, { sym: "⚠", label: "Delivery risk" }, { sym: "▲", label: "Pipeline" }, { sym: "★", label: "Location fit" }];
  if (lower.includes("demographic") || lower.includes("demand"))
    return [{ sym: "✓", label: "Demand base" }, { sym: "⚠", label: "Cohort watch" }, { sym: "▲", label: "Trend" }, { sym: "★", label: "Tenant fit" }];
  if (lower.includes("score") || lower.includes("swot"))
    return [{ sym: "✓", label: "Strength" }, { sym: "⚠", label: "Watch point" }, { sym: "▲", label: "Score driver" }, { sym: "★", label: "Verdict" }];
  return [{ sym: "✓", label: "Key signal" }, { sym: "⚠", label: "Watch" }, { sym: "▲", label: "Trend" }, { sym: "★", label: "NPC view" }];
}

function firstSentenceMatching(text: string, re: RegExp, _maxLen = 0): string | null {
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    const clean = s.trim();
    if (clean.length < 12) continue;
    if (re.test(clean)) {
      return clean.replace(/[.!?]+$/, "");
    }
  }
  return null;
}

function deriveGlanceValues(title: string, chapterText: string): (string | null)[] {
  const lower = title.toLowerCase();
  const text = chapterText.replace(/\s+/g, " ").trim();
  if (!text) return [null, null, null, null];

  // Signal — first positive/headline sentence (full sentence; cell wraps it)
  const signal = firstSentenceMatching(text, /\b(outperform|strong|leading|above|rose|grew|growth|robust|resilient|expand|accelerat|surpass|exceed|record|premium)\b/i);
  // Watch — first risk/caveat sentence
  const watch = firstSentenceMatching(text, /\b(risk|concern|vacancy|declin|soft|weak|caution|watch|below|under-?perform|exposure|oversupply|headwind|fragile|stretched)\b/i);

  // Trend — strongest pct/movement number
  let trend: string | null = null;
  const pctMatches = Array.from(text.matchAll(/([+-]?\d{1,3}(?:\.\d+)?\s?%)\s*(YoY|p\.?a\.?|annual|year|growth|yield|change)?/gi));
  if (pctMatches.length) {
    const best = pctMatches.map((m) => ({ raw: m[0], abs: Math.abs(parseFloat(m[1])) })).sort((a, b) => b.abs - a.abs)[0];
    trend = best.raw.replace(/\s+/g, " ").trim();
  } else {
    const dollar = text.match(/\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|million|thousand))?/i);
    if (dollar) trend = dollar[0];
  }

  // NPC view — verdict/recommendation if present
  let view = firstSentenceMatching(text, /\b(verdict|npc view|recommend|our view|conclusion|bottom line|net-net|on balance|suits?|fits?|aligns?|accumulate|hold|pass)\b/i);
  if (!view) {
    // fallback to last meaningful sentence in chapter
    const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 30);
    if (sentences.length >= 2) view = sentences[sentences.length - 1].replace(/[.!?]+$/, "");
  }
  void lower;
  return [signal, watch, trend, view];
}

function chapterGlanceHtmlFromValues(title: string, values: (string | null)[]): string {
  const labels = chapterGlanceLabels(title);
  const cells = labels.map((l, i) => ({ ...l, value: values[i] })).filter((c) => c.value && c.value.trim().length > 0);
  if (cells.length < 2) return "";
  return `<div class="glance-strip">${cells.map((c) => (
    `<div class="glance-cell">` +
      `<span class="glance-sym">${esc(c.sym)}</span>` +
      `<span class="glance-label">${esc(c.label)}</span>` +
      `<span class="glance-value">${esc(c.value!)}</span>` +
    `</div>`
  )).join("")}</div>`;
}

function injectChapterGlanceFallbacks(html: string): string {
  // Split on H2 boundaries so we can read each chapter's body
  const parts = html.split(/(<h2\b[^>]*>[\s\S]*?<\/h2>)/i);
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i];
    const body = parts[i + 1] ?? "";
    if (/glance-strip/.test(body.slice(0, 400))) continue; // already has one
    const titleMatch = heading.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
    const title = (titleMatch?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
    if (!title || /sources|references|disclaimer|table of contents/i.test(title)) continue;
    const plain = body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
    const values = deriveGlanceValues(title, plain);
    const strip = chapterGlanceHtmlFromValues(title, values);
    if (!strip) continue; // suppress empty
    parts[i + 1] = `\n${strip}\n${body}`;
  }
  return parts.join("");
}

function addDataSparklinesToParagraphs(html: string): string {
  return html.replace(/<p>([\s\S]*?)<\/p>/gi, (match, inner) => {
    if (/spark-inline|<svg|<img|<table/i.test(inner)) return match;
    if (!/\b(growth|grew|trend|median|yield|rent|vacancy|population|income|price|rose|climbed|increased|declined)\b/i.test(inner)) return match;
    const vals = Array.from(String(inner).matchAll(/(?:\$\s*)?-?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*%?/g))
      .map((m) => parseLooseNumber(m[0]))
      .filter((n): n is number => n != null && !(n >= 1900 && n <= 2100));
    if (vals.length < 3) return match;
    return `<p>${inner} ${renderInlineSparkSvg(vals.slice(-10))}</p>`;
  });
}

/**
 * Pre-marked markdown processor: turns editorial shortcodes into block-level
 * HTML so they survive `marked.parse()` untouched.
 *
 * Supported syntax:
 *   ::: pullquote
 *   The quoted line.
 *   :::
 *
 *   ::: sidenote
 *   Aside text.
 *   :::
 *
 *   ::: cols                          (two-column flow)
 *   long paragraph body…
 *   :::
 *
 *   {{gauge: 72 | Investment Score | Weighted composite}}
 *   {{waterfall: Rent +24000, Interest -18000, Tax -3200, Total =2800}}
 *   {{heatmap: 1,2,3 / 4,5,6 / 7,8,9 | rows=A,B,C | cols=X,Y,Z | title=Growth}}
 *   {{wheel: 78,64,82,71,55 | labels=Yield,Growth,Risk,Demand,Infra}}
 *
 *   [[see:#anchor]]                   (cross-reference; resolved to page #)
 *   [^1]                              (footnote call; def below)
 *   [^1]: Footnote definition text.
 */

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-INJECT VISUAL SHORTCODES
// The LLM rarely emits the editorial shortcodes; we synthesise them from the
// patterns it DOES emit (markdown tables, decile mentions, sub-score lists,
// suburb comparisons, trend numbers). Runs once on raw markdown.
// ─────────────────────────────────────────────────────────────────────────────
function autoInjectVisualShortcodes(md: string): string {
  if (!md || md.length < 200) return md;
  let out = md;

  const stripMd = (s: string) => String(s).replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  const toNumber = (s: string): number | null => {
    const cleaned = String(s).replace(/[\$,\s]/g, "").replace(/%$/, "");
    const m = cleaned.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const n = parseFloat(m[0]);
    return Number.isFinite(n) ? n : null;
  };

  // ── 1. Markdown tables → {{heatmap}} when ≥2 numeric columns and ≥2 data rows.
  //    Preserve the original table; insert shortcode immediately AFTER it.
  out = out.replace(
    /(^\|[^\n]+\|\s*\n\|[\s\-:|]+\|\s*\n(?:\|[^\n]+\|\s*\n?)+)/gm,
    (block) => {
      try {
        const lines = block.trim().split("\n").filter((l) => l.trim().startsWith("|"));
        if (lines.length < 4) return block;
        const parse = (l: string) => l.replace(/^\||\|$/g, "").split("|").map((c) => stripMd(c));
        const header = parse(lines[0]);
        const rows = lines.slice(2).map(parse).filter((r) => r.length === header.length);
        if (header.length < 3 || rows.length < 2) return block;

        // Find numeric columns (skip first column = label).
        const numericCols: number[] = [];
        for (let c = 1; c < header.length; c++) {
          const vals = rows.map((r) => toNumber(r[c] ?? ""));
          if (vals.filter((v) => v != null).length >= Math.max(2, Math.floor(rows.length * 0.7))) {
            numericCols.push(c);
          }
        }
        if (numericCols.length < 2) return block;

        const rowLabels = rows.map((r) => stripMd(r[0]).slice(0, 24)).join(",");
        const colLabels = numericCols.map((c) => stripMd(header[c]).slice(0, 18)).join(",");
        const matrix = rows.map((r) =>
          numericCols.map((c) => toNumber(r[c] ?? "") ?? 0).join(",")
        ).join(" / ");
        const title = "Comparative matrix";
        return `${block}\n\n{{heatmap: ${matrix} | rows=${rowLabels} | cols=${colLabels} | title=${title}}}\n`;
      } catch { return block; }
    },
  );

  // ── 2. SEIFA decile mentions → {{bullet: N | max=10 | …}}
  //    Pattern: "SEIFA IRSAD decile 7/10" or "IRSAD score: 8 out of 10"
  out = out.replace(
    /(\b(?:SEIFA(?:\s+(?:IRSAD|IRSD|IEO|IER))?|IRSAD|IRSD|IEO|IER)\b[^\n.]{0,80}?\b(\d{1,2})\s*(?:\/|out of)\s*10\b)/gi,
    (full, _phrase, n) => {
      const v = parseInt(n, 10);
      if (!(v >= 1 && v <= 10)) return full;
      // A decile is a RANK, not a share. The gauge sweeps `value / max` of a
      // ring, which is the grammar of a proportion, so decile 7 drew 70% of an
      // arc for a number that is 70% of nothing — and printed a verdict word
      // beside it from thresholds meant for a score out of a hundred.
      // `bullet` marks a position on a banded track, which is what a rank is.
      return `${full}\n\n{{bullet: ${v} | max=10 | label=Socio-economic decile | sub=Higher = more advantaged | ranges=3,7,10}}\n`;
    },
  );

  // ── 3. Sub-score bullet lists → {{bars: …}}
  //    Pattern: 3+ consecutive bullets each of form "- Label: 72" or "- Label — 8/10"
  out = out.replace(
    /((?:^[ \t]*[-*][ \t]+[^\n]+:[ \t]*(?:\$?\d[\d.,]*%?|\d+\s*\/\s*\d+)[^\n]*\n){3,})/gm,
    (block) => {
      try {
        const items = block.trim().split("\n").map((ln) => {
          const m = ln.match(/^[ \t]*[-*][ \t]+(.+?):[ \t]*(\$?\d[\d.,]*%?|\d+\s*\/\s*\d+)/);
          if (!m) return null;
          const label = stripMd(m[1]).slice(0, 22).replace(/,/g, "");
          const rawVal = m[2].trim();
          const numerator = rawVal.includes("/") ? rawVal.split("/")[0] : rawVal;
          const n = toNumber(numerator);
          if (n == null) return null;
          const isPct = rawVal.includes("%") || (rawVal.includes("/") && rawVal.includes("/10"));
          return { label, n, isPct };
        }).filter(Boolean) as { label: string; n: number; isPct: boolean }[];
        if (items.length < 3) return block;
        const allPct = items.every((it) => it.isPct);
        const max = allPct ? (items[0].isPct && block.includes("/10") ? 10 : 100) : Math.max(...items.map((i) => i.n)) * 1.1;
        const unit = allPct && max === 100 ? "%" : "";
        const series = items.map((it) => `${it.label} ${it.n}${it.isPct && unit === "%" ? "%" : ""}`).join(", ");
        return `${block}\n{{bars: ${series} | title=Sub-score breakdown | max=${Math.round(max)}${unit ? ` | unit=${unit}` : ""}}}\n\n`;
      } catch { return block; }
    },
  );

  // ── 4. Suburb-comparison tables → also add {{tiles}} if first col looks like
  //    suburb names and there's a price column.
  out = out.replace(
    /(^\|[^\n]+\|\s*\n\|[\s\-:|]+\|\s*\n(?:\|[^\n]+\|\s*\n?)+)/gm,
    (block) => {
      try {
        if (block.includes("{{tiles:")) return block;
        const lines = block.trim().split("\n");
        const parse = (l: string) => l.replace(/^\||\|$/g, "").split("|").map((c) => stripMd(c));
        const header = parse(lines[0]).map((h) => h.toLowerCase());
        if (!/suburb|locality|area/i.test(header[0])) return block;
        const priceCol = header.findIndex((h) => /price|median|value/.test(h));
        const trendCol = header.findIndex((h) => /growth|yoy|change|yield/.test(h));
        if (priceCol < 0) return block;
        const rows = lines.slice(2).map(parse).filter((r) => r.length === header.length);
        if (rows.length < 2 || rows.length > 8) return block;
        const tiles = rows.map((r) => {
          const name = stripMd(r[0]).replace(/,/g, "").slice(0, 22);
          const price = stripMd(r[priceCol]).replace(/,/g, "").slice(0, 14);
          const sub = trendCol >= 0 ? stripMd(r[trendCol]).slice(0, 18) : "";
          const subAttr = sub ? ` sub="${sub.replace(/"/g, "")}"` : "";
          return `${name} ${price}${subAttr} int=0.6`;
        }).join(", ");
        return `${block}\n\n{{tiles: ${tiles} | title=Adjacent suburbs | cols=${Math.min(4, rows.length)}}}\n`;
      } catch { return block; }
    },
  );

  // ── 5. Inline sparklines: paragraphs that recite ≥4 numbers of the same kind.
  //    Format expected by renderer: ~~[n1,n2,n3,…]~~  (handled in applyEditorialMarkdown).
  out = out.replace(/(^(?!\||#|\s*[-*])[^\n]{120,})$/gm, (line) => {
    if (line.includes("~~[")) return line;
    const nums = Array.from(line.matchAll(/(?:\$\s*)?-?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*%?/g))
      .map((m) => toNumber(m[0]))
      .filter((n): n is number => n != null && !(n >= 1900 && n <= 2100));
    if (nums.length < 4) return line;
    const trimmed = nums.slice(-8);
    return `${line} ~~[${trimmed.join(",")}]~~`;
  });

  return out;
}

function applyEditorialMarkdown(md: string): string {
  let out = md;
  let complexVisualUnits = 0;


  // Fenced editorial blocks with optional `key=value` attributes on the opening fence.
  // Examples:
  //   ::: divider stat="78" label="Investment score" eyebrow="Chapter 04"
  //   The chapter title or sub-heading goes here.
  //   :::
  //
  //   ::: quote-page attribution="— RBA, May 2026"
  //   The fully-spread editorial quote sits here.
  //   :::
  out = out.replace(
    /^::: *(pullquote|sidenote|cols|divider|quote-page|stat|dashboard|signature) *([^\n]*)\n([\s\S]*?)\n::: *$/gm,
    (_m, name, attrRaw, body) => {
      const inner = String(body).trim();
      const attrs: Record<string, string> = {};
      String(attrRaw || "").replace(/(\w[\w-]*)\s*=\s*"([^"]*)"/g, (_x, k, v) => {
        attrs[String(k).toLowerCase()] = String(v);
        return "";
      });
      if (name === "pullquote") return `\n<aside class="pull-quote"><p>${esc(inner.replace(/\n+/g, " "))}</p></aside>\n`;
      if (name === "sidenote") return `\n<aside class="sidenote"><p>${esc(inner.replace(/\n+/g, " "))}</p></aside>\n`;
      if (name === "cols") return `\n<div class="two-col">\n\n${inner}\n\n</div>\n`;
      if (name === "stat") {
        // Inline oversized statistic block: ::: stat label="Median yield" unit="%"  → body = "4.8"
        //
        // A card with no value is not drawn. `stat-value` is unconditional, so
        // an empty body used to print the UNIT in display type — an oversized
        // "m" or "/100" with a caption underneath explaining what it measures.
        // Measured 2026-09-07: 23 of 71 cards across 15 of 24 reports.
        //
        // Enforced here as well as in the write-path hygiene because this
        // repairs the reports already stored, for every reader, with no
        // migration — the same asymmetry `healFinanceIdentity` settled on. One
        // predicate, shared, so the two ends cannot disagree about "empty".
        if (!statCardHasValue(inner)) return "";
        const label = esc(attrs.label || "");
        const unit = esc(attrs.unit || "");
        const sub = esc(attrs.sub || "");
        return `\n<div class="stat-block"><div class="stat-value">${esc(inner)}${unit ? `<span class="stat-unit">${unit}</span>` : ""}</div>${label ? `<div class="stat-label">${label}</div>` : ""}${sub ? `<div class="stat-sub">${sub}</div>` : ""}</div>\n`;
      }
      if (name === "divider") {
        // Full-bleed section divider with oversized stat + label + headline.
        const stat = esc(attrs.stat || "");
        const label = esc(attrs.label || "");
        const eyebrow = esc(attrs.eyebrow || "");
        const headline = esc(inner.replace(/\n+/g, " "));
        return `\n<section class="section-divider">
          ${eyebrow ? `<div class="sd-eyebrow">${eyebrow}</div>` : ""}
          ${stat ? `<div class="sd-stat">${stat}</div>` : ""}
          ${label ? `<div class="sd-label">${label}</div>` : ""}
          ${headline ? `<div class="sd-headline">${headline}</div>` : ""}
        </section>\n`;
      }
      if (name === "quote-page") {
        const attribution = esc(attrs.attribution || "");
        const eyebrow = esc(attrs.eyebrow || "Chapter quote");
        return `\n<section class="quote-page">
          <div class="qp-eyebrow">${eyebrow}</div>
          <blockquote class="qp-body">${esc(inner.replace(/\n+/g, " "))}</blockquote>
          ${attribution ? `<div class="qp-attrib">${attribution}</div>` : ""}
        </section>\n`;
      }
      if (name === "dashboard") {
        // ::: dashboard eyebrow="..." title="..." big="3.2%" bigLabel="Yield" spark="1,2,3,4" peers="Avg 2.8|This 3.2|Top 3.9" map="Suburb,VIC,3000"
        const eyebrow = esc(attrs.eyebrow || "Snapshot");
        const title = esc(attrs.title || inner.split("\n")[0] || "Dashboard");
        const big = esc(attrs.big || "");
        const bigLabel = esc(attrs.biglabel || attrs.big_label || "");
        const sparkVals = (attrs.spark || "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
        const sparkSvg = sparkVals.length >= 2 ? (() => {
          const w = 320, h = 70, lo = Math.min(...sparkVals), hi = Math.max(...sparkVals), span = (hi - lo) || 1;
          const pts = sparkVals.map((v, i) => `${(i / (sparkVals.length - 1)) * w},${h - 4 - ((v - lo) / span) * (h - 12)}`).join(" ");
          return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%"><polyline points="${pts}" fill="none" stroke="${VIZ_GOLD}" stroke-width="2.5"/></svg>`;
        })() : "";
        const peerRows = (attrs.peers || "").split("|").map((p) => p.trim()).filter(Boolean).map((p) => {
          const m = p.match(/^(.+?)\s+([\d.,%$\-]+)$/);
          const label = m ? m[1] : p, val = m ? m[2] : "";
          return `<div class="dash-peer-row"><span>${esc(label)}</span><span>${esc(val)}</span></div>`;
        }).join("");
        let mapSvg = "";
        if (attrs.map) {
          const [sub, st, pc, ...nb] = attrs.map.split(",").map((s) => s.trim());
          mapSvg = renderMicroMapSvg({ suburb: sub, state: st, postcode: pc, neighbours: nb });
        }
        const narrative = inner.split("\n").slice(1).join(" ").trim();
        return `\n<section class="dashboard-page">
          <div class="dp-eyebrow">${eyebrow}</div>
          <h2 class="dp-title">${title}</h2>
          <div class="dp-grid">
            <div class="dp-big-cell">
              <div class="dp-big-value">${big}</div>
              ${bigLabel ? `<div class="dp-big-label">${bigLabel}</div>` : ""}
              ${sparkSvg ? `<div class="dp-spark">${sparkSvg}</div>` : ""}
            </div>
            ${peerRows ? `<div class="dp-peers"><div class="dp-peers-title">Peer benchmark</div>${peerRows}</div>` : ""}
            ${mapSvg ? `<div class="dp-map">${mapSvg}</div>` : ""}
          </div>
          ${narrative ? `<p class="dp-narrative">${esc(narrative)}</p>` : ""}
        </section>\n`;
      }
      if (name === "signature") {
        const name1 = esc(attrs.name || "");
        const role = esc(attrs.role || "");
        const company = esc(attrs.company || "");
        const date = esc(attrs.date || new Date().toLocaleDateString("en-AU", { year: "numeric", month: "long", day: "numeric" }));
        const qrUrl = attrs.qr ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&format=svg&qzone=1&data=${encodeURIComponent(attrs.qr)}` : "";
        const body = esc(inner.replace(/\n+/g, " "));
        // SVG ribbon signature placeholder (looks like handwriting).
        const sigSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="220"><path d="M8 56 C 30 8, 60 78, 90 30 S 150 70, 180 26 S 250 70, 312 22" fill="none" stroke="${VIZ_INK}" stroke-width="2.2" stroke-linecap="round"/><path d="M40 64 L 280 64" stroke="${VIZ_RULE}" stroke-width="0.6"/></svg>`;
        return `\n<section class="signature-page">
          <div class="sg-eyebrow">${esc(attrs.eyebrow || "Personally prepared")}</div>
          <p class="sg-body">${body}</p>
          <div class="sg-row">
            <div class="sg-sig">
              <div class="sg-sig-mark">${sigSvg}</div>
              <div class="sg-sig-name">${name1}</div>
              ${role ? `<div class="sg-sig-role">${role}</div>` : ""}
              ${company ? `<div class="sg-sig-company">${company}</div>` : ""}
              <div class="sg-sig-date">${date}</div>
            </div>
            ${qrUrl ? `<div class="sg-qr"><img src="${qrUrl}" alt="Scan to verify"/><div class="sg-qr-cap">Scan to verify</div></div>` : ""}
          </div>
        </section>\n`;
      }
      return _m;
    },
  );

  // {{bullet: VALUE | target=80 | max=100 | label=… | sub=…}}
  out = out.replace(/\{\{bullet:\s*([^}]+)\}\}/gi, (_m, args) => {
    const parts = String(args).split("|").map((s) => s.trim());
    const value = Number(parts[0]); if (!Number.isFinite(value)) return _m;
    const opts: Record<string, string> = {};
    for (const p of parts.slice(1)) { const m = p.match(/^(target|max|label|sub|ranges)\s*=\s*(.+)$/i); if (m) opts[m[1].toLowerCase()] = m[2]; }
    const ranges = opts.ranges ? opts.ranges.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)) : undefined;
    return vizFigure(renderBulletSvg({ value, target: opts.target ? Number(opts.target) : undefined, max: opts.max ? Number(opts.max) : undefined, label: opts.label, sub: opts.sub, ranges }), opts.label || "");
  });

  // {{marimekko: rowLabel*weight: s1,s2,s3 | rowLabel*weight: s1,s2,s3 | legend=A,B,C}}
  out = out.replace(/\{\{marimekko:\s*([^}]+)\}\}/gi, (_m, args) => {
    const parts = String(args).split("|").map((s) => s.trim());
    let legend: string[] = [];
    const rows = parts.map((p) => {
      const leg = p.match(/^legend\s*=\s*(.+)$/i); if (leg) { legend = leg[1].split(",").map((s) => s.trim()); return null; }
      const m = p.match(/^(.+?)\*([\d.]+)\s*:\s*(.+)$/); if (!m) return null;
      return { label: m[1].trim(), weight: Number(m[2]) || 1, segments: m[3].split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)) };
    }).filter(Boolean) as Array<{ label: string; weight: number; segments: number[] }>;
    if (!rows.length) return _m;
    return vizFigure(renderMarimekkoSvg(rows, legend), "Composition × magnitude");
  });

  // {{micromap: Suburb | state=VIC | postcode=3000 | neighbours=A,B,C}}
  out = out.replace(/\{\{micromap:\s*([^}]+)\}\}/gi, (_m, args) => {
    const parts = String(args).split("|").map((s) => s.trim());
    const suburb = parts[0]; if (!suburb) return _m;
    const opts: Record<string, string> = {};
    for (const p of parts.slice(1)) { const m = p.match(/^(state|postcode|neighbours)\s*=\s*(.+)$/i); if (m) opts[m[1].toLowerCase()] = m[2]; }
    return vizFigure(renderMicroMapSvg({ suburb, state: opts.state, postcode: opts.postcode, neighbours: opts.neighbours ? opts.neighbours.split(",").map((s) => s.trim()) : [] }), `${suburb} locator`);
  });

  // {{calendar: 1,2,3,4,5,6,7,8,9,10,11,12 | title=Sales by month | months=Jan,Feb,…}}
  out = out.replace(/\{\{calendar:\s*([^}]+)\}\}/gi, (_m, args) => {
    const parts = String(args).split("|").map((s) => s.trim());
    const vals = parts[0].split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
    if (!vals.length) return _m;
    const opts: Record<string, string> = {};
    for (const p of parts.slice(1)) { const m = p.match(/^(title|months)\s*=\s*(.+)$/i); if (m) opts[m[1].toLowerCase()] = m[2]; }
    const months = opts.months ? opts.months.split(",").map((s) => s.trim()) : [];
    return vizFigure(renderCalendarHeatmapSvg(vals, opts.title || "", months), opts.title || "");
  });

  // {{gauge: VALUE [/ MAX] | LABEL | CAPTION}}
  out = out.replace(/\{\{gauge:\s*([^}]+)\}\}/gi, (_m, args) => {
    const parts = String(args).split("|").map((s) => s.trim());
    const [val, label = "", caption = ""] = parts;
    const [v, max = "100"] = val.split("/").map((s) => s.trim());
    return vizFigure(renderGaugeSvg(Number(v) || 0, Number(max) || 100, label, caption), caption ? "" : label);
  });

  // {{waterfall: Label1 +123, Label2 -45, Total =78}}
  out = out.replace(/\{\{waterfall:\s*([^}]+)\}\}/gi, (_m, args) => {
    const rawArgs = String(args);
    if (rawArgs.length > MAX_VISUAL_SHORTCODE_CHARS) return _m;
    const segments = rawArgs.split(/[,;]/);
    if (segments.length > MAX_WATERFALL_ITEMS) return _m;
    const items = segments.map((seg) => {
      const m = seg.trim().match(/^(.+?)\s*([=+\-])\s*([\d.,$\s-]+)$/);
      if (!m) return null;
      const label = m[1].trim();
      const total = m[2] === "=";
      const value = parseLooseNumber(m[3]) ?? 0;
      return { label, value, total };
    }).filter(Boolean) as Array<{ label: string; value: number; total?: boolean }>;
    if (!items.length) return _m;
    if (complexVisualUnits + items.length > MAX_COMPLEX_VISUAL_UNITS) return _m;
    complexVisualUnits += items.length;
    return vizFigure(renderWaterfallSvg(items), "Cash-flow waterfall");
  });

  // {{heatmap: r1c1,r1c2 / r2c1,r2c2 | rows=A,B | cols=X,Y | title=…}}
  out = out.replace(/\{\{heatmap:\s*([^}]+)\}\}/gi, (_m, args) => {
    const rawArgs = String(args);
    if (rawArgs.length > MAX_VISUAL_SHORTCODE_CHARS) return _m;
    const parts = rawArgs.split("|").map((s) => s.trim());
    const rawRows = parts[0].split("/");
    if (rawRows.length > MAX_HEATMAP_ROWS) return _m;
    const rawGrid = rawRows.map((row) => row.split(","));
    const cols = rawGrid[0]?.length ?? 0;
    if (
      !cols ||
      cols > MAX_HEATMAP_COLS ||
      rawGrid.length * cols > MAX_HEATMAP_CELLS ||
      rawGrid.some((row) => row.length !== cols)
    ) return _m;
    const grid = rawGrid.map((row) => row.map((v) => Number(v.trim())).filter((n) => Number.isFinite(n)));
    if (!grid.length || !grid[0].length || grid.some((row) => row.length !== cols)) return _m;
    const cellCount = grid.length * cols;
    if (complexVisualUnits + cellCount > MAX_COMPLEX_VISUAL_UNITS) return _m;
    const opts: Record<string, string> = {};
    for (const p of parts.slice(1)) {
      const m = p.match(/^(rows|cols|title)\s*=\s*(.+)$/i);
      if (m) opts[m[1].toLowerCase()] = m[2];
    }
    const rowLabels = opts.rows ? opts.rows.split(",").map((s) => s.trim()) : [];
    const colLabels = opts.cols ? opts.cols.split(",").map((s) => s.trim()) : [];
    complexVisualUnits += cellCount;
    return vizFigure(renderHeatmapSvg(grid, rowLabels, colLabels, opts.title || ""), opts.title || "");
  });

  // {{wheel: 78,64,82 | labels=Yield,Growth,Risk | max=100 | title=…}}
  out = out.replace(/\{\{wheel:\s*([^}]+)\}\}/gi, (_m, args) => {
    const rawArgs = String(args);
    if (rawArgs.length > MAX_VISUAL_SHORTCODE_CHARS) return _m;
    const parts = rawArgs.split("|").map((s) => s.trim());
    const rawScores = parts[0].split(",");
    if (rawScores.length > MAX_WHEEL_SCORES) return _m;
    const scores = rawScores.map((v) => Number(v.trim())).filter((n) => Number.isFinite(n));
    // Two bars are a comparison. The old floor of three was the radar's — a
    // polygon needs three vertices to be a shape; bars do not.
    if (scores.length < 2) return _m;
    if (complexVisualUnits + scores.length > MAX_COMPLEX_VISUAL_UNITS) return _m;
    const opts: Record<string, string> = {};
    for (const p of parts.slice(1)) {
      const m = p.match(/^(labels|max|title)\s*=\s*(.+)$/i);
      if (m) opts[m[1].toLowerCase()] = m[2];
    }
    const labels = opts.labels ? opts.labels.split(",").map((s) => s.trim()) : [];
    complexVisualUnits += scores.length;
    return vizFigure(renderScoreBarsSvg(scores, labels, Number(opts.max) || 100), opts.title || "");
  });

  // {{bars: Label1 70, Label2 45%, Label3 $1.2M | title=… | max=100 | unit=%}}
  out = out.replace(/\{\{bars:\s*([^}]+)\}\}/gi, (_m, args) => {
    const parts = String(args).split("|").map((s) => s.trim());
    const opts: Record<string, string> = {};
    const rows: Array<{ label: string; value: number; display?: string }> = [];
    const items = parts[0].split(",").map((s) => s.trim()).filter(Boolean);
    for (const it of items) {
      const m = it.match(/^(.+?)\s+([\-+]?[\d.,]+\s*[%$kKmM]?[a-zA-Z]*)$/);
      if (!m) continue;
      const display = m[2].trim();
      const num = parseLooseNumber(display.replace(/[%$,kKmM]/g, "")) ?? 0;
      const mult = /m\b/i.test(display) ? 1_000_000 : /k\b/i.test(display) ? 1_000 : 1;
      rows.push({ label: m[1].trim(), value: num * mult, display });
    }
    for (const p of parts.slice(1)) { const m = p.match(/^(title|max|unit)\s*=\s*(.+)$/i); if (m) opts[m[1].toLowerCase()] = m[2]; }
    if (!rows.length) return _m;
    return vizFigure(renderBarsSvg(rows, { title: opts.title, max: opts.max ? Number(opts.max) : undefined, unit: opts.unit }), opts.title || "");
  });

  // {{quadrant: 8,7 "This property", 5,4 "Suburb avg" | xlabel=Yield | ylabel=Growth | xmax=10 | ymax=10 | title=… | q1=… | q2=… | q3=… | q4=…}}
  out = out.replace(/\{\{quadrant:\s*([^}]+)\}\}/gi, (_m, args) => {
    const parts = String(args).split("|").map((s) => s.trim());
    const points: Array<{ x: number; y: number; label: string; highlight?: boolean }> = [];
    parts[0].split(/,(?=\s*[\d.]+\s*,\s*[\d.]+)/).forEach((seg) => {
      const m = seg.trim().match(/^([\d.]+)\s*,\s*([\d.]+)\s*"([^"]+)"(\s*\*)?$/);
      if (m) points.push({ x: Number(m[1]), y: Number(m[2]), label: m[3], highlight: !!m[4] });
    });
    if (!points.length) return _m;
    const opts: Record<string, string> = {};
    for (const p of parts.slice(1)) { const m = p.match(/^(xlabel|ylabel|xmax|ymax|title|q1|q2|q3|q4)\s*=\s*(.+)$/i); if (m) opts[m[1].toLowerCase()] = m[2]; }
    return vizFigure(renderQuadrantSvg(points, {
      xLabel: opts.xlabel, yLabel: opts.ylabel,
      xMax: opts.xmax ? Number(opts.xmax) : undefined, yMax: opts.ymax ? Number(opts.ymax) : undefined,
      title: opts.title, q1: opts.q1, q2: opts.q2, q3: opts.q3, q4: opts.q4,
    }), opts.title || "");
  });

  // {{pictograph: FILLED/TOTAL | label=… | sub=… | icon=person|house|dollar | cols=10}}
  out = out.replace(/\{\{pictograph:\s*([^}]+)\}\}/gi, (_m, args) => {
    const parts = String(args).split("|").map((s) => s.trim());
    const m = parts[0].match(/^(\d+)\s*\/\s*(\d+)$/); if (!m) return _m;
    const opts: Record<string, string> = {};
    for (const p of parts.slice(1)) { const mm = p.match(/^(label|sub|icon|cols)\s*=\s*(.+)$/i); if (mm) opts[mm[1].toLowerCase()] = mm[2]; }
    const icon = (opts.icon as "person" | "house" | "dollar") || "house";
    return vizFigure(renderPictographSvg(Number(m[1]), Number(m[2]), {
      icon, label: opts.label, sub: opts.sub, cols: opts.cols ? Number(opts.cols) : undefined,
    }), opts.label || "");
  });

  // {{glance: ✓ Strong fundamentals | ⚠ Vacancy uptick | 📈 Yield 4.8% | 🎯 Buy with caveats}}
  out = out.replace(/\{\{glance:\s*([^}]+)\}\}/gi, (_m, args) => {
    const items = String(args).split("|").map((s) => s.trim()).filter(Boolean);
    if (!items.length) return _m;
    const cells = items.slice(0, 4).map((raw) => {
      const m = raw.match(/^(\S+)\s+(.+)$/);
      const sym = m ? m[1] : "•";
      const text = m ? m[2] : raw;
      return `<div class="glance-cell"><span class="glance-sym">${esc(sym)}</span><span class="glance-text">${esc(text)}</span></div>`;
    }).join("");
    return `\n<div class="glance-strip">${cells}</div>\n`;
  });

  // {{donut: Owner 58, Renter 32, Other 10 | title=Tenure mix | center=58% | centerSub=Owner-occupied}}
  out = out.replace(/\{\{donut:\s*([^}]+)\}\}/gi, (_m, args) => {
    const parts = String(args).split("|").map((s) => s.trim());
    const opts: Record<string, string> = {};
    const segs: Array<{ label: string; value: number }> = [];
    for (const it of parts[0].split(",").map((s) => s.trim()).filter(Boolean)) {
      const m = it.match(/^(.+?)\s+([\-+]?[\d.]+)$/);
      if (m) segs.push({ label: m[1].trim(), value: Number(m[2]) || 0 });
    }
    for (const p of parts.slice(1)) {
      const m = p.match(/^(title|center|centersub)\s*=\s*(.+)$/i);
      if (m) opts[m[1].toLowerCase()] = m[2];
    }
    if (!segs.length) return _m;
    return vizFigure(renderDonutSvg(segs, { title: opts.title, centerLabel: opts.center, centerSub: opts.centersub }), opts.title || "");
  });

  // {{tiles: Suburb1 $1.2M sub="↑ 6.4% YoY" int=0.8, Suburb2 $980k sub="↑ 4.1% YoY" int=0.55 | title=Adjacent suburbs | cols=4}}
  out = out.replace(/\{\{tiles:\s*([^}]+)\}\}/gi, (_m, args) => {
    const parts = String(args).split("|").map((s) => s.trim());
    const opts: Record<string, string> = {};
    for (const p of parts.slice(1)) {
      const m = p.match(/^(title|cols)\s*=\s*(.+)$/i);
      if (m) opts[m[1].toLowerCase()] = m[2];
    }
    // split items on commas that are NOT inside quotes
    const items: Array<{ label: string; value: string; sub?: string; intensity?: number }> = [];
    const segRe = /([^,"]+?(?:"[^"]*"[^,"]*?)*)(?:,|$)/g;
    let mm: RegExpExecArray | null;
    while ((mm = segRe.exec(parts[0])) !== null) {
      const raw = mm[1].trim();
      if (!raw) continue;
      const subMatch = raw.match(/sub\s*=\s*"([^"]*)"/i);
      const intMatch = raw.match(/int\s*=\s*([\d.]+)/i);
      const stripped = raw.replace(/\s*sub\s*=\s*"[^"]*"/i, "").replace(/\s*int\s*=\s*[\d.]+/i, "").trim();
      const head = stripped.match(/^(.+?)\s+(\S.*)$/);
      if (!head) continue;
      items.push({
        label: head[1].trim(),
        value: head[2].trim(),
        sub: subMatch?.[1],
        intensity: intMatch ? Number(intMatch[1]) : undefined,
      });
    }
    if (!items.length) return _m;
    return vizFigure(renderTilesSvg(items, { title: opts.title, cols: opts.cols ? Number(opts.cols) : undefined }), opts.title || "");
  });

  // {{margin: Title text | spark=1,2,3,4,5 | note=One-line context that sits in the margin.}}
  out = out.replace(/\{\{margin:\s*([^}]+)\}\}/gi, (_m, args) => {
    const parts = String(args).split("|").map((s) => s.trim());
    const title = parts[0];
    const opts: Record<string, string> = {};
    for (const p of parts.slice(1)) {
      const m = p.match(/^(spark|note|label)\s*=\s*(.+)$/i);
      if (m) opts[m[1].toLowerCase()] = m[2];
    }
    const vals = (opts.spark || "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
    const spark = vals.length >= 2 ? renderMarginSparkSvg(vals) : "";
    return `\n<aside class="sidenote sidenote-margin">
      ${opts.label ? `<span class="sidenote-label">${esc(opts.label)}</span>` : ""}
      ${title ? `<div class="margin-title">${esc(title)}</div>` : ""}
      ${spark ? `<div class="margin-spark">${spark}</div>` : ""}
      ${opts.note ? `<p class="margin-note">${esc(opts.note)}</p>` : ""}
    </aside>\n`;
  });

  // {{timeline: Existing "Rail station", 0-2y "Shopping upgrade", 3-5y "Hospital stage" | title=Infrastructure ribbon}}
  out = out.replace(/\{\{timeline:\s*([^}]+)\}\}/gi, (_m, args) => {
    const parts = String(args).split("|").map((s) => s.trim());
    const opts: Record<string, string> = {};
    for (const p of parts.slice(1)) {
      const m = p.match(/^(title)\s*=\s*(.+)$/i);
      if (m) opts[m[1].toLowerCase()] = m[2];
    }
    const items = parts[0].split(/,(?=\s*(?:existing|0\s*-?\s*2|3\s*-?\s*5|5\s*y\+?|short|medium|long)\b)/i).map((seg) => {
      const m = seg.trim().match(/^(existing|0\s*-?\s*2y?|3\s*-?\s*5y?|5y\+?|short(?:-term)?|medium(?:-term)?|long(?:-term)?)\s+"([^"]+)"(?:\s+confidence="([^"]+)")?/i);
      return m ? { phase: m[1], label: m[2], confidence: m[3] } : null;
    }).filter(Boolean) as Array<{ phase: string; label: string; confidence?: string }>;
    if (!items.length) return _m;
    return vizFigure(renderTimelineRibbonSvg(items, opts.title || "Infrastructure pipeline"), opts.title || "Infrastructure pipeline");
  });


  out = out.replace(/~~\[([\d.,\s\-]+)\]~~/g, (_m, list) => {
    const vals = String(list).split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
    return minifySvg(renderInlineSparkSvg(vals));
  });

  return out;
}

/**
 * Post-marked HTML processor: converts footnote calls/defs into CSS Paged Media
 * footnotes (WeasyPrint native), and turns [[see:#id]] into target-counter xrefs.
 */
function applyFootnotesAndXrefs(html: string): string {
  // 1. Collect footnote defs: [^id]: text  (marked may leave them in <p> or escape ^).
  //    Splitting them apart, and flattening each body onto one line, are both
  //    load-bearing — see `footnotes.ts`. A newline here failed the render.
  const { html: withoutDefs, defs } = collectFootnoteDefinitions(html);
  let out = withoutDefs;

  // 2. Replace inline calls [^id] with a footnote span (float: footnote in CSS).
  out = out.replace(/\[\^([\w-]+)\]/g, (_m, id) => {
    const body = defs.get(String(id));
    if (!body) return "";
    return `<span class="footnote">${body}</span>`;
  });

  // 3. Cross-references: [[see:#anchor]] or [[see:#anchor|prefix]]
  out = out.replace(/\[\[see:#([\w-]+)(?:\|([^\]]+))?\]\]/g, (_m, id, prefix) => {
    const label = prefix ? String(prefix).trim() : "see p.";
    return `<a class="xref" href="#${id}"><span class="xref-prefix">${esc(label)}</span><span class="xref-page"></span></a>`;
  });

  return out;
}

/** Detect numeric markdown tables in rendered HTML, prepend a chart visualisation. */
async function injectTableCharts(html: string): Promise<string> {
  // Chart decoration is optional. Keep rendering the original report when the
  // generated HTML is too large or table-heavy to process within a bounded cost.
  if (html.length > MAX_CHART_INJECTION_HTML_CHARS) return html;

  const tablePattern = /<table[\s\S]*?<\/table>/gi;
  const tables: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = tablePattern.exec(html)) !== null) {
    if (tables.length >= MAX_CHART_INJECTION_TABLES) return html;
    tables.push(match);
  }
  if (tables.length === 0) return html;

  // Scan headings once in document order so every table gets its nearest
  // preceding h2/h3 without repeatedly copying and rescanning the HTML prefix.
  const sectionTitles: string[] = [];
  const headingPattern = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let heading = headingPattern.exec(html);
  let sectionTitle = "";
  for (const table of tables) {
    const tableIndex = table.index ?? 0;
    while (heading && (heading.index ?? 0) < tableIndex) {
      sectionTitle = (heading[2] || "").replace(/<[^>]+>/g, "").trim();
      heading = headingPattern.exec(html);
    }
    sectionTitles.push(sectionTitle);
  }

  const replacements = new Array<string>(tables.length);
  let chartAttempts = 0;
  let nextTableIndex = 0;
  const workers = Array.from({ length: Math.min(4, tables.length) }, async () => {
    while (true) {
      const index = nextTableIndex++;
      if (index >= tables.length) return;
      const tbl = tables[index][0];
      const sectionTitle = sectionTitles[index];
      const theadMatch = tbl.match(/<thead[\s\S]*?<\/thead>/i);
      const headerSource = theadMatch?.[0] || tbl.match(/<tr[\s\S]*?<\/tr>/i)?.[0] || "";
      const headers = Array.from(headerSource.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi))
        .map((m) => m[1].replace(/<[^>]+>/g, "").trim());

      const bodySource = tbl.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] || tbl;
      const allRows = Array.from(bodySource.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi))
        .map((rm) => Array.from(rm[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi))
          .map((c) => c[1].replace(/<[^>]+>/g, "").trim()));
      const dataRows = theadMatch ? allRows : allRows.slice(1);

      const canAddChart = chartAttempts < MAX_AUTO_TABLE_CHARTS;
      const chart = canAddChart ? await tableToChartHtml(headers, dataRows, { sectionTitle }) : null;
      if (chart) chartAttempts += 1;
      replacements[index] = chart ? `<div class="chart-wrap">${chart}${tbl}</div>` : tbl;
    }
  });
  await Promise.all(workers);

  let i = 0;
  return html.replace(/<table[\s\S]*?<\/table>/gi, () => replacements[i++]);
}

async function buildFinancialChartsHtml(fin: any): Promise<string> {
  const rows = projectionRows(fin).slice(0, 10);
  const labels = rows.map((r, i) => String(r?.year ?? r?.label ?? `Year ${i + 1}`).replace(/^year\s*/i, "Yr "));
  const charts: string[] = [];
  const commonFont = { family: FONT_STACK, size: 11 };
  const gridColor = "rgba(181, 165, 128, 0.25)";
  const moneyTick = "function(v){return Math.abs(v)>=1000000?'$'+(v/1000000).toFixed(1)+'m':Math.abs(v)>=1000?'$'+(v/1000).toFixed(0)+'k':'$'+v.toFixed(0);}";

  if (labels.length >= 3) {
    const propertyValue = pickSeries(rows, ["propertyValue", "value", "estimatedValue", "marketValue"]);
    const equity = pickSeries(rows, ["equity", "netEquity"]);
    const loanBalance = pickSeries(rows, ["loanBalance", "debt", "loanAmount"]);
    const datasets = [
      propertyValue && { label: "Property value", data: propertyValue, borderColor: CHART_PALETTE[0], backgroundColor: withAlpha(CHART_PALETTE[0], 0.16), borderWidth: 2.4, tension: 0.38, pointRadius: 2.8, fill: true },
      equity && { label: "Equity", data: equity, borderColor: CHART_PALETTE[2], backgroundColor: withAlpha(CHART_PALETTE[2], 0.06), borderWidth: 2.2, tension: 0.38, pointRadius: 2.8, fill: false },
      loanBalance && { label: "Loan balance", data: loanBalance, borderColor: CHART_PALETTE[1], backgroundColor: withAlpha(CHART_PALETTE[1], 0.04), borderWidth: 2.2, tension: 0.38, pointRadius: 2.8, fill: false },
    ].filter(Boolean);
    if (datasets.length) {
      const uri = await chartDataUri({
        type: "line",
        data: { labels, datasets },
        options: {
          plugins: { legend: { position: "bottom", labels: { color: "#17130D", font: commonFont, boxWidth: 12, padding: 12, usePointStyle: true } } },
          scales: {
            x: { ticks: { color: "#5F5546", font: commonFont }, grid: { color: "transparent" }, border: { color: "#B5A580" } },
            y: { ticks: { color: "#5F5546", font: commonFont, callback: moneyTick }, grid: { color: gridColor, drawBorder: false }, border: { display: false } },
          },
        },
      }, CHART_PRESETS.TREND_WIDE.width, CHART_PRESETS.TREND_WIDE.height, "financial:value-equity-debt");
      if (uri) charts.push(`<div class="chart-wrap financial-chart"><div class="chart-title">10-year value, equity and debt path</div><figure class="auto-chart"><img src="${uri}" alt="10-year value equity and debt chart"/><figcaption>Source: NPC projections, modelled over 10 years.</figcaption></figure></div>`);
    }

    const cashFlow = pickSeries(rows, ["cashFlow", "annualNet", "netCashflow", "annualNetCashflow"]);
    const annualRent = pickSeries(rows, ["annualRent", "rent", "rentalIncome"]);
    if (cashFlow || annualRent) {
      const uri = await chartDataUri({
        type: "bar",
        data: {
          labels,
          datasets: [
            annualRent && { label: "Annual rent", data: annualRent, backgroundColor: withAlpha(CHART_PALETTE[2], 0.88), borderRadius: 6, borderSkipped: false, maxBarThickness: 34 },
            cashFlow && { label: "Net cash flow", data: cashFlow, backgroundColor: withAlpha(CHART_PALETTE[3], 0.86), borderRadius: 6, borderSkipped: false, maxBarThickness: 34 },
          ].filter(Boolean),
        },
        options: {
          plugins: { legend: { position: "bottom", labels: { color: "#17130D", font: commonFont, boxWidth: 12, padding: 12, usePointStyle: true } } },
          scales: {
            x: { ticks: { color: "#5F5546", font: commonFont }, grid: { color: "transparent" }, border: { color: "#B5A580" } },
            y: { ticks: { color: "#5F5546", font: commonFont, callback: moneyTick }, grid: { color: gridColor, drawBorder: false }, border: { display: false } },
          },
        },
      }, CHART_PRESETS.BAR_WIDE.width, CHART_PRESETS.BAR_WIDE.height, "financial:rent-cashflow");
      if (uri) charts.push(`<div class="chart-wrap financial-chart"><div class="chart-title">Rental income versus net cash flow</div><figure class="auto-chart"><img src="${uri}" alt="Rental income and cash flow chart"/><figcaption>Source: NPC projections, modelled over 10 years.</figcaption></figure></div>`);
    }
  }

  const km = fin?.keyMetrics || fin?.key_metrics || {};
  const yieldBars = [
    ["Gross yield", num(km.grossRentalYield)],
    ["Net yield", num(km.netRentalYield)],
    ["Cash-on-cash", num(km.cashOnCashReturn)],
    ["LVR", num(km.lvr)],
  ].filter(([, v]) => v !== null) as Array<[string, number]>;
  if (yieldBars.length >= 2) {
    const uri = await chartDataUri({
      type: "bar",
      data: { labels: yieldBars.map(([label]) => label), datasets: [{ data: yieldBars.map(([, v]) => v), backgroundColor: yieldBars.map((_, i) => withAlpha(CHART_PALETTE[i % CHART_PALETTE.length], 0.9)), borderRadius: 6, borderSkipped: false, maxBarThickness: 46 }] },
      options: {
        plugins: { legend: { display: false }, datalabels: { anchor: "end", align: "top", color: "#2A2317", font: { ...commonFont, weight: "600" }, formatter: "function(v){return v.toFixed(1)+'%';}" } },
        scales: {
          x: { ticks: { color: "#5F5546", font: commonFont }, grid: { color: "transparent" }, border: { color: "#B5A580" } },
          y: { ticks: { color: "#5F5546", font: commonFont, callback: "function(v){return v.toFixed(0)+'%';}" }, grid: { color: gridColor, drawBorder: false }, border: { display: false } },
        },
      },
    }, CHART_PRESETS.BAR_WIDE.width, CHART_PRESETS.BAR_WIDE.height, "financial:yield-bars");
    if (uri) charts.push(`<div class="chart-wrap financial-chart"><div class="chart-title">Yield and leverage profile</div><figure class="auto-chart"><img src="${uri}" alt="Yield and leverage chart"/><figcaption>Source: NPC key-metrics snapshot.</figcaption></figure></div>`);
  }

  return charts.length ? `<section class="body-page financial-charts"><h2 id="ch-financial-visuals">Financial Visuals</h2>${charts.join("")}</section>` : "";
}

// ─────────────────────────────────────────────────────────────
// Infographic block detectors — compare cards + process timelines
// ─────────────────────────────────────────────────────────────
function wrapCompareCards(html: string): string {
  const pairs: Array<[RegExp, RegExp]> = [
    [/strengths?/i, /(?:watch(?:[- ]?outs?)?|risks?|cautions?|concerns?|things?\s+to\s+watch)/i],
    [/pros?/i, /cons?/i],
    [/advantages?/i, /disadvantages?/i],
    [/opportunit(?:y|ies)/i, /threats?/i],
    [/upsides?/i, /downsides?/i],
  ];
  let out = html;
  for (const [a, b] of pairs) {
    const re = new RegExp(
      `<h([34])[^>]*>\\s*(${a.source})\\s*<\\/h\\1>\\s*(<ul[\\s\\S]*?<\\/ul>)\\s*<h\\1[^>]*>\\s*(${b.source})\\s*<\\/h\\1>\\s*(<ul[\\s\\S]*?<\\/ul>)`,
      "gi",
    );
    out = out.replace(re, (_m, _lvl, lTitle, lList, rTitle, rList) =>
      `<div class="compare-card">
        <div class="compare-col compare-pos">
          <div class="compare-head">${esc(String(lTitle).trim())}</div>${lList}
        </div>
        <div class="compare-col compare-neg">
          <div class="compare-head">${esc(String(rTitle).trim())}</div>${rList}
        </div>
      </div>`);
  }
  return out;
}

function wrapProcessTimeline(html: string): string {
  // Match 2+ consecutive "Step N: …" headings with following paragraph(s)
  const re = /(?:<h[34][^>]*>\s*Step\s+\d+\s*[:.\-]?\s*[^<]*<\/h[34]>\s*(?:<p>[\s\S]*?<\/p>\s*)+){2,}/gi;
  return html.replace(re, (block) => {
    const items = Array.from(block.matchAll(/<h[34][^>]*>\s*(Step\s+\d+)\s*[:.\-]?\s*([^<]*)<\/h[34]>\s*((?:<p>[\s\S]*?<\/p>\s*)+)/gi))
      .map((m) =>
        `<li>
          <div class="step-no">${esc(m[1])}</div>
          <div class="step-content">
            <div class="step-title">${esc(m[2].trim())}</div>
            <div class="step-body">${m[3]}</div>
          </div>
        </li>`
      );
    if (items.length < 2) return block;
    return `<ol class="timeline">${items.join("")}</ol>`;
  });
}

// ─────────────────────────────────────────────────────────────
// Projection series → sparklines beside KPI tiles
// ─────────────────────────────────────────────────────────────
function findProjectionSeries(fin: any): { valueSeries?: number[]; cashflowSeries?: number[]; yieldSeries?: number[]; rentSeries?: number[] } {
  const proj = projectionRows(fin);
  if (!Array.isArray(proj) || proj.length < 3) return {};
  const pick = (keys: string[]) => {
    const vals = proj.map((p: any) => {
      for (const k of keys) {
        const n = num(p?.[k]);
        if (n !== null) return n;
      }
      return null;
    });
    return vals.every((v: any) => v !== null) ? (vals as number[]) : undefined;
  };
  return {
    valueSeries: pick(["propertyValue", "value", "price", "estimatedValue"]),
    cashflowSeries: pick(["annualNet", "netCashflow", "cashflow", "annualNetCashflow", "weeklyNet"]),
    yieldSeries: pick(["grossYield", "yield", "rentalYield"]),
    rentSeries: pick(["weeklyRent", "rentPerWeek"]),
  };
}

// ─────────────────────────────────────────────────────────────
// Hero illustration injection (pre-generated assets only — no AI calls here)
// Hero images are produced asynchronously by `prepare-report-hero-images`
// and stored in the `investment-reports` bucket. This renderer is now
// lightweight and never calls the AI gateway.
// ─────────────────────────────────────────────────────────────
function fallbackHeroSvg(chapterTitle: string): string {
  const seed = chapterTitle.split("").reduce((acc, ch) => (acc + ch.charCodeAt(0) * 17) % 997, 31);
  const ridge = Array.from({ length: 9 }, (_, i) => {
    const y = 44 + i * 18 + (seed % (i + 7));
    return `<path d="M-20 ${y} C 140 ${y - 36}, 260 ${y + 38}, 420 ${y - 10} S 700 ${y + 28}, 920 ${y - 18}" fill="none" stroke="#2E6CB0" stroke-opacity="${0.08 + i * 0.02}" stroke-width="1.2"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="315" viewBox="0 0 1200 315">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#061A33"/><stop offset="0.6" stop-color="#0A2540"/><stop offset="1" stop-color="#1E4A7C"/></linearGradient>
      <radialGradient id="glow" cx="78%" cy="22%" r="62%"><stop offset="0" stop-color="#D4A843" stop-opacity="0.30"/><stop offset="1" stop-color="#D4A843" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1200" height="315" fill="url(#bg)"/>
    <rect width="1200" height="315" fill="url(#glow)"/>
    <g opacity="0.95">${ridge}</g>
  </svg>`;
  return compactDataUri(svg);
}

type HeroPlacement = {
  url: string;
  height: "compact" | "standard" | "tall" | "full_bleed";
  width: "content" | "full_bleed";
  fit: "cover" | "contain";
  focal: "top" | "center" | "bottom";
  rounded: boolean;
};

/**
 * The house cover artwork, as a `data:` URI, read from
 * `public.report_default_assets`.
 *
 * Cached per isolate: a report render touches the cover once, but a warm isolate
 * serves many renders and this row is ~220 KB. A miss returns `null` rather than
 * throwing — a cover with no photograph still prints, and the gradient/foil
 * treatment below carries it. Losing the artwork must never lose the report.
 */
let houseCoverArtCache: string | null | undefined;
async function loadHouseCoverArt(): Promise<string | null> {
  if (houseCoverArtCache !== undefined) return houseCoverArtCache;
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data, error } = await supabase
      .from("report_default_assets")
      .select("data_uri")
      .eq("asset_key", "npc_house_cover_art")
      .maybeSingle();
    if (error) throw error;
    const uri = typeof data?.data_uri === "string" ? data.data_uri : null;
    houseCoverArtCache = uri && uri.startsWith("data:") ? uri : null;
  } catch (err) {
    console.error("[render-investment-report-pdf] cover art load failed", err);
    houseCoverArtCache = null;
  }
  return houseCoverArtCache;
}

async function loadHeroPlacements(reportId: string): Promise<Record<string, HeroPlacement>> {
  const out: Record<string, HeroPlacement> = {};
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    // 1. Modern placements (per-chapter controls)
    const { data: placements } = await supabase
      .from("report_hero_placements")
      .select(`
        section_key, render_height, render_width, object_fit, focal, rounded,
        library:hero_image_library!report_hero_placements_library_image_id_fkey ( storage_path, public_url )
      `)
      .eq("report_id", reportId);
    // 2. Legacy fallback for slugs not in placements
    const { data: legacy } = await supabase
      .from("report_visual_assets")
      .select("section_key, storage_path, public_url")
      .eq("report_id", reportId)
      .eq("status", "ready")
      .eq("include_in_report", true);

    // investment-reports is private (STOR-005): sign every hero object from its
    // storage_path in one batch. Fall back to any stored public_url only for
    // rows that have no storage_path (e.g. an external image).
    const paths: string[] = [];
    for (const p of (placements || []) as any[]) if (p?.library?.storage_path) paths.push(p.library.storage_path);
    for (const r of (legacy || []) as any[]) if (r?.storage_path) paths.push(r.storage_path);
    const signed = await signStoragePaths(supabase, PDF_BUCKET, paths, 60 * 60);

    for (const p of (placements || []) as any[]) {
      const sp = p?.library?.storage_path;
      const url = (sp && signed[sp]) || p?.library?.public_url;
      if (!url || !p.section_key) continue;
      out[p.section_key] = {
        url,
        height: p.render_height || "standard",
        width: p.render_width || "content",
        fit: p.object_fit || "cover",
        focal: p.focal || "center",
        rounded: p.rounded !== false,
      };
    }
    for (const r of (legacy || []) as Array<{ section_key: string; storage_path: string; public_url: string }>) {
      const url = (r.storage_path && signed[r.storage_path]) || r.public_url;
      if (!url || out[r.section_key]) continue;
      out[r.section_key] = {
        url,
        height: "standard",
        width: "full_bleed",
        fit: "cover",
        focal: "center",
        rounded: false,
      };
    }
    return out;
  } catch (err) {
    console.warn("[render-investment-report-pdf] hero asset load failed", err);
    return out;
  }
}

function injectHeroImages(
  html: string,
  heroesBySlug: Record<string, HeroPlacement>,
  toc: Array<{ id: string; title: string }>,
): string {
  const idToSlug = new Map<string, string>();
  for (const t of toc) idToSlug.set(t.id, slugify(t.title));

  return html.replace(/<h2 id="(ch-[^"]+)"([^>]*)>([\s\S]*?)<\/h2>/gi, (_m, id, attrs, inner) => {
    const slug = idToSlug.get(id);
    const p = slug ? heroesBySlug[slug] : undefined;
    if (!p) return `<h2 id="${id}"${attrs}>${inner}</h2>`;
    const cls = [
      "chapter-hero",
      `hero-h-${p.height}`,
      `hero-w-${p.width}`,
      `hero-fit-${p.fit}`,
      `hero-focal-${p.focal}`,
      p.rounded ? "hero-rounded" : "hero-flush",
    ].join(" ");
    return `<div class="${cls}"><img src="${p.url}" alt="" crossorigin="anonymous"/></div><h2 id="${id}"${attrs}>${inner}</h2>`;
  });
}

/**
 * Tag each top-level h2 with an id + record TOC entries so we can render a TOC
 * page and use CSS `target-counter()` for page numbers.
 */
function annotateChaptersAndExtractToc(html: string): { html: string; toc: Array<{ id: string; title: string }> } {
  const toc: Array<{ id: string; title: string }> = [];
  const used = new Set<string>();
  // Phase 2 #16/#17 — palette rotated per chapter so thumb-index tabs stagger
  // both vertically (top) and chromatically across the page edge.
  const TAB_HUES = [
    "linear-gradient(180deg,#D4A843,#8a6418)",
    "linear-gradient(180deg,#2E6CB0,#143b73)",
    "linear-gradient(180deg,#7A8C5C,#3d4a2a)",
    "linear-gradient(180deg,#B85C3A,#6b2f1c)",
    "linear-gradient(180deg,#5C4A8C,#2f2454)",
    "linear-gradient(180deg,#3C8C8A,#1f4a48)",
  ];
  let chapterIndex = 0;
  const annotated = html.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/gi, (_m, attrs, inner) => {
    const text = String(inner).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
    let id = `ch-${slugify(text) || `${toc.length + 1}`}`;
    let n = 1;
    while (used.has(id)) id = `ch-${slugify(text) || "section"}-${++n}`;
    used.add(id);
    toc.push({ id, title: text });
    const i = chapterIndex++;
    const topMm = 18 + (i % 8) * 28;          // stagger down the page edge
    const grad = TAB_HUES[i % TAB_HUES.length];
    const thumbTab = `<span class="thumb-tab" style="top:${topMm}mm;background:${grad}" aria-hidden="true">${esc(text)}</span>`;
    const ghostNum = `<span class="ch-ghost" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>`;
    // Insert a tasteful end-of-chapter mark before every chapter except the first.
    // The ::before/::after on the h2 itself can't render outside the chapter's
    // own page, so we emit the closer as a sibling block that lives at the *end*
    // of the previous chapter's flow (paged-media floats it to that page's tail).
    const closer = i > 0
      ? `<div class="chapter-closer" aria-hidden="true"><span class="chapter-closer-rule"></span><span class="chapter-closer-mark">◆</span><span class="chapter-closer-rule"></span></div>`
      : "";
    return `${closer}<h2 id="${id}" data-ch="${i + 1}"${attrs}>${thumbTab}${ghostNum}${inner}</h2>`;
  });
  return { html: annotated, toc };
}

// Phase 1 #1 — wrap any wide table (>5 columns) in a landscape spread so
// dense data tables get the full A4 width instead of crushing into portrait.
function wrapWideTablesLandscape(html: string): string {
  return html.replace(/<table([\s\S]*?)<\/table>/gi, (full) => {
    // Count <th> in the first <tr>; fall back to first row of <td>.
    const firstRow = full.match(/<tr[^>]*>[\s\S]*?<\/tr>/i)?.[0] || "";
    const thCount = (firstRow.match(/<th\b/gi) || []).length;
    const tdCount = (firstRow.match(/<td\b/gi) || []).length;
    const cols = Math.max(thCount, tdCount);
    if (cols < 6) return full;
    return `<div class="landscape-spread"><div class="landscape-inner">${full}</div></div>`;
  });
}

export async function buildHtml(
  report: any,
  brandName: string,
  opts: {
    includeCharts?: boolean;
    includeHeroImages?: boolean;
    includeSparklines?: boolean;
    designOptions?: unknown;
    contact?: Record<string, any>;
    disclaimer?: { is_enabled?: boolean; text?: string; font_size?: string };
  } = {},
): Promise<string> {
  const contact = opts.contact || {};
  const disclaimer = opts.disclaimer || {};
  // Who this document is issued BY. Resolved ONCE, here, because four places
  // below used to answer it separately and printed three different businesses
  // on one unbranded report — `NPC` in the watermark, `NPC Property` in the PDF
  // metadata and `PROPERTY CONSULTING` on the back page. See
  // `_shared/reports/issuerIdentity.pure.ts`.
  const issuer = resolveReportIssuer({ companyName: contact.company_name, brandName });
  const issuedDisclaimer = resolveReportDisclaimer(issuer, disclaimer);
  // Keep report-wide advisor attribution initialized before any generated HTML/CSS
  // fragments so later Phase blocks cannot accidentally hit a temporal-dead-zone.
  const advisorLine = contact.name || contact.advisor || issuer.name;
  const includeCharts = opts.includeCharts !== false;
  const includeSparklines = opts.includeSparklines !== false;
  const includeHeroImages = opts.includeHeroImages === true; // opt-in, costs tokens
  const design = normalizePdfDesign(opts.designOptions);
  const palette = DESIGN_PALETTES[design.preset];
  const densityScale = design.density === "compact" ? 0.9 : design.density === "spacious" ? 1.12 : 1;
  const bodyPt = Math.round(98 * (design.bodyScale / 100) * densityScale) / 10;
  const paragraphGap = design.density === "compact" ? ".54em" : design.density === "spacious" ? ".96em" : ".72em";
  const pageMargin = design.density === "compact" ? "18mm 15mm 18mm 15mm" : design.density === "spacious" ? "25mm 21mm 25mm 21mm" : "22mm 18mm 22mm 18mm";
  const intensity = design.visualIntensity / 100;

  const address = report.property_address || "Property";
  const generated = new Date(report.created_at || Date.now()).toLocaleDateString(
    "en-AU",
    { day: "numeric", month: "long", year: "numeric" },
  );
  const reportVariant: "composite" | "compass" | "financial" | "strategic" | "briefing" | "snapshot" | "due_diligence" =
    (report.report_variant as any) || "composite";
  /**
   * What this tier's document contains.
   *
   * The section registry has always said a Compass carries NO financial
   * modelling, and the generator obeys it: the prose a model writes for a
   * Compass has no financial section in it. This renderer read the tier for
   * the document's LABEL and then drew the KPI strip, the financial charts
   * and the price-and-rent paragraphs from `financial_calculations` whatever
   * the tier was — so the Compass opened on purchase price, gross yield, LVR
   * and a ten-year equity projection, and the Financial Analysis carried the
   * location case. One module decides it now, and the Investment Compass
   * masters read the same one.
   */
  const contentPolicy = contentPolicyFor(reportVariant);
  const variantLabel = reportVariant === "financial"
    ? "Financial Analysis Report"
    : reportVariant === "strategic" || reportVariant === "due_diligence"
    ? "Property & Location Due Diligence"
    : reportVariant === "briefing"
    ? "Client Briefing"
    : reportVariant === "snapshot"
    ? "Property Snapshot"
    : "Investment Report";

  // Historic rows carry the pre-fix fold's inflated projection series and
  // totals that do not foot; the charts and headline chips below must draw
  // the reconciled figures. No-op on post-fix rows.
  const fin = reconcileStoredFinancials(report.financial_calculations || {}).fin || {};
  const km = fin.keyMetrics || fin.key_metrics || {};
  const score = report.investment_score || {};
  const loc = report.location_intelligence || {};
  const dem = report.demographics_data || {};

  // Render + post-process markdown body.
  // Deterministic visual injection runs FIRST so generated tables / score mentions
  // are converted into shortcodes (heatmap / bars / gauge / tiles / sparkline) that
  // applyEditorialMarkdown then expands. This makes the renderer self-sufficient
  // even when the LLM emits pure prose + tables.
  // Through the read-path placeholder scrub every renderer applies
  // (`presentStoredMarkdown`): a stored "N/A" cell is never drawn.
  const mdRaw = escapeRawHtmlInMarkdown(
    cleanReportMarkdown(
      presentStoredMarkdown(
        String(report.report_content || ""),
        readEvidenceInventory(report as Record<string, unknown>),
      ),
      address,
    ),
  );
  const mdWithVisuals = autoInjectVisualShortcodes(mdRaw);
  console.log("[visuals] shortcodes injected:", {
    heatmaps: (mdWithVisuals.match(/\{\{heatmap:/g) || []).length,
    gauges: (mdWithVisuals.match(/\{\{gauge:/g) || []).length,
    bars: (mdWithVisuals.match(/\{\{bars:/g) || []).length,
    tiles: (mdWithVisuals.match(/\{\{tiles:/g) || []).length,
    sparklines: (mdWithVisuals.match(/~~\[/g) || []).length,
  });
  const md = applyEditorialMarkdown(mdWithVisuals);
  let bodyHtml = marked.parse(md, { gfm: true, breaks: false }) as string;
  bodyHtml = removeUnsafeRenderedUrls(bodyHtml);
  bodyHtml = stripBareCitations(bodyHtml);
  // Repair LLM currency artefacts where "$45,872.969" leaks a 3-digit
  // fractional group instead of a thousands separator. Any $-prefixed number
  // ending in exactly ".ddd" (and not followed by another digit) is treated
  // as a stray grouping and the trailing group is reattached with a comma.
  bodyHtml = bodyHtml.replace(/\$(\d{1,3}(?:,\d{3})*)\.(\d{3})(?!\d)/g, "$$$1,$2");
  bodyHtml = applyFootnotesAndXrefs(bodyHtml);
  bodyHtml = wrapCompareCards(bodyHtml);
  bodyHtml = wrapProcessTimeline(bodyHtml);
  bodyHtml = wrapInsightSections(bodyHtml);
  if (includeCharts) {
    bodyHtml = await injectTableCharts(bodyHtml);
    console.log("[charts] embedded table charts", { count: (bodyHtml.match(/class=\"chart-wrap\"/g) || []).length });
  }
  bodyHtml = colourCodeTableCells(bodyHtml);
  bodyHtml = wrapWideTablesLandscape(bodyHtml);
  bodyHtml = addDataSparklinesToParagraphs(bodyHtml);
  bodyHtml = injectChapterGlanceFallbacks(bodyHtml);
  const { html: bodyAnnotated, toc } = annotateChaptersAndExtractToc(bodyHtml);

  // Hero illustrations per chapter — consumes ONLY pre-generated assets
  // produced by the `prepare-report-hero-images` worker. Missing slugs
  // fall back to the navy/gold SVG banner so the PDF still renders.
  let bodyWithHeroes = bodyAnnotated;
  if (includeHeroImages && toc.length > 0) {
    const heroes = report.id ? await loadHeroPlacements(String(report.id)) : {};
    bodyWithHeroes = injectHeroImages(bodyAnnotated, heroes, toc);
  }

  const sourcesHtml = report.sources_content
    ? removeUnsafeRenderedUrls(marked.parse(
      escapeRawHtmlInMarkdown(String(report.sources_content)),
      { gfm: true },
    ) as string)
    : "";
  const financialChartsHtml = includeCharts && contentPolicy.financialModelling
    ? await buildFinancialChartsHtml(fin)
    : "";

  // KPI tiles (with optional sparklines from projection series)
  //
  // Withholding the modelling is not withholding the price: a location report
  // that will not say what the property costs is coy rather than focused. So
  // the asking price and the indicative rent stay on every tier — they are
  // facts about the asset, like its land size — and what leaves the Compass
  // is yield, LVR and cash flow, which are an analysis of a PURCHASE.
  const series = includeSparklines && contentPolicy.financialModelling ? findProjectionSeries(fin) : {};
  const kpis: Array<{ label: string; value: string; spark?: string }> = [];
  if (contentPolicy.identityFigures && km.purchasePrice != null) kpis.push({ label: "Purchase Price", value: fmtMoney(km.purchasePrice), spark: series.valueSeries && series.valueSeries.length >= 3 ? await quickSparklineUrl(series.valueSeries) || undefined : undefined });
  if (contentPolicy.financialModelling) {
    if (km.grossRentalYield != null) kpis.push({ label: "Gross Yield", value: fmtPct(km.grossRentalYield), spark: series.yieldSeries && series.yieldSeries.length >= 3 ? await quickSparklineUrl(series.yieldSeries, THEME.success) || undefined : undefined });
    if (km.netRentalYield != null) kpis.push({ label: "Net Yield", value: fmtPct(km.netRentalYield) });
    if (km.weeklyNet != null) kpis.push({ label: "Weekly Cash Flow", value: fmtMoney(km.weeklyNet), spark: series.cashflowSeries && series.cashflowSeries.length >= 3 ? await quickSparklineUrl(series.cashflowSeries, THEME.success) || undefined : undefined });
    if (km.lvr != null) kpis.push({ label: "LVR", value: fmtPct(km.lvr, 1) });
  }
  if (contentPolicy.identityFigures && km.weeklyRent != null) kpis.push({ label: "Weekly Rent", value: fmtMoney(km.weeklyRent), spark: series.rentSeries && series.rentSeries.length >= 3 ? await quickSparklineUrl(series.rentSeries) || undefined : undefined });

  const scoreOverall =
    score?.overall_score ?? score?.overallScore ?? score?.score ?? null;
  // `score.grade` is the scorer's own sentinel — `'N/A'` beside
  // `policy.gradeIssued: false` — so the grade goes through the one rule that
  // decides whether this record may state one at all, never verbatim.
  const scoreBand =
    score?.band ?? publishableGrade(score) ?? (typeof scoreOverall === "number"
      ? scoreOverall >= 80 ? "Strong" : scoreOverall >= 65 ? "Solid" : scoreOverall >= 50 ? "Mixed" : "Cautious"
      : null);

  const kpiTiles = kpis
    .map((k) => `<div class="kpi">
      <div class="kpi-label">${esc(k.label)}</div>
      <div class="kpi-value">${esc(k.value)}</div>
      ${k.spark ? `<div class="kpi-spark"><img src="${k.spark}" alt=""/></div>` : ""}
    </div>`)
    .join("");

  const trendDelta = (vals?: number[], mode: "money" | "percent" | "plain" = "plain") => {
    if (!vals || vals.length < 2) return undefined;
    const delta = vals[vals.length - 1] - vals[0];
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.0001) return "→ flat";
    const sign = delta > 0 ? "▲" : "▼";
    const abs = Math.abs(delta);
    const formatted = mode === "money" ? fmtMoney(abs) : mode === "percent" ? `${abs.toFixed(1)} pts` : abs.toFixed(abs >= 10 ? 0 : 1);
    return `${sign} ${formatted}`;
  };

  const summaryKpiHtml = renderKpiStripHtml([
    contentPolicy.identityFigures && km.purchasePrice != null ? { label: "Median / Price", value: fmtMoney(km.purchasePrice), delta: trendDelta(series.valueSeries, "money"), spark: series.valueSeries } : null,
    contentPolicy.financialModelling && km.grossRentalYield != null ? { label: "Yield", value: fmtPct(km.grossRentalYield), delta: trendDelta(series.yieldSeries, "percent"), spark: series.yieldSeries } : null,
    contentPolicy.identityFigures && km.weeklyRent != null ? { label: "Rent", value: `${fmtMoney(km.weeklyRent)}/wk`, delta: trendDelta(series.rentSeries, "money"), spark: series.rentSeries } : null,
    contentPolicy.financialModelling && km.weeklyNet != null ? { label: "Cash flow", value: fmtMoney(km.weeklyNet), delta: trendDelta(series.cashflowSeries, "money"), spark: series.cashflowSeries } : null,
  ].filter(Boolean) as Array<{ label: string; value: string; delta?: string; spark?: number[] }>);

  const scoreBreakdownItems = extractScoreBreakdownItems(score).slice(0, 6);
  const scoreVisualsHtml = [
    scoreOverall != null ? vizFigure(renderGaugeSvg(Number(scoreOverall), 100, "Investment Score", scoreBand || "Weighted composite"), "Investment score gauge") : "",
    scoreBreakdownItems.length >= 3 ? vizFigure(renderBarsSvg(scoreBreakdownItems, { title: "Score drivers", max: 100 }), "Score driver comparator") : "",
  ].filter(Boolean).join("");

  const renterShare = normaliseShare(recursiveNumberByKey(dem, [/renter/i, /renting/i, /tenant/i]));
  const ownerShare = normaliseShare(recursiveNumberByKey(dem, [/owner.?occup/i, /owned/i]));
  const demographicVisualHtml = [
    renterShare != null || ownerShare != null
      ? vizFigure(renderDonutSvg([
          ...(ownerShare != null ? [{ label: "Owner-occupied", value: ownerShare }] : []),
          ...(renterShare != null ? [{ label: "Renter", value: renterShare }] : []),
          ...((ownerShare != null || renterShare != null) && (ownerShare || 0) + (renterShare || 0) < 100 ? [{ label: "Other", value: 100 - (ownerShare || 0) - (renterShare || 0) }] : []),
        ], { title: "Tenure mix", centerLabel: renterShare != null ? `${Math.round(renterShare)}%` : undefined, centerSub: renterShare != null ? "Renter" : undefined }), "Tenure composition")
      : "",
    renterShare != null ? vizFigure(renderPictographSvg(Math.max(1, Math.round(renterShare / 10)), 10, { icon: "house", label: "Renter share", sub: `${Math.round(renterShare)} in 100 dwellings rent`, cols: 10 }), "Renter share pictograph") : "",
  ].filter(Boolean).join("");

  // ── Executive Summary (replaces Snapshot + Finance Visuals section) ──
  const suburbLabel = loc?.suburb && loc?.state
    ? `${loc.suburb}, ${loc.state}`
    : address;
  const priceTxt = km.purchasePrice != null ? fmtMoney(km.purchasePrice) : null;
  const yieldTxt = km.grossRentalYield != null ? fmtPct(km.grossRentalYield) : null;
  const rentTxt = km.weeklyRent != null ? fmtMoney(km.weeklyRent) : null;
  const cashflowTxt = km.weeklyNet != null ? fmtMoney(km.weeklyNet) : null;
  const lvrTxt = km.lvr != null ? fmtPct(km.lvr, 1) : null;
  const scoreTxt = scoreOverall != null ? `${Math.round(Number(scoreOverall))}/100${scoreBand ? ` (${scoreBand})` : ""}` : null;

  // Every sentence below promised something the document contains. On a
  // Compass they promised the financial modelling this tier does not carry —
  // "lending policy, and forward-looking cash-flow projections", "the
  // comparative scenarios and sensitivity tables that follow", "calculations"
  // — which is a contents page for a different report.
  const modelled = contentPolicy.financialModelling;
  const para1Parts: string[] = [];
  const locFrag = suburbLabel && suburbLabel !== address ? `, located in <strong>${esc(suburbLabel)}</strong>` : "";
  para1Parts.push(`This report presents an independent investment analysis of <strong>${esc(address)}</strong>${locFrag}.`);
  if (priceTxt && modelled) {
    const lvrFrag = lvrTxt ? ` at an LVR of <strong>${lvrTxt}</strong>` : "";
    const rentFrag = rentTxt ? `, with an assessed market rent of <strong>${rentTxt}/week</strong>` : "";
    const yieldFrag = yieldTxt ? ` (gross yield <strong>${yieldTxt}</strong>)` : "";
    para1Parts.push(`Modelled on a purchase price of <strong>${priceTxt}</strong>${lvrFrag}${rentFrag}${yieldFrag}.`);
  } else if (priceTxt) {
    const rentFrag = rentTxt ? `, with an assessed market rent of <strong>${rentTxt}/week</strong>` : "";
    para1Parts.push(`The property is offered at <strong>${priceTxt}</strong>${rentFrag}.`);
  }
  para1Parts.push(modelled
    ? `Findings draw on local market conditions, demographics, infrastructure, lending policy, and forward-looking cash-flow projections to give a holistic view of suitability for a long-term investment strategy.`
    : `Findings draw on local market conditions, demographics, the planning controls mapped over the land and the infrastructure serving it, to give a view of the property's suitability and of the risks attached to its location.`);

  const para2Parts: string[] = [];
  if (scoreTxt) {
    para2Parts.push(`The property carries an overall investment score of <strong>${esc(scoreTxt)}</strong>, reflecting the weighted balance of location quality, financial performance, growth drivers, and risk indicators discussed in the chapters that follow.`);
  } else {
    para2Parts.push(`The chapters that follow examine the weighted balance of location quality, financial performance, growth drivers, and risk indicators that underpin our assessment.`);
  }
  if (cashflowTxt && modelled) para2Parts.push(`Indicative weekly cash flow tracks at <strong>${cashflowTxt}</strong> after holding costs, providing a baseline for the comparative scenarios and sensitivity tables that follow.`);
  para2Parts.push(modelled
    ? `Use this summary as orientation: detailed evidence, calculations, charts, and source attributions for every claim are set out across the remaining sections of the report.`
    : `Use this summary as orientation: the evidence, the retrieved planning and hazard readings, and the source attribution for every claim are set out across the remaining sections.`);
  // A companion note rather than silence: a reader who expected the modelling
  // needs to be told where it is, not left to conclude it was not done.
  if (contentPolicy.companionNote) para2Parts.push(esc(contentPolicy.companionNote));

  // Editor's Note — auto-generated, one-paragraph foreword that lifts 2-3 real
  // figures from the report. Pure presentation, no AI call.
  const editorsNoteBits: string[] = [];
  if (priceTxt && rentTxt) editorsNoteBits.push(`at <strong>${priceTxt}</strong> with assessed rent of <strong>${rentTxt}/wk</strong>`);
  else if (priceTxt) editorsNoteBits.push(`at <strong>${priceTxt}</strong>`);
  if (yieldTxt && modelled) editorsNoteBits.push(`gross yield <strong>${yieldTxt}</strong>`);
  if (scoreTxt) editorsNoteBits.push(`investment score <strong>${esc(scoreTxt)}</strong>`);
  const editorsNoteHtml = `
    <aside class="editors-note">
      <div class="en-eyebrow">Editor's Note</div>
      <p class="en-body">${esc(suburbLabel)} continues to sit inside our active research universe${
        editorsNoteBits.length ? ` — this dossier captures the subject ${editorsNoteBits.join(", ")}` : ""
      }. ${modelled
        ? "The pages that follow set out the location case, the financials, and the residual risks in equal measure, so you can weigh the opportunity on its merits rather than its narrative."
        : "The pages that follow set out the location case, what is mapped over the land, and the residual risks, so you can weigh the opportunity on its merits rather than its narrative."
      }</p>
      <div class="en-sig">— ${esc(String(advisorLine))}, ${esc(generated)}</div>
    </aside>
  `;

  const execSignal = priceTxt && rentTxt ? `${priceTxt} · ${rentTxt}/wk` : (priceTxt || rentTxt || null);
  const execWatch = (para2Parts.join(" ").match(/[^.!?]*\b(risk|vacancy|caution|watch|exposure|concern|soft)\b[^.!?]*[.!?]/i)?.[0] || "").trim() || null;
  const execTrend = yieldTxt && modelled ? `Yield ${yieldTxt}` : null;
  const execView = scoreTxt ? `Score ${scoreTxt}` : null;
  const execGlance = chapterGlanceHtmlFromValues("Executive Summary", [execSignal, execWatch ? execWatch.slice(0, 80) : null, execTrend, execView]);

  const executiveSummaryHtml = `
    <h2 id="ch-executive-summary" data-ch="1">Executive Summary</h2>
    ${execGlance}
    ${editorsNoteHtml}
    ${summaryKpiHtml || (kpiTiles ? `<div class="snapshot">${kpiTiles}</div>` : "")}
    ${scoreVisualsHtml}
    ${demographicVisualHtml}
    <p>${para1Parts.filter(Boolean).join(" ")}</p>
    <p>${para2Parts.filter(Boolean).join(" ")}</p>
  `;

  // Executive Summary is the first chapter — register it in the TOC and shift
  // every subsequent chapter's data-ch index up by one so the page numerals
  // line up with the TOC ordering.
  if (!toc.some((t) => t.id === "ch-executive-summary")) {
    toc.unshift({ id: "ch-executive-summary", title: "Executive Summary" });
    bodyWithHeroes = bodyWithHeroes.replace(/<h2([^>]*?)\sdata-ch="(\d+)"/gi, (_m, attrs, n) => {
      return `<h2${attrs} data-ch="${Number(n) + 1}"`;
    });
  }

  // Parse address tail for cover meta (Suburb, STATE Postcode).
  const addrTail = address.split(",").map((s: string) => s.trim()).filter(Boolean);
  const coverLocation = loc?.suburb && loc?.state
    ? `${loc.suburb}, ${loc.state}`
    : addrTail.length >= 2
      ? addrTail.slice(-2).join(", ")
      : address;

  // Foil-stamp overlay: radial gold highlight + diagonal sheen + subtle noise.
  // Pure SVG so it scales infinitely and prints crisp.
  const foilOverlaySvg = `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 210 297' preserveAspectRatio='xMidYMid slice'>
      <defs>
        <radialGradient id='hl' cx='28%' cy='18%' r='62%'>
          <stop offset='0%' stop-color='#f3d98a' stop-opacity='0.55'/>
          <stop offset='42%' stop-color='#b88a2c' stop-opacity='0.18'/>
          <stop offset='100%' stop-color='#000' stop-opacity='0'/>
        </radialGradient>
        <linearGradient id='sheen' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0%' stop-color='#fff' stop-opacity='0'/>
          <stop offset='48%' stop-color='#fff' stop-opacity='0.10'/>
          <stop offset='52%' stop-color='#fff' stop-opacity='0.18'/>
          <stop offset='56%' stop-color='#fff' stop-opacity='0'/>
        </linearGradient>
        <filter id='nz'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='2' seed='5'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.06 0'/></filter>
      </defs>
      <rect width='210' height='297' fill='url(%23hl)'/>
      <rect width='210' height='297' fill='url(%23sheen)'/>
      <rect width='210' height='297' filter='url(%23nz)'/>
    </svg>`)}`;
  // Loaded from the database, not fetched from a host. This used to be an
  // absolute `lovable.app` URL — a preview host — on a client-facing premium
  // PDF: every render made an outbound fetch the SSRF guard had to allow, a 404
  // printed a blank cover with nothing raised, and re-issuing an old report
  // depended on that host still serving that path. It then lived inlined in the
  // function source, which broke deploys for unrelated functions (see the note
  // at the top of this file). It is a `data:` URI either way by the time the
  // renderer sees it. See `scripts/reportDesign/buildDefaultAssets.ts`.
  const coverArtSrc = await loadHouseCoverArt();
  const coverBgImg = coverArtSrc
    ? `<img class="cover-bg" src="${coverArtSrc}" alt="" />`
    : "";
  const coverHtml = design.coverStyle === "image"
    ? `<section class="cover cover-clean">
        ${coverBgImg}
        <div class="cover-foil" style="background-image:url('${foilOverlaySvg}')"></div>
      </section>`
    : `<section class="cover cover-${design.coverStyle}">
        ${coverBgImg}
        <div class="cover-scrim"></div>
        <div class="cover-foil" style="background-image:url('${foilOverlaySvg}')"></div>
        <div class="cover-masthead">${esc(String(brandName).toUpperCase())}</div>
        <div class="cover-copy">
          <div class="cover-kicker">${esc(variantLabel)} · ${esc(generated)}</div>
          <h1>${esc(address)}</h1>
          <div class="cover-rule"></div>
          <div class="cover-meta">${esc(coverLocation)}</div>
          <div class="cover-prepared">Prepared by <strong>${esc(String(advisorLine))}</strong></div>
        </div>
        <div class="cover-edition">VOL. ${new Date().getFullYear()} · ED. ${String(new Date().getMonth() + 1).padStart(2, "0")}</div>
      </section>`;

  const designOverrideStyles = `
    /* ── Front-end controlled WeasyPrint design layer ─────────────────── */
    @page { margin: ${pageMargin}; background: ${palette.paper}; }
    @page :left  { margin: ${pageMargin}; }
    @page :right { margin: ${pageMargin}; }
    html, body {
      background: ${palette.paper};
      color: ${palette.ink};
      font-size: ${bodyPt}pt;
      line-height: ${design.density === "compact" ? "1.48" : design.density === "spacious" ? "1.72" : "1.6"};
    }
    p { margin-bottom: ${paragraphGap}; text-align: ${design.justifyText ? "justify" : "left"}; }
    strong, em, i, td { color: ${palette.ink}; }
    a, a.contact-link, a.ext-link { color: ${palette.accentSoft}; border-bottom-color: ${palette.accentSoft}; }
    h1, h2, h3 {
      background: linear-gradient(135deg, ${palette.heading} 0%, ${palette.heading2} 62%, ${palette.accent} 100%);
      -webkit-background-clip: text; background-clip: text;
    }
    h2 { border-bottom-color: ${palette.accent}; padding-bottom: ${design.density === "spacious" ? "14pt" : "9pt"}; }
    h2::before { ${design.showSectionNumbers ? `color: ${palette.accent}; -webkit-text-fill-color: ${palette.accent};` : "content: none; display: none;"} }
    h2 + p::first-letter { ${design.showDropCaps ? `color: ${palette.accent};` : "font-size: inherit; float: none; padding: 0; color: inherit; font-family: inherit; font-weight: inherit;"} }
    h3 { border-left-color: ${palette.accent}; }
    h4, .insight-box .insight-label, li.insight-li .insight-label-inline { color: ${palette.accentSoft}; }
    ul li::before { background: ${palette.accent}; }
    blockquote, .insight-box, li.insight-li, .stat-block, aside.pull-quote, aside.sidenote {
      background: ${palette.paperAlt};
      border-color: ${palette.accent};
      box-shadow: inset 0 0 0 ${Math.max(0.25, intensity * 0.8)}pt ${withAlpha(palette.accent, 0.13)};
    }
    .cover { background: ${palette.cover}; }
    .cover-scrim {
      position: absolute; inset: 0;
      background: linear-gradient(115deg, ${withAlpha(palette.cover, 0.95)} 0%, ${withAlpha(palette.cover, 0.85)} 42%, ${withAlpha(palette.cover, 0.25)} 100%);
    }
    .cover-copy {
      position: absolute; left: 18mm; right: 18mm; bottom: ${design.coverStyle === "editorial" ? "34mm" : "26mm"};
      color: ${THEME.text}; z-index: 2;
    }
    .cover-copy h1 {
      max-width: ${design.coverStyle === "editorial" ? "150mm" : "128mm"};
      font-size: ${design.coverStyle === "editorial" ? "44pt" : "34pt"};
      line-height: 1.05; margin: 0;
      color: ${THEME.text}; -webkit-text-fill-color: ${THEME.text}; background: none;
      text-shadow: 0 1.5pt 10pt rgba(0,0,0,${0.22 + intensity * 0.32});
    }
    .cover-kicker, .cover-meta {
      font-family: 'Inter', sans-serif; text-transform: uppercase; letter-spacing: .22em;
      color: ${palette.accent}; font-weight: 700;
    }
    .cover-kicker { font-size: 8.2pt; margin-bottom: 10mm; }
    .cover-meta { font-size: 8.5pt; margin-top: 8mm; color: ${THEME.muted}; }
    .cover-editorial .cover-copy { top: 34mm; bottom: auto; }
    .cover-editorial .cover-copy::after {
      content: ""; display: block; width: ${40 + intensity * 40}mm; height: 1pt; background: ${palette.accent}; margin-top: 13mm;
    }
    ${design.chapterStyle === "opener_band" ? `
      h2 {
        margin: 0 -8mm 12pt; padding: 15pt 10mm 13pt;
        background: linear-gradient(110deg, ${palette.heading} 0%, ${palette.heading2} 100%);
        color: ${THEME.text}; -webkit-text-fill-color: ${THEME.text}; border: 0;
      }
      h2::before { color: ${palette.accent}; -webkit-text-fill-color: ${palette.accent}; }
    ` : ""}
    ${design.chapterStyle === "minimal" ? `
      h2 { font-size: 22pt; border-bottom: 0.35pt solid ${palette.muted}; background: none; color: ${palette.heading}; -webkit-text-fill-color: ${palette.heading}; }
      h2::before { font-size: 12pt; margin-right: 12pt; }
      h3 { background: none; color: ${palette.heading}; -webkit-text-fill-color: ${palette.heading}; border-left-width: 1pt; }
    ` : ""}
    ${design.tableStyle === "ledger" ? `
      table { background: ${palette.paper}; border-top: 1pt solid ${palette.ink}; border-bottom: 1pt solid ${palette.ink}; }
      th { background: transparent; color: ${palette.ink}; border-bottom: 1pt solid ${palette.ink}; }
      tr:nth-child(even) td { background: transparent; }
      td { border-bottom: 0.35pt solid ${withAlpha(palette.muted, 0.4)}; }
    ` : ""}
    ${design.tableStyle === "minimal" ? `
      table { background: transparent; font-size: 8.2pt; }
      th { background: ${palette.paperAlt}; color: ${palette.ink}; }
      th, td { border-bottom: 0.25pt solid ${withAlpha(palette.muted, 0.33)}; padding: 4.2pt 5.5pt; }
      tr:nth-child(even) td { background: transparent; }
    ` : ""}
    figure.vis-figure, figure.auto-chart {
      background: ${palette.paperAlt}; border-color: ${withAlpha(palette.accent, 0.4)};
      padding: ${12 + Math.round(intensity * 8)}pt ${14 + Math.round(intensity * 7)}pt ${9 + Math.round(intensity * 4)}pt;
    }
  `;

  const styles = `
    /* ── Paged-media foundation ──────────────────────────────────────── */
    @page {
      size: A4;
      margin: 22mm 18mm 22mm 18mm;
      background: ${THEME.paper};
      @top-left {
        content: string(chapter);
        font-family: 'Inter', sans-serif;
        font-size: 7.5pt; color: ${THEME.inkMuted};
        letter-spacing: .14em; text-transform: uppercase;
        font-variant-numeric: oldstyle-nums proportional-nums;
      }
      @top-right {
        content: "${cssString(address)}";
        font-family: 'Cormorant Garamond', serif;
        font-style: italic; font-size: 9pt; color: ${THEME.inkMuted};
      }
      @bottom-left {
        content: "${cssString(brandName)}";
        font-family: 'Inter', sans-serif;
        font-size: 7.5pt; color: ${THEME.inkMuted};
        letter-spacing: .14em; text-transform: uppercase;
      }
      @bottom-center {
        content: "";
        border-top: 0.3pt solid ${THEME.rule};
        width: 24pt; height: 0;
        margin: 0 auto;
      }
      @bottom-right {
        content: counter(page) " · " counter(pages);
        font-family: 'Playfair Display', serif;
        font-style: italic; font-size: 9pt; color: ${THEME.ink};
        font-variant-numeric: oldstyle-nums proportional-nums;
      }
    }
    /* Slightly asymmetric gutter for a real bound-document feel. */
    @page :left  { margin-left: 16mm; margin-right: 20mm; }
    @page :right { margin-left: 20mm; margin-right: 16mm; }

    @page cover {
      margin: 0;
      background: ${THEME.bg};
      @top-left { content: none; } @top-right { content: none; }
      @bottom-left { content: none; } @bottom-right { content: none; }
      @bottom-center { content: none; }
    }
    @page disclaimer-page {
      margin: 0;
      background: #141414;
      @top-left { content: none; } @top-right { content: none; }
      @bottom-left { content: none; } @bottom-right { content: none; }
      @bottom-center { content: none; }
    }
    @page toc {
      @top-left { content: "Contents"; }
      @top-right { content: none; }
    }
    /* Chapter opener — first page of each chapter suppresses the running header. */
    @page chapter-opener {
      @top-left { content: none; }
      @top-right { content: none; }
    }
    /* CSS Paged Media footnotes (WeasyPrint native). The @footnote area sits
       above the bottom margin box, divided by a hairline rule. */
    @page {
      @footnote {
        border-top: 0.5pt solid ${THEME.rule};
        padding-top: 4pt;
        margin-top: 6pt;
        font-size: 7.8pt;
        line-height: 1.45;
        color: ${THEME.inkMuted};
        font-family: 'Inter', 'Helvetica', sans-serif;
      }
    }

    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      background: ${THEME.paper};
      color: ${THEME.ink};
      font-family: 'Inter', 'Helvetica', sans-serif;
      font-size: 9.8pt;
      line-height: 1.6;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      /* OpenType: kerning, ligatures, contextual alternates. */
      font-feature-settings: "kern" 1, "liga" 1, "calt" 1, "ss01" 1;
      font-variant-numeric: oldstyle-nums proportional-nums;
      text-rendering: geometricPrecision;
    }

    body { counter-reset: section; }

    h1, h2, h3 {
      font-family: 'Playfair Display', 'Georgia', serif;
      margin: 0 0 .45em; page-break-after: avoid; break-after: avoid;
      background: ${NAVY_GRADIENT};
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: transparent;
      hyphens: manual;
      font-feature-settings: "kern" 1, "liga" 1, "dlig" 1, "swsh" 1;
    }
    h4 { font-family: 'Playfair Display', 'Georgia', serif; color: ${THEME.navy}; margin: 0 0 .45em; page-break-after: avoid; break-after: avoid; }
    h1 { font-size: 36pt; font-weight: 800; line-height: 1.08; letter-spacing: -0.01em; bookmark-level: 1; bookmark-label: content(text); }
    h2 {
      counter-increment: section;
      string-set: chapter content(text);
      font-family: 'Playfair Display', 'Georgia', serif;
      font-size: 40pt; font-weight: 700; letter-spacing: -0.012em; line-height: 1.04;
      margin: 0 0 24pt;
      padding: 96pt 0 22pt 0;
      border-bottom: none;
      display: block;
      position: relative;
      /* Each chapter starts on a fresh page — editorial polish. */
      break-before: page;
      page-break-before: always;
      bookmark-level: 1;
      bookmark-label: content(text);
      bookmark-state: open;
      page: chapter-opener;
      /* Gold underline rule sits below the title, not the eyebrow. */
    }
    /* The very first h2 of the body should not force an extra blank page after the TOC. */
    section.body-page:first-of-type > h2:first-child { break-before: auto; page-break-before: auto; }

    /* Editorial chapter opener: huge ghosted gold numeral, mono eyebrow above title,
       gold hairline beneath. Replaces the old inline ::before numeral. */
    h2::before {
      content: "CHAPTER " counter(section, decimal-leading-zero);
      display: block;
      position: absolute;
      top: 50pt; left: 0;
      font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
      font-weight: 500; font-style: normal;
      font-size: 9pt;
      letter-spacing: 0.22em;
      color: ${THEME.gold};
      -webkit-text-fill-color: ${THEME.gold};
      background: none;
      -webkit-background-clip: initial;
      background-clip: initial;
      margin: 0; padding: 0;
      font-variant-numeric: lining-nums tabular-nums;
    }
    h2::after {
      content: counter(section, decimal-leading-zero);
      position: absolute;
      top: 18pt; right: -6pt;
      font-family: 'Playfair Display', Georgia, serif;
      font-weight: 700; font-style: italic;
      font-size: 180pt;
      line-height: 1;
      color: transparent;
      -webkit-text-fill-color: transparent;
      -webkit-text-stroke: 1.1pt ${THEME.gold};
      opacity: 0.32;
      letter-spacing: -0.04em;
      pointer-events: none;
      z-index: 0;
    }
    h2 > * { position: relative; z-index: 1; }
    /* Gold hairline that sits *under* the title (not the eyebrow). */
    h2 + p, h2 + .insight, h2 + .compare-card, h2 + figure, h2 + ul, h2 + ol, h2 + .standfirst {
      border-top: 1.4pt solid ${THEME.gold};
      padding-top: 14pt;
      margin-top: 28pt;
    }
    /* Editorial drop cap on the first paragraph of each chapter. */
    h2 + p::first-letter {
      font-family: 'Playfair Display', Georgia, serif;
      font-weight: 700;
      font-size: 54pt;
      line-height: 0.86;
      float: left;
      padding: 4pt 8pt 0 0;
      color: ${THEME.gold};
      -webkit-text-fill-color: ${THEME.gold};
      background: none;
      -webkit-background-clip: initial;
    }
    /* Tasteful end-of-chapter mark: a centred gold lozenge before the next h2. */
    h2:not(:first-of-type)::before { /* keep eyebrow; mark is handled separately below */ }
    h3 {
      font-size: 17pt; font-weight: 600; margin-top: 18pt;
      padding-left: 10pt;
      border-left: 2.5pt solid ${THEME.gold};
      bookmark-level: 2; bookmark-label: content(text);
    }
    h4 {
      font-family: 'Inter', sans-serif;
      font-size: 10pt; font-weight: 700;
      color: ${THEME.goldSoft};
      text-transform: uppercase; letter-spacing: .15em;
      margin-top: 14pt;
      bookmark-level: 3; bookmark-label: content(text);
    }
    p {
      margin: 0 0 .72em;
      orphans: 3; widows: 3;
      hyphens: auto;
      -webkit-hyphens: auto;
      hyphenate-limit-chars: 8 4 4;
      text-align: justify;
      text-justify: inter-word;
    }
    a { color: ${THEME.goldSoft}; text-decoration: none; }
    strong { color: ${THEME.ink}; font-weight: 700; }
    em, i { color: ${THEME.ink}; font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 1.05em; }

    /* Drop-cap on the first paragraph after each chapter title — editorial signature. */
    h2 + p::first-letter {
      font-family: 'Playfair Display', serif;
      font-weight: 800;
      font-size: 3.6em;
      line-height: 0.85;
      float: left;
      padding: 4pt 8pt 0 0;
      color: ${THEME.gold};
      font-feature-settings: "kern" 1, "dlig" 1;
    }

    h2 + p {
      font-family: 'Inter', 'Helvetica', sans-serif;
      font-size: 9.8pt; line-height: 1.6;
      color: ${THEME.ink}; margin-bottom: .72em;
    }

    .insight-box {
      margin: 14pt 0;
      padding: 12pt 16pt 10pt;
      background: ${THEME.paperAlt};
      border-left: 3pt solid ${THEME.gold};
      border-radius: 2pt;
      box-shadow: inset 0 0 0 0.5pt ${THEME.rule};
      page-break-inside: avoid;
    }
    .insight-box .insight-label {
      font-family: 'Inter', sans-serif;
      font-size: 10.5pt; font-weight: 700;
      color: ${THEME.goldSoft};
      text-transform: uppercase; letter-spacing: .16em;
      margin: 0 0 8pt;
      display: flex; align-items: center; gap: 10pt;
    }
    .insight-box .insight-label::before {
      content: ""; display: inline-block;
      width: 18pt; height: 1.2pt; background: ${THEME.gold};
    }
    .insight-box p:last-child,
    .insight-box ul:last-child,
    .insight-box ol:last-child { margin-bottom: 0; }
    .insight-box p,
    .insight-box li { font-size: 9.8pt; line-height: 1.55; }

    /* Inline list-item callout (Form 3): "What This Means:" inside a <li> */
    li.insight-li {
      list-style: none;
      padding: 10pt 14pt 9pt 14pt;
      margin: 8pt 0;
      background: ${THEME.paperAlt};
      border-left: 3pt solid ${THEME.gold};
      border-radius: 2pt;
      border-bottom: none !important;
      box-shadow: inset 0 0 0 0.5pt ${THEME.rule};
      page-break-inside: avoid;
    }
    li.insight-li::before { display: none !important; content: none !important; }
    li.insight-li .insight-label-inline {
      display: inline-block;
      font-family: 'Inter', sans-serif;
      font-size: 8.5pt; font-weight: 700;
      color: ${THEME.goldSoft};
      text-transform: uppercase; letter-spacing: .14em;
      margin-right: 8pt;
    }
    li.insight-li .insight-li-body {
      font-size: 9.8pt; line-height: 1.55; color: ${THEME.ink};
    }

    ul, ol { margin: 4pt 0 .9em 0; padding: 0; list-style: none; }
    li {
      position: relative;
      padding: 3pt 0 3pt 18pt;
      margin-bottom: 1pt;
      border-bottom: 0.25pt dotted ${THEME.rule};
    }
    ul li::before {
      content: "";
      position: absolute; left: 0; top: 10pt;
      width: 5pt; height: 5pt;
      background: ${THEME.gold};
      transform: rotate(45deg);
    }
    ol { counter-reset: ol; }
    ol > li { counter-increment: ol; }
    ol > li::before {
      content: counter(ol, decimal-leading-zero);
      position: absolute; left: 0; top: 3pt;
      font-family: 'Playfair Display', serif;
      font-weight: 700; font-size: 9pt;
      color: ${THEME.goldSoft};
    }
    .toc ol, .toc ol > li { counter-reset: none; counter-increment: none; }
    .toc ol > li::before { content: none !important; display: none !important; }

    blockquote {
      margin: 14pt 0;
      padding: 14pt 18pt 14pt 38pt;
      background: ${THEME.paperAlt};
      border-left: 3pt solid ${THEME.gold};
      color: ${THEME.ink};
      font-family: 'Cormorant Garamond', serif;
      font-size: 13.5pt; font-style: italic;
      line-height: 1.45; position: relative;
      page-break-inside: avoid;
    }
    blockquote::before {
      content: "\\201C";
      font-family: 'Playfair Display', serif;
      font-style: normal; font-weight: 800;
      font-size: 48pt; line-height: 1;
      color: ${THEME.gold};
      position: absolute; left: 10pt; top: 6pt;
    }

    code { background: ${THEME.paperAlt}; padding: 1pt 4pt; border-radius: 2pt; font-size: 8.5pt; color: ${THEME.goldSoft}; }

    table {
      width: 100%; border-collapse: collapse; margin: 10pt 0 14pt;
      font-size: 8.5pt; background: #FFFDF8;
      page-break-inside: auto;
      table-layout: auto;
      font-variant-numeric: tabular-nums lining-nums;
      font-feature-settings: "tnum" 1, "lnum" 1, "kern" 1;
    }
    tr { page-break-inside: avoid; page-break-after: auto; }
    tr:nth-child(even) td { background: ${THEME.paperAlt}; }
    th, td {
      border-bottom: 0.5pt solid ${THEME.rule};
      padding: 5.5pt 7pt;
      text-align: left; vertical-align: top;
      word-break: normal; overflow-wrap: break-word;
      hyphens: auto;
    }
    th {
      background: ${THEME.ink}; color: ${THEME.gold};
      font-family: 'Inter', sans-serif;
      font-weight: 700;
      text-transform: uppercase; letter-spacing: .08em;
      font-size: 7pt; border-bottom: none;
    }
    td { color: ${THEME.ink}; }
    /* Numeric columns: right-align cells whose content reads numeric. */
    td.num, th.num, td:last-child, th:last-child { text-align: right; font-variant-numeric: tabular-nums lining-nums; }
    td:first-child, th:first-child {
      font-weight: 600;
      width: 1%;
      white-space: nowrap;
      text-align: left;
    }
    /* Allow long first-column labels (>22 chars) to wrap naturally instead of being broken mid-word */
    td:first-child { white-space: normal; min-width: 80pt; max-width: 180pt; }
    hr { border: 0; border-top: 0.5pt solid ${THEME.rule}; margin: 18pt 0; }

    /* Rating pills */
    .pill {
      display: inline-block;
      padding: 2pt 7pt;
      border-radius: 999pt;
      font-family: 'Inter', sans-serif;
      font-weight: 600; font-size: 7.5pt;
      letter-spacing: .04em;
      line-height: 1.1;
      white-space: nowrap;
    }
    .pill-good { background: ${THEME.goodBg}; color: ${THEME.good}; }
    .pill-warn { background: ${THEME.warnBg}; color: ${THEME.warn}; }
    .pill-risk { background: ${THEME.riskBg}; color: ${THEME.risk}; }
    .pill-neutral { background: ${THEME.neutralBg}; color: ${THEME.neutralInk}; }

    /* ── Cover ── */
    /* ── Cover (standard cover image, full-bleed) ── */
    .cover {
      page: cover;
      page-break-after: always;
      width: 210mm; height: 297mm;
      margin: 0; padding: 0;
      position: relative;
      background: #0a0a0a;
      overflow: hidden;
    }
    .cover img.cover-bg {
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      object-fit: cover;
      display: block;
    }

    /* ── Disclaimer / Contact closing page ── */
    .disclaimer-page {
      page: disclaimer-page;
      page-break-before: always;
      width: 210mm; height: 297mm;
      margin: 0; padding: 22mm 20mm 20mm;
      background: #141414;
      color: #BF9B50;
      position: relative;
      font-family: 'Inter', sans-serif;
    }
    .disclaimer-page .company-main { font-size: 28pt; font-weight: 800; letter-spacing: .02em; color: #BF9B50; line-height: 1.05; }
    .disclaimer-page .company-sub { font-size: 16pt; font-weight: 400; color: #BF9B50; margin-top: 4pt; }
    .disclaimer-page .contact-heading { margin-top: 18mm; font-size: 14pt; font-weight: 700; color: #BF9B50; letter-spacing: .04em; }
    .disclaimer-page .contact-list { margin-top: 12pt; display: block; }
    .disclaimer-page .contact-row { display: flex; align-items: baseline; gap: 14pt; padding: 5pt 0; border-bottom: 0.4pt solid rgba(191,155,80,0.18); }
    .disclaimer-page .contact-row:last-child { border-bottom: none; }
    .disclaimer-page .contact-row .label { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; color: #BF9B50; min-width: 70pt; }
    .disclaimer-page .contact-row .value { font-size: 10pt; font-weight: 400; color: #E8D7A8; word-break: break-word; }
    .disclaimer-page .disclaimer-body {
      position: absolute;
      left: 20mm; right: 20mm; bottom: 20mm;
      font-size: 8.5pt;
      line-height: 1.55;
      color: #999999;
      font-weight: 400;
    }
    .disclaimer-page .disclaimer-body p { margin: 0 0 6pt; }

    /* ── Table of Contents (real page numbers via target-counter) ── */
    .toc { page: toc; page-break-after: always; padding-top: 6mm; }
    .toc h1 { bookmark-level: 1; bookmark-label: "Contents"; }
    .toc .toc-eyebrow { font-family: 'Inter', sans-serif; font-size: 8pt; color: ${THEME.goldSoft}; letter-spacing: .25em; text-transform: uppercase; margin-bottom: 4mm; }
    .toc h1 { font-family: 'Playfair Display', serif; font-size: 38pt; font-weight: 800; margin: 0 0 12mm; letter-spacing: -0.01em; }
    .toc ol { counter-reset: tocnum; list-style: none; padding: 0; margin: 0; }
    .toc ol li {
      counter-increment: tocnum;
      padding: 9pt 0; border-bottom: 0.5pt dotted ${THEME.rule};
      font-family: 'Inter', sans-serif; font-size: 11pt;
      color: ${THEME.ink};
      page-break-inside: avoid;
    }
    .toc ol li a {
      color: ${THEME.ink}; text-decoration: none;
      display: grid;
      grid-template-columns: 46pt 1fr auto 40pt;
      align-items: baseline;
      column-gap: 10pt;
    }
    .toc ol li a::before {
      content: counter(tocnum, decimal-leading-zero);
      font-family: 'Playfair Display', serif;
      font-style: italic; font-weight: 500;
      color: ${THEME.goldSoft}; font-size: 13pt;
      text-align: left;
      font-variant-numeric: lining-nums tabular-nums;
    }
    .toc ol li .title { font-family: 'Playfair Display', serif; font-weight: 600; font-size: 14pt; min-width: 0; overflow-wrap: break-word; }
    .toc ol li .dots { border-bottom: 0.5pt dotted ${THEME.rule}; min-width: 30pt; height: 0; transform: translateY(-3pt); }
    /* WeasyPrint: real cross-referenced page numbers — resolved at paginate time. */
    .toc ol li a::after {
      content: target-counter(attr(href), page);
      font-family: 'Playfair Display', serif;
      font-weight: 700; color: ${THEME.ink}; font-size: 12pt;
      text-align: right;
      font-variant-numeric: lining-nums tabular-nums;
    }

    /* ── Snapshot KPI grid ── */
    .snapshot {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 9pt;
      margin: 10pt 0 16pt;
    }
    .kpi-strip {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 9pt;
      margin: 14pt 0 18pt;
      page-break-inside: avoid;
    }
    .kpi-strip-inline .big-number-card {
      min-height: 92pt;
      overflow: hidden;
    }
    .kpi {
      background: linear-gradient(180deg, #FFFDF8 0%, #FBF6EA 100%);
      border: 0.5pt solid ${THEME.rule};
      border-top: 2pt solid ${THEME.gold};
      padding: 12pt 13pt 13pt;
      page-break-inside: avoid;
      position: relative;
    }
    .kpi-label { font-family: 'Inter', sans-serif; font-size: 7pt; text-transform: uppercase; letter-spacing: .14em; color: ${THEME.inkMuted}; margin-bottom: 6pt; font-weight: 600; }
    .kpi-value {
      font-family: 'Playfair Display', serif;
      font-weight: 700; font-size: 19pt;
      color: ${THEME.ink}; line-height: 1;
      font-variant-numeric: lining-nums tabular-nums;
      font-feature-settings: "lnum" 1, "tnum" 1, "kern" 1;
    }
    .kpi-delta {
      margin-top: 5pt;
      font-family: 'Inter', sans-serif;
      font-size: 8pt;
      font-weight: 700;
      color: ${THEME.goldSoft};
      letter-spacing: .06em;
    }
    .kpi-inline-spark { margin-top: 7pt; height: 24pt; }
    .kpi-inline-spark svg { width: 100%; height: 24pt; display: block; }

    .score-card {
      background: linear-gradient(135deg, #FFFDF8 0%, #F4ECD8 100%);
      border: 0.5pt solid ${THEME.rule};
      padding: 18pt 20pt;
      margin: 12pt 0 18pt;
      display: flex; align-items: center; gap: 20pt;
      page-break-inside: avoid;
    }
    .score-card .ring {
      width: 86pt; height: 86pt; border-radius: 50%;
      background: conic-gradient(${THEME.gold} 0%, ${THEME.gold} var(--p, 0%), ${THEME.paperAlt} var(--p, 0%));
      display: flex; align-items: center; justify-content: center;
      font-family: 'Playfair Display', serif; font-weight: 800; font-size: 26pt; color: ${THEME.ink};
      position: relative; flex-shrink: 0;
    }
    .score-card .ring::after { content: ""; position: absolute; inset: 7pt; border-radius: 50%; background: #FFFDF8; }
    .score-card .ring span { position: relative; z-index: 1; }
    .score-card .meta { flex: 1; }
    .score-card .band { color: ${THEME.goldSoft}; text-transform: uppercase; letter-spacing: .18em; font-size: 8.5pt; font-weight: 700; font-family: 'Inter', sans-serif; }
    .score-card h3 { border: none; padding: 0; font-size: 16pt; margin: 4pt 0 4pt; }

    .body-page { page-break-before: auto; }

    .disclaimer {
      margin-top: 28pt;
      padding: 14pt 16pt;
      border: 0.5pt solid ${THEME.rule};
      background: ${THEME.paperAlt};
      font-size: 8pt;
      color: ${THEME.inkMuted};
      page-break-inside: avoid;
    }
    .disclaimer h4 { margin-top: 0; color: ${THEME.inkMuted}; }

    /* ── Premium auto-injected charts ── */
    .chart-wrap {
      margin: 20pt 0 24pt;
      padding: 4pt 0 0;
      background: transparent;
      border: 0;
      page-break-inside: avoid;
    }
    .auto-chart { margin: 0; text-align: center; page-break-inside: avoid; }
    .auto-chart img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 0 auto;
      background: #FFFDF8;
      border-radius: 2pt;
    }
    .auto-chart figcaption {
      margin-top: 8pt;
      font-family: 'Inter', sans-serif;
      font-size: 7.6pt;
      letter-spacing: .14em;
      text-transform: uppercase;
      color: ${THEME.inkMuted};
      text-align: center;
    }
    .chart-wrap > table {
      margin-top: 14pt;
      font-size: 8.2pt;
      border-top: 0.5pt solid ${THEME.rule};
    }
    .chart-wrap > table th { background: transparent; color: ${THEME.inkMuted}; font-size: 7.5pt; letter-spacing: .12em; }
    .financial-charts { page-break-after: auto; }
    .financial-chart { margin-bottom: 22pt; }
    .chart-title {
      font-family: 'Playfair Display', 'Georgia', serif;
      font-size: 13pt;
      font-weight: 700;
      color: ${THEME.ink};
      margin: 0 0 10pt;
      padding-bottom: 6pt;
      border-bottom: 0.6pt solid ${THEME.rule};
      letter-spacing: -0.005em;
    }

    /* ── KPI sparklines ── */
    .kpi-spark { margin-top: 8pt; height: 28pt; opacity: 0.95; }
    .kpi-spark img { width: 100%; height: 100%; object-fit: contain; display: block; }

    /* ── Compare cards (Strengths/Watch, Pros/Cons) ── */
    .compare-card {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12pt;
      margin: 16pt 0;
      page-break-inside: avoid;
    }
    .compare-col {
      padding: 13pt 15pt 11pt;
      border-radius: 3pt;
      border: 0.5pt solid ${THEME.rule};
      background: #FFFDF8;
    }
    .compare-pos { background: linear-gradient(180deg, #ECF4E1 0%, #F4F8EC 100%); border-left: 3pt solid ${THEME.good}; }
    .compare-neg { background: linear-gradient(180deg, #F5E0D9 0%, #F9EBE5 100%); border-left: 3pt solid ${THEME.risk}; }
    .compare-head {
      font-family: 'Inter', sans-serif;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .18em;
      font-size: 7.5pt;
      margin-bottom: 8pt;
      padding-bottom: 5pt;
      border-bottom: 0.5pt solid ${THEME.rule};
    }
    .compare-pos .compare-head { color: ${THEME.good}; }
    .compare-neg .compare-head { color: ${THEME.risk}; }
    .compare-col ul { margin: 0; padding: 0; }
    .compare-col li { padding-left: 16pt; border-bottom: 0.25pt dotted ${THEME.rule}; font-size: 9pt; }
    .compare-pos li::before { background: ${THEME.good}; }
    .compare-neg li::before { background: ${THEME.risk}; }

    /* ── Process timeline ── */
    ol.timeline {
      counter-reset: none;
      list-style: none;
      padding: 0;
      margin: 16pt 0;
    }
    ol.timeline li {
      display: grid;
      grid-template-columns: 64pt 1fr;
      gap: 14pt;
      padding: 12pt 0;
      border-bottom: 0.5pt solid ${THEME.rule};
      page-break-inside: avoid;
      counter-increment: none;
    }
    ol.timeline li::before { content: none; }
    ol.timeline .step-no {
      font-family: 'Playfair Display', serif;
      font-weight: 800;
      font-style: italic;
      color: ${THEME.goldSoft};
      font-size: 15pt;
      line-height: 1.1;
      padding-top: 2pt;
      border-right: 1.5pt solid ${THEME.gold};
      padding-right: 10pt;
    }
    ol.timeline .step-title {
      font-family: 'Playfair Display', serif;
      font-weight: 700;
      font-size: 12.5pt;
      margin-bottom: 4pt;
      color: ${THEME.ink};
    }
    ol.timeline .step-body { font-size: 9.5pt; }
    ol.timeline .step-body p { margin-bottom: 4pt; }

    /* ── Chapter hero illustrations (placement-driven) ── */
    .chapter-hero {
      margin: 18pt 0 16pt;
      page-break-inside: avoid;
      page-break-after: avoid;
      position: relative;
      overflow: hidden;
    }
    .chapter-hero img {
      display: block;
      width: 100%;
      height: 100%;
    }
    .chapter-hero.hero-rounded { border-radius: 8pt; }
    .chapter-hero.hero-flush { border-radius: 0; }

    /* width modes */
    .chapter-hero.hero-w-content { width: auto; }
    .chapter-hero.hero-w-bleed { margin-left: -17mm; margin-right: -17mm; width: 210mm; border-radius: 0; }

    /* height modes — fixed pt heights so image always fills the frame */
    .chapter-hero.hero-h-compact  { height: 110pt; }
    .chapter-hero.hero-h-standard { height: 170pt; }
    .chapter-hero.hero-h-tall     { height: 260pt; }
    .chapter-hero.hero-h-full {
      height: 257mm;
      margin: 0 -17mm;
      width: 210mm;
      border-radius: 0;
      page-break-before: always;
      page-break-after: always;
    }

    /* fit + focal */
    .chapter-hero.hero-fit-cover img   { object-fit: cover; }
    .chapter-hero.hero-fit-contain img { object-fit: contain; background: ${THEME.paperAlt}; }
    .chapter-hero.hero-focal-top img    { object-position: center top; }
    .chapter-hero.hero-focal-center img { object-position: center center; }
    .chapter-hero.hero-focal-bottom img { object-position: center bottom; }

    /* ──────────────────────────────────────────────────────────────────
       Editorial primitives (Tier 2 — pull-quotes, sidenotes, columns,
       custom SVG visualisations, footnotes + cross-references)
       ────────────────────────────────────────────────────────────────── */

    /* Pull-quote — full-bleed editorial highlight. */
    aside.pull-quote {
      margin: 22pt -8mm 22pt -8mm;
      padding: 18pt 28pt 16pt 60pt;
      background: linear-gradient(180deg, ${THEME.paperAlt} 0%, ${THEME.paper} 100%);
      border-top: 0.5pt solid ${THEME.rule};
      border-bottom: 0.5pt solid ${THEME.rule};
      position: relative;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    aside.pull-quote::before {
      content: "\\201C";
      position: absolute; left: 18pt; top: 4pt;
      font-family: 'Playfair Display', serif;
      font-weight: 800; font-size: 72pt; line-height: 1;
      color: ${THEME.gold};
    }
    aside.pull-quote p {
      margin: 0;
      font-family: 'Cormorant Garamond', 'Playfair Display', serif;
      font-style: italic; font-weight: 500;
      font-size: 18pt; line-height: 1.35;
      color: ${THEME.ink};
      text-align: left; hyphens: none;
      font-feature-settings: "kern" 1, "liga" 1, "dlig" 1;
    }

    /* Side-note — hangs in the right margin (gutter) for editorial commentary. */
    aside.sidenote {
      float: right;
      width: 38mm;
      margin: 4pt -12mm 8pt 12pt;
      padding: 9pt 10pt 8pt;
      background: ${THEME.paperAlt};
      border-left: 2pt solid ${THEME.goldSoft};
      font-family: 'Inter', sans-serif;
      font-size: 8.2pt;
      line-height: 1.5;
      color: ${THEME.inkMuted};
      page-break-inside: avoid;
      break-inside: avoid;
    }
    aside.sidenote p { margin: 0; }
    aside.sidenote::before {
      content: "NOTE";
      display: block;
      font-weight: 700; font-size: 7pt;
      letter-spacing: .18em;
      color: ${THEME.goldSoft};
      margin-bottom: 4pt;
    }

    /* Two-column flow — multi-column body for dense narrative sections. */
    .two-col {
      column-count: 2;
      column-gap: 14pt;
      column-rule: 0.4pt solid ${THEME.rule};
      orphans: 3; widows: 3;
      margin: 12pt 0;
    }
    .two-col h3, .two-col h4 { column-span: all; }
    .two-col p { margin-top: 0; }

    /* ── Custom SVG visualisations (gauge, waterfall, heatmap, wheel) ── */
    figure.vis-figure {
      margin: 16pt 0 20pt;
      padding: 14pt 16pt 10pt;
      background: ${THEME.paper};
      border: 0.4pt solid ${THEME.rule};
      border-radius: 4pt;
      box-shadow: 0 1pt 0 rgba(40,28,10,0.04);
      page-break-inside: avoid;
      break-inside: avoid;
      text-align: center;
    }
    figure.vis-figure svg {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 0 auto;
    }
    figure.vis-figure figcaption {
      margin-top: 8pt;
      font-family: 'Inter', sans-serif;
      font-size: 7.8pt;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: ${THEME.inkMuted};
    }

    /* ── At-a-glance chapter opener strip ── */
    .glance-strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120pt, 1fr));
      margin: 14pt 0 18pt;
      border-top: 0.6pt solid ${THEME.gold};
      border-bottom: 0.6pt solid ${THEME.gold};
      background: ${THEME.paper};
      page-break-inside: avoid;
    }
    .glance-cell {
      padding: 10pt 12pt;
      border-right: 0.4pt dotted ${THEME.rule};
      font-family: 'Inter', sans-serif;
      font-size: 9pt;
      line-height: 1.35;
      color: ${THEME.ink};
    }
    .glance-cell:last-child { border-right: none; }
    .glance-sym {
      display: block;
      font-size: 14pt;
      color: ${THEME.gold};
      margin-bottom: 3pt;
      line-height: 1;
    }
    .glance-text { display: block; }
    .glance-label {
      display: block;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 7pt;
      letter-spacing: .14em;
      text-transform: uppercase;
      color: ${THEME.inkMuted};
      margin-bottom: 2pt;
    }
    .glance-value {
      display: block;
      font-family: 'Inter', sans-serif;
      font-size: 9.5pt;
      font-weight: 600;
      color: ${THEME.ink};
      line-height: 1.35;
      white-space: normal;
      overflow: visible;
      overflow-wrap: break-word;
      word-break: normal;
      hyphens: auto;
      text-overflow: clip;
    }
    .glance-cell { overflow: visible; min-width: 0; }
    .glance-text { overflow-wrap: break-word; }

    /* ── Margin micro-chart (sidenote variant) ── */
    aside.sidenote-margin {
      background: ${THEME.paper};
      border-left: 2pt solid ${THEME.gold};
      padding: 8pt 10pt 9pt;
      margin: 10pt 0 14pt;
      page-break-inside: avoid;
    }
    aside.sidenote-margin .margin-title {
      font-family: 'Playfair Display', Georgia, serif;
      font-weight: 700;
      font-size: 10.5pt;
      color: ${THEME.ink};
      margin-bottom: 5pt;
      line-height: 1.25;
    }
    aside.sidenote-margin .margin-spark {
      margin: 4pt 0 6pt;
      max-width: 100%;
    }
    aside.sidenote-margin .margin-note {
      font-family: 'Inter', sans-serif;
      font-size: 8.5pt;
      line-height: 1.4;
      color: ${THEME.inkMuted};
      margin: 0;
    }

    /* ── Inline sparkline (flows in prose) ── */
    svg.spark-inline {
      display: inline-block;
      vertical-align: -2px;
      height: 12pt;
      width: auto;
    }



    /* ── Footnotes (CSS Paged Media — WeasyPrint) ── */
    span.footnote {
      float: footnote;
      font-family: 'Inter', sans-serif;
      font-size: 7.8pt; line-height: 1.45;
      color: ${THEME.inkMuted};
    }
    ::footnote-call {
      content: counter(footnote);
      font-family: 'Playfair Display', serif;
      font-weight: 700;
      color: ${THEME.gold};
      vertical-align: super;
      font-size: 0.72em;
      line-height: 0;
      margin-left: 1pt;
    }
    ::footnote-marker {
      content: counter(footnote) ". ";
      font-family: 'Playfair Display', serif;
      font-weight: 700;
      color: ${THEME.gold};
      font-size: 8pt;
    }

    /* ── Cross-references — "see p. X" auto-resolved by WeasyPrint ── */
    a.xref {
      color: ${THEME.goldSoft};
      text-decoration: none;
      font-family: 'Inter', sans-serif;
      font-style: italic;
      font-size: 0.94em;
      white-space: nowrap;
    }
    a.xref .xref-prefix { margin-right: 3pt; }
    a.xref .xref-page::before {
      content: " " target-counter(attr(href), page);
      font-weight: 600;
      font-style: normal;
      color: ${THEME.ink};
      font-variant-numeric: lining-nums tabular-nums;
    }

    /* ──────────────────────────────────────────────────────────────────
       Tier 3 — Section dividers, quote pages, oversized stat blocks
       ────────────────────────────────────────────────────────────────── */
    @page section-divider-page {
      margin: 0;
      background: ${THEME.bg};
      @top-left { content: none; } @top-right { content: none; }
      @bottom-left { content: none; } @bottom-right { content: none; }
      @bottom-center { content: none; }
    }
    @page quote-page {
      margin: 0;
      background: ${THEME.paperAlt};
      @top-left { content: none; } @top-right { content: none; }
      @bottom-left { content: none; } @bottom-right { content: none; }
      @bottom-center { content: none; }
    }
    section.section-divider {
      page: section-divider-page;
      break-before: page; page-break-before: always;
      break-after: page;  page-break-after: always;
      width: 210mm; min-height: 297mm;
      margin: 0 -20mm; padding: 38mm 24mm;
      background:
        radial-gradient(120% 80% at 80% 10%, rgba(212,168,67,0.20) 0%, rgba(212,168,67,0) 60%),
        radial-gradient(80% 60% at 10% 90%, rgba(46,108,176,0.18) 0%, rgba(46,108,176,0) 65%),
        linear-gradient(170deg, ${THEME.bg} 0%, #1a1409 100%);
      color: ${THEME.text};
      display: block;
      position: relative;
    }
    section.section-divider .sd-eyebrow {
      font-family: 'Inter', sans-serif;
      text-transform: uppercase;
      letter-spacing: .26em;
      font-size: 9pt; font-weight: 600;
      color: ${THEME.gold};
      margin-bottom: 28mm;
    }
    section.section-divider .sd-stat {
      font-family: 'Playfair Display', 'Fraunces', serif;
      font-weight: 800;
      font-size: 220pt;
      line-height: 0.9;
      letter-spacing: -0.04em;
      background: linear-gradient(135deg, ${THEME.gold} 0%, ${THEME.goldSoft} 60%, #8a6418 100%);
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent; color: transparent;
      font-variant-numeric: lining-nums proportional-nums;
      margin: 0;
    }
    section.section-divider .sd-label {
      font-family: 'Cormorant Garamond', serif;
      font-style: italic;
      font-size: 18pt;
      color: ${THEME.muted};
      margin-top: 6pt;
      max-width: 120mm;
    }
    section.section-divider .sd-headline {
      font-family: 'Playfair Display', serif;
      font-weight: 400;
      font-size: 32pt;
      line-height: 1.15;
      color: ${THEME.text};
      margin-top: 24mm;
      max-width: 150mm;
      border-top: 0.5pt solid rgba(212,168,67,0.35);
      padding-top: 14pt;
    }

    section.quote-page {
      page: quote-page;
      break-before: page; page-break-before: always;
      break-after: page;  page-break-after: always;
      width: 210mm; min-height: 297mm;
      margin: 0 -20mm; padding: 60mm 32mm;
      background: ${THEME.paperAlt};
      color: ${THEME.ink};
      display: block;
      position: relative;
    }
    section.quote-page::before {
      content: "\\201C";
      position: absolute; top: 32mm; left: 28mm;
      font-family: 'Playfair Display', serif;
      font-weight: 800; font-size: 360pt; line-height: 0.8;
      color: ${THEME.gold}; opacity: 0.18;
    }
    section.quote-page .qp-eyebrow {
      font-family: 'Inter', sans-serif;
      text-transform: uppercase;
      letter-spacing: .24em;
      font-size: 8.5pt; font-weight: 600;
      color: ${THEME.goldSoft};
      margin-bottom: 14mm;
      position: relative;
    }
    section.quote-page blockquote.qp-body {
      font-family: 'Cormorant Garamond', 'Playfair Display', serif;
      font-style: italic; font-weight: 500;
      font-size: 38pt; line-height: 1.18;
      color: ${THEME.ink};
      margin: 0; padding: 0;
      max-width: 140mm;
      position: relative;
      hyphens: none;
      font-feature-settings: "kern" 1, "liga" 1, "dlig" 1, "swsh" 1;
    }
    section.quote-page .qp-attrib {
      font-family: 'Inter', sans-serif;
      font-size: 10pt; font-weight: 600;
      letter-spacing: .14em; text-transform: uppercase;
      color: ${THEME.inkMuted};
      margin-top: 18mm;
      position: relative;
    }

    /* Inline oversized statistic block (smaller cousin of section-divider). */
    .stat-block {
      margin: 18pt 0 22pt;
      padding: 16pt 20pt;
      background: linear-gradient(180deg, ${THEME.paperAlt} 0%, ${THEME.paper} 100%);
      border-left: 4pt solid ${THEME.gold};
      page-break-inside: avoid; break-inside: avoid;
    }
    .stat-block .stat-value {
      font-family: 'Playfair Display', serif;
      font-weight: 800; font-size: 64pt; line-height: 1;
      color: ${THEME.navy};
      font-variant-numeric: lining-nums proportional-nums;
      letter-spacing: -0.02em;
    }
    .stat-block .stat-value .stat-unit {
      font-size: 0.45em; font-weight: 500; color: ${THEME.goldSoft};
      margin-left: 6pt; vertical-align: 0.4em;
    }
    .stat-block .stat-label {
      font-family: 'Inter', sans-serif;
      font-size: 9pt; font-weight: 600;
      text-transform: uppercase; letter-spacing: .18em;
      color: ${THEME.inkMuted};
      margin-top: 4pt;
    }
    .stat-block .stat-sub {
      font-family: 'Cormorant Garamond', serif;
      font-style: italic; font-size: 11pt; color: ${THEME.inkMuted};
      margin-top: 2pt;
    }

    /* ──────────────────────────────────────────────────────────────────
       Tier 3 #10 — Print-quality image treatments
       SVG filter primitives defined once in the body, classes opt-in.
       ────────────────────────────────────────────────────────────────── */
    .chapter-hero.hero-treatment-grain img,
    .chapter-hero.hero-treatment-duotone img {
      /* WeasyPrint resolves filter URLs to in-document <defs>. */
    }
    .chapter-hero.hero-treatment-grain img    { filter: url(#npc-grain); }
    .chapter-hero.hero-treatment-duotone img  { filter: url(#npc-duotone-gold); }
    .chapter-hero.hero-treatment-warm img     { filter: sepia(0.18) saturate(1.08) contrast(1.03); }

    /* Auto-numbered figure captions: "FIGURE 04 — Caption…" */
    body { counter-reset: section figure footnote; }
    figure.auto-chart, figure.vis-figure { counter-increment: figure; }
    figure.auto-chart figcaption::before,
    figure.vis-figure figcaption::before {
      content: "Figure " counter(figure, decimal-leading-zero) " — ";
      font-family: 'Inter', sans-serif;
      font-weight: 700;
      letter-spacing: .14em;
      text-transform: uppercase;
      color: ${THEME.gold};
      margin-right: 4pt;
    }
    figure figcaption .photo-credit {
      display: block;
      font-family: 'Cormorant Garamond', serif;
      font-style: italic;
      font-size: 7.5pt;
      color: ${THEME.inkMuted};
      margin-top: 2pt;
    }

    /* External / contact links — visible affordance in interactive PDF viewers. */
    a.contact-link, a.ext-link {
      color: ${THEME.gold};
      text-decoration: none;
      border-bottom: 0.4pt dotted ${THEME.goldSoft};
    }
  `;

  const scoreCard = scoreOverall != null
    ? `<div class="score-card">
         <div class="ring" style="--p:${Math.max(0, Math.min(100, Number(scoreOverall)))}%"><span>${esc(Math.round(Number(scoreOverall)))}</span></div>
         <div class="meta">
           <div class="band">${esc(scoreBand || "Investment Score")}</div>
           <h3 style="margin:4pt 0 2pt">Overall Investment Score</h3>
            <p style="margin:0;color:${THEME.inkMuted};font-size:9pt">A weighted blend of yield, growth, demographic strength, infrastructure, and risk factors specific to this property and suburb.</p>
         </div>
       </div>`
    : "";

  const tocHtml = toc.length > 0
    ? `<section class="toc">
         <div class="toc-eyebrow">${esc(brandName)} · Investment Report</div>
         <h1>Contents</h1>
         <ol>
           ${toc.map((t) => `<li><a href="#${t.id}"><span class="title">${esc(t.title)}</span><span class="dots"></span></a></li>`).join("")}
         </ol>
       </section>`
    : "";

  // PDF metadata — surfaced in Acrobat properties + search indexing.
  const docTitle = `${address} — Investment Report`;
  const docAuthor = issuer.name;
  const docDescription = `Comprehensive investment analysis for ${address}.`;
  const locKeywords = [loc?.suburb, loc?.state, loc?.postcode].filter(Boolean).join(", ");
  const docKeywords = [
    "investment property",
    "Australian real estate",
    locKeywords,
    docAuthor,
    "Compass report",
  ].filter(Boolean).join(", ");
  const docCreated = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="utf-8" />
<title>${esc(docTitle)}</title>
<meta name="author" content="${esc(docAuthor)}" />
<meta name="description" content="${esc(docDescription)}" />
<meta name="keywords" content="${esc(docKeywords)}" />
<meta name="subject" content="${esc(`Investment Report — ${address}`)}" />
<meta name="generator" content="${esc(PLATFORM_ISSUER_NAME)} reporting platform (WeasyPrint)" />
<meta name="dcterms.created" content="${esc(docCreated)}" />
<meta name="dcterms.creator" content="${esc(docAuthor)}" />
<!-- Fonts bundled in the WeasyPrint container at /usr/share/fonts/truetype/premium.
     Kept as fallback for the Api2PDF/headless-Chrome render path. -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..900;1,400..900&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Inter:wght@300;400;500;600;700;800&family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap">
<style>${styles}
${designOverrideStyles}
${(() => {
  // ── Premium Layer (Phase 1+2) — wins specificity over all earlier rules.
  // Watermark generated as a tiled SVG data URI: ultra-light diagonal brand
  // string repeated across every page background.
  const wmText = esc(issuer.name.toUpperCase());
  const wmSvg = `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns='http://www.w3.org/2000/svg' width='560' height='560' viewBox='0 0 560 560'>
      <g transform='rotate(-32 280 280)' font-family='Inter, sans-serif' font-size='13' font-weight='700'
         letter-spacing='6' fill='${palette.ink}' fill-opacity='0.035'>
        <text x='-40' y='90'>${wmText}</text>
        <text x='80'  y='250'>${wmText}</text>
        <text x='-40' y='410'>${wmText}</text>
        <text x='80'  y='570'>${wmText}</text>
      </g>
    </svg>`)}`;
  return `
    /* ── Phase 1+2 Premium Layer ─────────────────────────────────────── */

    /* Tiled watermark on every body page (cover/disclaimer/divider exempt). */
    @page { background: ${palette.paper} url("${wmSvg}") repeat; background-size: 280px 280px; }
    @page cover, @page disclaimer-page, @page section-divider-page, @page quote-page { background-image: none; }

    /* Wider outer margin → real marginalia rail. */
    @page :left  { margin: 24mm 14mm 22mm 26mm; }
    @page :right { margin: 24mm 26mm 22mm 14mm; }

    /* Thumb-index tabs — rendered as DOM spans inside each h2, positioned into
       the wide outer margin, with per-chapter top offset + colour rotation set
       inline by the annotator. Mirrors a printed annual-report thumb index. */
    .thumb-tab {
      position: absolute;
      right: -28mm;
      width: 22mm;
      padding: 6pt 5pt 6pt 7pt;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      font-family: 'Inter', sans-serif;
      font-size: 7pt; font-weight: 800;
      letter-spacing: .26em; text-transform: uppercase;
      color: #fff;
      border-radius: 2pt 0 0 2pt;
      box-shadow: -0.5pt 0.5pt 2pt rgba(0,0,0,0.18);
      -webkit-text-fill-color: #fff;
      background: ${palette.accent}; /* overridden inline per chapter */
      max-height: 50mm;
      overflow: hidden;
      z-index: 4;
    }
    /* Ghost chapter numeral now also rendered via DOM span so we can show the
       *real* chapter index from the annotator (not relying on CSS counter, which
       resets per @page chapter-opener flow). */
    .ch-ghost {
      position: absolute;
      right: -8mm; top: -32mm;
      font-family: 'Playfair Display', 'Fraunces', serif;
      font-weight: 800; font-style: italic;
      font-size: 220pt; line-height: 1;
      color: ${withAlpha(palette.accent, 0.07)};
      -webkit-text-fill-color: ${withAlpha(palette.accent, 0.07)};
      background: none;
      pointer-events: none; z-index: 0;
      letter-spacing: -0.05em;
      font-variant-numeric: lining-nums;
    }

    /* The new editorial opener (mono eyebrow ::before + ghosted-outline ::after
       numeral defined upstream) replaces the legacy .ch-ghost DOM span. Hide it
       so we don't render two ghost numerals on top of each other. */
    .ch-ghost { display: none !important; }
    h2 { position: relative; overflow: visible; z-index: 1; }
    h2 + p { position: relative; z-index: 2; }

    /* End-of-chapter ornament — fills the inevitable tail whitespace with a
       quiet editorial sign-off instead of dead cream. Sits at the bottom of
       the previous chapter's last page; the next h2 still forces a fresh page. */
    .chapter-closer {
      display: flex;
      align-items: center;
      gap: 12pt;
      margin: 36pt auto 0;
      padding: 0;
      width: 60%;
      break-after: page;        /* push the next h2 onto its own opener page */
      page-break-after: always;
      break-inside: avoid;
    }
    .chapter-closer-rule {
      flex: 1;
      height: 0.5pt;
      background: linear-gradient(90deg, transparent 0%, ${THEME.gold} 50%, transparent 100%);
      opacity: 0.6;
    }
    .chapter-closer-mark {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 10pt;
      color: ${THEME.gold};
      letter-spacing: 0;
      line-height: 1;
    }
    /* The first chapter has no preceding closer, so its opener still works. */

    /* Real initial-letter drop cap (WeasyPrint supports this; degrades to ::first-letter). */
    ${design.showDropCaps ? `
    h2 + p::first-letter {
      -webkit-initial-letter: 3 2;
      initial-letter: 3 2;
      font-family: 'Playfair Display', 'Fraunces', serif;
      font-weight: 800;
      color: ${palette.accent};
      margin-right: 6pt;
      padding-right: 3pt;
      font-feature-settings: "kern" 1, "dlig" 1, "swsh" 1;
      line-height: 0.82;
    }
    ` : ""}

    /* ── Foil-stamp cover ── */
    .cover-foil {
      position: absolute; inset: 0; z-index: 1;
      background-size: cover; background-position: center;
      mix-blend-mode: screen;
      pointer-events: none;
    }
    .cover-masthead {
      position: absolute; left: 0; right: 0; top: 22mm;
      text-align: center; z-index: 3;
      font-family: 'Inter', sans-serif;
      font-size: 9pt; font-weight: 800;
      letter-spacing: .42em;
      color: ${palette.accent};
      text-shadow: 0 0 14pt rgba(0,0,0,0.6);
    }
    .cover-masthead::before, .cover-masthead::after {
      content: ""; display: inline-block;
      width: 28mm; height: 0.5pt;
      background: ${palette.accent};
      vertical-align: middle;
      margin: 0 8mm;
      opacity: 0.7;
    }
    .cover-rule {
      width: 36mm; height: 1pt;
      background: linear-gradient(90deg, ${palette.accent} 0%, ${withAlpha(palette.accent, 0)} 100%);
      margin: 8mm 0 8mm;
    }
    .cover-prepared {
      font-family: 'Cormorant Garamond', serif;
      font-style: italic; font-size: 11pt;
      color: rgba(255,255,255,0.78);
      margin-top: 6mm; letter-spacing: 0;
      text-transform: none;
    }
    .cover-prepared strong {
      font-style: normal; font-weight: 600;
      color: ${palette.accent}; letter-spacing: .04em;
    }
    .cover-edition {
      position: absolute; right: 18mm; bottom: 14mm; z-index: 3;
      font-family: 'Inter', sans-serif;
      font-size: 7pt; font-weight: 700;
      letter-spacing: .32em;
      color: ${palette.accent}; opacity: 0.85;
    }

    /* Cover scrim deepened so masthead + foil pop against any background. */
    .cover-scrim {
      background: linear-gradient(160deg,
        rgba(0,0,0,0.75) 0%,
        rgba(0,0,0,0.55) 38%,
        rgba(0,0,0,0.20) 72%,
        rgba(0,0,0,0.62) 100%) !important;
    }

    /* ── Editor's Note (intro card) ── */
    .editors-note {
      margin: 0 0 22pt;
      padding: 16pt 22pt 14pt;
      background: ${palette.paperAlt};
      border-top: 0.5pt solid ${palette.accent};
      border-bottom: 0.5pt solid ${palette.accent};
      page-break-inside: avoid; break-inside: avoid;
      position: relative;
    }
    .editors-note .en-eyebrow {
      font-family: 'Inter', sans-serif;
      font-size: 7.5pt; font-weight: 800;
      text-transform: uppercase; letter-spacing: .26em;
      color: ${palette.accent};
      margin-bottom: 8pt;
    }
    .editors-note .en-body {
      font-family: 'Cormorant Garamond', serif;
      font-style: italic;
      font-size: 13pt; line-height: 1.5;
      color: ${palette.ink};
      margin: 0;
    }
    .editors-note .en-sig {
      margin-top: 10pt;
      font-family: 'Playfair Display', serif;
      font-size: 10pt; font-style: italic;
      color: ${palette.heading2};
    }

    /* Stronger pull-quote / blockquote treatment. */
    blockquote {
      border-left-width: 4pt !important;
      padding-left: 44pt !important;
    }
    blockquote::before {
      font-size: 64pt !important; top: -4pt !important;
      color: ${withAlpha(palette.accent, 0.55)} !important;
    }

    /* Tight widows/orphans across the board (Phase 1 #4). */
    p, li, td, th { widows: 3; orphans: 3; }
    h2, h3, h4 { break-after: avoid-page; page-break-after: avoid; }
    h2 + p, h3 + p { break-before: avoid-page; }
    figure, .insight-box, .stat-block, table, .kpi, .score-card,
    blockquote, aside.pull-quote, aside.sidenote {
      break-inside: avoid-page; page-break-inside: avoid;
      box-decoration-break: clone; -webkit-box-decoration-break: clone;
    }

    /* OpenType: small-caps for eyebrow labels everywhere. */
    .toc-eyebrow, .insight-label, .insight-label-inline,
    .kpi-label, .stat-label, .cover-kicker, .cover-meta,
    .sd-eyebrow, .qp-eyebrow, .en-eyebrow {
      font-feature-settings: "smcp" 1, "c2sc" 1, "kern" 1;
      font-variant-caps: all-small-caps;
    }

    /* Tabular figures on every number-heavy surface. */
    table, .kpi-value, .stat-value, .score-card,
    .cover-edition, .cover-meta {
      font-variant-numeric: tabular-nums lining-nums;
      font-feature-settings: "tnum" 1, "lnum" 1, "kern" 1;
    }

    /* Hanging punctuation for body paragraphs. */
    p, blockquote, li { hanging-punctuation: first last; }

    /* TOC chapter dots: aligned leader dots with real page nums. */
    .toc ol li a { font-feature-settings: "tnum" 1, "lnum" 1; }

    /* ── Phase 1 #8 — Sidenote floats into outer margin rail ── */
    aside.sidenote {
      float: right;
      clear: right;
      width: 38mm;
      margin: 0 -30mm 8pt 10pt;
      padding: 8pt 10pt;
      font-family: 'Cormorant Garamond', serif;
      font-style: italic;
      font-size: 8.4pt;
      line-height: 1.45;
      color: ${palette.ink};
      background: ${palette.paperAlt};
      border-left: 2pt solid ${palette.accent};
      shape-outside: margin-box;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    aside.sidenote::before {
      content: "";
      display: block;
      width: 18pt; height: 0.5pt;
      background: ${palette.accent};
      margin-bottom: 4pt;
    }
    aside.sidenote p { margin: 0 0 4pt; font-size: inherit; }

    /* ── Phase 1 #1 — Auto-landscape spread for wide tables ── */
    @page landscape-table-page {
      size: A4 landscape;
      margin: 18mm 16mm 16mm 16mm;
      background: ${palette.paper};
      @top-left { content: string(chapter); }
      @top-right { content: "${cssString(address)}"; font-style: italic; }
      @bottom-right { content: counter(page) " · " counter(pages); }
    }
    .landscape-spread {
      page: landscape-table-page;
      break-before: page; page-break-before: always;
      break-after: page;  page-break-after: always;
      margin: 0; padding: 0;
    }
    .landscape-spread .landscape-inner { width: 100%; }
    .landscape-spread table {
      width: 100% !important;
      font-size: 9pt;
      page-break-inside: auto;
    }
    .landscape-spread table th,
    .landscape-spread table td { padding: 6pt 8pt; }
    .landscape-spread::before {
      content: "Detailed data spread";
      display: block;
      font-family: 'Inter', sans-serif;
      font-size: 7.5pt; font-weight: 700;
      letter-spacing: .28em; text-transform: uppercase;
      color: ${palette.accent};
      margin-bottom: 8pt;
    }

    /* ── Phase 2 #7 — Chapter opener typographic spread (no-hero fallback).
       Every chapter opener page gets a hairline gold rule under the running
       header area and extra top padding so the title breathes. */
    h2[data-ch] {
      padding-top: 22pt;
      border-top: 0.5pt solid ${withAlpha(palette.accent, 0.45)};
      margin-top: 0;
    }
    h2[data-ch]::before {
      ${design.showSectionNumbers ? `` : `content: none;`}
    }

    /* ── Phase 4 — Pull-quote / quote-page full-bleed editorial spread ── */
    .quote-page {
      break-before: page; page-break-before: always;
      break-after: page;  page-break-after: always;
      page: chapter-opener-page;
      min-height: 240mm;
      display: flex; flex-direction: column; justify-content: center;
      padding: 40mm 28mm;
      background: ${palette.paperAlt};
      position: relative;
    }
    .quote-page .qp-eyebrow {
      font-family: 'Inter', sans-serif;
      font-size: 8pt; font-weight: 800;
      letter-spacing: .32em; text-transform: uppercase;
      color: ${palette.accent};
      margin-bottom: 18pt;
    }
    .quote-page .qp-body {
      font-family: 'Cormorant Garamond', serif;
      font-style: italic; font-weight: 500;
      font-size: 38pt; line-height: 1.18;
      color: ${palette.heading2};
      margin: 0; padding: 0; border: 0;
      letter-spacing: -0.01em;
      hanging-punctuation: first last;
    }
    .quote-page .qp-body::before { content: "\\201C"; font-size: 1em; color: ${palette.accent}; margin-right: .05em; }
    .quote-page .qp-body::after  { content: "\\201D"; color: ${palette.accent}; margin-left: .05em; }
    .quote-page .qp-attrib {
      margin-top: 22pt;
      font-family: 'Inter', sans-serif;
      font-size: 9.5pt; letter-spacing: .12em; text-transform: uppercase;
      color: ${palette.heading3};
    }

    /* ── Phase 4 — Data dashboard full-page spread ── */
    .dashboard-page {
      break-before: page; page-break-before: always;
      break-after: page;  page-break-after: always;
      page: chapter-opener-page;
      padding: 26mm 22mm;
      background: ${palette.paper};
    }
    .dashboard-page .dp-eyebrow {
      font-family: 'Inter', sans-serif;
      font-size: 8pt; font-weight: 800; letter-spacing: .32em; text-transform: uppercase;
      color: ${palette.accent}; margin-bottom: 6pt;
    }
    .dashboard-page .dp-title {
      font-family: 'Playfair Display', serif; font-weight: 700;
      font-size: 28pt; line-height: 1.1; color: ${palette.heading2};
      margin: 0 0 18pt; border: 0; padding: 0;
    }
    .dashboard-page .dp-title::before { content: none !important; }
    .dashboard-page .dp-grid {
      display: grid;
      grid-template-columns: 1.4fr 1fr;
      grid-template-rows: auto auto;
      gap: 12pt;
      margin-bottom: 14pt;
    }
    .dashboard-page .dp-big-cell {
      grid-row: span 2;
      padding: 18pt 20pt;
      background: ${palette.paperAlt};
      border-top: 2pt solid ${palette.accent};
      display: flex; flex-direction: column; justify-content: space-between;
      min-height: 130mm;
    }
    .dashboard-page .dp-big-value {
      font-family: 'Playfair Display', serif; font-weight: 800;
      font-size: 120pt; line-height: 0.95; color: ${palette.heading2};
      font-variant-numeric: lining-nums tabular-nums;
      letter-spacing: -0.03em;
    }
    .dashboard-page .dp-big-label {
      font-family: 'Inter', sans-serif;
      font-size: 10pt; font-weight: 700; letter-spacing: .22em; text-transform: uppercase;
      color: ${palette.heading3}; margin-top: 8pt;
    }
    .dashboard-page .dp-spark { margin-top: auto; }
    .dashboard-page .dp-peers {
      padding: 14pt 16pt; background: ${palette.paperAlt};
      border-left: 2pt solid ${palette.accent};
    }
    .dashboard-page .dp-peers-title {
      font-family: 'Inter', sans-serif; font-size: 8pt; font-weight: 800;
      letter-spacing: .22em; text-transform: uppercase; color: ${palette.accent};
      margin-bottom: 8pt;
    }
    .dashboard-page .dp-peer-row {
      display: flex; justify-content: space-between;
      padding: 5pt 0; border-bottom: 0.4pt solid ${withAlpha(palette.accent, 0.25)};
      font-family: 'Inter', sans-serif; font-size: 10pt; color: ${palette.ink};
      font-variant-numeric: tabular-nums lining-nums;
    }
    .dashboard-page .dp-peer-row:last-child { border-bottom: 0; }
    .dashboard-page .dp-map { padding: 8pt; background: ${palette.paperAlt}; }
    .dashboard-page .dp-narrative {
      font-family: 'Cormorant Garamond', serif; font-style: italic;
      font-size: 13pt; line-height: 1.5; color: ${palette.ink};
      margin: 18pt 0 0; padding-top: 12pt;
      border-top: 0.5pt solid ${palette.accent};
    }

    /* ── Phase 4 — Signature page (personalised sign-off + QR) ── */
    .signature-page {
      break-before: page; page-break-before: always;
      break-after: page;  page-break-after: always;
      page: chapter-opener-page;
      padding: 50mm 28mm;
      background: ${palette.paper};
      min-height: 240mm;
    }
    .signature-page .sg-eyebrow {
      font-family: 'Inter', sans-serif; font-size: 8pt; font-weight: 800;
      letter-spacing: .32em; text-transform: uppercase; color: ${palette.accent};
      margin-bottom: 24pt;
    }
    .signature-page .sg-body {
      font-family: 'Cormorant Garamond', serif; font-style: italic;
      font-size: 18pt; line-height: 1.45; color: ${palette.heading2};
      margin: 0 0 40pt; max-width: 130mm;
    }
    .signature-page .sg-row {
      display: flex; justify-content: space-between; align-items: flex-end;
      gap: 20pt; padding-top: 18pt;
      border-top: 0.5pt solid ${palette.accent};
    }
    .signature-page .sg-sig-mark { margin-bottom: 6pt; }
    .signature-page .sg-sig-name {
      font-family: 'Playfair Display', serif; font-weight: 700;
      font-size: 14pt; color: ${palette.heading2};
    }
    .signature-page .sg-sig-role,
    .signature-page .sg-sig-company,
    .signature-page .sg-sig-date {
      font-family: 'Inter', sans-serif; font-size: 9.5pt;
      color: ${palette.heading3}; margin-top: 2pt;
    }
    .signature-page .sg-sig-date {
      font-size: 8pt; letter-spacing: .2em; text-transform: uppercase;
      color: ${palette.accent}; margin-top: 6pt;
    }
    .signature-page .sg-qr {
      text-align: center;
    }
    .signature-page .sg-qr img { width: 100pt; height: 100pt; }
    .signature-page .sg-qr-cap {
      font-family: 'Inter', sans-serif; font-size: 7.5pt;
      letter-spacing: .22em; text-transform: uppercase;
      color: ${palette.heading3}; margin-top: 6pt;
    }

    /* ── Phase 3 — Visualisation figure container (bullet/marimekko/map/calendar) ── */
    .vis-figure {
      margin: 14pt 0 16pt;
      padding: 10pt; background: ${palette.paper};
      border: 0.4pt solid ${withAlpha(palette.accent, 0.35)};
      page-break-inside: avoid; break-inside: avoid;
    }
    .vis-figure figcaption {
      margin-top: 8pt; padding-top: 6pt;
      border-top: 0.4pt solid ${withAlpha(palette.accent, 0.25)};
      font-family: 'Inter', sans-serif; font-size: 8pt;
      letter-spacing: .2em; text-transform: uppercase;
      color: ${palette.heading3}; text-align: center;
    }

    /* ════════════════════════════════════════════════════════════════════
       EDITORIAL PREMIUM LAYER v3 — final-pass override
       Blends Ref-A magazine editorial (Playfair display, mono eyebrows,
       generous negative space) with Ref-B warm brochure (cream paper,
       calm two-column copy, photo-led), in our brand palette.
       Loaded last so it wins specificity over all earlier rules.
       ════════════════════════════════════════════════════════════════════ */

    :root {
      --ed-ink:        #0F0F10;
      --ed-ink-soft:   #4A4438;
      --ed-paper:      #FAF7F1;
      --ed-paper-2:    #F1ECDF;
      --ed-rule:       #D8CBB6;
      --ed-gold:       #D4A843;
      --ed-gold-deep:  #8A6418;
      --ed-navy:       #14233A;
      --ed-navy-deep:  #061A33;
    }

    body {
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 10.5pt; line-height: 1.55;
      color: var(--ed-ink); background: var(--ed-paper);
      font-feature-settings: "kern" 1, "liga" 1, "calt" 1, "ss01" 1;
      -webkit-font-smoothing: antialiased;
    }
    p { hyphens: auto; orphans: 3; widows: 3; }

    h1, h2, h3, .display, .cover-title {
      font-family: 'Playfair Display', 'Fraunces', Georgia, serif !important;
      font-weight: 700 !important;
      color: var(--ed-navy-deep);
      letter-spacing: -0.012em; line-height: 1.08;
      font-feature-settings: "lnum" 1, "kern" 1, "dlig" 1;
      background: none !important;
      -webkit-text-fill-color: var(--ed-navy-deep);
    }
    h1 { font-size: 36pt; }
    h2 { font-size: 26pt; margin-top: 0; }
    h3 { font-size: 15pt; }

    .eyebrow, .toc-eyebrow,
    .insight-label, .insight-label-inline,
    .kpi-label, .stat-label,
    .cover-kicker, .cover-meta,
    .sd-eyebrow, .qp-eyebrow, .en-eyebrow,
    .compare-head, .chart-title-eyebrow,
    .npc-view-label {
      font-family: 'IBM Plex Mono', ui-monospace, monospace !important;
      font-variant-caps: normal !important;
      font-feature-settings: "lnum" 1, "tnum" 1 !important;
      font-weight: 500 !important;
      text-transform: uppercase; letter-spacing: 0.18em;
      font-size: 7.6pt; color: var(--ed-gold-deep) !important;
    }
    .eyebrow::before, .en-eyebrow::before,
    .sd-eyebrow::before, .qp-eyebrow::before {
      content: "— "; color: var(--ed-gold); margin-right: 2pt;
    }

    @page {
      background: var(--ed-paper);
      background-image: none !important;
      @top-left {
        content: string(chapter);
        font-family: 'IBM Plex Mono', monospace;
        font-size: 7.6pt; font-weight: 500;
        text-transform: uppercase; letter-spacing: 0.22em;
        color: var(--ed-ink-soft);
      }
      @top-right {
        content: "${cssString(address)}";
        font-family: 'IBM Plex Mono', monospace;
        font-size: 7.6pt; font-weight: 400;
        color: var(--ed-ink-soft);
        font-style: normal; letter-spacing: 0.08em;
      }
      @bottom-left {
        content: "${cssString(brandName)}";
        font-family: 'IBM Plex Mono', monospace;
        font-size: 7.4pt; font-weight: 500;
        text-transform: uppercase; letter-spacing: 0.22em;
        color: var(--ed-ink-soft);
      }
      @bottom-center { content: ""; border-top: none; }
      @bottom-right {
        content: counter(page, decimal-leading-zero) "  /  " counter(pages, decimal-leading-zero);
        font-family: 'IBM Plex Mono', monospace;
        font-size: 8pt; font-weight: 600;
        color: var(--ed-ink);
        font-style: normal; letter-spacing: 0.08em;
        font-variant-numeric: lining-nums tabular-nums;
      }
    }

    @page cover { background: var(--ed-navy-deep); }
    .cover { background: var(--ed-navy-deep) !important; }
    .cover .cover-scrim {
      background: linear-gradient(180deg,
        rgba(6,26,51,0.20) 0%,
        rgba(6,26,51,0.30) 55%,
        rgba(6,26,51,0.88) 100%) !important;
    }
    .cover-masthead {
      font-family: 'IBM Plex Mono', monospace !important;
      font-weight: 500 !important;
      letter-spacing: 0.32em !important;
      font-size: 8pt !important;
      color: var(--ed-gold) !important;
      text-shadow: none !important; top: 18mm !important;
    }
    .cover-masthead::before, .cover-masthead::after {
      width: 14mm !important; background: var(--ed-gold) !important;
      opacity: 0.55 !important; margin: 0 6mm !important;
    }
    .cover-kicker {
      font-family: 'IBM Plex Mono', monospace !important;
      text-transform: uppercase !important;
      letter-spacing: 0.22em !important;
      font-size: 8pt !important; color: var(--ed-gold) !important;
      font-weight: 500 !important;
    }
    .cover-title {
      font-family: 'Playfair Display', serif !important;
      font-weight: 600 !important; font-style: normal;
      font-size: 48pt !important; line-height: 1.04 !important;
      letter-spacing: -0.018em !important;
      color: #FAF7F1 !important;
      -webkit-text-fill-color: #FAF7F1 !important;
      background: none !important; max-width: 84%;
    }
    .cover-title em, .cover-title i {
      font-style: italic; color: var(--ed-gold) !important;
      -webkit-text-fill-color: var(--ed-gold) !important;
    }
    .cover-rule {
      width: 28mm !important; height: 0.6pt !important;
      background: var(--ed-gold) !important;
      margin: 7mm 0 7mm !important; opacity: 0.85;
    }
    .cover-meta {
      font-family: 'IBM Plex Mono', monospace !important;
      letter-spacing: 0.14em !important; font-size: 9pt !important;
      text-transform: uppercase !important;
      color: rgba(250,247,241,0.82) !important;
    }
    .cover-prepared {
      font-family: 'Inter', sans-serif !important;
      font-style: normal !important; font-size: 9.5pt !important;
      color: rgba(250,247,241,0.7) !important;
    }
    .cover-prepared strong {
      color: var(--ed-gold) !important;
      font-weight: 600 !important; letter-spacing: 0.02em !important;
    }
    .cover-edition {
      font-family: 'IBM Plex Mono', monospace !important;
      font-weight: 500 !important; font-size: 7.4pt !important;
      letter-spacing: 0.24em !important;
      color: rgba(250,247,241,0.55) !important; opacity: 1 !important;
    }
    .cover-foil { opacity: 0.18 !important; mix-blend-mode: soft-light !important; }

    .ch-ghost { display: none !important; }
    .thumb-tab { display: none !important; }

    .kpi {
      background: transparent !important; border: 0 !important;
      border-top: 0.6pt solid var(--ed-gold) !important;
      border-radius: 0 !important; padding: 10pt 0 4pt !important;
    }
    .kpi-label {
      font-family: 'IBM Plex Mono', monospace !important;
      font-size: 7.2pt !important; letter-spacing: 0.18em !important;
      color: var(--ed-ink-soft) !important; font-weight: 500 !important;
    }
    .kpi-value {
      font-family: 'Playfair Display', serif !important;
      font-weight: 600 !important; font-size: 24pt !important;
      color: var(--ed-navy-deep) !important; letter-spacing: -0.01em;
    }
    .score-card {
      background: var(--ed-paper-2) !important; border: 0 !important;
      border-left: 2.5pt solid var(--ed-gold) !important;
      padding: 18pt 22pt !important;
    }
    .score-card .ring {
      background: conic-gradient(var(--ed-gold) 0%, var(--ed-gold) var(--p,0%), rgba(20,35,58,0.08) var(--p,0%)) !important;
      color: var(--ed-navy-deep) !important;
    }
    .score-card .ring::after { background: var(--ed-paper-2) !important; }
    .score-card .band {
      font-family: 'IBM Plex Mono', monospace !important;
      color: var(--ed-gold-deep) !important;
      letter-spacing: 0.22em !important; font-weight: 500 !important;
    }

    .compare-col {
      background: transparent !important; border: 0 !important;
      border-top: 0.6pt solid var(--ed-rule) !important;
      border-radius: 0 !important; padding: 12pt 0 0 !important;
    }
    .compare-pos, .compare-neg { border-left: 0 !important; }
    .compare-head {
      font-family: 'IBM Plex Mono', monospace !important;
      font-weight: 500 !important; letter-spacing: 0.22em !important;
      font-size: 7.6pt !important;
    }

    table {
      border-collapse: collapse !important; width: 100%;
      font-feature-settings: "tnum" 1, "lnum" 1;
    }
    table th {
      background: transparent !important;
      color: var(--ed-ink-soft) !important;
      font-family: 'IBM Plex Mono', monospace !important;
      font-size: 7.4pt !important; font-weight: 500 !important;
      letter-spacing: 0.18em !important; text-transform: uppercase !important;
      border-bottom: 0.6pt solid var(--ed-ink) !important;
      padding: 8pt 6pt !important; text-align: left;
    }
    table td {
      border-bottom: 0.3pt solid var(--ed-rule) !important;
      padding: 7pt 6pt !important; font-size: 9.6pt !important;
    }
    table tbody tr:nth-child(even) td { background: transparent !important; }

    blockquote, aside.pull-quote {
      font-family: 'Playfair Display', serif !important;
      font-style: italic !important;
      font-size: 18pt !important; line-height: 1.35 !important;
      color: var(--ed-navy-deep) !important;
      border-left: 2pt solid var(--ed-gold) !important;
      padding: 4pt 0 4pt 22pt !important; margin: 18pt 0 !important;
      background: transparent !important;
    }
    blockquote::before { content: none !important; }

    .editors-note {
      background: var(--ed-paper-2) !important;
      border-top: 0.6pt solid var(--ed-gold) !important;
      border-bottom: 0 !important; padding: 18pt 22pt !important;
    }
    .editors-note .en-body {
      font-family: 'Playfair Display', serif !important;
      font-style: italic !important;
      font-size: 14pt !important; line-height: 1.5 !important;
      color: var(--ed-navy-deep) !important;
    }

    .chapter-hero { border-radius: 0 !important; box-shadow: none !important; }
    .chapter-hero.hero-w-bleed {
      margin-left: -18mm !important; margin-right: -18mm !important;
      width: 210mm !important;
    }
    figure.auto-chart figcaption,
    figure.vis-figure figcaption,
    .chapter-hero figcaption {
      font-family: 'IBM Plex Mono', monospace !important;
      font-size: 7.4pt !important; letter-spacing: 0.18em !important;
      text-transform: uppercase !important;
      color: var(--ed-ink-soft) !important; text-align: left !important;
    }
    figure.auto-chart figcaption::before,
    figure.vis-figure figcaption::before {
      color: var(--ed-gold) !important;
      font-family: 'IBM Plex Mono', monospace !important;
      font-weight: 600 !important;
    }
    .chart-wrap, .vis-figure {
      background: transparent !important; border: 0 !important;
      border-top: 0.4pt solid var(--ed-rule) !important;
      box-shadow: none !important;
      padding: 14pt 0 6pt !important; border-radius: 0 !important;
    }

    /* ── Drop caps: disabled per editorial decision. Reset every prior rule. ── */
    h2 + p::first-letter,
    h2 + .standfirst::first-letter,
    .chapter > p:first-of-type::first-letter,
    p::first-letter {
      -webkit-initial-letter: normal !important;
      initial-letter: normal !important;
      float: none !important;
      font-size: inherit !important;
      font-family: inherit !important;
      font-weight: inherit !important;
      color: inherit !important;
      -webkit-text-fill-color: inherit !important;
      line-height: inherit !important;
      padding: 0 !important;
      margin: 0 !important;
      background: none !important;
    }

    /* ── Chapter headings: balance multi-line wraps and tighten leading so
         a long title never orphans a single word onto its own line. ── */
    h2, h2[data-ch] {
      font-size: 22pt !important;
      line-height: 1.12 !important;
      letter-spacing: -0.015em !important;
      text-wrap: balance;
      -webkit-hyphens: manual !important;
      hyphens: manual !important;
      word-break: normal !important;
      overflow-wrap: normal !important;
      max-width: 100%;
      padding-right: 6mm;
    }

    /* ── Defensive alignment reset ──
       Some chapters were inheriting text-align:center from an upstream container
       (an unbalanced figure / leaked inline style). Re-pin body content to its
       intended alignment so a single leak can't cascade through the rest of the
       document. */
    section.body-page > h1, section.body-page > h2, section.body-page > h3,
    section.body-page > h4, section.body-page > h5, section.body-page > h6,
    section.body-page h2, section.body-page h3, section.body-page h4,
    section.body-page h5, section.body-page h6 { text-align: left !important; }
    section.body-page > p, section.body-page > ul, section.body-page > ol,
    section.body-page > li, section.body-page p, section.body-page li {
      text-align: justify !important;
    }
    section.body-page table, section.body-page td, section.body-page th {
      text-align: left;
    }
    /* Keep intentionally-centred figures and callouts as-is. */
    section.body-page figure, section.body-page figure *,
    section.body-page .glance-strip, section.body-page .glance-strip *,
    section.body-page .insight-box .insight-label,
    section.body-page .section-divider, section.body-page .section-divider *,
    section.body-page .quote-page, section.body-page .quote-page *,
    section.body-page .stat-block, section.body-page .stat-block * {
      text-align: revert !important;
    }
  `;
})()}</style>
</head>
<body>

<!-- ── Tier 3 #10 — SVG filter primitives for hero treatments (grain + duotone). ── -->
<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
  <defs>
    <filter id="npc-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" seed="7"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.18 0"/>
      <feComposite in2="SourceGraphic" operator="in" result="grain"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="grain"/></feMerge>
    </filter>
    <filter id="npc-duotone-gold" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 1 0"/>
      <feComponentTransfer>
        <feFuncR type="table" tableValues="0.05 0.83"/>
        <feFuncG type="table" tableValues="0.07 0.66"/>
        <feFuncB type="table" tableValues="0.10 0.26"/>
      </feComponentTransfer>
    </filter>
  </defs>
</svg>

<!-- ── Cover (front-end controlled WeasyPrint design) ── -->
${coverHtml}


${tocHtml}

<!-- ── Executive Summary (replaces Snapshot + Finance Visuals) ── -->
<section class="body-page">
  ${executiveSummaryHtml}
</section>

<!-- ── Body (markdown) ── -->

<section class="body-page">
  ${bodyWithHeroes}
</section>

${
    sourcesHtml
      ? `<section class="body-page">${sourcesHtml}</section>`
      : ""
  }

<!-- ── Contact + Disclaimer closing page (shared by every report format) ── -->
${(() => {
  const companyRaw = issuer.name.toUpperCase();
  const parts = companyRaw.split(" ");
  const mainCompany = parts.length >= 2 ? parts.slice(0, -1).join(" ") : parts[0];
  const subCompany = parts.length >= 2 ? parts[parts.length - 1] : "";
  const rows: Array<[string, any]> = [
    ["Website", contact.website],
    ["Email", contact.email],
    ["Phone", contact.phone],
    ["Address", contact.address],
    ["ABN", contact.abn],
  ];
  const linkifyValue = (label: string, value: string): string => {
    const v = String(value).trim();
    if (label === "Email" && /^[^@\s]+@[^@\s]+$/.test(v)) {
      return `<a class="contact-link" href="mailto:${escAttr(v)}">${esc(v)}</a>`;
    }
    if (label === "Phone") {
      const tel = v.replace(/[^\d+]/g, "");
      return tel ? `<a class="contact-link" href="tel:${escAttr(tel)}">${esc(v)}</a>` : esc(v);
    }
    if (label === "Website") {
      const href = websiteHref(v);
      return href ? `<a class="contact-link" href="${escAttr(href)}">${esc(v)}</a>` : esc(v);
    }
    return esc(v);
  };
  const rowsHtml = rows
    .filter(([, v]) => v)
    .map(([l, v]) => `<div class="contact-row"><div class="label">${esc(l)}</div><div class="value">${linkifyValue(String(l), String(v))}</div></div>`)
    .join("");
  // The issuer decides the wording. A named business speaks its own; an
  // unbranded deployment issues under Aurixa Systems and speaks the technology
  // provider's, which is a different statement rather than the same one with a
  // name swapped — see `_shared/reports/issuerIdentity.pure.ts`.
  const discText = issuedDisclaimer.text;
  const discParas = discText
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`) 
    .join("");
  return `<section class="disclaimer-page">
    <div class="company-main">${esc(mainCompany)}</div>
    ${subCompany ? `<div class="company-sub">${esc(subCompany)}</div>` : ""}
    ${rowsHtml ? `<div class="contact-heading">CONTACT US</div>
    <div class="contact-list">${rowsHtml}</div>` : ""}
    <div class="disclaimer-body">${discParas}</div>
  </section>`;
})()}

<!-- TOC page numbers are resolved natively by WeasyPrint via CSS target-counter().
     The legacy JS estimator has been removed — Chrome/Api2PDF fallback will simply
     show blank pages in the TOC, which is acceptable since WeasyPrint is now primary. -->

</body>
</html>`;
}

async function callApi2Pdf(html: string, fileName: string): Promise<string> {
  const payload = {
      html,
      fileName,
      inline: false,
      inlinePdf: false,
      options: {
        printBackground: true,
        preferCSSPageSize: true,
        format: "A4",
        width: "210mm",
        height: "297mm",
        displayHeaderFooter: false,
        scale: 1,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
        // Do not wait for network-idle: report HTML can contain remote resources,
        // so an idle wait can be held open until the Edge Function times out.
        delay: 0,
        puppeteerWaitForMethod: "WaitForNavigation",
        puppeteerWaitForValue: "load",
      },

    };

  let lastStatus = 0;
  let lastBody = "";
  let lastError = "";
  const startedAt = Date.now();
  for (const endpoint of [
    "https://v2.api2pdf.com/chrome/html",
    "https://v2.api2pdf.com/chrome/pdf/html",
    "https://v2018.api2pdf.com/chrome/html",
    "https://v2018.api2pdf.com/chrome/pdf/html",
  ]) {
    const remaining = MAX_RENDER_WAIT_MS - (Date.now() - startedAt);
    if (remaining <= 5_000) break;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(API2PDF_REQUEST_TIMEOUT_MS, remaining));
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: API2PDF_KEY,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn("[render-investment-report-pdf] Api2PDF request failed", { endpoint, error: lastError });
      break;
    } finally {
      clearTimeout(timeout);
    }

    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }

    lastStatus = res.status;
    lastBody = text;
    lastError = json?.Error || json?.error || "";
    console.log("[render-investment-report-pdf] Api2PDF attempt", {
      endpoint,
      status: res.status,
      success: json?.Success ?? json?.success ?? false,
      hasFileUrl: Boolean(json?.FileUrl || json?.fileUrl || json?.pdf),
      error: lastError || undefined,
    });

    const success = json?.Success === true || json?.success === true;
    const fileUrl = json?.FileUrl || json?.fileUrl || json?.pdf;
    if (res.ok && success && fileUrl) return fileUrl as string;

    if (res.status !== 404) break;
  }

  throw new Error(
    `Api2PDF failed (${lastStatus}): ${lastError || lastBody.slice(0, 400)}`,
  );
}



/**
 * Render via self-hosted WeasyPrint microservice.
 * Returns raw PDF bytes — the caller uploads to Supabase storage and
 * returns a signed URL so behaviour matches the legacy Api2PDF path.
 */
async function callWeasyPrint(html: string): Promise<Uint8Array> {
  const serviceUrl = (Deno.env.get("WEASYPRINT_SERVICE_URL") || "").trim().replace(/\/$/, "");
  const serviceToken = (Deno.env.get("WEASYPRINT_SERVICE_TOKEN") || Deno.env.get("WEASYPRINT_API_KEY") || "").trim().replace(/^["']|["']$/g, "");
  if (!serviceUrl || !serviceToken) {
    throw new Error("WeasyPrint service not configured");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEASYPRINT_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${serviceUrl}/render`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
        Accept: "application/pdf",
      },
      body: JSON.stringify({
        html,
        pdf_variant: "pdf/a-2b",   // Phase 1 #21 — archival, accessible PDF
        tagged: true,
        optimize_images: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      const hint =
        res.status === 401
          ? " (token mismatch — the WEASYPRINT_SERVICE_TOKEN secret in Supabase does not equal the token deployed on the Cloud Run service; update one side to match the other)"
          : "";
      throw new Error(`WeasyPrint render failed (${res.status})${hint}: ${errBody.slice(0, 400)}`);
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Upload, sign, and hand back both.
 *
 * The **path** is the durable half and the signed URL is not: the URL expires
 * in seven days, so a column holding one is a column that is wrong most of the
 * time. The caller stores the path and re-signs on demand.
 */
async function uploadPdfAndSign(
  supabase: ReturnType<typeof createClient>,
  bytes: Uint8Array,
  fileName: string,
): Promise<{ path: string; signedUrl: string }> {
  const path = `generated/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${fileName}`;
  const { error: upErr } = await supabase.storage.from(PDF_BUCKET).upload(path, bytes, {
    contentType: "application/pdf",
    upsert: false,
    cacheControl: "3600",
  });
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);
  const { data: signed, error: signErr } = await supabase
    .storage
    .from(PDF_BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 days
  if (signErr || !signed?.signedUrl) {
    // No public-URL fallback: the bucket is (being made) private, so a public
    // URL would not resolve. Consumers re-sign on demand.
    throw new Error(`signed URL failed: ${signErr?.message || "unknown"}`);
  }
  return { path, signedUrl: signed.signedUrl };
}

/**
 * Record where the file went, so the report can be found again.
 *
 * Until now this function returned a signed URL and wrote nothing back, so
 * `investment_reports.pdf_url` was only ever populated by an older writer that
 * has since stopped: 899 of 1,157 completed reports carry no file reference at
 * all, and the Reports tab hides View / Download / Email entirely when there is
 * none. The report was generated; the row just never remembered it.
 *
 * The **path** is stored, not the signed URL — a seven-day URL in a column read
 * months later is a broken link with extra steps. `parseStorageRef` on the
 * client reads either shape, so the 263 rows already holding a URL keep working.
 *
 * Best-effort: a report that rendered is a success even if the bookkeeping
 * write fails, and failing the request here would throw away a PDF the caller
 * already has a link to.
 */
async function rememberPdfPath(
  supabase: ReturnType<typeof createClient>,
  reportId: string,
  path: string,
): Promise<void> {
  const { error } = await supabase
    .from("investment_reports")
    .update({ pdf_url: path })
    .eq("id", reportId);
  if (error) {
    console.warn(`[render-investment-report-pdf] could not record pdf_url: ${error.message}`);
  }
}


if (import.meta.main) Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const WEASYPRINT_SERVICE_URL = (Deno.env.get("WEASYPRINT_SERVICE_URL") || "").trim();
    const WEASYPRINT_SERVICE_TOKEN = (Deno.env.get("WEASYPRINT_SERVICE_TOKEN") || Deno.env.get("WEASYPRINT_API_KEY") || "").trim().replace(/^["']|["']$/g, "");
    const weasyConfigured = Boolean(WEASYPRINT_SERVICE_URL && WEASYPRINT_SERVICE_TOKEN);
    if (!weasyConfigured && !API2PDF_KEY) {
      throw new Error("No PDF renderer configured (set WEASYPRINT_SERVICE_URL+WEASYPRINT_SERVICE_TOKEN or API2PDF_API_KEY)");
    }

    // Reset module-scoped chart cache each invocation to prevent
    // unbounded growth across warm restarts (root cause of recent OOMs).
    chartImageCache.clear();

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = await req.json();

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) return createUnauthorizedResponse(auth.error || "Authentication required", corsHeaders);

    const { reportId, includeCharts, includeHeroImages, includeSparklines, designOptions } = body;
    if (!reportId || typeof reportId !== "string") {
      return new Response(JSON.stringify({ error: "reportId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const permission = await requireModulePermission(
      supabase,
      { userId: auth.userId, authMethod: auth.authMethod },
      "reports",
      "can_view",
    );
    if (!permission.ok) {
      return createForbiddenResponse(permission.error || "Report view permission required", corsHeaders);
    }

    const { data: report, error } = await supabase
      .from("investment_reports")
      .select(
        "id, property_address, report_content, sources_content, created_at, financial_calculations, investment_score, location_intelligence, demographics_data, report_variant, derived_from_report_id, validation_flags",
      )
      .eq("id", reportId)
      .maybeSingle();

    if (error || !report) {
      return new Response(JSON.stringify({ error: error?.message || "Report not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // RF-7.2B.1A — the client-readiness gate, and the only place `blocking`
    // means anything.
    //
    // This function is the sole producer of the client deliverable: it renders
    // the PDF and writes `pdf_url`, and the client portal serves what it
    // produced (`get-portal-client-data` reads that column, it does not
    // render). Refusing here therefore closes the export, the download and the
    // portal in one place, which is why the gate is here and not in three.
    //
    // Measured before this existed: NO surface read `validation_flags` at all
    // — not this one, not the portal, not the viewer. `severity: 'critical'`
    // was drawn in a different colour and subtracted 15 from a quality score,
    // and nothing anywhere was prevented.
    //
    // The report is NOT deleted, NOT failed and NOT hidden: it stays stored,
    // readable and reviewable with its evidence attached. What it may not do
    // is leave as a finished client document.
    const governedBlock = governedAuthorityBlockFromFlags(
      (report as Record<string, unknown>).validation_flags,
    );
    if (governedBlock.blocked) {
      console.error(
        `⛔ [render-investment-report-pdf] refused ${reportId}: governed-authority block (`
        + `${governedBlock.categories.join(', ')})`,
      );
      return new Response(JSON.stringify({
        error: "report_not_client_ready",
        reason: "governed_authority_block",
        categories: governedBlock.categories,
        message:
          "This report asserts a governed fact it does not hold — a figure was stated for a "
          + "category the report's own record shows as unavailable. It is retained for review "
          + "with its validation evidence, but cannot be issued as a client document until the "
          + "claim is removed or the underlying data becomes available.",
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let brandName = "Investment Report";
    let contact: Record<string, any> = {};
    let disclaimer: { is_enabled?: boolean; text?: string; font_size?: string } = {};
    try {
      const { data: settingsRows } = await supabase
        .from("global_report_settings")
        .select("setting_key, setting_value")
        .in("setting_key", ["contact_details", "professional_disclaimer"]);
      for (const row of (settingsRows as any[]) || []) {
        if (row.setting_key === "contact_details" && row.setting_value) {
          contact = row.setting_value;
          if (contact.company_name) brandName = contact.company_name;
        } else if (row.setting_key === "professional_disclaimer" && row.setting_value) {
          disclaimer = row.setting_value;
        }
      }
    } catch { /* optional */ }


    const html = await buildHtml(report, brandName, {
      includeCharts: includeCharts !== false,
      includeSparklines: includeSparklines !== false,
      includeHeroImages: includeHeroImages === true,
      designOptions,
      contact,
      disclaimer,
    });
    const safeAddr = String(report.property_address || "report")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .slice(0, 60);
    const fileName = `investment-report-${safeAddr}.pdf`;

    // Prefer self-hosted WeasyPrint (superior typography). If it is configured
    // but fails, fail loudly instead of silently returning another Chrome/Api2PDF
    // PDF that looks identical to the old renderer.
    let fileUrl: string | null = null;
    let renderer: "weasyprint" | "api2pdf" = "api2pdf";
    if (weasyConfigured) {
      try {
        const pdfBytes = await callWeasyPrint(html);
        const stored = await uploadPdfAndSign(supabase, pdfBytes, fileName);
        fileUrl = stored.signedUrl;
        await rememberPdfPath(supabase, reportId, stored.path);
        renderer = "weasyprint";
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[render-investment-report-pdf] WeasyPrint failed; Chrome fallback disabled", err);
        throw new Error(`WeasyPrint render failed; Chrome fallback disabled to avoid stale-looking PDFs. ${message}`);
      }
    }
    if (!fileUrl) {
      fileUrl = await callApi2Pdf(html, fileName);
      renderer = "api2pdf";
    }

    return new Response(JSON.stringify({ fileUrl, fileName, renderer }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[render-investment-report-pdf]", err);
    return new Response(JSON.stringify(internalError(err, 'render-investment-report-pdf')), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
