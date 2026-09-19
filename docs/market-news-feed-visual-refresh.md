# Market News Feed — premium visual grammar

Merged in PR #1879. This note records the visual system so future changes keep
its rules, and exists in its own right because the feed's look now encodes
meaning that a maintainer could silently break.

## The grammar

- **Impact rail.** Every feed card carries a 3px left rail whose colour *is*
  the impact level (`IMPACT_RAIL` in `src/pages/MarketUpdates.tsx`):
  critical/high → destructive, medium → warning, low → neutral. The rail is
  information, not decoration — removing it removes the feed's scannable
  weight axis.
- **Lead story.** The first card gets front-page treatment (gold rail, gold
  "Lead story" eyebrow, larger headline) **only when it is breaking or
  critical/high impact**. Nothing is reordered; a routine first card means no
  lead today. Do not make the treatment unconditional — scarcity is what makes
  it read as consequential.
- **One aurora per screen.** The page hero is the only aurora on the page; the
  Ask Aurixa dialog (its own screen when open) carries the only other one. The
  aurora exclusively means Aurixa/AI.
- **Gold is rationed.** The gold rail appears on exactly two units: the digest
  (the desk's distilled product) and the lead story. A third use dilutes both.
- **Eyebrow signature.** Section labels are 0.18em-tracked uppercase over
  tight-tracked titles — the NPC typographic signature. KPI values are large
  tabular numerals at 600.
- **Relative timestamps.** Provenance lines read "42m ago" (`relTime`), full
  date in the tooltip. Recency is presented as currency.
- **Motion.** 120/200/320ms on `--motion-ease-out`; hover lifts, press scales;
  everything collapses under `prefers-reduced-motion`.

## Contracts

- `src/components/market-updates/marketUpdatesPremiumUi.test.tsx` pins the
  grammar: hero signature, KPI tiles, the rail on every card, the
  lead-only-when-consequential rule, relative timestamps.
- `marketUpdatesUi.contract.test.ts` still asserts the literal
  `>Market News Feed</h1>` — the hero h1 must stay inline in the page, not a
  primitive's title prop.
- Semantic tokens only; `npm run audit:style` must stay at main's counts.

## Operational note — Lovable publish sync

The GitHub → Lovable sync ingests pushes to `main`. The push event for the
PR #1879 merge was missed by the integration (Lovable's edit stream recorded
the merges immediately before and after it, but not `bc044c2`), which left the
Lovable editor one merge behind `main` and its publish dialog showing nothing
new. Any subsequent merge to `main` re-syncs the full branch state and carries
the missed content with it — which is what the PR introducing this file is
for. If the symptom recurs, the same remedy applies: land any commit on
`main`, or open the Lovable editor and trigger a manual sync, then publish.
