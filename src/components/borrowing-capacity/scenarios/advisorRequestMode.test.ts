/**
 * Does a message to the Strategy Advisor get scenario cards or a prose answer?
 *
 * The advisor's cards — each with an Apply button that moves the strategy
 * levers — stopped appearing because a rule written in April read almost every
 * brief as a "clarification" and withheld the scenario tool. These specs hold
 * the replacement to the cases that went wrong: the advisor's own suggested
 * prompts, a dictated purchase brief with no cards on screen, and the
 * follow-ups that genuinely are about the cards already showing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  advisorRequestMode,
  answeredWithoutScenarios,
  budgetAmountsIn,
  isClarificationMessage,
} from '../../../../supabase/functions/_shared/advisorRequestMode.pure';
import { scenarioSummaryProse, unreadableScenariosMessage } from './bcScenarioAgentStream.pure';

const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf8');
const AGENT = read('./BCScenarioAgent.tsx');
const FUNCTION = read('../../../../supabase/functions/bc-scenario-agent/index.ts');
const PREVIEW = read('../../../../supabase/functions/bc-scenario-agent/aiScenarioPreview.ts');

/** The prompts the advisor offers on its own empty state, read from the component. */
function suggestedPrompts(): string[] {
  const block = AGENT.match(/const suggestedPrompts = \[([\s\S]*?)\];/);
  expect(block, 'the suggested prompts moved').not.toBeNull();
  return [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const CARDS = {
  priorScenarioNames: [
    '90% LVR Purchase + Debt Cleanse',
    'Valuation Uplift to 80% Deposit',
    'Portfolio Restructure & Clean Slate',
  ],
};

/** A dictated brief of the length and shape the 2 Oct production request had. */
const DICTATED_BRIEF =
  "Okay so the client is looking at a new build, house and land around $750,000 out in the growth corridor. " +
  "They want to live in it for now. Is it possible with what they've got, and what is the best way to get " +
  "them there with the debts they're carrying at the moment?";

describe('with no cards on screen every message is a brief', () => {
  it('draws cards for each of the advisor\'s own suggested prompts', () => {
    const prompts = suggestedPrompts();
    expect(prompts.length).toBeGreaterThanOrEqual(3);
    for (const prompt of prompts) {
      expect(advisorRequestMode(prompt), prompt).toBe('scenarios');
      expect(advisorRequestMode(prompt, { priorScenarioNames: [] }), prompt).toBe('scenarios');
    }
  });

  it('draws cards for a dictated purchase brief that is phrased as a question', () => {
    expect(DICTATED_BRIEF.length).toBeGreaterThan(200);
    expect(advisorRequestMode(DICTATED_BRIEF)).toBe('scenarios');
  });

  it('draws cards even for a message that reads like a follow-up, because nothing is on screen', () => {
    expect(advisorRequestMode('Why?')).toBe('scenarios');
    expect(advisorRequestMode('Can you explain that?')).toBe('scenarios');
    expect(isClarificationMessage('Does this make sense?')).toBe(false);
  });

  it('treats an empty message as a brief', () => {
    expect(advisorRequestMode('', CARDS)).toBe('scenarios');
    expect(advisorRequestMode(null, CARDS)).toBe('scenarios');
  });
});

describe('with cards on screen', () => {
  it('still draws fresh cards for a request to produce or rework options', () => {
    for (const message of [
      'Make scenario 2 more conservative',
      'Give me three more aggressive options',
      'Show me alternatives that keep the Cahill St property',
      'Can you propose something without selling?',
      'Rework the second one at a 6.5% assessment rate',
      'Any other strategies?',
    ]) {
      expect(advisorRequestMode(message, CARDS), message).toBe('scenarios');
    }
  });

  it('still draws fresh cards for a new brief, budget or strategy question', () => {
    for (const message of [
      ...suggestedPrompts(),
      'What if the budget is $820k instead?',
      'How can we get them to $900,000?',
      DICTATED_BRIEF,
    ]) {
      expect(advisorRequestMode(message, CARDS), message).toBe('scenarios');
    }
  });

  it('answers in prose a short question about a card', () => {
    for (const message of [
      'Why did scenario 2 drop capacity?',
      'Does scenario 2 make sense?',
      'Explain the third option',
      'Is the Valuation Uplift to 80% Deposit realistic?',
      'What does the first one assume about rent?',
      'Will this affect their DTI?',
      'Before I apply, is that LVR right?',
    ]) {
      expect(advisorRequestMode(message, CARDS), message).toBe('answer');
      expect(isClarificationMessage(message, CARDS), message).toBe(true);
    }
  });

  it('reads a long message carrying a brief as a new brief even where it mentions the cards', () => {
    const longBrief =
      "None of these scenarios quite works for them. They've now said the budget is closer to $820k and " +
      "they'd rather keep both investment properties, so what is the best way to get there without selling " +
      "anything and without stretching serviceability too far?";
    expect(longBrief.length).toBeGreaterThan(200);
    expect(advisorRequestMode(longBrief, CARDS)).toBe('scenarios');
  });

  it('does not read "a new build" as a request to build options', () => {
    expect(advisorRequestMode('Is scenario 1 still fine for a new build?', CARDS)).toBe('answer');
  });
});

describe('the purchase budget the advisor reads from a brief', () => {
  it('reads $750k, 750k and $750,000 as one amount', () => {
    expect(budgetAmountsIn('around $750k')).toContain(750_000);
    expect(budgetAmountsIn('around 750k')).toContain(750_000);
    expect(budgetAmountsIn('around $750,000')).toContain(750_000);
    expect(budgetAmountsIn('up to $1.2m')).toContain(1_200_000);
  });

  it('ignores a repayment or a rent, which is not a purchase price', () => {
    expect(budgetAmountsIn('repayments of $2,400 a month and rent of $650')).toEqual([]);
    expect(budgetAmountsIn(null)).toEqual([]);
  });

  it('is the one reading the target-price detector uses', () => {
    expect(PREVIEW).toContain("import { budgetAmountsIn } from '../_shared/advisorRequestMode.pure.ts';");
    expect(PREVIEW).not.toMatch(/const BUDGET_PATTERNS/);
    expect(PREVIEW).not.toMatch(/export function isClarificationMessage/);
  });
});

describe('the edge function', () => {
  it('decides the mode from the cards on screen, through the shared rule', () => {
    expect(FUNCTION).toContain('from "../_shared/advisorRequestMode.pure.ts"');
    expect(FUNCTION).toContain('isClarificationMessage(lastUserMessage, { priorScenarioNames })');
  });

  it('requires the scenario tool, with valid arguments, whenever cards are owed', () => {
    expect(FUNCTION).toContain("toolChoice: { type: 'function', function: { name: SCENARIO_TOOL.function.name } }");
    expect(FUNCTION).toContain('requiredToolName: SCENARIO_TOOL.function.name');
    expect(FUNCTION).toContain('requireValidToolArguments: true');
  });

  it('no longer tells the model to ask a clarifying question in place of cards', () => {
    expect(FUNCTION).not.toMatch(/ask clarifying questions if the request is vague/);
    expect(FUNCTION).toMatch(/ALWAYS answer by calling generate_scenarios/);
  });

  it('says when every model answered without cards, rather than "AI service error"', () => {
    expect(answeredWithoutScenarios([{ status: 422 }, { status: 503 }])).toBe(true);
    expect(answeredWithoutScenarios([{ status: 503 }, null])).toBe(false);
    expect(answeredWithoutScenarios(undefined)).toBe(false);
    expect(FUNCTION).toContain('answeredWithoutScenarios(response.attempts)');
  });
});

describe('the browser', () => {
  it('no longer second-guesses the server with a rule of its own', () => {
    expect(AGENT).not.toContain('looksLikeClarification');
  });

  it('names each card with the engine\'s figures when the model wrote no prose', () => {
    const prose = scenarioSummaryProse([
      { name: 'Debt Cleanse', engineValidation: { borrowingCapacity: 761_738, capacityChange: 92_000, targetPurchasePrice: 750_000, meetsTarget: true } },
      { name: 'Valuation Uplift', engineValidation: { borrowingCapacity: 669_738, capacityChange: 0, targetPurchasePrice: 750_000, meetsTarget: false, shortfallToTarget: 56_107 } },
    ] as never);
    expect(prose).toMatch(/2 scenarios/);
    expect(prose).toMatch(/\*\*Debt Cleanse\*\*/);
    expect(prose).toMatch(/\$761,738/);
    expect(prose).toMatch(/clears the \$750,000 target/);
    expect(prose).toMatch(/short of the \$750,000 target by \$56,107/);
    expect(prose).toMatch(/Apply Scenario/);
    expect(AGENT).toContain('updateAssistant(scenarioSummaryProse(locallyValidated))');
  });

  it('says so when the scenarios that came back cannot be read', () => {
    expect(unreadableScenariosMessage()).toMatch(/could not be read/);
    expect(AGENT).toContain('throw new Error(unreadableScenariosMessage())');
  });
});
