// Pre-generates editorial hero banner images for premium PDF reports and
// stores them in Supabase Storage. Designed to be called repeatedly with
// small batches so we never bump into the Lovable AI / edge-function timeout.
//
// Actions (POST body):
//   { action: "enqueue",  reportId, regenerate? }   -> creates pending rows
//   { action: "process",  reportId, max? }          -> generates up to N pending
//   { action: "status",   reportId }                -> returns progress + assets

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { createCorsHeaders, createForbiddenResponse, createUnauthorizedResponse, verifyAuth } from "../_shared/auth.ts";
import { actorIsSuperadmin, requireModulePermission, type ModulePerm } from "../_shared/authz.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { signStoragePaths } from "../_shared/storageSign.ts";
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = (Deno.env.get("LOVABLE_API_KEY") || "").trim();
const BUCKET = "investment-reports";
const STORAGE_PREFIX = "hero-images";
const IMAGE_TIMEOUT_MS = 90_000;
const DEFAULT_BATCH = 3; // images per `process` call

async function canAccessReport(
  supabase: any,
  actor: { userId: string; authMethod?: string | null },
  reportId: string,
  permission: ModulePerm,
): Promise<boolean> {
  const moduleAccess = await requireModulePermission(supabase, actor, "reports", permission);
  if (!moduleAccess.ok) return false;
  if (actor.authMethod === "service_role" || await actorIsSuperadmin(supabase, actor.userId)) return true;

  const { data: report } = await supabase
    .from("investment_reports")
    .select("id")
    .eq("id", reportId)
    .eq("generated_by", actor.userId)
    .maybeSingle();
  return Boolean(report);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Same cleaner as the renderer so we extract identical chapter titles.
function cleanReportMarkdown(markdown: string, address: string): string {
  const addressPattern = escapeRegExp(address).replace(/\s+/g, "\\s+");
  let out = markdown;
  out = out.replace(/^\s*#{0,3}\s*NAIDU PROPERTY CONSULTING(\s+SERVICES)?\s*\n+/gim, "");
  out = out.replace(/^\s*#{0,3}\s*YOUR DEDICATED PROPERTY PARTNER\s*\n+/gim, "");
  out = out.replace(
    new RegExp(`^\\s*#{0,3}\\s*Investment Report:\\s*${addressPattern}\\s*\\n+`, "gim"),
    "",
  );
  out = out.replace(/\[\s*citation\s*\]/gi, "");
  out = out.replace(/\[\s*sources?\s*\]/gi, "");
  out = out.replace(/\[\s*ref(?:erence)?\s*\]/gi, "");
  out = out.replace(/^\s*#\s+/gm, "## ");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

const MAX_HERO_IMAGES = 15;
const MAX_SELECTIONS = MAX_HERO_IMAGES;

function extractChapterTitles(markdown: string, address: string): string[] {
  const cleaned = cleanReportMarkdown(String(markdown || ""), address);
  const titles: string[] = [];
  const seen = new Set<string>();
  const re = /^##\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    const title = m[1].replace(/[*_`#]/g, "").trim();
    if (!title) continue;
    // Skip trivial / non-chapter headings
    if (title.length < 4) continue;
    if (/^(sources?|references?|appendix|disclaimer|notes?|glossary)\b/i.test(title)) continue;
    const key = slugify(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length >= MAX_HERO_IMAGES) break;
  }
  return titles;
}

async function hashPrompt(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

function buildPrompt(chapterTitle: string): string {
  return `Editorial magazine-style hero banner image for a premium Australian property investment report chapter titled "${chapterTitle}". Cinematic, sophisticated, navy-blue and deep midnight palette with subtle gold metallic accents. Architectural / abstract / atmospheric composition (no people, no text, no logos, no charts). Wide landscape orientation, soft depth-of-field, refined editorial finish suitable for a luxury financial publication. Print-ready, high contrast, no watermark.`;
}

async function generateOne(chapterTitle: string): Promise<{ bytes: Uint8Array }> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const res = await meteredFetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-image-2",
        prompt: buildPrompt(chapterTitle),
        quality: "low",
        size: "1536x1024",
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`gateway ${res.status}: ${t.slice(0, 200)}`);
    }
    const json = await res.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) throw new Error("no b64_json in response");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = await req.json().catch(() => ({}));

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return createUnauthorizedResponse(auth.error || "Authentication required", corsHeaders);
    }

    const action = String(body?.action || "").toLowerCase();
    const reportId = String(body?.reportId || "");
    if (!reportId) {
      return new Response(JSON.stringify({ error: "reportId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const actor = { userId: auth.userId, authMethod: auth.authMethod };
    const permission: ModulePerm = action === "status" || action === "list" ? "can_view" : "can_edit";
    if (!await canAccessReport(supabase, actor, reportId, permission)) {
      return createForbiddenResponse(`Report ${permission === "can_view" ? "view" : "edit"} permission required`, corsHeaders);
    }

    if (action === "enqueue") {
      const regenerate = body?.regenerate === true;
      const { data: report, error } = await supabase
        .from("investment_reports")
        .select("id, property_address, report_content")
        .eq("id", reportId)
        .maybeSingle();
      if (error || !report) {
        return new Response(JSON.stringify({ error: error?.message || "report not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const titles = extractChapterTitles(report.report_content || "", report.property_address || "");
      const rows: any[] = [];
      for (const title of titles) {
        const sectionKey = slugify(title);
        const promptHash = await hashPrompt(buildPrompt(title));
        rows.push({
          report_id: reportId,
          section_key: sectionKey,
          section_title: title,
          prompt_hash: promptHash,
          status: "pending",
          attempts: 0,
          error: null,
        });
      }

      if (regenerate) {
        // Wipe so process() regenerates everything fresh.
        await supabase.from("report_visual_assets").delete().eq("report_id", reportId);
      }

      // Upsert: only fills in missing or already-pending/failed; we don't reset ready rows.
      if (rows.length > 0) {
        // First fetch existing keys to avoid resetting ready rows.
        const { data: existing } = await supabase
          .from("report_visual_assets")
          .select("section_key, status, prompt_hash")
          .eq("report_id", reportId);
        const existingMap = new Map((existing || []).map((r: any) => [r.section_key, r]));
        const toInsert = rows.filter((r) => {
          const ex = existingMap.get(r.section_key);
          if (!ex) return true;
          // Re-queue if prompt changed or last attempt failed.
          if (ex.status === "failed") return false; // keep, will be retried by process()
          if (ex.prompt_hash !== r.prompt_hash) return true;
          return false;
        });
        // Bulk insert new ones (ignore unique conflicts).
        for (const row of toInsert) {
          await supabase
            .from("report_visual_assets")
            .upsert(row, { onConflict: "report_id,section_key" });
        }
      }

      const counts = await fetchCounts(supabase, reportId);
      return jsonOk({ enqueued: rows.length, ...counts }, corsHeaders);
    }

    if (action === "status" || action === "list") {
      const counts = await fetchCounts(supabase, reportId);
      const { data: assets } = await supabase
        .from("report_visual_assets")
        .select("id, section_key, section_title, status, public_url, storage_path, include_in_report, error, attempts, updated_at")
        .eq("report_id", reportId)
        .order("created_at", { ascending: true });
      (counts as any).selected = (assets || []).filter((a: any) => a.include_in_report && a.status === "ready").length;
      // investment-reports is private (STOR-005): return a signed URL in public_url
      // (resolved from storage_path) so the frontend can render each asset.
      const signed = await signStoragePaths(supabase, BUCKET, (assets || []).map((a: any) => a.storage_path), 60 * 60);
      for (const a of (assets || []) as any[]) if (a.storage_path && signed[a.storage_path]) a.public_url = signed[a.storage_path];
      return jsonOk({ ...counts, assets: assets || [] }, corsHeaders);
    }

    if (action === "set_selection") {
      const permission = await requireModulePermission(
        supabase,
        { userId: auth.userId, authMethod: auth.authMethod },
        "reports",
        "can_edit",
      );
      if (!permission.ok) {
        return new Response(JSON.stringify({ error: permission.error || "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const requested: unknown[] = Array.isArray(body?.selections)
        ? body.selections
        : (body?.sectionKey != null ? [{ sectionKey: String(body.sectionKey), include: body.include !== false }] : []);
      if (requested.length === 0 || requested.length > MAX_SELECTIONS) {
        return new Response(JSON.stringify({ error: `selections must contain between 1 and ${MAX_SELECTIONS} items` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const selections = new Map<string, boolean>();
      for (const item of requested) {
        const sectionKey = typeof (item as any)?.sectionKey === "string" ? (item as any).sectionKey.trim() : "";
        if (!sectionKey || sectionKey.length > 60 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sectionKey)) {
          return new Response(JSON.stringify({ error: "Each selection requires a valid sectionKey" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        selections.set(sectionKey, (item as any).include !== false);
      }

      const { data: report, error: reportError } = await supabase
        .from("investment_reports")
        .select("id")
        .eq("id", reportId)
        .maybeSingle();
      if (reportError || !report) {
        return new Response(JSON.stringify({ error: reportError?.message || "report not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let updated = 0;
      for (const include of [true, false]) {
        const sectionKeys = [...selections].filter(([, selected]) => selected === include).map(([key]) => key);
        if (sectionKeys.length === 0) continue;
        const { error: upErr } = await supabase
          .from("report_visual_assets")
          .update({ include_in_report: include })
          .eq("report_id", reportId)
          .in("section_key", sectionKeys);
        if (upErr) throw upErr;
        updated += sectionKeys.length;
      }
      const counts = await fetchCounts(supabase, reportId);
      return jsonOk({ updated, ...counts }, corsHeaders);
    }

    if (action === "regenerate_one") {
      // Force a single section back to pending so the next `process` re-renders it.
      const sectionKey = String(body?.sectionKey || "");
      if (!sectionKey) {
        return new Response(JSON.stringify({ error: "sectionKey required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await supabase
        .from("report_visual_assets")
        .update({ status: "pending", error: null })
        .eq("report_id", reportId)
        .eq("section_key", sectionKey);
      const counts = await fetchCounts(supabase, reportId);
      return jsonOk({ requeued: 1, ...counts }, corsHeaders);
    }

    if (action === "process") {
      const max = Math.min(Math.max(Number(body?.max) || DEFAULT_BATCH, 1), 5);
      // Claim a batch (pending or failed with attempts<3)
      const { data: claim } = await supabase
        .from("report_visual_assets")
        .select("id, section_key, section_title, attempts")
        .eq("report_id", reportId)
        .or("status.eq.pending,and(status.eq.failed,attempts.lt.3)")
        .order("created_at", { ascending: true })
        .limit(max);
      const queue = claim || [];
      if (queue.length === 0) {
        const counts = await fetchCounts(supabase, reportId);
        return jsonOk({ processed: 0, ...counts }, corsHeaders);
      }

      // Mark processing
      await supabase
        .from("report_visual_assets")
        .update({ status: "processing" })
        .in("id", queue.map((r: any) => r.id));

      let processed = 0;
      for (const row of queue) {
        try {
          const { bytes } = await generateOne(row.section_title);
          const path = `${STORAGE_PREFIX}/${reportId}/${row.section_key}.png`;
          const { error: upErr } = await supabase
            .storage
            .from(BUCKET)
            .upload(path, bytes, {
              contentType: "image/png",
              upsert: true,
              cacheControl: "31536000",
            });
          if (upErr) throw upErr;
          const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
          await supabase
            .from("report_visual_assets")
            .update({
              status: "ready",
              storage_path: path,
              public_url: pub.publicUrl,
              error: null,
              attempts: (row.attempts || 0) + 1,
            })
            .eq("id", row.id);
          processed++;
        } catch (err: any) {
          console.warn("[hero-worker] failed", row.section_key, err?.message || err);
          await supabase
            .from("report_visual_assets")
            .update({
              status: "failed",
              error: String(err?.message || err).slice(0, 500),
              attempts: (row.attempts || 0) + 1,
            })
            .eq("id", row.id);
        }
      }

      const counts = await fetchCounts(supabase, reportId);
      return jsonOk({ processed, ...counts }, corsHeaders);
    }

    return new Response(JSON.stringify({ error: "unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[prepare-report-hero-images]", err);
    return new Response(JSON.stringify(internalError(err, 'prepare-report-hero-images')), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function fetchCounts(supabase: any, reportId: string) {
  const { data } = await supabase
    .from("report_visual_assets")
    .select("status")
    .eq("report_id", reportId);
  const rows = data || [];
  const counts = { total: rows.length, ready: 0, pending: 0, processing: 0, failed: 0 } as Record<string, number>;
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  return counts;
}

function jsonOk(obj: any, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(obj), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
