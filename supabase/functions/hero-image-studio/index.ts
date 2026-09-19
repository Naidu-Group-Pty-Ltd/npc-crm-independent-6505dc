// Hero Image Studio — cross-report image library + per-chapter placements.
//
// Actions (POST body):
//   { action: "enhance_prompt", prompt }
//   { action: "generate", prompt, model?, aspectRatio?, variations?, sourceReportId? }
//   { action: "library_list", search?, model?, orientation?, sourceReportId?, limit?, offset?, includeArchived? }
//   { action: "library_update", libraryImageId, tags?, prompt?, archive? }
//   { action: "library_delete", libraryImageId }
//   { action: "chapters_list", reportId }
//   { action: "placements_list", reportId }
//   { action: "placement_set", reportId, sectionKey, sectionTitle, libraryImageId, renderHeight?, renderWidth?, objectFit?, focal?, rounded? }
//   { action: "placement_clear", reportId, sectionKey }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { createCorsHeaders, createForbiddenResponse, createUnauthorizedResponse, verifyAuth } from "../_shared/auth.ts";
import { actorIsSuperadmin, requireModulePermission, type ModulePerm } from "../_shared/authz.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { signStoragePath, signStoragePaths } from "../_shared/storageSign.ts";
import { validateReferenceImages } from "./referenceImages.ts";
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';

// investment-reports is private (STOR-005): resolve display URLs by signing each
// row's storage_path. The signed URL is returned in the same public_url/
// thumbnail_url fields the frontend already reads, so no client change is needed.
async function withSignedHeroUrls<T extends { storage_path?: string | null; public_url?: string | null; thumbnail_url?: string | null }>(
  supabase: any,
  rows: T[],
): Promise<T[]> {
  const signed = await signStoragePaths(supabase, BUCKET, rows.map((r) => r?.storage_path), 60 * 60);
  for (const r of rows) {
    const url = r?.storage_path ? signed[r.storage_path] : null;
    if (url) {
      r.public_url = url;
      if (r.thumbnail_url !== undefined) r.thumbnail_url = url;
    }
  }
  return rows;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = (Deno.env.get("LOVABLE_API_KEY") || "").trim();
const BUCKET = "investment-reports";
const STORAGE_PREFIX = "hero-library";
const IMAGE_TIMEOUT_MS = 120_000;

const ALLOWED_MODELS = new Set([
  "openai/gpt-image-2",
  "openai/gpt-image-1-mini",
  "google/gemini-3-pro-image-preview",
  "google/gemini-3.1-flash-image-preview",
  "google/gemini-2.5-flash-image",
]);

const ASPECT_TO_SIZE: Record<string, { w: number; h: number }> = {
  "16:9":  { w: 1536, h: 864 },
  "3:2":   { w: 1536, h: 1024 },
  "4:3":   { w: 1408, h: 1056 },
  "1:1":   { w: 1024, h: 1024 },
  "3:4":   { w: 1056, h: 1408 },
  "9:16":  { w: 864,  h: 1536 },
  "21:9":  { w: 1792, h: 768 },
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function jsonOk(obj: any, corsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function jsonErr(msg: string, corsHeaders: Record<string, string>, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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

async function enhancePrompt(raw: string): Promise<string> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");
  const system = `You rewrite raw user prompts into vivid, editorial, print-ready image briefs for a premium Australian property investment publication.

Rules:
- Return ONE paragraph (50–90 words). No bullet points, no preamble, no quotes.
- Keep the user's core subject intact.
- Add: cinematic lighting, palette guidance, composition, mood, lens/feel, finish (e.g. "editorial magazine finish", "print-ready").
- No people, no text, no logos, no charts, no watermarks.
- Wide landscape framing unless the user specifies otherwise.`;

  const res = await meteredFetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: raw.trim() },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`enhance gateway ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  const out = json?.choices?.[0]?.message?.content?.trim?.();
  if (!out) throw new Error("no enhanced prompt returned");
  return String(out).replace(/^["']|["']$/g, "");
}

async function generateOne(opts: {
  prompt: string;
  model: string;
  width: number;
  height: number;
  aspect: string;
  referenceImages?: string[];
}): Promise<Uint8Array> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const isGemini = opts.model.startsWith("google/");
    const refs = (opts.referenceImages || []).map((url) => ({
      type: "image_url",
      image_url: { url },
    }));

    const body: any = isGemini
      ? {
          model: opts.model,
          messages: [
            {
              role: "user",
              content: refs.length
                ? [{ type: "text", text: opts.prompt }, ...refs]
                : opts.prompt,
            },
          ],
          modalities: ["image", "text"],
        }
      : {
          model: opts.model,
          prompt: opts.prompt,
          quality: "low",
          size: `${opts.width}x${opts.height}`,
        };

    const res = await meteredFetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`gateway ${res.status}: ${t.slice(0, 240)}`);
    }
    const json = await res.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) throw new Error("no b64_json in response");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
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
    const boundedBody = await enforceRawBodyLimit(req, MAX_REQUEST_BYTES);
    if (!boundedBody.ok) return jsonErr("request too large", corsHeaders, 413);
    let body: any;
    try {
      body = JSON.parse(boundedBody.raw || "{}");
    } catch {
      return jsonErr("invalid JSON", corsHeaders);
    }

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error) return createUnauthorizedResponse(auth.error, corsHeaders);

    const userId = String(auth.userId || "");
    const actor = { userId, authMethod: auth.authMethod };
    const action = String(body?.action || "").toLowerCase();

    // ── enhance_prompt ────────────────────────────────────────────────────
    if (action === "enhance_prompt") {
      const raw = String(body?.prompt || "").trim();
      if (!raw) return jsonErr("prompt required", corsHeaders);
      const enhanced = await enhancePrompt(raw);
      return jsonOk({ prompt: raw, enhanced }, corsHeaders);
    }

    // ── generate ──────────────────────────────────────────────────────────
    if (action === "generate") {
      const prompt = String(body?.prompt || "").trim();
      if (!prompt) return jsonErr("prompt required", corsHeaders);
      const model = ALLOWED_MODELS.has(String(body?.model))
        ? String(body.model)
        : "openai/gpt-image-2";
      const aspect = ASPECT_TO_SIZE[String(body?.aspectRatio)] ? String(body.aspectRatio) : "3:2";
      const { w, h } = ASPECT_TO_SIZE[aspect];
      const variations = Math.min(Math.max(Number(body?.variations) || 1, 1), 4);
      const sourceReportId = body?.sourceReportId ? String(body.sourceReportId) : null;
      let referenceImages: string[];
      try {
        referenceImages = validateReferenceImages(body?.referenceImages);
      } catch (error) {
        return jsonErr(error instanceof Error ? error.message : "invalid reference images", corsHeaders);
      }

      const results: any[] = [];
      const errors: string[] = [];

      for (let i = 0; i < variations; i++) {
        try {
          const bytes = await generateOne({ prompt, model, width: w, height: h, aspect, referenceImages });
          const id = crypto.randomUUID();
          const path = `${STORAGE_PREFIX}/${userId || "anon"}/${id}.png`;
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
          const { data: inserted, error: insErr } = await supabase
            .from("hero_image_library")
            .insert({
              id,
              owner_user_id: userId,
              source_report_id: sourceReportId,
              prompt,
              enhanced_prompt: body?.enhancedPrompt ? String(body.enhancedPrompt) : null,
              model,
              aspect_ratio: aspect,
              width: w,
              height: h,
              status: "ready",
              storage_path: path,
              public_url: pub.publicUrl,
              thumbnail_url: pub.publicUrl,
            })
            .select()
            .single();
          if (insErr) throw insErr;
          results.push(inserted);
        } catch (err: any) {
          errors.push(String(err?.message || err));
        }
      }
      return jsonOk({ images: await withSignedHeroUrls(supabase, results), errors }, corsHeaders);
    }

    // ── library_list ──────────────────────────────────────────────────────
    if (action === "library_list") {
      const limit = Math.min(Math.max(Number(body?.limit) || 60, 1), 200);
      const offset = Math.max(Number(body?.offset) || 0, 0);
      let q = supabase
        .from("hero_image_library")
        .select("*", { count: "exact" })
        .eq("owner_user_id", userId)
        .order("created_at", { ascending: false });
      if (!body?.includeArchived) q = q.eq("is_archived", false);
      if (body?.model) q = q.eq("model", String(body.model));
      if (body?.sourceReportId) q = q.eq("source_report_id", String(body.sourceReportId));
      if (body?.search) {
        const s = String(body.search).replace(/[%_]/g, "");
        q = q.or(`prompt.ilike.%${s}%,enhanced_prompt.ilike.%${s}%`);
      }
      // Orientation filtering done client-side below
      const { data, count, error } = await q.range(offset, offset + limit - 1);
      if (error) return jsonErr(error.message, corsHeaders, 500);
      let images = data || [];
      if (body?.orientation === "landscape") images = images.filter((r: any) => r.width >= r.height);
      if (body?.orientation === "portrait") images = images.filter((r: any) => r.height > r.width);
      if (body?.orientation === "square") images = images.filter((r: any) => r.width === r.height);
      return jsonOk({ images: await withSignedHeroUrls(supabase, images), total: count ?? images.length }, corsHeaders);
    }

    // ── library_update / library_delete ──────────────────────────────────
    if (action === "library_update") {
      const id = String(body?.libraryImageId || "");
      if (!id) return jsonErr("libraryImageId required", corsHeaders);
      const patch: any = {};
      if (Array.isArray(body?.tags)) patch.tags = body.tags.map((t: any) => String(t));
      if (typeof body?.prompt === "string") patch.prompt = body.prompt;
      if (typeof body?.archive === "boolean") patch.is_archived = body.archive;
      const { data, error } = await supabase
        .from("hero_image_library")
        .update(patch)
        .eq("id", id)
        .eq("owner_user_id", userId)
        .select()
        .maybeSingle();
      if (error) return jsonErr(error.message, corsHeaders, 500);
      return jsonOk({ image: data }, corsHeaders);
    }

    if (action === "library_delete") {
      const id = String(body?.libraryImageId || "");
      if (!id) return jsonErr("libraryImageId required", corsHeaders);
      // try to remove storage object first
      const { data: row } = await supabase
        .from("hero_image_library")
        .select("storage_path")
        .eq("id", id)
        .eq("owner_user_id", userId)
        .maybeSingle();
      if (row?.storage_path) {
        await supabase.storage.from(BUCKET).remove([row.storage_path]).catch(() => {});
      }
      const { error } = await supabase
        .from("hero_image_library")
        .delete()
        .eq("id", id)
        .eq("owner_user_id", userId);
      if (error) return jsonErr(error.message, corsHeaders, 500);
      return jsonOk({ deleted: true }, corsHeaders);
    }

    // ── library_upload (raw image, no AI) ────────────────────────────────
    if (action === "library_upload") {
      const quota = await enforceActorQuota(supabase, userId, "hero-image-upload", { limit: 30, windowMs: 60 * 60 * 1000 });
      if (!quota.ok) return jsonErr("upload rate limit exceeded", corsHeaders, 429);
      const image = validateImageUpload(body?.fileBase64);
      if (!image) return jsonErr("a valid JPEG, PNG, or WebP image up to 10 MB is required", corsHeaders);
      const { bytes, contentType, extension: ext, width, height } = image;
      const aspect = (() => {
        const ratio = width / Math.max(height, 1);
        const closest = Object.entries(ASPECT_TO_SIZE).reduce(
          (best, [k, v]) => {
            const d = Math.abs(v.w / v.h - ratio);
            return d < best.d ? { k, d } : best;
          },
          { k: "3:2", d: Infinity },
        );
        return closest.k;
      })();
      const label = String(body?.prompt || "Uploaded image").slice(0, 240);
      const sourceReportId = body?.sourceReportId ? String(body.sourceReportId) : null;

      const id = crypto.randomUUID();
      const path = `${STORAGE_PREFIX}/${userId || "anon"}/${id}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, {
        contentType,
        upsert: true,
        cacheControl: "31536000",
      });
      if (upErr) return jsonErr(upErr.message, corsHeaders, 500);
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const { data: inserted, error: insErr } = await supabase
        .from("hero_image_library")
        .insert({
          id,
          owner_user_id: userId,
          source_report_id: sourceReportId,
          prompt: label,
          enhanced_prompt: null,
          model: "upload/raw",
          aspect_ratio: aspect,
          width,
          height,
          status: "ready",
          storage_path: path,
          public_url: pub.publicUrl,
          thumbnail_url: pub.publicUrl,
        })
        .select()
        .single();
      if (insErr) return jsonErr(insErr.message, corsHeaders, 500);
      return jsonOk({ image: (await withSignedHeroUrls(supabase, [inserted]))[0] }, corsHeaders);
    }

    // ── chapters_list ────────────────────────────────────────────────────
    if (action === "chapters_list") {
      const reportId = String(body?.reportId || "");
      if (!reportId) return jsonErr("reportId required", corsHeaders);
      if (!await canAccessReport(supabase, actor, reportId, "can_view")) {
        return createForbiddenResponse("Report view permission required", corsHeaders);
      }
      const { data: report } = await supabase
        .from("investment_reports")
        .select("id, property_address, report_content")
        .eq("id", reportId)
        .maybeSingle();
      if (!report) return jsonErr("report not found", corsHeaders, 404);
      const titles = extractChapterTitles(String(report.report_content || ""));
      const chapters = titles.map((t, idx) => ({
        section_key: slugify(t) || `section-${idx + 1}`,
        section_title: t,
        order: idx,
      }));
      return jsonOk({ chapters }, corsHeaders);
    }

    // ── placements_list ──────────────────────────────────────────────────
    if (action === "placements_list") {
      const reportId = String(body?.reportId || "");
      if (!reportId) return jsonErr("reportId required", corsHeaders);
      if (!await canAccessReport(supabase, actor, reportId, "can_view")) {
        return createForbiddenResponse("Report view permission required", corsHeaders);
      }
      const { data: placements, error } = await supabase
        .from("report_hero_placements")
        .select(`
          id, report_id, section_key, section_title, library_image_id,
          render_height, render_width, object_fit, focal, rounded, position_order, updated_at,
          library:hero_image_library!report_hero_placements_library_image_id_fkey (
            id, prompt, enhanced_prompt, model, aspect_ratio, width, height, storage_path, public_url, thumbnail_url
          )
        `)
        .eq("report_id", reportId)
        .order("position_order", { ascending: true });
      if (error) return jsonErr(error.message, corsHeaders, 500);
      const libs = (placements || []).map((p: any) => p.library).filter(Boolean);
      await withSignedHeroUrls(supabase, libs); // signs public_url/thumbnail_url in place
      return jsonOk({ placements: placements || [] }, corsHeaders);
    }

    // ── placement_set ────────────────────────────────────────────────────
    if (action === "placement_set") {
      const reportId = String(body?.reportId || "");
      const sectionKey = String(body?.sectionKey || "");
      const sectionTitle = String(body?.sectionTitle || sectionKey);
      const libraryImageId = String(body?.libraryImageId || "");
      if (!reportId || !sectionKey || !libraryImageId)
        return jsonErr("reportId, sectionKey, libraryImageId required", corsHeaders);
      if (!await canAccessReport(supabase, actor, reportId, "can_edit")) {
        return createForbiddenResponse("Report edit permission required", corsHeaders);
      }
      const { data: libraryImage } = await supabase
        .from("hero_image_library")
        .select("id")
        .eq("id", libraryImageId)
        .eq("owner_user_id", userId)
        .maybeSingle();
      if (!libraryImage) return createForbiddenResponse("Library image ownership required", corsHeaders);

      const row: any = {
        report_id: reportId,
        section_key: sectionKey,
        section_title: sectionTitle,
        library_image_id: libraryImageId,
      };
      if (body?.renderHeight) row.render_height = String(body.renderHeight);
      if (body?.renderWidth) row.render_width = String(body.renderWidth);
      if (body?.objectFit) row.object_fit = String(body.objectFit);
      if (body?.focal) row.focal = String(body.focal);
      if (typeof body?.rounded === "boolean") row.rounded = body.rounded;
      if (typeof body?.positionOrder === "number") row.position_order = body.positionOrder;

      const { data, error } = await supabase
        .from("report_hero_placements")
        .upsert(row, { onConflict: "report_id,section_key" })
        .select()
        .single();
      if (error) return jsonErr(error.message, corsHeaders, 500);
      return jsonOk({ placement: data }, corsHeaders);
    }

    if (action === "placement_clear") {
      const reportId = String(body?.reportId || "");
      const sectionKey = String(body?.sectionKey || "");
      if (!reportId || !sectionKey) return jsonErr("reportId, sectionKey required", corsHeaders);
      if (!await canAccessReport(supabase, actor, reportId, "can_edit")) {
        return createForbiddenResponse("Report edit permission required", corsHeaders);
      }
      const { error } = await supabase
        .from("report_hero_placements")
        .delete()
        .eq("report_id", reportId)
        .eq("section_key", sectionKey);
      if (error) return jsonErr(error.message, corsHeaders, 500);
      return jsonOk({ cleared: true }, corsHeaders);
    }

    return jsonErr("unknown action", corsHeaders);
  } catch (err: any) {
    console.error("[hero-image-studio]", err);
    return new Response(JSON.stringify(internalError(err, 'hero-image-studio')), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function extractChapterTitles(markdown: string): string[] {
  const titles: string[] = [];
  const seen = new Set<string>();
  // Promote H1 to H2 then capture H2s — matches renderer cleanup.
  const cleaned = markdown.replace(/^\s*#\s+/gm, "## ").replace(/\n{3,}/g, "\n\n");
  const re = /^##\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    const title = m[1].replace(/[*_`#]/g, "").trim();
    if (!title || title.length < 4) continue;
    if (/^(sources?|references?|appendix|disclaimer|notes?|glossary)\b/i.test(title)) continue;
    const key = slugify(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length >= 30) break;
  }
  return titles;
}
