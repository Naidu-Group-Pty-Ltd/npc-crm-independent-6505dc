/**
 * Asking the server for a Borrowing Capacity Snapshot.
 *
 * One function behind every button that produces this document. The five call
 * sites currently each build the PDF in the browser with jsPDF; this replaces
 * that with a request, and the server decides what the document says.
 *
 * ## The fallback, and why it is here at all
 *
 * `render-borrowing-capacity-pdf` has to be deployed, and the migration it
 * depends on has to be applied, before it can answer. Those are manual steps.
 * Between merging this and doing them, every one of those buttons would fail.
 *
 * So a missing function — and *only* a missing function — falls back to the
 * generator that ships today, and **says so**. That is not the silent downgrade
 * the render path refuses: a WeasyPrint failure inside the new path still fails
 * the request, because a lesser renderer would produce a document nobody
 * approved. This is a deployment gap, the fallback is exactly what the product
 * did yesterday, and the caller is told which one they got.
 *
 * Delete `legacyFallback` once the function is deployed. It has one job and it
 * is finished the moment that is true.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  announceDesignOutcome,
  designBody,
  standardDesignFor,
  type StandardDesignRequest,
} from '@/lib/reportTemplate/standardDesign';
import { looksUndeployed } from '../undeployedRoute';

export interface SnapshotRequest {
  clientId: string;
  clientName: string;
  /** Omit for the most recent assessment. */
  assessmentId?: string | null;
  scenarioPresets?: unknown[];
  edition?: string | null;
  /**
   * The design to draw the document in. Omit it and the person's own choice
   * for the format is read (`standardDesign.ts`); `null` asks for the
   * standard design whatever was chosen. How it looks, never what it says.
   */
  design?: StandardDesignRequest | null;
}

export interface SnapshotResult {
  url: string;
  fileName: string;
  bytes: number;
  pageCount: number | null;
  /** What the tenant's brand snapshot was missing. Empty for a complete one. */
  brandGaps: string[];
  /**
   * Where the route stored these exact bytes (in `client-files`), or null for
   * a document nothing stored — the in-browser generator on the deployment-gap
   * fallback. A caller that publishes the document points the portal at it,
   * so the file a client opens is the one that was reviewed and it exists
   * once (RS-5c.3).
   */
  storagePath: string | null;
  /** `server` for the new path, `legacy` when the route is not deployed yet. */
  source: 'server' | 'legacy';
}

/**
 * True when the failure means "this function does not exist here yet".
 *
 * Deliberately narrow. A 500 from a deployed function is a real failure and
 * must surface as one — falling back on it would hide a broken render behind a
 * document that looks fine.
 */
// The predicate is shared (`../undeployedRoute`). This module carried its own
// copy which could not match the message the transport actually produces for an
// absent function, so the in-browser generator handed in as `legacyFallback`
// was never called and the person got an error and NO FILE. The bare-404 rule
// that comment defended is preserved there: only a missing *function* counts,
// never a 404 the route itself answered for a client the caller may not see.

/**
 * Request the document.
 *
 * `legacyFallback` is invoked only when the route is absent; it is passed in
 * rather than imported so this module does not drag the whole jsPDF generator
 * into every bundle that touches a download button.
 */
export async function requestBorrowingCapacitySnapshot(
  request: SnapshotRequest,
  legacyFallback?: () => Promise<{ url: string; fileName: string; bytes: number } | null>,
): Promise<SnapshotResult> {
  const design = await standardDesignFor('borrowing_capacity', request.design);
  const { data, error } = await invokeSecureFunction('render-borrowing-capacity-pdf', {
    clientId: request.clientId,
    assessmentId: request.assessmentId ?? null,
    scenarioPresets: request.scenarioPresets ?? [],
    edition: request.edition ?? null,
    ...designBody(design),
  }, { timeoutMs: 180_000 });

  if (!error && data?.url) {
    announceDesignOutcome(design, data.design);
    return {
      url: String(data.url),
      fileName: String(data.fileName ?? 'Borrowing_Capacity_Snapshot.pdf'),
      bytes: Number(data.bytes ?? 0),
      pageCount: Number.isFinite(data.pageCount) ? Number(data.pageCount) : null,
      brandGaps: Array.isArray(data.brandGaps) ? data.brandGaps.map(String) : [],
      storagePath: typeof data.path === 'string' && data.path ? String(data.path) : null,
      source: 'server',
    };
  }

  if (legacyFallback && looksUndeployed(error)) {
    console.warn(
      '[borrowing-capacity] render-borrowing-capacity-pdf is not deployed; '
      + 'falling back to the in-browser generator. '
      + 'Deploy the function and apply migration 20260814000000 to use the new report.',
    );
    const legacy = await legacyFallback();
    if (legacy) {
      announceDesignOutcome(design, null, { drawnWithoutRoute: true });
      return { ...legacy, pageCount: null, brandGaps: [], storagePath: null, source: 'legacy' };
    }
  }

  throw new Error(error?.message || 'Could not generate the Borrowing Capacity Snapshot');
}
