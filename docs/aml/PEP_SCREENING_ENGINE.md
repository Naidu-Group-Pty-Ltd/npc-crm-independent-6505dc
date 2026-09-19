# The PEP screening engine

Read this before touching `_shared/aml/pepScreeningEngine.pure.ts`, the
`run_pep_screening` / `review_pep_screening_candidate` operations,
`PepScreeningRunPanel`, or `pepSearchLinks.pure.ts`.

It sits between two documents that decide what it may say:
[`PEP_DETERMINATION_EVIDENCE.md`](./PEP_DETERMINATION_EVIDENCE.md) (what a
determination must rest on) and
[`PEP_OFFICEHOLDER_INDEX.md`](./PEP_OFFICEHOLDER_INDEX.md) (the register it
searches).

## What it replaces

Five browser tabs. An operator determining political exposure opened the
Government Directory, Parliament, ABN Lookup and two search engines, typed the
name into each, and wrote down what they remembered.

Two of those were wrong in ways nobody could see from inside the product:

- **The Government Directory link was broken.** It pointed at
  `/search/node?keys=…`, a Drupal 7 path the site no longer serves, so the most
  authoritative source on the list answered **"Page not found"** every time.
  The site's own search is `/search?keywords=…&op=Search`.
- **Two of the five rows were DuckDuckGo**, sitting beside DFAT and Parliament
  as though they were peers. A screening that rests on a search engine rests on
  whatever it returned that morning.

## The line this must never cross

**It screens. It does not determine.**

An automated search that finds nothing has established nothing about the
person. It searched some registers and not others; it cannot see a foreign
office it does not hold, a family relationship nobody publishes, or a name
spelled differently in the source. So:

- the verdict vocabulary — `indicators_found`, `no_indicators`, `incomplete`,
  `not_searchable` — **shares no value** with `pep_determinations.result`.
  There is no `clear`, no `not_pep`, no `pass`. A test asserts the two sets are
  disjoint, and `check-aml-screening-boundary.mjs` asserts it again against the
  source;
- `no_indicators` is drawn **neutrally** — no tick, no success tone — and its
  sentence says it is *"a result about the search, not about the person"*;
- a register that **failed** is reported as failed, never as empty. The
  difference between "looked and found nothing" and "could not look" is the
  whole reliability of the result;
- anything unreached forces `requiresManualReview`, and so does an **unanswered
  declaration** — no register here publishes family members or close
  associates, so asking the customer is the only route to them;
- `run_pep_screening` writes to `pep_screening_runs` and stamps the case event
  `determination_recorded: false`. It cannot write a determination; a test and
  the security gate both assert it.

## Why every source is local

Measured, not assumed:

| | |
| --- | --- |
| Wikidata action API | **429** on the first call from this deployment's egress |
| Wikidata SPARQL, worldwide office walk | **504** — could not finish in 60s |
| `directory.gov.au` | **403** to a scripted client on every path tried |
| `aph.gov.au` | **403** — the same WAF behaviour DFAT's list has |

A compliance decision cannot depend on a third party's rate limiter. So the
registers are loaded on a schedule (`aml-pep-officeholders-refresh.yml`) and
read **locally** at decision time: instant, reproducible, auditable, and
independent of anyone else's uptime at the moment it matters.

The two that cannot be reached from a server are **named as unsearched** rather
than omitted, because a source nobody mentions reads as a source nobody needed.
They remain one click away in the manual checks, which is the only way they get
checked at all.

## What a run records

`aml.pep_screening_runs` holds the record of the **search**: which registers
were read, how current each was, what each returned, which findings are
indicators, and what could not be reached. `register_versions` records the
entry count and as-at of each register read, because a run is only reproducible
if it records what it read rather than merely when it ran.

`aml.pep_screening_candidate_reviews` holds what a person decided about each
candidate. A rejection **must** say how it was told this is somebody else — a
column constraint requires ten characters, the endpoint requires it, and the
panel disables the button. "Dismissed" with no reason reads, six months later,
exactly like nobody having looked.

A completed run becomes a source row on the determination, and so does every
accepted candidate — in the operator's own words, from the reason they gave.
`runIsEvidence` refuses a run that searched nothing: naming a register that was
never read would put a line in the record that reads exactly like a check.

## The manual sources, kept and demoted

`pepSearchLinks.pure.ts` now carries a `tier`:

| tier | sources |
| --- | --- |
| `register` | Australian Government Directory (fixed URL), Parliament of Australia, ABN Lookup, ParlInfo |
| `open_web` | one general web search, labelled *"not a source of record"* |

A test asserts no `register` resolves to a search-engine host and that every
one is `*.gov.au`. AUSTRAC accepts internet research and it is genuinely the
only route to a foreign office or a family connection nothing publishes — so
the web search stays. It is one row, rendered last, under its own heading.

## What is deliberately NOT here

**Foreign office holders.** The local index covers Australian jurisdictions
only. Extending it worldwide needs a jurisdiction-partitioned loader like the
Australian one — the naive worldwide query answers 504 — and that is a separate
piece of work. Until then the customer's declaration and the manual web search
are the route to foreign exposure, and the engine **says so** in the coverage
it renders under every result.

## Where the tests are

| | |
| --- | --- |
| the engine's rules, and the disjoint vocabulary | `src/lib/aml/pepScreeningEngine.test.ts` |
| the panel, including that an empty result is never a success | `src/components/aml/__tests__/pepScreeningRunPanel.test.tsx` |
| the fixed Directory URL, and no search engine as a register | `src/lib/aml/pepSearchLinks.test.ts` |
| the endpoints' boundary | `src/lib/aml/amlScreeningRepair.contract.test.ts`, `scripts/security/check-aml-screening-boundary.mjs` |
