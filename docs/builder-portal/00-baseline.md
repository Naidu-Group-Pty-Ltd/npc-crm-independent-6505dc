# Builder / Developer Portal — Phase 0 baseline record

## Baseline commit

| Field | Value |
| --- | --- |
| Commit | `a2ec188faa806ff97cb272f7f5a8bcf56b984cb1` |
| Subject | Merge pull request #1744 from lavan96/feature/template-library-integration-foundation |
| Branch under development | `claude/builder-developer-portal-arch-lq16u6` |
| Position relative to `origin/main` | 0 ahead, 0 behind (verified with `git rev-list --left-right --count`) |
| Phase | 0 — assessment, documentation, characterisation tests, read-only scripts |

Every statement in the Phase 0 document set is a claim about this commit. When a
later phase changes the repository, the affected document must be re-derived
against the new baseline rather than edited from memory.

## Repository shape at baseline

| Measure | Count |
| --- | --- |
| Supabase migrations (`supabase/migrations/*.sql`) | 746 |
| Supabase Edge Functions (`supabase/functions/*/`) | 360 |
| Distinct `CREATE TABLE` names across all migrations | 421 |
| `solicitor-portal-*` Edge Functions | 14 |
| Solicitor Portal external route files (`src/pages/solicitor/`) | 13 |
| Solicitor Portal ADRs (`docs/architecture/adr/`) | 17 (001–017) |
| Solicitor Portal phase test suites (`tests/solicitor-portal/`) | 16 (phase 0–15) |

## Baseline behaviour that Phase 0 must not change

Phase 0 adds documentation, characterisation tests and read-only inspection
scripts only. At this commit the following are true and must remain true after
the Phase 0 pull request merges:

1. No table, column, index, constraint, trigger, function or policy is created,
   altered or dropped.
2. No route is added to `src/App.tsx`.
3. No Edge Function is added, removed or modified.
4. No component, hook, style token or navigation entry is added or modified.
5. No existing test is modified or deleted.
6. The only `package.json` change is the addition of two script entries that
   invoke the new Phase 0 test suite and the new read-only inspection script.

## Verification commands for the baseline

```bash
git rev-parse HEAD
git rev-list --left-right --count HEAD...origin/main
git diff --stat origin/main...HEAD -- supabase/migrations
git diff --stat origin/main...HEAD -- supabase/functions
git diff --stat origin/main...HEAD -- src
```

The three `git diff --stat` commands must report no changes for the Phase 0
branch. `scripts/builder-portal/phase-0-inspection.mjs` asserts the same
invariants mechanically and is the gate that Phase 0 remained non-behavioural.
