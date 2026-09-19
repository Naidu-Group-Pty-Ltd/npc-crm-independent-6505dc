/**
 * Phase 6 — Entities & Beneficial Owners.
 *
 * Ops (POST {op, ...args}):
 *   Entities:  list_entities, get_entity, upsert_entity, delete_entity
 *   Owners:    list_owners, upsert_owner, delete_owner
 *   Reps:      list_reps, upsert_rep, delete_rep
 *   Linking:   list_case_links, link_case, unlink_case, list_entities_for_case
 *   Insights:  ownership_summary
 *
 * Read: any AML role. Writes: analyst/reviewer/mlro.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-command-centre-session-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jr = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function sha256Hex(input: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function appendCaseEvent(
  admin: any, caseId: string, category: string, summary: string,
  payload: any, actorId: string | null, actorLabel: string | null,
) {
  const { data: prev } = await admin.schema("aml").from("case_events")
    .select("row_hash").eq("case_id", caseId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const rowHash = await sha256Hex(JSON.stringify({
    case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel, prev_hash: prevHash, created_at: now,
  }));
  const { error } = await admin.schema("aml").from("case_events").insert({
    case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel,
    prev_hash: prevHash, row_hash: rowHash, created_at: now,
  });
  if (error) throw new Error(`Failed to append case event: ${error.message}`);
}

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service);
    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === "service_role") return jr({ error: auth.error || "Authentication required" }, 401);
    const userId = auth.userId;
    const userLabel = auth.username ?? null;
    const { data: hasAny } = await admin.rpc("has_any_aml_role", { _user_id: userId });
    if (!hasAny) return jr({ error: "AML role required" }, 403);

    const { data: roleRows } = await admin.schema("aml").from("role_assignments")
      .select("role").eq("user_id", userId).is("revoked_at", null);
    const roles = new Set<string>((roleRows ?? []).map((r: any) => r.role));
    const canWrite = roles.has("analyst") || roles.has("reviewer") || roles.has("mlro");

    const op = String(body?.op ?? "");
    const requireWrite = () => { if (!canWrite) throw new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); };

    const aml = admin.schema("aml");

    // ── ENTITIES ─────────────────────────────────────────────
    if (op === "list_entities") {
      const q = String(body.search ?? "").trim();
      const type = body.entity_type ? String(body.entity_type) : null;
      const limit = Math.min(Number(body.limit ?? 100), 500);
      const offset = Number(body.offset ?? 0);
      let query = aml.from("entities").select("*", { count: "exact" })
        .order("updated_at", { ascending: false }).range(offset, offset + limit - 1);
      if (type) query = query.eq("entity_type", type);
      if (q) query = query.or(`legal_name.ilike.%${q}%,trading_name.ilike.%${q}%,abn.ilike.%${q}%,acn.ilike.%${q}%`);
      const { data, count, error } = await query;
      if (error) return jr({ error: error.message }, 400);
      return jr({ entities: data ?? [], total: count ?? 0 });
    }

    if (op === "get_entity") {
      const id = String(body.entity_id ?? "");
      if (!id) return jr({ error: "entity_id required" }, 400);
      const [{ data: entity }, { data: owners }, { data: reps }, { data: links }] = await Promise.all([
        aml.from("entities").select("*").eq("id", id).maybeSingle(),
        aml.from("beneficial_owners").select("*").eq("entity_id", id).order("ownership_percent", { ascending: false }),
        aml.from("authorised_representatives").select("*").eq("entity_id", id).order("role_title"),
        aml.from("entity_case_links").select("*, case:cases(id,case_reference,subject_display_name,status,risk_rating)").eq("entity_id", id),
      ]);
      if (!entity) return jr({ error: "Not found" }, 404);
      return jr({ entity, owners: owners ?? [], reps: reps ?? [], links: links ?? [] });
    }

    if (op === "upsert_entity") {
      requireWrite();
      const patch = body.entity ?? {};
      const isNew = !patch.id;
      const row = { ...patch };
      if (isNew) row.created_by = userId;
      const { data, error } = await aml.from("entities")
        .upsert(row).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      return jr({ entity: data });
    }

    if (op === "delete_entity") {
      requireWrite();
      const id = String(body.entity_id ?? "");
      if (!id) return jr({ error: "entity_id required" }, 400);
      const [{ data: entity }, { data: owners }, { data: reps }, { data: links }] = await Promise.all([
        aml.from("entities").select("id, legal_name, trading_name, entity_type").eq("id", id).maybeSingle(),
        aml.from("beneficial_owners").select("id").eq("entity_id", id),
        aml.from("authorised_representatives").select("id").eq("entity_id", id),
        aml.from("entity_case_links").select("id, case_id, link_role").eq("entity_id", id),
      ]);
      if (!entity) return jr({ error: "Not found" }, 404);
      const affectedLinks = links ?? [];
      for (const link of affectedLinks) {
        await appendCaseEvent(admin, link.case_id, "system", `Entity deletion requested: ${entity.legal_name ?? entity.trading_name ?? id}`,
          {
            entity_id: id,
            link_id: link.id,
            link_role: link.link_role,
            entity_type: entity.entity_type,
            beneficial_owner_count: owners?.length ?? 0,
            authorised_representative_count: reps?.length ?? 0,
          }, userId, userLabel);
      }
      const { error } = await aml.from("entities").delete().eq("id", id);
      if (error) return jr({ error: error.message }, 400);
      return jr({ ok: true, audited_case_count: affectedLinks.length });
    }

    // ── OWNERS ───────────────────────────────────────────────
    if (op === "list_owners") {
      const eid = String(body.entity_id ?? "");
      if (!eid) return jr({ error: "entity_id required" }, 400);
      const { data } = await aml.from("beneficial_owners").select("*").eq("entity_id", eid)
        .order("ownership_percent", { ascending: false });
      return jr({ owners: data ?? [] });
    }
    if (op === "upsert_owner") {
      requireWrite();
      const patch = body.owner ?? {};
      if (!patch.entity_id) return jr({ error: "entity_id required" }, 400);
      const isNew = !patch.id;
      const row = { ...patch };
      if (isNew) row.created_by = userId;
      const { data, error } = await aml.from("beneficial_owners").upsert(row).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      return jr({ owner: data });
    }
    if (op === "delete_owner") {
      requireWrite();
      const id = String(body.owner_id ?? "");
      if (!id) return jr({ error: "owner_id required" }, 400);
      const { data: existing } = await aml.from("beneficial_owners")
        .select("id, entity_id, full_name, ownership_percent, is_ubo, verification_state").eq("id", id).maybeSingle();
      if (!existing) return jr({ error: "Not found" }, 404);
      const { data: links } = await aml.from("entity_case_links").select("id, case_id, link_role").eq("entity_id", existing.entity_id);
      for (const link of links ?? []) {
        await appendCaseEvent(admin, link.case_id, "system", `Beneficial owner deletion requested: ${existing.full_name ?? id}`,
          { owner_id: id, entity_id: existing.entity_id, link_id: link.id, link_role: link.link_role, ownership_percent: existing.ownership_percent, is_ubo: existing.is_ubo, verification_state: existing.verification_state }, userId, userLabel);
      }
      const { error } = await aml.from("beneficial_owners").delete().eq("id", id);
      if (error) return jr({ error: error.message }, 400);
      return jr({ ok: true, audited_case_count: links?.length ?? 0 });
    }

    // ── REPS ─────────────────────────────────────────────────
    if (op === "list_reps") {
      const eid = String(body.entity_id ?? "");
      if (!eid) return jr({ error: "entity_id required" }, 400);
      const { data } = await aml.from("authorised_representatives").select("*").eq("entity_id", eid).order("role_title");
      return jr({ reps: data ?? [] });
    }
    if (op === "upsert_rep") {
      requireWrite();
      const patch = body.rep ?? {};
      if (!patch.entity_id) return jr({ error: "entity_id required" }, 400);
      const isNew = !patch.id;
      const row = { ...patch };
      if (isNew) row.created_by = userId;
      const { data, error } = await aml.from("authorised_representatives").upsert(row).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      return jr({ rep: data });
    }
    if (op === "delete_rep") {
      requireWrite();
      const id = String(body.rep_id ?? "");
      if (!id) return jr({ error: "rep_id required" }, 400);
      const { data: existing } = await aml.from("authorised_representatives")
        .select("id, entity_id, full_name, role_title, verification_state").eq("id", id).maybeSingle();
      if (!existing) return jr({ error: "Not found" }, 404);
      const { data: links } = await aml.from("entity_case_links").select("id, case_id, link_role").eq("entity_id", existing.entity_id);
      for (const link of links ?? []) {
        await appendCaseEvent(admin, link.case_id, "system", `Authorised representative deletion requested: ${existing.full_name ?? id}`,
          { rep_id: id, entity_id: existing.entity_id, link_id: link.id, link_role: link.link_role, role_title: existing.role_title, verification_state: existing.verification_state }, userId, userLabel);
      }
      const { error } = await aml.from("authorised_representatives").delete().eq("id", id);
      if (error) return jr({ error: error.message }, 400);
      return jr({ ok: true, audited_case_count: links?.length ?? 0 });
    }

    // ── CASE LINKS ───────────────────────────────────────────
    if (op === "list_entities_for_case") {
      const caseId = String(body.case_id ?? "");
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const { data } = await aml.from("entity_case_links")
        .select("*, entity:entities(*)").eq("case_id", caseId);
      return jr({ links: data ?? [] });
    }
    if (op === "link_case") {
      requireWrite();
      const caseId = String(body.case_id ?? "");
      const entityId = String(body.entity_id ?? "");
      const linkRole = String(body.link_role ?? "subject");
      if (!caseId || !entityId) return jr({ error: "case_id + entity_id required" }, 400);
      const { data, error } = await aml.from("entity_case_links")
        .upsert({ case_id: caseId, entity_id: entityId, link_role: linkRole, notes: body.notes ?? null, created_by: userId },
          { onConflict: "case_id,entity_id,link_role" })
        .select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      const { data: ent } = await aml.from("entities").select("legal_name").eq("id", entityId).maybeSingle();
      await appendCaseEvent(admin, caseId, "system", `Entity linked (${linkRole}): ${ent?.legal_name ?? entityId}`,
        { entity_id: entityId, link_role: linkRole }, userId, userLabel);
      return jr({ link: data });
    }
    if (op === "unlink_case") {
      requireWrite();
      const id = String(body.link_id ?? "");
      if (!id) return jr({ error: "link_id required" }, 400);
      const { data: existing } = await aml.from("entity_case_links").select("*").eq("id", id).maybeSingle();
      const { error } = await aml.from("entity_case_links").delete().eq("id", id);
      if (error) return jr({ error: error.message }, 400);
      if (existing?.case_id) {
        await appendCaseEvent(admin, existing.case_id, "system", `Entity unlinked`,
          { link_id: id, entity_id: existing.entity_id }, userId, userLabel);
      }
      return jr({ ok: true });
    }

    // ── INSIGHTS ─────────────────────────────────────────────
    if (op === "ownership_summary") {
      const eid = String(body.entity_id ?? "");
      if (!eid) return jr({ error: "entity_id required" }, 400);
      const { data: owners } = await aml.from("beneficial_owners").select("*").eq("entity_id", eid);
      const list = owners ?? [];
      const total = list.reduce((s: number, o: any) => s + Number(o.ownership_percent || 0), 0);
      const ubo = list.filter((o: any) => Number(o.ownership_percent || 0) >= 25 || o.is_ubo);
      const pep = list.filter((o: any) => o.is_pep);
      const sanctioned = list.filter((o: any) => o.is_sanctioned);
      const unverified = list.filter((o: any) => o.verification_state !== "verified" && o.verification_state !== "waived");
      return jr({
        summary: {
          total_owners: list.length,
          total_ownership_percent: Number(total.toFixed(3)),
          ubo_count: ubo.length,
          pep_count: pep.length,
          sanctioned_count: sanctioned.length,
          unverified_count: unverified.length,
          missing_ownership_percent: Math.max(0, 100 - total),
        },
      });
    }

    // ── QUESTIONNAIRE RECONCILIATION (V2 directive Phase 6) ──
    // Imports the client's submitted entity_details + related_parties answers
    // into the canonical entity/owner/rep records. Append-first: source values
    // are always recorded in aml.field_provenance; canonical columns are only
    // filled when currently empty, and any mismatch is flagged as a conflict
    // for an analyst to resolve — never silently overwritten.
    if (op === "import_from_questionnaire") {
      requireWrite();
      const caseId = String(body.case_id ?? "");
      if (!caseId) return jr({ error: "case_id required" }, 400);

      const { data: caseRow, error: caseErr } = await aml.from("cases")
        .select("id, client_id, subject_display_name, subject_type").eq("id", caseId).maybeSingle();
      if (caseErr) return jr({ error: caseErr.message }, 400);
      if (!caseRow) return jr({ error: "Case not found" }, 404);

      const { data: responses, error: respErr } = await aml.from("questionnaire_responses")
        .select("id, section, payload, status, updated_at").eq("case_id", caseId)
        .in("section", ["purchasing_structure", "entity_details", "related_parties"]);
      if (respErr) return jr({ error: respErr.message }, 400);
      const bySection = new Map((responses ?? []).map((r: any) => [r.section, r]));
      const structResp = bySection.get("purchasing_structure");
      const entityResp = bySection.get("entity_details");
      const partiesResp = bySection.get("related_parties");

      const structureType = String(structResp?.payload?.entity_type ?? "");
      const ENTITY_TYPE_MAP: Record<string, string> = {
        Company: "company", Trust: "trust", SMSF: "smsf", Partnership: "partnership",
      };
      const entityType = ENTITY_TYPE_MAP[structureType] ?? null;
      const ep = (entityResp?.payload ?? {}) as Record<string, unknown>;
      const sp = (structResp?.payload ?? {}) as Record<string, unknown>;
      const declaredName = String(ep.entity_name ?? sp.entity_name ?? "").trim();
      const abnAcnDigits = String(ep.abn_acn ?? sp.abn_acn ?? "").replace(/\D/g, "");
      const declaredAbn = abnAcnDigits.length === 11 ? abnAcnDigits : null;
      const declaredAcn = abnAcnDigits.length === 9 ? abnAcnDigits : null;
      const deedDate = String(ep.deed_date ?? "").trim() || null;

      // Provenance idempotency: one row per (source response, field) — repeat
      // imports after new portal saves add rows only for changed sources.
      const sourceIds = (responses ?? []).map((r: any) => String(r.id));
      const { data: priorProv } = sourceIds.length
        ? await aml.from("field_provenance")
          .select("field_key, source_record_id, value").eq("case_id", caseId)
          .in("source_record_id", sourceIds)
        : { data: [] as any[] };
      const provSeen = new Set((priorProv ?? []).map((p: any) => `${p.source_record_id}:${p.field_key}`));
      const provRows: any[] = [];
      const recordProv = (row: {
        field_key: string; value: unknown; source_record_id: string;
        entity_id?: string | null; party_id?: string | null; conflict?: boolean;
      }) => {
        if (provSeen.has(`${row.source_record_id}:${row.field_key}`)) return;
        provSeen.add(`${row.source_record_id}:${row.field_key}`);
        provRows.push({
          case_id: caseId, entity_id: row.entity_id ?? null, party_id: row.party_id ?? null,
          field_key: row.field_key, value: row.value == null ? null : { v: row.value },
          source_type: "client_portal", source_record_id: row.source_record_id,
          source_portal: "client_portal", submitted_by: caseRow.client_id ?? null,
          conflict_status: row.conflict ? "conflict" : "none",
        });
      };

      const report = {
        entity_id: null as string | null,
        entity_created: false,
        entity_fields_filled: [] as string[],
        conflicts: [] as Array<{ scope: string; field: string; recorded: unknown; submitted: unknown }>,
        owners_created: [] as string[],
        reps_created: [] as string[],
        parties_already_recorded: [] as string[],
        parties_needing_review: [] as Array<{ name: string; role: string; reason: string }>,
        provenance_rows_added: 0,
      };

      // 1) Resolve the canonical entity from this case's existing links. Never
      //    match a global entity using client-supplied registration numbers:
      //    an unverified questionnaire must not link to or mutate another
      //    client's canonical ownership records. If this case has no entity,
      //    create one — but only for entity-type structures.
      let entity: any = null;
      const { data: links } = await aml.from("entity_case_links")
        .select("id, entity_id, link_role, entity:entities(*)").eq("case_id", caseId);
      const subjectLink = (links ?? []).find((l: any) => l.link_role === "subject") ?? (links ?? [])[0];
      if (subjectLink?.entity) entity = subjectLink.entity;
      if (!entity && entityType && declaredName) {
        const { data: created, error: createErr } = await aml.from("entities").insert({
          entity_type: entityType, legal_name: declaredName,
          abn: declaredAbn, acn: declaredAcn,
          incorporation_date: deedDate,
          registered_address: ep.registered_address ? { source_text: String(ep.registered_address) } : {},
          metadata: {
            questionnaire_import: {
              structure_type: structureType,
              registration_place: ep.registration_place ?? null,
              business_nature: ep.business_nature ?? null,
              trustee_type: ep.trustee_type ?? null,
              corporate_trustee: ep.corporate_trustee ?? null,
              appointor: ep.appointor ?? null,
              lrba: ep.lrba ?? null,
            },
          },
          created_by: userId,
        }).select("*").maybeSingle();
        if (createErr) return jr({ error: createErr.message }, 400);
        entity = created;
        report.entity_created = true;
      }

      // 2) Reconcile declared registration fields against an existing entity:
      //    fill blanks, flag mismatches, touch nothing that already disagrees.
      if (entity && !report.entity_created) {
        const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        const fieldChecks: Array<{ field: string; submitted: string | null; recorded: unknown }> = [
          { field: "legal_name", submitted: declaredName || null, recorded: entity.legal_name },
          { field: "abn", submitted: declaredAbn, recorded: entity.abn },
          { field: "acn", submitted: declaredAcn, recorded: entity.acn },
          { field: "incorporation_date", submitted: deedDate, recorded: entity.incorporation_date },
        ];
        const patch: Record<string, unknown> = {};
        for (const c of fieldChecks) {
          if (!c.submitted) continue;
          if (c.recorded == null || String(c.recorded).trim() === "") {
            patch[c.field] = c.submitted;
            report.entity_fields_filled.push(c.field);
          } else if (norm(c.recorded) !== norm(c.submitted)) {
            report.conflicts.push({ scope: "entity", field: c.field, recorded: c.recorded, submitted: c.submitted });
          }
        }
        if (Object.keys(patch).length > 0) {
          const { error: patchErr } = await aml.from("entities").update(patch).eq("id", entity.id);
          if (patchErr) return jr({ error: patchErr.message }, 400);
          entity = { ...entity, ...patch };
        }
      }
      report.entity_id = entity?.id ?? null;

      const entitySourceId = String(entityResp?.id ?? structResp?.id ?? "");
      if (entity && entitySourceId) {
        for (const [key, val] of Object.entries({
          "entity.legal_name": declaredName || null,
          "entity.abn_acn": abnAcnDigits || null,
          "entity.registered_address": ep.registered_address ?? null,
          "entity.registration_place": ep.registration_place ?? null,
          "entity.deed_date": deedDate,
          "entity.trustee_type": ep.trustee_type ?? null,
          "entity.corporate_trustee": ep.corporate_trustee ?? null,
          "entity.appointor": ep.appointor ?? null,
          "entity.lrba": ep.lrba ?? null,
        })) {
          if (val == null || val === "") continue;
          recordProv({
            field_key: key, value: val, source_record_id: entitySourceId, entity_id: entity.id,
            conflict: report.conflicts.some((c) => `entity.${c.field}` === key
              || (key === "entity.abn_acn" && (c.field === "abn" || c.field === "acn"))),
          });
        }
      }

      // 3) Ensure the entity is linked to this case as its subject.
      if (entity && !(links ?? []).some((l: any) => l.entity_id === entity.id)) {
        await aml.from("entity_case_links").upsert(
          { case_id: caseId, entity_id: entity.id, link_role: "subject", created_by: userId },
          { onConflict: "case_id,entity_id,link_role" },
        );
      }

      // 4) Related parties → beneficial owners / authorised representatives.
      //    Ownership/control roles become canonical rows on the entity; roles
      //    with no canonical home here (co-purchasers, donors, lenders) are
      //    preserved in provenance and flagged for analyst review.
      const OWNER_ROLE_MAP: Record<string, { control_type: string; is_ubo: boolean }> = {
        "Beneficial owner": { control_type: "shareholding", is_ubo: true },
        "Beneficiary": { control_type: "beneficiary", is_ubo: false },
        "Trustee": { control_type: "trustee", is_ubo: false },
        "Director": { control_type: "director", is_ubo: false },
      };
      const parties = Array.isArray(partiesResp?.payload?.parties) ? partiesResp.payload.parties : [];
      const partySourceId = String(partiesResp?.id ?? "");
      const { data: existingOwners } = entity
        ? await aml.from("beneficial_owners").select("id, full_name, date_of_birth").eq("entity_id", entity.id)
        : { data: [] as any[] };
      const { data: existingReps } = entity
        ? await aml.from("authorised_representatives").select("id, full_name").eq("entity_id", entity.id)
        : { data: [] as any[] };
      const ownerByName = new Map((existingOwners ?? []).map((o: any) => [String(o.full_name).trim().toLowerCase(), o]));
      const repByName = new Map((existingReps ?? []).map((r: any) => [String(r.full_name).trim().toLowerCase(), r]));

      for (let i = 0; i < parties.length; i++) {
        const p = parties[i] ?? {};
        const name = String(p.full_name ?? "").trim();
        const role = String(p.role ?? "").trim();
        if (!name) continue;
        const nameKey = name.toLowerCase();
        const pctMatch = String(p.relationship ?? "").match(/(\d+(?:\.\d+)?)\s*%/);
        const provKey = `related_party.${i}`;
        let partyId: string | null = null;

        if (entity && OWNER_ROLE_MAP[role]) {
          const existing = ownerByName.get(nameKey);
          if (existing) {
            partyId = existing.id;
            report.parties_already_recorded.push(name);
            if (p.dob && existing.date_of_birth && String(existing.date_of_birth) !== String(p.dob)) {
              report.conflicts.push({ scope: `owner:${name}`, field: "date_of_birth", recorded: existing.date_of_birth, submitted: p.dob });
            }
          } else {
            const { data: owner, error: ownerErr } = await aml.from("beneficial_owners").insert({
              entity_id: entity.id, full_name: name,
              date_of_birth: p.dob || null,
              ownership_percent: pctMatch ? Number(pctMatch[1]) : 0,
              control_type: OWNER_ROLE_MAP[role].control_type,
              is_ubo: OWNER_ROLE_MAP[role].is_ubo || (pctMatch ? Number(pctMatch[1]) >= 25 : false),
              notes: p.relationship ? `Client-declared: ${p.relationship}` : null,
              metadata: { questionnaire_import: { role, email: p.email ?? null } },
              created_by: userId,
            }).select("id").maybeSingle();
            if (ownerErr) return jr({ error: ownerErr.message }, 400);
            partyId = owner?.id ?? null;
            ownerByName.set(nameKey, { id: partyId, full_name: name, date_of_birth: p.dob || null });
            report.owners_created.push(name);
          }
        } else if (entity && role === "Authorised representative") {
          const existing = repByName.get(nameKey);
          if (existing) {
            partyId = existing.id;
            report.parties_already_recorded.push(name);
          } else {
            const { data: rep, error: repErr } = await aml.from("authorised_representatives").insert({
              entity_id: entity.id, full_name: name, role_title: "Authorised representative",
              metadata: { questionnaire_import: { email: p.email ?? null, relationship: p.relationship ?? null } },
              created_by: userId,
            }).select("id").maybeSingle();
            if (repErr) return jr({ error: repErr.message }, 400);
            partyId = rep?.id ?? null;
            repByName.set(nameKey, { id: partyId, full_name: name });
            report.reps_created.push(name);
          }
        } else {
          report.parties_needing_review.push({
            name, role: role || "Unspecified",
            reason: entity ? "role_has_no_canonical_owner_record" : "no_entity_structure_on_case",
          });
        }

        if (partySourceId) {
          recordProv({
            field_key: provKey, source_record_id: partySourceId,
            entity_id: entity?.id ?? null, party_id: partyId,
            value: { role, full_name: name, dob: p.dob ?? null, email: p.email ?? null, relationship: p.relationship ?? null },
          });
        }
      }

      if (provRows.length > 0) {
        const { error: provErr } = await aml.from("field_provenance").insert(provRows);
        if (provErr) return jr({ error: provErr.message }, 400);
        report.provenance_rows_added = provRows.length;
      }

      await appendCaseEvent(admin, caseId, "system",
        "Client questionnaire reconciled into ownership records",
        {
          entity_id: report.entity_id, entity_created: report.entity_created,
          entity_fields_filled: report.entity_fields_filled,
          owners_created: report.owners_created.length,
          reps_created: report.reps_created.length,
          conflicts: report.conflicts.length,
          parties_needing_review: report.parties_needing_review.length,
          provenance_rows_added: report.provenance_rows_added,
        }, userId, userLabel);

      return jr({ report });
    }

    // ── VERIFICATION RELATIONSHIPS (Phase 6) ─────────────────
    // Ties a beneficial owner or authorised representative to a concrete
    // identity/screening check on the case. The party's verification_state is
    // derived from the linked check's actual status — never set directly, so
    // "verified" always traces to a real check record.
    if (op === "link_verification") {
      requireWrite();
      const caseId = String(body.case_id ?? "");
      const target = String(body.target ?? "");
      const partyId = String(body.party_id ?? "");
      const identityCheckId = body.identity_check_id ? String(body.identity_check_id) : null;
      const screeningCheckId = body.screening_check_id ? String(body.screening_check_id) : null;
      if (!caseId || !partyId) return jr({ error: "case_id + party_id required" }, 400);
      if (target !== "owner" && target !== "rep") return jr({ error: "target must be owner or rep" }, 400);
      if (!identityCheckId && !screeningCheckId) return jr({ error: "identity_check_id or screening_check_id required" }, 400);
      if (target === "rep" && screeningCheckId) return jr({ error: "representatives carry identity checks only" }, 400);

      const table = target === "owner" ? "beneficial_owners" : "authorised_representatives";
      const { data: party } = await aml.from(table)
        .select("id, entity_id, full_name, verification_state").eq("id", partyId).maybeSingle();
      if (!party) return jr({ error: "Party not found" }, 404);
      const { data: link } = await aml.from("entity_case_links")
        .select("id").eq("case_id", caseId).eq("entity_id", party.entity_id).limit(1).maybeSingle();
      if (!link) return jr({ error: "Party's entity is not linked to this case" }, 400);

      const patch: Record<string, unknown> = {};
      let derivedState: string | null = null;
      if (identityCheckId) {
        const { data: check } = await aml.from("identity_checks")
          .select("id, case_id, status").eq("id", identityCheckId).maybeSingle();
        if (!check) return jr({ error: "Identity check not found" }, 404);
        if (check.case_id !== caseId) return jr({ error: "Identity check belongs to a different case" }, 400);
        patch.identity_check_id = identityCheckId;
        derivedState = String(check.status) === "verified"
          ? "verified"
          : String(check.status) === "failed" ? "failed" : "pending";
      }
      if (screeningCheckId) {
        const { data: check } = await aml.from("screening_checks")
          .select("id, case_id, status").eq("id", screeningCheckId).maybeSingle();
        if (!check) return jr({ error: "Screening check not found" }, 404);
        if (check.case_id !== caseId) return jr({ error: "Screening check belongs to a different case" }, 400);
        patch.screening_check_id = screeningCheckId;
      }
      if (derivedState) patch.verification_state = derivedState;

      const { data: updated, error: updErr } = await aml.from(table)
        .update(patch).eq("id", partyId).select("*").maybeSingle();
      if (updErr) return jr({ error: updErr.message }, 400);

      await appendCaseEvent(admin, caseId, "system",
        `Verification linked for ${party.full_name}`,
        {
          target, party_id: partyId, entity_id: party.entity_id,
          identity_check_id: identityCheckId, screening_check_id: screeningCheckId,
          verification_state: derivedState ?? party.verification_state,
        }, userId, userLabel);
      return jr({ [target === "owner" ? "owner" : "rep"]: updated });
    }

    // Case-scoped provenance read for the Command Centre workspace (any AML
    // role). Never exposed to the client or finance portals — this function
    // is not reachable from those surfaces.
    if (op === "list_provenance") {
      const caseId = String(body.case_id ?? "");
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const { data, error } = await aml.from("field_provenance")
        .select("id, entity_id, party_id, field_key, value, source_type, source_record_id, submitted_at, conflict_status, verification_status, is_canonical, resolution_reason")
        .eq("case_id", caseId).order("submitted_at", { ascending: false }).limit(500);
      if (error) return jr({ error: error.message }, 400);
      return jr({ provenance: data ?? [] });
    }

    return jr({ error: `Unknown op: ${op}` }, 400);
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("aml-entities error", e);
    return jr({ ...internalError(e, 'aml-entities') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
