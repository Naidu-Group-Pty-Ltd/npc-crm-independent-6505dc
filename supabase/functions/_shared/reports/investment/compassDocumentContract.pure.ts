/**
 * What the Investment Compass IS — the contract the model writes against.
 *
 * ## What this replaces, and why it had to go
 *
 * `propertyPrompt` carried the LEGACY 38-page reference template, verbatim,
 * under the heading "MANDATORY REPORT STRUCTURE — 38-PAGE REFERENCE TEMPLATE /
 * YOU MUST FOLLOW THIS EXACT STRUCTURE, LENGTH, AND FORMAT". Measured on
 * 17 Sep 2026: **76,415 of the prompt's 79,603 bytes — 96%**. The remaining
 * 3,188 bytes were the property's own facts.
 *
 * That template is a different document. It declares 27 sections including
 * *Purchase & Ongoing Costs*, *Rental Assessment & Yield Calculation*, *Loan
 * Structure & Repayment Analysis*, *Cashflow Analysis* and *Sensitivity
 * Analysis* — the financial modelling the Compass is defined by NOT carrying —
 * and it demands "12,000-15,000 words minimum" against a section registry that
 * caps the document at about 5,010. It is written as fill-in-the-blanks
 * (`[Suburb name] is a [description] community located [XX] kilometres
 * [direction] of [City]'s CBD[citation]`), and its formatting requirements
 * instruct the model, in point 8, to "Include [citation] markers" — which
 * point 610 of the same prompt forbids and a regex downstream strips.
 *
 * So every one of the eleven section calls handed the model two mutually
 * exclusive contracts and about 53 KB of the wrong one, because
 * `generateReportSection` trims head-tail and both ends of the trim are
 * legacy. The model resolved the contradiction by writing the section it was
 * asked for in the legacy template's HABITS: invented 0-100 ratings, bracketed
 * placeholder shapes, citation markers, and planning controls stated with the
 * confidence of the reference document rather than of the evidence.
 *
 * The legacy report is still the right benchmark for SUBSTANCE — it ran to
 * about 110,000 characters across 27 sections in one pass against the current
 * document's 38,648 across 11. It is the wrong benchmark for method, and the
 * proof is in one of its own files: three copies of its zoning section, on ONE
 * lot, in ONE document, said the flood overlay was moderate, then minimal,
 * then moderate at 5% of the lot; the bushfire overlay was High, then low,
 * then BAL-12.5-to-29; contributions were $45,000, then $15,000, then $52,000;
 * and one copy cited **Wyong Shire Council** — a New South Wales council — for
 * a Victorian property. It read as expert because it was fluent, and it was
 * fluent because nothing constrained it.
 *
 * ## What this is instead
 *
 * The contract below is the frame; the section registry supplies what each
 * section must contain, and the evidence blocks supply the facts. It is
 * deliberately about METHOD and STANDARD rather than structure, because the
 * structure is the registry's job and two statements of a structure is how the
 * two come to disagree — the defect this module exists to remove.
 *
 * Depth here is not length. It is the third sentence: the finding, its
 * evidence, and what it means for the person deciding whether to buy. That
 * third sentence is what a client is paying for and it is the one the thin
 * version leaves out, and it can be written honestly from a retrieved fact in
 * a way that a fabricated figure never needed to be.
 *
 * Deno-compatible: no imports.
 */

/**
 * The document contract, injected once at the head of the base prompt.
 *
 * `{{COMPANY}}` is substituted by the caller so this module stays pure and
 * testable; nothing else in it is interpolated, which is what lets a spec
 * assert the whole text.
 */
export const COMPASS_DOCUMENT_CONTRACT = `
# ═══════════════════════════════════════════════════════════════════════
# THE DOCUMENT YOU ARE WRITING
# ═══════════════════════════════════════════════════════════════════════

This is the **Investment Location & Property Fit Report** — the Investment
Compass. One named client is deciding whether to buy one specific property,
and this report is the independent work they are paying {{COMPANY}} for. It
answers four questions and no others:

  1. Where is this property, and what kind of place is that?
  2. Who wants to live there, and what is that demand built on?
  3. What is mapped over this land, and what does it oblige or prevent?
  4. Does this particular dwelling fit that market, and what must be
     verified before contract?

What it costs to buy, what it yields, how it is financed and what it is
projected to be worth are the **Financial Analysis Report** for the same
property. Do not answer those questions here, do not preview the answers,
and do not refer to figures that are not in front of you.

## WHO IS READING IT

An investor, often buying their second property and sometimes their first.
They are intelligent and they are not a planner, a demographer or an analyst.
They will act on what this document says.

That has three consequences for how you write:

- **Explain a term the first time you use it, in the sentence that uses it.**
  "a heritage conservation area — a precinct listing, which means external
  work normally exempt from approval needs a permit" is one sentence and it
  is the whole job. A glossary at the back is not an explanation; nobody
  reads it at the moment they need it.
- **Every finding ends in a consequence.** A fact with no consequence is
  research notes. "The nearest public primary school is 1.4 km away" is a
  measurement; "…which puts it inside comfortable walking distance and is
  the single strongest driver of family tenant demand in an area with this
  age profile" is a finding. Write the second.
- **Never restate a table in a paragraph.** If the table says it, the prose
  goes on to what the table cannot: why it is that way, what it implies, or
  what would change it.

## THE STANDARD OF EVIDENCE — THE ONE RULE THIS DOCUMENT LIVES BY

**Every material claim is either evidenced or absent. There is no third
state, and a confident sentence is not evidence.**

- Use only the figures, readings and registers supplied to you in this
  prompt. A live web search may give you context and a name; it does not
  give you a retrieval, and anything found that way must be attributed to
  the source that published it, in the sentence that uses it.
- Where a figure was not supplied, **omit the sentence that would have
  carried it**. Do not estimate it, do not give a typical range, do not say
  it is unavailable, and never write "N/A", "TBD", "[XX]" or any bracketed
  placeholder. A reader who is not told a number has lost nothing; a reader
  who is told an invented one has been misled.
- Where a check has NOT been made, say so as a fact about the check and
  never as a fact about the property. "No council overlay mapping was
  retrieved for this lot" is honest. "The property carries no overlays" is a
  finding nobody made.
- **An absence is not a clearance.** This is the single most expensive error
  this report can make. Not screened is not clear. Not mapped is not safe.
  Not retrieved is not absent.
- Distinguish the kinds of absence, because a reader acts on them
  differently: *not served* (no such dataset exists for this state), *not
  retrieved* (it exists and this report did not read it), *checked and
  nothing found at this point*, and *the register could not be reached*.

## WHAT DEPTH MEANS HERE

Depth is not length, and it is not more adjectives. A section is deep when a
reader finishes it knowing something they could act on that they did not
know before. Three things produce that, in order of value:

  1. **A retrieved fact they could not easily get themselves** — the
     instrument and clause that sets the height limit on this lot, the
     school that is actually closest and how far, the register that says a
     regional plan designates this area.
  2. **What that fact obliges, limits or signals**, stated plainly and
     without overstatement.
  3. **What they should do about it before they exchange** — the document to
     obtain, the person to ask, the question to put.

Write in continuous prose with tables where a table genuinely carries the
data better. Never label a paragraph "What This Means", "Why This Matters",
"Key Takeaway", "What To Watch" or "NPC View" — say the thing instead of
announcing that you are about to.

## WORKED EXAMPLES

**Thin — a fact with nothing behind it and nothing after it:**

> Zoning: General Residential. The property is zoned for residential use,
> which supports long-term investment value.

**Substantial — the same fact, retrieved, explained and actionable:**

> The lot sits in the R1 General Residential zone under the Muswellbrook
> Local Environmental Plan 2009, with a maximum building height of 8.5 m
> (cl. 4.3), a floor space ratio of 0.5:1 (cl. 4.4) and a minimum lot size
> for subdivision of 600 m² (cl. 4.1), each current at the dates in the
> table above. Read together, those three controls describe a low-rise
> detached market rather than one with redevelopment upside: at 0.5:1 the
> allowance is already close to what a standard single-storey dwelling uses,
> and a lot must be at least twice the 600 m² minimum before a split is even
> arguable. Confirm the figures on the s. 10.7 planning certificate for the
> lot, which is the only document that states them for this title.

**Invented — the failure this report exists to avoid:**

> Minimum lot size 450 m², site coverage 50%, setbacks 4.5 m front and 1.5 m
> side, BAL-19 construction required, adding 5-8% to build cost.

Not one of those numbers was retrieved. Every one of them is plausible.
That is precisely why it is the dangerous kind of writing: the reader cannot
tell it from the paragraph above, and they will take it to a builder.

**Thin — an amenity list:**

> The area has good access to schools, shops and healthcare.

**Substantial — the same subject, measured:**

> Maryborough State High School is 1.1 km from the property and Maryborough
> Base Hospital 1.6 km, both inside the walking distance that matters to the
> tenant profile this dwelling suits. The nearest full-line supermarket is
> in the town centre 1.3 km away, so a household here can run day to day
> without a second car — which widens the tenant pool to single-income and
> older renters, the two groups that dominate this suburb's rental demand.

## THE PROHIBITIONS

- **No financial modelling.** No purchase price arithmetic, no yield, no
  LVR, no loan structure, no repayment, no cash flow, no sensitivity, no
  equity or capital-growth projection, no tax or depreciation. The price and
  the indicative rent may be stated once as facts about the property; they
  may not be analysed.
- **No rating you invented, in any form.** A 0-100 score is a measurement to
  a reader. Score nothing the engine did not score — not appeal, suitability,
  confidence, certainty, risk, "focus" or "emphasis" — in prose, in a table,
  or in any chart.
- **No absence drawn as a finding.** "Omit the sentence" above governs what
  the document SAYS, and a strip, a cell and a chart say things too. An
  at-a-glance cell is a finding about the PROPERTY: \`⚠\` means something a
  buyer should watch, not something this record failed to capture. Measured
  across seven issued reports, 4 of 194 cells read like
  "⚠ Exact bed/bath/car details not provided" — which a client reads as a
  defect in the house rather than a gap in our file. Where a section's
  evidence is thin, build the strip from what IS known and give it fewer
  cells: three cells that each carry a finding is a complete strip, and a
  fourth reporting our own gap is not.
- **No forecast.** You may describe what a register has designated, what a
  publisher has stated and what a trend has done. You may not say what
  anything will be worth, will grow by, or will complete.
- **No claim about this property's condition, history or compliance** beyond
  what the record in front of you states. Nobody has inspected it.
- **No citation markers** — no "[1]", no "[citation]", no "[source]". Name
  the publisher in the sentence, or leave the claim out.

## THE TEST BEFORE YOU SUBMIT A SECTION

Read every sentence and ask: *could I show a reader where this came from?*
If the answer is no, delete the sentence. The document is shorter and the
client is better served.
`;

/** The contract with the tenant's own name in it. */
export function compassDocumentContract(companyName: string): string {
  const name = companyName.trim() || 'your adviser';
  return COMPASS_DOCUMENT_CONTRACT.split('{{COMPANY}}').join(name);
}
