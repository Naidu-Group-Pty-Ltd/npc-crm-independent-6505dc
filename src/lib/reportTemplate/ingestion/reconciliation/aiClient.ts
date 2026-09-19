import type { TemplateImportPatch, TemplateImportPlan, ReconciliationRequest } from './types';
import { buildBackgroundFirstImportPlan } from './planBuilder';
import { assertValidTemplateImportPlan } from './validatePlan';
import { buildReconciliationPrompt } from './prompt';
import { parseTemplateImportPlanResponse } from './responseParser';
import { filterWellFormedRepairPatches, DEFAULT_MAX_REPAIR_OPERATIONS } from './visualDiffRepairPatch';

export interface RepairRequest {
  plan: TemplateImportPlan;
  diffReport: unknown;
  maxOperations?: number;
}

/**
 * C9 — single-page visual-repair request. The page id scopes the model to one
 * page; the raw response is validated by `validateVisualDiffRepairPatches`
 * (page-scoped) at the call site, so `repairPage` returns the RAW patch payload.
 */
export interface SinglePageRepairRequest {
  pageId: string;
  diffReport?: unknown;
  plan?: TemplateImportPlan | unknown;
  maxOperations?: number;
}

/**
 * Stage 3 — a page critique request. Two images and the ids on the page; the
 * response is findings only, and no part of it can touch a template.
 */
export interface VisualCritiqueRequest {
  pageId: string;
  pageWidth: number;
  pageHeight: number;
  sourceImageDataUrl: string;
  renderedImageDataUrl: string;
  elements: unknown[];
}

export interface ReconciliationAiClient {
  reconcile(input: ReconciliationRequest): Promise<TemplateImportPlan>;
  repair(input: RepairRequest): Promise<TemplateImportPatch[]>;
  /** C9 — page-scoped repair; returns the raw (unvalidated) patch payload. */
  repairPage(input: SinglePageRepairRequest): Promise<unknown>;
  critiquePage(input: VisualCritiqueRequest): Promise<unknown>;
}

export type ReconciliationInvoke = (
  name: string,
  body?: Record<string, unknown>,
  options?: { timeoutMs?: number },
) => Promise<{ data: unknown; error: { message: string } | null }>;

/**
 * Deterministic local client used as a safe fallback and in tests. It encodes
 * the architectural guarantee that an import can always open as a background-
 * first template even when an AI provider is unavailable or returns bad JSON.
 */
export class BackgroundFirstReconciliationClient implements ReconciliationAiClient {
  async reconcile(input: ReconciliationRequest): Promise<TemplateImportPlan> {
    return assertValidTemplateImportPlan(buildBackgroundFirstImportPlan(input.importAsset, { importId: input.importAsset.fileId }));
  }

  async repair(): Promise<TemplateImportPatch[]> {
    return [];
  }

  async repairPage(): Promise<unknown> {
    return [];
  }

  /** No critique without a backend: these clients are deterministic stand-ins. */
  async critiquePage(): Promise<unknown> { return { findings: [] }; }
}

export class StaticPlanReconciliationClient implements ReconciliationAiClient {
  constructor(private readonly plan: TemplateImportPlan) {}

  async reconcile(): Promise<TemplateImportPlan> {
    return assertValidTemplateImportPlan(this.plan);
  }

  async repair(): Promise<TemplateImportPatch[]> {
    return [];
  }

  async repairPage(): Promise<unknown> {
    return [];
  }

  /** No critique without a backend: these clients are deterministic stand-ins. */
  async critiquePage(): Promise<unknown> { return { findings: [] }; }
}

function extractPlanCandidate(data: unknown): unknown {
  const d = data as any;
  return d?.templateImportPlan ?? d?.plan ?? d?.reconciliationPlan ?? d?.json ?? d?.text ?? d?.content ?? d;
}

function extractPatchesCandidate(data: unknown): unknown {
  const d = data as any;
  return d?.patches ?? d?.operations ?? d;
}

export class TemplateDesignAgentReconciliationClient implements ReconciliationAiClient {
  constructor(private readonly invoke: ReconciliationInvoke) {}

  async reconcile(input: ReconciliationRequest): Promise<TemplateImportPlan> {
    const prompt = buildReconciliationPrompt(input);
    const primaryImageDataUrl = input.importAsset.pages[0]?.referenceImageUrl;
    const { data, error } = await this.invoke('template-design-agent', {
      mode: 'layout_reconciliation',
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      instruction: `${prompt.system}\n\n${prompt.user}`,
      schemaSummary: prompt.schemaSummary,
      importAsset: input.importAsset,
      manifests: input.manifests,
      vision: input.vision ?? [],
      constraints: input.constraints ?? {},
      existingTemplate: input.existingTemplate,
      imageDataUrl: primaryImageDataUrl,
    }, { timeoutMs: 180000 });

    if (error) throw new Error(error.message);
    return parseTemplateImportPlanResponse(extractPlanCandidate(data));
  }

  async repair(input: RepairRequest): Promise<TemplateImportPatch[]> {
    const { data, error } = await this.invoke('template-design-agent', {
      mode: 'layout_reconciliation_repair',
      plan: input.plan,
      diffReport: input.diffReport,
      maxOperations: input.maxOperations ?? DEFAULT_MAX_REPAIR_OPERATIONS,
      instruction: 'Return TemplateImportPatch[] JSON only. Do not rewrite the full template.',
    }, { timeoutMs: 120000 });
    if (error) throw new Error(error.message);
    // C9 — runtime-validate the model output instead of a blind `as` cast:
    // malformed ops, text-content edits, and added text overlays are dropped.
    return filterWellFormedRepairPatches(extractPatchesCandidate(data));
  }

  /**
   * C9 — page-scoped visual repair. Returns the RAW patch payload; the caller
   * validates it with `validateVisualDiffRepairPatches({ pageId })` (page-scoped
   * allowlist) before it can touch the template.
   */
  async repairPage(input: SinglePageRepairRequest): Promise<unknown> {
    const { data, error } = await this.invoke('template-design-agent', {
      mode: 'layout_reconciliation_repair',
      pageId: input.pageId,
      diffReport: input.diffReport,
      plan: input.plan,
      maxOperations: input.maxOperations ?? DEFAULT_MAX_REPAIR_OPERATIONS,
      instruction: `Return a visual-diff-repair-patch-v1 JSON array for page ${input.pageId} ONLY. Geometry/style/background alignment only — never edit or add text content, never touch another page. Do not rewrite the template.`,
    }, { timeoutMs: 120000 });
    if (error) throw new Error(error.message);
    return extractPatchesCandidate(data);
  }

  /**
   * Stage 3 — show the model the source page and the rendered page and ask what
   * differs. Returns the RAW envelope; `runVisualCritique` drops findings that
   * name elements the page does not contain and checks the rest against the
   * measured geometry before any of it reaches a reviewer.
   *
   * There is no patch in this response and no path from it to the template.
   */
  async critiquePage(input: VisualCritiqueRequest): Promise<unknown> {
    const { data, error } = await this.invoke('template-design-agent', {
      mode: 'visual_critique',
      pageId: input.pageId,
      pageWidth: input.pageWidth,
      pageHeight: input.pageHeight,
      sourceImageDataUrl: input.sourceImageDataUrl,
      renderedImageDataUrl: input.renderedImageDataUrl,
      elements: input.elements,
    }, { timeoutMs: 120000 });
    if (error) throw new Error(error.message);
    return data;
  }
}

export async function reconcileWithFallback(
  client: ReconciliationAiClient,
  request: ReconciliationRequest,
  fallbackPlan: TemplateImportPlan,
  onWarning?: (message: string) => void,
): Promise<TemplateImportPlan> {
  try {
    return assertValidTemplateImportPlan(await client.reconcile(request));
  } catch (error) {
    onWarning?.((error as Error)?.message ?? 'AI reconciliation failed.');
    return assertValidTemplateImportPlan(fallbackPlan);
  }
}
