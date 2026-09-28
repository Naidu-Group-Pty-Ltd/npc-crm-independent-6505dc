/**
 * The Strategy Rationale Brief, typeset in the chosen design.
 *
 * The What-If modeller's "Download PDF" used to draw the brief in the browser
 * with jsPDF (`StrategyRationalePDF.ts`), which could honour a chosen template
 * only as a palette. It now asks `render-borrowing-capacity-pdf` for the brief
 * (`document: 'strategy_rationale'`), drawn by the pinned engine in the design
 * chosen for Borrowing Capacity — the report type the brief has always taken
 * its design from (`DRAWN_DOCUMENTS`).
 *
 * **The words are the modeller's, unchanged.** `composeStrategyRationale` turns
 * the engine's report and the panel's context into the strings the jsPDF brief
 * prints, here in the browser, where the scenario lives; the server only reads
 * them back against that shape and draws them. BORROWING_CAPACITY.md §17.
 *
 * Two answers fall back to the jsPDF brief, and say so:
 *  - the route is not deployed here (`looksUndeployed`), and
 *  - the route answered without echoing `document: 'strategy_rationale'` — a
 *    deployment older than the brief ignores the field and draws a Snapshot,
 *    and saving that under the brief's name would hand over the wrong document.
 * Anything else is a real failure and is thrown with the route's own message.
 */
import { format } from 'date-fns';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  announceDesignOutcome,
  designBody,
  standardDesignFor,
  type StandardDesignRequest,
} from '@/lib/reportTemplate/standardDesign';
import { smartCapitalize } from '@/utils/nameFormatting';
import { looksUndeployed } from '../undeployedRoute';
import {
  composeStrategyRationale,
  strategyRationaleFileName,
  type RationaleContextInput,
  type RationaleReportInput,
} from './strategyRationale.pure';

export interface StrategyRationaleRequest {
  clientId: string;
  /** As the panel has it; the server prints the name the client record holds. */
  clientName: string;
  report: RationaleReportInput & { generatedAt: string };
  context: RationaleContextInput;
  /** Omit to read the person's choice for Borrowing Capacity; `null` for the standard design. */
  design?: StandardDesignRequest | null;
}

export interface StrategyRationaleResult {
  blob: Blob;
  fileName: string;
  /** `server` for the typeset brief, `legacy` for the jsPDF one. */
  source: 'server' | 'legacy';
}

/**
 * The generated line, formatted exactly as the jsPDF brief formats it — in the
 * adviser's own time zone, which is why it is composed here and not on a server.
 */
export function rationaleGeneratedLabel(generatedAt: string): string {
  const at = new Date(generatedAt);
  return Number.isNaN(at.getTime()) ? '' : format(at, 'dd MMMM yyyy, HH:mm');
}

/** The file name the jsPDF brief has always used: the panel's name, today's local date. */
export function rationaleDownloadName(clientName: string, now: Date = new Date()): string {
  return strategyRationaleFileName(smartCapitalize(clientName) || 'Client', format(now, 'yyyy-MM-dd'));
}

/**
 * Produce the brief. `legacy` is the jsPDF generator bound to the same report
 * and context — passed in so this module does not carry jsPDF into a bundle.
 */
export async function requestStrategyRationale(
  request: StrategyRationaleRequest,
  legacy: () => Promise<{ blob: Blob; fileName: string }>,
): Promise<StrategyRationaleResult> {
  const design = await standardDesignFor('borrowing_capacity', request.design);
  const rationale = composeStrategyRationale(
    request.report,
    request.context,
    rationaleGeneratedLabel(request.report.generatedAt),
  );
  const { data, error } = await invokeSecureFunction('render-borrowing-capacity-pdf', {
    clientId: request.clientId,
    document: 'strategy_rationale',
    rationale,
    ...designBody(design),
  }, { timeoutMs: 180_000 });

  if (!error && data?.url && data.document === 'strategy_rationale') {
    announceDesignOutcome(design, data.design);
    // Fetched rather than followed, so the file is saved rather than opened.
    const response = await fetch(String(data.url));
    if (!response.ok) throw new Error(`Download failed (${response.status})`);
    return {
      blob: await response.blob(),
      fileName: rationaleDownloadName(request.clientName),
      source: 'server',
    };
  }

  const olderDeployment = !error && Boolean(data?.url);
  if (olderDeployment || looksUndeployed(error)) {
    console.warn(
      '[strategy-rationale] render-borrowing-capacity-pdf '
      + (olderDeployment ? 'predates the Strategy Rationale Brief' : 'is not deployed')
      + '; the brief was drawn in the browser instead.',
    );
    const produced = await legacy();
    announceDesignOutcome(design, null, { drawnWithoutRoute: true });
    return { ...produced, source: 'legacy' };
  }

  throw new Error(error?.message || 'Could not generate the Strategy Rationale Brief');
}
