import {
  buildFidelityReport,
  buildRepairInstruction,
  lowRegionsToPageRects,
  rgbaToGray,
  type FidelityOptions,
  type FidelityReport,
  type PageRect,
} from '../../fidelityMetrics';
import type { TemplateImportPlan } from './types';

export interface VisualDiffIssue {
  region: PageRect;
  issue: string;
  severity: 'low' | 'medium' | 'high';
}

export interface VisualDiffRepairReport {
  pageId: string;
  sourcePageId?: string;
  diffScore: number;
  confidence: number;
  band: FidelityReport['band'];
  comparisonSize: { width: number; height: number };
  pageSize: { width: number; height: number };
  issues: VisualDiffIssue[];
  repairInstruction: string;
}

export interface BuildVisualDiffReportArgs {
  plan: TemplateImportPlan;
  pageId: string;
  fidelity: FidelityReport;
  maxIssues?: number;
}

export interface BuildVisualDiffReportFromRgbaArgs extends Omit<BuildVisualDiffReportArgs, 'fidelity'> {
  sourceRgba: ArrayLike<number>;
  renderedRgba: ArrayLike<number>;
  width: number;
  height: number;
  fidelityOptions?: FidelityOptions;
}

function issueSeverity(confidence: number): VisualDiffIssue['severity'] {
  if (confidence < 0.35) return 'high';
  if (confidence < 0.6) return 'medium';
  return 'low';
}

export function buildVisualDiffRepairReport(args: BuildVisualDiffReportArgs): VisualDiffRepairReport {
  const page = args.plan.pages.find((p) => p.id === args.pageId || p.sourcePageId === args.pageId);
  if (!page) throw new Error(`Cannot build visual diff report: unknown page ${args.pageId}.`);
  const rects = lowRegionsToPageRects(args.fidelity, page.width, page.height);
  const maxIssues = Math.max(1, args.maxIssues ?? 8);
  const worstRegions = args.fidelity.low.slice(0, maxIssues);
  const issues = rects.slice(0, maxIssues).map((region, index) => {
    const source = worstRegions[index] ?? worstRegions[worstRegions.length - 1];
    const confidence = source?.confidence ?? args.fidelity.overall;
    return {
      region,
      issue: `Rendered output differs from the reference in this region (SSIM confidence ${Math.round(confidence * 100)}%).`,
      severity: issueSeverity(confidence),
    } satisfies VisualDiffIssue;
  });

  return {
    pageId: page.id,
    sourcePageId: page.sourcePageId,
    diffScore: Math.max(0, Math.min(1, 1 - args.fidelity.overall)),
    confidence: args.fidelity.overall,
    band: args.fidelity.band,
    comparisonSize: { width: args.fidelity.width, height: args.fidelity.height },
    pageSize: { width: page.width, height: page.height },
    issues,
    repairInstruction: buildRepairInstruction(issues.map((i) => i.region), page.id),
  };
}

export function buildVisualDiffRepairReportFromRgba(args: BuildVisualDiffReportFromRgbaArgs): VisualDiffRepairReport {
  const source = rgbaToGray(args.sourceRgba, args.width, args.height);
  const rendered = rgbaToGray(args.renderedRgba, args.width, args.height);
  const fidelity = buildFidelityReport(source, rendered, args.width, args.height, args.fidelityOptions);
  return buildVisualDiffRepairReport({
    plan: args.plan,
    pageId: args.pageId,
    fidelity,
    maxIssues: args.maxIssues,
  });
}
