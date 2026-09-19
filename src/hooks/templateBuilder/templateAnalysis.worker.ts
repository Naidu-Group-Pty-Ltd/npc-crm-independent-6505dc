/**
 * templateAnalysis.worker — full-document binding + lint analysis off the main
 * thread.
 *
 * Rehaul Phase 3: requests arrive as per-page payloads/stubs (see
 * templateAnalysisProtocol) instead of a full template clone — the worker
 * keeps previously-received pages and reassembles the document, so a one-page
 * edit ships one page across the thread boundary, not the whole document.
 */
import { collectTemplateIssues } from '@/lib/reportTemplate/bindingValidation';
import { lintTemplate } from '@/lib/reportTemplate/lintTemplate';
import {
  assembleAnalysisInput,
  createAnalysisWorkerState,
  type AnalysisRequest,
  type AnalysisResponse,
} from './templateAnalysisProtocol';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null;
  postMessage: (message: AnalysisResponse) => void;
};

const state = createAnalysisWorkerState();

workerScope.onmessage = (event) => {
  const request = event.data;
  const { requestId } = request;

  const input = assembleAnalysisInput(state, request);
  if (!input) {
    // We were asked to reuse a page/data version we don't hold (e.g. this
    // worker was just spawned). The main thread resends full payloads.
    workerScope.postMessage({
      requestId,
      ok: false,
      error: 'analysis worker cache miss',
      needsFullPayload: true,
    });
    return;
  }

  try {
    workerScope.postMessage({
      requestId,
      ok: true,
      bindingIssues: collectTemplateIssues(input.template),
      lintIssues: lintTemplate(input.template, input.sampleData),
    });
  } catch (error) {
    workerScope.postMessage({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
