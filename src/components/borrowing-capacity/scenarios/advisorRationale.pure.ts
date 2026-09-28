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
import type { RationaleAdvisorInput } from '@/lib/reports/borrowingCapacity/strategyRationale.pure';

export interface AdvisorCardLike {
  name?: unknown;
  reasoning?: unknown;
  executionRisk?: unknown;
  evidenceRequired?: unknown;
  rejectedLevers?: unknown;
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
    adjustedSince: false,
  };
}
