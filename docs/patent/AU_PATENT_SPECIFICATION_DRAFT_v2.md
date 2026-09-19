# Confidential — Australian Patent Specification Draft (v2)

**Title:** Integrated Property Finance Command Centre with Tri-Portal Architecture, Asset-Class-Aware Calculator Engines, Human-Validated Agentic Execution (Aurixa), CRM-Triggered Multi-Agent Voice Automation, and Schema-Constrained Multi-Modal Property Listing Ingestion

**Prepared for:** Internal partner review only — not for external disclosure.
**Jurisdiction:** Australia (provisional → standard, with optional PCT).
**Author note:** This v2 supersedes the ChatGPT-generated v1. It is rewritten to be tighter, more technical, and aligned with the system as actually implemented in the codebase (React 18 + Vite + TypeScript front end; Supabase Postgres with strict `service_role`-only RLS mediated by `invokeSecureFunction`; Deno edge functions; GHL CRM; VAPI + Twilio + ElevenLabs + OpenAI for voice; Make.com + Microsoft Graph + Airtable for property intake).

> ⚠️ Not legal advice. Final claim drafting must be performed by a registered Australian patent attorney.

---

## 1. Filing Posture

- **Pathway:** Australian provisional → standard application within 12 months; PCT optional.
- **Innovation patents:** phased out — not pursued.
- **Inventive framing:** computer-implemented technical architecture solving concrete problems in (a) secure cross-portal session mediation, (b) schema-bridged asset-class finance calculation, (c) tool-controlled human-validated agent execution, (d) event-driven multi-agent telephony orchestration, and (e) deterministic multi-modal real-estate data ingestion. Not a business method.
- **Confidentiality:** no public demos, marketing copy, or third-party disclosure until filing.

---

## 2. Technical Field

Computer-implemented property finance operations; multi-tenant SaaS portals; agentic AI execution with human-in-the-loop gating; programmable telephony and AI voice orchestration; multi-modal document/image/web extraction; schema-constrained LLM output; geocoded property normalisation; CRM and calendar interoperability.

---

## 3. Background & Problems Solved

Conventional property-finance operations are fragmented across CRMs, spreadsheets, calculators, IVR systems, inboxes, and ad-hoc AI tools. The result is duplicated data entry, weak audit, unsafe AI autonomy, rigid telephony, and unstructured property data intake. The invention addresses, in a single integrated platform:

1. **Cross-portal data silos** between client, finance partner, and internal staff.
2. **Schema mismatch** between commercial and industrial property records and the calculator engines that must consume them.
3. **Unsafe AI execution** — agents that mutate records without explicit human approval.
4. **Rigid telephony** — IVR trees and dialler systems with no CRM-aware conversational logic.
5. **Unstructured real-estate intake** — heterogeneous emails containing PDFs, images, links, and inline text that cannot be reliably mapped to a normalised property schema.
6. **Audit fragmentation** — proposed actions, executions, rollbacks, calls, and extractions logged in disconnected systems.

---

## 4. Summary of the Invention

The invention is a computer-implemented platform comprising six tightly coupled subsystems sharing one Postgres datastore, one identity fabric, and one audit spine:

| # | Subsystem | Core technical contribution |
|---|-----------|------------------------------|
| A | **Tri-portal access fabric** (client portal, finance partner portal, internal command centre) | Per-portal session tokens transmitted in dual paths (header + body) and resolved by edge functions before any DB read; strict `service_role`-only RLS bypassed exclusively via a whitelisted `invokeSecureFunction` mediator. |
| B | **Asset-class-aware calculator engines** (commercial + industrial) | Bidirectional prefill from typed property records into engine inputs (NOI, Cap Rate, ICR/DSCR, Debt Yield, DCF, GST, Borrowing Capacity, 10-yr cash-flow), with push-back persistence into the originating record. |
| C | **Purchase File orchestration** | Single `purchase_files` aggregate with hash-chained audit (`purchase_file_audit_events`), typed status machine (18 states), auto-seeded conditions, settlement runway, and cross-portal mirroring. |
| D | **Aurixa Agent** | Tool registry (≈150 tools) with mandatory human-approval gating for any mutating or externally-visible tool call; preview → approve/cancel → execute → log → rollback state machine. |
| E | **Multi-agent voice automation** | CRM-event-triggered outbound + inbound front-desk-with-sub-agents architecture using a normalised context object passed between Make.com, Twilio, TwiML, VAPI, ElevenLabs, and OpenAI. |
| F | **Multi-modal property listing intake** | Schema-constrained LLM extraction across email body, PDF/DOCX, images, and scraped webpages, normalised to an AU property schema and written to a single master Airtable table with deduplication, geocoding, confidence, and structured error states. |

The inventive concept is the **combination** of these subsystems under one identity/audit fabric — not any single sub-component in isolation.

---

## 5. System Architecture

### 5.1 Topology

```
                        ┌──────────────────────┐
   Client browser ─────►│ Client portal (/client/*)
   Finance partner ────►│ Finance portal (/finance/*)         React 18 + Vite SPA
   Internal staff  ────►│ Command Centre (/admin/*, /*)       (TypeScript, Tailwind v3)
                        └──────────┬───────────┘
                                   │  per-portal session token
                                   │  (header + body dual-path)
                                   ▼
                        ┌──────────────────────┐
                        │  Edge function layer │  Deno; verifyAuth + role check
                        │  (Supabase Functions)│  invokeSecureFunction mediator
                        └──────────┬───────────┘
                                   │ service_role
                                   ▼
                        ┌──────────────────────┐
                        │  Postgres (Supabase) │  strict service_role-only RLS
                        │  + Realtime publish  │  pg_cron schedulers
                        └──────────┬───────────┘
                                   │
        ┌────────────┬─────────────┼──────────────┬─────────────┐
        ▼            ▼             ▼              ▼             ▼
     GHL CRM      VAPI         ElevenLabs       OpenAI       Make.com
     (dual acct)  +Twilio      voice profile    LLM          + Outlook + Airtable
                  + TwiML                                    (property intake)
```

### 5.2 Identity & Audit Fabric (foundational)

- **Three session classes**, each with a separate token issuer:
  - `client_portal_session_token` → resolved by `usePortalAuth`.
  - `finance_partner_session_token` → resolved via `x-finance-session-token`.
  - Internal staff JWT → standard Supabase auth + `user_roles` (role enum stored in a dedicated table, never on profiles).
- **RLS policy:** every business table grants only `service_role`; portal/staff access is mediated by edge functions invoked via `invokeSecureFunction`, which enforces an `ALLOWED_TABLES` whitelist.
- **Identity propagation:** edge functions accept `effectiveUserId` so service-role calls can act on behalf of the resolved portal user without ever calling `supabase.auth.getUser()` inside RLS.
- **Audit spine:** SHA-256 hash-chained per-aggregate audit (`purchase_file_audit_events`) with `prev_hash`/`row_hash`, plus action logs for agent tool calls, voice sessions, and ingestion events.

---

## 6. Subsystem A — Tri-Portal Access Fabric

### 6.1 Client Portal (`/client/*`)
Views: dashboard, profile, portfolio, employment & finance, shared reports, report request, documents, notifications, deal progress, action items, finance hub, lenders, messages, property insights, booking, appointments.

Key technical features:
- **Include-mask data loader** — a single backend function accepts an `include[]` array; the response is shaped to the requested categories only (no overfetch, no client-side filtering of sensitive data).
- **Unified inbox** aggregates portal messages, SMS, WhatsApp, email, finance replies, internal replies, system messages (polling + realtime subscription + cache invalidation).
- **Consent wall + onboarding gate** must clear before protected views render.

### 6.2 Finance Partner Portal (`/finance/*`)
Operational cockpit for brokers/finance partners. Views span login, invite acceptance, dashboard triage, purchase files, document requirements, lender submissions, valuations, decisions, risk register, borrowing snapshot, compliance, settlement runway, comms, earnings, pipeline, mobile cockpit.

Distinct features:
- **Global Partner Permissions** — per-partner baseline OR-merged with per-client overrides.
- **Document Requirements Matrix** — templates → per-purchase-file instances → request-from-client flow.
- **Operational Dashboard** — metrics aggregator edge function with urgency/settlement/risk sort.

### 6.3 Internal Command Centre
Full CRUD over clients, deals, calendars, reports, agreements, lenders, agents, integrations, plus the Aurixa Agent chat surface and finance-portal admin shadow.

---

## 7. Subsystem B — Calculator Engines (Commercial & Industrial)

### 7.1 Engines
Borrowing Capacity, NOI, Cap Rate, ICR, DSCR, Debt Yield, Funds-to-Complete, GST treatment, DCF, 10-year Cash Flow, Industrial Metrics (rent/sqm, site coverage, hardstand, clearance, dock doors, floor load, power), Scenario Comparison.

### 7.2 Bidirectional Prefill ↔ Push-back
- Typed property records (`commercial_capex`, `commercial_financing`, `industrial_financing`) feed engine inputs via a normalisation adapter.
- Engine outputs persist back to the originating record where authoritative (e.g. selected NOI, assessment rate, funds-to-complete).
- Source-mode tracking per calculator tab: `global | manualOverride | aiPending | savedPropertyLinked | scenario`.

### 7.3 Assessment Rate Logic
- Commercial: contract rate + lender buffer, optionally floored, with `assessmentBasis ∈ {contractPlusBuffer, higherOfBufferAndFloor, custom}`.
- Residential 3% APRA buffer explicitly **not** applied to commercial paths.

### 7.4 AI-Assisted Estimates
Where a field is missing, an `AiEstimateResult` may be generated, surfaced with confidence + required documents + reasoning summary, and only written to the global profile after explicit user acceptance — never silently.

---

## 8. Subsystem C — Purchase File Orchestration

Single `purchase_files` aggregate joined by:
- 18-state finance status machine; status history.
- Critical dates (typed: `date_type`), settlement tasks auto-seeded on `unconditional_approval` via trigger.
- Document requirement instances; lender packets with gap-check.
- Decisions (with `subject_to_lmi_approval`), conditions, valuations.
- Bidirectional FK to `client_deals` with drift detection (never auto-mirror shared fields).
- Hash-chained audit, tri-portal visibility flags on the activity feed.

---

## 9. Subsystem D — Aurixa Agent (Human-Validated Execution)

### 9.1 Tool Registry
Each tool declares: name, NL description, JSON-schema parameters, required/optional fields, validation, executor, **read-only vs mutating**, **confirmation required flag**, **rollback support flag**, audit config, integration target.

Categories: client, contact, deal, calendar, comms, voice/call, finance, report, search, memory, notification, audit, rollback, infrastructure, calculator.

### 9.2 State Machine
```
receive instruction
  → load conversation context
  → classify intent
  → select candidate tools
  → draft arguments
  → classify risk (read-only vs mutating)
  → if mutating: generate preview → request approval
                                       ├─ approved → execute → log → store rollback data
                                       └─ cancelled → log cancellation
  → if read-only: execute → log
  → update conversation
  → expose undo where rollback data exists
```

### 9.3 Hard Rules
- No mutating tool executes without explicit user approval click.
- Email send: full preview (from, to, cc, bcc, subject, body) before send; internal service-role invocation only after approval.
- Undo verifies ownership, non-rolled-back state, presence of rollback data, target table+row, and rollback permission.
- Conversation sharing creates share record + handoff + in-app notification atomically.

### 9.4 Token & Seat Metering
Every metered generator reserves → generates → commits/cancels via the Mission Control billing fabric (`tenantRef = agency`); seat invites enforce a 402 `seat_limit_reached` block.

---

## 10. Subsystem E — Multi-Agent Voice Automation

### 10.1 Components
- **Event source** — GHL CRM events (lead created, pipeline change, tag, appointment, missed call), forms, webhooks, manual triggers.
- **Orchestration** — Make.com scenario validates payload, selects agent, builds normalised context, calls telephony API.
- **Telephony** — Twilio.
- **Call control** — TwiML Bin connects call to VAPI runtime.
- **Voice runtime** — VAPI with per-agent system prompt, voice profile (ElevenLabs), permitted tools.
- **LLM dialogue** — OpenAI (GPT-5.3-class or successor).
- **CRM adapter** — translates standard tool calls (`search_contact`, `create_contact`, `create_booking`, `add_tag`, `write_call_summary`, …) into provider-specific APIs (GHL legacy + new, future CRMs).
- **Calendar adapter** — availability + booking (phone, Zoom, Google Meet, Teams, in-person).

### 10.2 Inbound Squad
Front desk agent answers → resolves contact via CRM phone-number lookup → creates contact if missing → routes to specialised sub-agent (booking, qualification, support, reschedule, reminder, billing, escalation) with a normalised context object.

### 10.3 Outbound Triggered Flow
```
CRM event → orchestration validates → selects outbound agent
          → builds context (contact, pipeline, campaign, appointment)
          → Twilio places call → TwiML connects to VAPI runtime
          → agent conducts conversation, invokes CRM/calendar tools
          → writeback: status, duration, transcript, summary,
            qualification, booking, objections, next task, escalation flag
```

### 10.4 Tool-Gated Data Access
Voice agents may **only** state facts retrieved via approved tools; no fabricated contact/availability claims. Every tool call is logged with payloads, timestamps, session, agent, contact, success/error.

### 10.5 Cross-CRM Compatibility
Standard tool surface + adapter pattern → identical agent definitions deploy against multiple CRM back-ends. Dual-account resolver (`_shared/ghl-account.ts`) already runs LEGACY/NEW GHL credential routing per call.

---

## 11. Subsystem F — Multi-Modal Property Listing Intake

### 11.1 Modules (deployed as a Make.com scenario)
1. **Message monitor** — Outlook mailbox, trigger on unread.
2. **Source intake** — initial master-table row (sender, subject, message-id, conversation-id, attachment count, processing state).
3. **HTML→text conversion.**
4. **Text segmenter** — ~6,000-char chunks, ~500-char overlap.
5. **Attachment identifier/classifier** (content type + extension + metadata).
6. **Router** — body/text → text branch; PDF/DOCX → document branch; PNG/JPG → image branch; URLs → hyperlink branch.
7. **Document handler** — download → store → extract text.
8. **Image handler** — download → store → visual extraction.
9. **Hyperlink extractor/classifier** — filters tracking/unsubscribe URLs.
10. **Webpage scraper.**
11. **Schema-constrained LLM extractor** — emits a JSON object `{ metadata, listings[] }` conforming to the master AU property schema **regardless of source branch**.
12. **Normaliser** — street types, AU states (`NSW|VIC|QLD|WA|SA|TAS|ACT|NT|Unknown`), postcodes (string), sector, intent, sale method, rent period, listing status, price/area cleaning.
13. **Geocoder** — Google Maps; updates state, postcode, suburb, lat/lng, formatted address.
14. **Duplicate detector** — match keys (property unique, address, project/estate/stage); status ∈ `{New, Possible Duplicate, Confirmed Duplicate, Updated Existing, Not Duplicate, Needs Review, Unknown}`.
15. **Database ingestion** — single master Airtable table.
16. **Confidence + review** — per-field confidence, structured review reasons.
17. **Error handler** — typed error states (Invalid AI JSON, Missing Address, Missing Price, Web Scrape Failed, Geocoding Failed, Airtable Create/Update Failed, Mapping Error, Model Error, Timeout, …).
18. **Lifecycle tracker** — first_seen, last_seen, previous/current price + status, change_type, change_summary.

### 11.2 Single Master Table Design
Sections: record classification • source email • source attachment/document • property identity & dedupe • address & location • property classification • sale/rent/commercial terms • specifications • agent/agency • inspection • links/media/enrichment • AI audit • confidence/review • error • lifecycle • notes.

Rationale: each ingested row is independently auditable end-to-end — source through normalised listing — without joins.

### 11.3 Schema-Constrained Output (LLM contract)
```jsonc
{
  "metadata": {
    "record_type": "...", "source_type": "email_body|pdf|docx|image|webpage",
    "processing_status": "...", "extraction_method": "...",
    "ai_model": "...", "prompt_version": "...",
    "extracted_listings_count": 0, "parsed_json_valid": true
  },
  "listings": [
    { /* identity, address, geocode, classification, terms, specs,
         agent, inspection, links, confidence, review, error, lifecycle */ }
  ]
}
```

---

## 12. Cross-Subsystem Effects

| Effect | Mechanism |
|--------|-----------|
| Single audit narrative | Hash-chained PF audit + agent action log + voice session log + ingestion log share `effectiveUserId` and timestamps. |
| Zero overfetch | Include-mask loaders + `ALLOWED_TABLES` whitelist + portal-scoped edge functions. |
| Safe AI mutation | Tool registry classification + mandatory preview/approve gate + per-action rollback data. |
| Conversational CRM ops | Voice agents share the same tool taxonomy as Aurixa; switching surfaces (chat ↔ voice) does not change the underlying executor. |
| Deterministic intake | One LLM-output schema across five source branches → one mapper → one table. |

---

## 13. Advantageous Effects (condensed)

1. Eliminates dual data entry between client-facing and finance-facing surfaces.
2. Asset-class-correct borrowing capacity (commercial vs industrial vs residential paths kept separate).
3. Verifiable AI safety: no silent mutation, full rollback, hash-chained audit.
4. CRM-triggered telephony replaces dialler + receptionist workflows while staying CRM-portable.
5. Heterogeneous property emails become structured rows in minutes, with confidence and review metadata.
6. Single identity fabric means a new portal or AI surface inherits auth, RLS mediation, and audit for free.

---

## 14. Brief Description of Drawings (to be prepared)

- **Fig 1** — Topology: portals → edge layer → Postgres → external services.
- **Fig 2** — Client portal include-mask data flow.
- **Fig 3** — Finance portal purchase-file aggregate + audit chain.
- **Fig 4** — Calculator prefill ↔ push-back bidirectional flow.
- **Fig 5** — Borrowing Capacity engine inputs/outputs.
- **Fig 6** — Aurixa Agent component diagram (chat → tool registry → approval → executor → log → rollback).
- **Fig 7** — Aurixa state machine.
- **Fig 8** — Outbound voice flow (CRM event → Make → Twilio → TwiML → VAPI → CRM writeback).
- **Fig 9** — Inbound front-desk → sub-agent routing.
- **Fig 10** — CRM adapter abstraction.
- **Fig 11** — Normalised voice context object schema.
- **Fig 12** — Property intake pipeline (monitor → route → extract → normalise → enrich → dedupe → ingest).
- **Fig 13** — LLM JSON output contract.
- **Fig 14** — Single master table sections.
- **Fig 15** — Duplicate detection key derivation.
- **Fig 16** — Confidence/review/error state diagram.

---

## 15. Draft Independent Claims (attorney to finalise)

**Claim 1 — Integrated platform.** A computer-implemented property finance platform comprising: (a) a client portal, a finance partner portal, and an internal command-centre portal each authenticated by a portal-specific session token transmitted in both a request header and request body and resolved by an edge function before any database access; (b) a Postgres datastore whose business tables grant access only to a service role, access by the portals being mediated by a whitelisted secure-invocation function; (c) a commercial and industrial calculator suite configured to prefill engine inputs from typed property records and persist selected outputs back to said records; (d) a purchase-file orchestration aggregate with a hash-chained audit log; (e) an agentic execution subsystem comprising a registry of executable tools each classified as read-only or mutating, wherein mutating tools cannot execute without an explicit human approval received via a preview-and-confirm interface, and wherein executed actions store rollback data enabling an undo operation; and (f) an audit fabric persisting agent actions, portal events, and external integration events against a common user-identity propagation field.

**Claim 2 — Voice automation.** A computer-implemented multi-agent voice automation system comprising: a CRM event ingestion layer, an orchestration layer selecting an outbound AI voice agent from a configured set in response to a CRM state change, a telephony gateway, a programmable call-control layer connecting the call to a voice-agent runtime, a CRM adapter exposing standardised contact, calendar, note, and opportunity operations translated to provider-specific APIs, and a writeback layer persisting structured call outcomes; further comprising an inbound front-desk agent operable to resolve a caller via CRM phone-number lookup, create a contact when no match exists, and route the call to a specialised sub-agent with a normalised context object preserving caller, CRM, calendar, agent, and workflow state.

**Claim 3 — Multi-modal listing intake.** A computer-implemented method for ingesting real-estate information from electronic communications, comprising: detecting an unread message in a monitored mailbox; creating a source intake record in a single master database table; converting body content to plain text and segmenting it into overlapping chunks; routing document attachments, image attachments, hyperlinks, and body text to respective extraction branches; invoking a schema-constrained large-language-model extractor that emits, for every branch, a JSON object conforming to a common metadata-plus-listings schema; normalising Australian address, state, postcode, sector, intent, sale method, rent period, and listing status fields; geocoding incomplete addresses; generating one or more match keys from normalised address, project, estate, and stage values; comparing said keys to existing records to assign a duplicate status; and creating or updating a single master table row carrying source-audit, listing, enrichment, confidence, review, and error metadata.

**Dependent claims** to cover: include-mask loader; `ALLOWED_TABLES` whitelist; assessment-rate basis selection; AI-estimate accept-into-global flow; per-tool rollback metadata; voice tool-gated factuality rule; cross-CRM adapter; chunk size and overlap parameters; duplicate match-key composition; structured error taxonomy; hash-chained audit; tri-portal session resolver.

---

## 16. Best Method Known to Applicant

Current production stack:
- **Front end:** React 18 + Vite 5 + TypeScript 5 + Tailwind v3 (single SPA, route-segmented per portal).
- **Backend:** Supabase Postgres with strict `service_role`-only RLS; Deno edge functions; pg_cron schedulers.
- **CRM:** GoHighLevel (dual-account resolver enabling LEGACY/NEW credential routing during migration).
- **Voice:** Twilio + TwiML Bin → VAPI runtime → ElevenLabs voice profile → OpenAI (GPT-5.3-class).
- **Property intake:** Make.com scenario → Microsoft Graph (Outlook) → file storage → schema-constrained OpenAI prompts → Google Maps geocoding → single Airtable master table.
- **Billing/seats/tokens:** Mission Control reserve/commit/cancel fabric.
- **Audit:** SHA-256 hash-chained `purchase_file_audit_events` plus agent action logs and voice session logs joined on `effectiveUserId`.

---

## 17. Implementation Variations (non-exhaustive)

- Substitute any single external provider (CRM, telephony, voice runtime, LLM, geocoder, workflow engine, mailbox, file store) without changing the inventive architecture.
- Replace the single master intake table with normalised relational tables while retaining the LLM schema contract and mapping layer.
- Extend asset-class engines to additional classes (rural, mixed-use) by adding adapters; the prefill/push-back contract is preserved.
- Add new portals (e.g. lender portal) by issuing a new session class and registering its tables in `ALLOWED_TABLES`; the identity/audit fabric absorbs the addition.
- Replace OpenAI with any tool-calling LLM that honours the JSON schema contract.

---

## 18. Auditability Surfaces (persisted)

Login & session verification; portal data mutations; purchase-file status, critical date, document, lender, valuation, decision, condition, risk changes; client/finance/staff messages; agent conversations and individual messages; proposed tool calls; approval/cancellation events; executed tool calls with payload/response; rollback events; voice session start/end, transcripts, tool calls within calls, writebacks; ingestion source intake, branch routing, LLM raw output, normalised output, geocoder response, dedupe key/result, error state, lifecycle change events.

---

## 19. Glossary (selected)

- **Aurixa Agent** — internal command-centre AI execution agent with mandatory human approval for mutating tools.
- **Purchase File (PF)** — finance-side aggregate per property-purchase engagement.
- **Mission Control** — external billing/seat/token fabric.
- **invokeSecureFunction** — single client→edge entry point that enforces `ALLOWED_TABLES` and identity propagation.
- **Normalised context object** — JSON state passed across CRM, orchestration, telephony, voice runtime, and sub-agents within a voice session.
- **Schema-constrained extraction** — LLM call whose output must conform to a predefined JSON schema regardless of input modality.

---

*End of v2 draft — for partner + patent-attorney review.*
