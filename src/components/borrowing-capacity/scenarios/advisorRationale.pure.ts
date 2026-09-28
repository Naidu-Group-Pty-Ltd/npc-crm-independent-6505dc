/**
 * An advisor card, as the reasoning the Strategy Rationale carries.
 *
 * The Strategy Advisor's system prompt tells it to write each scenario's
 * `reasoning` "as if it will be quoted directly into a finance handoff
 * (because it will)" — and until this module nothing quoted it: the card's
 * explanation, its execution risk, the evidence it names and the levers it set
 * aside were drawn on the card and nowhere else, so the Strategy Rationale and
 * its PDF described the levers the card set while saying nothing of why this
 * client should use them. Applying a card now carries all four with its levers.
 *
 * Structural input, so a card persisted in an older shape (the chat history is
 * kept in the browser) is read defensively rather than trusted.
 */
import type {
  RationaleAdvisorInput,
  RationaleAdvisorOptionInput,
} from '@/lib/reports/borrowingCapacity/strategyRationale.pure';

export interface AdvisorCardLike {
  name?: unknown;
  reasoning?: unknown;
  executionRisk?: unknown;
  evidenceRequired?: unknown;
  rejectedLevers?: unknown;
  /** The other cards in the same answer, attached by the agent on Apply. */
  advisorOptions?: unknown;
  engineValidation?: unknown;
}

/**
 * The engine notes a brief may quote: the advisor's own guardrails (a lever
 * withheld, a proposal clamped), which are written for a broker. The engine's
 * other notes are working figures (`Honest DTI 10.60× … Numerator $…`) and
 * stay on the card.
 */
export const QUOTABLE_CAUTION_PREFIXES = [
  'DTI cap of ',
  'Income growth clamped',
  'Expense reduction clamped',
  'Equity release LVR clamped',
  'Cross-collat blended LVR clamped',
  'Capital allocations $',
] as const;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function readOptions(v: unknown): RationaleAdvisorOptionInput[] {
  return (Array.isArray(v) ? v : [])
    .map((o): RationaleAdvisorOptionInput | null => {
      const rec = (o && typeof o === 'object' ? o : null) as Record<string, unknown> | null;
      const name = rec ? str(rec.name) : '';
      if (!rec || !name) return null;
      const risk = rec.executionRisk === 'low' || rec.executionRisk === 'medium' || rec.executionRisk === 'high'
        ? rec.executionRisk
        : null;
      return {
        name,
        applied: rec.applied === true,
        capacity: num(rec.capacity),
        purchasePower: num(rec.purchasePower),
        targetPrice: num(rec.targetPrice),
        meetsTarget: typeof rec.meetsTarget === 'boolean' ? rec.meetsTarget : null,
        shortfall: num(rec.shortfall),
        executionRisk: risk,
      };
    })
    .filter((o): o is RationaleAdvisorOptionInput => o !== null);
}

function readCautions(engineValidation: unknown): string[] {
  const issues = (engineValidation && typeof engineValidation === 'object'
    ? (engineValidation as Record<string, unknown>).validationIssues
    : null);
  const seen = new Set<string>();
  return (Array.isArray(issues) ? issues : [])
    .map((i) => (i && typeof i === 'object' ? str((i as Record<string, unknown>).message) : ''))
    .filter((m) => m && QUOTABLE_CAUTION_PREFIXES.some((p) => m.startsWith(p)))
    .filter((m) => (seen.has(m) ? false : (seen.add(m), true)));
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The card's reasoning for the rationale, or null where it wrote none. */
export function advisorRationaleFromCard(card: AdvisorCardLike | null | undefined): RationaleAdvisorInput | null {
  if (!card) return null;
  const reasoning = str(card.reasoning);
  if (!reasoning) return null;
  const risk = card.executionRisk === 'low' || card.executionRisk === 'medium' || card.executionRisk === 'high'
    ? card.executionRisk
    : null;
  const evidenceRequired = (Array.isArray(card.evidenceRequired) ? card.evidenceRequired : [])
    .map(str)
    .filter(Boolean);
  const rejectedLevers = (Array.isArray(card.rejectedLevers) ? card.rejectedLevers : [])
    .map((r) => {
      const rec = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
      return { lever: str(rec.lever), reason: str(rec.reason) };
    })
    .filter((r) => r.lever || r.reason);
  return {
    scenarioName: str(card.name) || 'Suggested scenario',
    reasoning,
    executionRisk: risk,
    evidenceRequired,
    rejectedLevers,
    options: readOptions(card.advisorOptions),
    cautions: readCautions(card.engineValidation),
    adjustedSince: false,
  };
}
