import { useEffect, useMemo, useRef, useState } from 'react';
import { collectTemplateIssues, type TemplateIssue } from '@/lib/reportTemplate/bindingValidation';
import { lintTemplate, type LintIssue } from '@/lib/reportTemplate/lintTemplate';
import type { Page, ReportTemplate } from '@/lib/reportTemplate/templateSchema';
import {
  buildAnalysisRequest,
  createWorkerKnownState,
  rememberAnalysisRequest,
  type AnalysisResponse,
  type WorkerKnownState,
} from './templateAnalysisProtocol';

interface TemplateAnalysisResult {
  bindingIssues: TemplateIssue[];
  lintIssues: LintIssue[];
  activePageBindingIssues: TemplateIssue[];
  activePageLintIssues: LintIssue[];
  isCheckingFullDocument: boolean;
}

const FULL_ANALYSIS_DEBOUNCE_MS = 180;
const IDLE_TIMEOUT_MS = 700;

const scheduleIdle = (callback: () => void, timeout = IDLE_TIMEOUT_MS): (() => void) => {
  if (typeof window === 'undefined') {
    const handle = setTimeout(callback, 0);
    return () => clearTimeout(handle);
  }

  const win = window as Window & {
    requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (win.requestIdleCallback && win.cancelIdleCallback) {
    const handle = win.requestIdleCallback(callback, { timeout });
    return () => win.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(callback, Math.min(timeout, 250));
  return () => window.clearTimeout(handle);
};

const makeSinglePageTemplate = (
  template: ReportTemplate,
  page: Page | null,
): ReportTemplate => ({
  ...template,
  pages: page ? [page] : [],
});

const runTemplateAnalysis = (
  template: ReportTemplate,
  sampleData: Record<string, any>,
) => ({
  bindingIssues: collectTemplateIssues(template),
  lintIssues: lintTemplate(template, sampleData),
});

/**
 * Runs active-page checks synchronously while moving expensive full-document
 * checks into a debounced background worker. If the worker cannot be started
 * (SSR/tests/older browser/CSP), the full pass falls back to an idle callback.
 * Save/export/activation preflight validation still calls the validators
 * directly, so the background analysis never weakens guardrails.
 */
export function useTemplateAnalysis(
  template: ReportTemplate,
  activePage: Page | null,
  sampleData: Record<string, any>,
): TemplateAnalysisResult {
  const activePageTemplate = useMemo(
    () => makeSinglePageTemplate(template, activePage),
    [
      activePage,
      template.activeThemeId,
      template.canvas,
      template.defaultPageMasterId,
      template.pageMasters,
      template.slots,
      template.themes,
      template.tokens,
      template.version,
    ],
  );

  const activePageBindingIssues = useMemo(
    () => collectTemplateIssues(activePageTemplate),
    [activePageTemplate],
  );

  const activePageLintIssues = useMemo<LintIssue[]>(
    () => lintTemplate(activePageTemplate, sampleData),
    [activePageTemplate, sampleData],
  );

  const [fullAnalysis, setFullAnalysis] = useState(() => runTemplateAnalysis(template, sampleData));
  const [isCheckingFullDocument, setIsCheckingFullDocument] = useState(false);
  const generationRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  // What the current worker holds (per-page content keys + sample data key) —
  // lets each request ship only the changed pages (rehaul Phase 3).
  const workerKnownRef = useRef<WorkerKnownState>(createWorkerKnownState());

  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => {
    const requestId = ++generationRef.current;
    let cancelled = false;
    let cancelIdle: (() => void) | null = null;
    setIsCheckingFullDocument(true);

    const finishWithLocalAnalysis = () => {
      cancelIdle = scheduleIdle(() => {
        const next = runTemplateAnalysis(template, sampleData);
        if (cancelled || generationRef.current !== requestId) return;
        setFullAnalysis(next);
        setIsCheckingFullDocument(false);
      });
    };

    const debounceHandle = window.setTimeout(() => {
      if (cancelled) return;

      if (typeof Worker === 'undefined') {
        finishWithLocalAnalysis();
        return;
      }

      try {
        if (!workerRef.current) {
          workerRef.current = new Worker(new URL('./templateAnalysis.worker.ts', import.meta.url), { type: 'module' });
          // Fresh worker holds nothing — first request ships full payloads.
          workerKnownRef.current = createWorkerKnownState();
        }

        const worker = workerRef.current;
        const post = (full: boolean) => {
          if (full) workerKnownRef.current = createWorkerKnownState();
          const request = buildAnalysisRequest(requestId, template, sampleData, workerKnownRef.current);
          worker.postMessage(request);
          rememberAnalysisRequest(request, workerKnownRef.current);
        };
        worker.onmessage = (event: MessageEvent<AnalysisResponse>) => {
          const message = event.data;
          if (cancelled || message.requestId !== requestId || generationRef.current !== requestId) return;

          if (message.ok) {
            setFullAnalysis({
              bindingIssues: message.bindingIssues,
              lintIssues: message.lintIssues,
            });
            setIsCheckingFullDocument(false);
            return;
          }

          if ((message as { needsFullPayload?: boolean }).needsFullPayload) {
            // Worker lacks pages we stubbed (restart/desync) — resend in full.
            // A full request always assembles, so this cannot loop.
            post(true);
            return;
          }

          finishWithLocalAnalysis();
        };
        worker.onerror = () => {
          if (cancelled || generationRef.current !== requestId) return;
          workerRef.current?.terminate();
          workerRef.current = null;
          workerKnownRef.current = createWorkerKnownState();
          finishWithLocalAnalysis();
        };
        post(false);
      } catch {
        finishWithLocalAnalysis();
      }
    }, FULL_ANALYSIS_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(debounceHandle);
      cancelIdle?.();
    };
  }, [template, sampleData]);

  return {
    bindingIssues: fullAnalysis.bindingIssues,
    lintIssues: fullAnalysis.lintIssues,
    activePageBindingIssues,
    activePageLintIssues,
    isCheckingFullDocument,
  };
}
