import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The Investment client-PDF journey reaches the print engine in exactly one
 * place, for exactly one purpose: the FINAL document.
 *
 * RS-2 (14 Sep 2026) brought WeasyPrint back onto this journey after RC-3.1
 * had taken it off. RV-1 measured why: the browser renderer embeds no fonts,
 * so a chosen template's headline figures drew illegibly, and it cannot draw
 * text on a filled panel at all. The print engine can. But the reason it was
 * taken off still stands — a render service reached from a preview, an edit
 * or a page load is a cost with no deliberate act behind it — so what this
 * pins is the BOUNDARY rather than the absence:
 *
 *   * one client module names the function (`weasyRenderClient`);
 *   * one journey module imports that client (`routeReportThroughTemplate`);
 *   * one call site asks for a `final` render, and it is that route's;
 *   * no preview surface can reach it, and no Cloud Run host is addressed
 *     from the browser at all — the engine sits behind the edge function.
 *
 * Asked of the MODULE GRAPH rather than of a directory: `deliverInvestmentPdf`
 * is the one contract every surface calls, so walking its imports answers the
 * question a `grep src/` cannot — Template Builder keeps its own preview and
 * export paths in the same repository, and the point is that a client PDF
 * never needs them.
 */
const ROOT = path.resolve(__dirname, '../../../../..');
const SRC = path.join(ROOT, 'src');

const ENTRY_POINTS = [
  'src/lib/reports/investment/deliverInvestmentPdf.ts',
  'src/components/reports/PremiumPdfButton.tsx',
];

/**
 * INVOKED, not mentioned.
 *
 * The discriminator has to be the call shape rather than the name: the shared
 * broker `secureInvoke.ts` is on this path and legitimately COMPARES against
 * both route names inside its render-coverage telemetry — classifying a call
 * somebody else makes is the opposite of making one.
 */
const callsRoute = (src: string, route: string): boolean =>
  new RegExp(
    String.raw`(?:invokeSecureFunction|functions\s*\.\s*invoke|invokeFunction)\s*(?:<[^>]*>)?\s*\(\s*['"\`]`
    + route.replace(/[-]/g, '\\-') + String.raw`['"\`]`,
  ).test(src);
/** A Cloud Run host, or the variable that names one, reached from a request. */
const CLOUD_RUN = /(?:fetch|axios|request)\s*\([^)]{0,200}?(?:\.run\.app|WEASYPRINT_SERVICE_URL)/;

/** Comments are stripped: a module may quote a name in order to forbid it. */
const codeOf = (file: string): string => fs.readFileSync(file, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const EXTS = ['.ts', '.tsx', '/index.ts', '/index.tsx', '.d.ts'];

function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // a package, not our source
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of EXTS) {
    const candidate = base.endsWith('.ts') || base.endsWith('.tsx') ? base : base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s*['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

function closureOf(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = entries.map((e) => path.join(ROOT, e));
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const re of [IMPORT_RE, DYNAMIC_RE]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const next = resolveSpecifier(m[1], file);
        if (next && !seen.has(next)) queue.push(next);
      }
    }
  }
  return seen;
}

const rel = (f: string) => path.relative(ROOT, f);

const RENDER_CLIENT = 'src/lib/reportTemplate/weasyRenderClient.ts';
const ROUTE = 'src/lib/reportTemplate/routeReportThroughTemplate.ts';

describe('the Investment client-PDF journey', () => {
  const closure = closureOf(ENTRY_POINTS);
  const files = [...closure].map(rel);

  it('reaches a real module graph, with both renderers on it', () => {
    expect(closure.size).toBeGreaterThan(20);
    expect(files).toContain('src/lib/reports/investment/investmentPdfDocument.ts');
    expect(files).toContain('src/lib/reportTemplate/pdfRenderer.ts');
    expect(files).toContain(ROUTE);
    expect(files).toContain(RENDER_CLIENT);
    expect(files).toContain('src/lib/reportTemplate/compileTemplateForPdf.ts');
  });

  it('invokes the print engine from ONE module, and the legacy renderer from none', () => {
    const invokers = [...closure].filter((f) => callsRoute(codeOf(f), 'render-template-pdf')).map(rel);
    expect(invokers).toEqual([RENDER_CLIENT]);
    const legacy = [...closure].filter((f) => callsRoute(codeOf(f), 'render-investment-report-pdf')).map(rel);
    expect(legacy).toEqual([]);
  });

  it('that module is imported by the route alone', () => {
    const importers = [...closure]
      .filter((f) => /from\s*['"][^'"]*reportTemplate\/weasyRenderClient['"]/.test(codeOf(f)))
      .map(rel);
    expect(importers).toEqual([ROUTE]);
  });

  it('asks for a FINAL render from exactly one call site — the route’s', () => {
    // The literal property, with its trailing comma, is the call site; the
    // client's own interface declares the same word with a semicolon and is
    // a type, not a request.
    const askers = [...closure].filter((f) => /mode:\s*'final'\s*,/.test(codeOf(f))).map(rel);
    expect(askers).toEqual([ROUTE]);
  });

  it('addresses no Cloud Run host from the browser', () => {
    // The engine is behind the edge function. A browser that could name the
    // container would carry its URL in every bundle and skip the gate the
    // function applies to a final document.
    const offenders = [...closure].filter((f) => CLOUD_RUN.test(codeOf(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('never pulls in Template Builder or its preview client', () => {
    const offenders = files.filter((f) => f.includes('templateBuilder/') || f.includes('reportTemplate/weasyPreview'));
    expect(offenders).toEqual([]);
  });

  /**
   * The discriminator above is only trustworthy if it can still see a real
   * call, so it is exercised against one: Template Builder's export dialog
   * genuinely posts to `render-template-pdf` and is NOT on this journey.
   */
  it('would still recognise a real invocation elsewhere', () => {
    const dialog = fs.readFileSync(
      path.join(ROOT, 'src/components/templateBuilder/ExportPipelineDialog.tsx'), 'utf8',
    );
    expect(callsRoute(dialog, 'render-template-pdf')).toBe(true);
    expect(files).not.toContain('src/components/templateBuilder/ExportPipelineDialog.tsx');
  });
});

/**
 * The surfaces a person looks at BEFORE finalising — the Templates page and
 * the in-editor preview — draw nothing through the engine. A preview is HTML
 * in an iframe (the same renderer's output, at no cost), and the Builder's own
 * PDF preview names its mode out loud.
 */
describe('no preview reaches the print engine', () => {
  const PREVIEW_SURFACES = [
    'src/components/templateLibrary/TemplateDocumentPreview.tsx',
    'src/components/reports/ReportTemplatePicker.tsx',
    'src/components/reports/ReportTemplateSheet.tsx',
  ];

  it.each(PREVIEW_SURFACES)('%s draws without the render service', (entry) => {
    const closure = closureOf([entry]);
    const invokers = [...closure].filter((f) => callsRoute(codeOf(f), 'render-template-pdf')).map(rel);
    expect(invokers).toEqual([]);
    expect([...closure].map(rel)).not.toContain(RENDER_CLIENT);
  });

  it('the Builder’s PDF preview asks for a preview, never a final document', () => {
    const hook = codeOf(path.join(ROOT, 'src/hooks/templateBuilder/useWeasyPdfPreview.ts'));
    expect(hook).toMatch(/mode:\s*'preview'/);
    expect(hook).not.toMatch(/mode:\s*'final'/);
  });
});

/**
 * One finalisation, one stored PDF: the function stores the document in the
 * bucket the portal reads from, and answers the path, so the publish step
 * points at those bytes rather than uploading a copy.
 */
describe('the stored document is the one the portal serves', () => {
  const fn = fs.readFileSync(
    path.join(ROOT, 'supabase/functions/render-template-pdf/index.ts'), 'utf8',
  );
  const deliver = fs.readFileSync(
    path.join(ROOT, 'src/lib/reports/investment/deliverInvestmentPdf.ts'), 'utf8',
  );

  it('both ends name the same bucket', () => {
    const fnBucket = /const PDF_BUCKET = '([^']+)'/.exec(fn)?.[1];
    const clientBucket = /const STORAGE_BUCKET = '([^']+)'/.exec(deliver)?.[1];
    expect(fnBucket).toBeTruthy();
    expect(clientBucket).toBe(fnBucket);
  });

  it('the function answers the path it stored, and the client reuses it', () => {
    // The response carries `path` beside the signed URL …
    expect(fn).toMatch(/JSON\.stringify\(\{\s*url:\s*signed\.signedUrl,[\s\S]{0,400}?\bpath,/);
    // … and a final render's job row is stamped with the report it was of.
    expect(fn).toMatch(/report_id:\s*reportIdForLedger/);
    // The publish step takes that path instead of uploading a second copy.
    expect(deliver).toMatch(/if \(doc\.storagePath\)\s*\{[\s\S]{0,400}?storedPath = doc\.storagePath/);
  });
});
