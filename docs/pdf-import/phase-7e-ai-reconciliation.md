# PDF Import Phase 7E — AI Reconciliation Integration

## 1. Objective

Integrate the existing AI/design-agent reconciliation capability into the PDF
import Visual QA / Repair workflow in a controlled, auditable, user-confirmed way.
After Visual QA and deterministic Repair have run, the review surface now advises
whether an AI reconciliation pass is worth running, lets the user run it on demand,
updates the **review draft only**, and records an audit summary.

## 2. Why it exists

Deterministic repair improves certain layout issues, but some complex rendering
defects require an AI/design-agent reconciliation pass. Phase 7E makes that pass:

- **recommended by quality signals** (not guesswork),
- **user-confirmed** (never auto-run, never auto-applied),
- **auditable** (a compact summary persists to `template_imports.meta`),
- **non-destructive** (the live `report_templates` record is untouched until the
  user explicitly applies the current draft).

## 3. Policy thresholds

Defined in `reconciliationPolicy.ts` (`DEFAULT_RECONCILIATION_THRESHOLDS`):

- `highQuality`: **0.92** — at/above this, reconciliation is `not_needed`.
- `minimumAcceptable`: **0.80** — at/above (but below high) it is `optional`; below it is `recommended`.

The score used is the repaired `finalScore` when available, otherwise the Visual
QA `overallScore`.

## 4. Recommendation states

| State | Meaning | Action shown |
|-------|---------|--------------|
| `not_needed` | Score ≥ 0.92 | no |
| `optional` | 0.80 ≤ score < 0.92, or score unavailable but source rasters exist | yes |
| `recommended` | Score < 0.80, or deterministic repair `failed` | yes |
| `manual_review` | Visual QA flagged manual review, repair required fallback, **or** source rasters are missing | yes (except missing rasters → no) |

`shouldAutoRun` is **always false** in Phase 7E.

## 5. User-confirmation rule

AI reconciliation **never auto-applies to live templates.** It updates the in-memory
review draft only. The user must explicitly **Apply** (which writes a new
`report_templates` version) for any change to reach the live template.

## 6. UI behavior

- The **AI reconciliation** card appears in the Import Review dialog once a Visual QA
  and/or Repair summary exists.
- It shows a recommendation **badge** (Not needed / Optional / Recommended / Manual
  review) and a plain-language reason.
- When the policy says so (`shouldShowAction`), a **Run AI reconciliation** button is
  shown. While running it reads **Reconciling…**.
- On success the draft is updated and the card shows editable-element / layout-change
  / warning counts plus **"Rerun Visual QA before applying the reconciled template."**
- **Apply** is enabled only when a current-session draft (repaired *or* reconciled) is
  ready — reopening an old audit alone never enables Apply.

Rerunning Visual QA after reconciliation re-scores the *reconciled* draft, so the
score the user applies against reflects the reconciliation.

## 7. Metadata contract

`template_imports.meta.ai_reconciliation_summary` (persisted via the existing secure
`append_meta` edge operation):

- `version` — `ai-reconciliation-summary-v1`
- `status` — `not_run` \| `completed` \| `failed`
- `recommendation` — the policy recommendation at run time
- `reason` — the policy reason
- `startedAt`
- `completedAt`
- `failedAt`
- `errorMessage`
- `visualQaScoreBefore`
- `repairFinalScoreBefore`
- `visualQaScoreAfter`
- `editableElementsCreated`
- `layoutChanges`
- `warnings`

## 8. Manual validation flow

```
Import PDF
→ Review quality
→ Run Visual QA
→ Run Repair
→ Check AI reconciliation recommendation
→ Run AI reconciliation
→ Confirm draft updates
→ Rerun Visual QA
→ Apply repaired/reconciled template
→ Confirm editor opens
→ Run SQL check
```

SQL: `scripts/regression/pdf-import-phase-7e-ai-reconciliation-check.sql`.

## 9. Known limitations

- AI reconciliation is **assistive, not authoritative** — no guarantee of a perfect
  result.
- Manual review is still required for `manual_review` (manual-review / fallback) cases.
- Visual QA should be **rerun after reconciliation** so the applied score reflects the
  reconciled draft.
- Reconciliation reuses the existing design-agent provider; no new provider or PDF
  rendering infrastructure is introduced.
