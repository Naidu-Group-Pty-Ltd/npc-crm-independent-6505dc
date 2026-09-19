# Phase 2H — PDF Import Final Regression Lock

## Test run order

1. Fresh small PDF import
2. Fresh large chunked PDF import
3. Re-import the same large PDF to confirm cache hit
4. Run `scripts/regression/pdf-import-phase-2h-check.sql` in Supabase SQL Editor
5. Confirm all bad-state detectors return zero rows
6. Confirm latest large PDF has:
   - status = succeeded
   - stage = parsed
   - page_count = page_raster_count
   - docling_page_rebase_version = chunk-page-rebase-v1
   - chunk_merge_validation_version = chunk-merge-validation-v1
   - merge_validation.ok = true
   - terminal_state_version = terminal-state-normalizer-v1
   - lane_enforcement_version = extractor-lane-policy-v1
7. Confirm latest cache-hit row has:
   - cache_hit = true
   - cache_safety_version = parse-cache-safety-v1
   - all copied safety markers present
8. Confirm latest template import has:
   - status = completed
   - created_template_id is not null
   - artifact_contract_version = template-finalization-artifacts-v1
   - finalization_status = completed
   - artifact_stage = staged
   - consumer_guardrail_version = template-import-consumer-guardrails-v1
   - parse_guardrails.ok = true
   - artifact_guardrails.ok = true

## Phase 2H pass condition

Phase 2 is locked only when:

- parser bad-state detector returns zero rows
- chunk health detector returns zero active bad rows
- template import bad-state detector returns zero rows
- frontend fresh import has no duplicate first-5-page issue
- cache hit still produces a valid template
