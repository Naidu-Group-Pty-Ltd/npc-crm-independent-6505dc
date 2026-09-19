# Environment evidence template + operator checklist (E4)

Machine-readable evidence lives in the readiness op
(`get_partner_readiness` — read-only preflight; states: applied / missing /
enabled / disabled / healthy / attention / unknown / action_required).
This file is the human-readable capture sheet. **Every field defaults to
"unknown — not verified"; nothing is pre-filled as passing.**

## Environment identification (complete FIRST — blocks everything)
- [ ] Project identifier: ______ · confirmed NON-PRODUCTION by ______ on ______
- [ ] No production domain attached · no production client data present
- [ ] Snapshot/backup reference: ______

## Database
- [ ] Migration list applied matches `migration-manifest.md` (names + order)
- [ ] `10-verify-schema.sql` battery passes (tables, columns, constraints,
      indexes, triggers, functions, RLS, policies, 14 partner flags false)
- [ ] RLS/policy review recorded · function ownership + pinned search_path
- [ ] Rollback parsed AND rehearsed for the two 20260828 migrations
- [ ] Partner org-name mapping review process confirmed (human review, no
      fuzzy merge — structurally: `partner_mapping_requires_reviewer`)

## Functions / APIs
- [ ] Deployed hashes recorded beside source hashes
      (`function-deployment-manifest.md`) · verify_jwt/config per registry
- [ ] Security registry current (14 known findings, none new) · CORS ·
      CSRF · auth boundaries · evidence-access rate limit · safe errors

## Provider stack
- [ ] Mode recorded · credentials PRESENT (never values) · health check ·
      documented limitations (no-DVS / heuristic-liveness statement) ·
      outage route + manual fallback verified

## Screening
- [ ] Authoritative sources configured · last retrieval timestamp ·
      ingestion count · freshness threshold + config version · one test
      match executed · stale-list behaviour verified (**no "clear" result
      on failed/empty source**)

## Storage
- [ ] `aml-documents` + `aml-biometrics` private · policy review · signed
      URL max 300 s · no public policy · tenant/case ownership validation ·
      biometric separation · raw-object disposal test (object BEFORE
      pointer) · evidence-access audit logging observed

## Events / jobs
- [ ] Worker deployed · schedule + owner recorded · auth verified ·
      backlog drains · retry/backoff observed · dead-letter + replay
      round-trip · idempotency (duplicate event once) · stale event does
      not resurrect revoked access · alert ownership

## Retention
- [ ] Record catalogue + corrected classifications present · schedules
      approved (decision register) · legal hold blocks disposal · dry run →
      approval → execution test on synthetic rows · failure evidence
      retained · raw-ID/biometric necessity handling confirmed

## Operations
- [ ] Queue owners assigned · SLAs recorded as operational targets (not
      law) · support/escalation/incident contacts · pilot monitoring rota ·
      unassigned-item handling agreed

## Rollback
- [ ] Flag rollback drill · route rollback drill · worker stop/restore ·
      evidence-access revoke drill · function redeploy path · migration
      rollback restrictions acknowledged (export + dependency scan +
      retention review before anything destructive)
