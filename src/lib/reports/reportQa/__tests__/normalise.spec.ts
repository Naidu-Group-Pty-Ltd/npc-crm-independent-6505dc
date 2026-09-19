/**
 * Reading two tables into a document — and refusing when there is nothing to say.
 *
 * Fixtures are fictional and sized from the record: the p50 conversation is one
 * exchange of 870 characters, the p90 is five, and the largest is 35 exchanges
 * of 354,406 characters.
 */
import { describe, expect, it } from 'vitest';
import {
  buildReportQaDocument,
  estimateTurnLines,
  narrativeFor,
  toCitations,
  toTurns,
} from '../normalise.pure';
import { MAX_TRANSCRIPT_LINES, MAX_TURNS } from '../payload.pure';

const NOW = '2026-08-02T00:00:00.000Z';
const CID = '11111111-1111-4111-8111-111111111111';
const mid = (n: number) => `2222${String(n).padStart(4, '0')}-2222-4222-8222-222222222222`;
// Minutes past a fixed instant, carried into hours and days, so a 400-message
// fixture still sorts. A naive `00:${n}` stops sorting at sixty and quietly
// scrambles the pairing — which is what the first version of this file did.
const at = (n: number) => {
  const d = new Date(Date.UTC(2026, 6, 1, 0, n));
  return d.toISOString();
};

const conv = (over: Record<string, unknown> = {}) => ({
  id: CID,
  title: 'Mariners Quay, Newstead — investment review',
  report_names: ['Mariners Quay Investment Report.pdf', 'Newstead Comparables.pdf'],
  structured_report: null,
  ...over,
});

const pair = (i: number, answer = `Answer ${i}`, over: Record<string, unknown> = {}) => [
  { id: mid(i * 2), role: 'user', content: `Question ${i}?`, created_at: at(i * 2) },
  {
    id: mid(i * 2 + 1), role: 'assistant', content: answer, created_at: at(i * 2 + 1),
    model_provider: 'openai', model_version: 'gpt-5.2', ...over,
  },
];

const build = (over: Partial<Parameters<typeof buildReportQaDocument>[0]> = {}) =>
  buildReportQaDocument({
    conversation: conv(),
    messages: pair(0),
    subject: 'transcript',
    preparedOn: NOW,
    ...over,
  });

describe('pairing messages into turns', () => {
  it('pairs a question with the answer that followed it', () => {
    const turns = toTurns([...pair(0), ...pair(1)]);
    expect(turns).toHaveLength(2);
    expect(turns[0].question).toBe('Question 0?');
    expect(turns[0].answer).toBe('Answer 0');
    expect(turns[1].index).toBe(2);
  });

  it('orders by created_at, not by array order', () => {
    const turns = toTurns([...pair(1), ...pair(0)]);
    expect(turns.map((t) => t.question)).toEqual(['Question 0?', 'Question 1?']);
  });

  /**
   * `generate-qa-pdf` inserts an assistant message with no question before it,
   * and the four rows in the record carrying attachments are exactly those.
   * Dropping a real answer to keep the shape tidy would be the document lying
   * about what was said.
   */
  it('keeps an answer that had no question', () => {
    const turns = toTurns([
      { id: mid(1), role: 'assistant', content: 'Unprompted', created_at: at(1) },
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].question).toBe('');
    expect(turns[0].answer).toBe('Unprompted');
  });

  it('keeps a question that was never answered', () => {
    const turns = toTurns([
      { id: mid(0), role: 'user', content: 'Cut off?', created_at: at(0) },
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].answer).toBe('');
  });

  it('prefers an edited answer over the model original', () => {
    const turns = toTurns(pair(0, 'model wrote this', { edited_content: 'a person rewrote it' }));
    expect(turns[0].answer).toBe('a person rewrote it');
    expect(turns[0].answerWasEdited).toBe(true);
  });

  it('ignores a role that is neither user nor assistant', () => {
    const turns = toTurns([
      ...pair(0),
      { id: mid(9), role: 'tool', content: 'internal', created_at: at(9) },
    ]);
    expect(turns).toHaveLength(1);
  });

  it('caps a runaway read', () => {
    const many = Array.from({ length: MAX_TURNS + 50 }, (_, i) => pair(i)).flat();
    expect(toTurns(many).length).toBeLessThanOrEqual(MAX_TURNS);
  });
});

describe('citations', () => {
  it('reads the shape the edge function persists', () => {
    const [c] = toCitations([{
      document_name: 'Mariners Quay Investment Report.pdf',
      page_number: 4, paragraph_index: 12,
      snippet: 'Sub-market vacancy rose to 3.1%.', similarity: 0.87,
    }]);
    expect(c.documentName).toBe('Mariners Quay Investment Report.pdf');
    expect(c.page).toBe(4);
    expect(c.paragraph).toBe(12);
    expect(c.similarity).toBeCloseTo(0.87);
  });

  /** A missing page printed as zero would claim a page the retrieval never had. */
  it('reads an absent field as null, never as zero', () => {
    const [c] = toCitations([{ document_name: 'A.pdf' }]);
    expect(c.page).toBeNull();
    expect(c.paragraph).toBeNull();
    expect(c.similarity).toBeNull();
  });

  it.each([[null], [undefined], ['not an array'], [42], [[{ page_number: 1 }]]])(
    'returns nothing for %s',
    (raw) => expect(toCitations(raw)).toHaveLength(0),
  );

  it('neutralises a url in a document name', () => {
    const [c] = toCitations([{ document_name: 'https://evil.test/a.pdf' }]);
    expect(c.documentName).not.toContain('//');
  });

  it('deduplicates across turns on name, page and paragraph', () => {
    const cite = [{ document_name: 'A.pdf', page_number: 4, paragraph_index: 1 }];
    const r = build({
      messages: [...pair(0, 'x', { citations: cite }), ...pair(1, 'y', { citations: cite })],
    });
    expect(r.ok && r.document.citations).toHaveLength(1);
  });
});

describe('refusals', () => {
  it.each([
    ['a conversation with no id', { conversation: {} as Record<string, unknown> }, 'conversation id missing'],
    ['a transcript with no messages', { messages: [] }, 'this conversation has no messages'],
  ])('refuses %s', (_label, over, message) => {
    const r = build(over as never);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain(message);
  });

  it('refuses a structured report that was never written', () => {
    const r = build({ subject: 'structured' });
    expect(r.ok === false && r.error).toContain('no structured report stored');
  });

  it('refuses an answer id that is not in this conversation', () => {
    const r = build({ subject: 'answer', messageId: mid(99) });
    expect(r.ok === false && r.error).toContain('no assistant message with that id');
  });

  it('refuses a message id that is not a uuid', () => {
    const r = build({ subject: 'answer', messageId: 'nope' });
    expect(r.ok === false && r.error).toContain('must be a uuid');
  });

  it('refuses to typeset an empty answer', () => {
    const r = build({ subject: 'answer', messageId: mid(1), messages: pair(0, '   ') });
    expect(r.ok === false && r.error).toContain('empty');
  });
});

describe('the transcript budget', () => {
  const long = 'The sub-market absorbed 240 new dwellings in the trailing year. '.repeat(30);

  it('keeps a p90 conversation whole', () => {
    const r = build({ messages: Array.from({ length: 5 }, (_, i) => pair(i, long)).flat() });
    expect(r.ok && r.document.meta.truncated).toBe(false);
    expect(r.ok && r.document.meta.turnsShown).toBe(5);
  });

  it('cuts whole turns and reports what it dropped', () => {
    const r = build({ messages: Array.from({ length: 200 }, (_, i) => pair(i, long)).flat() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.document.meta.truncated).toBe(true);
    expect(r.document.meta.turnsShown).toBeLessThan(r.document.meta.turnCount);
    expect(r.document.meta.charsOmitted).toBeGreaterThan(0);
    // Whole turns only: no answer is ever half-printed.
    for (const t of r.document.turns) expect(t.answer).toBe(long);
  });

  it('keeps one exchange however long it is', () => {
    const huge = 'x'.repeat(200_000);
    const r = build({ messages: pair(0, huge) });
    expect(r.ok && r.document.turns).toHaveLength(1);
  });

  it('estimates a turn at furniture plus prose', () => {
    expect(estimateTurnLines('', '')).toBe(13);
    expect(estimateTurnLines('', 'x'.repeat(130))).toBe(15);
    expect(MAX_TRANSCRIPT_LINES).toBeGreaterThan(estimateTurnLines('', long));
  });
});

describe('the framing sentence', () => {
  it('names the exchange count it was given', () => {
    expect(narrativeFor('transcript', 13, 20, ['A'], ['openai']))
      .toContain('13 of 20 exchanges');
  });

  it('says so when nothing was attached', () => {
    expect(narrativeFor('transcript', 1, 1, [], [])).toContain('no attached reports');
  });

  it('names a single report by name', () => {
    expect(narrativeFor('answer', 1, 1, ['Mariners Quay'], [])).toContain('one report, Mariners Quay');
  });

  it('does not claim a model answered when none is recorded', () => {
    expect(narrativeFor('transcript', 1, 1, [], [])).not.toContain('Answers came from');
  });
});

describe('the document', () => {
  it('drops the .pdf suffix from grounding names but keeps the count', () => {
    const r = build();
    expect(r.ok && r.document.grounding.reportNames).toEqual([
      'Mariners Quay Investment Report', 'Newstead Comparables',
    ]);
    expect(r.ok && r.document.grounding.reportCount).toBe(2);
  });

  it('does not name the system placeholder as a model', () => {
    const r = build({ messages: pair(0, 'x', { model_provider: 'system' }) });
    expect(r.ok && r.document.models).toEqual([]);
  });

  it('carries the question alongside a single answer', () => {
    const r = build({ subject: 'answer', messageId: mid(1) });
    expect(r.ok && r.document.turns[0]?.question).toBe('Question 0?');
    expect(r.ok && r.document.meta.messageId).toBe(mid(1));
  });

  it('takes the structured report verbatim, markdown and all', () => {
    const report = '# Executive Summary\n\nThe **position** holds.';
    const r = build({ subject: 'structured', conversation: conv({ structured_report: report }) });
    expect(r.ok && r.document.body).toBe(report);
  });

  it('reduces a pasted essay of a question to a heading-sized line', () => {
    const r = build({
      messages: [
        { id: mid(0), role: 'user', content: 'q '.repeat(500), created_at: at(0) },
        { id: mid(1), role: 'assistant', content: 'a', created_at: at(1) },
      ],
    });
    expect(r.ok && r.document.turns[0].question.length).toBeLessThanOrEqual(240);
  });

  it('never lets a clock into the payload', () => {
    const r = build();
    expect(r.ok && r.document.meta.preparedOn).toBe(NOW);
  });
});
