import { describe, expect, it } from 'vitest';
import {
  applyTemplateImportPlan,
  buildBackgroundFirstImportPlan,
  buildRawImportManifest,
  createImageImportAsset,
  createPdfImportAsset,
  extractPaletteFromPixels,
  groundedReferenceToRawBlocks,
  sampleBackgroundColorFromPixels,
  validateTemplateImportPlan,
  buildReconciliationPrompt,
  BackgroundFirstReconciliationClient,
  applyTemplateImportPatches,
  buildHybridImportPlanFromManifests,
  parseTemplateImportPlanResponse,
  reconcileWithFallback,
  TemplateDesignAgentReconciliationClient,
  runReconciliationRepairPass,
  buildVisualDiffRepairReportFromRgba,
  buildPdfImportAssetManifests,
  importAssetToReviewArtifacts,
  reconcilePdfImportAsset,
  summarizeImportAsset,
} from '../ingestion/reconciliation';
import type { GroundedReference } from '../imageGrounding';
import { parseTemplate } from '../templateSchema';

const DATA_URL = 'data:image/png;base64,AAAA';

describe('Template Import Reconciliation Engine foundation', () => {
  it('creates a deterministic background-first plan and applies it as a ReportTemplate', () => {
    const asset = createImageImportAsset({
      dataUrl: DATA_URL,
      imageWidth: 800,
      imageHeight: 600,
      fileName: 'cover.png',
      fileId: 'asset_cover',
      backgroundColor: '#101820',
    });

    const plan = buildBackgroundFirstImportPlan(asset, { importId: 'import_cover' });
    const validation = validateTemplateImportPlan(plan);
    const template = applyTemplateImportPlan(plan, { templateName: 'Imported Cover' });

    expect(validation.ok).toBe(true);
    expect(plan.importSummary.visualFidelityMode).toBe('background-first');
    expect(plan.importSummary.editableElementsCreated).toBe(0);
    expect(template.pages).toHaveLength(1);
    expect(template.pages[0].background.imageUrl).toBe(DATA_URL);
    expect(template.pages[0].background.color).toBe('#101820');
    expect(template.pages[0].blocks[0].type).toBe('free');
    expect(template.pages[0].blocks[0].overlays).toHaveLength(0);
    expect(template.meta?.title).toBe('Imported Cover');
    expect(template.meta?.creator).toBe('template-import-reconciliation-engine');
    expect(template.meta?.subject).toMatch(/background-first/);
  });

  it('preserves the active page id and name when applying a single-page plan into an existing template', () => {
    const base = parseTemplate({
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [
        { id: 'cover', name: 'Existing Cover', size: { width: 595, height: 842 }, background: {}, blocks: [] },
        { id: 'appendix', name: 'Appendix', size: { width: 595, height: 842 }, background: {}, blocks: [] },
      ],
      slots: {},
    });
    const asset = createImageImportAsset({ dataUrl: DATA_URL, imageWidth: 800, imageHeight: 600, fileId: 'asset_apply' });
    const plan = buildBackgroundFirstImportPlan(asset);

    const template = applyTemplateImportPlan(plan, { baseTemplate: base, activePageId: 'cover' });

    expect(template.pages.map((p) => p.id)).toEqual(['cover', 'appendix']);
    expect(template.pages[0].name).toBe('Existing Cover');
    expect(template.pages[0].background.imageUrl).toBe(DATA_URL);
    expect(template.pages[1].background.imageUrl).toBeUndefined();
  });

  it('summarizes PDF import assets and converts source pages to review artifacts', () => {
    const asset = createPdfImportAsset({
      fileName: 'review.pdf',
      fileId: 'pdf_review_asset',
      pages: [
        { pageIndex: 0, width: 595, height: 842, referenceImageUrl: 'data:image/png;base64,PAGE1', dpiScale: 2, backgroundColor: '#ffffff' },
        { pageIndex: 1, width: 595, height: 842, referenceImageUrl: 'https://example.test/page2.png', dpiScale: 1.5 },
      ],
    });

    const summary = summarizeImportAsset(asset);
    const artifacts = importAssetToReviewArtifacts(asset);

    expect(summary?.fileType).toBe('pdf');
    expect(summary?.sourcePages).toBe(2);
    expect(summary?.averageDpiScale).toBe(1.75);
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].kind).toBe('source-raster');
    expect(artifacts[0].dataUrl).toContain('PAGE1');
    expect(artifacts[1].url).toBe('https://example.test/page2.png');
  });

  it('creates multi-page PDF import assets from rendered page references', () => {
    const asset = createPdfImportAsset({
      fileName: 'report.pdf',
      pages: [
        { pageIndex: 0, width: 595, height: 842, referenceImageUrl: 'data:image/png;base64,PAGE1', dpiScale: 2 },
        { pageIndex: 1, width: 595, height: 842, referenceImageUrl: 'data:image/png;base64,PAGE2', dpiScale: 2 },
      ],
    });
    const plan = buildBackgroundFirstImportPlan(asset);

    expect(asset.fileType).toBe('pdf');
    expect(asset.pages).toHaveLength(2);
    expect(asset.pages[0].source).toBe('pdf-render');
    expect(plan.pages.map((page) => page.background.imageUrl)).toEqual(['data:image/png;base64,PAGE1', 'data:image/png;base64,PAGE2']);
  });

  it('derives distinct stable image import asset ids when data URLs differ', () => {
    const a = createImageImportAsset({ dataUrl: 'data:image/png;base64,AAAA', imageWidth: 800, imageHeight: 600, fileName: 'same.png' });
    const b = createImageImportAsset({ dataUrl: 'data:image/png;base64,BBBB', imageWidth: 800, imageHeight: 600, fileName: 'same.png' });

    expect(a.fileId).not.toBe(b.fileId);
    expect(a.pages[0].id).not.toBe(b.pages[0].id);
  });

  it('rejects plans that do not preserve the reference background image', () => {
    const asset = createImageImportAsset({ dataUrl: DATA_URL, imageWidth: 400, imageHeight: 400, fileId: 'asset_square' });
    const plan = buildBackgroundFirstImportPlan(asset);
    plan.pages[0].background.imageUrl = '';

    const validation = validateTemplateImportPlan(plan);

    expect(validation.ok).toBe(false);
    expect(validation.errors.join(' ')).toMatch(/reference background image/i);
  });

  it('builds a raw manifest from grounded OCR elements with source and confidence metadata', () => {
    const asset = createImageImportAsset({ dataUrl: DATA_URL, imageWidth: 1000, imageHeight: 1414, fileId: 'asset_ocr' });
    const grounded: GroundedReference = {
      pageWidth: 595,
      pageHeight: 841,
      imageWidth: 1000,
      imageHeight: 1414,
      elements: [{ id: 'w1', text: 'Investment Property Report', x: 72, y: 120, width: 220, height: 32, confidence: 0.93 } as any],
    };

    const rawBlocks = groundedReferenceToRawBlocks(grounded);
    const manifest = buildRawImportManifest({ page: asset.pages[0], grounded, palette: ['#d6a84f'] });

    expect(rawBlocks).toHaveLength(1);
    expect(rawBlocks[0]).toMatchObject({ type: 'text', text: 'Investment Property Report', source: 'ocr', confidence: 0.93 });
    expect(manifest.extractionSummary.hasOcrTextLayer).toBe(true);
    expect(manifest.extractionSummary.textBlockCount).toBe(1);
    expect(manifest.palette).toEqual(['#d6a84f']);
  });

  it('samples palette and background colors deterministically from RGBA pixels', () => {
    // 3x3 image with navy edges/corners and a gold centre accent.
    const px = new Uint8ClampedArray([
      16, 24, 32, 255, 16, 24, 32, 255, 16, 24, 32, 255,
      16, 24, 32, 255, 214, 168, 79, 255, 16, 24, 32, 255,
      16, 24, 32, 255, 16, 24, 32, 255, 16, 24, 32, 255,
    ]);

    expect(sampleBackgroundColorFromPixels({ data: px, width: 3, height: 3 })).toBe('#101820');
    expect(extractPaletteFromPixels({ data: px, width: 3, height: 3 }, 2)).toContain('#d6a84f');
  });

  it('builds a hybrid plan with editable OCR overlays while preserving the locked background', () => {
    const asset = createImageImportAsset({ dataUrl: DATA_URL, imageWidth: 1000, imageHeight: 1414, fileId: 'asset_hybrid' });
    const manifest = buildRawImportManifest({
      page: asset.pages[0],
      rawBlocks: [
        {
          id: 'heading',
          type: 'text',
          text: 'Investment Property Report',
          bbox: { x: 72, y: 120, width: 260, height: 36 },
          style: { fontSize: 30, fontWeight: 700, color: '#d6a84f', textAlign: 'left' },
          confidence: 0.92,
          source: 'ocr',
        },
        {
          id: 'noisy',
          type: 'text',
          text: '???',
          bbox: { x: 10, y: 10, width: 30, height: 10 },
          confidence: 0.42,
          source: 'ocr',
        },
      ],
    });

    const plan = buildHybridImportPlanFromManifests(asset, [manifest]);
    const template = applyTemplateImportPlan(plan);
    const overlay: any = template.pages[0].blocks[0].overlays[0];

    expect(plan.importSummary.visualFidelityMode).toBe('hybrid');
    expect(plan.importSummary.editableElementsCreated).toBe(1);
    expect(plan.warnings.some((w) => w.code === 'low_confidence_text_skipped')).toBe(true);
    expect(template.pages[0].background.imageUrl).toBe(DATA_URL);
    expect(overlay.content).toBe('Investment Property Report');
    expect(overlay.locked).toBe(false);
    expect(overlay.color).toBe('#d6a84f');
  });

  it('builds a reconciliation prompt that forbids renderer ownership and HTML output', () => {
    const asset = createImageImportAsset({ dataUrl: DATA_URL, imageWidth: 800, imageHeight: 600, fileId: 'asset_prompt' });
    const prompt = buildReconciliationPrompt({ importAsset: asset, manifests: [] });

    expect(prompt.system).toMatch(/not a renderer/i);
    expect(prompt.schemaSummary.hardRules.join(' ')).toMatch(/Do not output HTML/i);
    expect(prompt.user).toMatch(/TemplateImportPlan JSON only/);
  });

  it('parses fenced AI JSON only after validating the TemplateImportPlan contract', () => {
    const asset = createImageImportAsset({ dataUrl: DATA_URL, imageWidth: 800, imageHeight: 600, fileId: 'asset_parse' });
    const plan = buildBackgroundFirstImportPlan(asset);
    const fenced = ['```json', JSON.stringify(plan), '```'].join('\n');
    const parsed = parseTemplateImportPlanResponse(fenced);

    expect(parsed.importId).toBe(plan.importId);
    expect(parsed.pages[0].background.imageUrl).toBe(DATA_URL);
    expect(() => parseTemplateImportPlanResponse('{"version":1,"pages":[],"warnings":[],"confidenceScore":1,"importSummary":{"visualFidelityMode":"hybrid","editableElementsCreated":0,"manualReviewRequired":false,"repairPassesApplied":0}}')).toThrow(/at least one page/i);
  });

  it('rejects rich HTML text overlays from AI reconciliation plans', () => {
    const asset = createImageImportAsset({ dataUrl: DATA_URL, imageWidth: 800, imageHeight: 600, fileId: 'asset_untrusted_html' });
    const plan = buildBackgroundFirstImportPlan(asset);
    plan.pages[0].overlays.push({
      id: 'malicious_html', type: 'text', x: 10, y: 10, width: 100, height: 20,
      content: '<img src=x onerror="globalThis.__NPC_XSS=true">', rich: true,
    } as any);

    expect(() => parseTemplateImportPlanResponse(JSON.stringify(plan))).toThrow(/not schema-valid/i);
  });

  it('invokes the design-agent reconciliation provider and parses its TemplateImportPlan response', async () => {
    const asset = createImageImportAsset({ dataUrl: DATA_URL, imageWidth: 800, imageHeight: 600, fileId: 'asset_provider' });
    const plan = buildBackgroundFirstImportPlan(asset);
    const invoke = async (name: string, body?: Record<string, unknown>) => {
      expect(name).toBe('template-design-agent');
      expect(body?.mode).toBe('layout_reconciliation');
      expect(JSON.stringify(body)).toContain('TemplateImportPlan');
      return { data: { text: ['```json', JSON.stringify(plan), '```'].join('\n') }, error: null };
    };

    const parsed = await new TemplateDesignAgentReconciliationClient(invoke).reconcile({ importAsset: asset, manifests: [] });

    expect(parsed.pages[0].background.imageUrl).toBe(DATA_URL);
  });

  it('falls back to the deterministic hybrid plan when provider reconciliation fails', async () => {
    const asset = createImageImportAsset({ dataUrl: DATA_URL, imageWidth: 800, imageHeight: 600, fileId: 'asset_provider_fallback' });
    const fallbackPlan = buildBackgroundFirstImportPlan(asset);
    const warnings: string[] = [];
    const failingClient = new TemplateDesignAgentReconciliationClient(async () => ({ data: null, error: { message: 'provider unavailable' } }));

    const plan = await reconcileWithFallback(failingClient, { importAsset: asset, manifests: [] }, fallbackPlan, (message) => warnings.push(message));

    expect(plan).toBe(fallbackPlan);
    expect(warnings.join(' ')).toMatch(/provider unavailable/);
  });

  it('feeds PDF ImportAsset manifests into provider-backed reconciliation with a hybrid fallback', async () => {
    const asset = createPdfImportAsset({
      fileName: 'provider.pdf',
      fileId: 'pdf_provider_asset',
      pages: [
        { pageIndex: 0, width: 595, height: 842, referenceImageUrl: 'data:image/png;base64,PAGE1', dpiScale: 2 },
      ],
    });
    const manifests = buildPdfImportAssetManifests(asset, {
      rawBlocksByPage: {
        0: [{
          id: 'raw_title',
          type: 'text',
          text: 'PDF Title',
          bbox: { x: 72, y: 80, width: 220, height: 30 },
          confidence: 0.94,
          source: 'pdf-text',
        }],
      },
      paletteByPage: { 0: ['#102030'] },
    });
    let providerSawPdfManifest = false;
    const result = await reconcilePdfImportAsset(asset, {
      manifests,
      client: {
        reconcile: async (request) => {
          providerSawPdfManifest = request.importAsset.fileType === 'pdf'
            && request.manifests[0].rawBlocks[0].source === 'pdf-text'
            && request.constraints?.preserveRenderedPdfPages === true;
          return buildBackgroundFirstImportPlan(request.importAsset, { importId: request.importAsset.fileId });
        },
        repair: async () => [],
        repairPage: async () => [],
        critiquePage: async () => ({ findings: [] }),
      },
    });

    expect(providerSawPdfManifest).toBe(true);
    expect(result.manifests[0].extractionSummary.hasPdfTextLayer).toBe(true);
    expect(result.plan.pages[0].background.imageUrl).toContain('PAGE1');
  });

  it('provides a deterministic background-first AI fallback client', async () => {
    const asset = createImageImportAsset({ dataUrl: DATA_URL, imageWidth: 800, imageHeight: 600, fileId: 'asset_fallback' });
    const client = new BackgroundFirstReconciliationClient();
    const plan = await client.reconcile({ importAsset: asset, manifests: [] });

    expect(plan.importSummary.visualFidelityMode).toBe('background-first');
    expect(plan.pages[0].background.imageUrl).toBe(DATA_URL);
  });

  it('builds a visual diff repair report from source/rendered RGBA rasters', () => {
    const asset = createImageImportAsset({ dataUrl: DATA_URL, imageWidth: 200, imageHeight: 200, fileId: 'asset_visual_diff' });
    const plan = buildBackgroundFirstImportPlan(asset);
    const source = new Uint8ClampedArray(4 * 4 * 4).fill(200);
    const rendered = new Uint8ClampedArray(source);
    for (let y = 2; y < 4; y += 1) {
      for (let x = 2; x < 4; x += 1) {
        const i = (y * 4 + x) * 4;
        rendered[i] = 10;
        rendered[i + 1] = 10;
        rendered[i + 2] = 10;
        rendered[i + 3] = 255;
      }
    }

    const report = buildVisualDiffRepairReportFromRgba({
      plan,
      pageId: plan.pages[0].id,
      sourceRgba: source,
      renderedRgba: rendered,
      width: 4,
      height: 4,
      fidelityOptions: { cols: 2, rows: 2 },
    });

    expect(report.diffScore).toBeGreaterThan(0);
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.repairInstruction).toContain('ONLY these areas');
  });

  it('runs a bounded repair pass through patch operations instead of replacing the template', async () => {
    const asset = createImageImportAsset({ dataUrl: DATA_URL, imageWidth: 800, imageHeight: 600, fileId: 'asset_repair_loop' });
    const plan = buildBackgroundFirstImportPlan(asset);
    plan.pages[0].overlays.push({
      id: 'heading_1',
      type: 'text',
      x: 40,
      y: 80,
      width: 240,
      height: 40,
      rotation: 0,
      opacity: 1,
      content: 'Original',
      fontFamily: 'Inter',
      fontSize: 24,
      fontWeight: 'bold',
      fontStyle: 'normal',
      color: '#111111',
      align: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
      confidence: 0.9,
    });
    const template = applyTemplateImportPlan(plan);
    const blockId = template.pages[0].blocks[0].id;
    const client = {
      reconcile: async () => plan,
      repair: async () => ([
        { operation: 'updateOverlay' as const, pageId: template.pages[0].id, blockId, overlayId: 'heading_1', changes: { y: 100 } as any },
        { operation: 'updatePageBackground' as const, pageId: template.pages[0].id, changes: { imageUrl: '' } },
      ]),
      repairPage: async () => [],
      critiquePage: async () => ({ findings: [] }),
    };

    const result = await runReconciliationRepairPass({ template, plan, diffReport: { diffScore: 0.2 }, client, maxOperations: 2 });

    expect(result.requested).toBe(2);
    expect(result.applied).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect((result.template.pages[0].blocks[0].overlays[0] as any).y).toBe(100);
  });

  it('applies bounded patch operations while rejecting background removal', () => {
    const asset = createImageImportAsset({ dataUrl: DATA_URL, imageWidth: 800, imageHeight: 600, fileId: 'asset_patch' });
    const plan = buildBackgroundFirstImportPlan(asset);
    plan.pages[0].overlays.push({
      id: 'heading_1',
      type: 'text',
      x: 40,
      y: 80,
      width: 240,
      height: 40,
      rotation: 0,
      opacity: 1,
      content: 'Original',
      fontFamily: 'Inter',
      fontSize: 24,
      fontWeight: 'bold',
      fontStyle: 'normal',
      color: '#111111',
      align: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
      confidence: 0.9,
    });
    const template = applyTemplateImportPlan(plan);
    const blockId = template.pages[0].blocks[0].id;

    const result = applyTemplateImportPatches(template, [
      { operation: 'updateOverlay', pageId: template.pages[0].id, blockId, overlayId: 'heading_1', changes: { y: 96, color: '#d6a84f' } as any },
      { operation: 'updatePageBackground', pageId: template.pages[0].id, changes: { imageUrl: '' } },
    ]);

    const overlay: any = result.template.pages[0].blocks[0].overlays[0];
    expect(result.applied).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(overlay.y).toBe(96);
    expect(overlay.color).toBe('#d6a84f');
    expect(result.template.pages[0].background.imageUrl).toBe(DATA_URL);
  });

  it('rejects repair patches that add or enable rich HTML text overlays', () => {
    const asset = createImageImportAsset({ dataUrl: DATA_URL, imageWidth: 800, imageHeight: 600, fileId: 'asset_patch_html' });
    const plan = buildBackgroundFirstImportPlan(asset);
    plan.pages[0].overlays.push({
      id: 'plain_text', type: 'text', x: 10, y: 10, width: 100, height: 20, content: 'Safe text',
    } as any);
    const template = applyTemplateImportPlan(plan);
    const pageId = template.pages[0].id;
    const blockId = template.pages[0].blocks[0].id;
    const payload = '<img src=x onerror="globalThis.__NPC_XSS=true">';

    const result = applyTemplateImportPatches(template, [
      { operation: 'addOverlay', pageId, blockId, overlay: {
        id: 'malicious_html', type: 'text', x: 10, y: 40, width: 100, height: 20,
        content: payload, rich: true,
      } as any },
      { operation: 'updateOverlay', pageId, blockId, overlayId: 'plain_text', changes: { content: payload, rich: true } as any },
    ]);

    expect(result.applied).toBe(0);
    expect(result.rejected).toHaveLength(2);
    expect(result.template.pages[0].blocks[0].overlays).toHaveLength(1);
    expect((result.template.pages[0].blocks[0].overlays[0] as any).content).toBe('Safe text');
  });

});
