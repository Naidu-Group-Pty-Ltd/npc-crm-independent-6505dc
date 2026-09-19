# Finance Portal templates

White-label document pack served from `public/templates/finance-portal/`.

**Two of the three files are not generated, and must never be.** The referral
agreements are the documents their author maintains, shipped byte-for-byte —
read [`agreements/TEMPLATES_ONLY.md`](./agreements/TEMPLATES_ONLY.md) before
touching them. Only the workbook is built from source here.

| File | Format | Source | Purpose |
| --- | --- | --- | --- |
| `Strategic_Property_Referral_Agreement.docx` | Word | **Supplied** | Buyer's agency issues to a finance partner. Referral relationship, commercial schedule, registration form. |
| `Finance_Referral_and_Commission_Agreement.docx` | Word | **Supplied** | Buyer's agency refers to a finance partner. Commission share, clawbacks, consent form, loan-writer undertaking, banking details. |
| `Aurixa_White_Label_Client_Fact_Find.xlsx` | Excel, 6 sheets | Generated | Client-facing intake form plus a print-ready summary. |

The two agreements are declared in
`supabase/functions/_shared/agreements/templateFiles.pure.ts` (file name, byte
length, SHA-256, supplied date) and checked clause by clause against the locked
content modules by `src/lib/agreements/__tests__/agreementTemplateFiles.spec.ts`.
That suite is the authority on them; nothing in this directory's Python is.

This directory used to build them too, which meant three separate typesettings
of the same two legal instruments existed at once and the generated pair had
gone stale — still carrying a section the document owner withdrew. The builders
are deleted rather than disabled, and `verify_templates.py` fails if any Word
file appears here that is not one of the two shipped agreements.

## Regenerating the workbook

```bash
python3 scripts/finance-portal-templates/build_all.py      # writes to public/templates/finance-portal
python3 scripts/finance-portal-templates/verify_templates.py
```

Requires `python-docx` and `openpyxl` (`pip install python-docx openpyxl`).

`verify_templates.py` is the regression net for the workbook: it re-opens the
artefact and asserts that the summary sheet still reads the fact-find rows it
claims to. The first draft drifted by three rows and printed the start date
under "Employer"; the binding check exists so that cannot happen again
silently. It also checks the two shipped agreements are present with their
merge tokens intact, and that no builder has written a Word file beside them.

## Source layout

```
scripts/finance-portal-templates/
  aurixa_brand.py     Palette, typography, layout metrics, BrandProfile
  xlsx_kit.py         Excel primitives (banners, field rows, KPI tiles, print setup)
  build_client_fact_find.py
  build_all.py        Orchestrator; --out and --brand flags
  verify_templates.py Structural regression checks
  example-brand.json  Sample partner override file
```

Do not add an agreement builder back here.

## Design system

The workbook mirrors `src/styles/tokens.css` so printed collateral and the
dashboard read as one system. (The two agreements carry their author's own
design and are not built from these tokens.) `aurixa_brand.py` documents the token → hex
mapping and ships `hsl_to_hex()` for re-deriving values if the tokens move.

| Role | Token | Hex | Used for |
| --- | --- | --- | --- |
| Primary | `--aurixa-obsidian` | `#251F18` | Cover panel, section bands, table headers, footers |
| Accent | `--brand` | `#D9A520` | Section numbers, rules, chips, field underlines |
| Accent deep / dark | `--brand-700` / `--brand-900` | `#A98019` / `#7C5E13` | Small caps labels, guidance headings |
| Accent tint / pale | `--brand-100` / `--brand-light` | `#F8EED3` / `#FCF5E3` | Guidance cards, total rows |
| Ink | `--foreground` | `#312A21` | Body copy |
| Ink soft / faint | `--muted-foreground` | `#6E6253` / `#9A8D7C` | Captions, placeholder text |
| Surfaces | `--card` / `--background` / `--muted` | `#FFFDFA` / `#FAF7EF` / `#F2EBDE` | Panels, zebra rows, label cells |
| Field | — | `#FFFBEE` | Every cell a user is meant to fill in |
| Success / Info / Alert | `--success` / `--info` / `--destructive` | `#21C45D` / `#0284C5` / `#C2410C` | Semantic callouts |

**Semantic colours are fixed.** Green means confirmed, blue means informational,
red means legal caution. They stay put when a partner re-skins the pack, so a
warning never stops looking like a warning.

Typography is Georgia for display (cover, section numbers, clause headings) and
Calibri for body, labels and tables. Both ship with Office on Windows and macOS
and substitute predictably elsewhere, so pagination holds on any machine that
opens the file. Change them in one place: `Typography` in `aurixa_brand.py`.

## White-labelling

### The agreements — find and replace

Every partner-specific value in the two supplied agreements is a `<<TOKEN>>`.
Open the document, press `Ctrl+H` / `Cmd+H`, replace each token once.

| Token | Appears in |
| --- | --- |
| `<<COMPANY NAME>>` | Cover wordmark, running header, e-mail sign-off |
| `<<INSERT>>` | Every blank field cell, including party names and ABN / ACN |
| `<<DATE>>` | Cover particulars, agreement details, forms |
| `<<NUMBER>>` | Negotiated notice periods, timeframes and dispute windows |
| `<<SENDER NAME>>` `<<TITLE>>` `<<PHONE>>` `<<EMAIL>>` `<<WEBSITE>>` | E-mail template sign-off |
| `<<BUYER\'S AGENCY NAME>>` `<<FINANCE PARTNER NAME>>` `<<FIRST NAME>>` | E-mail template body |

There is no pre-branded build and no platform-generated variant for these. The
platform ships one neutral document and both portals hand over the same bytes —
see [`agreements/TEMPLATES_ONLY.md`](./agreements/TEMPLATES_ONLY.md) for why a
tenant-stamped copy of a blank template is the wrong artefact.

### The workbook — pre-branded build

```bash
python3 scripts/finance-portal-templates/build_all.py \
  --brand scripts/finance-portal-templates/example-brand.json \
  --out /tmp/northbridge
```

The JSON accepts any subset of `BrandProfile` fields — see
`example-brand.json`. `primary` and `accent` re-skin every band, chip, rule and
underline in one pass; `platform_note: ""` removes the Aurixa footer
attribution for a fully unbranded partner copy.

The Finance Portal's branding settings (`whitelabel_settings`, see
[`WHITE_LABEL_TOKEN_CONTRACT.md`](./WHITE_LABEL_TOKEN_CONTRACT.md)) map onto
`BrandProfile` one-to-one: `primary_color` → `primary`, the brand accent →
`accent`. Build a profile from the tenant's settings and call `build_all.main()`
with it.

## Workbook structure

| Sheet | Contents |
| --- | --- |
| `Start Here` | Tab guide, completion checklist, data-handling note |
| `White Label Setup` | Organisation identity + document settings; every other sheet reads from it |
| `Client Fact Find` | Two applicants: personal, address history, employment & income, assets, other liabilities |
| `Living Expenses` | 50 expense lines with an auto-calculated annual column and a category roll-up |
| `Client Form Output` | Print-ready summary: KPI tiles, personal, employment, position roll-up, declaration |
| `Lists` | Hidden. Drives every dropdown; edit here to change the options |

Row anchors are constants in `build_client_fact_find.py` (`ASSET_FIRST`,
`INCOME_FIRST`, …) and the summary sheet is generated from the same constants,
so the two can no longer disagree.

Conventions:

- **Pale gold cells are inputs**; grey cells are calculated. Nothing calculated
  is ever an input.
- Blank inputs print blank — every pass-through is wrapped in
  `IF(ref="","",ref)` so an unfilled field does not render as `0` or 30/12/1899.
- Required fields (surname, first name, organisation name) tint amber while
  empty.
- A negative net position renders in red.
- Every sheet is A4, fit-to-one-page-wide, with repeated header rows and a
  branded print header/footer, so `File → Export → PDF` is print-ready as is.
- Input cells are unlocked and calculated cells are locked, so
  `Review → Protect Sheet` gives tab-through data entry immediately. Protection
  is left off by default.

## Defects corrected from the first draft

Carried over from the initial ChatGPT-generated workbook and fixed here:

| Defect | Effect | Fix |
| --- | --- | --- |
| Summary read the employment block three rows low | "Employer" printed the start date, "Role" printed the base salary, "Employment Type" printed the employer address, "Start Date" printed the commission | Bound to named row constants; asserted by `verify_templates.py` |
| Income total summed `C35:C39` | Missed base salary, bonus and commission; included the assets header row | Sums `C32:C36`, the five income rows |
| Living-situation dropdown attached to row 16 | Dropdown sat on the e-mail field; living situation had none | Moved to row 20 |
| Summary cover printed `'White Label Setup'!B8` | Displayed the hex string `#12345B` where the tagline belonged | Reads the tagline cell |
| `Living Expenses` shipped with `600` in Registration | A blank template arrived pre-populated with one arbitrary figure | All lines seeded at zero |
| Setup sheet said "Orixa" | Platform misspelled in the client-facing note | Corrected to Aurixa |

## Content scope

The workbook's additions over the source are structural — completion guidance,
totals rows and the category roll-up.

The two agreements are carried unchanged. Nothing in this repository rewrites,
renumbers or restyles a clause of them; the wording is mirrored in the locked
content modules only so it can be checked, never so it can be redrawn. (The
generated pair this replaced did correct one spelling — clause 7 of Agreement
02 reads "Reciept" in the source — and that correction is gone with them. The
supplied document says what its author wrote.)

These remain templates. They still require legal, licensing, privacy and
aggregator review before use, as the cover of each document states.
