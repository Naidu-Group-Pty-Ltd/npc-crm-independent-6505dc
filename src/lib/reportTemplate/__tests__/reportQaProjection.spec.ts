/**
 * What a Report Q&A template may bind.
 *
 * The assertions that matter most here are the two this format is unusual for:
 * the answer is published as **Markdown source** rather than formatted text,
 * and the page count the projection publishes must equal the page count the
 * block will actually draw. A drift of one between them prints a blank page or
 * loses the end of an answer.
 */
import { describe, it, expect } from 'vitest';
import {
  projectReportQa, applyReportQaProjection, answerPageCount, CAPS,
} from '../../../../supabase/functions/_shared/reportQaProjection.pure';
import { packMarkdownPages } from '../../../../supabase/functions/_shared/reports/markdownPaging.pure';
import { renderMarkdown } from '../../../../supabase/functions/_shared/reports/markdown.pure';
import { formatReportDate } from '../../../../supabase/functions/_shared/reports/reportQa/render.pure';

const ANSWER = [
  '## Yield analysis',
  '',
  'The **gross yield** is 3.71%, and the *net* yield is 2.44%.',
  '',
  '| Metric | Value |',
  '| --- | --- |',
  '| Gross yield | 3.71% |',
].join('\n');

function turn(i: number, over: Record<string, unknown> = {}) {
  return {
    index: i,
    question: `Question ${i}`,
    askedAt: '2026-08-01T00:00:00.000Z',
    answer: ANSWER,
    answerWasEdited: false,
    modelProvider: 'openai',
    modelVersion: 'gpt-5',
    citations: [],
    ...over,
  } as any;
}

function doc(over: Record<string, unknown> = {}) {
  const meta = {
    conversationId: 'c1',
    messageId: null,
    subject: 'transcript',
    title: 'Yield questions',
    preparedOn: '2026-08-13T00:00:00.000Z',
    turnCount: 2,
    turnsShown: 2,
    truncated: false,
    charsOmitted: 0,
    ...(over.meta as object ?? {}),
  };
  return {
    grounding: { reportNames: ['12 Marlborough St.pdf'], reportCount: 1 },
    narrative: 'The Report Q&A conversation as it happened — all 2 exchanges, '
      + 'grounded in one report, 12 Marlborough St.',
    turns: [turn(1), turn(2)],
    citations: [],
    models: ['openai'],
    ...over,
    meta,
  } as any;
}


describe('the answer stays Markdown', () => {
  it('publishes source, not formatted text or HTML', () => {
    const { qa } = projectReportQa(doc());
    expect(qa.answer).toContain('**gross yield**');
    expect(qa.answer).toContain('| Metric | Value |');
    // Pre-rendering here would move the escaping decision to the caller.
    expect(String(qa.answer)).not.toContain('<strong>');
    expect(String(qa.answer)).not.toContain('<table');
  });
});

describe('page counts agree with the block', () => {
  it('answerPageCount equals what packMarkdownPages will produce', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Para ${i}. ${'word '.repeat(30)}`).join('\n\n');
    for (const lpp of [12, 34, 80]) {
      const expected = packMarkdownPages(renderMarkdown(long).blocks, lpp).length;
      expect(answerPageCount(long, lpp)).toBe(expected);
    }
  });

  it('is absent rather than zero for an empty answer', () => {
    const { qa } = projectReportQa(doc({ turns: [turn(1, { answer: '' })] }));
    expect(qa.answerPages).toBeUndefined();
    expect(qa.answer).toBeUndefined();
  });
});

describe('absent means absent', () => {
  it('never publishes an empty string', () => {
    const { qa } = projectReportQa(doc({
      grounding: { reportNames: [], reportCount: 0 },
      turns: [turn(1, { modelProvider: '', modelVersion: '' })],
    }));
    const walk = (v: unknown): void => {
      if (v === '' || v === null) throw new Error('published an empty value');
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    expect(() => walk(qa)).not.toThrow();
    expect(qa.sources).toBeUndefined();
    expect((qa.turns as any[])[0].model).toBeUndefined();
  });

  it('says nothing about editing when nothing was edited', () => {
    const clean = projectReportQa(doc()).qa;
    expect((clean.turns as any[])[0].editedNote).toBeUndefined();

    const edited = projectReportQa(doc({ turns: [turn(1, { answerWasEdited: true })] })).qa;
    expect((edited.turns as any[])[0].editedNote).toContain('edited');
  });
});

describe('omissions are whole sentences or nothing', () => {
  it('publishes no note when the document is one exchange, set whole', () => {
    const { qa } = projectReportQa(doc({ turns: [turn(1)], meta: { turnCount: 1, turnsShown: 1 } }));
    expect(qa.omissionNote).toBeUndefined();
    expect(qa.truncationNote).toBeUndefined();
  });

  it('says what the masters set: the first exchange in full, the further questions listed (RS-5c.6)', () => {
    // Measured on the Chancery render (14 Sep 2026): "carries 1 of 4
    // exchanges; 3 are not shown" over a document that set one answer and
    // was about to list the other three questions. The sentence now names
    // both halves.
    const { qa } = projectReportQa(doc());
    expect(qa.omissionNote).toBe(
      'The first exchange is set in full; 1 further question is listed without its answer. '
      + 'The complete transcript is in the Markdown export.',
    );
  });

  it('names how many exchanges are neither set nor listed', () => {
    const { qa } = projectReportQa(doc({ meta: { turnCount: 9, turnsShown: 2 } }));
    expect(qa.omissionNote).toBe(
      'The first exchange is set in full; 1 further question is listed without its answer, and 7 more are not shown. '
      + 'The complete transcript is in the Markdown export.',
    );
  });

  it('uses singular for one', () => {
    const { qa } = projectReportQa(doc({ meta: { turnCount: 3, turnsShown: 2 } }));
    expect(qa.omissionNote).toContain('1 more is not shown');
  });

  it('keeps the plain count for a document that is not a transcript', () => {
    const { qa } = projectReportQa(doc({ turns: [turn(1)], meta: { subject: 'answer', turnCount: 9, turnsShown: 1 } }));
    expect(qa.omissionNote).toBe('This document carries 1 of 9 exchanges; 8 are not shown.');
  });

  it('reports characters cut by the transcript budget', () => {
    const { qa } = projectReportQa(doc({
      meta: { turnCount: 2, turnsShown: 2, truncated: true, charsOmitted: 12345 },
    }));
    expect(qa.truncationNote).toContain('12,345 characters');
  });
});

describe('collections are capped, because the page model cannot paginate', () => {
  it('caps turns and says how many there were', () => {
    const many = Array.from({ length: 30 }, (_, i) => turn(i + 1));
    const { qa } = projectReportQa(doc({ turns: many, meta: { turnCount: 30, turnsShown: 30 } }));
    expect((qa.turns as any[]).length).toBe(CAPS.turns);
    expect(qa.omissionNote).toContain(`${CAPS.turns - 1} further questions are listed`);
    expect(qa.omissionNote).toContain(`${30 - CAPS.turns} more are not shown`);
  });

  it('caps citations and names the remainder', () => {
    const citations = Array.from({ length: 10 }, (_, i) => ({
      documentName: `Doc ${i}.pdf`, page: i, paragraph: null, snippet: 's', similarity: null,
    }));
    const { qa } = projectReportQa(doc({ turns: [turn(1, { citations })] }));
    const t = (qa.turns as any[])[0];
    expect(t.citations.length).toBe(CAPS.citationsPerTurn);
    expect(t.citationCount).toBe(10);
    expect(t.citationsOmitted).toContain('4 more sources');
  });

  it('formats a citation locus from page and paragraph, as the legacy table does', () => {
    const { qa } = projectReportQa(doc({
      turns: [turn(1, {
        citations: [{ documentName: 'a.pdf', page: 4, paragraph: 12, snippet: 's', similarity: null }],
      })],
    }));
    expect((qa.turns as any[])[0].citations[0].locus).toBe('p.4 · ¶12');
  });
});

describe('what the legacy document says, restated', () => {
  it('passes the built lede through', () => {
    // `narrativeFor`'s two or three sentences — the lede the legacy opens its
    // first chapter with, and the one piece of prose here no model wrote.
    const { qa } = projectReportQa(doc());
    expect(qa.narrative).toContain('as it happened');
    expect(projectReportQa(doc({ narrative: '' })).qa.narrative).toBeUndefined();
  });

  it('labels the subject in the words a reader would use, never the enum', () => {
    for (const [subject, label] of [
      ['transcript', 'Conversation transcript'],
      ['answer', 'Single answer'],
      ['structured', 'Structured report'],
    ] as const) {
      expect(projectReportQa(doc({ meta: { subject } })).qa.subjectLabel).toBe(label);
    }
  });

  it('composes the cover exchanges value the way the legacy cover does', () => {
    expect(projectReportQa(doc()).qa.exchangesLabel).toBe('2');
    const cut = projectReportQa(doc({ meta: { turnCount: 20, turnsShown: 13 } }));
    expect(cut.qa.exchangesLabel).toBe('13 of 20');
  });

  it('bounds the cover title on a word and keeps the full title beside it', () => {
    const short = projectReportQa(doc()).qa;
    expect(short.coverTitle).toBe(short.title);

    const long = 'What does the settlement adjustment schedule mean for the Marlborough Street '
      + 'purchase and who pays the water rates at completion';
    const { qa } = projectReportQa(doc({ meta: { title: long } }));
    expect(qa.title).toBe(long);
    expect(String(qa.coverTitle).length).toBeLessThanOrEqual(57);
    expect(String(qa.coverTitle).endsWith('…')).toBe(true);
    // On a word — no mid-word cut with an ellipsis stuck to half a word.
    expect(String(qa.coverTitle)).toBe('What does the settlement adjustment schedule mean for…');
  });
});

describe('provenance — the line every exporter dropped', () => {
  it('composes provider, sources and date exactly as the legacy renders them', () => {
    const { qa } = projectReportQa(doc({
      turns: [turn(1, {
        citations: [
          { documentName: 'a.pdf', page: 1, paragraph: null, snippet: '', similarity: null },
          { documentName: 'b.pdf', page: 2, paragraph: null, snippet: '', similarity: null },
        ],
      })],
    }));
    // The date half comes from the renderer's own exported `formatReportDate`,
    // so a drift between the restated formatter and the real one fails here
    // rather than on a page.
    expect(qa.provenanceLine).toBe(`openai · gpt-5 — 2 sources — ${formatReportDate('2026-08-01T00:00:00.000Z')}`);
    expect((qa.turns as any[])[0].provenanceLine).toBe(qa.provenanceLine);
  });

  it('says when a human edited the answer', () => {
    const { qa } = projectReportQa(doc({ turns: [turn(1, { answerWasEdited: true })] }));
    expect(qa.provenanceLine).toContain('edited before export');
  });

  it('never names the system placeholder as a model', () => {
    const { qa } = projectReportQa(doc({
      turns: [turn(1, { modelProvider: 'system', modelVersion: '' })],
    }));
    expect(String(qa.provenanceLine)).not.toContain('system');
  });

  it('is absent under an unanswered question, as the legacy leaves it', () => {
    // `turnBody` returns its "No answer" callout before provenance is ever
    // composed; a provenance line holding nothing but a date under an
    // unanswered question would read as "how it was answered".
    const { qa } = projectReportQa(doc({ turns: [turn(1, { answer: '' })] }));
    expect(qa.provenanceLine).toBeUndefined();
    expect(qa.answerMissingNote).toBe('This question has no answer recorded against it.');
  });

  it('says nothing about a missing answer when there is one', () => {
    expect(projectReportQa(doc()).qa.answerMissingNote).toBeUndefined();
  });
});

describe('the answer overrun is said on the page', () => {
  const long = Array.from({ length: 400 }, (_, i) => `Paragraph ${i}. ${'word '.repeat(30)}`).join('\n\n');

  it('publishes what the document actually sets beside the full count', () => {
    const { qa } = projectReportQa(doc({ turns: [turn(1, { answer: long })] }));
    expect(qa.answerPages as number).toBeGreaterThan(CAPS.answerPages);
    expect(qa.answerPagesShown).toBe(CAPS.answerPages);
    expect(qa.answerCutNote).toBe(
      `The answer runs to ${qa.answerPages} pages and this document sets the first `
      + `${CAPS.answerPages}. The complete text is in the Markdown export.`,
    );
  });

  it('publishes no cut note when the answer fits', () => {
    const { qa } = projectReportQa(doc());
    expect(qa.answerPagesShown).toBe(qa.answerPages);
    expect(qa.answerCutNote).toBeUndefined();
  });
});

describe('the document-level citations table', () => {
  const cites = (n: number) => Array.from({ length: n }, (_, i) => ({
    documentName: `Doc ${i + 1}.pdf`,
    page: i === 0 ? 4 : null,
    paragraph: i === 0 ? 12 : null,
    snippet: i === 0 ? 'The retrieved passage.' : '',
    similarity: i === 0 ? 0.91 : null,
  }));

  it('restates the legacy sources table, em-dashes included', () => {
    // A table cell resolves an absent binding to the empty string, and a blank
    // cell reads as a missing figure — so `locus` and `match` carry the legacy
    // table's own em dash rather than being dropped.
    const { qa } = projectReportQa(doc({ citations: cites(2) }));
    const rows = qa.citations as any[];
    expect(rows[0]).toEqual({
      n: 1, documentName: 'Doc 1.pdf', locus: 'p.4 · ¶12', match: '91%',
      snippet: 'The retrieved passage.',
    });
    expect(rows[1].locus).toBe('—');
    expect(rows[1].match).toBe('—');
    expect(rows[1].snippet).toBeUndefined();
    expect(qa.citationCount).toBe(2);
    expect(qa.citationsNote).toBeUndefined();
  });

  it('caps the table and says so in a whole sentence', () => {
    const { qa } = projectReportQa(doc({ citations: cites(9) }));
    expect((qa.citations as any[]).length).toBe(CAPS.citations);
    expect(qa.citationsNote).toBe('The answers cite 9 passages; the first 6 are shown here.');
  });

  it('publishes nothing when the record holds none, which today is every record', () => {
    expect(projectReportQa(doc()).qa.citations).toBeUndefined();
  });
});

describe('the grounding list is capped and says so', () => {
  it('names the first eight and the remainder in a whole sentence', () => {
    const names = Array.from({ length: 17 }, (_, i) => `Report ${i + 1}.pdf`);
    const { qa } = projectReportQa(doc({ grounding: { reportNames: names, reportCount: 17 } }));
    expect((qa.sources as any[]).length).toBe(CAPS.sources);
    expect(qa.sourcesOmittedNote).toBe('The conversation names 17 reports; the first 8 are listed here.');
  });

  it('publishes no note when the list fits', () => {
    expect(projectReportQa(doc()).qa.sourcesOmittedNote).toBeUndefined();
  });
});

describe('applyReportQaProjection', () => {
  it('writes nothing when there is nothing to write', () => {
    const target: Record<string, unknown> = {};
    applyReportQaProjection(target, doc({
      meta: { title: '', preparedOn: '', turnCount: 0, turnsShown: 0 },
      grounding: { reportNames: [], reportCount: 0 },
      turns: [],
    }));
    expect(target.qa).toBeUndefined();
  });
});
