# ADR-002: Matter-scoped Solicitor access

- **Status:** Implemented in Phase 1
- **Decision:** `solicitor_matter_access` grants access to one exact legal matter.
  Client identity never grants access. Workflow assignee and access grant remain
  separate concepts. Null-firm, expired, and revoked grants are denied.
- **Policy:** Store `inherit | allow | deny`. An explicit matter allow/deny wins;
  otherwise resolve baseline. Financial and AML forbidden keys remain hard-denied.
- **Compatibility:** Backfill only matters currently reachable for the user's
  exact firm. Put ambiguous/null-firm rows in an exceptions report. Do not grant
  future matters. Retain client assignments until reconciliation passes.
- **Security response:** Return 404 where appropriate to limit enumeration.

## Implementation evidence

The timestamped Phase 1 migration adds the grant and exception tables, performs an exact-firm point-in-time backfill, and retains legacy client assignments. The shared resolver is default-on behind `SOLICITOR_MATTER_ACCESS_V1`; setting it to `false` activates the exact-firm legacy rollback adapter. All five Solicitor resource functions resolve lists and individual resources through the shared matter grant.
