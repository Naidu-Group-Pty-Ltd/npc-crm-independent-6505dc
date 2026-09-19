/**
 * The model's reading of the assessment — its contract, not its call.
 *
 * The C&I calculator already has an AI: `commercial-bc-scenario-agent` takes a
 * snapshot of the deal and returns scenarios, each with a name, a reasoning
 * line, an estimated impact, an execution risk and the evidence a broker would
 * have to gather. This module gives the *report* the same capability, held to
 * the same shape — deliberately field-for-field, so a scenario the adviser saw
 * on the calculator reads identically when it arrives in a client's document.
 *
 * Everything about the call that is not the model is here: the facts it is
 * given, the words it is told to use, and — the part that matters — what is
 * done with what comes back. The fetch itself lives in the edge function,
 * because a `fetch` is not testable and this is.
 *
 * ## Three rules the validator enforces, and why each exists
 *
 * **The model is never given a number to compute.** The prompt carries figures
 * already formatted by `Measure`, and the schema has no numeric field anywhere
 * in it. A language model asked for "the new DSCR" will produce a plausible
 * one. Every figure in this document comes from the engine; the model's job is
 * to say what the figures mean, and it is given no way to state a different
 * one — see `FORBIDDEN_CLAIMS` for the assertions it is told not to make.
 *
 * **Length is capped, not trusted.** A section whose length is decided by a
 * model is a section whose page budget is a guess, and this document's spine is
 * validated against a page band before it renders. Every string is truncated
 * here rather than being asked for politely in the prompt.
 *
 * **A malformed answer is no answer.** `parseAnalysis` returns `null` rather
 * than a partial analysis. A report with no analysis section is a complete
 * report; a report with an analysis section containing two of its four parts
 * looks like something failed, and something did.
 */

/** What the model is asked to produce, once it has been checked. */
export interface AnalysisFinding {
  title: string;
  detail: string;
  /** How the finding bears on the facility. Not a colour — a judgement. */
  significance: 'strength' | 'risk' | 'observation';
}

/**
 * One proposed course of action.
 *
 * The five fields are `commercial-bc-scenario-agent`'s, unchanged. The one
 * field of that agent's schema deliberately **not** carried here is
 * `adjustments` — the machine-readable overrides it returns so the calculator
 * can cascade them. A cascade is an action in an application; a PDF has nobody
 * to hand them to, and a column of raw field names in a client's document is
 * noise.
 */
export interface AnalysisScenario {
  name: string;
  reasoning: string;
  estimatedImpact: string;
  executionRisk: 'low' | 'medium' | 'high';
  evidenceRequired: string[];
}

export interface CapacityAnalysis {
  /** The headline read, in prose. One paragraph. */
  interpretation: string;
  findings: AnalysisFinding[];
  scenarios: AnalysisScenario[];
  /** What a credit assessor would ask about this deal. */
  questionsForCredit: string[];
  /** Which model wrote it, and when. Printed on the page — see `render.pure.ts`. */
  model: string;
  /** ISO-8601. Supplied by the caller; this module has no clock. */
  generatedAt: string;
}

// ── Bounds ──────────────────────────────────────────────────────────────────
//
// Every one of these is a page-budget decision rather than a style preference.
// The analysis section claims two pages in the spine, and `validateSpine`
// rejects a document whose total falls outside the archetype's band.

export const MAX_INTERPRETATION_CHARS = 1_400;
export const MAX_FINDINGS = 6;
export const MAX_FINDING_TITLE_CHARS = 90;
export const MAX_FINDING_DETAIL_CHARS = 420;
export const MAX_SCENARIOS = 3;
export const MAX_SCENARIO_NAME_CHARS = 70;
export const MAX_SCENARIO_TEXT_CHARS = 320;
export const MAX_EVIDENCE_ITEMS = 4;
export const MAX_QUESTIONS = 6;
export const MAX_LINE_CHARS = 200;

const SIGNIFICANCE = new Set(['strength', 'risk', 'observation']);
const RISK = new Set(['low', 'medium', 'high']);

/**
 * Collapse whitespace and cut to length.
 *
 * Cut, not ellipsed. A truncated sentence in a finance document should read as
 * a sentence that ended, not as one the software gave up on — and the caps
 * above are set well above what the prompt asks for, so reaching one is a
 * malfunction rather than an expected trim.
 */
function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? collapsed.slice(0, max).trimEnd() : collapsed;
}

function cleanList(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => clean(item, maxChars))
    .filter((item) => item.length > 0)
    .slice(0, maxItems);
}

// ── The facts the model is given ────────────────────────────────────────────

/**
 * What the model is told about the deal.
 *
 * Strings throughout, already formatted. The caller builds this from the
 * payload, so the model sees the same `$5,850,000` and the same `1.42x` the
 * client will read on the page — it cannot round differently, and it cannot
 * reach a figure the document does not contain.
 */
export interface AnalysisFacts {
  outcome: string;
  outcomeReason: string;
  segment: string;
  assessmentType: string;
  assetClass: string;
  location: string;
  lenderProfile: string;
  figures: { label: string; value: string }[];
  constraints: { label: string; cap: string; binding: boolean; applied: boolean }[];
  tenancies: { tenant: string; rent: string; expiry: string }[];
  warnings: string[];
  outstanding: string[];
}

/**
 * Claims the model is told not to make.
 *
 * Written as instructions rather than as a post-hoc filter on purpose: a filter
 * that strips the word "approved" from a sentence leaves a sentence that meant
 * to say it. The check that this list is honoured is a test over the rendered
 * document, not a regex over the model's reply.
 */
export const FORBIDDEN_CLAIMS: readonly string[] = [
  'that the facility is approved, pre-approved, conditionally approved or declined',
  'that any lender will or will not lend, or what a lender has decided',
  'a borrowing capacity, ratio, rate or dollar figure other than the ones supplied',
  'a recommendation to enter a specific credit contract',
  'anything about the borrower not present in the facts supplied',
];

/**
 * The system prompt.
 *
 * The voice is `commercial-bc-scenario-agent`'s — a senior Australian
 * commercial and industrial property finance strategist — because the two are
 * meant to sound like one adviser. What differs is the audience: the agent
 * writes for a broker inside a calculator, this writes for a document that goes
 * to a client, so it is told to write full sentences and to name the binding
 * constraint rather than assume the reader has the screen in front of them.
 */
export const ANALYSIS_SYSTEM_PROMPT = `You are a senior Australian commercial / industrial property finance strategist writing the analysis section of a client-facing finance report.

You are given the completed figures of a commercial or industrial borrowing capacity assessment. Interpret them. You are writing for the borrower and their adviser, so write in full sentences, in plain professional English, and never assume the reader can see a calculator screen.

Your analysis must:
- Open by explaining what the assessment concluded and, specifically, which test bound the capacity and what that means in practice.
- Identify the genuine strengths and the genuine risks in the deal as presented, including anything the figures imply that the borrower may not have noticed.
- Propose 2 to 3 distinct, actionable scenarios that would improve the position (lift capacity, reduce risk, improve DSCR / ICR / LVR / debt yield, restructure the facility, or change lender policy fit). For each: a short name, one or two sentences of reasoning, a short qualitative impact statement, an execution risk of low, medium or high, and 2 to 4 items of evidence the broker must gather.
- List the questions a credit assessor would ask about this deal.

You MUST NOT state:
${FORBIDDEN_CLAIMS.map((claim) => `- ${claim}`).join('\n')}

Every figure has already been calculated and is given to you below. Quote them as given. Do not compute new ones, do not estimate, and do not restate a figure with different rounding. Where a scenario's impact cannot be quantified from what you were given, describe its direction in words instead of inventing a number.

Do not hallucinate details about the borrower, the property or the tenants that are not in the facts supplied.`;

/** The user turn: the facts, as a briefing note rather than as JSON. */
export function buildAnalysisPrompt(facts: AnalysisFacts): string {
  const lines: string[] = [];

  lines.push('## The assessment');
  lines.push(`Outcome: ${facts.outcome}`);
  if (facts.outcomeReason) lines.push(`Why: ${facts.outcomeReason}`);
  lines.push(`Transaction: ${facts.assessmentType} (${facts.segment})`);
  lines.push(`Asset: ${facts.assetClass}${facts.location ? ` at ${facts.location}` : ''}`);
  lines.push(`Lender policy profile applied: ${facts.lenderProfile}`);

  lines.push('');
  lines.push('## The figures');
  for (const figure of facts.figures) lines.push(`- ${figure.label}: ${figure.value}`);

  lines.push('');
  lines.push('## The capacity tests');
  for (const constraint of facts.constraints) {
    const state = !constraint.applied
      ? 'not applicable to this deal'
      : constraint.binding
        ? 'THIS IS THE BINDING CONSTRAINT'
        : 'not binding';
    lines.push(`- ${constraint.label}: permits ${constraint.cap} — ${state}`);
  }

  if (facts.tenancies.length) {
    lines.push('');
    lines.push('## Tenancies');
    for (const t of facts.tenancies) {
      lines.push(`- ${t.tenant}: ${t.rent}${t.expiry ? `, expiring ${t.expiry}` : ''}`);
    }
  }

  if (facts.warnings.length) {
    lines.push('');
    lines.push('## Risk indicators the engine raised');
    for (const warning of facts.warnings) lines.push(`- ${warning}`);
  }

  if (facts.outstanding.length) {
    lines.push('');
    lines.push('## Information still outstanding');
    for (const item of facts.outstanding) lines.push(`- ${item}`);
  }

  return lines.join('\n');
}

/**
 * The tool schema the model is forced to call.
 *
 * A tool call rather than free prose because this section has a structure the
 * page depends on — findings become a table, scenarios become sub-headed
 * blocks — and parsing that back out of Markdown is guesswork. Note that no
 * property anywhere in it is a number.
 */
export const ANALYSIS_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'write_analysis',
    description: 'Return the analysis section of a commercial / industrial capacity report.',
    parameters: {
      type: 'object',
      properties: {
        interpretation: {
          type: 'string',
          description: 'One paragraph: what the assessment concluded, which test bound it, and what that means.',
        },
        findings: {
          type: 'array',
          minItems: 2,
          maxItems: MAX_FINDINGS,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              detail: { type: 'string' },
              significance: { type: 'string', enum: ['strength', 'risk', 'observation'] },
            },
            required: ['title', 'detail', 'significance'],
          },
        },
        scenarios: {
          type: 'array',
          minItems: 2,
          maxItems: MAX_SCENARIOS,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              reasoning: { type: 'string' },
              estimatedImpact: { type: 'string' },
              executionRisk: { type: 'string', enum: ['low', 'medium', 'high'] },
              evidenceRequired: { type: 'array', items: { type: 'string' } },
            },
            required: ['name', 'reasoning', 'estimatedImpact', 'executionRisk', 'evidenceRequired'],
          },
        },
        questionsForCredit: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_QUESTIONS,
          items: { type: 'string' },
        },
      },
      required: ['interpretation', 'findings', 'scenarios', 'questionsForCredit'],
    },
  },
} as const;

// ── Reading the answer back ─────────────────────────────────────────────────

export interface ParseAnalysisOptions {
  model: string;
  /** ISO-8601, from the caller. */
  generatedAt: string;
}

/**
 * Validate a model reply into an analysis, or refuse it.
 *
 * `null` on anything that is not a complete analysis. The four parts are the
 * section: an interpretation with no findings is an opinion, and findings with
 * no interpretation is a list. Neither is what the page claims to be.
 *
 * Accepts either the parsed tool arguments or the JSON string the gateway
 * returns them as, because the caller has both and unwrapping it in two places
 * is how the two drift.
 */
export function parseAnalysis(
  raw: unknown,
  options: ParseAnalysisOptions,
): CapacityAnalysis | null {
  let source = raw;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      return null;
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const body = source as Record<string, unknown>;

  const interpretation = clean(body.interpretation, MAX_INTERPRETATION_CHARS);
  if (!interpretation) return null;

  const findings: AnalysisFinding[] = (Array.isArray(body.findings) ? body.findings : [])
    .map((entry): AnalysisFinding | null => {
      if (!entry || typeof entry !== 'object') return null;
      const f = entry as Record<string, unknown>;
      const title = clean(f.title, MAX_FINDING_TITLE_CHARS);
      const detail = clean(f.detail, MAX_FINDING_DETAIL_CHARS);
      const significance = typeof f.significance === 'string' ? f.significance : '';
      if (!title || !detail) return null;
      return {
        title,
        detail,
        // An unrecognised significance becomes an observation rather than
        // discarding the finding: the model got the words right and the label
        // wrong, and the words are the part a reader needs.
        significance: SIGNIFICANCE.has(significance)
          ? (significance as AnalysisFinding['significance'])
          : 'observation',
      };
    })
    .filter((f): f is AnalysisFinding => f !== null)
    .slice(0, MAX_FINDINGS);
  if (!findings.length) return null;

  const scenarios: AnalysisScenario[] = (Array.isArray(body.scenarios) ? body.scenarios : [])
    .map((entry): AnalysisScenario | null => {
      if (!entry || typeof entry !== 'object') return null;
      const s = entry as Record<string, unknown>;
      const name = clean(s.name, MAX_SCENARIO_NAME_CHARS);
      const reasoning = clean(s.reasoning, MAX_SCENARIO_TEXT_CHARS);
      if (!name || !reasoning) return null;
      const risk = typeof s.executionRisk === 'string' ? s.executionRisk.toLowerCase() : '';
      return {
        name,
        reasoning,
        estimatedImpact: clean(s.estimatedImpact, MAX_SCENARIO_TEXT_CHARS),
        // Unknown risk reads as `medium`. There is no "unrated" column on the
        // page, and defaulting to `low` would understate something nobody
        // assessed.
        executionRisk: RISK.has(risk) ? (risk as AnalysisScenario['executionRisk']) : 'medium',
        evidenceRequired: cleanList(s.evidenceRequired, MAX_EVIDENCE_ITEMS, MAX_LINE_CHARS),
      };
    })
    .filter((s): s is AnalysisScenario => s !== null)
    .slice(0, MAX_SCENARIOS);
  if (!scenarios.length) return null;

  return {
    interpretation,
    findings,
    scenarios,
    questionsForCredit: cleanList(body.questionsForCredit, MAX_QUESTIONS, MAX_LINE_CHARS),
    model: clean(options.model, 60) || 'unknown',
    generatedAt: options.generatedAt,
  };
}
