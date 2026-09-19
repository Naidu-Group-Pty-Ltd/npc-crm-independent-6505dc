# AGENTS.md — Aurixa AML/CTF Tri-Portal Non-Negotiable Rules

Source of truth: `Aurixa_AML_CTF_Tri_Portal_Streamlined_Codex_Implementation_Report_v2.pdf`.
Working audit + traceability lives at `archives/aml-v2/phase-0-audit.md`.

## 1. Delivery discipline
- Execute exactly one phase per task. Inspect → plan → implement scoped changes → run checks → stop at the phase gate.
- Never delete or silently orphan an existing AML capability. Consolidation is UI-only unless the phase explicitly authorises a schema/route change.
- Preserve every legacy `/admin/aml/*` route via alias/redirect while the five-workspace shell rolls out.
- Feature flags (`aml_ctf`), provider adapters, cron jobs, and step-up sessions remain intact across all phases.

## 2. Compliance guardrails (all phases)
- Tri-portal separation: Command Centre is the authoritative control plane. Client Portal and Finance Portal never render SMR, protected regulatory records, or restricted case fields.
- AML cases are created only for **active clients** after a **human-confirmed** activation event. Marketing leads / referrals never auto-generate a case.
- Model A and Model B share one case engine. Model B must NOT unlock designated services until the service-entitlement gate is approved. Model B requires a `legal_approval` flag + `program_version` reference before it can be enabled in production.
- Delayed-CDD is a restricted exception pathway — never a normal tenant toggle.
- Restricted capabilities (`aml.report`, `aml.configure`) always require step-up; sessions are 15 min and per-capability.
- Roles live in `user_roles`; AML roles resolved through `public.get_aml_roles_for_user` / `useAmlAccess`. Superadmin bypass is preserved.
- Every decision writes: subject, connected persons, evidence refs, provider results, risk model + program version, approver, hash-chained audit entry.
- Reporting (SMR / TTR / IFTI) cannot be marked submitted without submission evidence.
- Tipping-off protections apply to restricted surfaces: no leakage into general AML, Client Portal, or Finance Portal counts / previews.
- Data scoping is mandatory on every query: `tenant_id`, `legal_entity_id`, `case_id`, `party_id`, `transaction_id`.

## 3. Data & schema
- `aml` schema is exposed via `SECURITY DEFINER` RPCs. Do not grant direct PostgREST access.
- Every new `public` table needs explicit `GRANT`s (see project instructions). RLS is additive, never the sole gate.
- Never alter Supabase-reserved schemas (`auth`, `storage`, `realtime`, `supabase_functions`, `vault`).
- Never store `service_role_key` or provider secrets in the DB — use `add_secret`.

## 4. UX rules (Version 2)
- Five workspaces: Compliance Home · Customer Compliance · Transaction Compliance · Regulatory & Assurance · Platform Administration.
- No horizontal scroll on the module header. No role chips / dev metadata in production header.
- Landing pages are derived from **effective permissions**, not a client-side role string. No simple/advanced mode toggle.
- Empty states must be actionable (explain what fills the surface + next step).

## 5. Codex execution rule (verbatim, applies each phase)
> Inspect the repository, state the plan, implement only this phase, run the applicable checks, provide evidence and stop.

## 6. Frontend / UI changes
For any UI or frontend work, follow `FRONTEND_TOOLING.md` (repo root). It is the
cross-tool source of truth: it defines the installed frontend packages — the
`shadcn`, `chrome-devtools`, and `@21st-dev/magic` MCP servers (`.mcp.json`) and the
`frontend-design` / `web-design-guidelines` skills (`.claude/skills/`) — and the
non-negotiable rules (semantic design tokens only, shadcn-first, accessibility floor,
verify in a browser). Prefer those packages when your tool supports them.
