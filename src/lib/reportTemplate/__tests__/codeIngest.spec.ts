/**
 * Raw-codebase ingestion orchestrator contract (plan WS1 §3.2).
 *
 * Locks `renderAndGroundCode`: input validation, the render-source call shape,
 * error propagation, data:URL normalisation, and grounding wire-through — all via
 * a stubbed invoke (no Supabase, no browser).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderAndGroundCode, looksLikeJsx, type InvokeFn } from '../ingestion/codeIngest';
import type { DomBoxTree } from '../codeGrounding';

const BOX_TREE: DomBoxTree = {
  pageWidthPx: 1280,
  pageHeightPx: 1600,
  textBoxes: [{ text: 'Headline', x: 100, y: 100, width: 300, height: 50, fontSizePx: 40 }],
};

const ok = (data: any): InvokeFn => vi.fn().mockResolvedValue({ data, error: null });

describe('renderAndGroundCode', () => {
  it('requires at least one input', async () => {
    await expect(renderAndGroundCode({}, ok({}))).rejects.toThrow(/Provide a URL/);
  });

  it('forwards JSX (C3) and zip (C4) inputs to render-source', async () => {
    const invoke1 = ok({ raster: 'AAAA', boxTree: BOX_TREE });
    await renderAndGroundCode({ jsx: 'export default () => <h1>Hi</h1>', entry: 'App' }, invoke1);
    expect(invoke1).toHaveBeenCalledWith('render-source', expect.objectContaining({
      jsx: 'export default () => <h1>Hi</h1>', entry: 'App',
    }), expect.objectContaining({ timeoutMs: 180000 }));

    const invoke2 = ok({ raster: 'AAAA', boxTree: BOX_TREE });
    await renderAndGroundCode({ zipBase64: 'UEsDBA==' }, invoke2);
    expect(invoke2).toHaveBeenCalledWith('render-source', expect.objectContaining({ zipBase64: 'UEsDBA==' }), expect.objectContaining({ timeoutMs: 240000 }));
  });

  it('calls render-source with the rendered input and grounds the box tree', async () => {
    const invoke = ok({ raster: 'AAAA', boxTree: BOX_TREE });
    const res = await renderAndGroundCode({ url: 'https://example.com' }, invoke);

    expect(invoke).toHaveBeenCalledWith('render-source', expect.objectContaining({
      url: 'https://example.com', width: 1280, height: 1600,
    }), expect.objectContaining({ timeoutMs: 180000 }));
    expect(res.rasterDataUrl).toBe('data:image/png;base64,AAAA');
    expect(res.rasterDataUrls).toEqual(['data:image/png;base64,AAAA']);
    expect(res.grounded.elements).toHaveLength(1);
    expect(res.grounded.elements[0].text).toBe('Headline');
    expect(res.groundedPages).toHaveLength(1);
    expect(res.cdir.source.kind).toBe('url');
    expect(res.cdir.pages[0].traceRasterAssetId).toBe('page_1_trace_raster');
    expect(res.cdirFidelity.textAccuracy).toBe(1);
    const trace0 = res.editableTemplate.pages[0].blocks[0].overlays[0] as any;
    expect(trace0).toMatchObject({ type: 'image', src: 'data:image/png;base64,AAAA', hidden: true, locked: true });
    expect(res.editableTemplate.pages[0].background?.imageUrl).toBeUndefined();
    expect(res.pageWidth).toBe(res.grounded.pageWidth);
  });

  it('preserves multi-page project zip renders as editable CDIR/template pages', async () => {
    const secondTree: DomBoxTree = {
      pageWidthPx: 1280,
      pageHeightPx: 1600,
      textBoxes: [{ text: 'Details page', x: 80, y: 90, width: 320, height: 44, fontSizePx: 32 }],
    };
    const invoke = ok({
      pages: [
        { id: 'cover', label: 'Cover', route: '/', raster: 'AAAA', boxTree: BOX_TREE },
        { id: 'details', label: 'Details', route: '/details', raster: 'BBBB', boxTree: secondTree },
      ],
    });

    const res = await renderAndGroundCode({ zipBase64: 'UEsDBA==', sourceFilename: 'project.zip' }, invoke);

    expect(res.cdir.source).toMatchObject({ kind: 'zip', filename: 'project.zip' });
    expect(res.cdir.pages.map((page) => page.id)).toEqual(['cover', 'details']);
    expect(res.cdir.pages[1].layers[0]).toMatchObject({ id: 'details_el_1', kind: 'text', text: 'Details page' });
    expect(res.rasterDataUrls).toEqual(['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB']);
    expect(res.groundedPages).toHaveLength(2);
    expect(res.editableTemplate.pages).toHaveLength(2);
    const trace1 = res.editableTemplate.pages[1].blocks[0].overlays[0] as any;
    expect(trace1).toMatchObject({ type: 'image', src: 'data:image/png;base64,BBBB', hidden: true, locked: true });
    expect(res.cdirFidelity.pages.map((page) => page.textAccuracy)).toEqual([1, 1]);
  });

  it('passes through an existing data: raster unchanged', async () => {
    const res = await renderAndGroundCode(
      { html: '<h1>Hi</h1>' },
      ok({ raster: 'data:image/png;base64,ZZZZ', boxTree: BOX_TREE }),
    );
    expect(res.rasterDataUrl).toBe('data:image/png;base64,ZZZZ');
  });

  it('propagates invoke errors', async () => {
    const invoke: InvokeFn = vi.fn().mockResolvedValue({ data: null, error: { message: 'render-source not configured' } });
    await expect(renderAndGroundCode({ url: 'https://x' }, invoke)).rejects.toThrow(/not configured/);
  });

  it('propagates a data-level error', async () => {
    await expect(renderAndGroundCode({ url: 'https://x' }, ok({ error: 'boom' }))).rejects.toThrow(/boom/);
    await expect(renderAndGroundCode({ url: 'https://x' }, ok({ error: { message: 'build failed' } }))).rejects.toThrow(/build failed/);
  });

  it('keeps raster-only renders importable as trace-backed pages', async () => {
    const res = await renderAndGroundCode(
      { html: '<canvas></canvas>' },
      ok({ raster: 'AAAA', pageWidthPx: 900, pageHeightPx: 1200 }),
    );
    expect(res.groundedPages[0].elements).toHaveLength(0);
    // No editable layers at all → the raster IS the page, so it stays visible.
    const traceOnly = res.editableTemplate.pages[0].blocks[0].overlays[0] as any;
    expect(traceOnly).toMatchObject({ type: 'image', src: 'data:image/png;base64,AAAA', hidden: false, locked: true });
    expect(res.cdir.pages[0].layers).toHaveLength(0);
  });

  it('errors when the render is incomplete', async () => {
    await expect(renderAndGroundCode({ url: 'https://x' }, ok({}))).rejects.toThrow(/no screenshot or DOM box tree/);
  });
});

describe('looksLikeJsx', () => {
  it('treats component-ish source as JSX (C3)', () => {
    expect(looksLikeJsx('export default function App(){ return <div/> }')).toBe(true);
    expect(looksLikeJsx("import React from 'react';\nexport const Card = () => <div/>;")).toBe(true);
    expect(looksLikeJsx('const App = () => (<h1>Hi</h1>)')).toBe(true);
  });

  it('treats plain HTML as not-JSX (C1)', () => {
    expect(looksLikeJsx('<!doctype html><html><body><h1>Hi</h1></body></html>')).toBe(false);
    expect(looksLikeJsx('<div class="card"><p>Hello</p></div>')).toBe(false);
    expect(looksLikeJsx('')).toBe(false);
  });
});
