# The render boundary

*Why every design-system document came out in the legacy layout, and what the
rule is now.*

## What was measured

On 14 August 2026 a person chose a template for the 10 Year Cash Flow, the
picker said the choice was kept, and every download came out of the standard
composer. The evidence, in order of how decisive it was:

| Source | Reading |
| --- | --- |
| `activity_logs` (`report_pdf_downloaded`, 14 Aug) | 10 of 10 rows carry `metadata->>'source' = 'cash_flow_server'`. **Zero** have ever carried `cash_flow_template`. |
| `template_render_jobs` | 79 rows, newest **11 August**. Nothing since. |
| `template_events` | newest `render_success` 11 August; newest `render_failed` **6 August**. |
| `report_templates` | 11 active rows, `cashflow` has two, both `weasyprint`. |
| `report_template_selections` | the selection exists, is active, and names a `cashflow` template. |

So a file *was* produced on every attempt — the composer's — and the templated
one was never even attempted as far as any ledger could tell. `render-template-pdf`
writes its `template_render_jobs` row **before** it calls WeasyPrint, so an
absent row proves the renderer was never reached.

## The cause

`render-template-pdf` runs `assertSafeRenderResources` over the HTML before it
invokes the engine. That gate is an SSRF boundary and it admits exactly two
things: `data:` payloads, and objects under this project's own Supabase storage
origin. Everything else throws.

All 500 Investment Compass masters declare their typefaces as
`tokens.fontFaces` entries carrying a Google Fonts `cssUrl` — **2,838
references across the seed migrations** — because that is how a template names
a webfont for the *browser*. `tokensToFontFaceCss` emitted each as
`@import url('https://fonts.googleapis.com/…')`, and one is enough to fail a
document.

Reproduced locally against the production bytes, the chain was:

```
parseTemplate        ✓ 11 pages, 84 blocks
productionTemplateGuard ✓
renderTemplateToHtml ✓ 73,722 bytes, 0 unresolved bindings
assertSafeRenderResources ✗ Remote render resources must be normalized …
```

A document that was completely correct, refused on its last step.

## Why nothing said so

Three separate silences stacked:

1. **The gate ran before `templateId` was read**, and before the job row was
   inserted. The `template_events` failure insert is guarded on `templateId`.
   So a refused render wrote *nothing* — the ledger and the analytics table
   both read exactly as though nobody had asked for a render.
2. **The error named no URL.** "Remote render resources must be normalized into
   project storage" is true of a stray import, an un-normalised logo and a font
   stylesheet alike; the module's own comments record two earlier debugging
   sessions lost to that.
3. **The route's fallback is by design.** Every failure in
   `routeReportThroughTemplate` is a fallback rather than an error, because a
   templated document is an improvement on a working path. On the migrated
   formats the legacy generator is itself a well-typeset WeasyPrint document,
   so "your template rendered" and "your template was skipped" produced
   visually similar files.

## The rule

**For print, the container is the font source.** The image installs its faces
(`weasyprint-service/Dockerfile`), `typography.pure.ts` is the contract for what
it has, and a printed document names a family which fontconfig resolves with no
network involved. That is already how the ten legacy report formats set type,
and it is why they render while the design system did not.

Three things enforce it:

- `renderTemplateToHtml` takes `fontSource: 'remote' | 'container'`. Under
  `'container'` no remote stylesheet link and no remote `@font-face src` is
  emitted. A `data:` src — the embedded faces a PDF import produces — still is,
  because it travels with the HTML.
- `compileTemplateHtmlForPdf` **forces** it. It is documented as the one way to
  turn a template into HTML for the server-side renderer, for exactly this class
  of omission, and there is no PDF render for which `'remote'` is correct. The
  production route had its own hand-rolled copy of the compile step and so
  inherited none of that; it now goes through the compiler.
- A family the image lacks is **substituted explicitly**
  (`printFontPolicy.pure.ts`) rather than left to fontconfig. Dropping the link
  and saying nothing would set the page in the engine's default with no warning
  from anything, which is the failure the Dockerfile's own font contract exists
  to prevent. Two rows today: Fraunces → Playfair Display, Public Sans → Inter.
  The substitution applies to the **preview as well**, so what a designer sees
  is what prints.

## Two rules that will bite

**A substitution is a stopgap, not a design decision.** Ship the real face — a
Debian binary package in the Dockerfile's `apt-get`, or a TTF in
`weasyprint-service/fonts/` with its OFL — add it to `CONTAINER_FONT_PACKAGES`
or `CONTAINER_FONT_FILES`, and delete the row. Verify a Debian package against
`dists/<release>/main/binary-amd64/Packages.gz` and never against
packages.debian.org, which serves pages for source package names too; that is
how `fonts-ibm-plex` got into the list and broke the image build.

**A measure taken against a fixture cannot see this class of defect.** Every
other check in this programme — the ink floor, the critique rubric, the golden
diff, PDF/UA validation — runs on a template written in the harness, and a
harness template has no Google Fonts URL. `printFontPolicy.spec.ts` renders and
then puts the result through the *real* gate;
`productionMasterRenderBoundary.spec.ts` does it with the seeded master the
production selection actually points at. `docs/reports/COVERAGE.md` makes this
point about content bindings, and it is just as true of the boundary.

## Three defects the same audit found downstream

Fixing the boundary made the templated path run for the first time, which
exposed what it produces. An adversarial audit of the whole export chain
confirmed six defects; three are fixed here.

### 1. The legacy fallback never fired — nine formats, eight of them stale

Every format that keeps an in-browser generator behind its server route decides
whether to use it with a `looksUndeployed` predicate. **Nine formats carried
their own copy and eight could not match the message the transport actually
produces.**

An absent edge function is a 404 from the *gateway*, which carries no
`Access-Control-Allow-Origin`; the request is preflighted, so the browser never
surfaces the status or the body. `fetch` rejects, and `invokeSecureFunction`
rewrites the rejection into `Network/CORS error calling …`. Matching on
`failed to fetch` therefore missed the only case the fallback existed for — and
missed it on *every* browser, since Chrome's wording is the one that gets
rewritten while Firefox says `NetworkError when attempting to fetch resource.`
and Safari says `Load failed`.

The consequence was not a bad message. `requestCashFlowPdf` is handed a working
generator as `legacyFallback` and never called it: it threw, the modal turned
that into a red toast, and **the adviser got no file at all**.

The predicate is now `src/lib/reports/undeployedRoute.ts`, once. Two rules: a
transport failure IS an absent function, and **a timeout is the opposite of one**
(it is also `network: true`, but the route exists, answered slowly, and may have
finished — swapping in the legacy document there hands over a different
document after a successful render).

### 2. The payload published the series and not the inputs under it

`wireAsProjectionRow` built a pseudo-row of nothing but the ten years, so
`projectCashFlow` published nine of the fourteen `cashflow.*` groups a master
binds. The other five printed as labelled tables with empty amount cells:
**50 of the production master's 133 bound paths resolved to nothing, 35 empty
cells** — the purchase fee lines, the loan repayments and the entire annual
holding-cost table, none of which an override of a projection year changes.

The record is now read *alongside* the payload: the payload carries the series,
the record carries the inputs. The read is best-effort and the render never
depends on it — that dependency is the original defect — so a refusal costs the
holding-cost table, not the document. Down to 29 unresolved, 22 cells.

Two things are deliberately **not** derived from the wire, and this is the rule
to keep. A production row stores `monthlyPayment: 2518.11` on an interest-only
loan while year one's `interest + principal` implies `2100`, because the store
records the P&I payment whatever the loan type. And the stored per-year `roi`
fits `(capitalGain + cumulativeCashFlow) / deposit` in year one and nothing that
reproduces year ten. Publishing either under the same label as the stored one
puts a figure in a client's financial document that disagrees with every other
surface in the product.

What remains withheld is `roi` and the three-scenario comparison, and they are
withheld because they are properties **of the stored series**: a reviewed series
is not one of the three. A *proved* series — one `matchStoredScenario` showed
equals a stored scenario in every field of every year — now takes the stored row
whole and has none of these gaps.

### 3. The CSRF coverage gate reported on none of the functions it named

`check-csrf-coverage.mjs` tested `/\bverifyAuth\b/`. The `\b` requires a
non-word character after the name, so it **cannot match
`verifyAuthOrNativeUser`** — the wrapper twelve cookie-authenticated functions
use, including nine `render-*-pdf` routes and `render-template-pdf` itself.
Every one reads the `__Host-session_token` cookie, that cookie is
`SameSite=None`, `_shared/auth.ts` states that a function accepting it MUST run
`enforceCsrf`, and none of them did. The gate printed
*"CSRF coverage check passed"* the entire time, which is worse than not
existing: it was read as evidence.

The regex is `verifyAuth\w*` now, all twelve carry the guard, and
`check-security-gate-negatives.mjs` has a case anchored on a
`verifyAuthOrNativeUser` function so the widening is proven to bite rather than
believed to.

### 4. The boundary was refusing documents for their prose

The scan read the whole document as one string and refused any URL-shaped
substring anywhere in it — including in the visible text of the report.

**808 of the 1,182 investment reports carry a URL in their content.** A Compass
report citing a planning portal, or an introduction printing the firm's own
website, was refused at the boundary and fell back to the legacy generator. The
two model-authored formats are the most exposed of all, because a model writing
prose cites its sources.

WeasyPrint has no script engine and resolves a URL in exactly three kinds of
place: an element attribute, a CSS `url()` / `@import`, and the inline `style`
attribute that is a special case of the second. A URL in a text node is drawn as
characters. Nothing requests it, so there is nothing to defend against.

The scan is positional now: **attribute values and stylesheet bodies are judged;
text between tags is not.** It stays deliberately generous about what counts as
a position — *every* attribute is judged rather than a list of the ones
WeasyPrint is known to fetch, because being wrong in the narrow direction
reopens the SSRF while being wrong in the generous direction costs a loud,
recoverable refusal. `<img data-xmlns="http://169.254.169.254/…">` is still
refused for exactly that reason.

Two attributes are exempt, and only two: `xmlns`/`xmlns:prefix` (an identifier,
never fetched — it already had an exemption) and `href` **on `<a>`** (a link
annotation in the output PDF, not a request; the renderer emits one for every
link overlay and every contents row). `href` anywhere else — `<link>`, SVG
`<image>`, `<use>` — is a fetch and is judged.

### 5. An unreachable image failed the whole document

`preloadImages` ran before binding resolution and skipped `{{…}}` by design.
Correct for text, fatal for assets: an `image` block whose `src` is a binding —
including the block registry's own default, `{{property.imageUrl}}` — resolved
to a remote URL at paint time, *after* the only step that could have brought it
inside the boundary. And a literal remote URL whose fetch failed was left in
place rather than dropped. Either way the boundary refused the whole document
for one picture: the production route degraded to the legacy generator, and the
Template Builder's export produced no file at all.

The resolution step now takes the render data, so an asset named by a binding is
resolved and **fetched and inlined like any other** — which is the outcome
everybody actually wanted, since the picture reaches the page. What cannot be
reached is **dropped**, and named: `compileTemplateHtmlForPdf` returns
`droppedAssets` and both export surfaces say so. That is the rule
`adapters/organisation.ts` already stated for brand marks — *a logo that could
not be fetched is a thinner document, not a failed one* — applied where it was
missing.

A project-storage URL is never dropped: `reference` mode deliberately leaves a
page raster as a signed link for WeasyPrint to fetch itself, and the boundary
admits it. Client and server share one predicate (`isAdmissibleRenderResource`
/ `refuseRenderResource`) so the two ends cannot disagree about what is
admissible — a disagreement there shows up as a document that previews cleanly
and 500s in production.

## Where the pieces are

| Concern | Module |
| --- | --- |
| The boundary itself | `supabase/functions/_shared/renderResourcePolicy.pure.ts` |
| What the image installs | `supabase/functions/_shared/reportDesign/typography.pure.ts` |
| Substitutions and stack rewriting | `supabase/functions/_shared/reportDesign/printFontPolicy.pure.ts` |
| Emission | `src/lib/reportTemplate/cssTokens.ts` (`tokensToFontFaceCss`) |
| The one PDF compiler | `src/lib/reportTemplate/compileTemplateForPdf.ts` |
| The production route | `src/lib/reportTemplate/routeReportThroughTemplate.ts` |
| Ledger and error text | `supabase/functions/render-template-pdf/index.ts` |
| Asset normalisation and drops | `src/lib/reportTemplate/imagePreloader.ts` |
| "Is this route deployed?" | `src/lib/reports/undeployedRoute.ts` |
| The cash flow payload/record merge | `src/lib/reports/cashFlow/liveProjectionRow.ts` |
| CSRF coverage | `scripts/security/check-csrf-coverage.mjs` |
