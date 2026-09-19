import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { createCorsHeaders, verifyAuth } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REPORT_BUCKET =
  Deno.env.get("QUANTITATIVE_REPORT_BUCKET") || "quantitative-reports";
const REPORT_VERSION = 1;

type Listing = {
  id?: string;
  recordId?: string;
  price?: number | string | null;
  suburb?: string | null;
  propertyType?: string | null;
  beds?: number | string | null;
  bedrooms?: number | string | null;
  baths?: number | string | null;
  receivedAt?: string | null;
  createdAt?: string | null;
  createdTime?: string | null;
  confidence?: number | string | null;
  agencyName?: string | null;
};
type Stage =
  | "request_received"
  | "request_validated"
  | "user_authenticated"
  | "workspace_resolved"
  | "quantitative_data_loaded"
  | "chart_data_loaded"
  | "content_normalised"
  | "pdf_render_started"
  | "pdf_render_completed"
  | "storage_upload_started"
  | "storage_upload_completed"
  | "report_record_saved"
  | "chart_links_saved"
  | "response_returned";
type ErrorCode =
  | "AUTH_REQUIRED"
  | "WORKSPACE_NOT_FOUND"
  | "INVALID_REPORT_CONFIGURATION"
  | "NO_REPORT_CONTENT_SELECTED"
  | "DATA_RETRIEVAL_FAILED"
  | "CHART_DATA_INVALID"
  | "PDF_RENDER_FAILED"
  | "PDF_EMPTY"
  | "STORAGE_UPLOAD_FAILED"
  | "REPORT_SAVE_FAILED"
  | "CHART_LINK_FAILED"
  | "UNKNOWN_GENERATION_ERROR";
const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const safe = (s: any, max = 4000) =>
  String(s ?? "")
    .replace(/[<>]/g, "")
    .slice(0, max);
const num = (v: any) => {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const runId = () => crypto.randomUUID();
const shortReference = (id: string) => id.replace(/-/g, "").slice(0, 8);
const pdfText = (s: any, max = 3000) =>
  safe(s, max)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '\"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
const isValidPdf = (bytes: Uint8Array) =>
  bytes.byteLength > 4 &&
  String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]) === "%PDF-";
const logStage = (
  generationRunId: string,
  stage: Stage,
  meta: Record<string, unknown> = {},
) =>
  console.log(
    JSON.stringify({
      component: "quantitative-report-pipeline",
      generationRunId,
      stage,
      ...meta,
    }),
  );
class GenerationError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public stage: Stage,
    public status = 500,
    public reportId?: string,
  ) {
    super(message);
  }
}
const weekPeriod = (d = new Date()) => {
  const x = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() - day + 1);
  const start = x.toISOString().slice(0, 10);
  const e = new Date(x);
  e.setUTCDate(e.getUTCDate() + 6);
  return { start, end: e.toISOString().slice(0, 10) };
};
async function fetchListings() {
  let records: Listing[] = [],
    offset = "",
    pages = 0;
  do {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/airtable-proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        pageSize: 100,
        offset,
        sortField: "Created",
        sortDirection: "desc",
      }),
    });
    if (!r.ok) throw new Error("listing_snapshot_failed");
    const j = await r.json();
    records.push(...(j.records || []));
    offset = j.offset || "";
    pages++;
  } while (offset && pages < 50);
  return records;
}
function hash(input: unknown) {
  const txt = JSON.stringify(input);
  let h = 2166136261;
  for (let i = 0; i < txt.length; i++) {
    h ^= txt.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
function chart(
  key: string,
  title: string,
  type: string,
  data: any[],
  analysis: string,
  order: number,
  extra = {},
) {
  return {
    key,
    title,
    type,
    data,
    analysis,
    order,
    config: { type, data, title, ...extra },
  };
}
function build(listings: Listing[]) {
  const prices = listings
    .map((l) => num(l.price))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const avg = prices.length
    ? prices.reduce((a, b) => a + b, 0) / prices.length
    : 0;
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
  const by = (fn: (l: Listing) => string) =>
    Object.entries(
      listings.reduce(
        (a, l) => {
          const k = fn(l) || "Unknown";
          a[k] = (a[k] || 0) + 1;
          return a;
        },
        {} as Record<string, number>,
      ),
    ).sort((a, b) => b[1] - a[1]);
  const suburbs = by((l) => l.suburb || "Unknown Suburb")
    .slice(0, 10)
    .map(([label, value]) => ({ label, value }));
  const types = by((l) => l.propertyType || "Unknown").map(
    ([label, value]) => ({
      label,
      value,
      percentage: listings.length
        ? +((value / listings.length) * 100).toFixed(1)
        : 0,
    }),
  );
  const ranges = [
    ["Under $300k", 0, 300000],
    ["$300k-$500k", 300000, 500000],
    ["$500k-$750k", 500000, 750000],
    ["$750k-$1M", 750000, 1000000],
    ["$1M-$1.5M", 1000000, 1500000],
    ["Over $1.5M", 1500000, Infinity],
  ]
    .map(([label, min, max]) => ({
      label,
      value: prices.filter((p) => p >= Number(min) && p < Number(max)).length,
    }))
    .filter((x) => x.value > 0);
  const dailyMap: Record<string, number> = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    dailyMap[d.toISOString().slice(0, 10)] = 0;
  }
  listings.forEach((l) => {
    const d = new Date(
      String(l.receivedAt || l.createdAt || l.createdTime || ""),
    );
    const k = Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
    if (k in dailyMap) dailyMap[k]++;
  });
  const daily = Object.entries(dailyMap).map(([label, value]) => ({
    label,
    value,
  }));
  const topSuburb = suburbs[0];
  const topType = types[0];
  const beds = by((l) => {
    const b = num(l.beds ?? l.bedrooms);
    return b > 5 ? "5+" : b > 0 ? String(b) : "Unknown";
  }).map(([label, value]) => ({ label, value }));
  const confidenceDaily = daily.map((d) => ({
    label: d.label,
    value: listings.length
      ? Math.round(
          listings.reduce((a, l) => a + num(l.confidence), 0) /
            listings.length || 0,
        )
      : 0,
  }));
  const suburbMatrix = suburbs.map((s) => ({
    label: s.label,
    value: s.value,
    averagePrice: Math.round(avg),
  }));
  const priceVsVolume = suburbs.map((s) => ({
    label: s.label,
    value: s.value,
    price: Math.round(avg),
  }));
  const agents = by((l) => l.agencyName || "Unknown Agency")
    .slice(0, 10)
    .map(([label, value]) => ({ label, value }));
  const agencySizes = [
    ["1 listing", 1, 1],
    ["2-5 listings", 2, 5],
    ["6-10 listings", 6, 10],
    ["10+ listings", 11, Infinity],
  ]
    .map(([label, min, max]) => ({
      label,
      value: agents.filter(
        (a) => a.value >= Number(min) && a.value <= Number(max),
      ).length,
    }))
    .filter((x) => x.value > 0);
  const charts = [
    chart(
      "suburb_volume",
      "Suburb Volume Distribution",
      "bar",
      suburbs,
      topSuburb
        ? `Key finding: ${topSuburb.label} has the highest listing concentration with ${topSuburb.value} listings. Supporting figures: the chart covers ${suburbs.length} suburbs from ${listings.length} source listings.`
        : "Insufficient data: no suburb records were found for this chart.",
      1,
      {
        layout: suburbs.some((s) => s.label.length > 14)
          ? "horizontal"
          : "vertical",
      },
    ),
    chart(
      "property_type",
      "Property Type Distribution",
      "pie",
      types,
      topType
        ? `Key finding: ${topType.label} is the leading property type with ${topType.value} listings (${topType.percentage}%). Supporting figures: ${types.length} property categories are represented.`
        : "Insufficient data: no property type records were found for this chart.",
      2,
    ),
    chart(
      "price_range",
      "Price Range Distribution",
      "bar",
      ranges,
      ranges[0]
        ? `Key finding: ${ranges[0].label} is represented with ${ranges[0].value} listings. Supporting figures: ${prices.length} listings had valid prices; median price is ${money(median)}.`
        : "Insufficient data: no valid price records were found for this chart.",
      3,
    ),
    chart(
      "bedroom_count",
      "Bedroom Distribution",
      "bar",
      beds,
      beds.length
        ? `Key finding: bedroom data is available across ${beds.length} bedroom groupings.`
        : "Insufficient data: no bedroom records were found for this chart.",
      4,
    ),
    chart(
      "daily_listing_activity",
      "Daily Listing Activity",
      "line",
      daily,
      `Key finding: ${daily.reduce((a, b) => a + b.value, 0)} dated listings were received over the last 30 days.`,
      5,
    ),
    chart(
      "pricing_trends",
      "Pricing Trends",
      "line",
      daily,
      `Key finding: average price is ${money(avg)} and median price is ${money(median)} across ${prices.length} valid priced listings.`,
      6,
    ),
    chart(
      "data_confidence",
      "Data Confidence Trends",
      "line",
      confidenceDaily,
      "Key finding: confidence trend uses available confidence values from the listing snapshot.",
      7,
    ),
    chart(
      "suburb_performance_matrix",
      "Suburb Performance Matrix",
      "bar",
      suburbMatrix,
      `Key finding: the matrix compares the top ${suburbMatrix.length} suburbs by listing volume.`,
      8,
    ),
    chart(
      "suburb_volume_distribution",
      "Suburb Volume Distribution",
      "bar",
      suburbs,
      topSuburb
        ? `Key finding: ${topSuburb.label} leads suburb volume.`
        : "Insufficient data: no suburb volume records were found.",
      9,
    ),
    chart(
      "price_vs_volume",
      "Price vs Volume Analysis",
      "scatter",
      priceVsVolume,
      `Key finding: price versus volume analysis covers ${priceVsVolume.length} suburbs.`,
      10,
    ),
    chart(
      "agent_listing_volume",
      "Agent Listing Volume",
      "bar",
      agents,
      agents.length
        ? `Key finding: ${agents[0].label} has ${agents[0].value} listings in the source snapshot.`
        : "Insufficient data: no agency records were found.",
      11,
    ),
    chart(
      "agency_distribution",
      "Agency Size Distribution",
      "bar",
      agencySizes,
      agencySizes.length
        ? `Key finding: agency size buckets are calculated from ${agents.length} agencies.`
        : "Insufficient data: no agency distribution could be calculated.",
      12,
    ),
  ];
  return {
    metrics: {
      total_listings: listings.length,
      average_price: Math.round(avg),
      median_price: Math.round(median),
      valid_price_count: prices.length,
      unique_suburbs: by((l) => l.suburb || "Unknown").length,
    },
    charts,
  };
}
async function pdfBytes(
  title: string,
  summary: string,
  charts: any[],
  customNotes: string,
  metadata: { companyName?: string | null; authorName?: string | null } = {},
) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const addPage = () => {
    const page = pdf.addPage([595, 842]);
    return { page, y: 790 };
  };
  let { page, y } = addPage();
  const write = (text: string, size = 10, isBold = false) => {
    const words = pdfText(text, 3000).split(/\s+/);
    let line = "";
    for (const w of words) {
      if ((line + " " + w).length > 92) {
        if (y < 60) {
          const n = addPage();
          page = n.page;
          y = n.y;
        }
        page.drawText(line, {
          x: 48,
          y,
          size,
          font: isBold ? bold : font,
          color: rgb(0.08, 0.08, 0.1),
        });
        y -= size + 6;
        line = w;
      } else line = line ? `${line} ${w}` : w;
    }
    if (line) {
      if (y < 60) {
        const n = addPage();
        page = n.page;
        y = n.y;
      }
      page.drawText(line, {
        x: 48,
        y,
        size,
        font: isBold ? bold : font,
        color: rgb(0.08, 0.08, 0.1),
      });
      y -= size + 8;
    }
  };
  write(title, 22, true);
  write(summary, 11);
  if (metadata.companyName || metadata.authorName) {
    const parts = [
      metadata.companyName ? `Company: ${metadata.companyName}` : "",
      metadata.authorName ? `Author: ${metadata.authorName}` : "",
    ].filter(Boolean);
    write(parts.join(" | "), 9);
  }
  if (customNotes) {
    y -= 8;
    write("Additional Notes", 14, true);
    write(customNotes, 10);
  }
  for (const c of charts) {
    y -= 8;
    write(c.title, 14, true);
    write(c.analysis, 10);
    const preview = (c.data || [])
      .slice(0, 8)
      .map((d: any) => `${d.label}: ${d.value}`)
      .join("  -  ");
    write(preview || "Insufficient data available for this chart.", 9);
  }
  return await pdf.save();
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);
  const headerRunId = req.headers.get("x-generation-run-id");
  let generationRunId = headerRunId || runId();
  const started = Date.now();
  let stage: Stage = "request_received";
  let reportId: string | undefined;
  const fail = (code: ErrorCode, message: string, status = 500) =>
    json(
      { success: false, code, message, generationRunId, reference: shortReference(generationRunId), stage, reportId },
      status,
      corsHeaders,
    );
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: any = {};
  try {
    logStage(generationRunId, stage);
    body = await req.json().catch(() => {
      throw new GenerationError(
        "INVALID_REPORT_CONFIGURATION",
        "The report request was not valid JSON.",
        "request_validated",
        400,
      );
    });
    if (!headerRunId && typeof body.generationRunId === "string" && body.generationRunId.trim()) {
      generationRunId = safe(body.generationRunId, 80);
      logStage(generationRunId, "request_received", { reference: shortReference(generationRunId), source: "body" });
    }
    const auth = await verifyAuth(supabase, req.headers, body);
    stage = "user_authenticated";
    if (auth.error)
      return fail(
        "AUTH_REQUIRED",
        "Your session has expired. Please sign in again and retry.",
        401,
      );
    logStage(generationRunId, stage, { authMethod: auth.authMethod });
    const source =
      body.source === "scheduled" || body.operation === "weekly"
        ? "scheduled"
        : body.source || "manual";
    const workspaceId = safe(
      body.workspace_id || body.tenant_id || "default",
      120,
    );
    stage = "workspace_resolved";
    if (!workspaceId)
      return fail(
        "WORKSPACE_NOT_FOUND",
        "The workspace context could not be resolved.",
        400,
      );
    logStage(generationRunId, stage, { workspaceId });
    const period =
      body.period_start && body.period_end
        ? { start: safe(body.period_start, 10), end: safe(body.period_end, 10) }
        : weekPeriod();
    const validKeys = new Set([
      "suburb_volume",
      "property_type",
      "price_range",
      "bedroom_count",
      "daily_listing_activity",
      "pricing_trends",
      "data_confidence",
      "suburb_performance_matrix",
      "suburb_volume_distribution",
      "price_vs_volume",
      "agent_listing_volume",
      "agency_distribution",
    ]);
    const selectedChartKeys = Array.isArray(body.selectedChartKeys)
      ? body.selectedChartKeys
          .map((k: any) => safe(k, 80))
          .filter((k: string) => validKeys.has(k))
      : [];
    const selectedSections = Array.isArray(body.selectedSections)
      ? body.selectedSections.map((k: any) => safe(k, 80)).filter(Boolean)
      : [];
    if (!selectedChartKeys.length && !selectedSections.length)
      return fail(
        "NO_REPORT_CONTENT_SELECTED",
        "Select at least one report section or chart.",
        400,
      );
    stage = "request_validated";
    logStage(generationRunId, stage, {
      selectedChartCount: selectedChartKeys.length,
      selectedSectionCount: selectedSections.length,
    });
    stage = "quantitative_data_loaded";
    const listings: Listing[] =
      Array.isArray(body.listings) && body.listings.length
        ? body.listings
        : await fetchListings();
    logStage(generationRunId, stage, { listingCount: listings.length });
    const snapshotIds = listings
      .map((l) => l.id || l.recordId)
      .filter(Boolean)
      .sort();
    const built = build(listings);
    stage = "chart_data_loaded";
    const selectedCharts = selectedChartKeys.length
      ? built.charts.filter((c: any) => selectedChartKeys.includes(c.key))
      : [];
    if (!selectedCharts.length && selectedChartKeys.length)
      return fail(
        "CHART_DATA_INVALID",
        "The selected charts are not available for this report.",
        400,
      );
    logStage(generationRunId, stage, { chartCount: selectedCharts.length });
    stage = "content_normalised";
    const generatedAt = new Date().toISOString();
    const title = safe(body.title || "Property Listings Report", 180);
    const description = safe(
      body.description || "Quantitative analysis of property listings",
      1000,
    );
    const customNotes = safe(
      body.customNotes ?? body.config?.customNotes ?? "",
      4000,
    );
    const summary = `Generated from ${listings.length.toLocaleString()} source listings for ${period.start} to ${period.end}.`;
    const configHash = hash({
      workspaceId,
      period,
      selectedSections,
      selectedChartKeys,
      customNotes,
      version: REPORT_VERSION,
    });
    const generatedByUser = auth.userId && auth.authMethod !== "service_role" ? auth.userId : null;
    // A manual run is idempotent only for its own generation run ID. The prior
    // configuration-hash lookup reused an older completed report whenever a user
    // intentionally generated the same configuration, overwriting its history.
    const existing = await supabase
      .from("generated_reports")
      .select("id,status,pdf_path,generated_at")
      .eq("report_type", "quantitative")
      .eq("workspace_id", workspaceId)
      .eq("source_snapshot->>generation_run_id", generationRunId)
      .maybeSingle();
    if (existing.error)
      throw new GenerationError(
        "REPORT_SAVE_FAILED",
        "The report record could not be checked for retry safety.",
        "report_record_saved",
        500,
      );
    if (existing.data?.status === "completed") {
      stage = "response_returned";
      logStage(generationRunId, stage, {
        reportId: existing.data.id,
        reused: true,
        durationMs: Date.now() - started,
      });
      return json(
        {
          success: true,
          reportId: existing.data.id,
          reportTitle: title,
          reportType: "quantitative",
          status: "completed",
          generatedAt: existing.data.generated_at || generatedAt,
          storageAvailable: Boolean(existing.data.pdf_path),
          chartCount: 0,
          reused: true,
          generationRunId,
          reference: shortReference(generationRunId),
        },
        200,
        corsHeaders,
      );
    }
    const base = {
      title,
      description,
      config: {
        ...(body.config || {}),
        selectedSections,
        selectedChartKeys,
        customNotes,
        period,
        workspace_id: workspaceId,
      },
      kpis: built.metrics,
      analytics: { ...built.metrics, summary },
      insights: [],
      chart_urls: {},
      listing_count: listings.length,
      generated_by: generatedByUser,
      report_type: "quantitative",
      generation_source: source,
      status: "generating",
      workspace_id: workspaceId,
      period_start: period.start,
      period_end: period.end,
      version: REPORT_VERSION,
      source_record_count: listings.length,
      source_snapshot: {
        ids: snapshotIds,
        filters: body.filters || {},
        config_hash: configHash,
        generation_run_id: generationRunId,
        requested_by_user_id: auth.userId,
        requested_by_username: auth.username,
        requested_by_auth_method: auth.authMethod,
        fingerprint: hash({ period, snapshotIds, metrics: built.metrics }),
      },
      generated_at: generatedAt,
      error_details: null,
    };
    const saved = existing.data
      ? await supabase
          .from("generated_reports")
          .update(base)
          .eq("id", existing.data.id)
          .select("id")
          .single()
      : await supabase
          .from("generated_reports")
          .insert(base)
          .select("id")
          .single();
    if (saved.error) {
      console.error(
        JSON.stringify({
          component: "quantitative-report-pipeline",
          generationRunId,
          stage: "report_record_saved",
          code: "generated_reports_upsert_failed",
          message: saved.error.message,
          details: saved.error.details,
          hint: saved.error.hint,
        }),
      );
      throw new GenerationError(
        "REPORT_SAVE_FAILED",
        "The report record could not be saved.",
        "report_record_saved",
        500,
      );
    }
    reportId = saved.data.id;
    stage = "report_record_saved";
    logStage(generationRunId, stage, { reportId });
    stage = "pdf_render_started";
    logStage(generationRunId, stage, { reportId });
    let bytes: Uint8Array;
    try {
      const companyName = safe(body.companyName ?? body.config?.companyName ?? "", 180).trim() || null;
      const authorName = safe(body.authorName ?? body.config?.authorName ?? "", 180).trim() || null;
      bytes = await pdfBytes(title, summary, selectedCharts, customNotes, { companyName, authorName });
    } catch (_pdfError) {
      throw new GenerationError(
        "PDF_RENDER_FAILED",
        "The report content was prepared, but the PDF could not be rendered. Please retry.",
        "pdf_render_started",
        500,
        reportId,
      );
    }
    stage = "pdf_render_completed";
    if (!bytes?.byteLength)
      throw new GenerationError(
        "PDF_EMPTY",
        "The PDF was rendered without content.",
        "pdf_render_completed",
        500,
        reportId,
      );
    if (!isValidPdf(bytes))
      throw new GenerationError(
        "PDF_EMPTY",
        "The PDF renderer returned invalid PDF bytes.",
        "pdf_render_completed",
        500,
        reportId,
      );
    logStage(generationRunId, stage, { reportId, fileSize: bytes.byteLength, reference: shortReference(generationRunId) });
    const year = period.start.slice(0, 4);
    const path = `${workspaceId}/quantitative/${year}/${reportId}/quantitative-report.pdf`;
    stage = "storage_upload_started";
    logStage(generationRunId, stage, { reportId, bucket: REPORT_BUCKET });
    const up = await supabase.storage
      .from(REPORT_BUCKET)
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (up.error)
      throw new GenerationError(
        "STORAGE_UPLOAD_FAILED",
        "The PDF was created but could not be saved. Please retry.",
        "storage_upload_started",
        500,
        reportId,
      );
    stage = "storage_upload_completed";
    logStage(generationRunId, stage, { reportId, path });
    const chartRows = selectedCharts.map((c: any) => ({
      report_id: reportId,
      chart_type: c.type,
      title: c.title,
      image_data: "",
      chart_key: c.key,
      chart_config: c.config,
      dataset: c.data,
      analysis_text: c.analysis,
      summary_text: c.analysis.split(".")[0] + ".",
      sort_order: c.order,
      report_date: period.end,
      generated_at: generatedAt,
    }));
    await supabase.from("charts").delete().eq("report_id", reportId);
    const inserted = chartRows.length
      ? await supabase
          .from("charts")
          .insert(chartRows)
          .select("id,analysis_text")
      : { data: [], error: null };
    if (inserted.error)
      throw new GenerationError(
        "CHART_LINK_FAILED",
        "The report was generated but charts could not be linked.",
        "chart_links_saved",
        500,
        reportId,
      );
    const analysisRows = (inserted.data || []).map((c: any) => ({
      chart_id: c.id,
      analysis_text: c.analysis_text,
      analysis_type: "quantitative",
      confidence_score: 0.9,
    }));
    if (analysisRows.length) {
      const ca = await supabase.from("chart_analysis").insert(analysisRows);
      if (ca.error)
        console.warn(
          JSON.stringify({
            component: "quantitative-report-pipeline",
            generationRunId,
            stage: "chart_links_saved",
            warning: "chart_analysis_insert_failed",
            reportId,
          }),
        );
    }
    stage = "chart_links_saved";
    logStage(generationRunId, stage, {
      reportId,
      chartCount: chartRows.length,
    });
    const done = await supabase
      .from("generated_reports")
      .update({
        status: "completed",
        chart_urls: { stored_chart_count: chartRows.length },
        pdf_bucket: REPORT_BUCKET,
        pdf_path: path,
        file_name: "quantitative-report.pdf",
        file_size: bytes.byteLength,
        generated_at: generatedAt,
        error_details: null,
      })
      .eq("id", reportId);
    if (done.error)
      throw new GenerationError(
        "REPORT_SAVE_FAILED",
        "The completed report record could not be updated.",
        "report_record_saved",
        500,
        reportId,
      );
    stage = "response_returned";
    logStage(generationRunId, stage, {
      reportId,
      durationMs: Date.now() - started,
    });
    return json(
      {
        success: true,
        reportId,
        reportTitle: title,
        reportType: "quantitative",
        status: "completed",
        generatedAt,
        storageAvailable: true,
        chartCount: chartRows.length,
        generationRunId,
        reference: shortReference(generationRunId),
        pdf: {
          bucket: REPORT_BUCKET,
          path,
          fileName: "quantitative-report.pdf",
          fileSize: bytes.byteLength,
        },
      },
      200,
      corsHeaders,
    );
  } catch (e) {
    const ge =
      e instanceof GenerationError
        ? e
        : new GenerationError(
            "UNKNOWN_GENERATION_ERROR",
            "Unable to generate the quantitative report.",
            stage,
            500,
            reportId,
          );
    console.error(
      JSON.stringify({
        component: "quantitative-report-pipeline",
        generationRunId,
        reference: shortReference(generationRunId),
        failedStage: ge.stage,
        code: ge.code,
        safeMessage: ge.message,
        reportId: ge.reportId || reportId,
        durationMs: Date.now() - started,
        originalError: e instanceof Error ? e.message : String(e),
      }),
    );
    if (ge.reportId || reportId)
      await supabase
        .from("generated_reports")
        .update({ status: "failed", error_details: `${ge.code}:${ge.stage}` })
        .eq("id", ge.reportId || reportId);
    stage = ge.stage;
    return fail(ge.code, ge.message, ge.status);
  }
});
