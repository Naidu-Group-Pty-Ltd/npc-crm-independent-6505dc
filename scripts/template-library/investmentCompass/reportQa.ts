/**
 * Report Q&A on the Investment Compass families.
 *
 * ## Why this file exists, given a spec used to forbid it
 *
 * `reportQaNotOnTheFamilies.spec.ts` held that this format could not be drawn
 * by a fixed-layout master, and it was right about the vocabulary as it stood:
 * no block rendered Markdown, and 70% of the 565 stored answers carry inline
 * bold, 48% a heading, 56% a list and 19% a pipe table. Bound to a `text-block`
 * every one of those printed as its own source on a client's page.
 *
 * `markdown-block` closed that. It takes Markdown **source** and renders it
 * through the programme's escape-first renderer, so it cannot emit markup the
 * model chose — which is what let it into `PRODUCTION_SAFE_BLOCK_TYPES` without
 * putting a hole in a security allow-list.
 *
 * ## What these masters draw, and what they leave to the flowing route
 *
 * One exchange, in depth. That is the document a fixed page sequence suits: a
 * question, its answer set properly, the sources it was grounded in, and a list
 * of what else was asked in the same conversation.
 *
 * A whole transcript is not that document. Answers run 2,193 characters at the
 * median and 33,377 at the longest, and a conversation reaches 70 turns — no
 * fixed sequence covers that range, and `render-report-qa-pdf` paginates it
 * properly. The adapter's `legacyFallback` says so rather than implying the
 * template is a replacement.
 *
 * ## How a page sequence carries a body of unknown length
 *
 * The answer gets one page plus seven conditional continuations, each holding
 * `pageIndex` N of the same source and each conditional on
 * `qa.answerPages > N`. A conditional page that does not render costs nothing —
 * `visiblePages` filters before layout — so a median answer produces a five-page
 * document and the longest produces twelve, from one set of masters. This is the
 * Client Details Form pattern, where 742 of 775 clients get five pages and the
 * other 33 get up to thirteen.
 *
 * The page count comes from the projection, which computes it with the same
 * `packMarkdownPages` the block uses. See `reports/markdownPaging.pure.ts` for
 * why that is one function rather than two.
 */
import {
  DESIGN_FAMILIES,
  resolveManifest,
  type DesignFamily,
  type VariantDefinition,
} from './family';
import {
  beginCompassTemplate,
  callout,
  cols,
  contentTop,
  cover,
  disclaimerPage,
  flow,
  ifItFits,
  kpis,
  markdown,
  remainingAfter,
  MARKDOWN_LINES_PER_PAGE,
  oneOf,
  page,
  prose,
  sectionHeading,
  table,
  textHeight,
  withFurniture,
  type KpiItem,
  type PageDef,
} from './blocks';
import { assembleMaster, type CompassSeedTemplate, type ReportFormat } from './master';
import { STANDARD_DISCLAIMER } from '../designSystem';

const FOOTER = '{{qa.title}} · Report Q&A';
const DOCUMENT_LABEL = 'Report Q&A';

/**
 * Answer pages a master declares: one plus seven continuations.
 *
 * Eight pages is 272 estimated lines, about 17,700 characters, which covers
 * roughly the 95th percentile of the corpus. Beyond it the projection's
 * `truncationNote` prints on the page rather than the tail vanishing — the same
 * rule Market Intelligence holds about clipping a section and saying so.
 */
const ANSWER_PAGES = 8;

/** Further questions listed after the exchange. The projection caps turns at 12. */
const FURTHER_QUESTIONS = 6;

const REPORT_QA_FORMAT: ReportFormat = {
  key: 'report-qa',
  reportType: 'qa',
  // `client_form` is a fact-find; this is analysis of reports the client owns.
  category: 'investment',
  tier: 'compass',
  label: 'Report Q&A',
  extraTags: ['report-qa', 'question', 'analysis', 'model-authored'],
};

const HAS_QA = 'qa';

const SUMMARY_KPIS: KpiItem[] = [
  { label: 'Exchanges', value: '{{qa.turnCount}}', note: 'In this conversation' },
  { label: 'Sources', value: '{{qa.sourceCount}}', note: 'Reports it was grounded in' },
  { label: 'Prepared', value: '{{qa.preparedOn | date}}', note: 'When this was exported' },
];

/** A page that exists only when the answer runs on to it. */
function answerPage(index: number, p: PageDef): PageDef {
  // `tocContinues`: the eight answer sheets are one section, so the contents
  // names "The answer" once rather than listing eight rows. Same rule as the
  // Investment Compass's forty narrative pages.
  return { ...p, conditional: `qa && qa.answerPages > ${index}`, tocContinues: true };
}

function questionRow(i: number): string[] {
  return [`{{qa.turns.${i}.index}}`, `{{qa.turns.${i}.question}}`];
}

function sourceRow(i: number): string[] {
  return [`{{qa.sources.${i}.name}}`];
}

function buildTemplate(family: DesignFamily, variant: VariantDefinition): CompassSeedTemplate {
  const manifest = resolveManifest(family, variant);
  const c = beginCompassTemplate(family, variant, manifest);
  const pages: PageDef[] = [];

  pages.push(cover({
    wordmarkTop: '{{org.name}}',
    wordmarkBottom: 'Report Q&A',
    tagline: 'Your dedicated property partner',
    marker: 'Report Q&A',
    eyebrow: 'Report Q&A',
    // `coverTitle`, not `title`: a conversation's title is its first question,
    // and the stored tail reaches 160 characters — which ran 256pt past the
    // footer on one family's cover. The projection bounds it on a word; the
    // running foot keeps the full title.
    title: '{{qa.coverTitle}}',
    standfirst:
      'A question asked of the reports on file, and the answer it drew. The '
      + 'answer is written by a language model against the documents named in '
      + 'it, and is reproduced here as it was given.',
    locations: 'Prepared {{qa.preparedOn | date}}',
    facts: [
      // The words a reader would use, not the enum — the raw `subject` printed
      // "answer" as a document type on every cover until the projection
      // published the legacy's own label.
      { label: 'Subject', value: '{{qa.subjectLabel}}' },
      // "13 of 20" when the transcript budget cut the conversation — the
      // legacy cover's own treatment, composed in the projection.
      { label: 'Exchanges', value: '{{qa.exchangesLabel}}' },
      { label: 'Sources', value: '{{qa.sourceCount | fixed:0}}' },
      // What this document actually sets — the full count drives the
      // continuation conditionals, and when the answer runs past them the
      // cut page says so rather than the cover overstating itself.
      { label: 'Answer pages', value: '{{qa.answerPagesShown | fixed:0}}' },
    ],
  }));

  // ---------------------------------------------------------------- the question
  pages.push(withFurniture(page('What was asked', [
    ...flow(ifItFits([
      sectionHeading({ eyebrow: 'What was asked', heading: 'The question' }),
      // The question is plain text — it is a heading in the record and carries
      // no markup, which is why this is prose rather than a markdown-block.
      prose('{{qa.question}}', textHeight(240)),
      { ...kpis(SUMMARY_KPIS), conditional: HAS_QA },
      // The document's built lede — `narrativeFor`'s two or three sentences,
      // the one piece of prose here no model wrote, and the opening the legacy
      // sets over its first chapter. It replaces the shorter `sourceSummary`
      // this callout used to bind, whose "Grounded in…" clause the narrative
      // already carries.
      {
        ...callout(
          'What this document is',
          '{{qa.narrative}}',
          textHeight(340, { extra: 34 }),
        ),
        conditional: 'qa && qa.narrative',
      },
      // One position, two mutually exclusive statements — the pattern the
      // Client Details closing page set. An answered question gets the
      // provenance line the legacy prints under every question and every
      // exporter dropped: provider · version, whether a human edited it, how
      // many sources it cited, when it was asked. An unanswered one gets the
      // legacy's caution callout in its words, because the answer pages are
      // conditional on `qa.answer` and without this the document would simply
      // have no answer and no explanation. The projection publishes exactly
      // one of the two.
      oneOf(
        {
          when: 'qa && qa.provenanceLine',
          item: callout('How it was answered', '{{qa.provenanceLine}}'),
        },
        {
          when: 'qa && qa.answerMissingNote',
          item: callout('No answer', '{{qa.answerMissingNote}}'),
        },
      ),
    ], [
      // A whole sentence from the projection, or absent. A fragment
      // concatenated into a title is what left a dangling separator on the
      // Cash Flow Comparison's ranking page.
      {
        ...callout('Not everything is shown', '{{qa.omissionNote}}'),
        conditional: 'qa && qa.omissionNote',
      },
    ], contentTop()), contentTop()),
  ]), FOOTER));

  // ---------------------------------------------------------------- the answer
  // Page one always exists when there is an answer at all; the rest are
  // conditional on the projection's page count.
  // Page one carries the section heading as well, so its body is shorter than a
  // continuation page's. Fitted against the seed builder's overflow guard rather
  // than derived: `sectionHeading` sizes itself from the family's own scale, and
  // a declared height that is too small does not overflow the page — it prints
  // over the next block, which `flow()`'s arithmetic cannot see.
  // Derived from the heading this page draws. See `remainingAfter`: the
  // `- 104` these lines used to carry stood in for a height this module
  // computes exactly, and it was short on five families elsewhere.
  const answerHeading = sectionHeading({ eyebrow: 'The reply', heading: 'The answer' });
  const firstBodyHeight = remainingAfter([answerHeading], contentTop());
  const contBodyHeight = remainingAfter([], contentTop());

  pages.push({
    ...withFurniture(page('The answer', [
      ...flow([
        answerHeading,
        markdown('{{qa.answer}}', 0, firstBodyHeight, MARKDOWN_LINES_PER_PAGE),
      ], contentTop()),
    ]), FOOTER),
    // `qa.answer`, not `qa`: a question that was never answered used to render
    // this page as a heading over nothing. The "What was asked" page carries
    // the legacy's "No answer" callout for that record instead.
    conditional: 'qa && qa.answer',
  });

  for (let i = 1; i < ANSWER_PAGES; i += 1) {
    pages.push(answerPage(i, withFurniture(page(`The answer (${i + 1})`, [
      ...flow([
        markdown('{{qa.answer}}', i, contBodyHeight, MARKDOWN_LINES_PER_PAGE),
      ], contentTop()),
    ]), FOOTER)));
  }

  // ------------------------------------------------------------- the cut, said
  // Nine of the 565 stored answers run past the eight pages above. The block
  // simply stops drawing buckets it has no page for, so without this page the
  // tail of a long answer vanished with nothing on the page saying so — the
  // guard the comment above `ANSWER_PAGES` promised but nothing implemented.
  // A page of its own rather than a callout on the last continuation, because
  // the continuation's markdown body is sized to the full page and a callout
  // above it would print over the text.
  pages.push({
    ...withFurniture(page('Not the whole answer', [
      ...flow([
        sectionHeading({ eyebrow: 'The reply, cut short', heading: 'Not the whole answer' }),
        callout('Where the rest is', '{{qa.answerCutNote}}', textHeight(180, { extra: 34 })),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'qa && qa.answerCutNote',
  });

  // ---------------------------------------------------------------- what else
  pages.push({
    ...withFurniture(page('The rest of the conversation', [
      ...flow([
        sectionHeading({ eyebrow: 'The conversation', heading: 'What else was asked' }),
        prose(
          'The exchanges below are part of the same conversation. Their answers '
          + 'are in the full transcript rather than in this document.',
          textHeight(150),
        ),
        // As deep as the conversation: 29 of the stored conversations have
        // exactly two exchanges, and a fixed six-row table ruled off four
        // blank rows for every one of them. The caps are what stop an
        // unbounded collection running off a page that cannot paginate.
        (() => {
          const questionsTable = (n: number) => table({
            headers: ['#', 'Question'],
            rows: Array.from({ length: n }, (_, i) => questionRow(i + 1)),
            columnWidths: cols(40, c.contentWidth - 40),
            numeric: [],
          });
          return oneOf(
            { when: 'qa && qa.turns && qa.turns.length <= 2', item: questionsTable(1) },
            { when: 'qa && qa.turns && qa.turns.length > 2 && qa.turns.length <= 4', item: questionsTable(3) },
            { when: 'qa && qa.turns && qa.turns.length > 4', item: questionsTable(FURTHER_QUESTIONS) },
          );
        })(),
        {
          ...callout('The complete text', '{{qa.truncationNote}}'),
          conditional: 'qa && qa.truncationNote',
        },
      ], contentTop()),
    ]), FOOTER),
    // `qa.turns[1]`, bracketed: a page conditional is JavaScript, and
    // `qa.turns.1` is a SyntaxError that logs once and answers false forever.
    // This page shipped dark on every conversation with a second exchange —
    // found the same way the two portfolio market pages were found.
    conditional: 'qa && qa.turns && qa.turns[1]',
  });

  // ---------------------------------------------------------------- sources
  pages.push({
    ...withFurniture(page('What it read', [
      ...flow(ifItFits([
        sectionHeading({ eyebrow: 'Grounding', heading: 'Sources' }),
        prose(
          'The answer was grounded in the reports below. A figure it states that '
          + 'is not in one of them is not supported by this document.',
          textHeight(170),
        ),
        // As deep as the grounding: most grounded conversations name one or
        // two reports, and a fixed eight-row table ruled off up to seven
        // blank rows under them. Three conversations name seventeen — the
        // omission callout below is theirs.
        (() => {
          const sourcesTable = (n: number) => table({
            headers: ['Report'],
            rows: Array.from({ length: n }, (_, i) => sourceRow(i)),
            columnWidths: cols(c.contentWidth),
            numeric: [],
          });
          return oneOf(
            { when: 'qa && qa.sourceCount <= 1', item: sourcesTable(1) },
            { when: 'qa && qa.sourceCount == 2', item: sourcesTable(2) },
            { when: 'qa && qa.sourceCount > 2 && qa.sourceCount <= 5', item: sourcesTable(5) },
            { when: 'qa && qa.sourceCount > 5', item: sourcesTable(8) },
          );
        })(),
      ], [
        {
          ...callout('Not every report is listed', '{{qa.sourcesOmittedNote}}'),
          conditional: 'qa && qa.sourcesOmittedNote',
        },
      ], contentTop()), contentTop()),
    ]), FOOTER),
    conditional: 'qa && qa.sources',
  });

  // ---------------------------------------------------------------- citations
  // The passages the answers were drawn from — the legacy sources chapter's
  // table, deduplicated across every turn by the normaliser. Zero messages in
  // the record carry a citation today, so this page renders for none of them
  // and costs nothing; it is the page that lights up as citations land, which
  // is exactly when closing a latent gap is cheap.
  pages.push({
    ...withFurniture(page('What it cited', [
      ...flow(ifItFits([
        sectionHeading({ eyebrow: 'Citations', heading: 'What it cited' }),
        prose(
          'The passages below are the retrievals the answers were drawn from — '
          + 'which document, where in it, and how close the match was.',
          textHeight(160),
        ),
        table({
          headers: ['#', 'Document', 'Located', 'Match'],
          rows: Array.from({ length: 6 }, (_, i) => [
            `{{qa.citations.${i}.n}}`,
            `{{qa.citations.${i}.documentName}}`,
            `{{qa.citations.${i}.locus}}`,
            `{{qa.citations.${i}.match}}`,
          ]),
          columnWidths: cols(32, c.contentWidth - 32 - 150, 90, 60),
          numeric: [3],
        }),
      ], [
        {
          ...callout('Not every passage is shown', '{{qa.citationsNote}}'),
          conditional: 'qa && qa.citationsNote',
        },
        // The first retrieved passage, quoted — the snippet the legacy sets in
        // a sidenote beside its table. One rather than six, because a fixed
        // page cannot carry six 280-character quotations.
        {
          ...callout('From the sources', '{{qa.citations.0.snippet}}', textHeight(300, { extra: 34 })),
          conditional: 'qa && qa.citations && qa.citations[0] && qa.citations[0].snippet',
        },
      ], contentTop()), contentTop()),
    ]), FOOTER),
    conditional: 'qa && qa.citations',
  });

  pages.push(disclaimerPage(STANDARD_DISCLAIMER));

  return assembleMaster({ family, variant, manifest, c, pages, format: REPORT_QA_FORMAT });
}

/** Every Report Q&A master, by family, in catalogue order. */
export const REPORT_QA_TEMPLATES: CompassSeedTemplate[] = DESIGN_FAMILIES.flatMap(
  (family) => family.variants.map((variant) => buildTemplate(family, variant)),
);
