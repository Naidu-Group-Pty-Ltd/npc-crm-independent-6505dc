/**
 * Print-safety linter for ReportTemplate.
 *
 * Surfaces print/export readiness issues for ReportTemplate:
 *   - bleed: overlay extends outside page bounds
 *   - low-contrast: text color vs page background luminance ratio < 4.5
 *   - missing-slot: slot block references a slotKey that doesn't exist
 *   - tiny-text / overlap-edge: print-safety hints
 *   - renderer-partial / renderer-unsupported: export fidelity and activation readiness
 *
 * Font availability is intentionally NOT linted — both the production
 * renderer (WeasyPrint) and the in-editor PDF preview load arbitrary web
 * fonts, so any font family declared in the template is valid.
 *
 * This complements `bindingValidation.ts` (which catches data-binding typos).
 */
import { getBlockRendererCapabilities } from './blocks';
import type { ReportTemplate } from './templateSchema';

export type LintSeverity = 'warning' | 'error' | 'info';

export interface LintIssue {
  severity: LintSeverity;
  code:
    | 'bleed'
    | 'missing-font'
    | 'low-contrast'
    | 'missing-slot'
    | 'tiny-text'
    | 'overlap-edge'
    | 'renderer-partial'
    | 'renderer-unsupported'
    | 'unresolved-binding';
  message: string;
  where: string;
  pageId?: string;
  blockId?: string;
  overlayId?: string;
}

function looksLikeBinding(s: unknown): boolean {
  return typeof s === 'string' && /\{\{|^token:/.test(s);
}


function parseHex(input: unknown): { r: number; g: number; b: number } | null {
  if (typeof input !== 'string') return null;
  const m = input.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrastRatio(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const BINDING_RE = /\{\{\s*([^}|]+?)\s*(?:\||\}\})/g;

function getByPath(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  const parts = path.replace(/\[(\w+)\]/g, '.$1').split('.');
  return parts.reduce((acc, key) => (acc == null ? acc : acc[key.trim()]), obj);
}

function collectUnresolvedBindings(input: unknown, sampleData: Record<string, any>): string[] {
  if (typeof input !== 'string' || !input.includes('{{')) return [];
  const out: string[] = [];
  const re = new RegExp(BINDING_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    const head = m[1].trim();
    // skip computed (=foo) / token (@foo) / expressions
    if (!head || head.startsWith('=') || head.startsWith('@')) continue;
    if (/[^\w.\[\]\s]/.test(head)) continue;
    if (getByPath(sampleData, head) === undefined) out.push(head);
  }
  return out;
}

export function lintTemplate(
  template: ReportTemplate,
  sampleData?: Record<string, any>,
): LintIssue[] {
  const issues: LintIssue[] = [];
  const slotKeys = new Set(Object.keys(template.slots ?? {}));
  const data = sampleData ?? {};

  template.pages.forEach((page, pi) => {
    const pageW = page.size?.width ?? 595;
    const pageH = page.size?.height ?? 842;
    const pageBg = parseHex(page.background?.color) ?? { r: 255, g: 255, b: 255 };

    page.blocks.forEach((block, bi) => {
      const blockWhere = `Page ${pi + 1} → block ${bi + 1}`;
      const blockCtx = { pageId: page.id, blockId: block.id };
      const capabilities = getBlockRendererCapabilities(block.type);

      if (capabilities.weasyprint === 'unsupported' || !capabilities.productionSafe) {
        issues.push({
          severity: 'error',
          code: 'renderer-unsupported',
          message: `Block "${block.type}" has no production HTML/WeasyPrint renderer and cannot be activated`,
          where: blockWhere,
          ...blockCtx,
        });
      } else if (capabilities.weasyprint === 'partial') {
        issues.push({
          severity: 'warning',
          code: 'renderer-partial',
          message: `Block "${block.type}" has partial production renderer support: ${capabilities.notes ?? 'review output before activation'}`,
          where: blockWhere,
          ...blockCtx,
        });
      }

      if (capabilities.productionSafe && capabilities.jspdf === 'partial') {
        issues.push({
          severity: 'info',
          code: 'renderer-partial',
          message: `Block "${block.type}" renders fully in production HTML/WeasyPrint but appears as a placeholder in legacy jsPDF previews`,
          where: blockWhere,
          ...blockCtx,
        });
      } else if (capabilities.productionSafe && capabilities.jspdf === 'unsupported') {
        issues.push({
          severity: 'info',
          code: 'renderer-unsupported',
          message: `Block "${block.type}" is not available in the legacy jsPDF renderer`,
          where: blockWhere,
          ...blockCtx,
        });
      }

      // Slot reference integrity
      if (block.type === 'slot') {
        const key = String(block.props?.slotKey ?? '');
        if (key && !slotKeys.has(key) && !looksLikeBinding(key)) {
          issues.push({
            severity: 'error',
            code: 'missing-slot',
            message: `Slot "${key}" is not defined`,
            where: blockWhere,
            ...blockCtx,
          });
        }
      }

      block.overlays.forEach((o, oi) => {
        const tag = `Page ${pi + 1} → block ${bi + 1} → overlay ${oi + 1}`;
        const ctx = { pageId: page.id, blockId: block.id, overlayId: o.id };

        // Unresolved bindings against sample data
        if (sampleData) {
          const candidateStrings: unknown[] = [
            (o as any).text,
            (o as any).value,
            (o as any).label,
            (o as any).href,
            (o as any).src,
          ];
          const unresolved = new Set<string>();
          for (const s of candidateStrings) {
            for (const p of collectUnresolvedBindings(s, data)) unresolved.add(p);
          }
          unresolved.forEach((path) => {
            issues.push({
              severity: 'warning',
              code: 'unresolved-binding',
              message: `Binding "{{${path}}}" has no value in sample data`,
              where: tag,
              ...ctx,
            });
          });
        }

        // Bleed: any side outside [0, pageSize]
        if (o.x < 0 || o.y < 0 || o.x + o.width > pageW || o.y + o.height > pageH) {
          issues.push({
            severity: 'warning',
            code: 'bleed',
            message: `Overlay extends outside page bounds (${pageW}×${pageH}pt)`,
            where: tag,
            ...ctx,
          });
        }
        // Tight to edge (< 12pt margin) — gentle hint
        if (o.x >= 0 && o.x < 12) {
          issues.push({
            severity: 'warning',
            code: 'overlap-edge',
            message: 'Overlay sits within 12pt of the left edge — increase margin for print safety',
            where: tag,
            ...ctx,
          });
        }

        if (o.type === 'text') {
          // Note: font availability is no longer linted here. The production
          // renderer (WeasyPrint) and the in-editor PDF preview both load
          // arbitrary web fonts (Google Fonts, custom @font-face), so
          // declaring "Playfair Display" or any other family is safe.

          // Tiny text
          if (typeof o.fontSize === 'number' && o.fontSize < 7) {
            issues.push({
              severity: 'warning',
              code: 'tiny-text',
              message: `Font size ${o.fontSize}pt may be unreadable — minimum 7pt recommended`,
              where: tag,
              ...ctx,
            });
          }
          // Contrast vs page background
          const fg = parseHex(o.color);
          if (fg) {
            const ratio = contrastRatio(fg, pageBg);
            if (ratio < 4.5) {
              issues.push({
                severity: 'warning',
                code: 'low-contrast',
                message: `Text contrast is ${ratio.toFixed(2)}:1 — WCAG AA needs 4.5:1`,
                where: tag,
                ...ctx,
              });
            }
          }
        }
      });
    });
  });

  return issues;
}
