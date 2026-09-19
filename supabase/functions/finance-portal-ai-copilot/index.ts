// finance-portal-ai-copilot — AI Copilot for Finance Portal (Batch 4: items 19–26)
// Actions: summarize_pf | draft_reply | classify_document | prefill_loan_app
//          | recommend_lenders | scan_risk | coach_insights | transcribe_voice
//          | list_summary | list_alerts | dismiss_alert | dismiss_insight
import { hasCopilotObjectPermission } from "../_shared/finance-portal-copilot-auth.ts";
import { extractFinanceToken, makeServiceClient, resolveFinancePartner } from "../_shared/finance-portal-session.ts";
import { consumeRateLimit, enforceJsonBodyLimit } from "../_shared/requestSecurity.ts";

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { meteredFetch } from "../_shared/meteredFetch.ts";
// Dynamic per-request CORS (frontend uses credentials: 'include').
const ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token";
const EXPOSE_HEADERS = "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const MODEL = "google/gemini-2.5-flash";
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_VOICE_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_VOICE_DURATION_SECONDS = 90;

/**
 * The voice-memo bounds, which were called and never defined.
 *
 * `transcribe_voice` opened with `validateVoiceMemo(body.audio_base64,
 * body.duration_seconds)` and no such function existed anywhere in this file or
 * its imports — a ReferenceError on the first line of the route, caught by the
 * handler's outer `catch` and returned as a 500. So the endpoint was broken AND
 * the three abuse controls `financePortalVoiceTranscriptionSecurity.test.ts`
 * asks for were absent from the code, not merely unasserted:
 *
 *  - the payload must be well-formed base64 (length a multiple of four), so a
 *    malformed blob is refused here rather than at the paid gateway;
 *  - the DECODED size is capped at `MAX_VOICE_AUDIO_BYTES`, because base64 is
 *    4/3 the size of what it carries and the request-body limit alone lets a
 *    larger recording through;
 *  - and the duration is server-authoritative, because the client sends it and
 *    it is what the per-minute cost is reasoned about.
 *
 * `HttpError` gives each a 400 rather than the outer catch's 500.
 */
function validateVoiceMemo(audioBase64: unknown, rawDurationSeconds: unknown): void {
  if (typeof audioBase64 !== 'string' || audioBase64.length === 0) {
    throw new HttpError('audio_base64 is required', 400);
  }
  // 3 bytes per 4 base64 characters, less the padding.
  const padding = audioBase64.endsWith('==') ? 2 : audioBase64.endsWith('=') ? 1 : 0;
  const decodedBytes = (audioBase64.length / 4) * 3 - padding;
  if (audioBase64.length % 4 !== 0 || decodedBytes > MAX_VOICE_AUDIO_BYTES) {
    throw new HttpError('Voice memo is malformed or too large', 400);
  }
  const durationSeconds = Number(rawDurationSeconds ?? 0);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new HttpError('duration_seconds must be a number', 400);
  }
  if (durationSeconds > MAX_VOICE_DURATION_SECONDS) {
    throw new HttpError('Voice memo is too long', 400);
  }
}

class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function authorizeObject(
  supabase: any,
  portalUser: any,
  purchaseFileId: unknown,
  clientId: unknown,
  action: "view" | "edit",
) {
  if (purchaseFileId != null && typeof purchaseFileId !== "string") throw new HttpError("Invalid purchase_file_id", 400);
  if (clientId != null && typeof clientId !== "string") throw new HttpError("Invalid client_id", 400);

  let resolvedClientId = clientId as string | null;
  if (purchaseFileId) {
    const { data: file, error } = await supabase
      .from("purchase_files")
      .select("id, client_id")
      .eq("id", purchaseFileId)
      .maybeSingle();
    if (error) throw error;
    if (!file) throw new HttpError("Purchase file not found", 404);
    if (resolvedClientId && resolvedClientId !== file.client_id) throw new HttpError("Forbidden", 403);
    resolvedClientId = file.client_id;
  }

  if (!resolvedClientId) return;
  const { data: assignments, error } = await supabase
    .from("finance_portal_client_assignments")
    .select("permissions, purchase_file_id")
    .eq("finance_user_id", portalUser.id)
    .eq("client_id", resolvedClientId);
  if (error) throw error;
  if (!hasCopilotObjectPermission(
    portalUser.global_permissions,
    assignments ?? [],
    (purchaseFileId as string | null) ?? null,
    action,
  )) throw new HttpError("Forbidden", 403);
}

async function callAI(systemPrompt: string, userPrompt: string, opts?: { tool?: any }) {
  const body: any = {
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };
  if (opts?.tool) {
    body.tools = [opts.tool];
    body.tool_choice = { type: "function", function: { name: opts.tool.function.name } };
  }
  const res = await meteredFetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI gateway ${res.status}: ${text}`);
  }
  const data = await res.json();
  if (opts?.tool) {
    const tc = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc) throw new Error("No tool call in AI response");
    return JSON.parse(tc.function.arguments);
  }
  return data.choices?.[0]?.message?.content ?? "";
}

/* ─────────────── PF context helpers ─────────────── */
async function loadPfContext(supabase: any, pfId: string) {
  const [pfRes, datesRes, decisionsRes, condRes, valRes, docsRes, statusRes, msgsRes] = await Promise.all([
    supabase.from("purchase_files").select("*").eq("id", pfId).maybeSingle(),
    supabase.from("purchase_file_critical_dates").select("date_type, due_date, status").eq("purchase_file_id", pfId),
    supabase.from("purchase_file_finance_decisions").select("outcome, decided_at, snapshot_lender, snapshot_max_approved_budget, lvr, broker_notes, decision_expiry_date").eq("purchase_file_id", pfId).order("decided_at", { ascending: false }).limit(5),
    supabase.from("purchase_file_conditions").select("title, status, due_date").eq("purchase_file_id", pfId),
    supabase.from("purchase_file_valuations").select("status, result, valuation_amount, ordered_date, returned_date").eq("purchase_file_id", pfId),
    supabase.from("document_requirement_instances").select("label, status, owner, category, uploaded_at").eq("purchase_file_id", pfId).limit(40),
    supabase.from("purchase_file_status_history").select("from_value, to_value, created_at").eq("purchase_file_id", pfId).order("created_at", { ascending: false }).limit(8),
    supabase.from("finance_outbound_messages").select("channel, body, created_at, read_at").eq("purchase_file_id", pfId).order("created_at", { ascending: false }).limit(10),
  ]);
  return {
    file: pfRes.data, dates: datesRes.data ?? [], decisions: decisionsRes.data ?? [],
    conditions: condRes.data ?? [], valuations: valRes.data ?? [], documents: docsRes.data ?? [],
    status_history: statusRes.data ?? [], recent_messages: msgsRes.data ?? [],
  };
}

/* ─────────────── Action handlers ─────────────── */
async function summarizePf(supabase: any, pfId: string, userId: string) {
  const ctx = await loadPfContext(supabase, pfId);
  if (!ctx.file) throw new Error("Purchase file not found");
  const result = await callAI(
    "You are an expert Australian mortgage broker assistant. Produce a concise, executive Purchase File summary in JSON. Tone: factual, actionable, NPC-branded (no AI emojis or filler).",
    `Purchase file data:\n${JSON.stringify(ctx, null, 2)}\n\nReturn a tight summary covering current status, outstanding docs, recent decisions, key risks, and next best action.`,
    {
      tool: {
        type: "function",
        function: {
          name: "render_pf_summary",
          description: "Return a structured PF summary",
          parameters: {
            type: "object",
            properties: {
              headline: { type: "string" },
              status_line: { type: "string" },
              outstanding_docs: { type: "array", items: { type: "string" } },
              key_risks: { type: "array", items: { type: "string" } },
              next_best_action: { type: "string" },
              settlement_countdown_days: { type: "number" },
            },
            required: ["headline", "status_line", "next_best_action"],
            additionalProperties: false,
          },
        },
      },
    },
  );
  await supabase.from("ai_pf_summaries").upsert({
    purchase_file_id: pfId, summary: result, model: MODEL, generated_at: new Date().toISOString(), generated_by: userId,
  });
  return result;
}

async function draftReply(supabase: any, pfId: string | null, clientId: string | null, lastMessage: string, intent: string | null) {
  let ctxBlock = "";
  if (pfId) {
    const ctx = await loadPfContext(supabase, pfId);
    ctxBlock = `\nPurchase File context:\n${JSON.stringify({ file: ctx.file, decisions: ctx.decisions, dates: ctx.dates }, null, 2)}`;
  } else if (clientId) {
    const { data: client } = await supabase.from("clients").select("primary_first_name, primary_surname, primary_email, primary_mobile").eq("id", clientId).maybeSingle();
    ctxBlock = `\nClient: ${JSON.stringify(client)}`;
  }
  const text = await callAI(
    "You are an Australian mortgage broker drafting a reply to a client. Be warm, concise, professional. Plain text. No greetings beyond the client's first name. No sign-off; the broker adds their own.",
    `${ctxBlock}\n\nClient message:\n"""${lastMessage}"""\n\nIntent hint: ${intent ?? "reply naturally"}.\n\nDraft the reply.`,
  );
  return { draft: text.trim() };
}

async function classifyDocument(supabase: any, pfId: string, instanceId: string | null, docId: string | null, filename: string, ocrText: string | null) {
  const result = await callAI(
    "You are a mortgage document classifier. Tag the document type, period, and key extracted fields. Treat unclear evidence as low confidence.",
    `Filename: ${filename}\n${ocrText ? `OCR excerpt (truncated):\n${ocrText.slice(0, 4000)}` : "No OCR text available; infer from filename only."}`,
    {
      tool: {
        type: "function",
        function: {
          name: "classify_doc",
          description: "Tag a mortgage document",
          parameters: {
            type: "object",
            properties: {
              classified_type: { type: "string", description: "e.g. payslip, bank_statement, contract_of_sale, id_document, rates_notice, tax_return, other" },
              suggested_label: { type: "string" },
              period_label: { type: "string", description: "e.g. 'June 2026' or '2024-25 FY'" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              extracted_fields: { type: "object", additionalProperties: true },
              is_expired: { type: "boolean" },
            },
            required: ["classified_type", "suggested_label", "confidence"],
            additionalProperties: false,
          },
        },
      },
    },
  );
  const { data } = await supabase.from("ai_doc_classifications").insert({
    purchase_file_id: pfId, document_instance_id: instanceId, document_id: docId,
    classified_type: result.classified_type, suggested_label: result.suggested_label,
    period_label: result.period_label ?? null, confidence: result.confidence,
    extracted_fields: result.extracted_fields ?? {}, is_expired: !!result.is_expired,
    model: MODEL,
  }).select().single();
  return data;
}

async function prefillLoanApp(supabase: any, pfId: string, userId: string) {
  const ctx = await loadPfContext(supabase, pfId);
  const { data: classifications } = await supabase
    .from("ai_doc_classifications")
    .select("classified_type, suggested_label, extracted_fields")
    .eq("purchase_file_id", pfId)
    .order("generated_at", { ascending: false })
    .limit(50);
  const result = await callAI(
    "You are a mortgage application data-extraction agent. Compile a structured loan application sheet from the available evidence. Mark fields you can't fill as null. Never fabricate.",
    `PF context:\n${JSON.stringify({ file: ctx.file, decisions: ctx.decisions }, null, 2)}\n\nDocument classifications & extracted fields:\n${JSON.stringify(classifications, null, 2)}`,
    {
      tool: {
        type: "function",
        function: {
          name: "compile_loan_app",
          description: "Compile a structured loan application data sheet",
          parameters: {
            type: "object",
            properties: {
              applicants: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    full_name: { type: ["string", "null"] },
                    dob: { type: ["string", "null"] },
                    employment_status: { type: ["string", "null"] },
                    employer: { type: ["string", "null"] },
                    gross_annual_income: { type: ["number", "null"] },
                  },
                },
              },
              liabilities: { type: "array", items: { type: "object", additionalProperties: true } },
              property: {
                type: "object",
                properties: {
                  address: { type: ["string", "null"] },
                  purchase_price: { type: ["number", "null"] },
                  loan_amount: { type: ["number", "null"] },
                  lvr: { type: ["number", "null"] },
                },
              },
              gaps: { type: "array", items: { type: "string" } },
            },
            required: ["applicants", "property"],
            additionalProperties: false,
          },
        },
      },
    },
  );
  const { data } = await supabase.from("ai_loan_app_prefills").insert({
    purchase_file_id: pfId, extracted: result, model: MODEL, generated_by: userId,
  }).select().single();
  return data;
}

async function recommendLenders(supabase: any, pfId: string) {
  const ctx = await loadPfContext(supabase, pfId);
  if (!ctx.file) throw new Error("Purchase file not found");
  const { data: playbooks } = await supabase
    .from("lender_playbooks")
    .select("lender_key, lender_label, quirks, rate_band_pa, rate_notes, document_rules, typical_turnaround_days_override")
    .limit(30);
  const result = await callAI(
    "You are an Australian mortgage lender selector. Pick the 3 best-fit lenders given the borrower profile. Use ONLY the provided lender playbooks. Be honest about uncertainty.",
    `Borrower & deal:\n${JSON.stringify({ file: ctx.file, decisions: ctx.decisions, valuations: ctx.valuations }, null, 2)}\n\nAvailable lender playbooks:\n${JSON.stringify(playbooks, null, 2)}`,
    {
      tool: {
        type: "function",
        function: {
          name: "recommend",
          parameters: {
            type: "object",
            properties: {
              recommendations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    lender: { type: "string" },
                    score: { type: "number", minimum: 0, maximum: 100 },
                    rationale: { type: "string" },
                    watchouts: { type: "array", items: { type: "string" } },
                  },
                  required: ["lender", "score", "rationale"],
                },
              },
              overall_note: { type: "string" },
            },
            required: ["recommendations"],
            additionalProperties: false,
          },
        },
      },
    },
  );
  const { data } = await supabase.from("ai_lender_recommendations").insert({
    purchase_file_id: pfId, recommendations: result.recommendations,
    rationale: result.overall_note ?? null, model: MODEL,
  }).select().single();
  return data;
}

async function scanRisk(supabase: any, userId: string) {
  // Pull active PFs for the partner and have AI flag risk patterns
  const { data: assignments } = await supabase
    .from("finance_portal_client_assignments")
    .select("client_id")
    .eq("finance_user_id", userId);
  const clientIds = (assignments ?? []).map((a: any) => a.client_id);
  if (!clientIds.length) return { alerts: [] };
  const { data: pfs } = await supabase
    .from("purchase_files")
    .select("id, property_address, purchase_price, lender, status, settlement_date, finance_clause_date, purchase_type")
    .in("client_id", clientIds)
    .neq("status", "settled")
    .neq("status", "cancelled")
    .limit(50);
  const { data: decisions } = await supabase
    .from("purchase_file_finance_decisions")
    .select("purchase_file_id, outcome, lvr, lmi_applicable, decision_expiry_date, broker_notes")
    .in("purchase_file_id", (pfs ?? []).map((p: any) => p.id));
  const result = await callAI(
    "You are an Australian mortgage risk sniffer. Identify HIGH-IMPACT risks across this partner's active deals (LVR cliffs, expiring approvals, settlement clashes, employment mismatches, LMI exposure, doc gaps, valuation concerns). Be precise. Skip low-signal items.",
    `Active purchase files:\n${JSON.stringify(pfs, null, 2)}\n\nLatest decisions:\n${JSON.stringify(decisions, null, 2)}\n\nToday: ${new Date().toISOString().slice(0, 10)}`,
    {
      tool: {
        type: "function",
        function: {
          name: "emit_risks",
          parameters: {
            type: "object",
            properties: {
              alerts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    purchase_file_id: { type: "string" },
                    alert_type: { type: "string" },
                    severity: { type: "string", enum: ["low", "medium", "high"] },
                    title: { type: "string" },
                    summary: { type: "string" },
                    details: { type: "object", additionalProperties: true },
                  },
                  required: ["purchase_file_id", "alert_type", "severity", "title"],
                },
              },
            },
            required: ["alerts"],
            additionalProperties: false,
          },
        },
      },
    },
  );
  // Persist non-duplicate alerts (by pf+type within last 24h)
  for (const a of result.alerts ?? []) {
    const { data: dup } = await supabase
      .from("ai_risk_alerts")
      .select("id")
      .eq("finance_user_id", userId)
      .eq("purchase_file_id", a.purchase_file_id)
      .eq("alert_type", a.alert_type)
      .eq("status", "open")
      .gte("generated_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .maybeSingle();
    if (dup) continue;
    await supabase.from("ai_risk_alerts").insert({
      finance_user_id: userId, purchase_file_id: a.purchase_file_id, alert_type: a.alert_type,
      severity: a.severity, title: a.title, summary: a.summary ?? null, details: a.details ?? {}, model: MODEL,
    });
  }
  return { generated: (result.alerts ?? []).length };
}

async function coachInsights(supabase: any, userId: string) {
  // Pull partner KPIs and recent activity
  const [kpisRes, activityRes] = await Promise.all([
    supabase.from("finance_partner_commissions").select("milestone, net_amount, created_at").eq("finance_contact_id", userId).limit(20),
    supabase.from("finance_partner_daily_activity").select("activity_date, action_count").eq("finance_contact_id", userId).order("activity_date", { ascending: false }).limit(14),
  ]);
  const result = await callAI(
    "You are an Australian mortgage broker performance coach. Give 2–3 sharp, specific coaching insights based on patterns in the broker's activity. Each should be actionable today.",
    `Recent commissions:\n${JSON.stringify(kpisRes.data, null, 2)}\n\nRecent activity:\n${JSON.stringify(activityRes.data, null, 2)}`,
    {
      tool: {
        type: "function",
        function: {
          name: "coach",
          parameters: {
            type: "object",
            properties: {
              insights: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    body: { type: "string" },
                    action_label: { type: "string" },
                    action_path: { type: "string" },
                    category: { type: "string" },
                  },
                  required: ["title", "body"],
                },
              },
            },
            required: ["insights"],
            additionalProperties: false,
          },
        },
      },
    },
  );
  for (const i of result.insights ?? []) {
    await supabase.from("ai_coach_insights").insert({
      finance_user_id: userId, title: i.title, body: i.body ?? null,
      action_label: i.action_label ?? null, action_path: i.action_path ?? null,
      category: i.category ?? null, model: MODEL,
    });
  }
  return { generated: (result.insights ?? []).length };
}

async function transcribeVoice(supabase: any, userId: string, pfId: string | null, clientId: string | null, audioBase64: string, durationSeconds: number) {
  // Use Gemini multimodal: include audio inline
  const res = await meteredFetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "Transcribe the voice note verbatim, then write a 1-sentence summary. Return JSON: {transcript, summary}." },
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe and summarise this voice note." },
            { type: "input_audio", input_audio: { data: audioBase64, format: "webm" } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI transcribe ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  let parsed: any = {};
  try {
    parsed = JSON.parse(content.replace(/```json\s*|```/g, "").trim());
  } catch {
    parsed = { transcript: content, summary: null };
  }
  const { data: memo } = await supabase.from("ai_voice_memos").insert({
    finance_user_id: userId, purchase_file_id: pfId, client_id: clientId,
    transcript: parsed.transcript ?? null, summary: parsed.summary ?? null,
    duration_seconds: durationSeconds, model: MODEL,
  }).select().single();
  return memo;
}

/* ─────────────── Router ─────────────── */
Deno.serve(async (req) => {
  const corsHeaders = {
    ...__createCorsHeaders(req.headers.get("origin")),
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Expose-Headers": EXPOSE_HEADERS,
  };
  const json = (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const parsed = await enforceJsonBodyLimit<Record<string, unknown>>(req, MAX_REQUEST_BYTES);
    if (!parsed.ok) {
      return new Response(parsed.error.body, { status: parsed.error.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const body: any = parsed.value;
    const token = extractFinanceToken(req.headers, body);
    const supabase = makeServiceClient();
    const auth = await resolveFinancePartner(supabase, token);
    if (auth.error) return json({ error: auth.error }, auth.status);
    const userId = auth.portalUser!.id;
    const action = body.action as string;

    const objectActions: Record<string, "view" | "edit"> = {
      summarize_pf: "edit",
      list_summary: "view",
      draft_reply: "view",
      classify_document: "edit",
      prefill_loan_app: "edit",
      recommend_lenders: "edit",
      transcribe_voice: "edit",
    };
    const purchaseFileActions = new Set([
      "summarize_pf",
      "list_summary",
      "classify_document",
      "prefill_loan_app",
      "recommend_lenders",
    ]);
    if (purchaseFileActions.has(action) && !body.purchase_file_id) {
      throw new HttpError("purchase_file_id required", 400);
    }
    if (objectActions[action]) {
      await authorizeObject(
        supabase,
        auth.portalUser,
        body.purchase_file_id ?? null,
        body.client_id ?? null,
        objectActions[action],
      );
    }

    switch (action) {
      case "summarize_pf": {
        const out = await summarizePf(supabase, body.purchase_file_id, userId);
        return json({ summary: out });
      }
      case "list_summary": {
        const { data } = await supabase.from("ai_pf_summaries").select("*").eq("purchase_file_id", body.purchase_file_id).maybeSingle();
        return json({ summary: data });
      }
      case "draft_reply": {
        const out = await draftReply(supabase, body.purchase_file_id ?? null, body.client_id ?? null, body.last_message ?? "", body.intent ?? null);
        return json(out);
      }
      case "classify_document": {
        const out = await classifyDocument(supabase, body.purchase_file_id, body.document_instance_id ?? null, body.document_id ?? null, body.filename ?? "unnamed", body.ocr_text ?? null);
        return json({ classification: out });
      }
      case "prefill_loan_app": {
        const out = await prefillLoanApp(supabase, body.purchase_file_id, userId);
        return json({ prefill: out });
      }
      case "recommend_lenders": {
        const out = await recommendLenders(supabase, body.purchase_file_id);
        return json({ recommendation: out });
      }
      case "scan_risk": {
        const out = await scanRisk(supabase, userId);
        return json(out);
      }
      case "list_alerts": {
        const { data } = await supabase.from("ai_risk_alerts").select("*").eq("finance_user_id", userId).eq("status", "open").order("generated_at", { ascending: false }).limit(50);
        return json({ alerts: data ?? [] });
      }
      case "dismiss_alert": {
        await supabase.from("ai_risk_alerts").update({ status: "dismissed", resolved_at: new Date().toISOString() }).eq("id", body.id).eq("finance_user_id", userId);
        return json({ ok: true });
      }
      case "coach_insights": {
        const out = await coachInsights(supabase, userId);
        return json(out);
      }
      case "list_insights": {
        const { data } = await supabase.from("ai_coach_insights").select("*").eq("finance_user_id", userId).is("dismissed_at", null).order("generated_at", { ascending: false }).limit(10);
        return json({ insights: data ?? [] });
      }
      case "dismiss_insight": {
        await supabase.from("ai_coach_insights").update({ dismissed_at: new Date().toISOString() }).eq("id", body.id).eq("finance_user_id", userId);
        return json({ ok: true });
      }
      case "transcribe_voice": {
        validateVoiceMemo(body.audio_base64, body.duration_seconds);
        const quota = await consumeRateLimit(supabase, `finance-voice-transcription:user:${userId}`, 5, 60 * 60);
        if (!quota.allowed) {
          return new Response(JSON.stringify({ error: "Voice transcription rate limit reached. Please retry later." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(quota.retryAfterSeconds) },
          });
        }
        const out = await transcribeVoice(supabase, userId, body.purchase_file_id ?? null, body.client_id ?? null, body.audio_base64, body.duration_seconds ?? 0);
        return json({ memo: out });
      }
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e: any) {
    console.error("[finance-portal-ai-copilot]", e);
    const msg = String(e?.message ?? e);
    const status = e instanceof HttpError ? e.status : msg.includes("429") ? 429 : msg.includes("402") ? 402 : 500;
    return json({ error: msg }, status);
  }
});
