# The Builder Stock image worker — overlay inpainting on Cloudflare Workers AI

Read this before touching `_shared/builderStock/inpaintOverlay.ts`, anything in
`cloudflare/builder-stock-image-worker/`, or the environment variables named
below.

## Why it exists

Builder Stock's overlay repair has two routes and the order is fixed:
deterministic reconstruction first (`sanitizeOverlay.pure.ts` — arithmetic, no
model), and masked inpainting only where the deterministic route refuses
(`background_too_detailed` / `too_much_to_rebuild`). The inpainting route used
to POST each patch to OpenAI's `images/edits` on a forwarded `OPENAI_API_KEY` —
a per-image bill on somebody else's credit, and a production outage the day
that account ran dry (the settler's own comments still record the 429s:
*"You have no credits remaining"*, every tick, for hours).

The route now calls **`cloudflare/builder-stock-image-worker/`** — a private
Cloudflare Worker this repository ships, which runs the repair on **Cloudflare
Workers AI** through the account's own AI binding. The platform already runs on
Cloudflare; there is **no Docker, no container, no VM, no Python server and no
separately managed compute anywhere** — the Worker is ~300 lines of TypeScript
deployed with `wrangler deploy`, and the model is hosted by Cloudflare behind
the binding. There is deliberately **no fallback to any external endpoint**:
`inpaintOverlay.ts` contains no OpenAI/Gemini/Replicate/Stability/Hugging Face
URL, key or model name, the Worker's source contains **no URL at all**, and
tests read both sources and fail if one returns.

> An earlier revision of this change shipped the same endpoint as a
> plain-Python ONNX (LaMa) service in `builder-stock-image-worker/`. It was
> never deployed and is deleted — the wire contract it defined is what the
> Cloudflare Worker now implements, so the Supabase side barely moved.

## Order of the whole stage (and where each step is decided)

1. **Clean builder-supplied image first.** Decided in `repairSourceImages.ts`
   (a convicted promotional cover no longer stops same-property package
   discovery — and cross-property/cross-lot sourcing stays forbidden), in
   `chooseDisplayableImage` (a clean original outranks a sanitized
   derivative), and in `settleImageSanitization.ts` (a property that already
   serves a proven clean primary gets **no** repair spend at all).
2. **Deterministic repair second.** Unchanged.
3. **This worker third.** Same mask, same original bytes, same gates.
4. **Manual/failed state** only when all of the above refuse — recorded as a
   `sanitization_failure`, original preserved, nothing else ever substituted.

Marketplace serving reads only **stored** images (originals, clearances,
sanitized derivatives); a page load can never reach this worker or Workers AI.

## The calling contract

`inpaintOverlay.ts` cuts one square patch per detected graphic (unchanged
geometry — plan, merge, coverage check), resamples it to **512** (the
inpainting model's own native edge), and POSTs `multipart/form-data` to
`${BUILDER_STOCK_IMAGE_WORKER_URL}/v1/inpaint`:

- `image`: PNG of the patch — that property's own pixels and nothing else;
- `mask`: PNG, **white = rebuild**, black = leave alone;
- `Authorization: Bearer ${BUILDER_STOCK_IMAGE_WORKER_TOKEN}`.

The worker answers `image/png` plus an `x-inpaint-model` header, which is
what the derivative record stores as `model`. The call goes through
`meteredFetch` with an explicit `secretName`, exactly like the WeasyPrint and
PDF-parse sidecars: the token is the workspace's own service secret, never a
forwarded vendor key, so Mission Control rates the usage at nothing — the
binding in `apiUsageBilling.pure.ts` exists so the call is visible in the
ledger, not so anyone is billed.

## The worker itself

`cloudflare/builder-stock-image-worker/src/index.ts`, configured by
`wrangler.jsonc` (name, entry point, compatibility date, and the AI binding —
nothing else; no account ids or secrets in source). What it enforces:

- **Fail-closed bearer auth.** No configured secret → every request 401;
  missing, malformed or wrong token → 401 before anything is parsed; the
  comparison is constant-time (SHA-256 digests, XOR-compared).
- **Exactly two parts.** `image` and `mask`, both PNG, equal dimensions,
  256–2048 px per edge. A request carrying anything else — a `prompt`, a
  `reference`, a `url` — is **refused**, not ignored: there is no field
  through which a caller can soften the instruction or smuggle in a second
  picture. The worker performs no lookup, no fetch and no storage; property
  isolation is structural.
- **One model, pinned.** `env.AI.run('@cf/runwayml/stable-diffusion-v1-5-inpainting', …)`
  with the patch bytes, the mask bytes, the patch's own width/height, and a
  **pinned prompt** (see below). Model faults answer 502 JSON — operational,
  never an image.

### The model — verified current, and what the prompt is for

`@cf/runwayml/stable-diffusion-v1-5-inpainting` was verified against the live
Workers AI catalog when this was written: Cloudflare-hosted, in Beta, **not**
deprecated, and the catalog's **only dedicated masked-inpainting model** — the
other image models (`sdxl-base`, `sdxl-lightning`, the FLUX.2 family) are
text-to-image and take no mask. If Cloudflare ever retires it, replace it with
whatever masked-inpainting model succeeds it — never a general text-to-image
model — and update `INPAINT_MODEL` in the Worker (the Supabase constant of the
same name is only the provenance fallback; the header wins).

Unlike LaMa (the deleted Python plan), this model family requires a text
prompt. The prompt is a **constant in the Worker's reviewed source**, asks
only for the surrounding scene to be continued, and cannot arrive in a
request; the negative prompt names the promotional artefacts so the model
does not paint a new badge into the hole. But prompt wording is not what the
safety rests on — that is the fences below, which are arithmetic.

## The three fences between the model's output and a card

1. the client composites the returned patch **only under `blendWeights`**
   (mask + 2 px feather) — nothing outside the mask is ever *read* from the
   model's answer, so a re-lit, re-framed or entirely different picture
   changes nothing outside the badge;
2. `outsidePermittedRegionUnchanged` then checks the whole frame against the
   bytes that came out of storage — **zero changed pixels is the only pass**,
   and there is no tolerance to relax;
3. the result goes back through the same marketing-overlay classifier that
   convicted the original, and `still_annotated` is a refusal — the rejected
   render is kept under `rejected/` for inspection and no derivative record
   is written, so no card can reach it.

## Failure behaviour (unchanged on purpose)

- No `BUILDER_STOCK_IMAGE_WORKER_URL` configured → `inpaint_unavailable`.
- Worker unreachable / 401 / 5xx / undecodable answer → `inpaint_failed`.

Both are **operational** to `settleImageSanitization.ts`: nothing is written,
the upload's marker does not advance, the row cools down for ten minutes and
is retried — an outage can never become a permanent verdict about a
photograph, and nothing ever substitutes another image. Retries are budgeted
(two repairs per tick, spent on the rows that have waited longest), so a
large upload drains through the background settlement sweep at its own pace:
of 500 properties, only the images that genuinely reach stage 3 ever produce
a Workers AI run.

## Deployment — needs explicit approval; NOTHING has been deployed

```sh
cd cloudflare/builder-stock-image-worker
npx wrangler deploy                                        # prints the workers.dev URL
npx wrangler secret put BUILDER_STOCK_IMAGE_WORKER_TOKEN   # long random string
```

Then set the **same** two values as Supabase Edge Function secrets:
`BUILDER_STOCK_IMAGE_WORKER_URL` (the printed URL, no trailing slash, no
path) and `BUILDER_STOCK_IMAGE_WORKER_TOKEN`. Nothing else — the settlement
sweep already runs, and its next tick's generative-route candidates go to the
worker. The token never reaches a browser: it exists only as a Supabase Edge
Function secret and a Cloudflare Worker secret.

Workers AI usage is billed by Cloudflare in neurons against the account's own
Workers AI allowance/plan (this model is priced per step) — the workspace's
own account, no forwarded vendor key, which is why the metering binding rates
it at nothing.

Until both secrets exist, the generative route reports `inpaint_unavailable`
and stays retryable — the deterministic route, clean-source precedence, and
all serving behaviour work regardless.

---

# `POST /v1/classify` — what a picture shows

The second endpoint on the same worker, behind the same bearer, calling the
same binding. It exists for one measured case and is deliberately unable to do
anything else.

## The case

Of thirteen Luxton rows carrying a brochure link, eleven resolve a primary
image deterministically (see
[`FILLED_TEMPLATE_BROCHURES.md`](./FILLED_TEMPLATE_BROCHURES.md)). Two do not,
and they fail for a reason no rule about documents can settle: their cover page
— the page whose text states the lot, the address and the price — presents
three rasters, and **the document says nothing about which is the house**.

| lot 313 / 318, page 2 | what it is |
|---|---|
| 480x339 JPEG, 17% of the page | the facade render |
| 3423x1588 JPEG, 3% of the page | the Luxton wordmark, white on black |
| 466x867 JPEG, 13% of the page | the floor plan |

Every deterministic discriminator points the wrong way. The **largest by
pixels** is the wordmark. The **only one passing the pixel floor** is the
wordmark. A filename hint would not help — this repository has already had a
"pick the best photo" rule promote an agency logo over a photograph on two real
listings, because a logo lockup is called a *main* lockup.

So the question is semantic, and this endpoint answers exactly that question
and no other.

## The contract

```
POST /v1/classify
Authorization: Bearer <BUILDER_STOCK_IMAGE_WORKER_TOKEN>
Content-Type: multipart/form-data

image-<key>: one picture        (at most 6 parts, ≤3 MB each, ≤10 MB total)
```

The key is the caller's own — Builder Stock sends `<objectNumber>:<name>` — and
comes back verbatim.

```json
{
  "model": "@cf/meta/llama-4-scout-17b-16e-instruct",
  "verdicts": [
    { "key": "34:X13", "subject": "shows_house_exterior", "confident": true,  "unavailable": null },
    { "key": "35:X14", "subject": "shows_logo",           "confident": true,  "unavailable": null },
    { "key": "76:X21", "subject": null, "confident": false, "unavailable": "the model could not be reached (…)" }
  ]
}
```

`x-classify-model` and `x-classify-transport` name what ran.

## The rules

**Pictures only.** A part named anything but `image-<key>` is refused rather
than ignored, so there is no field through which a caller can name a lot, an
estate or a design. A classifier that has been told what to look for will find
it. The wording is a constant in the reviewed source and a test fails on any
interpolation in its declaration.

**The vocabulary is closed and shares no value with the role vocabulary.**
Every subject is prefixed `shows_`, because `sourceImageRole.pure.ts` already
spells `site_plan`, `interior` and `floorplan` — a subject is a fact about
pixels, a role is a conclusion about a document, and the second is never
inferred from the first alone. The prefix is also what makes the last-resort
keyword scan safe: `shows_floor_plan` is not a phrase English produces by
accident.

**Only one subject can promote.** `shows_house_exterior`. The other eight can
only demote, so a verdict that is wrong in any other direction costs a property
nothing it had.

**One picture per model call.** A single call about six pictures answers in one
list, and a list that comes back short, long or reordered is a verdict attached
to the wrong photograph — undetectable from the answer. Six calls cost six
calls; a misattributed hero costs a client's card. The batching is at the
request, which is what lets the caller chunk.

**Nothing is invented.** An unreachable model, an unparseable body, a word
outside the vocabulary, or a sentence naming two of them all produce
`subject: null`. Confidence that is not stated is not confidence. A batch of
which *nothing* was answered is `502` — operational, retry it — because
recording "this document contains no house" on the strength of a rate limiter
is the failure this whole subsystem exists to prevent.

**The transport is found, not guessed.** Cloudflare's catalog documents
OpenAI-shaped content parts for its multimodal models and a top-level `image`
field for the older vision ones, and does not say which this model takes.
Guessing would fail *silently* — every verdict absent, which reads exactly like
a model with no opinion — so both shapes are attempted, the one that answers is
reused for the rest of the request, and the response header says which ran.

## Deploying it

The endpoint ships with the worker; there is no separate deploy and no new
secret.

```sh
cd cloudflare/builder-stock-image-worker
npx wrangler deploy
```

### Verifying it against real pictures

The endpoint is only worth turning on if it is right about **this repository's
own documents**, and no test with a stub binding can show that: a stub answers
whatever the test wrote. So the acceptance test is a script that runs the real
thing — the repository's own reader picks the page and pulls the rasters out of
it, and the deployed worker's own model says what each one shows.

```sh
deno run -A scripts/builder-stock/classify-brochure-page.ts \
  --pdf ./Thornhill-Gardens-Lot-313.pdf \
  --label "Lot 313, Thornhill Gardens, Thornhill Park" \
  --worker https://builder-stock-image-worker.<subdomain>.workers.dev \
  --token "$BUILDER_STOCK_IMAGE_WORKER_TOKEN"
```

```
  the document designates visible page 2 as this property's cover
  3 raster(s) on that page; asking the worker what each shows

  -> obj34     480x339 DCTDecode          shows_house_exterior
     obj35     3423x1588 DCTDecode        shows_logo
     obj76     466x867 DCTDecode          shows_floor_plan

  PASS — exactly one raster on this page is a house from the street.
```

It writes nothing, reaches no database and changes no property: the pictures go
to the worker and the verdicts come back to the terminal.

**Passing is exactly one** `shows_house_exterior` with `confident: true`. Zero
is a classifier that cannot help here; two is a classifier that would be making
the choice by coin toss. Both are reasons to leave it out of the selection path
— not reasons to soften the rule that consults it, and not reasons to take the
first of two.

The script deliberately applies **no pixel or page-share floor** to the set it
asks about, because those floors are what cannot be applied here: on the
brochure that made this necessary the facade render is 480x339 and fails the
pixel floor, while the wordmark is 3423x1588 and passes it. That is also why
widening discovery is only safe where something else can narrow it again —
admitting the render admits the floor plan too.
