import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMPORT_FONT_STACK,
  buildFontStack,
  normalizePdfFontFamily,
  resolveTemplateFontFamily,
} from '../rendering/fontNormalization';

describe('fontNormalization', () => {
  it('strips the PDF subset prefix', () => {
    expect(normalizePdfFontFamily('ABCDEE+Helvetica')).toBe('Arial');
    expect(normalizePdfFontFamily('XYZQWE+CustomFace')).toBe('CustomFace');
    expect(normalizePdfFontFamily('ABCDEE+Helvetica-Bold')).toBe('Arial');
  });

  it('returns null for empty/invalid input', () => {
    expect(normalizePdfFontFamily('')).toBeNull();
    expect(normalizePdfFontFamily('   ')).toBeNull();
    expect(normalizePdfFontFamily(null)).toBeNull();
    expect(normalizePdfFontFamily(42)).toBeNull();
  });

  it('maps Helvetica to the Arial stack', () => {
    expect(resolveTemplateFontFamily('Helvetica')).toBe('Arial');
    expect(resolveTemplateFontFamily('HelveticaNeue')).toBe('Arial');
    expect(resolveTemplateFontFamily('ABCDEE+Helvetica-Bold')).toBe('Arial');
    expect(buildFontStack('Arial')).toBe('Arial, Helvetica, sans-serif');
    expect(buildFontStack('Helvetica')).toBe('Arial, Helvetica, sans-serif');
  });

  it('maps Times to the Times New Roman stack', () => {
    expect(resolveTemplateFontFamily('Times')).toBe('Times New Roman');
    expect(resolveTemplateFontFamily('TimesNewRoman')).toBe('Times New Roman');
    expect(buildFontStack('Times New Roman')).toBe('"Times New Roman", Times, serif');
    expect(buildFontStack('Times')).toBe('"Times New Roman", Times, serif');
  });

  it('maps Roboto', () => {
    expect(resolveTemplateFontFamily('Roboto')).toBe('Roboto');
    expect(resolveTemplateFontFamily('ABCDEE+Roboto-Regular')).toBe('Roboto');
    expect(buildFontStack('Roboto')).toBe('Roboto, Arial, sans-serif');
  });

  it('maps Inter', () => {
    expect(resolveTemplateFontFamily('Inter')).toBe('Inter');
    expect(buildFontStack('Inter')).toBe('Inter, ui-sans-serif, system-ui, sans-serif');
  });

  it('exposes a Helvetica-consistent default import stack', () => {
    // Must match the stack pdfImport/fontResolver emits for Helvetica so untyped
    // imported text renders consistently with resolved text.
    expect(DEFAULT_IMPORT_FONT_STACK).toBe('Helvetica, Arial, sans-serif');
  });

  it('falls back to Inter for unknown/empty', () => {
    expect(resolveTemplateFontFamily('CompletelyUnknownFace')).toBe('Inter');
    expect(resolveTemplateFontFamily('')).toBe('Inter');
    expect(resolveTemplateFontFamily(null)).toBe('Inter');
    expect(buildFontStack('CompletelyUnknownFace')).toBe('Inter, ui-sans-serif, system-ui, sans-serif');
    expect(buildFontStack(null)).toBe('Inter, ui-sans-serif, system-ui, sans-serif');
    expect(buildFontStack('')).toBe('Inter, ui-sans-serif, system-ui, sans-serif');
  });
});
