/**
 * Import orchestrator — THE single entry point for every "start from a
 * reference" import. All sources (PDF · image · code/ZIP · live URL · Figma
 * .make/.fig) route through `runReferenceImport`, which owns:
 *   - source classification (`classifyReferenceFile`)
 *   - the per-kind pipelines (engines stay where they were: extractPdfViaDocling,
 *     the design agent, renderAndGroundCode)
 *   - consistent staging callbacks, validation, font-face loading, and
 *     actionable error messages (auth, unconfigured service, …)
 *
 * The dialogs (ReferenceImportDialog, ImportPdfDialog, ResyncPdfDialog) are
 * UI-only shells over this module — fixing an import path here fixes it for
 * every entry point at once. Network access is injectable for unit tests.
 */
import { toast } from 'sonner';
import { parseTemplate, type ReportTemplate } from '../templateSchema';
import {
  type FidelityMode,
  type ImportProgress,
  type ImportResult,
} from '../pdfImport/types';
import { extractPdfViaDocling } from '../pdfImport/extractPdfViaDocling';
import { reconstructPdfWithClaude } from './pdfDocumentReconstruct';
import { renderAndGroundCode, looksLikeJsx, type CodeRenderInput, type InvokeFn } from './codeIngest';
import { codeFlavorForFile } from './detect';
import { detectReferenceKind, validateReconstructedSchema, fileToDataUrl } from '../referenceImport';
import { groundOcrWords, type GroundedReference, type OcrWord } from '../imageGrounding';
import { groundDomBoxTree } from '../codeGrounding';
import { figmaNodesToBoxTree } from '../figmaGrounding';
import { normalizeImportUrl, isHttpUrl, suggestedName } from '../importUrl';
import { extractMakeAssets, isFigmaMakeFile, MAKE_NO_RASTER_GUIDANCE } from './makeImport';
import { convertDocumentToHtml, documentKindForFile } from './docConvert';
import { ensureCatalogFontFaces } from '../fontCatalog';
import { pickInkColor } from '../pdfImport/tokenDerivation';
import { invokeSecureFunction, describeAuthError } from '@/lib/secureInvoke';
import {
  applyTemplateImportPlan,
  assertValidTemplateImportPlan,
  buildBackgroundFirstImportPlan,
  buildHybridImportPlanFromManifests,
  buildRawImportManifests,
  createImageImportAsset,
  reconcileWithFallback,
  TemplateDesignAgentReconciliationClient,
} from './reconciliation';

export type CodeSourceFlavor = ReturnType<typeof codeFlavorForFile>;

// ─── classification ────────────────────────────────────────────────────────────

export type ReferenceImportKind = 'pdf' | 'image' | 'make' | 'code' | 'document' | 'unsupported';

/** One classifier for every file the import surface accepts. */
export function classifyReferenceFile(file: File): ReferenceImportKind {
  if (isFigmaMakeFile(file.name)) return 'make';
  const ref = detectReferenceKind(file);
  if (ref === 'pdf' || ref === 'image') return ref;
  if (documentKindForFile(file)) return 'document';
  return codeFlavorForFile(file.name) ? 'code' : 'unsupported';
}

// ─── request / outcome contracts ───────────────────────────────────────────────

export type ReferenceImportSource =
  | { kind: 'pdf'; file: File; mode: FidelityMode; useClaude?: boolean }
  | { kind: 'image'; file?: File; dataUrl?: string; imageMode: 'reconciled' | 'faithful' | 'redesign' | 'background'; grounded?: GroundedReference }
  | { kind: 'code'; text?: string; filename?: string | null; flavor?: CodeSourceFlavor; zipFile?: File }
  | { kind: 'url'; url: string }
  | { kind: 'make'; file: File }
  | { kind: 'document'; file: File };

export interface ReferenceImportContext {
  /** Editor schema — required by the agent-backed paths (image/url/claude-pdf). */
  schema?: ReportTemplate;
  activePageId?: string | null;
  sampleData?: Record<string, any>;
  /** Resync target. Omit to create a new template (PDF path). */
  templateId?: string;
  templateName?: string;
  userId?: string | null;
  /** PDF imports are Docling-only after Wave F7 legacy retirement. */
  pdfEngine?: 'docling';
  /** Whether the current user is a superadmin. */
  isSuperadmin?: boolean;
  /** Wave F8: request PII redaction in the PDF parser. */
  redactPii?: boolean;
  onStage?: (stage: string) => void;
  onProgress?: (p: ImportProgress) => void;
  /** Injectable network call (tests). Defaults to the secured invoke. */
  invoke?: InvokeFn;
}

export type ReferenceImportOutcome =
  /** PDF pipeline persisted the template server-side (new or resynced). */
  | { type: 'persisted'; message: string; result: ImportResult }
  /** A reconstructed schema to apply in the editor. */
  | { type: 'schema'; schema: ReportTemplate; message: string }
  /** The source resolved to a PDF/image file — re-classify and let the user pick modes. */
  | { type: 'file'; file: File; note?: string };


function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function markdownToPreviewHtml(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:56px;font-family:Inter,ui-sans-serif,system-ui,sans-serif;line-height:1.55;color:#172033;background:#fff}h1{font-size:44px;line-height:1.08;margin:0 0 20px}h2{font-size:30px;margin:28px 0 12px}p,li{font-size:18px}pre{padding:18px;background:#0f172a;color:#e2e8f0;border-radius:14px;overflow:auto}</style></head><body>${lines.map((line) => {
    const t = line.trim();
    if (!t) return '<br />';
    if (t.startsWith('# ')) return `<h1>${escapeHtmlText(t.slice(2))}</h1>`;
    if (t.startsWith('## ')) return `<h2>${escapeHtmlText(t.slice(3))}</h2>`;
    if (/^[-*]\s+/.test(t)) return `<li>${escapeHtmlText(t.replace(/^[-*]\s+/, ''))}</li>`;
    return `<p>${escapeHtmlText(t)}</p>`;
  }).join('')}</body></html>`;
}

function sourceExtension(filename?: string | null): string {
  const name = String(filename || '').toLowerCase().split(/[?#]/)[0];
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
}

function sourceToRenderableHtml(raw: string, filename?: string | null): string {
  const ext = sourceExtension(filename);
  if (ext === 'md' || ext === 'markdown') return markdownToPreviewHtml(raw);
  if (ext === 'json' || ext === 'yaml' || ext === 'yml') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:48px;background:#f8fafc;color:#0f172a;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}pre{white-space:pre-wrap;font-size:16px;line-height:1.5;background:white;border:1px solid #e2e8f0;border-radius:18px;padding:24px;box-shadow:0 18px 40px rgba(15,23,42,.08)}</style></head><body><pre>${escapeHtmlText(raw)}</pre></body></html>`;
  }
  if (ext === 'svg' && /^\s*<svg[\s>]/i.test(raw)) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff}svg{max-width:100%;height:auto}</style></head><body>${raw}</body></html>`;
  }
  return raw;
}

const CSS_SAMPLE_HTML = '<!doctype html><html><body><main class="template-builder-css-sample"><section class="hero"><p class="eyebrow">CSS preview</p><h1>Template style sample</h1><p>Upload paired HTML or a project ZIP for exact content reconstruction.</p><button>Sample CTA</button></section></main></body></html>';

const URL_NEEDS_SERVICE_GUIDANCE = 'Live URL rendering requires the render-source service. Configure RENDER_SOURCE_URL and RENDER_SOURCE_TOKEN, or upload a PDF, image, or other supported file instead.';

const defaultInvoke: InvokeFn = (name, body, options) =>
  invokeSecureFunction(name, body as any, { timeoutMs: options?.timeoutMs ?? 180000 }) as any;

// ─── shared impure helpers (moved out of the dialog) ───────────────────────────

/** base64 → File (documents fetched by URL via the import-from-url function). */
export function base64ToFile(b64: string, filename: string, type: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type });
}

/** Downscale large screenshots before sending them to the design agent. */
export async function prepareImageForDesignAgent(dataUrl: string, maxLongEdge = 1600, jpegQuality = 0.78): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image load failed'));
    image.src = dataUrl;
  });
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (!longest || (longest <= maxLongEdge && dataUrl.length < 1_500_000)) return dataUrl;

  const scale = Math.min(1, maxLongEdge / longest);
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', jpegQuality);
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')}`;
}

/** Dominant-colour palette sampled from the reference image. */
export async function extractImagePalette(dataUrl: string, maxColors = 8): Promise<string[]> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('image load failed'));
      image.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    const sample = 96;
    const scale = Math.min(1, sample / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const buckets = new Map<string, { count: number; r: number; g: number; b: number; sat: number }>();
    for (let i = 0; i < pixels.length; i += 16) {
      const a = pixels[i + 3];
      if (a < 32) continue;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if ((lum > 0.96 || lum < 0.04) && sat < 0.12) continue;
      const key = `${Math.round(r / 24)}:${Math.round(g / 24)}:${Math.round(b / 24)}`;
      const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0, sat: 0 };
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.sat += sat;
      buckets.set(key, bucket);
    }
    return Array.from(buckets.values())
      .sort((a, b) => (b.count * (1 + b.sat / Math.max(1, b.count))) - (a.count * (1 + a.sat / Math.max(1, a.count))))
      .slice(0, maxColors)
      .map((bucket) => rgbToHex(bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count));
  } catch (e) {
    console.warn('[import] palette extraction failed', e);
    return [];
  }
}

/** OCR grounding with per-word ink-colour sampling (R5 + colour ground truth). */
export async function ocrImageWords(dataUrl: string): Promise<{ words: OcrWord[]; width: number; height: number } | null> {
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('image load failed'));
      im.src = dataUrl;
    });
    const tess: any = await import(/* @vite-ignore */ 'tesseract.js');
    const worker = await tess.createWorker('eng');
    const { data } = await worker.recognize(dataUrl);
    await worker.terminate();

    let sampleCtx: CanvasRenderingContext2D | null = null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      sampleCtx = canvas.getContext('2d', { willReadFrequently: true });
      sampleCtx?.drawImage(img, 0, 0);
    } catch { /* colour sampling is best-effort */ }
    const sampleInk = (x0: number, y0: number, x1: number, y1: number): string | undefined => {
      if (!sampleCtx) return undefined;
      try {
        const px = sampleCtx.getImageData(
          Math.max(0, Math.floor(x0)),
          Math.max(0, Math.floor(y0)),
          Math.max(1, Math.ceil(x1 - x0)),
          Math.max(1, Math.ceil(y1 - y0)),
        );
        return pickInkColor(px.data);
      } catch { return undefined; }
    };

    const words: OcrWord[] = (data?.words ?? [])
      .filter((w: any) => w?.text?.trim())
      .map((w: any) => {
        const x0 = w.bbox?.x0 ?? 0, y0 = w.bbox?.y0 ?? 0, x1 = w.bbox?.x1 ?? 0, y1 = w.bbox?.y1 ?? 0;
        const color = sampleInk(x0, y0, x1, y1);
        return { text: w.text, x0, y0, x1, y1, ...(color ? { color } : {}) };
      });
    return { words, width: img.naturalWidth, height: img.naturalHeight };
  } catch (e) {
    console.warn('[import] OCR grounding failed', e);
    return null;
  }
}

// ─── per-kind pipelines ────────────────────────────────────────────────────────

async function importPdf(
  source: Extract<ReferenceImportSource, { kind: 'pdf' }>,
  ctx: ReferenceImportContext,
): Promise<ReferenceImportOutcome> {
  if (source.useClaude) {
    if (!ctx.schema) throw new Error('Claude PDF reconstruction needs the open template (schema) in context.');
    ctx.onStage?.('Reading the PDF with Claude…');
    const dataUrl = await fileToDataUrl(source.file);
    const pdfBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const invoke = ctx.invoke ?? defaultInvoke;
    // Ground the model in what the file states. A PDF carries each run's
    // baseline and advance width exactly; reading them off a rendered page is
    // the one thing a model is genuinely bad at. Measured from the ATTACHED
    // bytes — never from the open template, whose overlays may have come from a
    // different document, and measurements from the wrong document are worse
    // than none. Degrades to no measurements, which is the behaviour that
    // shipped before this existed.
    ctx.onStage?.('Measuring the PDF…');
    const { groundPdfDocument } = await import('../pdfImport/groundPdfDocument');
    const grounding = await groundPdfDocument(source.file.arrayBuffer
      ? new Uint8Array(await source.file.arrayBuffer())
      : pdfBase64);
    if (grounding.pages.length) {
      const measured = grounding.pages.reduce((n, p) => n + p.reference.elements.length, 0);
      ctx.onStage?.(`Grounding Claude in ${measured} measured text line${measured === 1 ? '' : 's'} across ${grounding.pages.length} page${grounding.pages.length === 1 ? '' : 's'}…`);
    } else {
      ctx.onStage?.('Reading the PDF with Claude…');
    }
    const res = await reconstructPdfWithClaude(
      {
        pdfBase64, schema: ctx.schema, activePageId: ctx.activePageId,
        sampleData: ctx.sampleData, grounding,
      },
      invoke as any,
    );
    return {
      type: 'schema',
      schema: ensureCatalogFontFaces(res.schema),
      message: `Reconstructed ${res.pageCount} page${res.pageCount === 1 ? '' : 's'} from the PDF${res.modelUsed ? ` · ${res.modelUsed}` : ''}.${res.warnings.length ? ` ${res.warnings.length} warning(s).` : ''}`,
    };
  }

  ctx.onStage?.('Reading PDF…');
  // Phase 10: route through the multi-service dispatcher so recoverable
  // failures escalate transparently to the pixel fallback.
  // The audit trail is persisted to template_imports.meta.provider_attempts
  // for the diagnostics dashboard.
  const { dispatchImport } = await import('../pdfImport/providers/dispatch');
  const dispatched = await dispatchImport(source.file, {
    mode: source.mode,
    templateName: ctx.templateName,
    userId: ctx.userId ?? null,
    targetTemplateId: ctx.templateId,
    onProgress: ctx.onProgress,
    redactPii: ctx.redactPii,
    onAttempt: (a) => {
      if (a.outcome === 'failure' && a.error) {
        ctx.onStage?.(`Provider "${a.providerId}" failed (${a.error.kind}) — trying fallback…`);
      } else if (a.outcome === 'success') {
        ctx.onStage?.(`Imported via "${a.providerId}".`);
      }
    },
  });
  const result = dispatched.result;
  return {
    type: 'persisted',
    result,
    message: ctx.templateId
      ? 'PDF re-synced. Previous version snapshotted to History.'
      : `Imported ${result.pageCount} page${result.pageCount === 1 ? '' : 's'} from the PDF${dispatched.usedFallback ? ` (via fallback after ${dispatched.attempts.length - 1} attempt${dispatched.attempts.length === 2 ? '' : 's'})` : ''}.`,
  };
}


/** Faithful/redesign screenshot reconstruction through the design agent. */
async function reconstructImage(
  dataUrl: string,
  imageMode: 'faithful' | 'redesign',
  ctx: ReferenceImportContext,
  preGrounded?: GroundedReference,
): Promise<ReferenceImportOutcome> {
  if (!ctx.schema) throw new Error('Image reconstruction needs the open template (schema) in context.');
  ctx.onStage?.('Optimising image for reconstruction…');
  const agentImageDataUrl = await prepareImageForDesignAgent(dataUrl);
  const colorPalette = await extractImagePalette(agentImageDataUrl);

  let groundedReference = preGrounded;
  if (!groundedReference && imageMode === 'faithful') {
    ctx.onStage?.('Measuring text (OCR)…');
    const ocr = await ocrImageWords(agentImageDataUrl);
    if (ocr && ocr.words.length) groundedReference = groundOcrWords(ocr.words, ocr.width, ocr.height);
  }

  const paletteInstruction = colorPalette.length
    ? ` Dominant source colours detected: ${colorPalette.join(', ')}. Use these exact hex colours for backgrounds, fills, accents, borders, and text where they match the image; do not default to black and white.`
    : '';
  const instruction = imageMode === 'faithful'
    ? `Reconstruct this reference faithfully as editable native blocks on the active page. Transcribe the text exactly and keep the measured positions — do not redesign or rewrite.${paletteInstruction}`
    : `Use this reference as inspiration to (re)design the active page.${paletteInstruction}`;
  ctx.onStage?.(imageMode === 'faithful'
    ? `Reconstructing faithfully…${groundedReference ? ` (${groundedReference.elements.length} measured elements)` : ''}`
    : 'Redesigning with AI… this can take ~20–40s');

  const invoke = ctx.invoke ?? defaultInvoke;
  const { data, error } = await invoke('template-design-agent', {
    schema: ctx.schema,
    messages: [{ role: 'user', content: instruction }],
    instruction,
    activePageId: ctx.activePageId,
    mode: imageMode === 'faithful' ? 'screenshot_to_block' : 'design',
    imageDataUrl: agentImageDataUrl,
    ...(groundedReference ? { groundedReference } : {}),
    sourcePalette: colorPalette,
    sampleData: ctx.sampleData,
  }, { timeoutMs: 180000 });
  if (error) throw new Error(describeAuthError(error.message) ?? error.message);
  if ((data as any)?.error) throw new Error(describeAuthError(String((data as any).error)) ?? String((data as any).error));
  const reconstructed = (data as any)?.schema;
  const validation = validateReconstructedSchema(reconstructed);
  if (!validation.ok) throw new Error(`Reconstruction was not usable: ${validation.errors.join(' ')}`);
  const warnings: string[] = (data as any)?.warnings ?? [];
  const modelUsed = (data as any)?.modelUsed;
  const measured = groundedReference ? ` from ${groundedReference.elements.length} measured element(s)` : '';
  return {
    type: 'schema',
    schema: ensureCatalogFontFaces(parseTemplate(reconstructed)),
    message: `${imageMode === 'faithful' ? 'Reconstructed' : 'Redesigned'} ${validation.pageCount} page${validation.pageCount === 1 ? '' : 's'}${measured}${modelUsed ? ` · ${modelUsed}` : ''}.${warnings.length ? ` ${warnings.length} warning(s) — review in the Design Agent.` : ''}`,
  };
}

async function reconcileImageImport(
  dataUrl: string,
  ctx: ReferenceImportContext,
  preGrounded?: GroundedReference,
): Promise<ReferenceImportOutcome> {
  ctx.onStage?.('Preparing background-first reconciliation…');
  const dims = await measureImage(dataUrl);
  const asset = createImageImportAsset({
    dataUrl,
    imageWidth: dims.width,
    imageHeight: dims.height,
    fileName: ctx.templateName ?? 'Imported reference',
  });

  ctx.onStage?.('Sampling palette and measuring editable text…');
  const agentImageDataUrl = await prepareImageForDesignAgent(dataUrl);
  const colorPalette = await extractImagePalette(agentImageDataUrl);
  let groundedReference = preGrounded;
  if (!groundedReference) {
    const ocr = await ocrImageWords(agentImageDataUrl);
    if (ocr && ocr.words.length) groundedReference = groundOcrWords(ocr.words, ocr.width, ocr.height);
  }

  const manifests = buildRawImportManifests(asset, { palette: colorPalette, grounded: groundedReference });
  const fallbackPlan = assertValidTemplateImportPlan(buildHybridImportPlanFromManifests(asset, manifests, {
    importId: asset.fileId,
  }));
  const providerWarnings: string[] = [];
  ctx.onStage?.('Reconciling layout to template schema…');
  const plan = await reconcileWithFallback(
    new TemplateDesignAgentReconciliationClient((ctx.invoke ?? defaultInvoke) as any),
    { importAsset: asset, manifests, existingTemplate: ctx.schema, constraints: { mode: 'hybrid-image-import' } },
    fallbackPlan,
    (message) => providerWarnings.push(message),
  );
  const schema = applyTemplateImportPlan(plan, {
    templateName: ctx.templateName ?? 'Reconciled import',
    baseTemplate: ctx.schema,
    activePageId: ctx.activePageId,
  });
  return {
    type: 'schema',
    schema: ensureCatalogFontFaces(schema),
    message: `Reconciled ${plan.pages.length} page${plan.pages.length === 1 ? '' : 's'} with locked reference background and ${plan.importSummary.editableElementsCreated} editable text overlay${plan.importSummary.editableElementsCreated === 1 ? '' : 's'}.${plan.warnings.length ? ` ${plan.warnings.length} warning(s) need review.` : ''}${providerWarnings.length ? ' AI reconciliation fell back to deterministic OCR.' : ''}`,
  };
}

/**
 * "Import as background" (pure): place the image as the active page's locked
 * background, sized to the image's aspect ratio. The advisor-model safest
 * tier — exact visual fidelity, user adds editable fields on top, no AI.
 */
export function buildImageBackgroundSchema(args: {
  schema?: ReportTemplate;
  activePageId?: string | null;
  dataUrl: string;
  imageWidth: number;
  imageHeight: number;
  templateName?: string;
}): ReportTemplate {
  const asset = createImageImportAsset({
    dataUrl: args.dataUrl,
    imageWidth: args.imageWidth,
    imageHeight: args.imageHeight,
    fileName: args.templateName ?? 'Imported background',
    fileId: 'imported_background',
  });
  const plan = assertValidTemplateImportPlan(buildBackgroundFirstImportPlan(asset, {
    importId: 'imported_background',
    pageNamePrefix: 'Imported page',
  }));
  const firstPage = plan.pages[0];

  if (args.schema?.pages?.length) {
    const targetId = args.activePageId ?? args.schema.pages[0].id;
    return parseTemplate({
      ...args.schema,
      pages: args.schema.pages.map((page) => page.id === targetId
        ? {
            ...page,
            size: { width: firstPage.width, height: firstPage.height },
            background: { ...(page.background ?? {}), imageUrl: firstPage.background.imageUrl },
          }
        : page),
    });
  }

  return applyTemplateImportPlan(plan, { templateName: args.templateName ?? 'Imported background' });
}

function measureImage(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('image load failed'));
    image.src = dataUrl;
  });
}

async function importImage(
  source: Extract<ReferenceImportSource, { kind: 'image' }>,
  ctx: ReferenceImportContext,
): Promise<ReferenceImportOutcome> {
  ctx.onStage?.('Reading image…');
  const dataUrl = source.dataUrl ?? (source.file ? await fileToDataUrl(source.file) : null);
  if (!dataUrl) throw new Error('No image supplied.');
  if (source.imageMode === 'background') {
    // Safest tier: exact look, zero AI — page background is inherently locked.
    const dims = await measureImage(dataUrl);
    const schema = buildImageBackgroundSchema({
      schema: ctx.schema,
      activePageId: ctx.activePageId,
      dataUrl,
      imageWidth: dims.width,
      imageHeight: dims.height,
      templateName: ctx.templateName,
    });
    return {
      type: 'schema',
      schema,
      message: 'Placed the image as the page background (exact look, locked). Add editable text, images, and fields on top.',
    };
  }
  if (source.imageMode === 'reconciled') {
    return reconcileImageImport(dataUrl, ctx, source.grounded);
  }
  return reconstructImage(dataUrl, source.imageMode, ctx, source.grounded);
}

async function importCode(
  source: Extract<ReferenceImportSource, { kind: 'code' }>,
  ctx: ReferenceImportContext,
): Promise<ReferenceImportOutcome> {
  // Untrusted source code must only execute in the isolated render service,
  // never in the authenticated user's browser or network context.
  const invoke = ctx.invoke ?? defaultInvoke;

  let input: CodeRenderInput;
  let label: string;
  if (source.zipFile) {
    ctx.onStage?.('Building project…');
    const dataUrl = await fileToDataUrl(source.zipFile);
    input = { zipBase64: dataUrl.slice(dataUrl.indexOf(',') + 1), sourceFilename: source.zipFile.name };
    label = source.zipFile.name;
  } else {
    const raw = (source.text ?? '').trim();
    if (!raw) throw new Error('Paste a URL, HTML, CSS, or a component source first.');
    const asUrl = isHttpUrl(raw);
    const flavor = source.flavor ?? (source.filename ? codeFlavorForFile(source.filename) : null);
    const isCssOnly = !asUrl && flavor === 'css';
    const ext = sourceExtension(source.filename);
    const isJsx = !asUrl && !isCssOnly && (looksLikeJsx(raw) || flavor === 'jsx' || flavor === 'tsx' || (flavor === 'astro' && ext !== 'astro'));
    const htmlSource = sourceToRenderableHtml(raw, source.filename);
    input = asUrl
      ? { url: raw }
      : isCssOnly
        ? { html: CSS_SAMPLE_HTML, css: raw, sourceFilename: source.filename ?? 'style.css' }
        : isJsx
          ? { jsx: raw, sourceFilename: source.filename ?? undefined }
          : { html: htmlSource, sourceFilename: source.filename ?? undefined };
    label = source.filename ?? (asUrl ? 'URL' : isJsx ? 'JSX' : isCssOnly ? 'CSS' : 'HTML');
    ctx.onStage?.(asUrl ? 'Rendering page…' : isCssOnly ? 'Rendering CSS preview…' : isJsx ? 'Rendering component…' : 'Rendering HTML…');
  }

  const result = await renderAndGroundCode(input, invoke);
  ctx.onStage?.(`Building editable template… (${result.cdir.pages.length} page${result.cdir.pages.length === 1 ? '' : 's'})`);
  const validation = validateReconstructedSchema(result.editableTemplate);
  if (!validation.ok) throw new Error(`Code import was not usable: ${validation.errors.join(' ')}`);
  const fidelity = result.cdirFidelity;
  const score = Math.round(fidelity.overallScore * 100);
  const traceNote = fidelity.rasterFallbackCoverage > 0
    ? ` Trace rasters retained for review (${Math.round(fidelity.rasterFallbackCoverage * 100)}% fallback coverage).`
    : '';
  const warnings = fidelity.warnings.length ? ` ${fidelity.warnings.length} fidelity warning(s) — review imported layers before saving.` : '';
  return {
    type: 'schema',
    schema: ensureCatalogFontFaces(result.editableTemplate),
    message: `Imported ${validation.pageCount} editable page${validation.pageCount === 1 ? '' : 's'} from ${label} · fidelity ${score}%.${traceNote}${warnings}`,
  };
}

/**
 * Word / plain-text / RTF documents: convert to semantic HTML, then reuse the
 * C1 code pipeline (render → measure → CDIR editable pages) so the document is
 * replicated onto the canvas exactly like an HTML import.
 */
async function importDocument(
  source: Extract<ReferenceImportSource, { kind: 'document' }>,
  ctx: ReferenceImportContext,
): Promise<ReferenceImportOutcome> {
  ctx.onStage?.(`Converting ${source.file.name}…`);
  const converted = await convertDocumentToHtml(source.file);
  return importCode({ kind: 'code', text: converted.html, filename: converted.filename, flavor: 'html' }, ctx);
}

async function importUrlSource(
  source: Extract<ReferenceImportSource, { kind: 'url' }>,
  ctx: ReferenceImportContext,
): Promise<ReferenceImportOutcome> {
  const raw = source.url.trim();
  if (!isHttpUrl(raw)) throw new Error('Enter a valid http(s) link.');
  const norm = normalizeImportUrl(raw);
  if ((norm.provider === 'canva' || norm.provider === 'gamma') && norm.needsExport) {
    throw new Error(norm.guidance ?? 'This app has no public file link — export to PDF and paste that link.');
  }
  ctx.onStage?.('Fetching link…');
  const invoke = ctx.invoke ?? defaultInvoke;
  const { data, error } = await invoke('import-from-url', {
    url: raw, fetchUrl: norm.fetchUrl, provider: norm.provider, resourceId: norm.resourceId, expectedKind: norm.expectedKind,
  }, { timeoutMs: 120000 });
  if (error) throw new Error(describeAuthError(error.message) ?? error.message);
  const d = data as any;
  if (d?.error) throw new Error(describeAuthError(String(d.error)) ?? String(d.error));
  if (d?.kind === 'needs_export') throw new Error(d.guidance ?? 'This link needs a PDF/image export.');
  if (!d?.dataBase64) {
    // Live web pages have no file payload, so they require the render service.
    throw new Error(URL_NEEDS_SERVICE_GUIDANCE);
  }

  // Figma: ground on the real node tree (hierarchy-accurate) when present.
  if (d.provider === 'figma' && d.figmaFrame) {
    try {
      const grounded = groundDomBoxTree(figmaNodesToBoxTree(d.figmaFrame));
      if (grounded.elements.length) {
        const pngDataUrl = `data:${d.contentType || 'image/png'};base64,${d.dataBase64}`;
        return await reconstructImage(pngDataUrl, 'faithful', ctx, grounded);
      }
    } catch (e) {
      console.warn('[import] figma hierarchy grounding failed; using image flow', e);
    }
  }

  const ext = d.kind === 'pdf' ? 'pdf' : 'png';
  const name = d.filename || `${suggestedName(raw, norm.provider)}.${ext}`;
  return {
    type: 'file',
    file: base64ToFile(d.dataBase64, name, d.contentType || (d.kind === 'pdf' ? 'application/pdf' : 'image/png')),
  };
}

async function importMake(
  source: Extract<ReferenceImportSource, { kind: 'make' }>,
  ctx: ReferenceImportContext,
): Promise<ReferenceImportOutcome> {
  ctx.onStage?.('Unpacking Figma export…');
  const assets = await extractMakeAssets(new Uint8Array(await source.file.arrayBuffer()));
  let best: { file: File; area: number } | null = null;
  for (const img of assets.images) {
    try {
      const candidate = new File([img.bytes.slice().buffer as ArrayBuffer], img.name.split('/').pop() || 'page.png', { type: img.mime });
      const url = URL.createObjectURL(candidate);
      const area = await new Promise<number>((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image.naturalWidth * image.naturalHeight);
        image.onerror = () => resolve(0);
        image.src = url;
      });
      URL.revokeObjectURL(url);
      if (area >= 64 * 64 && (!best || area > best.area)) best = { file: candidate, area };
    } catch { /* skip undecodable entries */ }
  }
  if (!best) throw new Error(MAKE_NO_RASTER_GUIDANCE);
  return {
    type: 'file',
    file: best.file,
    note: `Loaded the export's page raster${assets.title ? ` from “${assets.title}”` : ''} — choose a reconstruction mode.`,
  };
}

// ─── the single entry point ────────────────────────────────────────────────────

export async function runReferenceImport(
  source: ReferenceImportSource,
  ctx: ReferenceImportContext,
): Promise<ReferenceImportOutcome> {
  switch (source.kind) {
    case 'pdf': return importPdf(source, ctx);
    case 'image': return importImage(source, ctx);
    case 'code': return importCode(source, ctx);
    case 'url': return importUrlSource(source, ctx);
    case 'make': return importMake(source, ctx);
    case 'document': return importDocument(source, ctx);
  }
}

/** Surface a non-blocking note (kept here so dialogs stay UI-only). */
export function announceImportNote(note: string) {
  toast.info(note);
}
