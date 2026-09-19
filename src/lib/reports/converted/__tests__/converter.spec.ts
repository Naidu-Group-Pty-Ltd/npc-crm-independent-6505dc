/**
 * The template converter.
 *
 * Four things are worth pinning here, and each is something a render found or
 * would have hidden: how a lone title heading affects section depth, that a
 * binding is one-to-one, that a weak match is *offered but flagged* rather than
 * silently accepted, and that nothing a person uploaded disappears.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { writeRenderArtifact } from '../../__tests__/renderArtifact';
import { describeStructure, extractStructure, MAX_BIND_DEPTH } from '../structure.pure';
import {
  bindableFormats,
  FORMAT_CHAPTERS,
  formatName,
  proposeBinding,
  readBindingPlan,
  scoreMatch,
  WEAK_MATCH,
} from '../binding.pure';
import {
  APPENDIX_TITLE,
  CHAPTER_FURNITURE_LINES,
  planConvertedChapters,
  renderConvertedDocument,
  THIN_CHAPTER_LINES,
} from '../render.pure';
import { renderMarkdown } from '../../markdown.pure';
import { dropRedundantLede, enrichedLines, type EnrichedBlock } from '../enrich.pure';
import { buildReportCss } from '../../../../../supabase/functions/_shared/reportDesign/css.pure';
import {
  DEFAULT_REPORT_DESIGN_OPTIONS,
  normalizeReportDesignOptions,
} from '../../../../../supabase/functions/_shared/reportDesign/options.pure';
import { renderDataTable } from '../../../../../supabase/functions/_shared/reportDesign/primitives.pure';
import { coverTitleFit } from '../../../../../supabase/functions/_shared/reportDesign/typography.pure';
import { disclaimerParagraphs } from '../../../../../supabase/functions/_shared/reportDesign/companyBlock.pure';
import { repairFloatArtefacts } from '../../../../../supabase/functions/_shared/reports/text.pure';
import {
  auditBrandDesignSystem,
  describeAuditProblems,
  readBrandDesignSystem,
  slugify,
} from '../../../brandDesign/system.pure';
import { resolveReportPalette } from '../../../../../supabase/functions/_shared/reportDesign/brandResolve.pure';
import { resolveCompanyBlock } from '../../../../../supabase/functions/_shared/reportDesign/companyBlock.pure';

/** The real company block shape, from `companyBlock.pure.ts`. */
const COMPANY = resolveCompanyBlock({
  company_name: 'Harbour & Vale Advisory', abn: '55 666 777 888',
  email: 'hello@hv.example', phone: '02 9000 0000',
  address: 'Level 8, 1 Example Quay, Sydney NSW 2000',
} as never, null);

/**
 * Paragraphs of an uploaded template, no two of them alike.
 *
 * The version this replaced varied one decimal — `3.00%`, `3.10%`, `3.20%` —
 * inside an otherwise identical sentence, and every section that called it got
 * the same three. So four consecutive appendix sheets carried word-for-word
 * identical prose, and the critique rubric's only `high` rule fired three times
 * on the fixture rather than on the document.
 */
const SENTENCES = [
  'Capacity is assessed against a servicing buffer of 3.00% above the advertised rate, on the household income and commitments recorded at application.',
  'Income is taken at the lower of the two most recent payslips and the year-to-date figure annualised, and bonus income is shaded to 80%.',
  'Every revolving facility is assessed at its limit rather than its balance, whether or not the balance is nil.',
  'Living expenses are the greater of the declared figure and the benchmark for the household size and postcode.',
  'A rental guarantee is not counted as income unless it survives a change of manager.',
  'Existing repayments are assessed at the buffer rate where the loan is with another lender, and at the sheet rate where it is not.',
  'Where an applicant is self-employed, two full years of returns are required and the lower year is used.',
  'A liability released at settlement is excluded only where the release is a condition of the approval.',
  'Negative gearing is applied at the marginal rate of the applicant who owns the property, not the household.',
];

const prose = (n = 3, from = 0) =>
  Array.from({ length: n }, (_, i) => SENTENCES[(from + i) % SENTENCES.length]).join('\n\n');

const table = '| Lender | Rate |\n| --- | --- |\n| One | 6.10% |\n| Two | 6.25% |\n| Three | 6.40% |';

const UPLOAD = [
  '# Borrowing Power Assessment',
  `## Client Position Summary\n\n${prose(3, 0)}`,
  `## Household Income\n\n${table}`,
  `## Existing Commitments\n\n${table}`,
  `## Servicing & Buffers\n\n${prose(3, 3)}`,
  `## Maximum Capacity and Scenarios\n\n${table}`,
  `## Assumptions Used\n\n${prose(3, 6)}`,
  `## Fee Schedule\n\n${prose(2, 1)}`,
].join('\n\n');

/**
 * One of *our* reports, as a transcription actually brings it back.
 *
 * Taken from the shape of a real failing conversion. Two things about it are
 * hostile and both are the design system's own doing:
 *
 * 1. Our chapters print a small `SECTION 01` eyebrow above a large title. A
 *    model reading the page maps visual size to heading level, so the eyebrow
 *    returns as `##` and the title it labels as `#`. The hierarchy is inverted.
 * 2. The masthead and the client name are large type on the cover, so they come
 *    back as `#` headings that own nothing.
 *
 * A converter that cannot read its own house format back is not going to manage
 * a stranger's, so this fixture is the one that matters most.
 */
const SNAPSHOT = [
  '# Naidu Property Consulting Services',
  '## Borrowing Capacity Snapshot',
  '# Masline Nyawo',
  '## Section 01',
  `# Capacity at a glance\n\n${prose()}`,
  '## Section 02',
  `# Income and commitments\n\n${table}`,
  '## Section 03',
  `# How the capacity is built\n\n${table}`,
].join('\n\n');

describe('extracting structure', () => {
  it('treats a lone top-level heading as the title, not a section', () => {
    // One `#` over a run of `##` is the overwhelmingly common shape. Without
    // this the baseline is the title's own level, every real section becomes
    // depth 2, and the review screen reports "0 sections" for a document that
    // plainly has seven.
    const s = extractStructure(UPLOAD);
    expect(s.title).toBe('Borrowing Power Assessment');
    expect(s.sections.length).toBe(7);
    expect(s.sections.every((x) => x.depth === 1)).toBe(true);
    expect(describeStructure(s)).toContain('7 sections');
  });

  it('keeps sub-sections as sub-sections when the source really nests', () => {
    const s = extractStructure(`# T\n\n## A\n\n${prose()}\n\n### A.1\n\n${prose()}`);
    expect(s.sections.map((x) => x.depth)).toEqual([1, 2]);
  });

  it('does not treat the top level as a title when several headings share it', () => {
    const s = extractStructure(`## One\n\n${prose()}\n\n## Two\n\n${prose()}`);
    expect(s.sections.map((x) => x.title)).toEqual(['One', 'Two']);
    expect(s.sections.every((x) => x.depth === 1)).toBe(true);
  });

  it('flattens headings deeper than the bind depth without losing them', () => {
    const deep = `# T\n\n## A\n\n${prose()}\n\n### B\n\n${prose()}\n\n#### C\n\n${prose()}`;
    const s = extractStructure(deep);
    expect(s.notices.flattened).toBeGreaterThan(0);
    expect(s.sections.every((x) => x.depth <= MAX_BIND_DEPTH)).toBe(true);
    // Nothing is lost — the deep heading is still in some section's prose.
    expect(s.sections.some((x) => x.markdown.includes('#### C'))).toBe(true);
  });

  it('strips a leading number so the spine does not print two', () => {
    const s = extractStructure(`# T\n\n## 3. Market Overview\n\n${prose()}`);
    expect(s.sections[0].title).toBe('Market Overview');
  });

  it('marks a source with no headings as unstructured rather than empty', () => {
    const s = extractStructure(prose(6));
    expect(s.notices.unstructured).toBe(true);
    expect(s.sections.length).toBe(1);
    expect(describeStructure(s)).toContain('No headings');
  });

  it('recognises a mostly-tabular section', () => {
    const s = extractStructure(`# T\n\n## Rates\n\n${table}`);
    expect(s.sections[0].tabular).toBe(true);
  });

  it('never throws, whatever it is handed', () => {
    for (const bad of ['', '   ', '#', '#'.repeat(40), null, undefined]) {
      expect(() => extractStructure(bad as never)).not.toThrow();
    }
  });

  it('folds an eyebrow label into the title it labels', () => {
    // `## Section 01` over `# Capacity at a glance` is one chapter, not two, and
    // the eyebrow is the one that is not it. Before this, every `## Section NN`
    // became an empty stub that was dropped as too short — which was survivable
    // — and the levelling that followed put sibling chapters at different
    // depths, which was not.
    const s = extractStructure(SNAPSHOT, 'BC Snapshot');
    expect(s.notices.labelsFolded).toBe(3);
    expect(s.sections.map((x) => x.title)).toEqual([
      'Capacity at a glance', 'Income and commitments', 'How the capacity is built',
    ]);
    expect(s.sections.every((x) => x.depth === 1)).toBe(true);
  });

  it('does not fold a heading that owns a body, however label-shaped', () => {
    // "Section 8" is a real chapter here — a clause of an act, with content. The
    // fold applies only to headings that own nothing, because that is the tell
    // that the title beneath them is the section.
    const s = extractStructure(`# T\n\n## Section 8\n\n${prose()}\n\n## Notes\n\n${prose()}`);
    expect(s.notices.labelsFolded).toBe(0);
    expect(s.sections.map((x) => x.title)).toEqual(['Section 8', 'Notes']);
  });

  it('does not fold a real heading that merely happens to be empty', () => {
    // A chapter with no body under it is still a chapter if it does not read
    // like a label. It is dropped as too short, which is the old behaviour, not
    // silently merged into its neighbour.
    const s = extractStructure(`# T\n\n## Fee Schedule\n\n## Notes\n\n${prose()}`);
    expect(s.notices.labelsFolded).toBe(0);
    expect(s.sections.map((x) => x.title)).toEqual(['Notes']);
  });
});

describe('binding to a report format', () => {
  const structure = extractStructure(UPLOAD);
  const plan = proposeBinding('borrowing-capacity', structure);

  it('offers one binding per chapter of the format', () => {
    expect(plan.bindings.map((b) => b.chapter))
      .toEqual([...(FORMAT_CHAPTERS['borrowing-capacity'] ?? [])]);
  });

  it('binds our own report to every chapter it has, and to nothing else', () => {
    // The acceptance case. A Borrowing Capacity Snapshot put back through the
    // converter must land on the three chapters the renderer always prints,
    // leave the three conditional ones unfilled, and send nothing to an
    // appendix. The run that prompted this work managed 3 bound, 4 unfilled and
    // 3 in the appendix — against a chapter list that was invented.
    const s = extractStructure(SNAPSHOT, 'BC Snapshot');
    const p = proposeBinding('borrowing-capacity', s);
    const byChapter = new Map(p.bindings.map((b) => [b.chapter, b]));

    for (const chapter of ['Capacity at a glance', 'Income and commitments', 'How the capacity is built']) {
      const b = byChapter.get(chapter)!;
      expect(b.sectionIndex, chapter).not.toBeNull();
      expect(s.sections[b.sectionIndex!].title, chapter).toBe(chapter);
      expect(b.confidence, chapter).toBeGreaterThanOrEqual(WEAK_MATCH);
    }
    expect(p.unbound).toEqual([]);
    expect(p.unfilled).toEqual(['How this was calculated', 'Audit trail', 'Scenario comparison']);
  });

  it('matches a foreign template where the wording genuinely overlaps', () => {
    // `UPLOAD` is somebody else's document, and it binds partially — which is
    // the honest outcome for a scorer that only knows about shared words. What
    // it must not do is bind a chapter to a section with nothing in common.
    const byChapter = new Map(plan.bindings.map((b) => [b.chapter, b]));
    const income = byChapter.get('Income and commitments')!;
    expect(income.sectionIndex).not.toBeNull();
    expect(structure.sections[income.sectionIndex!].title).toBe('Household Income');
    expect(income.confidence).toBeGreaterThanOrEqual(WEAK_MATCH);
  });

  it('never binds one section to two chapters', () => {
    // The failure that looks correct on the review screen and prints the same
    // three paragraphs twice.
    const used = plan.bindings.map((b) => b.sectionIndex).filter((i): i is number => i !== null);
    expect(new Set(used).size).toBe(used.length);
  });

  it('refuses the second chapter when one section is the best match for two', () => {
    // The assertion above passed on a fixture where no section was ever the top
    // candidate twice, so removing the one-to-one check changed nothing. This
    // is the shape that actually exercises it: a section called "Capacity at a
    // glance" is the best remaining match for the chapter of that name *and*
    // for "How the capacity is built", which shares a word with it.
    const merged = extractStructure(
      `# T\n\n## Capacity at a glance\n\n${table}\n\n## Something Else Entirely\n\n${prose()}`,
    );
    const p = proposeBinding('borrowing-capacity', merged);
    const byChapter = new Map(p.bindings.map((b) => [b.chapter, b]));
    const glance = byChapter.get('Capacity at a glance')!.sectionIndex;
    const built = byChapter.get('How the capacity is built')!.sectionIndex;

    // Exactly one of them gets it; the other is left unfilled rather than
    // printing the same table under two headings.
    expect([glance, built].filter((i) => i !== null).length).toBe(1);
    const used = p.bindings.map((b) => b.sectionIndex).filter((i): i is number => i !== null);
    expect(new Set(used).size).toBe(used.length);
  });

  it('flags a weak match in words rather than accepting it quietly', () => {
    const weak = plan.bindings.filter((b) => b.sectionIndex !== null && b.confidence < WEAK_MATCH);
    for (const b of weak) expect(b.reason).toMatch(/weak|check it/i);
  });

  it('keeps whatever the format had no place for', () => {
    // "Fee Schedule" is not a borrowing-capacity chapter. It must still appear.
    expect(plan.unbound.length).toBeGreaterThan(0);
    const kept = plan.unbound.map((i) => structure.sections[i].title);
    expect(kept).toContain('Fee Schedule');
  });

  it('reports chapters the template could not fill', () => {
    const empty = extractStructure(`# T\n\n## Something Unrelated\n\n${prose()}`);
    const p = proposeBinding('borrowing-capacity', empty);
    expect(p.unfilled.length).toBeGreaterThan(0);
  });

  it('scores an exact title match above an unrelated one', () => {
    const chapter = 'Income and commitments';
    const a = structure.sections.find((s) => s.title === 'Household Income')!;
    const b = structure.sections.find((s) => s.title === 'Fee Schedule')!;
    expect(scoreMatch(chapter, 1, 6, a, 7)).toBeGreaterThan(scoreMatch(chapter, 1, 6, b, 7));
  });

  it('re-reads a plan from the client without trusting its indices', () => {
    const tampered = {
      bindings: [
        { chapter: 'Income and commitments', sectionIndex: 999, confirmed: true },
        { chapter: 'How the capacity is built', sectionIndex: 1, confirmed: true },
        // The same section again — the second must be refused.
        { chapter: 'Audit trail', sectionIndex: 1, confirmed: true },
      ],
    };
    const read = readBindingPlan(tampered, 'borrowing-capacity', structure);
    const byChapter = new Map(read.bindings.map((b) => [b.chapter, b]));
    expect(byChapter.get('Income and commitments')!.sectionIndex).toBeNull();
    expect(byChapter.get('How the capacity is built')!.sectionIndex).toBe(1);
    expect(byChapter.get('Audit trail')!.sectionIndex).toBeNull();
  });

  it('names the formats it can bind to, and what they are called', () => {
    expect(bindableFormats()).toContain('borrowing-capacity');
    // The cover prints "Snapshot"; the archetype's metadata says "Assessment".
    // `converterChapters.spec.ts` holds this against the renderer's own const.
    expect(formatName('borrowing-capacity')).toBe('Borrowing Capacity Snapshot');
  });
});

describe('the converted document', () => {
  const structure = extractStructure(UPLOAD);
  const plan = proposeBinding('borrowing-capacity', structure);
  const palette = resolveReportPalette({ preset: 'signature', brandHex: '#1F4E79' });

  const render = () => renderConvertedDocument({
    structure,
    plan,
    palette,
    company: COMPANY,
    masthead: 'Harbour & Vale',
    systemName: 'Harbour Editorial',
    preparedOn: '2026-08-04T00:00:00.000Z',
  });

  /** The document, on disk, for the eye. See `renderArtifact.ts`. */
  beforeAll(() => {
    writeRenderArtifact('converted', render().html);
  });

  it('prints the format\'s chapters in the format\'s order', () => {
    const chapters = planConvertedChapters(structure, plan);
    const formatChapters = FORMAT_CHAPTERS['borrowing-capacity'] ?? [];
    expect(chapters.slice(0, formatChapters.length).map((c) => c.title))
      .toEqual([...formatChapters]);
  });

  it('puts unmatched sections at the back rather than dropping them', () => {
    // Counted by *section*, not by chapter. This used to assert one appendix
    // chapter per unbound section, which was only true while `packThin`'s
    // threshold was low enough never to fire on this fixture — so the test that
    // exists to prove nothing is dropped would have failed the moment the
    // packer started doing its job, which is the opposite of what it is for.
    const chapters = planConvertedChapters(structure, plan);
    const appendix = chapters.filter((c) => c.kind === 'appendix');
    const carried = appendix.map((c) => `${c.title}\n${c.markdown}`).join('\n');
    for (const index of plan.unbound) {
      expect(carried, `"${structure.sections[index].title}" went missing`)
        .toContain(structure.sections[index].title);
    }
    // And they are last.
    expect(chapters.slice(-appendix.length).every((c) => c.kind === 'appendix')).toBe(true);
  });

  it('packs a section too small to hold a page, at the size a render showed', () => {
    // The threshold was a third of a page, reasoned rather than measured. An
    // appendix section of three ordinary paragraphs costs fourteen estimated
    // lines, cleared it, and printed on a sheet of its own at 2.3% ink — three
    // consecutive sheets did, against a sparse floor of 8% and a native band of
    // 13.3% to 22.1%. It is now half a page.
    expect(THIN_CHAPTER_LINES).toBe(19);
    const three = renderMarkdown(prose(3, 0), { idPrefix: 'thin' }).lines;
    expect(three + CHAPTER_FURNITURE_LINES).toBeLessThan(THIN_CHAPTER_LINES);

    const chapters = planConvertedChapters(structure, plan);
    const appendix = chapters.filter((c) => c.kind === 'appendix');
    expect(appendix.length).toBe(1);
    expect(appendix[0].title).toBe(APPENDIX_TITLE);
    expect(appendix[0].packedSections).toBeGreaterThan(1);
  });

  it('numbers the appendix as its own series, so the page says which it is', () => {
    // The document told the reader on page two that unmatched sections were
    // "kept as an appendix" and then printed them as SECTION 05…10 with the
    // format's own eyebrow, rule and 30pt serif. The only marker was a 9pt
    // italic dek. Read off a real render: the document contradicted itself.
    // Two substantial unbound sections, so the letter *series* is exercised
    // rather than just its first term. The main fixture's unbound sections are
    // all short enough to pack into one, which is correct and tests nothing
    // about numbering.
    const long = extractStructure([
      '# Borrowing Power Assessment',
      `## Client Position Summary\n\n${prose(3, 0)}`,
      `## Household Income\n\n${table}`,
      `## Notes On Method\n\n${prose(9, 0)}`,
      `## Notes On Sources\n\n${prose(9, 4)}`,
    ].join('\n\n'));
    const chapters = planConvertedChapters(long, proposeBinding('borrowing-capacity', long));
    const own = chapters.filter((c) => c.kind !== 'appendix');
    const appendix = chapters.filter((c) => c.kind === 'appendix');

    expect(own.map((c) => c.number)).toEqual(own.map((_, i) => String(i + 1).padStart(2, '0')));
    expect(own.every((c) => c.label === 'Section')).toBe(true);

    const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    expect(appendix.length).toBeGreaterThan(1);
    expect(appendix.map((c) => c.number)).toEqual(LETTERS.slice(0, appendix.length));
    expect(appendix.every((c) => c.label === 'Appendix')).toBe(true);
  });

  it('does not let the appendix renumber the format\'s own chapters', () => {
    // The two series are counted independently, so an appendix entry sitting in
    // the spine must not consume a number from the chapters around it.
    const chapters = planConvertedChapters(structure, plan);
    const lastOwn = [...chapters].reverse().find((c) => c.kind !== 'appendix');
    expect(lastOwn?.number).toBe(
      String(chapters.filter((c) => c.kind !== 'appendix').length).padStart(2, '0'),
    );
  });

  /** A converted document from one section of Markdown, for the caption cases. */
  const renderSection = (markdown: string) => {
    const s = extractStructure(`# Assessment\n\n${markdown}`);
    return renderConvertedDocument({
      structure: s,
      plan: proposeBinding('borrowing-capacity', s),
      palette,
      company: COMPANY,
      masthead: 'Harbour & Vale',
      systemName: 'Harbour Editorial',
      preparedOn: '2026-08-04T00:00:00.000Z',
    }).html;
  };

  it('titles a headerless table that nothing else names', () => {
    // A GFM table whose header cells are all blank gets no `thead` — right, and
    // it costs the table the only per-page-repeating box the sheet has, so
    // twelve rows of a key/value table landed on a fresh sheet identified by
    // nothing but the 8.5pt running head. A caption is the honest half: it
    // titles the table where it starts. It does not repeat, and synthesising
    // header labels the source never had would be inventing text.
    const html = renderSection(
      '## Existing Liabilities\n\nWhat is owed, and what it costs to hold.\n\n'
      + '| | |\n|---|---|\n| Vehicle | $18,400 |\n| Card | $4,000 |',
    );
    expect(html).toContain('<caption>Existing Liabilities</caption>');
  });

  it('says nothing when the chapter title is already standing over the table', () => {
    // The caption *is* the chapter title, so a table that opens the chapter body
    // has that title 34pt above it — and both real conversions printed the
    // stutter on their densest page. The first version of the guard tested the
    // preceding block and so excluded the one arrangement where the echo is
    // guaranteed, because there is no preceding block.
    const html = renderSection(
      '## Existing Liabilities\n\n| | |\n|---|---|\n| Vehicle | $18,400 |\n| Card | $4,000 |',
    );
    expect(html).not.toContain('<caption>');
  });

  it('says it once per chapter, not once per table', () => {
    // Two headless tables under one chapter printed the chapter title twice,
    // the second time directly under a subhead that had just said something
    // else — two competing labels 12pt apart, and the caption was the wrong one.
    const html = renderSection(
      '## Existing Liabilities\n\nWhat is owed.\n\n'
      + '| | |\n|---|---|\n| Vehicle | $18,400 |\n\n'
      + 'And the assumptions behind it.\n\n'
      + '| | |\n|---|---|\n| Buffer | 3.0% |',
    );
    expect([...html.matchAll(/<caption>/g)]).toHaveLength(1);
  });

  it('leaves a table with real column labels alone', () => {
    // It says what it is already.
    expect(render().html).not.toContain('<caption>');
  });

  it('prints the same numbers on the contents page as on the openers', () => {
    // They used to count independently — the body by array index, the contents
    // by its own counter — and agreed only because every chapter was one kind.
    const { html } = render();
    const openers = [...html.matchAll(/class="chapter-no">([^<]+)</g)].map((m) => m[1]);
    const contents = [...html.matchAll(/class="toc-no">([^<]+)</g)].map((m) => m[1]);
    // Borrowing Capacity declares `contents: false`, so this render has no
    // contents page — the assertion is that when there is one, it agrees.
    if (contents.length) expect(contents).toEqual(openers.map((o) => o.split(' ')[1]));
    expect(openers.some((o) => o.startsWith('APPENDIX'))).toBe(true);
    expect(openers.some((o) => o.startsWith('SECTION'))).toBe(true);
  });

  it('folds an unbound sub-section into its parent instead of giving it a page', () => {
    // The defect that made a 14-page draft come out at 27. A transcription of a
    // Snapshot returned 20 sections, 12 of them `###` sub-headings inside *How
    // This Was Calculated* — `DTI Ratio` at 61 characters, `Stress Test` at 78.
    // `planConvertedChapters` never read `depth`, so each stub became an
    // appendix chapter with an eyebrow, a header and a page break of its own.
    const nested = extractStructure([
      '# Borrowing Power Assessment',
      `## Client Position Summary\n\n${prose()}`,
      `## Household Income\n\n${table}`,
      `## How This Was Calculated\n\n${prose()}`,
      '### DTI Ratio\n\nThe debt-to-income ratio is 5.4 times gross household income.',
      '### Stress Test\n\nServiceability is assessed 3.00% above the advertised rate.',
      '### Living Expenses\n\nTaken at the greater of the declared figure and the HEM benchmark.',
    ].join('\n\n'));

    const p = proposeBinding('borrowing-capacity', nested);
    const chapters = planConvertedChapters(nested, p);
    const titles = chapters.map((c) => c.title);
    for (const stub of ['DTI Ratio', 'Stress Test', 'Living Expenses']) {
      expect(titles, stub).not.toContain(stub);
    }

    // Not dropped — folded, under their own heading, in source order, into the
    // one chapter their parent produced.
    const parent = chapters.find((c) => c.markdown.includes('DTI Ratio'))!;
    expect(parent).toBeDefined();
    expect(parent.foldedSubsections).toBe(3);
    expect(parent.markdown).toContain('### DTI Ratio');
    expect(parent.markdown).toContain('Serviceability is assessed 3.00% above the advertised rate.');
    expect(parent.markdown).toContain('the HEM benchmark');
    expect(parent.markdown.indexOf('DTI Ratio')).toBeLessThan(parent.markdown.indexOf('Stress Test'));
  });

  it('gives a sub-section a chapter of its own when the binding asked for one', () => {
    // Folding is what happens to sections *nobody chose*. A sub-section a
    // person confirmed against a format chapter is a chapter.
    const nested = extractStructure([
      '# Borrowing Power Assessment',
      `## Client Position Summary\n\n${prose()}`,
      `### Household Income\n\n${table}`,
    ].join('\n\n'));
    const p = proposeBinding('borrowing-capacity', nested);
    const boundIndex = p.bindings.find((b) => b.sectionIndex !== null && b.sectionIndex > 0);
    expect(boundIndex).toBeDefined();
    const chapters = planConvertedChapters(nested, p);
    // The sub-section's content is a chapter body, not folded into section 0.
    expect(chapters.find((c) => c.markdown.includes('| Lender | Rate |'))!.kind).toBe('bound');
    expect(chapters.find((c) => c.title === 'Client Position Summary')?.foldedSubsections)
      .toBeUndefined();
  });

  it('keeps a sub-section that has no parent to fold into', () => {
    // Extraction levels a document that opens at `###`, so this shape does not
    // arrive from `extractStructure` — the structure is built by hand on
    // purpose. Folding must not be able to lose a section just because there is
    // nowhere to put it, and a `depth: 2` section with nothing shallower before
    // it is exactly that case.
    const orphan = {
      title: 'Late Addendum',
      sections: [{
        index: 0, depth: 2 as const, title: 'Late Addendum',
        markdown: prose(), chars: prose().length, tables: 0, tabular: false,
      }],
      headingCount: 1,
      notices: {
        flattened: 0, tooShort: 0, charsOmitted: 0, unstructured: false, labelsFolded: 0,
        furnitureDropped: 0,
      },
    };
    const chapters = planConvertedChapters(orphan, {
      format: 'borrowing-capacity', bindings: [], unbound: [0], unfilled: [],
    });
    expect(chapters.filter((c) => c.kind === 'appendix').map((c) => c.title)).toEqual(['Late Addendum']);
  });

  it('numbers appendix chapters by chapter, not by unbound section', () => {
    // The id is what the enrichment map is keyed on, and planning runs twice —
    // once to decide what to ask the model about, once to render the answers.
    // A folded section that consumed an id would shift every id after it
    // between the two calls, and every block would land on the wrong chapter.
    const nested = extractStructure([
      '# Borrowing Power Assessment',
      `## Client Position Summary\n\n${prose()}`,
      `## Fee Schedule\n\n${prose()}`,
      '### Establishment\n\nCharged once, at settlement.',
      `## Complaints\n\n${prose()}`,
    ].join('\n\n'));
    const p = proposeBinding('borrowing-capacity', nested);
    const appendix = planConvertedChapters(nested, p).filter((c) => c.kind === 'appendix');
    expect(appendix.map((c) => c.id)).toEqual(appendix.map((_, i) => `cv.a${i}`));
    expect(appendix.map((c) => c.title)).not.toContain('Establishment');
  });

  it('says on the page that it is a draft, not a client document', () => {
    // A converted document has the same cover, typography and closing page as a
    // finished one. Without this somebody sends it to a client by accident.
    const html = render().html;
    expect(html).toContain('Converted draft — not a client document');
    // Beside the text, not on top of it. It arrived as a `caution` callout —
    // the loudest primitive there is — at the head of chapter one, so the first
    // thing anybody read was a warning about the document rather than the
    // document. Same words, quieter.
    expect(html).toContain('class="sidenote"');
    expect(html).not.toContain('class="callout tone-caution"');
  });

  it('prints as a document, not a draft, when the render says it is final', () => {
    // Right up to the moment somebody decides the binding is correct, and wrong
    // from then on.
    const html = renderConvertedDocument({
      structure, plan, palette,
      company: COMPANY, masthead: 'Harbour & Vale', systemName: 'Harbour Editorial',
      preparedOn: '2026-08-04T00:00:00.000Z',
      final: true,
    }).html;
    expect(html).not.toContain('Converted draft');
    expect(html).not.toContain('converted draft');
    // The provenance deks go with it — `From "Household Income"` is useful while
    // checking a binding and noise on a document being sent out.
    expect(html).not.toContain('From &quot;');
    expect(html).not.toContain('From "');
    // And it is still the same document otherwise.
    expect(html).toContain('Borrowing Capacity Snapshot');
    expect(html).toContain('class="report-cover');
  });

  it('says which format it was bound to, by one name', () => {
    // One name, everywhere. The cover eyebrow and the running head used to
    // print the archetype's `documentName` ("Borrowing Capacity Assessment")
    // while the cover's own "Bound to" line printed the renderer's
    // ("Borrowing Capacity Snapshot") — one page, two names for one format.
    const html = render().html;
    expect(html).toContain('Borrowing Capacity Snapshot');
    expect(html).not.toContain('Borrowing Capacity Assessment');
  });

  it('prints an unfilled chapter rather than skipping it', () => {
    const sparse = extractStructure(`# T\n\n## Household Income\n\n${table}`);
    const p = proposeBinding('borrowing-capacity', sparse);
    const chapters = planConvertedChapters(sparse, p);
    expect(chapters.filter((c) => c.kind === 'unfilled').length).toBeGreaterThan(0);
  });

  it('warns when the upload had no headings', () => {
    const flat = extractStructure(prose(6));
    const p = proposeBinding('borrowing-capacity', flat);
    const html = renderConvertedDocument({
      structure: flat, plan: p, palette,
      company: COMPANY,
      masthead: 'X', systemName: 'S', preparedOn: '2026-08-04T00:00:00.000Z',
    }).html;
    expect(html).toContain('The upload had no headings');
  });

  it('produces a legal spine', () => {
    expect(render().problems).toEqual([]);
  });
});

describe('a converted document that was designed', () => {
  const structure = extractStructure(UPLOAD);
  const plan = proposeBinding('borrowing-capacity', structure);
  const palette = resolveReportPalette({ preset: 'signature', brandHex: '#1F4E79' });

  /** The blocks a design pass returns for the first bound chapter. */
  const blocks: EnrichedBlock[] = [
    {
      kind: 'kpi',
      cells: [
        { label: 'Assessment rate', value: '9.44%' },
        { label: 'Maximum loan', value: '$856,932' },
      ],
    },
    { kind: 'bullet', label: 'Proposed loan', value: 76, max: 100 },
  ];

  const renderWith = (enriched: Record<string, EnrichedBlock[]>) => renderConvertedDocument({
    structure, plan, palette,
    company: COMPANY,
    masthead: 'Harbour & Vale',
    systemName: 'Harbour Editorial',
    preparedOn: '2026-08-04T00:00:00.000Z',
    enriched,
  });

  it('prints the primitives instead of paragraph soup', () => {
    // The whole point. Before this, a KPI strip in the source arrived as a
    // three-column table and a progress bar arrived as `<p>Proposed loan 76%</p>`.
    const html = renderWith({ 'cv.1': blocks }).html;
    expect(html).toContain('class="kpi-strip"');
    expect(html).toContain('<svg');
  });

  it('counts what it designed, for the row and the screen', () => {
    const out = renderWith({ 'cv.1': blocks });
    expect(out.enrichedCount).toBe(1);
    expect(out.blockCounts).toEqual({ kpi: 1, bullet: 1 });
  });

  it('leaves every other chapter exactly as it was', () => {
    const plain = renderConvertedDocument({
      structure, plan, palette,
      company: COMPANY, masthead: 'Harbour & Vale', systemName: 'Harbour Editorial',
      preparedOn: '2026-08-04T00:00:00.000Z',
    });
    expect(plain.enrichedCount).toBe(0);
    expect(plain.blockCounts).toEqual({});
    // An enriched chapter changes; the rest of the document does not.
    expect(renderWith({}).html).toBe(plain.html);
  });

  it('budgets the pages it will print, not the ones it would have', () => {
    // A KPI strip is four lines where the table it replaced was nine. Costing
    // the Markdown and printing the blocks is how a spine claims a page count
    // the document does not have.
    const designed = planConvertedChapters(structure, plan, { 'cv.1': blocks });
    const flat = planConvertedChapters(structure, plan);
    const one = designed.find((c) => c.id === 'cv.1')!;
    const before = flat.find((c) => c.id === 'cv.1')!;
    expect(one.blocks).toHaveLength(2);
    expect(one.lines).not.toBe(before.lines);
    expect(one.lines).toBe(enrichedLines(blocks) + CHAPTER_FURNITURE_LINES);
  });

  it('ignores blocks for a chapter that is not in the document', () => {
    const out = renderWith({ 'cv.nonsense': blocks });
    expect(out.enrichedCount).toBe(0);
  });
});

describe('brand design systems', () => {
  it('reads a form submission and a model response the same way', () => {
    const fromForm = readBrandDesignSystem({
      name: 'Quiet Ink', options: { preset: 'minimal_ink', density: 'compact' },
    });
    // The model's natural shape puts the preset at the top level.
    const fromModel = readBrandDesignSystem({
      name: 'Quiet Ink', preset: 'minimal_ink', options: { density: 'compact' },
    });
    expect(fromForm.ok && fromModel.ok).toBe(true);
    expect(fromForm.ok && fromForm.system.options.preset).toBe('minimal_ink');
    expect(fromModel.ok && fromModel.system.options.preset).toBe('minimal_ink');
  });

  it('refuses a malformed brand colour rather than ignoring it', () => {
    // Falling back to the house brand would hand somebody a document in the
    // wrong colour with nothing to explain why.
    const r = readBrandDesignSystem({ name: 'Broken', brandHex: 'rebeccapurple' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/#RRGGBB/);
  });

  it('needs a name', () => {
    expect(readBrandDesignSystem({ name: '' }).ok).toBe(false);
    expect(readBrandDesignSystem(null).ok).toBe(false);
  });

  it('derives a slug from the name', () => {
    expect(slugify('Warm  Editorial!')).toBe('warm-editorial');
    const r = readBrandDesignSystem({ name: 'Warm Editorial' });
    expect(r.ok && r.system.slug).toBe('warm-editorial');
  });

  it('records whether a model wrote it', () => {
    const r = readBrandDesignSystem({ name: 'Drafted', origin: 'generated', brief: 'warm' });
    expect(r.ok && r.system.origin).toBe('generated');
  });

  it('makes a near-white accent legible instead of shipping it', () => {
    // A model asked for "warm sandstone" returns exactly this, and it is 1.6:1
    // on ivory. The value is a request for a hue, not a decision about
    // legibility: `accentOnPaper` is re-derived and the audit passes.
    const r = readBrandDesignSystem({ name: 'Sandstone', brandHex: '#FBF8F0' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const audit = auditBrandDesignSystem(r.system);
    expect(audit.ok).toBe(true);
    expect(audit.palette.accentOnPaper.toUpperCase()).not.toBe('#FBF8F0');
  });

  it('audits every preset it offers', () => {
    for (const preset of ['signature', 'editorial_navy', 'minimal_ink', 'high_contrast'] as const) {
      for (const brandHex of [null, '#1F4E79', '#B8873A', '#111111', '#FBF8F0']) {
        const r = readBrandDesignSystem({ name: 'Probe', brandHex, options: { preset } });
        expect(r.ok).toBe(true);
        if (!r.ok) continue;
        const audit = auditBrandDesignSystem(r.system);
        expect(audit.ok, `${preset} / ${brandHex}: ${describeAuditProblems(audit.problems)}`).toBe(true);
      }
    }
  });

  it('describes a failure in terms somebody can act on', () => {
    const described = describeAuditProblems([
      { role: 'accentOnPaper', ground: 'paperAlt', ratio: 1.62, floor: 3 },
    ]);
    expect(described).toContain('accentOnPaper');
    expect(described).toContain('1.62');
  });
});

describe('what the cover is given', () => {
  it('prefers the document\'s own title to the uploaded file\'s name', () => {
    // The defect somebody saw first, because it is the first page. `title` was
    // *seeded* with the fallback, so every `if (!title)` below it — including
    // the rule that reads the document's own top-level heading — was dead code
    // whenever a filename existed, which is always.
    const s = extractStructure(
      `# Borrowing Capacity Snapshot\n\n## Household Income\n\n${table}`,
      'Report_Name_Client_Name_2026-08-02',
    );
    expect(s.title).toBe('Borrowing Capacity Snapshot');
  });

  it('still falls back to the file name when the source names nothing', () => {
    const s = extractStructure(`## One\n\n${prose()}\n\n## Two\n\n${prose()}`, 'Quarterly_Review');
    expect(s.title).toBe('Quarterly_Review');
  });

  it('steps the title down rather than letting it run off the page', () => {
    // A cover title is somebody else's string and cannot be trusted to be
    // short. CSS cannot measure one, so the step is decided here and arrives at
    // the stylesheet as a class.
    expect(coverTitleFit('Snapshot')).toBe('full');
    expect(coverTitleFit('Borrowing Capacity Snapshot')).toBe('medium');
    expect(coverTitleFit('Naidu Property Consulting — Borrowing Capacity Snapshot')).toBe('long');
    expect(coverTitleFit(
      'Borrowing Capacity Snapshot and Serviceability Assessment for the 2026 Financial Year',
    )).toBe('longest');
    // A subtitle costs room too, so the same title fits harder with one.
    expect(coverTitleFit('Borrowing Capacity Snapshot')).toBe('medium');
    expect(coverTitleFit('Borrowing Capacity Snapshot', 'Prepared August 2026 for a client'))
      .toBe('long');
  });

  it('cannot be pushed outside the trim by a word that will not break', () => {
    // The mechanism, not the symptom: `max-width` cannot clip what cannot wrap,
    // and the overflow dragged the masthead and the footer off the sheet with
    // it. Both tables are fixed for the same reason.
    const css = buildReportCss({
      palette: resolveReportPalette({ preset: 'signature', brandHex: '#1F4E79' }),
      options: null,
      masthead: 'A Very Long Company Name Indeed',
    });
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('table-layout: fixed');
    for (const fit of ['medium', 'long', 'longest']) {
      expect(css, fit).toContain(`.fit-${fit}`);
    }
  });

  it('names no company and no client in the stylesheet it ships', () => {
    // These comments travel inside every tenant's PDF. `documentBrand.spec.ts`
    // catches our own name; this catches the habit that put it there.
    const css = buildReportCss({
      palette: resolveReportPalette({ preset: 'signature' }), options: null, masthead: 'X',
    });
    for (const leak of ['Naidu', 'NAIDU', 'npcservices']) {
      expect(css, leak).not.toContain(leak);
    }
  });
});

describe('the appendix stops printing near-empty pages', () => {
  const thin = (title: string) => `## ${title}\n\n- One short bullet that is long enough to survive.`;

  it('packs consecutive thin sections into one chapter', () => {
    // Four of seventeen pages of a real render carried one to three lines each,
    // because a chapter is a page and every unbound section became a chapter.
    const s = extractStructure([
      '# Assessment',
      `## Household Income\n\n${table}`,
      thin('Recommendations'),
      thin('Warnings'),
    ].join('\n\n'));
    const p = proposeBinding('borrowing-capacity', s);
    const appendix = planConvertedChapters(s, p).filter((c) => c.kind === 'appendix');
    expect(appendix).toHaveLength(1);
    expect(appendix[0].title).toBe(APPENDIX_TITLE);
    expect(appendix[0].packedSections).toBe(2);
    // Packed, not lost — each keeps its own heading, in source order.
    expect(appendix[0].markdown).toContain('## Recommendations');
    expect(appendix[0].markdown).toContain('## Warnings');
    expect(appendix[0].markdown.indexOf('Recommendations'))
      .toBeLessThan(appendix[0].markdown.indexOf('Warnings'));
  });

  it('leaves a section that can hold a page under its own name', () => {
    // The appendix exists so nothing an uploader wrote disappears, and losing
    // the name of a substantial section is a way of disappearing it.
    const s = extractStructure([
      '# Assessment',
      `## Household Income\n\n${table}`,
      `## Executive Summary\n\n${prose(6)}`,
      thin('Warnings'),
    ].join('\n\n'));
    const p = proposeBinding('borrowing-capacity', s);
    const appendix = planConvertedChapters(s, p).filter((c) => c.kind === 'appendix');
    expect(appendix.map((c) => c.title)).toContain('Executive Summary');
    expect(appendix.find((c) => c.title === 'Executive Summary')!.packedSections).toBeUndefined();
    // Ids stay contiguous whatever the packing did.
    expect(appendix.map((c) => c.id)).toEqual(appendix.map((_, i) => `cv.a${i}`));
  });
});

describe('the document stops repeating itself', () => {
  it('drops a lede that only restates the chapter title', () => {
    // A real render printed "How the capacity is built" as a chapter header and
    // again, immediately under it, as a lede. Two sizes, one sentence.
    const blocks: EnrichedBlock[] = [
      { kind: 'lede', text: 'How the capacity is built' },
      { kind: 'kpi', cells: [{ label: 'Rate', value: '9.44%' }, { label: 'Term', value: '30 years' }] },
    ];
    expect(dropRedundantLede(blocks, 'How the capacity is built').map((b) => b.kind)).toEqual(['kpi']);
    // Punctuation and case are not the difference.
    expect(dropRedundantLede(
      [{ kind: 'lede', text: 'How the Capacity Is Built.' }, blocks[1]], 'How the capacity is built',
    )).toHaveLength(1);
  });

  it('keeps a lede that says more than the title', () => {
    const blocks: EnrichedBlock[] = [
      { kind: 'lede', text: 'How the capacity is built, from gross income to the assessed maximum.' },
      { kind: 'kpi', cells: [{ label: 'Rate', value: '9.44%' }, { label: 'Term', value: '30 years' }] },
    ];
    expect(dropRedundantLede(blocks, 'How the capacity is built')).toHaveLength(2);
  });

  it('drops the template\'s own contact block, which the design system prints', () => {
    // The one thing the converter throws away: a converted draft printed the
    // uploaded contact section as a chapter and then the design system's own
    // closing page one page later.
    const s = extractStructure([
      '# Assessment',
      `## Household Income\n\n${table}`,
      `## Contact Us\n\n${prose()}`,
    ].join('\n\n'));
    expect(s.sections.map((x) => x.title)).not.toContain('Contact Us');
    expect(s.notices.furnitureDropped).toBe(1);
  });

  it('keeps the template\'s own closing section when nothing will replace it', () => {
    // The drop is right *because* `renderCompanyPage` prints the tenant's own.
    // It was unconditional, so when the tenant's was missing — a settings row
    // never written, or a query the render route warns about and swallows —
    // the document lost both and ended on a page classed `page-disclaimer`
    // with no disclaimer on it. Losing the tenant's wording is a preference;
    // losing the disclaimer from a lending document is not.
    const source = [
      '# Assessment',
      `## Household Income\n\n${table}`,
      `## Disclaimer\n\n${prose()}`,
    ].join('\n\n');
    expect(extractStructure(source).sections.map((x) => x.title)).not.toContain('Disclaimer');

    const kept = extractStructure(source, '', { keepClosingFurniture: true });
    expect(kept.sections.map((x) => x.title)).toContain('Disclaimer');
    expect(kept.notices.furnitureDropped).toBe(0);
  });

  it('keeps a contact section that is not at the end', () => {
    // Narrow on purpose. A "Contact" in the middle of a template is content.
    const s = extractStructure([
      '# Assessment',
      `## Contact Us\n\n${prose()}`,
      `## Household Income\n\n${table}`,
    ].join('\n\n'));
    expect(s.sections.map((x) => x.title)).toContain('Contact Us');
    expect(s.notices.furnitureDropped).toBe(0);
  });

  it('reads a hard-wrapped disclaimer as paragraphs, not as a column of scraps', () => {
    // The last thing on the last page of every report this repo produces, in
    // nine formats. It split on every newline, so an editor's wrapping printed
    // as ragged half-lines.
    const paragraphs = disclaimerParagraphs({
      is_enabled: true,
      text: 'As a Professional Property Consultant, we provide information based on our\n'
        + 'expertise and experience in the market. This is not financial advice.\n'
        + 'Always conduct your own research and due diligence before you\n'
        + 'transact.',
      font_size: 'small',
    } as never);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toContain('based on our expertise and experience');
    expect(paragraphs[1]).toContain('your own research and due diligence before you transact');
  });

  it('still treats a blank line as a paragraph break', () => {
    const paragraphs = disclaimerParagraphs({
      is_enabled: true, text: 'First point, unfinished\nand its ending.\n\nSecond point.', font_size: 'small',
    } as never);
    expect(paragraphs).toEqual(['First point, unfinished and its ending.', 'Second point.']);
  });
});

describe('figures transcribed out of a legacy PDF', () => {
  it('repairs a float artefact rather than printing it to a client', () => {
    // `9.440000000000001%` is what a rate looks like when it was summed before
    // it was displayed, and a real Snapshot printed exactly that in its
    // assumptions table. The converter transcribes what it is given.
    expect(repairFloatArtefacts('| Assessment Rate | 9.440000000000001% |'))
      .toBe('| Assessment Rate | 9.44% |');
    expect(repairFloatArtefacts('a surplus of 0.30000000000000004')).toBe('a surplus of 0.3');
  });

  it('leaves an ordinary figure exactly as it found it', () => {
    for (const kept of ['$856,932', '9.44%', '$203,958.752/yr', '30 years', 'v1.2.3', '10.6x']) {
      expect(repairFloatArtefacts(kept), kept).toBe(kept);
    }
  });

  it('repairs before the faithfulness snapshot, not after', () => {
    // The order is the whole point. Normalising later would leave the guard
    // comparing `9.44` against a chapter that says `9.440000000000001`, and it
    // would throw the chapter away for inventing a figure.
    const s = extractStructure(
      '# T\n\n## Rates\n\n| Assumption | Basis |\n| --- | --- |\n'
      + '| Assessment Rate | 9.440000000000001% |\n| Loan Term | 30 years |',
    );
    expect(s.sections[0].markdown).toContain('9.44%');
    expect(s.sections[0].markdown).not.toContain('9.440000000000001');
  });
});

describe('the raised surface style', () => {
  const cssFor = (surfaceStyle: 'flat' | 'raised') => buildReportCss({
    palette: resolveReportPalette({ preset: 'signature', brandHex: '#D9A520' }),
    options: { surfaceStyle },
    masthead: 'Harbour & Vale',
  });

  it('is off unless a design system asks for it', () => {
    // Eight production formats have golden renders taken against the flat
    // sheet. A document that restyles itself because somebody added a field is
    // worse than one that stays plain.
    expect(DEFAULT_REPORT_DESIGN_OPTIONS.surfaceStyle).toBe('flat');
    expect(normalizeReportDesignOptions({}).surfaceStyle).toBe('flat');
    expect(normalizeReportDesignOptions({ surfaceStyle: 'nonsense' as never }).surfaceStyle).toBe('flat');
    expect(cssFor('flat')).not.toContain('── Raised');
  });

  it('turns a KPI strip into cards and a table into a shell', () => {
    const css = cssFor('raised');
    expect(css).toContain('── Raised');
    // The single biggest visual difference between a document that looks
    // composed and one that looks printed out.
    expect(css).toMatch(/\.kpi-strip \{[^}]*display: flex/);
    expect(css).toMatch(/\.kpi-strip \.kpi \{[^}]*border-radius/);
    expect(css).toMatch(/table\.data \{[^}]*border-collapse: separate/);
  });

  it('puts the paper texture where it is actually visible', () => {
    // Found by rendering: on a section it paints that box and stops; on the
    // root it is propagated to the canvas and painted *over* the page box, so
    // the grid survived only in the margins and read as a printing fault. It
    // goes on the page box, with the root cleared.
    const css = cssFor('raised');
    expect(css).toMatch(/@page \{\s*background-image:/);
    expect(css).toContain('html, body { background: transparent; }');
    // And not over an obsidian cover, which would be a cutting mat.
    expect(css).toContain('@page cover { background-image: none; }');
  });

  it('uses nothing WeasyPrint cannot draw', () => {
    // Tested against WeasyPrint 69, not assumed: it ignores `box-shadow` and
    // `filter` as unknown properties, and its SVG renderer ignores
    // `feGaussianBlur` too, so the soft glow a browser gives a card is
    // genuinely unavailable. A gradient and a hairline ring stand in for it.
    const css = cssFor('raised');
    for (const unsupported of ['box-shadow', 'filter:', 'backdrop-filter']) {
      expect(css, unsupported).not.toContain(unsupported);
    }
    expect(css).toContain('linear-gradient');
  });
});

describe('a table whose header says nothing', () => {
  it('does not print an empty header row', () => {
    // A key/value table transcribed out of a PDF arrives with blank header
    // cells. Invisible while the header carried no styling of its own — and an
    // empty tinted band across the top of the table the moment one did.
    const html = renderDataTable(
      [{ key: 'a', label: '' }, { key: 'b', label: '  ' }],
      [{ a: 'Gross annual income', b: '$223,698' }],
    );
    expect(html).not.toContain('<thead>');
    expect(html).toContain('$223,698');
  });

  it('keeps a header that says something, even partly', () => {
    const html = renderDataTable(
      [{ key: 'a', label: 'Component' }, { key: 'b', label: '' }],
      [{ a: 'Salary', b: '$180,000' }],
    );
    expect(html).toContain('<thead>');
    expect(html).toContain('Component');
  });
});

describe('a chapter the model composed', () => {
  const structure = extractStructure(UPLOAD);
  const plan = proposeBinding('borrowing-capacity', structure);
  const palette = resolveReportPalette({ preset: 'signature', brandHex: '#1F4E79' });

  const SHEET = '<p class="lede">The assessment concluded a maximum capacity of $856,932.</p>'
    + '<div class="grid-12"><div class="col col-8"><div class="table-block"><table class="data">'
    + '<tbody><tr><th scope="row">Rate</th><td class="num">9.44%</td></tr></tbody>'
    + '</table></div></div><div class="col col-4">'
    + '<div class="callout tone-caution"><span class="callout-label">Assumed</span>'
    + '<p>Rates hold.</p></div></div></div>';

  const renderWith = (composed: Record<string, string[]>) => renderConvertedDocument({
    structure, plan, palette,
    company: COMPANY, masthead: 'Harbour & Vale', systemName: 'Harbour Editorial',
    preparedOn: '2026-08-04T00:00:00.000Z',
    composed,
  });

  it('prints the composition inside a sheet', () => {
    const out = renderWith({ 'cv.1': [SHEET] });
    expect(out.html).toContain('<section class="sheet">');
    expect(out.html).toContain('class="grid-12"');
    expect(out.html).toContain('class="callout tone-caution"');
    expect(out.composedCount).toBe(1);
    // Composed chapters count as designed, so the ledger's "n of m designed"
    // stays true whichever mode produced them.
    expect(out.enrichedCount).toBe(1);
  });

  it('gives each sheet a page of its own', () => {
    const out = renderWith({ 'cv.1': [SHEET, SHEET] });
    expect(out.html.match(/<section class="sheet">/g)).toHaveLength(2);
  });

  it('is a page because it ends, not because it is tall', () => {
    // The obvious implementation gave the sheet the height of the content box.
    // Rendered, that pushed the first sheet's contents past the chapter header
    // onto the next page and turned a two-chapter document into ten. Whether a
    // page is full is a question `judgeDocument` answers from the render.
    const css = buildReportCss({ palette, options: null, masthead: 'X' });
    expect(css).toContain('.sheet { break-after: page; }');
    expect(css).not.toMatch(/\.sheet \{[^}]*min-height/);
    expect(css).toContain('.sheet:last-of-type { break-after: auto; }');
  });

  it('does not let a sheet claim a named page inside a chapter that has one', () => {
    // `.page-body + .page-body { break-before: page }` exists to separate
    // sibling named pages. A sheet nested inside a chapter that is already
    // `page-body` triggered it — a break before every sheet on top of the one
    // after it.
    expect(renderWith({ 'cv.1': [SHEET] }).html).not.toContain('class="sheet page-body"');
  });

  it('leaves every other chapter exactly as it was', () => {
    const plain = renderConvertedDocument({
      structure, plan, palette,
      company: COMPANY, masthead: 'Harbour & Vale', systemName: 'Harbour Editorial',
      preparedOn: '2026-08-04T00:00:00.000Z',
    });
    expect(renderWith({}).html).toBe(plain.html);
    expect(plain.composedCount).toBe(0);
  });

  it('ignores sheets for a chapter that is not in the document', () => {
    expect(renderWith({ 'cv.nonsense': [SHEET] }).composedCount).toBe(0);
  });
});
