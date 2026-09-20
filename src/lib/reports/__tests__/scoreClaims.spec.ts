/**
 * QA-18 — a summarising report may not invent or re-estimate a score.
 *
 * The Briefing of 291 Stone Mason Drive rated an "overall investment fit"
 * 68/100 and gave two "scores of 82" that appear nowhere in the record or
 * in the parent document. These pin the guard that removes such claims.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  findScoreClaims,
  recordedScoreValues,
  sentencesOf,
  suppressUnrecordedScores,
  suppressUnrecordedVerdictVisuals,
} from '@/lib/reports/investment/scoreClaims.pure';

const STONE_MASON_SCORE = {
  totalScore: 39,
  grade: 'D',
  breakdown: {
    yieldScore: { score: 30, weight: 33, available: true },
    riskScore: { score: 75, weight: 11, available: true },
    locationScore: { score: 58, weight: 56, available: true },
    // Excluded dimensions carry a placeholder 50 that is not a score.
    growthScore: { score: 50, weight: 0, excluded: true, available: false },
    demandScore: { score: 50, weight: 0, hasData: false },
  },
};

describe('findScoreClaims', () => {
  it('recognises the forms the corpus uses', () => {
    const text = 'Overall fit is rated 68/100. The property has a Metro-linked accessibility score of 82. '
      + 'It scored 75 on risk and is 58 out of 100 for location.';
    expect(findScoreClaims(text).map((c) => c.value)).toEqual([68, 82, 75, 58]);
  });

  it('does not read a percentage, a distance or a price as a score', () => {
    expect(findScoreClaims('Gross yield of 3.6% and a rating of 95% occupancy; 2 km; score of 1,299,000')).toEqual([]);
  });
});

describe('recordedScoreValues', () => {
  it('holds the total and the scored dimensions, never an excluded placeholder', () => {
    expect(recordedScoreValues(STONE_MASON_SCORE).sort((a, b) => a - b)).toEqual([30, 39, 58, 75]);
  });
  it('is empty for no record', () => {
    expect(recordedScoreValues(null)).toEqual([]);
    expect(recordedScoreValues('x')).toEqual([]);
  });
});

describe('suppressUnrecordedScores', () => {
  const recorded = recordedScoreValues(STONE_MASON_SCORE);

  it('removes the sentence that carries an invented score and keeps the rest', () => {
    const md = [
      '## Executive Verdict',
      '',
      'Kellyville is a family suburb with metro access. Overall investment fit is rated 68/100, indicating strong potential. The record grades it D at 39/100.',
      '',
      '- Metro access: the property has a Metro-linked accessibility score of 82.',
      '- Schools: strong government options in the catchment.',
    ].join('\n');
    const { markdown, removed } = suppressUnrecordedScores(md, { recorded });
    expect(markdown).toContain('Kellyville is a family suburb with metro access. The record grades it D at 39/100.');
    expect(markdown).not.toContain('68/100');
    expect(markdown).not.toContain('score of 82');
    expect(markdown).toContain('- Schools: strong government options in the catchment.');
    expect(removed.map((r) => r.value)).toEqual([68, 82]);
  });

  it('keeps a claim the parent document made itself', () => {
    const md = 'The walk score of 62/100 supports car-light living.';
    const parent = 'Walk Score: 62/100 (Somewhat Walkable), measured for the address.';
    expect(suppressUnrecordedScores(md, { recorded, parentText: parent }).markdown).toBe(md);
  });

  it('never edits a table, a directive or a heading', () => {
    const md = [
      '## Score 88/100 Overview',
      '| Dimension | Weight | Score |',
      '| --- | --- | --- |',
      '| Fit | 10% | 88/100 |',
      '{{gauge: 88 | max=100 | label=Fit}}',
    ].join('\n');
    const { markdown, removed } = suppressUnrecordedScores(md, { recorded });
    expect(markdown).toBe(md);
    expect(removed).toEqual([]);
  });

  it('drops a bullet whose only sentence was the claim', () => {
    const md = 'Intro.\n\n- Suburb fit score of 82 for commuter families.\n- Kept.\n';
    const { markdown } = suppressUnrecordedScores(md, { recorded });
    expect(markdown).toBe('Intro.\n\n- Kept.\n');
  });
});

describe('a dial the record cannot back', () => {
  /*
   * 262 Pallas Street, regenerated 17 Sep 2026 on a record that issues no
   * grade. The prose guard above skips any line beginning `{{`, because a
   * directive was assumed to be composed from recorded numbers. Two of these
   * primitives are written by the MODEL:
   *
   *   {{gauge: 85 | Land Appeal | Large block relative to typical suburban lots}}
   *   {{gauge: 82 | Large-block lifestyle appeal | …}}
   *   {{wheel: 25,45,30,40,35 | labels=Environmental,Crime,Planning & overlays,…}}
   *
   * A gauge over 100 draws a verdict band, so "85 · STRONG" reached the page
   * as a measurement of somebody's property.
   */
  const doc = [
    'The land is large for the street.',
    '{{gauge: 85 | Land Appeal | Large block relative to typical suburban lots}}',
    '',
    '{{gauge: 78 | Investment Score | Weighted composite}}',
    '{{wheel: 25,45,30,40,35 | labels=Environmental,Crime,Planning,Supply,Transport | max=100}}',
    '{{bars: Health Care 18.3, Retail 10.4 | max=20 | unit=%}}',
    '{{pictograph: 7/10 | label=Family-oriented appeal}}',
    'Closing line.',
  ].join('\n');

  it('drops a gauge and a wheel the record does not hold, and keeps the one it does', () => {
    const r = suppressUnrecordedVerdictVisuals(doc, { recorded: [78] });
    expect(r.markdown).toContain('{{gauge: 78 | Investment Score | Weighted composite}}');
    expect(r.markdown).not.toContain('Land Appeal');
    expect(r.markdown).not.toContain('{{wheel:');
    expect(r.removed.map((x) => x.kind)).toEqual(['gauge', 'wheel']);
    expect(r.removed[1].values).toEqual([25, 45, 30, 40, 35]);
  });

  it('leaves the data primitives alone', () => {
    // Dropping these on a number-match takes measured series off the page.
    const r = suppressUnrecordedVerdictVisuals(doc, { recorded: [78] });
    expect(r.markdown).toContain('{{bars: Health Care 18.3');
    expect(r.markdown).toContain('{{pictograph: 7/10');
  });

  it('reads the value and never the label, the caption or an option', () => {
    // `max=100` and "seven in ten" are not assertions about a score.
    const kept = suppressUnrecordedVerdictVisuals(
      '{{gauge: 61/100 | Confidence 85 | Around 100 households | max=100}}',
      { recorded: [61] },
    );
    expect(kept.removed).toEqual([]);
    const gone = suppressUnrecordedVerdictVisuals(
      '{{gauge: 61/100 | Confidence | max=100}}',
      { recorded: [85] },
    );
    expect(gone.removed).toHaveLength(1);
    expect(gone.markdown.trim()).toBe('');
  });

  it('leaves a directive with no readable number to another control', () => {
    const r = suppressUnrecordedVerdictVisuals('{{gauge: n/a | Something}}', { recorded: [] });
    expect(r.removed).toEqual([]);
    expect(r.markdown).toContain('{{gauge: n/a');
  });
});

describe('an instruction never occupies a value slot', () => {
  /*
   * The same regeneration printed this, in its own prose, as the property's
   * recorded attribute:
   *
   *   The property type is recorded as **"Not stated in the record — if the
   *   property documents name the dwelling type, use that exact type in every
   *   section, never write 'Residential Property'"**…
   *
   * `propertyTypeLabel` WAS that instruction when nothing resolved, and it was
   * interpolated into `| Property Type | … |` cells and a `- Property Type: …`
   * line. A model handed a value quotes it back.
   */
  const generator = readFileSync('supabase/functions/generate-investment-report/index.ts', 'utf8');

  it('leaves the slot empty and puts the instruction in the rules', () => {
    expect(generator).toMatch(/const propertyTypeLabel = resolvedPropertyType \?\? '';/);
    expect(generator).toMatch(/const propertyTypeRule = resolvedPropertyType/);
    // Every interpolation of the label into a cell or a line is guarded: the
    // raw form and the guarded form occur the same number of times, so none is
    // left bare.
    const rawRow = /\| Property Type \| \$\{propertyTypeLabel\} \|/g;
    const guardedRow = /\$\{propertyTypeLabel \? `\| Property Type \| \$\{propertyTypeLabel\} \|` : ''\}/g;
    expect([...generator.matchAll(rawRow)]).toHaveLength([...generator.matchAll(guardedRow)].length);
    expect([...generator.matchAll(guardedRow)].length).toBeGreaterThan(0);
    // The rule generalised past the two cells above, because the block that
    // carried `- Property Type: …` has since been removed with the rest of the
    // legacy template: EVERY interpolation of the label is inside a ternary
    // that tests it. A bare `${propertyTypeLabel}` anywhere prints an empty
    // value slot when nothing resolved, which is the defect this pins.
    for (const line of generator.split('\n')) {
      if (!line.includes('${propertyTypeLabel}')) continue;
      expect(line, 'an unguarded interpolation would print an empty value slot')
        .toMatch(/propertyTypeLabel \?/);
    }
    expect(generator, 'an unguarded line would print an empty value slot')
      .not.toMatch(/^- Property Type: \$\{propertyTypeLabel\}$/m);
  });

  it('tells the prompt the type the record holds', () => {
    /*
     * `rawPropertyType` read `propertyDetails?.propertyType` alone. Every
     * Compass report is finished by the resume worker, which calls back with
     * `{reportId, propertyAddress, continueFrom}` and no `propertyDetails` — so
     * on the run that writes the document this was always ''. On 262 Pallas
     * Street the operator had recorded `propertyType: 'house'`, page 3 of the
     * PDF printed it from `property_specs`, and the model was told it was not
     * stated. `sourcePropertyType` is the one answer this module resolves.
     */
    expect(generator).not.toMatch(/const rawPropertyType = propertyDetails\?\.propertyType\?\.toLowerCase\(\)/);
    expect(generator).toMatch(/const rawPropertyType = \(typeof sourcePropertyType === 'string' \? sourcePropertyType : ''\)\.toLowerCase\(\);/);
    // And it is resolved before it is read.
    expect(generator.indexOf('const sourcePropertyType =')).toBeLessThan(generator.indexOf('const rawPropertyType ='));
  });

  it('stops the rent table printing an "X-Bed" placeholder', () => {
    expect(generator, 'X-Bed reached the page beside an instruction-shaped type')
      .not.toContain("${effectiveBeds || 'X'}-Bed");
  });

  it('stops the prompt asking for a rating nobody scored', () => {
    // "Affordability, Suitability, Confidence … MUST use {{gauge}}" is what
    // produced `{{gauge: 85 | Land Appeal}}`.
    expect(generator).not.toMatch(/Investment Score, Affordability, Risk, Suitability, Confidence, and similar 0-100 ratings MUST use/);
    expect(generator).toMatch(/Do NOT mint a rating for appeal, suitability, confidence, affordability/);
  });
});

describe('a rating you invented may not be drawn, in any primitive', () => {
  /*
   * The first version of this guard named `gauge` and `wheel`, because those
   * were the two the prompt asked for. The model obeyed it and put the SAME
   * invented ratings into `{{bars}}` and `{{heatmap}}` — pages 9, 15, 16 and 20
   * of the 17 Sep 2026 regeneration of 262 Pallas Street. The rule had been
   * written about a PRIMITIVE when it needed to be written about a CLAIM, and
   * a rule about a primitive is one the next primitive walks around.
   *
   * The prompt contradicted itself too: "Do NOT mint a rating … the same holds
   * for every number in a {{wheel}}" and, two lines later, "Any list of 3+
   * ranked metrics MUST be rendered as {{bars: …}}". The model resolved the
   * contradiction the way the MUST told it to.
   *
   * Every fixture below is a production directive, verbatim.
   */
  const recorded = [63, 70, 55];

  it('removes the bars the Compass actually drew', () => {
    const md = [
      'Some prose about the property.',
      '',
      '{{bars: Character appeal 80, Land size and outdoor potential 85, Everyday amenity access 75, '
        + 'Tenant demand depth 70, Planning / overlay certainty 55 | title=262 Pallas Street · Non‑financial positioning | max=100 | unit=%}}',
      '',
      'More prose.',
    ].join('\n');
    const r = suppressUnrecordedVerdictVisuals(md, { recorded });
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0].kind).toBe('bars');
    // 70 and 55 ARE recorded; 80, 85 and 75 are not, and one unrecorded value
    // condemns the chart — a bar chart is read as one measurement.
    expect(r.removed[0].values).toEqual([80, 85, 75]);
    expect(r.markdown).not.toContain('Character appeal');
    expect(r.markdown).toContain('Some prose about the property.');
    expect(r.markdown).toContain('More prose.');
  });

  it('removes a locality ranking nothing scored', () => {
    const md = '{{bars: 48 Redfern Street – commute-light town block 88, Central Cowra – core town blocks 92, '
      + 'Rural fringe around Cowra – car-reliant holdings 55 | title=Relative appeal | max=100}}';
    expect(suppressUnrecordedVerdictVisuals(md, { recorded }).removed).toHaveLength(1);
  });

  /*
   * Page 15 of the Cowra Compass drew "Relative positioning within regional
   * residential markets" — 7.5, 8.0 and 6.5 out of ten, for a property, a
   * town and a region, on a record that issued no grade. §2 of the acceptance
   * standard names that chart by its numbers. It survived because the rule
   * read `max=100` and nothing else, so a scorecard spelled out of TEN was a
   * "measurement".
   */
  it('removes a scorecard spelled out of ten, not only out of a hundred', () => {
    const md = '{{bars: Subject property – central Cowra-style block 988 m² 7.5, '
      + 'Cowra housing market – established houses on similar lots 8.0, '
      + 'Broader Central Tablelands regional towns – mixed housing stock 6.5 '
      + '| title=Relative positioning within regional residential markets | max=10 | unit=/10}}';
    const r = suppressUnrecordedVerdictVisuals(md, { recorded });
    expect(r.removed).toHaveLength(1);
    // `ratingValues` rounds, which is why the scale is what decides: on a
    // 0-10 scale nothing the engine recorded can be one of these values, so a
    // recorded 8 must not "support" a 7.5 by a coincidence of digits.
    expect(r.removed[0].values).toEqual([8, 8, 7]);
    expect(suppressUnrecordedVerdictVisuals(md, { recorded: [8, 7] }).removed).toHaveLength(1);
    expect(r.markdown).not.toContain('Relative positioning');
  });

  it('reads the UNIT and not the maximum, so a short distance axis is left alone', () => {
    // `max` is a chart's axis. A proximity chart legitimately declares max=3
    // or max=5, and condemning it for that would take a real measurement off
    // the page for the shape of its axis.
    const md = '{{bars: Core CBD 1.6 km, School 0.7 km, Hospital 2.0 km | title=Proximity | max=3 | unit=km}}';
    expect(suppressUnrecordedVerdictVisuals(md, { recorded }).removed).toEqual([]);
  });

  it('leaves a measured series alone, because it declares no rating scale', () => {
    /*
     * Measured over the 611 bars the generator produced in the 60 days to
     * 17 Sep 2026: 383 declare `max=100` and 228 do not. Every one of the 25
     * most frequent titles among the 383 is a minted rating — "Market depth &
     * cycle risk", "Risk focus areas (higher = more attention needed)",
     * "Planning certainty snapshot", "Property lifestyle fit (0–100)". A real
     * measurement does not announce that it is scored out of a hundred.
     */
    const md = '{{bars: Subject $565,000, Suburb median $498,000, Regional median $451,000 | title=Price against the market}}';
    const r = suppressUnrecordedVerdictVisuals(md, { recorded });
    expect(r.removed).toEqual([]);
    expect(r.markdown).toContain('Suburb median');
  });

  it('leaves a percentage series alone', () => {
    const md = '{{bars: Owner-occupied 61, Renting 31, Other 8 | title=Tenure mix | unit=%}}';
    expect(suppressUnrecordedVerdictVisuals(md, { recorded }).removed).toEqual([]);
  });

  it('reads a label that itself ends in a number', () => {
    // "Stage 2" is a label, not a value. Scanning the item for digits would
    // read the 2 and condemn a chart for a number nobody asserted.
    const md = '{{bars: Stage 2 release 40, Stage 3 release 60 | title=X | max=100}}';
    const r = suppressUnrecordedVerdictVisuals(md, { recorded });
    expect(r.removed[0].values).toEqual([40, 60]);
  });

  it('removes a heatmap of scores and keeps one of measurements', () => {
    const scored = '{{heatmap: 80,75 / 60,55 | rows=Appeal,Risk | cols=Subject,Suburb | title=X | max=100}}';
    expect(suppressUnrecordedVerdictVisuals(scored, { recorded }).removed).toHaveLength(1);
    const measured = '{{heatmap: 0.55,0.52,0.58 / 0.49,0.51,0.53 | rows=Income,Education '
      + '| cols=Cooloola Cove,State avg,Nearby coastal | title=Relative socioeconomic positioning (0–1 scale)}}';
    expect(suppressUnrecordedVerdictVisuals(measured, { recorded }).removed).toEqual([]);
  });

  it('still judges every number in a gauge and a wheel, declared scale or not', () => {
    // These two are rating primitives by construction, so the `max=100`
    // condition must not become a way around them.
    expect(suppressUnrecordedVerdictVisuals('{{gauge: 82}}', { recorded }).removed).toHaveLength(1);
    expect(suppressUnrecordedVerdictVisuals('{{wheel: 88, 74}}', { recorded }).removed).toHaveLength(1);
    expect(suppressUnrecordedVerdictVisuals('{{gauge: 63/100 | label=Investment score}}', { recorded }).removed).toEqual([]);
  });

  it('the prompt no longer tells the model to draw the thing it just forbade', () => {
    const gen = readFileSync('supabase/functions/generate-investment-report/index.ts', 'utf8');
    const rules = gen.slice(gen.indexOf('VISUAL-FIRST RULES'), gen.indexOf('const textEncoder'));
    expect(rules).toMatch(/A RATING YOU INVENTED MAY NOT BE DRAWN, IN ANY PRIMITIVE/);
    // The rule lives inside a template literal, so its code markers arrive as
    // an escaped backtick pair. Reading the text with the markers stripped is
    // what keeps this assertion about the RULE rather than about escaping.
    const plain = rules.replace(/\\`/g, '');
    expect(plain).toContain('do NOT write max=100 on a chart whose numbers you chose');
    // The bars instruction is what the model routed through. It must now
    // exclude a ranking the model is making up.
    const bars = rules.slice(rules.indexOf('Any list of 3+ ranked metrics'));
    expect(bars.slice(0, 400)).toMatch(/MEASURED quantities/);
    expect(bars.slice(0, 400)).toMatch(/not a set of metrics/);
  });
});

describe('the sentence splitter is total, and a citation stays with its claim', () => {
  /*
   * Found while building the claim corrector, 18 Sep 2026.
   *
   * `sentencesOf` was `text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)`, which
   * requires every part to end at a terminator FOLLOWED BY WHITESPACE. The
   * generator's prose puts its citation immediately after the stop with no
   * space — "…last updated.[Property.com.au, 119, 120, …]" — so that stop
   * satisfied neither alternative, the engine walked the start position
   * forward, and the text in between was silently DROPPED: the real Redfern
   * Street paragraph came back as two parts whose second began mid-domain, at
   * "au, 119, …".
   *
   * Every caller rebuilds the line with `kept.join(' ')`, so on a paragraph
   * that happened to carry an unrecorded score claim the guard would have
   * deleted a sentence and a half nothing had decided to remove — a
   * blanket removal wearing a sentence-level rule's clothes.
   */
  const MEASURED =
    'The lot is 612 square metres and falls gently to the rear. The subject site sits within an '
    + 'established residential pocket, with multiple nearby addresses on the street recording no '
    + 'bushfire, flood or heritage overlays on public mapping at the time they were last '
    + 'updated.[Property.com.au, 119, 120, 137 and 139 Redfern Street profiles, 2024-2026] '
    + 'A parcel-level check of the State hazard registers is listed in the due diligence schedule.';

  it('loses no character of the input', () => {
    const parts = sentencesOf(MEASURED);
    expect(parts.join(' ')).toBe(MEASURED);
  });

  it('cuts at the stop that a citation follows, keeping the citation with its sentence', () => {
    const parts = sentencesOf(MEASURED);
    expect(parts).toHaveLength(3);
    expect(parts[1].endsWith('2024-2026]')).toBe(true);
    expect(parts[2]).toBe('A parcel-level check of the State hazard registers is listed in the '
      + 'due diligence schedule.');
  });

  it('so a score guard on such a paragraph removes the claim and nothing else', () => {
    const line = 'Growth is supported by three registers. The suburb rates 82/100 for commuter '
      + 'appeal.[Property.com.au suburb profile, 2026] Median rent is $640 a week.';
    const { markdown, removed } = suppressUnrecordedScores(line, { recorded: [39] });
    expect(removed).toHaveLength(1);
    expect(markdown).toBe('Growth is supported by three registers. Median rent is $640 a week.');
  });

  it('a paragraph with no terminator at all comes back whole', () => {
    expect(sentencesOf('An unterminated fragment')).toEqual(['An unterminated fragment']);
  });
});
