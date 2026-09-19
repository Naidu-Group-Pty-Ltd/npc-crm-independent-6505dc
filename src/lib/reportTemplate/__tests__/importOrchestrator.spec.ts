/**
 * Import orchestrator — the single entry point all import dialogs share.
 * Routing + payload contracts are locked here with an injected invoke.
 */
import { describe, it, expect, vi } from 'vitest';
import { classifyReferenceFile, runReferenceImport } from '../ingestion/importOrchestrator';
import type { DomBoxTree } from '../codeGrounding';

const BOX_TREE: DomBoxTree = {
  pageWidthPx: 1280,
  pageHeightPx: 1600,
  textBoxes: [{ text: 'Headline', x: 100, y: 100, width: 300, height: 50, fontSizePx: 40 }],
};

describe('classifyReferenceFile', () => {
  const f = (name: string, type = '') => new File([new Uint8Array([1])], name, { type });

  it('routes every supported format to one kind', () => {
    expect(classifyReferenceFile(f('report.pdf', 'application/pdf'))).toBe('pdf');
    expect(classifyReferenceFile(f('cover.png', 'image/png'))).toBe('image');
    expect(classifyReferenceFile(f('export.make'))).toBe('make');
    expect(classifyReferenceFile(f('design.fig'))).toBe('make');
    expect(classifyReferenceFile(f('component.tsx'))).toBe('code');
    expect(classifyReferenceFile(f('site.zip', 'application/zip'))).toBe('code');
    expect(classifyReferenceFile(f('notes.docx'))).toBe('document');
    expect(classifyReferenceFile(f('notes.txt', 'text/plain'))).toBe('document');
    expect(classifyReferenceFile(f('letter.rtf'))).toBe('document');
    expect(classifyReferenceFile(f('legacy.doc', 'application/msword'))).toBe('document');
    expect(classifyReferenceFile(f('data.bin'))).toBe('unsupported');
  });
});

describe('runReferenceImport — code', () => {
  it('classifies pasted TSX as JSX input and returns an editable schema outcome', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { raster: 'AAAA', boxTree: BOX_TREE }, error: null });
    const stages: string[] = [];
    const outcome = await runReferenceImport(
      { kind: 'code', text: 'export default function App(){ return <h1>Hi</h1>; }', filename: 'App.tsx' },
      { invoke, onStage: (s) => stages.push(s) },
    );
    expect(invoke).toHaveBeenCalledWith('render-source', expect.objectContaining({
      jsx: expect.stringContaining('export default function App'),
    }), expect.anything());
    expect(outcome.type).toBe('schema');
    if (outcome.type === 'schema') {
      expect(outcome.schema.pages).toHaveLength(1);
      expect(outcome.message).toMatch(/fidelity \d+%/);
    }
    expect(stages.some((s) => /Rendering component/.test(s))).toBe(true);
  });

  it('routes pasted URLs to the render service as url input', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { raster: 'AAAA', boxTree: BOX_TREE }, error: null });
    await runReferenceImport({ kind: 'code', text: 'https://example.com/page' }, { invoke });
    expect(invoke).toHaveBeenCalledWith('render-source', expect.objectContaining({ url: 'https://example.com/page' }), expect.anything());
  });

  it('rejects empty input with guidance', async () => {
    await expect(runReferenceImport({ kind: 'code', text: '  ' }, { invoke: vi.fn() }))
      .rejects.toThrow(/Paste a URL, HTML, CSS/);
  });

  it('does not execute code locally when the render service is unconfigured', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: {
        code: 'render_source_unconfigured',
        message: 'Raw-codebase rendering is not configured on this deployment.',
      },
      error: null,
    });

    await expect(runReferenceImport(
      { kind: 'code', text: '<script>fetch("http://internal.example")</script>', filename: 'index.html' },
      { invoke },
    )).rejects.toThrow(/not configured/i);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe('runReferenceImport — url', () => {
  it('returns fetched documents as files for the mode chooser', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { kind: 'pdf', dataBase64: btoa('PDF'), filename: 'doc.pdf', contentType: 'application/pdf' },
      error: null,
    });
    const outcome = await runReferenceImport({ kind: 'url', url: 'https://drive.google.com/file/d/abc/view' }, { invoke });
    expect(outcome.type).toBe('file');
    if (outcome.type === 'file') {
      expect(outcome.file.name).toBe('doc.pdf');
      expect(outcome.file.type).toBe('application/pdf');
    }
  });

  it('rejects invalid links before any network call', async () => {
    const invoke = vi.fn();
    await expect(runReferenceImport({ kind: 'url', url: 'not-a-url' }, { invoke })).rejects.toThrow(/valid http/);
    expect(invoke).not.toHaveBeenCalled();
  });
});
