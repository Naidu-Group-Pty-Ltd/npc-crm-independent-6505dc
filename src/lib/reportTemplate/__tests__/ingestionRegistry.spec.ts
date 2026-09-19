/**
 * Unified ingestion mechanism — routing/classification contract (plan WS1).
 *
 * Locks the single detection brain: which pipeline (or render tier) handles each
 * input. Pure functions, so this runs without a network or browser and guards
 * the façade from the first CI run.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyInput,
  codeFlavorForFile,
  codeTierForFlavor,
  resolveSource,
  planIngestion,
  planIngestionOrThrow,
  IngestionError,
  type IngestionInput,
} from '../ingestion';

const file = (name?: string, type?: string): IngestionInput => ({ kind: 'file', file: { name, type } });

describe('ingestion — classifyInput', () => {
  it('routes PDF files (by extension or MIME)', () => {
    expect(classifyInput(file('report.pdf'))).toBe('pdf');
    expect(classifyInput(file(undefined, 'application/pdf'))).toBe('pdf');
  });

  it('routes image files (by extension or MIME)', () => {
    expect(classifyInput(file('shot.png'))).toBe('image');
    expect(classifyInput(file('photo.JPG'))).toBe('image');
    expect(classifyInput(file(undefined, 'image/webp'))).toBe('image');
  });

  it('routes URLs and explicit code payloads', () => {
    expect(classifyInput({ kind: 'url', url: 'https://example.com/deck.pdf' })).toBe('url');
    expect(classifyInput({ kind: 'code', flavor: 'html' })).toBe('code');
  });

  it('routes raw-codebase files by extension and MIME', () => {
    expect(classifyInput(file('index.html'))).toBe('code');
    expect(classifyInput(file('App.tsx'))).toBe('code');
    expect(classifyInput(file('styles.css'))).toBe('code');
    expect(classifyInput(file('site.zip'))).toBe('code');
    expect(classifyInput(file(undefined, 'text/html'))).toBe('code');
  });

  it('flags genuinely unsupported files', () => {
    expect(classifyInput(file('notes.txt'))).toBe('unsupported');
    expect(classifyInput(file('data.csv'))).toBe('unsupported');
    expect(classifyInput(file())).toBe('unsupported');
  });
});

describe('ingestion — code flavor + render tier', () => {
  it('maps filenames to flavors', () => {
    expect(codeFlavorForFile('a.html')).toBe('html');
    expect(codeFlavorForFile('a.css')).toBe('css');
    expect(codeFlavorForFile('a.jsx')).toBe('jsx');
    expect(codeFlavorForFile('a.tsx')).toBe('tsx');
    expect(codeFlavorForFile('a.vue')).toBe('vue');
    expect(codeFlavorForFile('a.astro')).toBe('astro');
    expect(codeFlavorForFile('a.md')).toBe('html');
    expect(codeFlavorForFile('a.json')).toBe('data');
    expect(codeFlavorForFile('a.zip')).toBe('zip');
    expect(codeFlavorForFile('a.txt')).toBeNull();
  });

  it('maps flavors to render tiers (C1–C4)', () => {
    expect(codeTierForFlavor('html')).toBe('C1-html-css');
    expect(codeTierForFlavor('css')).toBe('C1-html-css');
    expect(codeTierForFlavor('jsx')).toBe('C3-react-jsx');
    expect(codeTierForFlavor('tsx')).toBe('C3-react-jsx');
    expect(codeTierForFlavor('astro')).toBe('C3-react-jsx');
    expect(codeTierForFlavor('data')).toBe('C1-html-css');
    expect(codeTierForFlavor('zip')).toBe('C4-repo-zip');
  });
});

describe('ingestion — resolveSource + planIngestion', () => {
  it('resolves each kind to the right source', () => {
    expect(resolveSource(file('a.pdf'))?.id).toBe('pdf');
    expect(resolveSource(file('a.png'))?.id).toBe('image');
    expect(resolveSource({ kind: 'url', url: 'https://x' })?.id).toBe('url');
    expect(resolveSource(file('a.html'))?.id).toBe('code');
    expect(resolveSource(file('a.txt'))).toBeNull();
  });

  it('plans available delegate pipelines for pdf/image/url', () => {
    expect(planIngestion(file('a.pdf'))).toMatchObject({
      kind: 'pdf', strategy: 'delegate', delegate: 'extractPdfViaDocling', available: true,
    });
    expect(planIngestion(file('a.png'))).toMatchObject({
      kind: 'image', strategy: 'delegate', delegate: 'template-design-agent:screenshot_to_block', available: true,
    });
    expect(planIngestion({ kind: 'url', url: 'https://x' })).toMatchObject({
      kind: 'url', strategy: 'delegate', delegate: 'import-from-url', available: true,
    });
  });

  it('plans raw-codebase ingestion by tier (render-source-backed, runtime availability detected at invoke time)', () => {
    expect(planIngestion(file('index.html'))).toMatchObject({
      kind: 'code', strategy: 'render-source', codeTier: 'C1-html-css', available: true,
    });
    expect(planIngestion(file('App.tsx'))).toMatchObject({ codeTier: 'C3-react-jsx', available: true });
    expect(planIngestion(file('site.zip'))).toMatchObject({ codeTier: 'C4-repo-zip', available: true });
    // A link wins as 'url' even if it points at a code-built design (handled by import-from-url).
    expect(planIngestion({ kind: 'url', url: 'https://figma.com/file/abc' })).toMatchObject({ kind: 'url' });
    expect(planIngestion({ kind: 'code', flavor: 'html' })).toMatchObject({ codeTier: 'C1-html-css' });
  });

  it('routes Figma Make / local-Figma exports (.make/.fig) through the figma source', () => {
    expect(planIngestion(file('design.make'))).toMatchObject({
      kind: 'figma', strategy: 'delegate', delegate: 'importOrchestrator:figma-make', available: true,
    });
    expect(planIngestion(file('design.fig'))).toMatchObject({ kind: 'figma', available: true });
  });

  it('throws a typed error for unsupported input', () => {
    expect(() => planIngestionOrThrow(file('a.txt'))).toThrow(IngestionError);
    expect(planIngestion(file('a.txt'))).toBeNull();
  });
});
