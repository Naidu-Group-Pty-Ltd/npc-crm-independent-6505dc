/**
 * The five legacy Q&A export paths are not deprecated.
 *
 * The new document is added beside them, not in place of them. That matters more
 * for this format than for any other in the programme, because there are more
 * paths and they are not equivalent: three jsPDF copies of one template, a
 * pdf-lib transcript in the edge function, and a hand-assembled `%PDF-1.4` string
 * with no caller. Removing any of them is a decision, and this spec is what makes
 * it one rather than an accident.
 *
 * These assertions read source rather than behaviour on purpose. What is being
 * guarded is that the code still exists and is still wired up — which no unit
 * test of the new modules can see.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');

const CONVERSATION_EDITOR = 'src/components/report-qa/ConversationReportEditor.tsx';
const MESSAGE_EDITOR = 'src/components/report-qa/MessageReportEditor.tsx';
const CONVERSATION_EXPORT = 'src/components/report-qa/ConversationExport.tsx';
const REPORT_QA_PAGE = 'src/pages/ReportQA.tsx';
const EDGE_FUNCTION = 'supabase/functions/report-qa/index.ts';

describe('the jsPDF generators stay', () => {
  it.each([
    ['the conversation editor', CONVERSATION_EDITOR],
    ['the message editor', MESSAGE_EDITOR],
  ])('%s still draws with jsPDF', (_label, path) => {
    const source = read(path);
    expect(source).toContain('jspdf');
    expect(source).toContain('new jsPDF');
    expect(source).toMatch(/doc\.save\(/);
  });

  /**
   * `QAPDFGenerator` was dead code — nothing imported it, and this spec
   * recorded that fact for two migrations so that its removal would be a
   * decision rather than an accident. The legacy-consolidation phase made the
   * decision: the file is deleted, and this assertion now records the deletion
   * so nobody restores it from history to "fix" an import that never existed.
   * The two editors above export a *different* document (their user-edited
   * content), which is why they stay while the orphan went.
   */
  it('records that the orphaned template was deleted, not merely unreferenced', () => {
    expect(existsSync(resolve(REPO, 'src/components/reports/QAPDFGenerator.tsx'))).toBe(false);
  });
});

describe('the server paths stay', () => {
  const edge = read(EDGE_FUNCTION);

  it('still offers generate-qa-pdf, drawn with pdf-lib', () => {
    expect(edge).toContain("action === \"generate-qa-pdf\"");
    expect(edge).toContain('pdf-lib');
    expect(edge).toContain('qa_exports');
  });

  it('still offers summarize-conversation', () => {
    expect(edge).toContain("action === \"summarize-conversation\"");
    expect(edge).toContain('structuredReport');
  });
});

describe('the raw exports stay', () => {
  const source = read(CONVERSATION_EXPORT);

  it.each([
    ['text/plain', 'exportAsText'],
    ['text/markdown', 'exportAsMarkdown'],
    ['text/csv', 'exportAsCSV'],
    ['application/json', 'exportAsJSON'],
  ])('still exports %s', (mime, fn) => {
    expect(source).toContain(fn);
    expect(source).toContain(mime);
  });

  /**
   * The `.md` export is not incidental. It is uncapped, and it is what the
   * typeset document's own truncation callout points at — so if it went away the
   * new document would be telling readers to use something that no longer
   * exists.
   */
  it('is what the truncation notice points at', () => {
    const render = read('supabase/functions/_shared/reports/reportQa/render.pure.ts');
    expect(render).toContain('Markdown and plain-text exports');
    expect(source).toContain('text/markdown');
    expect(source).toContain('text/plain');
  });
});

describe('the new control is additive', () => {
  it.each([
    ['the chat toolbar', REPORT_QA_PAGE],
    ['the export dropdown', CONVERSATION_EXPORT],
    ['the message editor', MESSAGE_EDITOR],
  ])('mounts beside the legacy on %s', (_label, path) => {
    expect(read(path)).toContain('ReportQaDownloadButton');
  });

  it('leaves the toolbar Export PDF button calling generate-qa-pdf', () => {
    const page = read(REPORT_QA_PAGE);
    expect(page).toContain("action: 'generate-qa-pdf'");
    expect(page).toContain('handleGeneratePDFAttachment');
  });

  it('leaves both editors exporting their own PDF and markdown', () => {
    for (const path of [CONVERSATION_EDITOR, MESSAGE_EDITOR]) {
      expect(read(path)).toContain('exportAsPDF');
      expect(read(path)).toContain('exportAsMarkdown');
    }
  });
});

describe('the new modules draw no PDF', () => {
  it.each(['markdown', 'normalise', 'payload', 'render', 'route', 'sections'])(
    '%s.pure.ts imports no PDF library',
    (name) => {
      const source = read(`supabase/functions/_shared/reports/reportQa/${name}.pure.ts`);
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec).not.toMatch(/jspdf|pdf-lib|html2canvas/i);
      }
    },
  );
});

describe('the control hands back the bytes', () => {
  /**
   * Not a substring check on the file.
   *
   * The Client Details spec asserted `toContain('blob: Blob')` and passed while
   * the thing it guarded was broken, because a *different* function two
   * definitions away had a parameter of that name. This matches the returned
   * object and the property on it.
   */
  it('returns a Blob from deliverReportQaPdf', () => {
    const source = read('src/lib/reports/reportQa/deliverReportQaPdf.ts');
    const returned = /return \{([\s\S]*?)\n {2}\};/.exec(source)?.[1] ?? '';
    expect(returned).toContain('blob,');
    expect(source).toMatch(/export interface DeliveredReportQa \{[\s\S]*?blob: Blob;[\s\S]*?\n\}/);
    expect(source).toContain('const blob = await response.blob();');
  });

  it('makes saving opt-out, so the email and attachment paths get the bytes', () => {
    const source = read('src/lib/reports/reportQa/deliverReportQaPdf.ts');
    expect(source).toContain('if (options.save !== false) saveToBrowser(blob, result.fileName);');
  });

  it('hands the blob to the caller that asked for an email', () => {
    // The delivery moved into its own hook so ConversationExport can offer the
    // same documents without embedding the button inside its menu; the button
    // and the export menu both run this line now.
    const source = read('src/components/report-qa/useReportQaDelivery.ts');
    expect(source).toContain('onAttachToEmail?.(result.blob, result.fileName)');
  });
});

describe('the route gates on the Q&A module and its own resolver', () => {
  const route = read('supabase/functions/render-report-qa-pdf/index.ts');

  it('requires report_qa view permission, not reports', () => {
    expect(route).toMatch(/requireModulePermission\(\s*supabase,\s*\{[^}]*\},\s*'report_qa',\s*'can_view',?\s*\)/);
    expect(route).not.toContain("'reports',");
  });

  it('resolves conversation access through the shared resolver', () => {
    // The call, not the import line. An import alone satisfies a substring
    // check while the gate is missing — which is how a Client Details
    // assertion passed on `canAccessClient` that was never called.
    expect(route).toMatch(/const access = await resolveReportQaAccess\(supabase, \{/);
    expect(route).toMatch(/access\.role === 'denied'/);
  });

  it('checks the error before the data on every read', () => {
    expect(route).toMatch(/if \(res\.error\) throw new Error\(`could not read \$\{label\}/);
  });

  it('meters the model call it can make', () => {
    expect(route).toMatch(/await logApiUsage\(supabase, \{/);
    expect(route).toContain("model_used: 'gpt-5.2'");
  });

  it('has no fallback to a raster generator', () => {
    // Comments stripped first: this route's header *names* all three legacy
    // libraries, because naming what it replaces is how the reasoning survives.
    // The third time in this migration that an assertion read prose and failed
    // on a file whose code was fine.
    const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/jspdf|html2canvas|pdf-lib/i);
  });
});
