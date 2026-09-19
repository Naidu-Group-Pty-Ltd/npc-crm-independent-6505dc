import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-contract tests for Phase 6: reliable partner compliance events,
 * material-change invalidation and refresh obligations.
 *
 * The exit-gate properties asserted here: event creation is atomic with the
 * originating transaction (database triggers, not application calls);
 * consumers are idempotent (unique keys + ignore-duplicates everywhere);
 * replay cannot reactivate revoked access (the consumer owns no authoritative
 * writes); the canonical platform outbox is EXTENDED, never duplicated; and
 * no restricted content can enter an event, a notification or an error record.
 */

const repo = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");

const migration = read("supabase/migrations/20260805140000_aml_partner_events_phase6.sql");
const worker = read("supabase/functions/cross-portal-outbox-worker/index.ts");
const fn = read("supabase/functions/aml-reliance/index.ts");
const pure = read("supabase/functions/_shared/aml/partnerEvents.ts");
const workspaceModule = read("supabase/functions/_shared/aml/partnerWorkspace.ts");
const card = read("src/components/aml/PartnerEventsOpsCard.tsx");
const healthPage = read("src/pages/admin/AmlIntegrationHealth.tsx");

/** The worker's AML consumer, isolated so write-prohibition assertions
 * cannot be satisfied (or violated) by unrelated handlers. */
const amlConsumer = worker.slice(
  worker.indexOf("async function deliverAmlPartnerEvent"),
  worker.indexOf("async function sweepAmlTimeBasedEvents"),
);
const amlSweep = worker.slice(
  worker.indexOf("async function sweepAmlTimeBasedEvents"),
  worker.indexOf("async function projectCase"),
);
const materialRpc = migration.slice(
  migration.indexOf("CREATE OR REPLACE FUNCTION aml.apply_partner_material_change"),
  migration.indexOf("-- ── 9."),
);

describe("the canonical outbox is extended, never duplicated", () => {
  it("no second outbox table exists — the platform integration_outbox carries AML events", () => {
    expect(migration).not.toMatch(/CREATE TABLE[^;]*aml\.integration_outbox/);
    expect(migration).toContain("ALTER TABLE public.integration_outbox");
    expect(migration).toContain("INSERT INTO public.integration_outbox");
  });

  it("the AML envelope columns are additive and nullable, with no cross-schema FKs", () => {
    for (const col of ["partner_org_id uuid", "partner_case_link_id uuid", "causation_id uuid"]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
    const alter = migration.slice(
      migration.indexOf("ALTER TABLE public.integration_outbox"),
      migration.indexOf("CREATE INDEX IF NOT EXISTS idx_integration_outbox_aml_pending"));
    expect(alter).not.toContain("REFERENCES");
    expect(alter).not.toContain("NOT NULL");
  });

  it("the collision analysis is recorded in the migration itself", () => {
    expect(migration).toContain("COLLISION ANALYSIS");
    expect(migration).toContain("aml.integration_outbox is NOT created");
  });
});

describe("atomicity: events are created by the same transaction as the state change", () => {
  it("every domain transition emits through an AFTER trigger, not an application call", () => {
    for (const t of [
      ["trg_aml_emit_partner_link_events", "aml.partner_case_links"],
      ["trg_aml_emit_attestation_events", "aml.compliance_attestations"],
      ["trg_aml_emit_grant_events", "aml.reliance_grants"],
      ["trg_aml_emit_records_request_events", "aml.partner_records_requests"],
      ["trg_aml_emit_evidence_delivery_events", "aml.partner_evidence_deliveries"],
      ["trg_aml_emit_determination_events", "aml.independent_assessments"],
      ["trg_aml_emit_retention_trigger_events", "aml.retention_triggers"],
      ["trg_aml_emit_legal_hold_events", "aml.legal_holds"],
    ] as const) {
      expect(migration).toContain(`CREATE TRIGGER ${t[0]}`);
      expect(migration).toMatch(new RegExp(`AFTER INSERT (OR UPDATE )?ON ${t[1].replace(".", "\\.")}`));
    }
  });

  it("the edge function never enqueues directly — emission lives in the database only", () => {
    expect(fn).not.toContain("enqueue_partner_event");
  });

  it("the enqueue choke point is flag-gated (default off = zero writes) and duplicate-safe", () => {
    expect(migration).toContain("IF NOT aml.partner_events_enabled() THEN RETURN NULL; END IF;");
    expect(migration).toContain("ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key");
    expect(migration).toContain("('aml_partner_event_outbox', 'false'::jsonb");
  });

  it("unknown event types cannot be enqueued — the catalogue is closed", () => {
    expect(migration).toContain("FROM aml.partner_event_catalogue WHERE event_type = _event_type");
    expect(migration).toMatch(/RAISE EXCEPTION 'unknown partner event type/);
  });
});

describe("idempotency: duplicates, retries and replays have one logical outcome", () => {
  it("one open obligation per link × action, enforced structurally", () => {
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_aml_refresh_obligation_open");
    expect(migration).toMatch(/\(partner_case_link_id, required_action\)\s*\n?\s*WHERE status = 'open'/);
    expect(materialRpc).toContain("ON CONFLICT (partner_case_link_id, required_action) WHERE status = 'open' DO NOTHING");
  });

  it("one notification per outbox event, enforced structurally and honoured by the worker", () => {
    expect(migration).toContain("outbox_event_id uuid NOT NULL UNIQUE");
    expect(amlConsumer).toContain("onConflict:'outbox_event_id'");
    expect(amlConsumer).toContain("ignoreDuplicates:true");
  });

  it("the material-change RPC is transition-guarded so a duplicate call is a no-op", () => {
    expect(materialRpc).toContain("AND refresh_required_at IS NULL");
    expect(materialRpc).toContain("'no_material_change'");
    expect(materialRpc).toContain("'attestation_already_superseded'");
  });

  it("the time-based sweep derives its idempotency keys from the occurrence, not the run", () => {
    expect(amlSweep).toContain("`aml.partner_access.expired:${g.id}`");
    expect(amlSweep).toContain(":${a.id}:${a.next_review_due}");
  });
});

describe("ordering and replay: stale events cannot resurrect anything", () => {
  it("the AML consumer decides via the pure stale-check before writing", () => {
    expect(worker).toContain('import { buildPartnerNotification, partnerEventDeliveryDecision } from');
    expect(amlConsumer).toContain("partnerEventDeliveryDecision(event.event_type");
    expect(amlConsumer).toMatch(/if\(decision!=='notify'\) return/);
  });

  it("the AML consumer owns NO authoritative writes — its only write is the notification row", () => {
    // Reads of grants/attestations/links are select-only; the single
    // mutation is the idempotent partner_notifications upsert.
    expect(amlConsumer).not.toMatch(/\.(update|insert|delete)\(/);
    const upserts = amlConsumer.match(/\.upsert\(/g) ?? [];
    expect(upserts.length).toBe(1);
    expect(amlConsumer).toContain("from('partner_notifications').upsert");
    for (const table of ["reliance_grants", "compliance_attestations", "partner_case_links"]) {
      const use = amlConsumer.indexOf(`from('${table}')`);
      expect(use).toBeGreaterThan(-1);
      expect(amlConsumer.slice(use, use + 120)).toContain(".select(");
    }
  });

  it("the AML consumer routes through the platform claim/backoff/dead-letter machinery unchanged", () => {
    expect(worker).toContain("startsWith('aml.')?'aml_partner_events'");
    expect(worker).toContain("claim_integration_outbox");
    expect(worker).toContain("2**event.attempts");
    expect(worker).toContain("event.attempts>=10");
    expect(worker).toContain("integration_dead_letters");
    // Error text is truncated; no credential-shaped field is recorded.
    expect(worker).toContain("last_error:message.slice(0,2000)");
  });
});

describe("no restricted content in events, notifications or error records", () => {
  it("the database enforces the restricted-key tripwire on every payload", () => {
    expect(migration).toContain("aml.assert_partner_event_payload_safe");
    expect(migration).toMatch(/risk_rating\|risk_score/);
    expect(migration).toMatch(/access_token\|refresh_token\|secret\|password/);
    expect(migration).toContain("PERFORM aml.assert_partner_event_payload_safe(safe_payload");
  });

  it("trigger payloads carry identifiers and controlled codes — never free text", () => {
    // The grant trigger must not copy the staff-written revoke_reason, and
    // the legal-hold trigger must not copy the hold reason.
    const grantTrigger = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION aml.emit_grant_events"),
      migration.indexOf("CREATE OR REPLACE FUNCTION aml.emit_records_request_events"));
    expect(grantTrigger.length).toBeGreaterThan(0);
    expect(grantTrigger).not.toContain("NEW.revoke_reason");
    const holdTrigger = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION aml.emit_legal_hold_events"),
      migration.indexOf("-- ── 8."));
    expect(holdTrigger.length).toBeGreaterThan(0);
    expect(holdTrigger).not.toMatch(/NEW\.reason\b/);
  });

  it("partner-facing obligation reads exclude the internal trigger classification", () => {
    const partnerOp = fn.slice(
      fn.indexOf('op === "list_partner_refresh_obligations"'),
      fn.indexOf('op === "list_partner_notifications"'));
    // The SELECTED COLUMNS are the disclosure surface — assert on them.
    const selects = [...partnerOp.matchAll(/\.select\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(selects.length).toBeGreaterThan(0);
    for (const cols of selects) {
      expect(cols).not.toContain("internal_trigger_codes");
      expect(cols).not.toContain("trigger_source");
      expect(cols).not.toContain("*");
    }
    expect(selects[0]).toContain("safe_reason_code");
  });

  it("notification copy is fixed in the pure module and tripwire-scanned", () => {
    expect(pure).toContain("PARTNER_EVENT_COPY");
    expect(pure).toContain("findRestrictedKeys(notification)");
    // The worker writes ONLY what buildPartnerNotification returns.
    expect(amlConsumer).toContain("buildPartnerNotification(event.event_type");
    expect(amlConsumer).not.toContain("event.payload?.body");
  });
});

describe("material change: invalidation without touching the origin decision", () => {
  it("the RPC mutates only attestation/grant/determination refresh state and obligations", () => {
    const updates = [...new Set(materialRpc.match(/UPDATE aml\.[a-z_]+/g) ?? [])];
    expect(updates.sort()).toEqual([
      "UPDATE aml.compliance_attestations",
      "UPDATE aml.independent_assessments",
      "UPDATE aml.reliance_grants",
    ]);
    expect(materialRpc).toContain("INSERT INTO aml.partner_refresh_obligations");
    // Never the case, gate, screening or risk state.
    for (const forbidden of ["UPDATE aml.cases", "service_gate_status", "risk_rating", "screening_checks", "service_gate_decisions"]) {
      expect(materialRpc).not.toContain(forbidden);
    }
  });

  it("the staff op is MLRO-only, flag-gated, and evaluates with the Phase 3 material-input recipe", () => {
    const opBlock = fn.slice(
      fn.indexOf('case "apply_material_change"'),
      fn.indexOf('case "staff_list_refresh_obligations"'));
    expect(opBlock).toContain("if (!isMlro)");
    expect(opBlock).toContain('flagEnabled(admin, "aml_partner_event_outbox")');
    expect(opBlock).toContain("evaluateMaterialChange(previousInputs, nextInputs)");
    expect(opBlock).toContain("materialInputsFromV2Payload");
    expect(opBlock).toContain("apply_partner_material_change");
    // A non-material evaluation stops before the RPC.
    expect(opBlock).toContain("if (!evaluation.material)");
  });

  it("flagged content stops being served on every partner read path", () => {
    // Bearer-token redeem: refresh-required answers a safe 409.
    expect(fn).toContain('"attestation_refresh_required"');
    // Workspace: the manifest intersection is skipped for flagged content.
    expect(fn).toContain("!attestation.refresh_required_at");
    // The DTO state machine knows the state and nulls non-current procedures.
    expect(workspaceModule).toContain('if (input.attestation.refresh_required_at) return "refresh_required"');
  });

  it("a fresh partner determination discharges the open obligation idempotently", () => {
    const det = fn.slice(
      fn.indexOf('op === "record_partner_determination"'),
      fn.indexOf('op === "list_partner_evidence_deliveries"'));
    expect(det).toContain('from("partner_refresh_obligations").update');
    expect(det).toContain('.eq("status", "open")');
    expect(det).toContain('.eq("required_action", "review_and_redetermine")');
    expect(det).toContain("completed_against_attestation_hash: currentHash");
  });
});

describe("scope: destination comes from the event, never a caller", () => {
  it("the worker notification destination is the event's recorded organisation", () => {
    expect(amlConsumer).toContain("partner_org_id:event.partner_org_id");
    expect(amlConsumer).toMatch(/if\(!event\.partner_org_id\) return/);
  });

  it("the new partner ops sit inside the session-resolved, flag-gated workspace set", () => {
    expect(fn).toContain('"list_partner_refresh_obligations"');
    expect(fn).toContain('"list_partner_notifications"');
    const notifications = fn.slice(
      fn.indexOf('op === "list_partner_notifications"'),
      fn.indexOf('/* ── partner ops: bearer token'));
    expect(notifications).toContain('.eq("partner_org_id", partnerOrg.id)');
  });

  it("both AML worker paths are gated on the database flag on top of the env kill switch", () => {
    expect(amlConsumer).toContain("if(!await amlPartnerEventsEnabled(db)) return");
    expect(amlSweep).toContain("if(!await amlPartnerEventsEnabled(db)) return");
  });
});

describe("phase 6 operational visibility", () => {
  it("the ops card is mounted on the existing AML integration-health surface", () => {
    expect(healthPage).toContain("PartnerEventsOpsCard");
  });

  it("the card reads live counts and expands each figure into the underlying records", () => {
    expect(card).toContain("getPartnerEventsHealth");
    for (const id of ["pending-events", "dead-letters", "open-obligations", "flagged-attestations", "arrangement-reviews"]) {
      expect(card).toContain(`testId="${id}"`);
    }
  });

  it("the card treats source/flag state as recorded configuration and never claims deployment", () => {
    expect(card).toContain("recorded configuration");
    expect(card).toContain("operator action required");
    expect(card).toContain("unknown — not verified");
    // No affirmative environment claims.
    expect(card).not.toMatch(/\b(is live|is deployed|is operational|production-ready)\b/i);
  });

  it("the health op reports flag state and backlog without inventing environment truth", () => {
    const health = fn.slice(
      fn.indexOf('case "get_partner_events_health"'),
      fn.indexOf("default:", fn.indexOf('case "get_partner_events_health"')));
    expect(health).toContain('flagEnabled(admin, "aml_partner_event_outbox")');
    expect(health).toContain("outbox_enabled");
    expect(health).toContain("oldest_pending_at");
    expect(health).toContain("dead_letter_count");
  });
});

describe("the pure catalogue mirrors the seeded SQL catalogue", () => {
  it("every event type seeded in SQL exists in the TypeScript catalogue and vice versa", () => {
    const sqlTypes = [...migration.matchAll(/\('(aml\.[a-z_.]+)',\s*'[a-z_]+',\s*'(ops|partner|both)'/g)]
      .map((m) => m[1]);
    const tsTypes = [...pure.matchAll(/"(aml\.[a-z_.]+)":\s*\{\s*aggregate:/g)].map((m) => m[1]);
    expect(new Set(sqlTypes)).toEqual(new Set(tsTypes));
    expect(sqlTypes.length).toBe(23);
  });

  it("destination classes agree between SQL and TypeScript for every event", () => {
    const sqlDest = new Map(
      [...migration.matchAll(/\('(aml\.[a-z_.]+)',\s*'[a-z_]+',\s*'(ops|partner|both)'/g)]
        .map((m) => [m[1], m[2]]));
    const tsDest = new Map(
      [...pure.matchAll(/"(aml\.[a-z_.]+)":\s*\{\s*aggregate:\s*"[a-z_]+",\s*destination:\s*"(ops|partner|both)"/g)]
        .map((m) => [m[1], m[2]]));
    expect(tsDest.size).toBe(23);
    for (const [type, dest] of sqlDest) {
      expect(tsDest.get(type), type).toBe(dest);
    }
  });
});
