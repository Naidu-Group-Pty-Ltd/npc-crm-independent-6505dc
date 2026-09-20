/**
 * A listing portal is not a source.
 *
 * S5/S6 §4. Found by reading the rendered PDFs of the 48 Redfern Street
 * lineage on 18 September 2026, not by reading code: **four bracketed inline
 * citations per document, three of them naming `Property.com.au`** — and one
 * of those three carries the sentence
 *
 * > …multiple nearby addresses on the street recording **no bushfire, flood or
 * > heritage overlays** on public mapping at the time they were last
 * > updated.[Property.com.au, 119, 120, 137 and 139 Redfern Street profiles,
 * > 2024–2026]
 *
 * which is the exact sentence `planningFacts.pure.ts` forbids by name:
 * *"never write … that it is not flood or bushfire affected on the authority
 * of a listing portal"*.
 *
 * ## Why a validator rule and not a prompt change
 *
 * The prohibition already reaches the model. What was missing is the thing
 * §10.3 of `PLANNING_CONTROLS_IN_THE_REPORT.md` established for a different
 * rule and closed with rule 12: **a prompt rule cannot be proven without a
 * model run**, so the finished markdown has to be read. Rule 13 reads it.
 *
 * It REPORTS and never scrubs — prose is never regex-scrubbed, on read or on
 * write — and it is deliberately narrow, because a false caveat teaches people
 * to dismiss the warning.
 *
 * ## Why it matters more than one sentence
 *
 * `fork-investment-report` routes the parent's prose, so the measured defect
 * appears identically in the Compass, the Financial Analysis and the Due
 * Diligence. One bad sentence becomes three documents.
 */
import { describe, expect, it } from 'vitest';
import { runQAValidation } from '../compassQAValidator';

/** Every member of `QATier`, pinned to the source below. */
const QA_TIERS = ['compass-40', 'financial-analysis', 'briefing', 'snapshot', 'strategic'];

/** The sentence as it printed, verbatim from the rendered PDF's text layer. */
const MEASURED = 'Properties on Redfern Street repeatedly show established detached dwellings, '
  + 'off-street parking and standard residential zoning within Cowra Shire Council, with multiple '
  + 'nearby addresses on the street recording no bushfire, flood or heritage overlays on public '
  + 'mapping at the time they were last updated.[Property.com.au, 119, 120, 137 and 139 Redfern '
  + 'Street profiles, 2024–2026]';

const doc = (body: string) => `# Report\n\n## Executive Verdict\n\n${body}\n`;
const rules = (md: string) => runQAValidation(md, 'compass-40').findings.map((f) => f.rule);

const findingFor = (md: string, rule: string) =>
  runQAValidation(md, 'compass-40').findings.find((f) => f.rule === rule);

describe('a hazard clearance on a listing\'s authority is an ERROR', () => {
  it('catches the sentence that shipped', () => {
    const found = rules(doc(MEASURED));
    expect(found).toContain('portal-sourced-hazard-clearance');
    expect(findingFor(doc(MEASURED), 'portal-sourced-hazard-clearance')?.severity).toBe('error');
  });

  it('catches it on NEIGHBOURING listings with no portal named at all', () => {
    /*
     * The second noun in the measured sentence, and the one that survives if
     * the citation is dropped: "nearby addresses". A claim about a different
     * parcel is not a clearance for this one, whoever published it.
     */
    const found = rules(doc(
      'Several nearby properties record no flood or bushfire overlay on public mapping.',
    ));
    expect(found).toContain('portal-sourced-hazard-clearance');
  });

  it('names what is wrong and what the permitted form is', () => {
    const f = findingFor(doc(MEASURED), 'portal-sourced-hazard-clearance');
    expect(f?.message).toContain('not a planning authority');
    expect(f?.message).toContain('Checked and not mapped at this coordinate');
  });
});

describe('an ordinary portal citation is a WARNING, not a rejection', () => {
  it('a listing price sourced to the listing does not fail the document', () => {
    /*
     * The correction of 18 Sep 2026. A listing is the authoritative source for
     * the thing it IS — the asking price, the advertised configuration — and
     * rejecting it wholesale would strip a report of properly recorded
     * evidence for an identity fact.
     */
    const md = doc('The property is advertised at $555,000.[Property.com.au listing, 2026]');
    const f = findingFor(md, 'listing-portal-as-source');
    expect(f?.severity).toBe('warning');
    expect(runQAValidation(md, 'briefing').passed, 'a warning must not fail the document').toBe(true);
    expect(rules(md)).not.toContain('portal-sourced-hazard-clearance');
  });

  it('still discloses it, naming the portal and the count', () => {
    const f = findingFor(doc(MEASURED), 'listing-portal-as-source');
    expect(f?.message).toContain('property.com.au');
    expect(f?.message).toMatch(/1 inline citation/);
    expect(f?.message).toContain('authoritative for what it IS');
  });

  it('catches the other portals by name', () => {
    for (const portal of ['realestate.com.au', 'domain.com.au', 'allhomes.com.au', 'onthehouse.com.au']) {
      expect(rules(doc(`The street is quiet.[${portal} listings, 2026]`)), portal)
        .toContain('listing-portal-as-source');
    }
  });
});

describe('what it must NOT flag', () => {
  it('the permitted absence — a register that was asked and matched nothing', () => {
    // `checkedAndNotMapped`'s own wording, which names the register and carries
    // no citation bracket. This is the ONE absence the prose may repeat.
    const found = rules(doc(
      '**Checked and not mapped at this coordinate:** bushfire, flood, heritage. '
      + 'Each of these was asked of a register that answered, and no feature covers this point.',
    ));
    expect(found).not.toContain('listing-portal-as-source');
    expect(found).not.toContain('portal-sourced-hazard-clearance');
  });

  it('a register named as the source, in brackets', () => {
    const found = rules(doc(
      'The lot is within a bushfire-prone area.[NSW Rural Fire Service bushfire prone land map, 2026]',
    ));
    expect(found).not.toContain('listing-portal-as-source');
  });

  it('ordinary prose that merely mentions a hazard', () => {
    const found = rules(doc(
      'Bushfire and flood exposure are assessed in the planning section against the state registers.',
    ));
    expect(found).not.toContain('listing-portal-as-source');
    expect(found).not.toContain('portal-sourced-hazard-clearance');
  });

  it('a markdown link or a table cell is not a portal citation', () => {
    const found = rules(doc('| Source | Value |\n| --- | --- |\n| Council register | Residential |'));
    expect(found).not.toContain('listing-portal-as-source');
  });

  it('a clean document raises neither rule', () => {
    expect(rules(doc('The property is a detached house on a level lot.'))).toEqual(
      expect.not.arrayContaining(['listing-portal-as-source', 'portal-sourced-hazard-clearance']),
    );
  });
});

describe('both copies of the validator carry it', () => {
  it('the edge copy and the browser copy agree but for their imports', async () => {
    const { readFileSync } = await import('node:fs');
    const strip = (s: string) => s.replace(/from '(\.[^']*?)(\.ts)?';/g, "from '$1';")
      .replace(/reports\/investment\//g, 'investment/');
    const edge = strip(readFileSync('supabase/functions/_shared/compassQAValidator.ts', 'utf8'));
    const browser = strip(readFileSync('src/lib/reports/compassQAValidator.ts', 'utf8'));
    for (const marker of ['listing-portal-as-source', 'portal-sourced-hazard-clearance', 'NEIGHBOURING']) {
      expect(edge, `edge: ${marker}`).toContain(marker);
      expect(browser, `browser: ${marker}`).toContain(marker);
    }
  });
});

// ─── every path that produces a document reads it ─────────────────────────

describe('generation, fork and condensation all validate the assembled output', () => {
  const read = async (f: string) =>
    (await import('node:fs')).readFileSync(f, 'utf8');

  it('each of the three paths calls the validator', async () => {
    /*
     * The fork called it on NOTHING before 18 Sep 2026, which is how the
     * measured sentence reached three documents while only the first was
     * checked: the generator validates its finished markdown, the condenser
     * validates its composed document, and the fork — which routes the
     * parent's prose verbatim into two more client documents — validated
     * neither of them.
     */
    for (const fn of ['generate-investment-report', 'fork-investment-report',
      'condense-investment-report']) {
      const src = await read(`supabase/functions/${fn}/index.ts`);
      expect(src, fn).toContain('runQAValidation');
    }
  });

  it('the fork validates the COMPOSED markdown, at the CHILD\'s tier', async () => {
    const src = await read('supabase/functions/fork-investment-report/index.ts');
    // The document a client receives, not the parent's prose before routing —
    // and after the claim guard, so a surviving finding is a real one rather
    // than one the correction had already discharged.
    // `financial-analysis`, not `financial` — the fork first passed a string
    // that is not a member of `QATier` at all, and `deno check` caught it
    // where the repository's own `tsc` cannot look.
    expect(src).toContain("runQAValidation(financialMarkdown, 'financial-analysis')");
    expect(src).toContain("runQAValidation(strategicMarkdown, 'strategic')");
    // The markdown QA reads is the one BOTH corrections produced: the claim
    // guard first, then the chart-evidence contract. Pinned as the chain
    // rather than one literal assignment, because pinning the assignment is
    // what made this test fail when a second correction was added in front of
    // it — the rule is "validate what will be stored", not "assign it from
    // this exact expression".
    expect(src).toContain('enforceChartEvidence(financialClaims.markdown, forkEvidence)');
    expect(src).toContain('enforceChartEvidence(strategicClaims.markdown, forkEvidence)');
    expect(src).toContain('const financialMarkdown = financialEvidence.markdown;');
    expect(src).toContain('const strategicMarkdown = strategicEvidence.markdown;');
    // …and what is stored is the corrected copy, never the composed one.
    expect(src).toContain("'financial', 'financial', financialMarkdown, financialScore");
    expect(src).toContain("'due_diligence', 'strategic', strategicMarkdown, strategicScore");
    // A QA error reaches the child's own row and the caller's answer. Until
    // this, the fork ran the validator, logged the findings and returned
    // ok: true, so a child carrying a material error was indistinguishable
    // from a clean one at every downstream boundary.
    expect(src).toContain('validation_flags: qaFlagsFor(qa)');
    expect(src).toContain('client_ready: blockingFindings.length === 0');
    // Never the parent's tier: a Compass's page band and financial exclusion
    // asserted over a Financial Analysis is the defect `condenseCompose`
    // already records, and it produced sixteen errors on a correct document.
    expect(src).not.toContain("runQAValidation(financialMarkdown, 'compass");
    // And every tier the fork names is one the validator admits.
    const tiers = [...src.matchAll(/runQAValidation\([A-Za-z]+, '([a-z-]+)'\)/g)].map((m) => m[1]);
    expect(tiers.length).toBeGreaterThan(0);
    for (const t of tiers) expect(QA_TIERS, t).toContain(t);
  });

  it('QA_TIERS is the union, not a list that drifted from it', async () => {
    // A type union cannot be read at runtime, so the list above is pinned to
    // the declaration — which is how it stays true when a tier is added.
    const decl = (await read('supabase/functions/_shared/compassQAValidator.ts'))
      .match(/export type QATier = ([^;]+);/)![1];
    const declared = [...decl.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...QA_TIERS].sort());
  });

  it('the rules travel with the prose, so a routed section is judged again', () => {
    /*
     * The mechanism that made one sentence into three documents: the fork
     * routes the parent's prose into the child. So the same text, handed to
     * the validator at the child's tier, must raise the same finding — which
     * is what makes validating the child worth doing at all.
     */
    const routed = `# Due Diligence\n\n## Position Within the Locality\n\n${MEASURED}\n`;
    for (const tier of ['compass-40', 'financial-analysis', 'strategic', 'briefing', 'snapshot'] as const) {
      expect(runQAValidation(routed, tier).findings.map((f) => f.rule), tier)
        .toContain('portal-sourced-hazard-clearance');
    }
  });
});
