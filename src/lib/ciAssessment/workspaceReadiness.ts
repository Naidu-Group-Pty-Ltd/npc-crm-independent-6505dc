/**
 * Whether this analysis can become a client document, and what is in the way.
 *
 * ## Why it is one function
 *
 * The page this replaces computed readiness from a hand-written list of field
 * names (`requiredReportHints`, `reportSectionsRequired`) matched against a
 * transient store by string, and used it to enable a button that produced no
 * document. Three separate ideas of "ready" lived on that screen — a workflow
 * strip, a readiness badge and the button's own `disabled` — and none of them
 * agreed with what the report route would actually accept.
 *
 * The real contract is already enforced server-side: the capacity report is
 * produced from a **stored calculation run** on a **completed** assessment
 * (`route.pure.ts`'s `isReportable`), rendered by WeasyPrint from the run's own
 * snapshot. So readiness here is not a second opinion — it is that contract,
 * stated early enough to be actionable, plus the things that do not block a
 * render but must be disclosed to the person pressing the button.
 *
 * ## Blocking versus warning
 *
 * Blocking is only what the server will refuse: no saved calculation, an
 * assessment that has not been completed, validation errors that stop the
 * engine. Everything else — an assumption nobody verified, an analysis section
 * with no inputs, figures that have moved since the run — is a **warning**,
 * because a report generated with disclosure is a legitimate business
 * outcome and inventing a restriction the business does not have is not.
 */

import type { AssessmentResult } from './engine';
import type { AnalysisResult } from './analysisEngine';
import type { AssessmentStatus } from './types';
import type { ValidationIssue } from './validation';

export interface ReadinessItem {
  /** What is wrong, in the operator's words. */
  message: string;
  /** The stage that resolves it, so the item can be a link rather than a note. */
  stage?: string;
}

export interface WorkspaceReadiness {
  /** True when the server will accept a report request. */
  canGenerate: boolean;
  blocking: ReadinessItem[];
  warnings: ReadinessItem[];
  /** One line for a badge: "Report ready" or "3 items need attention". */
  headline: string;
}

export interface ReadinessInput {
  status: AssessmentStatus;
  hasSavedCalculation: boolean;
  /** True when the working payload has moved away from the saved run. */
  figuresChanged: boolean;
  errors: readonly ValidationIssue[];
  lending: AssessmentResult | null;
  analysis: AnalysisResult | null;
  /** Set when the analysis is linked to a client record. */
  clientLinked: boolean;
}

export function evaluateReadiness(input: ReadinessInput): WorkspaceReadiness {
  const blocking: ReadinessItem[] = [];
  const warnings: ReadinessItem[] = [];

  // ---- Blocking: exactly what the report route enforces -------------------
  if (input.errors.length) {
    blocking.push({
      message: `${input.errors.length} required field${input.errors.length === 1 ? '' : 's'} still need attention`,
      stage: input.errors[0]?.section,
    });
  }
  if (!input.hasSavedCalculation) {
    blocking.push({
      message: 'No saved calculation — run the calculation to snapshot the inputs, policy and outputs together',
      stage: 'results',
    });
  } else if (input.status !== 'completed' && input.status !== 'linked') {
    blocking.push({
      message: 'The analysis is not complete — the report states the figures of the completed run',
      stage: 'results',
    });
  }

  // ---- Warnings: disclosed, not prevented ---------------------------------
  if (input.figuresChanged) {
    warnings.push({
      message: 'The figures have moved since the saved calculation — the report will state the saved ones',
      stage: 'results',
    });
  }
  if (input.lending?.outcome === 'requires_specialist_review') {
    warnings.push({ message: 'This transaction is routed to specialist review', stage: 'results' });
  }
  if (input.lending?.outcome === 'insufficient_information') {
    warnings.push({ message: 'The lending position is incomplete — some outputs will read as unavailable', stage: 'results' });
  }
  const criticalWarnings = (input.lending?.warnings ?? []).filter((warning) => warning.severity === 'critical');
  if (criticalWarnings.length) {
    warnings.push({
      message: `${criticalWarnings.length} critical policy warning${criticalWarnings.length === 1 ? '' : 's'} will appear in the document`,
      stage: 'results',
    });
  }
  if (input.analysis && !input.analysis.valuation) {
    warnings.push({ message: 'No valuation analysis — the yield section will be omitted', stage: 'valuation' });
  }
  if (input.analysis && !input.analysis.forecast) {
    warnings.push({ message: 'No forecast — the return section will be omitted', stage: 'forecast' });
  }
  if (!input.clientLinked) {
    warnings.push({
      message: 'Not linked to a client — the document will not appear on a client record',
      stage: 'report',
    });
  }

  const canGenerate = blocking.length === 0;
  const attention = blocking.length + warnings.length;

  return {
    canGenerate,
    blocking,
    warnings,
    headline: canGenerate && warnings.length === 0
      ? 'Report ready'
      : `${attention} item${attention === 1 ? '' : 's'} need${attention === 1 ? 's' : ''} attention`,
  };
}
