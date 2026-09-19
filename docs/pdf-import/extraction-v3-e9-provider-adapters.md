# PDF Extraction V3 · E9 — Governed Extraction Provider Ensemble

> **Status:** code complete. **Scope:** code-only, fully backward compatible, no
> deploy. No Google Cloud / Cloud Run / Docker build / image push / infra; no
> Document AI processor created or called; no remote VLM invoked; no external
> provider invoked; no Supabase migration or Edge Function deploy; no cloud
> credentials. Builds on merged E0–E8. Preserves every prior contract; E3/E4/E5
> stay authoritative for charts/tables/typography, E6 for composition, E7 for
> acceptance, E8 for candidate selection.

## 1. Problem statement

The system has several extraction engines (legacy Docling, isolated Docling
vNext, PyMuPDF, E4 table profiles, future Document AI/VLM) but no single governed
provider architecture. Without E9, provider integration risks: schemas leaking
through the sidecar/Edge; a provider name becoming a de-facto quality ranking;
one provider overwriting another's source evidence; provider-local IDs becoming
canonical; monolith/chunk identity drift; success reported despite page/region
loss; unbounded remote sends without residency/cost limits; a public client
choosing a provider/model/processor/region; credentials in logs; provider output
treated as truth without E3/E4/E5/E7/E8; provider confidence treated as source
accuracy; VLM/OCR inventing or normalizing critical content.

## 2. Core rule

**provider result ≠ source truth ≠ final output ≠ accepted repair.** Every result
flows: attempt → response validation → provider-neutral normalization →
source-evidence checks → E3/E4/E5 → E8 candidate pool → E6 render → E7 →
deterministic selection or fallback. No provider bypasses this flow. **SOURCE
FIDELITY OUTRANKS PROVIDER CONFIDENCE** — a high-confidence result with a
wrong-cell financial value is unsafe; a lower-editability exact source crop is
acceptable.

## 3. Non-goals

E9 does not choose production routing, activate Document AI/VLM, create
processors, change Cloud Run, replace E1 source evidence or E3–E8 authority,
infer financial values, rewrite provider text, average conflicting values, select
by confidence or provider priority alone, let a public client name a
provider/model/processor/region, store credentials or signed URLs, treat a remote
response as trusted code, add prompt-driven repair, make external calls in tests,
or assert unverified cloud availability.

## 4. Contract versions

| Contract | Version |
|---|---|
| Adapter | `extraction-provider-adapter-v1` |
| Request | `extraction-provider-request-v1` |
| Attempt | `extraction-provider-attempt-v1` |
| Result | `extraction-provider-result-v1` |
| Capability manifest | `provider-capability-manifest-v1` |
| Policy | `extraction-provider-policy-v1` |
| Evidence bundle | `provider-evidence-bundle-v1` |
| Normalization | `provider-normalization-v1` |
| Arbitration | `provider-arbitration-v1` |
| Attempt audit | `provider-attempt-audit-v1` |
| Registry | `provider-registry-v1` |

Python package `pdf-parse-service/providers/` (IMPORT-SAFE: no Docling/Torch/OCR/
Google SDK/file/secret/network at import — proven by test). Canonical shared TS
`supabase/functions/_shared/extractionProviders.pure.ts` + frontend re-export.

## 5. Provider registry + identities

Fixed allowlist: `pymupdf-exact`, `docling-standard-vnext`, `docling-vlm`,
`google-document-ai-layout`, `google-document-ai-ocr` (+ `docling-legacy` for
audit only). The registry rejects unknown/duplicate providers, creates adapters
lazily (heavy/remote runtimes load only when trusted orchestration selects them),
and never discovers plugins from untrusted packages or a client request. Provider
IDs encode no cloud project/processor/endpoint/region/model revision — those live
in the SEPARATE **configuration identity** (provider id + adapter version + engine
version + model preset + processor type/version + trusted location + ocr/table/
chart options + vlm preset + privacy policy version; never a secret).

## 6. Capability truth

Reuses the E2/J1 five-level model (apiPresent / configured / modelConfigured /
modelReady / effective). `effective` is never claimed just because a field exists.
Remote providers report `unproven` until a controlled later cloud gate; the VLM
adapter is `available:false` regardless of model readiness until proven live.

## 7. Deterministic request identity

Request IDs derive from source SHA-256 + provider id + configuration identity +
purpose + page scope + region ids/bboxes + requested capabilities + options hash +
policy hash — never timestamps, signed URLs, retry number, credentials, temp paths
or UUIDs. Retries share the request ID with a distinct deterministic attempt ID
(request id + ordinal + adapter version). Identical requests → identical IDs, across
monolith / equivalent page-bounded scope / cache replay. The TS mirror produces
**byte-identical** IDs for ASCII inputs (shared FNV-1a-32 over sorted-key JSON,
proven by the cross-runtime parity spec: `pcfg-c3d88d82`, `preq-7f616706`).

## 8. Provider policy (fail-closed)

Default: local providers enabled, ALL remote providers disabled, remote VLM
disabled, no approved locations, max remote pages/regions/bytes = 0, no public
override, explicit remote approval required. A remote provider needs EVERY
condition true (enabled + approved + trusted location + approved purpose + page/
region/byte/cost limits). Remote approval is explicit + trusted — never inferred
from a requested mode, a user prompt, provider availability, a failed local result
or an env var alone. Class-specific reasons (`provider_vlm_disabled`,
`provider_remote_not_approved`) take precedence over the generic disable.

## 9. Result + evidence bundle

`ExtractionProviderResultV1` carries exact identity, status (success / partial-
success / failure / timeout / policy-blocked / skipped / cancelled), pages/regions
requested/processed/failed, optional PRIVATE payload ref, result hash, engine
identity, timings, usage and a cost estimate. **Partial stays partial** — never
claimed complete, never cached complete, never fabricating empty pages. The raw
payload never becomes final output. Provider output normalizes into a bounded
`ProviderEvidenceBundleV1` (page evidence: text spans, layout regions, tables,
pictures, charts, formulas, code) kept SEPARATE from the canonical Source Scene
Graph, template and final output.

## 10. Provider-local IDs + coordinate/Unicode normalization

Provider evidence IDs are deterministic but provider-local (`pevd-<abbr>-p<page>-
<type>-<hash>`) and NEVER replace canonical E1 source/span/typography/E4-candidate
IDs. Coordinate normalization converts every provider into PDF points, top-left
origin, y-down, parent-global page numbers, finite page-clamped geometry, explicit
rotation — recording the source system (top-left/bottom-left/normalized/pixels/
provider/unknown) and rejecting non-finite geometry, zero-area critical regions,
off-page regions, page mismatch and unknown scale with no conversion evidence. Raw
provider text is preserved exactly; NFC + search-normalized stored separately;
critical glyphs (en/em dash, minus, ×, arrows, NBSP, currency, %, ‰, °) are never
destructively folded; OCR/VLM text never silently overwrites exact PDF text.

## 11. Provider conflict model + arbitration

15 conflict codes (text/unicode/numeric/punctuation/bbox/region-type/table-
topology/table-cell/chart-class/reading-order/page-count/page-geometry/missing-
region/extra-region/confidence). The pure arbitrator decides which evidence becomes
a CANDIDATE INPUT — never final output. A provider **never wins by name or by
confidence alone**: the lexicographic key is policy-permitted → complete scope →
**source visual agreement** → numeric integrity → punctuation integrity → table
integrity → geometry agreement → region coverage → E7 score → latency → cost →
ascending evidence id (deterministic tie-break). Provider name is absent from the
key. Blocking conflicts (numeric / table-cell / table-topology / unicode /
punctuation) force multiple-candidates/fallback until E4/E5/E7/E8 resolve them —
never resolved by averaging or by highest confidence.

## 12. Adapters

- **pymupdf-exact** (local, source evidence): exact text spans, geometry, vectors,
  images, source crops. Makes NO complex-table / chart-interpretation / OCR / VLM
  claim. `dependency-missing` when `fitz` absent.
- **docling-standard-vnext** (local): reuses the E2/J1 vNext runtime; never falls
  through to legacy; records exact version/profile/converter key; page-range aware.
- **docling-vlm** (local-only, DISABLED + UNPROVEN by default): remote services /
  external plugins / trust_remote_code all hard-wired false; no arbitrary prompt,
  no client model/options; never `effective` until a live gate; VLM output is
  untrusted candidate evidence that can never overwrite exact numeric source.
- **google-document-ai-layout** + **-ocr** (remote, POLICY-DISABLED by default):
  injected-client protocol + trusted server processor config only; **no live API
  invoked in E9**, state stays `unproven`; the adapter constructs no processor
  resource from client input and never logs it; layout tables normalize through
  E4, text is supplemental to E5, visuals supplemental to E3; OCR is page-bounded
  (rejects a full-document send) and preserves exact Unicode.

## 13. Optional dependencies

The default local CPU image does NOT require the Google SDK. Google adapters use a
pure injected-client protocol + a plain-mapping response normalizer; a real SDK is
an OPTIONAL later extra (pinned, kept out of the standard target, import-isolated).
Importing the `providers` package pulls no heavy/remote dependency (proven).

## 14. Attempt runner + timeouts + retries + cost

The bounded runner resolves the adapter (rejects unknown), gates policy fail-closed
(NO network on block), validates the request, enforces limits, creates the
deterministic attempt identity, executes with a timeout, maps ALL exceptions to
bounded safe codes (never leaking payload/creds), normalizes + hashes the result,
and audits. Retries share the provider configuration — a different provider/model/
processor/region/profile is a NEW audited candidate, not a retry (rerouting is
E10). Timing/retry controls are injected (no sleeping in tests). Cost uses a
trusted rate card only; unavailable → `amount: null, estimateState: 'unknown'`
(unknown ≠ zero); cost is secondary and never overrides fidelity or privacy.

## 15. E3/E4/E5/E7/E8 integration

Provider tables normalize through `table-candidate-contract-v1` (E4 decides
native/crop/fallback/blocked; provider confidence diagnostic only; Document AI
tables get no special priority). Provider text/typography enters E5 as supplemental
(exact source glyph evidence stays authoritative; OCR/VLM cannot override without
proof). Provider chart/picture output is metadata only — E3 keeps the exact crop;
VLM can never invent chart values. Every provider-backed output candidate is
rendered through E6 + evaluated by E7 (confidence is not a compensating score; a
hard-defect candidate is rejected; an unscored candidate is rejected). Provider
evidence enters E8 as one candidate source (with evidence id, result hash, attempt
id, source refs, E4/E5 refs, policy hash, cost, elapsed); E8 keeps candidate
rendering, E7 evaluation, defect delta, selection, fallback and the two-pass cap.
E9 creates no second candidate-selection engine.

## 16. Chunk / recovery / cache handoff

Provider identity (id + configuration identity + request id + attempt id + policy
hash + scope) is stable across monolith / chunk / recovered chunk / duplicate
callback / parent finalize / cache replay. Recovery never silently changes
provider. Parent-global evidence carries no chunk-local page ids/paths; provider-
local refs stay provider-local; canonical source IDs stay parent-global. The cache
fingerprint is NOT activated in E9 — E10 must add: registry version, adapter
versions, configuration identities, policy version/hash, normalization version,
arbitration version, Docling package/model versions, OCR backend, table profile
set, VLM preset, Document AI processor type/version/location identity, privacy/
residency policy, and the E1–E8 contract versions. A pre-E9 cache cannot fabricate
provider evidence; a partial result cannot be reused as complete; one provider
configuration cannot satisfy another.

## 17. Security

Fixed trusted allowlist; public clients cannot choose provider/model/processor/
location or override privacy policy; credentials never enter contracts or logs;
signed/Blob/object URLs never persist (validators reject); raw payload is private +
redacted (creds/headers/endpoint identifiers); artifact paths manifest-derived, no
traversal; no arbitrary endpoint/field-mask/VLM prompt/generation options;
trust_remote_code + external plugins false; remote VLM + Google adapters disabled
by default; provider output treated as untrusted data; code/formulas never
executed; errors bounded; source text + financial values excluded from audit; cost
limits enforced before any remote call; temporary files deleted.

## 18. Tests

- **Python (27, offline):** versions; import-safety (no torch/docling/fitz at
  import); registry allowlist/unknown/duplicate/lazy; deterministic request/attempt/
  config identities (url-free, config change → new id); fail-closed policy (remote/
  vlm disabled by default; remote enabled still needs approval + location + purpose +
  limits); capability truth (api≠effective, vlm never available, remote unproven);
  coordinate normalization (top-left/bottom-left/normalized/pixels-need-scale/off-
  page/zero-area-critical); Unicode preservation + critical-glyph signature;
  provider-local evidence ids (never canonical); arbitration (name/confidence can't
  win, numeric conflict blocks auto-preference, agreement, deterministic id tie-
  break); adapters (pymupdf success, docling partial stays partial, google blocked-
  by-default with ZERO client calls, google with remote policy uses the INJECTED
  fake only — never live, OCR page-bounded rejects full doc, exception → safe code
  with no secret leak); privacy-safe audit.
- **TypeScript (9):** versions + allowlist; fail-closed default policy + gate;
  persisted-shape validators (wrong version / signed URL / raw buffer; durablePath
  allowed); **cross-runtime identity parity** (fnv, config identity, request id all
  byte-identical to the Python producer).
- All 357 existing offline sidecar tests (E0/E1/E2/E3/E4/E5 + J1-pure) remain green;
  E9 adds zero new failures. (`test_j1_runtime_wiring.py` needs `httpx`, absent in
  this env — pre-existing, unrelated to E9.)

## 19. Diagnostics + limits

Bounded document/page/region provider summaries (attempts, success/partial/failed/
policy-blocked, local/remote, pages/regions, cost total, elapsed, selected
candidates, unresolved conflicts) — no raw payload, source text, financial values,
credentials, processor resource or signed URLs. Explicit limits: attempts/page,
attempts/job, pages/regions/bytes per attempt, normalized spans/regions/tables/
cells, payload/retention bytes, timeout, retries, candidate artifacts, cost;
**remote concurrency = 0, remote attempts = 0** by default. Limit exceeded →
request blocked + local/page fallback, never silent truncation. Additive namespaced
timings; Operational Metrics V1 unchanged.

## 20. Private-report operator checklist

Do not commit/transmit the private report during E9; do not invoke a remote
provider with it. For a later controlled validation confirm: local attempts fully
audited; no remote provider without explicit approval; exact pages/regions recorded;
no full-document remote send for a page-local defect; provider output stays
candidate evidence; every selected provider candidate passed E4/E5/E7/E8; unresolved
conflicts visible; no confidence override; no provider-local ID canonical; no
payload exposed; no signed URL persisted. Chart pages: metadata may enrich, exact
E3 crop is the visual output, VLM cannot invent values. Table pages: multiple
candidates considered, wrong-cell rejected, tables stay tied to independent source
regions, E4 authoritative. Typography: exact source punctuation authoritative, OCR/
VLM cannot replace en dash/minus/× without proof. Scanned: local OCR first, remote
OCR disabled until approved + page-bounded.

## 21. Deployment scope (NOT performed)

Later controlled work (E10 + a Google Cloud gate) wires the ensemble into
production routing, adds the optional Google SDK extra to an approved image,
provisions/validates a Document AI processor in an approved region, proves the VLM
model, and activates the E10 cache fingerprint. No migration (audit/summary is
additive JSON). No Edge Function or sidecar deploy here.

## 22. E10 / E11 / E12 handoff

- **E10:** consume the registry, capabilities, policy, configuration identities,
  scope support, cost estimates, timeouts, privacy/residency requirements, adapter
  versions, result hashes and candidate/audit refs — E9 activates no routing.
  Future service classes: fast local CPU, heavy local/approved CPU, approved
  Document AI, approved VLM, raster-only. No hard-coded cloud URLs; no resources.
- **E11:** display provider attempts / pages / purpose / status / conflicts / cost /
  elapsed / candidate outcome / fallback — never raw payload or secret identifiers.
- **E12:** formalize release gates — no unapproved remote attempt, audit complete,
  candidate source trace complete, selected provider candidate passed E7/E8, no
  unresolved numeric/table conflict, remote tests use controlled fixtures/approved
  resources, local-only profile fully functional.

## 23. Known limitations (not hidden)

- No real Google SDK is added; the adapters use the injected-client protocol +
  synthetic responses. Live execution is `unproven` until a controlled cloud gate;
  E9 asserts no cloud region/processor availability.
- The VLM adapter ships disabled + unproven with a fake-runtime test path only; no
  model is downloaded.
- Real PyMuPDF/Docling execution paths are gated on the dependency being present +
  source bytes; offline tests drive them via injected synthetic payloads (the
  contract, identity, normalization and arbitration logic is what E9 proves).
- The cross-runtime identity parity holds for ASCII inputs (ids/hashes/sha are
  ASCII); non-ASCII text is hashed per-runtime but never used as an identity input.
