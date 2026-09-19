# PEP source reachability — the spike

Read this before writing an adapter for any PEP source, and before adding a
candidate to `scripts/aml/pepSourceCatalogue.mjs`.

## Why it exists

A list of "authoritative machine-readable government datasets" is a
**hypothesis**. Building twenty bespoke adapters against sources nobody has
fetched is how a programme discovers, in week three, that half of them answer
403 to anything without a browser.

`scripts/aml/pep-source-spike.mjs` fetches every candidate once and reports
what actually came back. It writes nothing, it is on no schedule, and it never
fails the build — an unreachable government website is the finding, not a
broken repository.

## The two things it does that a status code cannot

**It sniffs the bytes.** `Members_List.csv` answers HTTP 200 with 184 KB and a
body beginning `%PDF-1.7`. The extension says CSV, the `Content-Type` header
can say anything, and the content is a PDF. Any check that trusted the URL
would have recorded that source as working, and an adapter would have been
written against it.

**It names a block page as a block.** A WAF answers 200 with HTML saying
"Access Denied" as readily as it answers 403. A run that counts that as a
success is measuring nothing.

## The controls, and why the results are interpretable

A bare list of status codes cannot tell "this source blocks automated clients"
from "this environment cannot reach `.gov.au` at all". So every run includes:

| control | expectation |
| --- | --- |
| **DFAT consolidated list** | Known good **from GitHub Actions** — the sanctions loader pulls 3,846 entries from a runner on a schedule. Known **blocked** from the dev container. |
| **data.gov.au CKAN API** | Known good from anywhere. Distinguishes a proxy fault from a WAF. |

**If the DFAT control fails, the run measured the network rather than the
sources, and every other line in it is a lower bound rather than an answer.**

That inference is only as good as the control's verdict, and the first CI run
got the verdict wrong about a control that had plainly worked — see below. A
failing control now prints the status, the sniffed format and the byte count
beside it, so a reader can tell a refusal from a defect in the prober without
opening the JSON.

## Results — development container, 2026-08-20

`6 / 22 candidates usable`. **The DFAT control FAILED**, exactly as predicted,
so this is a **lower bound** and not the number to plan against.

### Usable

| source | tier | what came back |
| --- | --- | --- |
| **APH — Senators list** (`allsenel.csv`) | A | **75 senators**, real CSV: title, surname, given names, preferred name, initials, post-nominals, state, party, gender, electorate |
| **APH — Members list** (`All_members_by_name.csv`) | A | **150 members**, same shape plus electorate. Found *after* this run — see the note below — and verified from the same container. |
| Parliamentary Handbook | B | 200, HTML |
| Queensland Parliament — members | B | 200, 1.7 MB HTML |
| AGOR (organisations register) | A | 200, CSV — bodies, not people |
| SA local-government data portal | A | 200, JSON |
| Wikidata SPARQL | C | 200, JSON |

### Not usable

| source | result |
| --- | --- |
| **APH — Members list** (the path the proposal names) | 200, **PDF** wearing a `.csv` extension |
| **Directory.gov.au bulk XML export** | Does not complete — current *and* retired host |
| PM&C ministry list | 403 · Incapsula block page |
| NSW, VIC, TAS, ACT parliaments | 403 · Cloudflare block page |
| WA, SA parliaments | 404 (paths need discovery) |
| NT Legislative Assembly | 503 |
| High Court, Federal Court, Defence, DFAT missions | 403 |

### Findings that change the design

**1. The APH Senators CSV is real, and Tier A.** The proposal's central claim —
that Parliament publishes machine-readable member data — is **correct**. The
path it named for Members is not.

**2. APH's static media path serves; its HTML pages do not.** `/-/media/…`
returns files while `/Senators_and_Members/…` returns 403. Any APH adapter has
to be built around that asymmetry, and the Members CSV filename must be
discovered rather than guessed — six symmetrical guesses all returned the same
404 page.

The canonical Members path was subsequently found on APH's own
*Address labels and CSV files* index page, not by guessing:
`static.aph.gov.au/-/media/03_Senators_and_Members/Address_Labels_and_CSV_files/All_members_by_name/All_members_by_name.csv`.
It downloads from the dev container and from a runner, 150 rows both times.
The index page is now probed as a candidate in its own right, so a silent
rename of either file shows up as a finding rather than as a mystery.

**3. Directory.gov.au's bulk export is the weakest link in the proposal.** It
is listed active on data.gov.au and it did not complete once, on either host.
It is also the source the proposal rates "best replacement". Until a run from
CI says otherwise, it should not be planned around.

## Results — GitHub Actions runner, 2026-08-20

Run `32349350941`, from `github-actions/Linux`. **Both controls PASS.**
**`8 / 23 candidates usable`**, against 6 from the dev container.

### The control that failed while downloading 1.3 MB

The first CI run (`32348036414`) reported the DFAT control as `FAIL`. It had
returned `200 · zip/xlsx/docx · 1,299,680 bytes` — a real spreadsheet, exactly
as predicted.

An OOXML file is a zip container, so it sniffs as `zip/xlsx/docx` while the
catalogue says `xlsx`, and the verdict compared `expect !== format` against two
hand-written exceptions that did not include this one. The consequence was not
a wrong tick in a table: the script then printed the paragraph telling a reader
the run had measured the network and that every candidate line in it was
uninterpretable — about a run whose control had worked perfectly.

**A defect in a measuring instrument reads exactly like a finding about the
thing measured.** That is what this whole file exists to guard against, and the
instrument had it. `FORMAT_SATISFIED_BY` now reconciles sniffs and expectations
in one declared table, a failing control prints what actually came back, and
`src/lib/aml/pepSourceSpikeVerdict.test.ts` pins both — including the assertion
that a PDF wearing a `.csv` extension still fails, since loosening the
comparison is exactly how that one comes back.

### Usable from the runner (8)

| source | tier | what came back |
| --- | --- | --- |
| **APH — all Members** (`All_members_by_name.csv`) | A | `200 · 37,566 B · ~150 rows` |
| **APH — all Senators** (`allsenel.csv`) | A | `200 · 15,365 B · ~75 rows` |
| Parliament of Victoria — members | B | `200 · 163,508 B` HTML — **403 from the dev container** |
| Queensland Parliament — members | B | `200 · 1,787,609 B` HTML |
| AGOR organisations register | A | `200 · ~1,386 rows` — bodies, not people |
| SA local-government elected members | A | `200 · JSON` |
| Parliamentary Handbook | B | `200 · HTML` |
| Wikidata SPARQL | C | `200 · JSON` |

### Not usable from the runner (15)

| source | result |
| --- | --- |
| `Members_List.csv` *(the PDF trap, kept deliberately)* | `200 · pdf · 184,359 B` |
| **APH address-labels index page** | `200` · block page (`captcha`) |
| PM&C ministry list | `403` · Incapsula |
| NSW, TAS, ACT, NT parliaments | `403` · Cloudflare |
| Federal Court — judges | `403` · Cloudflare |
| WA, SA parliaments | `404` |
| directory.gov.au bulk export *(current **and** legacy host)* | timeout |
| High Court, Defence senior leadership, DFAT missions | timeout |

### What the comparison decides

**The federal Parliament is reachable, and the product said it was not.** Both
register files download from both environments on every attempt. That is the
finding step 2 acts on — see `PEP_OFFICEHOLDER_INDEX.md`.

**One source crossed over, and it is a real gain.** Victoria's member list
answers a runner and refuses the dev container. Nothing else did.

**The page that publishes the canonical URLs is itself WAF'd from CI.** The
address-labels index answers `200` with a captcha page to a runner while the
two files it links download fine. So a silent rename of either CSV will surface
as a `404` on the file rather than as a diff on the index — the loader's own
`expectAtLeast` floor and the sniff are the guards that matter, not the index
probe.

**Directory.gov.au did not complete from CI either.** It is the source the
original proposal rated "best replacement", it is listed active on data.gov.au,
and it has now failed to complete from two independent networks, on both its
current and its legacy host. No adapter should be written for it until a run
somewhere retrieves it.

**Three `.gov.au` hosts turned a fast 403 into a timeout on the runner.** The
High Court, Defence and DFAT missions refuse the dev container quickly and hang
for the runner. Both are refusals; the runner's is less polite. Neither is a
lead, and the judiciary and Defence categories therefore still have **0
usable** sources.

### Coverage against the Rules, from the runner

| category | usable |
| --- | --- |
| Commonwealth legislature | **2 / 4** |
| Commonwealth legislature (history) | 1 / 1 |
| Commonwealth entities | 1 / 1 |
| State legislature | 2 / 6 |
| Local government | 1 / 1 |
| Reconciliation (Wikidata) | 1 / 1 |
| Commonwealth ministry | 0 / 1 |
| Commonwealth appointments | 0 / 2 |
| Territory legislature | 0 / 2 |
| Judiciary | 0 / 2 |
| Defence | 0 / 1 |
| Diplomatic | 0 / 1 |

Six of twelve categories have nothing. Those gaps are **disclosed by the
screening engine**, not quietly absent — which is the rule at the bottom of
this file.

## How to run it

```
node scripts/aml/pep-source-spike.mjs --timeout 60 --json report.json
```

or dispatch **AML PEP source reachability spike** in Actions, which prints the
same report into the run summary and uploads the JSON.

## The rule this spike is protecting

Every source that reaches the screening engine must be able to report three
states that are never collapsed: **searched — no match**, **searched —
possible match**, and **not searched**. A source whose reachability was assumed
rather than measured is a source that will one day report the third as the
first, which is the failure the whole engine is built to prevent.
