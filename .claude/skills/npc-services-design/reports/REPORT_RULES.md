# Report and PDF rules

Print is not screen. These rules override the screen guidance in
[`../README.md`](../README.md) wherever they disagree.

For the architecture — where the shared modules live and how a report is
assembled — see [`docs/reports/DESIGN_SYSTEM.md`](../../../../docs/reports/DESIGN_SYSTEM.md).

---

## 1 · Paper and ink

| Role | Value | Why not the screen token |
| --- | --- | --- |
| Paper | `#FAF7F1` warm ivory | Pure white against a warm cream cover reads as a printing error. Never `#FFFFFF`. |
| Panel | `#F2ECDD` | On screen the card is *lighter* than the page; on paper a panel must be *darker* than the sheet or it disappears. |
| Body ink | graphite, not black | Matches the light theme's `--foreground`. Pure black on cream looks like a photocopy. |
| Cover ground | obsidian | One flat hex, never a gradient stack — gradients band on the PDF/A raster path. |

## 2 · Contrast floors by size

This is the rule most likely to be broken, because the brand gold fails it.

| Used at | Minimum contrast against its ground |
| --- | --- |
| ≥ 14pt — headings, cover | 4.5:1 |
| 10–13pt — body, table cells | 7:1 |
| < 10pt — eyebrows, captions, running heads, page numbers | 7:1 **and** never a chromatic accent at full saturation |

**`--brand` (`43 74% 49%` → `#D9A521`) on ivory is ≈2.3:1.** It fails at the 8.5pt
eyebrow that is the brand's own signature. Small gold type must be darkened —
derive it, don't hardcode a second gold. The codebase already contains **eight
different golds** precisely because this was solved ad hoc, repeatedly.

Semantic colours are tuned for screen and grey out at 9pt: `--success`
(`142 71% 45%`) is ≈2.2:1 on cream. Keep hue and saturation, clamp lightness into
the 30–36% band.

## 3 · What does not survive the renderer

WeasyPrint is not a browser. Do not use:

- `background-clip: text` / gradient text — renders flat or invisible
- `box-shadow` for hierarchy — paper has no elevation; use rules, weight and ground
- `backdrop-filter`, glass surfaces, the aurora
- any `--motion-*`, hover or focus token
- web-safe assumptions about fonts: **only faces installed in the container render.**
  The browser's font stack is irrelevant.

Express hierarchy with **rules, type weight, ground colour and space** instead.

## 4 · Typography in print

The print container ships four brand families, and the list is a **contract**:
a face a report names that the image lacks does not warn — it silently prints in
the engine's default. `_shared/reportDesign/typography.pure.ts`'s
`CONTAINER_FONT_FILES` is the authority, and `reportTypography.spec.ts` reads it,
the Dockerfile **and this file**, so none of the three can drift from the others.

| Family | Weights in the print container | Where it is set |
| --- | --- | --- |
| **Cinzel** | Regular 400, SemiBold 600 | cover title and closing lockup, nowhere else |
| **Playfair Display** | Regular 400, Italic 400, SemiBold 600, Bold 700 | chapter titles, section heads, pull quotes |
| **Inter** | Debian `fonts-inter` | body copy and tables |
| **IBM Plex Mono** | Regular 400, Medium 500, Bold 700 | figures, eyebrows, running heads, page numbers, column heads |

Beneath them the image carries Roboto, Lato and the DejaVu / Liberation / Noto
families, which exist to keep a missing glyph legible rather than to be named.

**Cinzel ships no Bold, deliberately.** It is an inscriptional roman cut after
Trajan-column capitals and those are light, so the cover title is Regular and
the closing wordmark SemiBold — which is what the face was drawn for. Asking
for 700 gets a synthetic bold of a face that never had one. It stays confined
to those two places for a second reason that holds regardless: at body sizes an
all-caps roman is unreadable.

`public/fonts/` holds Cinzel **Bold** and Playfair Display **Medium**, and
neither weight is in the print container — those are the screen copies, so do
not specify a document's type from that directory.

**Cormorant Garamond and Fraunces are not installed and are not coming.**
Neither exists as a Debian binary package in bookworm or trixie, and both were
removed from the type stacks entirely. `fonts-ibm-plex` is the subtle one: it
is a Debian *source* package, so packages.debian.org serves a page for it and it
reads as available — only the binary index says otherwise.

**A dash a face cannot draw.** No shipped face holds `U+2011`, and only
Playfair holds `U+2010`, so `printableGlyphs.pure.ts` sets five dashes as ones
the faces do hold, on the read path. Write an em dash or an en dash freely —
every face has both.

Figures in financial tables get **tabular numerals**, and a monospaced face where
columns must align down a long projection. A ten-year table is only readable if the
decimal points stack.

The eyebrow signature carries over to print and is the single strongest brand
marker on a page — but see §2 for its contrast.

## 5 · The logo on a document

| Surface | Mark | Rule |
| --- | --- | --- |
| Cover (obsidian) | monogram | Top-left, ~14mm tall, generous clear space, never over the image's focal area |
| Running header | **none** | Wordmark *text* only — a repeated image in a page-margin box is fragile across 40 pages |
| Chapter opener | **none** | Eyebrow and rule only; repeating the mark cheapens it |
| Contact / disclaimer page (obsidian) | monogram | Above the contact block |
| Footer | **none** | Page counters only |

Only `public/images/npc-logo-monogram.png` may go on a client document. Every other
"logo" in the repo is an email-signature banner containing the director's personal
mobile number — see [`../assets/README.md`](../assets/README.md).

Assets are **inlined as base64 `data:` URIs**, not linked. The render service
allows `data:` explicitly and it makes a render reproducible, network-free, and
valid under PDF/A (which forbids unresolved external references).

## 6 · Tenant branding

A generated report resolves its brand in this order:

1. NPC design-system defaults
2. `whitelabel_settings` — tenant colours, logo, company name
3. `global_report_settings.contact_details` — phone, email, website, address, **ABN**
   (the only place an ABN exists)

Category A follows the tenant. **Category B never does** — a tenant cannot make
"risk" green.

**Snapshot, don't reference.** A generated document pins the brand values used at
generation time, so re-issuing a year-old report reproduces it. The established
pattern is `client_fact_find_brand_snapshots` with
`branding_snapshot_id … ON DELETE RESTRICT`.

## 7 · Copy in documents

Everything in [`../README.md`](../README.md) §2 applies, plus:

- **Never print the rendering engine's name**, a build ID, or any internal
  vocabulary on a client-facing page.
- Currency `en-AU`, no decimals. Dates `d MMM yyyy`.
- Negative figures in a financial table print in a print-weight red — the sign is
  the most-read thing on the page.
- The disclaimer is legal copy. Do not reword it to fit a layout.
