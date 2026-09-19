# PDF Extraction V3 · E11 — Review Workspace, Operator Controls and Diagnostics

> **Status:** CODE ONLY · additive · fully backward compatible · no deploy. Builds on the merged
> E0–E10 foundation; consumes their decisions as authority and never rederives them.

## 1. Problem statement

The extraction architecture now produces extensive evidence and decisions (source scene, chart/table/
typography fidelity, region output policy, hard-fail quality gate, deterministic repair, provider
ensemble, planner/routing/cache). But that evidence was fragmented across raw metadata, private
artifacts, review dialogs and admin diagnostics. E11 builds ONE coherent review-and-diagnostic layer
so an operator can answer "why does this page look like this?" within one or two interactions.

## 2. Non-goals

E11 does NOT recompute Plan V3, reclassify page complexity, recompute cache fingerprints, re-arbitrate
tables, re-resolve typography, re-score providers, re-run quality in the UI, select repair candidates
in the UI, execute arbitrary patches, accept a service URL / processor id / provider model, expose
credentials or private paths, persist signed URLs, present provider confidence as quality, or activate
remote/multi-service routing. It does not rebuild the report editor and does not perform E12 golden-
corpus automation.

## 3. UI safety principle

The UI **displays and invokes** existing decisions. It must not rederive source truth, table
integrity, typography safety, quality acceptance, repair-candidate selection, provider arbitration,
service routing or cache validity. Every displayed value has an authority source (see §6).

## 4. Contract versions

| Contract | Version |
|---|---|
| Review workspace | `pdf-review-workspace-v1` |
| Diagnostics view model | `pdf-diagnostics-view-model-v1` |
| Document review model | `pdf-document-review-model-v1` |
| Page review model | `pdf-page-review-model-v1` |
| Region review model | `pdf-region-review-model-v1` |
| Review action | `pdf-review-action-v1` |
| Review action result | `pdf-review-action-result-v1` |
| Artifact viewer model | `pdf-artifact-viewer-model-v1` |

All defined in `src/lib/reportTemplate/pdfImport/review/contracts.ts`.

## 5. Five separate axes (never one headline score)

The overview presents five distinct axes and never collapses them:

1. **Extraction completeness** — did the engines produce the required source + candidate evidence?
2. **Source fidelity** — how accurately does the final output preserve the source (E7 scores)?
3. **Final-output safety** — did E7 find any unresolved hard defect? (visually dominant over scores)
4. **Editability** — how much of the final output remains safely editable?
5. **Cost and performance** — what service/provider attempts, time and estimated cost were used?

## 6. Authority mapping

Every view-model field traces to an authoritative upstream contract:

| View-model field | Authority |
|---|---|
| page/region output strategy, ownership, crop role | **E6** region output policy + render plan |
| page/region score, hard defects, recommended action, coverage, export parity | **E7** quality report V2 + critical defects |
| chart type / detection / suppression / representation | **E3** chart preservation |
| table candidate / integrity / arbitration | **E4** table arbitration + integrity |
| font resolution / glyph / Unicode / punctuation | **E5** typography fidelity |
| provider attempts / scope / conflicts / confidence | **E9** provider attempt audit + arbitration |
| repair passes / selected + rejected candidates | **E8** repair audit + selection |
| complexity class / service class / route reason / cache / recovery | **E10** Plan V3 / routing audit / cache entry / completeness / recovery plan |

The pure builders (`buildDocumentReviewModel`, `buildPageReviewModel`, `buildRegionReviewModel`,
`buildDiagnosticsSummary`) only copy and aggregate; they never compute a decision. `null` stays `null`
(unavailable), never `0`; fidelity, final-output safety and editability stay separate; provider
confidence is never presented as quality.

## 7. Information architecture

Desktop is a three-panel workspace: LEFT rail (document summary + virtualized page navigator), CENTER
(source / browser-final / export-final / diff comparison viewer), RIGHT inspector (page/region detail,
quality, output strategy, defects, table/chart/typography/composition/repair/provider/routing/cache
tabs). It collapses to a single-column stack on small screens.

## 8. Editability formula

Editability is computed from **authoritative** region/page strategies, never from visual similarity:

```
document editable page ratio  = pages with any editable region ÷ total pages
document editable region ratio = editable regions ÷ total represented regions
page editability percentage    = editable regions ÷ represented regions
                                 (raster-only page → 0%; no regions & not raster → null)
```

A `source-crop` region is not editable; a `native` region is. A raster-only page is 0% editable (a
deliberate, truthful zero — distinct from an unavailable `null`).

## 9. Lazy artifact hydration

`usePdfReviewArtifacts` signs and hydrates only the requested `(page, region, kind)` artifacts —
never all pages, never an arbitrary path. The client sends only bounded selection fields
(`ArtifactSelectionRequest`); the server resolves the trusted, manifest-derived path and signs it. The
hydrated URL is **runtime-only**: held in a ref-backed map, never in React Query persistence,
localStorage/sessionStorage or logs; concurrent requests are de-duplicated; stale page requests are
cancelled; object/blob URLs are revoked and the map cleared on unmount. The signer is **injected**, so
the hook never hardcodes an endpoint and is testable without a live backend.

## 10. Operator actions (server-authorized)

The client BUILDS a `PdfReviewActionV1` and applies UX guardrails, but the SERVER is the sole
authority: it derives the actor identity (never client-supplied), re-checks permission, validates
expected-state hashes and applies the change.

- **accept-automatic** — preserves the automatic E6/E7/E8 decision, records review, creates no override,
  never erases hard defects.
- **force-native** — high risk: operator-only, requires hard-defect acknowledgement + a reason; hard
  defects are preserved in all reports; the automatic gate remains **failed** (E12 must not treat it as
  an automatic pass); not permitted on a raster-only page without a native candidate.
- **force-source-crop** — only when a valid crop exists (guarded client-side + server-side).
- **force-page-raster** — only when a valid source raster exists.
- **restore-automatic** — supersedes an override and recomputes from current authoritative evidence.
- **preview-native-reconstruction / show-source-reference** — review-workspace-only, never final output.
- **request-provider-recovery** — carries only a **server-issued option id**; the client never supplies
  a provider id, URL, processor id or model. Remote options stay disabled unless approved; a provider
  change creates an E10 recovery plan (a reroute), not a simple retry.
- **request-same-target-retry** — only when E10 declares it eligible; creates a new attempt identity
  only, never alters routing.

## 11. Manual repair

E11 introduces **no** automatic AI repair. Manual AI repair is gated by
`ReviewPermissionSnapshot.manualRepairConfigured` — surfaced only when a secure, authenticated,
page-scoped backend action already exists; otherwise the control is disabled ("Manual AI repair not
configured"). No insecure endpoint is created.

## 12. Legacy support

Imports predating V3 evidence map through the same builders with `legacyState` = `legacy-v1` /
`legacy-v2` / `v3-partial`. Unsupported sections read "Not recorded for this import"; nothing is shown
as `0` where the value is unavailable; V3-only operator actions are hidden for legacy imports. Old
imports are never mutated into fake V3 records.

## 13. Status language

Precise labels only (`statusLanguage.ts`): e.g. "Automatically accepted", "Accepted with review
required", "Mixed output — exact source crops used", "Raster-only page", "Blocked — no safe final
output", "Provider attempt policy-blocked", "Cache hit — artifact complete", "Cache rejected — missing
artifacts", "Same-target retry (same plan)", "Reroute — new plan and fingerprint". No "good/bad/fixed/
AI score/confidence".

## 14. Performance

The page navigator windows large lists (deterministic scroll-window above 30 pages; small lists render
fully), so 25- and 80-page documents never mount every row. Artifacts hydrate only for the active page.
Page models are built on demand for the selected page. Advanced raw JSON is an on-demand developer
drawer, never the primary experience.

## 15. Accessibility

Keyboard navigation (Up/Down select, "d" next hard-defect page, "u" next unreviewed page), visible
focus rings, semantic buttons, ARIA `listbox`/`option`/`tab` roles, per-page screen-reader summaries
("Page 7, mixed output, two hard defects, review required."), colour never the sole state indicator
(icons + text accompany every tone).

## 16. Security & privacy

Diagnostics require authentication; admin diagnostics require server-verified admin permission; import
review is ownership/tenant scoped; mutating actions are server-authorized with a server-derived actor.
Clients cannot set provider / service class / target / processor / model / location or submit arbitrary
artifact paths (paths come from trusted manifests). Signed URLs stay runtime-only (never logged,
persisted or dehydrated into query state); object URLs are revoked. `validatePersistableModel` rejects
any signed URL / raw buffer / private path before a model could be persisted. No raw provider payloads,
font binaries, endpoint URLs, processor resources or credentials are exposed.

## 17. Generated fixtures

`fixtures.ts` provides deterministic, privacy-safe authority inputs (native accepted, mixed-review,
chart/table/typography crops, raster-only, blocked, legacy V1/V2, and large 25/80-page documents) — no
private PDF, source text, financial value, signed URL, credential or artifact path.

## 18. Private-report acceptance checklist

The private report is exercised later only through an authorized local/staging review. The checklist
(document overview, page navigation, chart/table/typography pages, repair, provider, planner/cache,
actions) is enumerated in the E11 execution prompt and satisfied by the view-model + component layers;
no private content is committed.

## 19. Files

- **Pure layer** `src/lib/reportTemplate/pdfImport/review/`: `contracts.ts`, `authority.ts`,
  `buildRegionReviewModel.ts`, `buildPageReviewModel.ts`, `buildDocumentReviewModel.ts`,
  `buildDiagnosticsSummary.ts`, `reviewActions.ts`, `artifactSelection.ts`, `permissions.ts`,
  `validators.ts`, `statusLanguage.ts`, `fixtures.ts`, `index.ts`; spec `__tests__/reviewModels.pure.spec.ts` (30).
- **Components** `src/components/templateBuilder/review/`: `usePdfReviewArtifacts.ts`, `reviewTone.ts`,
  `PdfDocumentOverview.tsx`, `PdfPageNavigator.tsx`, `PdfComparisonViewer.tsx`, `PdfPageInspector.tsx`,
  `PdfReviewWorkspace.tsx`; tests `__tests__/PdfReviewWorkspace.test.tsx` (9), `__tests__/usePdfReviewArtifacts.test.tsx` (7).

## 20. E12 handoff

E11 exposes stable machine-readable states + `data-testid`s for the golden corpus:
`pdf-review-document-status`, `pdf-review-page-list`, `pdf-review-page-<n>`, `pdf-review-source-view`,
`pdf-review-browser-view`, `pdf-review-export-view`, `pdf-review-diff-view`, `pdf-review-region-<id>`,
`pdf-review-hard-defect-<code>`, `pdf-review-output-strategy`, `pdf-review-provider-attempt`,
`pdf-review-cache-status`, `pdf-review-artifact-completeness`, `pdf-review-repair-candidate`. E12 must
not depend on CSS classes or human-readable text alone. The full golden corpus is NOT implemented here.

## 21. Deployment scope

No migration, no Edge Function deploy, no Cloud Run / Google Cloud change, no remote provider or
multi-service routing activation, no production data/storage mutation. E11 is code-only and additive;
the review workspace is a presentational layer over already-computed decisions, ready to be wired into
the existing review + admin-diagnostics routes.

## 22. Known limitations

- The workspace components are the coherent core (overview, navigator, comparison viewer, inspector
  tabs) plus the lazy artifact hook; the remaining inspector depth (dedicated chart/typography/
  composition/recovery sub-panels, region-overlay canvas, admin-list wiring) is scaffolded via the
  view-models and stable test IDs and is a bounded follow-up.
- Real-Chromium end-to-end coverage (open-from-card, editor deep-link, expired-artifact recovery) is
  handed to E12's golden/e2e automation; E11 proves the workflow states via jsdom component tests + the
  pure view-model suite. No production route is activated.
