# WeasyPrint PDF Microservice

Self-hosted Python service that renders the report design system's HTML to PDF
using WeasyPrint. Replaces the Api2PDF (Headless Chrome) path so we keep full
control over typography, page layout, and engine version.

## The version is a correctness boundary

`requirements.txt` pins the engine **exactly**, and
`supabase/functions/_shared/reportDesign/engineSupport.pure.ts` mirrors that
number in `PINNED_ENGINE`. A spec reads both and fails if they drift.

That is not bookkeeping. The stylesheet is written and reviewed against
whatever a developer has installed, and printed for clients by this container.
While those were 69 and 62.3, `width: calc(210mm - 44mm)` was **rejected as an
invalid value on every production render** — so the cover's masthead row lost
the width its `table-layout: fixed` depended on, and the classification and the
document reference printed as one word. The fix had been shipped and visually
verified a day earlier, against the wrong engine. Every render succeeded.
Nothing was red.

Upgrade the pin and the constant together.

## What the engine silently does not do

WeasyPrint does not fail on CSS it cannot implement. It logs one line and
renders the document without it. Nine constructs are dropped that way —
`box-shadow`, `filter`, `backdrop-filter`, `word-break: break-word`,
`position: sticky`, `text-wrap`, `aspect-ratio`, `mix-blend-mode`,
`writing-mode` — and a `font-family` naming nothing installed is not even
logged.

Three things address that, at three different distances from the page:

1. **`engineSupport.pure.ts`** lists the constructs, and a spec sweeps every
   stylesheet the product can generate. Catches what is on the list.
2. **`/render` returns the engine's warnings** (see below), so a caller can see
   what it dropped. Catches what is not.
3. **`/capabilities`** answers, for a set of probe declarations, which ones this
   engine ignored — so the list is graded by the deployed engine rather than the
   other way round. `npm run reportkit:engine:capabilities` runs it.

## Fonts

The font list in the `Dockerfile` is a **contract** with
`supabase/functions/_shared/reportDesign/typography.pure.ts`, asserted by
`src/lib/reportDesign/__tests__/reportTypography.spec.ts` and by a Docker build
in CI. A face a report names must be installed here, or WeasyPrint substitutes
silently: the PDF renders, the tests pass, and the defect is visible only to
whoever opens the document.

Two routes in:

- **Debian packages** — Inter, IBM Plex, Roboto, Lato and the
  DejaVu/Liberation/Noto fallbacks. Every one is verified present in bookworm
  and trixie.
- **`fonts/*.ttf`, COPY-ed and `fc-cache`-d** — Cinzel, Playfair Display
  (upright and italic) and IBM Plex Mono. No distribution packages them. They
  live in this directory rather than `public/fonts/` because Docker cannot
  `COPY` from outside its build context. SIL OFL 1.1; the licence files ship
  beside them, which redistribution inside an image requires.

The `RUN fc-cache` layer asserts each brand family resolves and fails the build
if one does not — a missing face must break the build, not the document. Then
`selfcheck.py` runs as the last layer and proves the harder half: that every
shipped file is *reachable*, at the weight it claims, by the CSS request that
names it. A weight fontconfig cannot answer exactly is answered by its
neighbour, silently.

`fonts/PROVENANCE.md` records a SHA-256 per file, and
`reportTypography.spec.ts` checks them. A binary in a repository is not
reviewable in a diff, and these get copied into the image that renders every
client's document.

> Cinzel shipped **Bold alone** until recently, so the cover title was set Bold —
> which the type module had written up as a design rule. It was not: Cinzel is an
> inscriptional roman after Trajan capitals, those are light, and Regular and
> SemiBold were sitting in the same committed archive the Bold came from. The
> cover is now Regular, the closing wordmark SemiBold, and Bold is gone.

> This previously installed `fonts-playfair-display`,
> `fonts-cormorant-garamond` and `fonts-fraunces`. **None of the three exists in
> Debian.** `apt-get install -y` exits non-zero on an unknown package, so the
> image could not be built at all.

## Endpoints

All but `/healthz` require `Authorization: Bearer $WEASYPRINT_SERVICE_TOKEN`
(or the older `WEASYPRINT_API_KEY`). No token set means every request is
refused — it fails closed.

- `GET  /healthz`, `GET /health` — liveness. The image's `HEALTHCHECK` uses it.
- `GET  /version` — the installed engine, pydyf and flask.
- `GET|POST /capabilities` — which of a set of CSS declarations this engine
  drops, plus which brand faces the render user can resolve. `POST
  {"probes": {"name": "declaration"}}` to supply your own set; that is how the
  repo's list is checked without redeploying the service.
- `POST /render` — body
  `{ "html": "...", "base_url": "...", "pdf_variant": "pdf/ua-1",
  "output_intent": "srgb", "tagged": true, "optimize_images": true,
  "custom_metadata": true, "strict": false }`, returns `application/pdf` bytes.

  `pdf_variant` omitted (or `null`) means the engine's default — no conformance
  claim. `output_intent` takes the keyword `srgb` or `device-cmyk`, not a path
  to a profile; a path silently matches nothing and produces no intent at all.
  `custom_metadata` copies the document's own `<meta name=…>` tags into the
  PDF, which is how a delivered file names the row that produced it.

`/render` answers with the engine's diagnostics in headers:

| Header | Meaning |
| --- | --- |
| `X-WeasyPrint-Warnings` | JSON array of declarations the engine dropped |
| `X-WeasyPrint-Warning-Count` | How many, before truncation |
| `X-Pdf-Pages` | The engine's own page count — exact, not inferred from the bytes |
| `X-Pdf-Tagged` | `1` when a structure tree was written |
| `X-Render-Ms`, `X-WeasyPrint-Version` | What it cost, and what rendered it |

`strict: true` turns any warning into a `422` with the warnings as JSON. Off for
client-facing renders — a dropped `text-wrap` is cosmetic and a person waiting
on a report is not served by a refusal — and on in CI.

> **Tagging.** The knob is `pdf_tags`, and it only exists from WeasyPrint 63.
> This service accepted `tagged` in the body, defaulted it to true, and never
> passed anything to the engine, so **every report it produced before this was
> untagged**: valid, printable, and unnavigable to a screen reader.

### The conformance claim is checked, not asserted

The image carries **veraPDF 1.30.2** at `/opt/verapdf/verapdf`, and
`selfcheck.py` fails the build if the specimen it renders does not validate as
PDF/UA-1. A claim that fails validation is worse than no claim — it tells a
procurement officer, a screen-reader user and an accessibility auditor that the
document is navigable, and none of them finds out otherwise until they try.

```bash
docker run --rm --entrypoint /opt/verapdf/verapdf weasyprint-service \
  -f ua1 /path/to/report.pdf          # exit 0 means conformant
```

`scripts/reports/validateUa.mts` runs the same check over all ten report
formats using whatever validator `VERAPDF` points at, defaulting to the path
above.

Two facts about `pdf/ua-1` that cost time to find. It **does not** add an
OutputIntent the way the PDF/A variants do — accessibility says nothing about
colour — so `output_intent` has to be asked for by name or the file has no
colour space at all. And `pdf/a-2a` fails UA-1 on exactly one check (clause 5,
the XMP identification schema) while passing everything structural, which means
these documents satisfy both standards' content rules and can declare only one.

## Local run

```bash
cd weasyprint-service
docker build -t weasyprint-service .
docker run --rm -p 8080:8080 \
  -e WEASYPRINT_SERVICE_TOKEN=dev-token \
  weasyprint-service
curl -X POST http://localhost:8080/render \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"html":"<h1>Hello</h1>"}' \
  -D headers.txt -o out.pdf
```

The service's own tests run against the engine that shipped, inside the image —
which is the only way `/capabilities` and the font probe mean anything:

```bash
docker run --rm -v "$PWD/weasyprint-service:/tests:ro" -w /tests \
  -e WEASYPRINT_SERVICE_TOKEN=dev-token weasyprint-service \
  python -m unittest test_app -v
```

And to check a document against a running container rather than against
whatever `weasyprint` is on your PATH:

```bash
npx tsx scripts/reports/engineCheck.mts \
  --service http://localhost:8080 --token dev-token \
  --capabilities reports/html/borrowing-capacity.html
```

## The image

Two stages: a builder that installs the venv with a compiler present, and a
runtime that copies `/opt/venv` and has no compiler at all. It runs as an
unprivileged user, carries a `HEALTHCHECK`, and starts gunicorn with
`--preload` so the fork happens *after* the engine is loaded and warmed —
`warm_up()` renders a throwaway page at boot in the parent, so every worker
inherits a hot Pango and fontconfig instead of the first client's report paying
for them. `WEASYPRINT_WARMUP=0` turns that off.

> **A container change is a separate deploy from the rest of the repository.**
> `ci.yml` builds this image to test it and publishes nothing, so anything that
> lives here (the veraPDF layer, the `output_intent` and `custom_metadata`
> options, a font, an engine bump) reaches production only through
> `.github/workflows/deploy-weasyprint-service.yml` — or by hand, with the
> commands below. Changes on the other side of the boundary — the stylesheet,
> the document structure, what the render routes ask for — ship with the edge
> functions and do not wait for it.
>
> The workflow **stages** on a push and promotes only when asked, because the
> two halves have an order: the render routes ask for `pdf/ua-1`, and an engine
> without that variant returns a 500 on every report. See
> [`docs/reports/CONTAINER_RELEASE.md`](../docs/reports/CONTAINER_RELEASE.md).

## Deploy — Google Cloud Run (recommended)

> **Releasing a change rather than standing this up for the first time?** Use
> [`docs/reports/CONTAINER_RELEASE.md`](../docs/reports/CONTAINER_RELEASE.md).
> It carries the ordering constraint between this image and the render routes,
> the no-traffic canary, the rollback, and what to check in the delivered PDF.
> What follows is the first-deploy recipe.

```bash
PROJECT_ID=your-gcp-project
REGION=australia-southeast1
TOKEN=$(openssl rand -hex 32)

# --timeout: the default is 10 minutes and the veraPDF layer alone fetches a
# 33 MB installer and installs a JRE.
gcloud builds submit \
  --tag gcr.io/$PROJECT_ID/weasyprint-service \
  --timeout=1800s \
  ./weasyprint-service

gcloud run deploy weasyprint-service \
  --image gcr.io/$PROJECT_ID/weasyprint-service \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --memory 2Gi --cpu 2 \
  --concurrency 4 --timeout 600 \
  --min-instances 0 --max-instances 10 \
  --set-env-vars WEASYPRINT_SERVICE_TOKEN=$TOKEN

# Note the deployed URL, then add these as Supabase Edge Function secrets:
#   WEASYPRINT_SERVICE_URL   = https://weasyprint-service-xxxx.a.run.app
#   WEASYPRINT_SERVICE_TOKEN = <the TOKEN you generated>
```

`--allow-unauthenticated` is deliberate rather than an oversight: the service
does its own bearer-token check and refuses every request when no token is set.
Cloud Run scales to zero — typical cost is a few cents per thousand renders.

> `WEASYPRINT_API_KEY` is accepted as a **legacy alias** for the token by
> `app.py` and by `weasyprintClient.ts`, on both sides, so an environment that
> already has it keeps working. Nothing writes it and nothing should: set
> `WEASYPRINT_SERVICE_TOKEN`. The alias used to be spelled inline in these
> commands — `WEASYPRINT_SERVICE_TOKEN (or WEASYPRINT_API_KEY)=$TOKEN` — which
> made four lines of the one recipe here impossible to paste.

## Deploy — Fly.io / Railway / Render alternatives

Any container host that runs the Dockerfile works. Set the same two env vars
(`WEASYPRINT_SERVICE_TOKEN` on the service, `WEASYPRINT_SERVICE_URL` +
`WEASYPRINT_SERVICE_TOKEN` on Supabase) and you're done.

Fly.io is wired: `fly.toml` beside this file is the machine shape (one
`performance-1x` machine, one dedicated CPU, 2 GB, stopped when idle) and
`.github/workflows/deploy-render-fly.yml` builds, deploys, proves the
container and writes the two Supabase secrets from one repository secret,
`FLY_API_TOKEN`. See `docs/reports/RENDER_SERVICE_AVAILABILITY.md`.

## Edge function wiring

`supabase/functions/render-investment-report-pdf/index.ts` prefers WeasyPrint
when both secrets are set, uploads the returned bytes to the
`investment-reports` storage bucket, and returns a signed URL to the client.

**There is no fallback once WeasyPrint is configured.** `index.ts:5567` catches a
render failure and re-throws — deliberately, so a failed render cannot silently
return a Chrome-rendered PDF that looks like the old design. Api2PDF is used only
when `WEASYPRINT_SERVICE_URL`/`WEASYPRINT_SERVICE_TOKEN` are absent entirely.

The practical consequence: **this service is critical infrastructure.** If it is
down or the image is broken, report generation returns a user-visible error. An
earlier version of this file claimed the opposite.
