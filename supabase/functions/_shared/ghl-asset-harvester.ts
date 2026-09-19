/**
 * Shared deep-harvest helpers for the GHL marketing-asset dump.
 *
 * - Probes many documented + undocumented LeadConnector endpoints per asset
 * - Renders public widget/page URLs with Firecrawl (max formats)
 * - Downloads referenced images/CSS/fonts and uploads to Storage
 * - Inlines external CSS into a single <style> block to produce a portable HTML
 * - Returns a normalized DumpRow ready to upsert
 */

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v2';
const BUCKET = 'ghl-marketing-dump';

const MAX_ASSET_BYTES = 25 * 1024 * 1024; // skip files >25MB
const MAX_TOTAL_PER_PAGE = 100 * 1024 * 1024;
const ASSET_CONCURRENCY = 5;

export interface EndpointTrace { url: string; status: number; ok: boolean; bytes?: number }

export interface DumpRow {
  resource_type: 'form' | 'survey' | 'quiz' | 'funnel' | 'funnel_page' | 'workflow' | 'location_custom_schema';
  ghl_id: string;
  location_id: string;
  name: string | null;
  parent_ghl_id: string | null;
  raw_payload: any;
  html_content: string | null;
  raw_html_content: string | null;
  markdown_content: string | null;
  css_content: string | null;
  inlined_css: string | null;
  embed_code: string | null;
  screenshot_url: string | null;
  links: any | null;
  metadata: any | null;
  submissions_sample: any | null;
  asset_manifest: any | null;
  asset_count: number;
  asset_bytes: number;
  portable_html_path: string | null;
  reconstruction_notes: string | null;
  enrichment_sources: any;
  full_url: string | null;
  fetch_status: 'ok' | 'partial' | 'error';
  fetch_error: string | null;
  endpoints_tried: EndpointTrace[];
  harvest_job_id: string | null;
}

export async function ghlGet(path: string, headers: Record<string, string>) {
  const url = `${GHL_API_BASE}${path}`;
  try {
    const res = await fetch(url, { method: 'GET', headers });
    const text = await res.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch {}
    return { url, status: res.status, ok: res.ok, body, bytes: text.length };
  } catch (e: any) {
    return { url, status: 0, ok: false, body: { error: e.message }, bytes: 0 };
  }
}

export async function harvest(paths: string[], headers: Record<string, string>) {
  const tried: EndpointTrace[] = [];
  const successes: any[] = [];
  for (const p of paths) {
    const r = await ghlGet(p, headers);
    tried.push({ url: r.url, status: r.status, ok: r.ok, bytes: r.bytes });
    if (r.ok && r.body && typeof r.body === 'object') successes.push(r.body);
  }
  const merged = successes.reduce((acc, b) => ({ ...acc, ...b }), {} as any);
  return { merged, successes, tried };
}

function pickHtmlCss(payload: any) {
  if (!payload || typeof payload !== 'object') return { html: null, css: null, embed: null };
  const html = payload.html ?? payload.htmlContent ?? payload.pageHtml ?? payload.body ?? payload.content
    ?? payload?.page?.html ?? payload?.data?.html ?? payload?.builder?.html ?? null;
  const css = payload.css ?? payload.cssContent ?? payload.styles ?? payload.stylesheet ?? payload.customCss
    ?? payload?.page?.css ?? payload?.data?.css ?? payload?.builder?.css ?? null;
  const embed = payload.embedCode ?? payload.embed_code ?? payload.embed ?? payload.iframeCode
    ?? payload.embedUrl ?? payload.embed_url ?? payload.embedScript ?? null;
  return {
    html: typeof html === 'string' ? html : html ? JSON.stringify(html) : null,
    css: typeof css === 'string' ? css : css ? JSON.stringify(css) : null,
    embed: typeof embed === 'string' ? embed : embed ? JSON.stringify(embed) : null,
  };
}

interface RenderResult {
  html: string | null;
  rawHtml: string | null;
  markdown: string | null;
  screenshot: string | null;
  links: any | null;
  metadata: any | null;
  source: 'firecrawl' | 'fetch' | 'none';
  trace: EndpointTrace;
}

export async function renderLive(url: string, useFirecrawl: boolean): Promise<RenderResult> {
  const fcKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (useFirecrawl && fcKey) {
    try {
      const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${fcKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          formats: ['markdown', 'html', 'rawHtml', 'links', 'screenshot@fullPage'],
          onlyMainContent: false,
          waitFor: 6000,
          timeout: 60000,
          blockAds: false,
          mobile: false,
          skipTlsVerification: false,
        }),
      });
      const text = await res.text();
      let body: any = null;
      try { body = JSON.parse(text); } catch {}
      const trace: EndpointTrace = { url: `firecrawl:${url}`, status: res.status, ok: res.ok, bytes: text.length };
      if (res.ok && body) {
        const d = body.data || body;
        return {
          html: d.html ?? null,
          rawHtml: d.rawHtml ?? d.html ?? null,
          markdown: d.markdown ?? null,
          screenshot: d.screenshot ?? null,
          links: d.links ?? null,
          metadata: d.metadata ?? null,
          source: 'firecrawl',
          trace,
        };
      }
    } catch (e: any) {
      console.warn(`[harvester] firecrawl failed for ${url}: ${e.message}`);
    }
  }
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GHL-Harvester/1.0)' } });
    const t = await r.text();
    return {
      html: r.ok ? t : null,
      rawHtml: r.ok ? t : null,
      markdown: null,
      screenshot: null,
      links: null,
      metadata: null,
      source: r.ok ? 'fetch' : 'none',
      trace: { url: `fetch:${url}`, status: r.status, ok: r.ok, bytes: t.length },
    };
  } catch {
    return {
      html: null, rawHtml: null, markdown: null, screenshot: null, links: null, metadata: null,
      source: 'none', trace: { url: `fetch:${url}`, status: 0, ok: false },
    };
  }
}

/**
 * Use Firecrawl /v2/map to enumerate every public URL on a domain.
 * Lets us discover funnel step URLs the GHL API doesn't surface.
 */
export async function firecrawlMap(domain: string, search?: string): Promise<string[]> {
  const fcKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!fcKey || !domain) return [];
  try {
    const res = await fetch(`${FIRECRAWL_BASE}/map`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fcKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: domain.startsWith('http') ? domain : `https://${domain}`,
        search,
        limit: 500,
        includeSubdomains: false,
      }),
    });
    if (!res.ok) { await res.text(); return []; }
    const body = await res.json().catch(() => null);
    const links: string[] = body?.links || body?.data?.links || [];
    return Array.isArray(links) ? links : [];
  } catch { return []; }
}

/**
 * Persist a Firecrawl screenshot URL into our storage bucket so it
 * doesn't expire. Returns the storage path or null on failure.
 */
export async function persistScreenshot(supabase: any, screenshotUrl: string | null, storagePrefix: string): Promise<string | null> {
  if (!screenshotUrl || !screenshotUrl.startsWith('http')) return null;
  try {
    const r = await fetch(screenshotUrl);
    if (!r.ok) { await r.text(); return null; }
    const buf = new Uint8Array(await r.arrayBuffer());
    const path = `${storagePrefix}/screenshot.png`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, buf, {
      contentType: 'image/png', upsert: true,
    });
    return error ? null : path;
  } catch { return null; }
}

// ── Asset extraction & download ─────────────────────────────────

function extractAssetUrls(html: string, baseUrl: string | null): string[] {
  if (!html) return [];
  const urls = new Set<string>();
  const patterns = [
    /<img[^>]+src=["']([^"']+)["']/gi,
    /<source[^>]+src=["']([^"']+)["']/gi,
    /<video[^>]+src=["']([^"']+)["']/gi,
    /<link[^>]+href=["']([^"']+\.(?:css|woff2?|ttf|otf|eot))["']/gi,
    /<script[^>]+src=["']([^"']+\.js[^"']*)["']/gi,
    /url\(["']?([^"')]+\.(?:png|jpe?g|gif|svg|webp|woff2?|ttf|otf|eot|css))["']?\)/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const u = m[1];
      if (!u || u.startsWith('data:') || u.startsWith('#')) continue;
      try {
        const abs = baseUrl ? new URL(u, baseUrl).toString() : u;
        if (abs.startsWith('http')) urls.add(abs);
      } catch {}
    }
  }
  return Array.from(urls);
}

async function hashUrl(s: string): Promise<string> {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-1', enc);
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function extFromUrl(u: string, ct: string | null): string {
  try {
    const path = new URL(u).pathname;
    const m = path.match(/\.([a-z0-9]{2,5})$/i);
    if (m) return m[1].toLowerCase();
  } catch {}
  if (ct?.includes('png')) return 'png';
  if (ct?.includes('jpeg')) return 'jpg';
  if (ct?.includes('webp')) return 'webp';
  if (ct?.includes('svg')) return 'svg';
  if (ct?.includes('css')) return 'css';
  if (ct?.includes('javascript')) return 'js';
  if (ct?.includes('woff2')) return 'woff2';
  if (ct?.includes('woff')) return 'woff';
  return 'bin';
}

interface DownloadedAsset {
  original_url: string;
  storage_path: string;
  bytes: number;
  content_type: string | null;
  skipped?: 'too_large' | 'fetch_failed' | 'budget';
}

export async function downloadAndStoreAssets(
  supabase: any,
  urls: string[],
  storagePrefix: string, // e.g. forms/<id>/assets
): Promise<{ assets: DownloadedAsset[]; cssTexts: { url: string; text: string }[]; totalBytes: number }> {
  const assets: DownloadedAsset[] = [];
  const cssTexts: { url: string; text: string }[] = [];
  let totalBytes = 0;
  const queue = [...urls];

  async function worker() {
    while (queue.length) {
      const u = queue.shift();
      if (!u) return;
      if (totalBytes > MAX_TOTAL_PER_PAGE) {
        assets.push({ original_url: u, storage_path: '', bytes: 0, content_type: null, skipped: 'budget' });
        continue;
      }
      try {
        const r = await fetch(u, { redirect: 'follow' });
        if (!r.ok) {
          assets.push({ original_url: u, storage_path: '', bytes: 0, content_type: r.headers.get('content-type'), skipped: 'fetch_failed' });
          continue;
        }
        const ct = r.headers.get('content-type');
        const buf = new Uint8Array(await r.arrayBuffer());
        if (buf.byteLength > MAX_ASSET_BYTES) {
          assets.push({ original_url: u, storage_path: '', bytes: buf.byteLength, content_type: ct, skipped: 'too_large' });
          continue;
        }
        const ext = extFromUrl(u, ct);
        const hash = await hashUrl(u);
        const path = `${storagePrefix}/${hash}.${ext}`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, buf, {
          contentType: ct || 'application/octet-stream',
          upsert: true,
        });
        if (error) {
          assets.push({ original_url: u, storage_path: '', bytes: buf.byteLength, content_type: ct, skipped: 'fetch_failed' });
          continue;
        }
        totalBytes += buf.byteLength;
        assets.push({ original_url: u, storage_path: path, bytes: buf.byteLength, content_type: ct });
        if (ext === 'css') {
          try { cssTexts.push({ url: u, text: new TextDecoder().decode(buf) }); } catch {}
        }
      } catch {
        assets.push({ original_url: u, storage_path: '', bytes: 0, content_type: null, skipped: 'fetch_failed' });
      }
    }
  }

  await Promise.all(Array.from({ length: ASSET_CONCURRENCY }, () => worker()));
  return { assets, cssTexts, totalBytes };
}

export async function buildPortableHtml(
  supabase: any,
  rawHtml: string,
  assets: DownloadedAsset[],
  cssTexts: { url: string; text: string }[],
  storagePrefix: string,
): Promise<{ html: string; inlinedCss: string; portablePath: string | null }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  let html = rawHtml;
  // Replace asset URLs with public storage URLs (we'll signed-URL on read; for portability use raw paths in markup that the export step rewrites).
  const map: Record<string, string> = {};
  for (const a of assets) {
    if (!a.storage_path) continue;
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${a.storage_path}`;
    map[a.original_url] = publicUrl;
    html = html.split(a.original_url).join(publicUrl);
  }
  const inlinedCss = cssTexts.map((c) => `/* ${c.url} */\n${c.text}`).join('\n\n');
  const finalHtml = inlinedCss
    ? html.replace(/<\/head>/i, `<style data-inlined-from-external>\n${inlinedCss}\n</style>\n</head>`)
    : html;

  // Upload portable HTML
  const path = `${storagePrefix}/portable.html`;
  const { error } = await supabase.storage.from(BUCKET).upload(
    path,
    new TextEncoder().encode(finalHtml),
    { contentType: 'text/html; charset=utf-8', upsert: true },
  );
  if (error) return { html: finalHtml, inlinedCss, portablePath: null };
  return { html: finalHtml, inlinedCss, portablePath: path };
}

// ── Per-asset processors ─────────────────────────────────────────

export interface AssetTask {
  resource_type: DumpRow['resource_type'];
  ghl_id: string;
  parent_ghl_id?: string | null;
  seed?: any; // initial item from list endpoint
}

export async function processAsset(
  supabase: any,
  task: AssetTask,
  ctx: { headers: Record<string, string>; locationId: string; useFirecrawl: boolean; downloadAssets: boolean; jobId: string | null },
): Promise<DumpRow> {
  const { headers, locationId, useFirecrawl, downloadAssets, jobId } = ctx;
  const id = task.ghl_id;
  const base: Partial<DumpRow> = {
    ghl_id: id, location_id: locationId, parent_ghl_id: task.parent_ghl_id || null,
    harvest_job_id: jobId,
  };

  if (task.resource_type === 'form') {
    const detail = await harvest([
      `/forms/${id}?locationId=${locationId}`,
      `/forms/${id}`,
      `/forms/${id}/fields?locationId=${locationId}`,
      `/forms/builder/${id}?locationId=${locationId}`,
    ], headers);
    const subs = await ghlGet(`/forms/submissions?locationId=${locationId}&formId=${id}&limit=50`, headers);
    const submissions = subs.ok ? (subs.body?.submissions || subs.body?.data || subs.body) : null;
    const merged = { ...(task.seed || {}), ...detail.merged };
    const { html, css, embed } = pickHtmlCss(merged);
    const widgetUrl = `https://api.leadconnectorhq.com/widget/form/${id}`;
    const live = await renderLive(widgetUrl, useFirecrawl);

    let manifest: any = null, inlinedCss: string | null = null, portablePath: string | null = null;
    let assetCount = 0, assetBytes = 0;
    const renderedHtml = live.rawHtml || live.html || html;
    if (downloadAssets && renderedHtml) {
      const urls = extractAssetUrls(renderedHtml, widgetUrl);
      const { assets, cssTexts, totalBytes } = await downloadAndStoreAssets(supabase, urls, `forms/${id}/assets`);
      const portable = await buildPortableHtml(supabase, renderedHtml, assets, cssTexts, `forms/${id}`);
      manifest = assets;
      inlinedCss = portable.inlinedCss;
      portablePath = portable.portablePath;
      assetCount = assets.filter((a) => a.storage_path).length;
      assetBytes = totalBytes;
    }

    return {
      ...(base as any),
      resource_type: 'form',
      name: merged.name || null,
      raw_payload: merged,
      html_content: html || live.html,
      raw_html_content: live.rawHtml,
      markdown_content: live.markdown,
      css_content: css,
      inlined_css: inlinedCss,
      embed_code: embed || `<iframe src="${widgetUrl}" style="width:100%;border:none;" id="form-${id}"></iframe>`,
      screenshot_url: live.screenshot,
      links: live.links,
      metadata: live.metadata,
      submissions_sample: submissions,
      asset_manifest: manifest,
      asset_count: assetCount,
      asset_bytes: assetBytes,
      portable_html_path: portablePath,
      reconstruction_notes: 'Rebuild manually in GHL Sites → Forms. Use rendered HTML + screenshot for layout, raw_payload.fields for field schema, embed_code to install.',
      enrichment_sources: { detail_endpoints_ok: detail.successes.length, submissions_ok: subs.ok, live_render: live.source },
      full_url: widgetUrl,
      fetch_status: (renderedHtml || detail.successes.length) ? 'ok' : 'partial',
      fetch_error: null,
      endpoints_tried: [...detail.tried, { url: subs.url, status: subs.status, ok: subs.ok, bytes: subs.bytes }, live.trace],
    };
  }

  if (task.resource_type === 'survey' || task.resource_type === 'quiz') {
    const detail = await harvest([
      `/surveys/${id}?locationId=${locationId}`,
      `/surveys/${id}`,
      `/surveys/${id}/questions?locationId=${locationId}`,
    ], headers);
    const subs = await ghlGet(`/surveys/submissions?locationId=${locationId}&surveyId=${id}&limit=50`, headers);
    const submissions = subs.ok ? (subs.body?.submissions || subs.body?.data || subs.body) : null;
    const merged = { ...(task.seed || {}), ...detail.merged };
    const { html, css, embed } = pickHtmlCss(merged);
    const widgetUrl = `https://api.leadconnectorhq.com/widget/survey/${id}`;
    const live = await renderLive(widgetUrl, useFirecrawl);

    let manifest: any = null, inlinedCss: string | null = null, portablePath: string | null = null;
    let assetCount = 0, assetBytes = 0;
    const renderedHtml = live.rawHtml || live.html || html;
    if (downloadAssets && renderedHtml) {
      const urls = extractAssetUrls(renderedHtml, widgetUrl);
      const r = await downloadAndStoreAssets(supabase, urls, `${task.resource_type}/${id}/assets`);
      const portable = await buildPortableHtml(supabase, renderedHtml, r.assets, r.cssTexts, `${task.resource_type}/${id}`);
      manifest = r.assets;
      inlinedCss = portable.inlinedCss;
      portablePath = portable.portablePath;
      assetCount = r.assets.filter((a) => a.storage_path).length;
      assetBytes = r.totalBytes;
    }

    return {
      ...(base as any),
      resource_type: task.resource_type,
      name: merged.name || null,
      raw_payload: merged,
      html_content: html || live.html,
      raw_html_content: live.rawHtml,
      markdown_content: live.markdown,
      css_content: css,
      inlined_css: inlinedCss,
      embed_code: embed,
      screenshot_url: live.screenshot,
      links: live.links,
      metadata: live.metadata,
      submissions_sample: submissions,
      asset_manifest: manifest,
      asset_count: assetCount,
      asset_bytes: assetBytes,
      portable_html_path: portablePath,
      reconstruction_notes: 'Rebuild in GHL Sites → Surveys/Quizzes. Use raw_payload.questions for question schema and branching/scoring rules.',
      enrichment_sources: { detail_endpoints_ok: detail.successes.length, submissions_ok: subs.ok, live_render: live.source },
      full_url: widgetUrl,
      fetch_status: (renderedHtml || detail.successes.length) ? 'ok' : 'partial',
      fetch_error: null,
      endpoints_tried: [...detail.tried, { url: subs.url, status: subs.status, ok: subs.ok, bytes: subs.bytes }, live.trace],
    };
  }

  if (task.resource_type === 'funnel') {
    const detail = await harvest([
      `/funnels/funnel/${id}?locationId=${locationId}`,
      `/funnels/${id}`,
      `/funnels/funnel/${id}/redirect/list?locationId=${locationId}`,
    ], headers);
    const merged = { ...(task.seed || {}), ...detail.merged };
    return {
      ...(base as any),
      resource_type: 'funnel',
      name: merged.name || null,
      raw_payload: merged,
      html_content: null, raw_html_content: null, markdown_content: null,
      css_content: merged.customCss || null, inlined_css: null,
      embed_code: null, screenshot_url: null, links: null, metadata: null,
      submissions_sample: null, asset_manifest: null, asset_count: 0, asset_bytes: 0,
      portable_html_path: null,
      reconstruction_notes: 'Funnel container — recreate in GHL Sites → Funnels with this name and domain, then rebuild each page (see funnel_page rows where parent_ghl_id matches).',
      enrichment_sources: { detail_endpoints_ok: detail.successes.length },
      full_url: merged._publishedDomain ? `https://${merged._publishedDomain.replace(/^https?:\/\//,'').replace(/\/+$/,'')}${merged.url || ''}` : null,
      fetch_status: detail.successes.length ? 'ok' : 'partial',
      fetch_error: null,
      endpoints_tried: detail.tried,
    };
  }

  if (task.resource_type === 'funnel_page') {
    const seed = task.seed || {};
    const isSyntheticSitePage = id.startsWith('site:');
    const detail = isSyntheticSitePage
      ? { merged: {}, successes: [], tried: [] as EndpointTrace[] }
      : await harvest([
        `/funnels/page/${id}?locationId=${locationId}`,
        `/funnels/page/${id}`,
        `/funnels/funnel/${task.parent_ghl_id}/page/${id}?locationId=${locationId}`,
        `/funnels/page/${id}/builder?locationId=${locationId}`,
        `/funnels/lookup/redirect?locationId=${locationId}&id=${id}`,
      ], headers);
    const merged = { ...seed, ...detail.merged };
    const { html, css, embed } = pickHtmlCss(merged);
    const cleanJoin = (...parts: string[]) =>
      '/' + parts.map((p) => (p || '').replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
    const pageUrl: string | null = merged.fullUrl || seed.fullUrl
      || (seed.parentDomain
        ? `https://${seed.parentDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}${cleanJoin(seed.parentSlug || '', seed.parentStepUrl || '')}`
        : null);

    let live: RenderResult = { html: null, rawHtml: null, markdown: null, screenshot: null, links: null, metadata: null, source: 'none', trace: { url: 'no_url', status: 0, ok: false } };
    if (pageUrl) live = await renderLive(pageUrl, useFirecrawl);

    let manifest: any = null, inlinedCss: string | null = null, portablePath: string | null = null;
    let assetCount = 0, assetBytes = 0;
    let screenshotPath: string | null = null;
    const renderedHtml = live.rawHtml || live.html || html;
    const safeStorageId = id.replace(/[^a-z0-9_-]+/gi, '_');
    if (downloadAssets && renderedHtml && pageUrl) {
      const urls = extractAssetUrls(renderedHtml, pageUrl);
      const r = await downloadAndStoreAssets(supabase, urls, `funnel_pages/${safeStorageId}/assets`);
      const portable = await buildPortableHtml(supabase, renderedHtml, r.assets, r.cssTexts, `funnel_pages/${safeStorageId}`);
      manifest = r.assets;
      inlinedCss = portable.inlinedCss;
      portablePath = portable.portablePath;
      assetCount = r.assets.filter((a) => a.storage_path).length;
      assetBytes = r.totalBytes;
    }
    if (live.screenshot) {
      screenshotPath = await persistScreenshot(supabase, live.screenshot, `funnel_pages/${safeStorageId}`);
    }

    return {
      ...(base as any),
      resource_type: 'funnel_page',
      name: merged.name || merged.stepName || null,
      raw_payload: merged,
      html_content: html || live.html,
      raw_html_content: live.rawHtml,
      markdown_content: live.markdown,
      css_content: css,
      inlined_css: inlinedCss,
      embed_code: embed,
      screenshot_url: screenshotPath
        ? `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/${BUCKET}/${screenshotPath}`
        : live.screenshot,
      links: live.links,
      metadata: live.metadata,
      submissions_sample: null,
      asset_manifest: manifest,
      asset_count: assetCount,
      asset_bytes: assetBytes,
      portable_html_path: portablePath,
      reconstruction_notes: isSyntheticSitePage
        ? 'Discovered via Firecrawl /map (not surfaced by GHL funnel API). Use rendered HTML + screenshot to identify which funnel/step it belongs to.'
        : 'GHL funnel-builder JSON is API-locked. Use the screenshot + portable HTML + asset manifest to rebuild this page section-by-section in the GHL Funnels editor.',
      enrichment_sources: { detail_endpoints_ok: detail.successes.length, live_render: live.source, discovered_via: seed._discoveredVia || 'ghl_api' },
      full_url: pageUrl,
      fetch_status: (renderedHtml || detail.successes.length) ? 'ok' : 'partial',
      fetch_error: pageUrl ? null : 'No public URL available; live render skipped',
      endpoints_tried: [...detail.tried, ...(pageUrl ? [live.trace] : [])],
    };
  }

  if (task.resource_type === 'workflow') {
    const detail = await harvest([
      `/workflows/${id}?locationId=${locationId}`,
      `/workflows/${id}`,
      `/workflows/${id}/versions?locationId=${locationId}`,
      `/workflows/${id}/triggers?locationId=${locationId}`,
      `/workflows/${id}/actions?locationId=${locationId}`,
      `/workflows/${id}/steps?locationId=${locationId}`,
      `/workflows/${id}/enrollments?locationId=${locationId}&limit=25`,
      `/workflows/${id}/stats?locationId=${locationId}`,
    ], headers);
    const merged = { ...(task.seed || {}), ...detail.merged };
    const triggers = merged.triggers || merged.trigger || [];
    const actions = merged.actions || merged.steps || [];
    const triggerSummary = Array.isArray(triggers) && triggers.length
      ? triggers.map((t: any) => t.type || t.name || t.event).filter(Boolean).join(', ')
      : (typeof triggers === 'string' ? triggers : null);
    const stepCount = Array.isArray(actions) ? actions.length : (typeof actions === 'number' ? actions : null);

    // Upsert into snapshot bridge table
    try {
      await supabase.from('ghl_workflow_snapshot_bridge').upsert({
        legacy_workflow_id: id,
        legacy_name: merged.name || null,
        trigger_summary: triggerSummary,
        step_count: stepCount,
        raw_metadata: merged,
      }, { onConflict: 'legacy_workflow_id' });
    } catch (e) {
      console.warn('[harvester] bridge upsert failed:', e);
    }

    return {
      ...(base as any),
      resource_type: 'workflow',
      name: merged.name || null,
      raw_payload: merged,
      html_content: null, raw_html_content: null, markdown_content: null,
      css_content: null, inlined_css: null, embed_code: null,
      screenshot_url: null, links: null, metadata: null, submissions_sample: null,
      asset_manifest: null, asset_count: 0, asset_bytes: 0, portable_html_path: null,
      reconstruction_notes: 'WORKFLOW INTERNALS ARE API-LOCKED. Export a GHL Snapshot from the legacy account, import into the new account, then map the new workflow ID in the Snapshot Bridge panel.',
      enrichment_sources: { detail_endpoints_ok: detail.successes.length, note: 'Workflow steps/emails/SMS bodies cannot be retrieved via API.' },
      full_url: null,
      fetch_status: detail.successes.length ? 'ok' : 'partial',
      fetch_error: detail.successes.length ? null : 'Only metadata available',
      endpoints_tried: detail.tried,
    };
  }

  if ((task.resource_type as any) === 'location_custom_schema') {
    const seed = task.seed || {};
    return {
      ...(base as any),
      resource_type: 'location_custom_schema',
      name: 'Location Custom Fields & Values',
      raw_payload: seed,
      html_content: null, raw_html_content: null, markdown_content: null,
      css_content: null, inlined_css: null, embed_code: null,
      screenshot_url: null, links: null, metadata: null, submissions_sample: null,
      asset_manifest: null, asset_count: 0, asset_bytes: 0, portable_html_path: null,
      reconstruction_notes: 'These are the location-wide Custom Fields & Custom Values used by every form/survey/workflow in this account. The per-form field schema is API-locked, so use this list (plus rendered form HTML) to identify which fields each form collects. Recreate identical custom fields in the new GHL location before importing forms.',
      enrichment_sources: { source: 'locations/{id}/customFields + customValues' },
      full_url: null,
      fetch_status: 'ok',
      fetch_error: null,
      endpoints_tried: [],
    };
  }

  throw new Error(`Unknown resource_type: ${task.resource_type}`);
}

// ── Build the work queue (list-only call to GHL) ─────────────────

export async function buildQueue(
  headers: Record<string, string>,
  locationId: string,
  resources: string[],
  opts?: { funnelDomainOverrides?: Record<string, string> },
): Promise<AssetTask[]> {
  const tasks: AssetTask[] = [];
  const overrides = opts?.funnelDomainOverrides || {};

  // Pull location-wide custom fields once — these are the closest thing to
  // a recoverable field schema for forms/surveys (the per-form schema is
  // 401-locked by GHL). Stored as a single special row keyed by location.
  if (resources.includes('form') || resources.includes('survey')) {
    const cf = await ghlGet(`/locations/${locationId}/customFields`, headers);
    const cv = await ghlGet(`/locations/${locationId}/customValues`, headers);
    if (cf.ok || cv.ok) {
      tasks.push({
        resource_type: 'location_custom_schema' as any,
        ghl_id: locationId,
        seed: {
          customFields: cf.body?.customFields || [],
          customValues: cv.body?.customValues || [],
        },
      });
    }
  }

  if (resources.includes('form')) {
    // GHL caps limit at 100 for /forms
    const list = await ghlGet(`/forms/?locationId=${locationId}&limit=100`, headers);
    const items: any[] = list.body?.forms || list.body?.data || [];
    for (const f of items) {
      const id = f.id || f._id;
      if (id) tasks.push({ resource_type: 'form', ghl_id: id, seed: f });
    }
  }

  if (resources.includes('survey')) {
    // GHL caps limit at 50 for /surveys (422 otherwise) — paginate.
    let skip = 0;
    while (true) {
      const list = await ghlGet(`/surveys/?locationId=${locationId}&limit=50&skip=${skip}`, headers);
      const items: any[] = list.body?.surveys || list.body?.data || [];
      if (!items.length) break;
      for (const s of items) {
        const id = s.id || s._id;
        const isQuiz = s.isQuiz === true || s.type === 'quiz';
        if (id) tasks.push({ resource_type: isQuiz ? 'quiz' : 'survey', ghl_id: id, seed: s });
      }
      if (items.length < 50) break;
      skip += items.length;
      if (skip > 2000) break;
    }
  }

  if (resources.includes('funnel')) {
    const list = await ghlGet(`/funnels/funnel/list?locationId=${locationId}`, headers);
    const funnels: any[] = list.body?.funnels || list.body?.data || [];

    // First domain we see → used to enumerate the entire public site.
    const primaryDomain = Object.values(overrides).find(Boolean) || null;
    const sitePages: string[] = primaryDomain ? await firecrawlMap(primaryDomain) : [];
    const sitePageSet = new Set(sitePages.map((u) => {
      try { return new URL(u).pathname.replace(/\/+$/, '') || '/'; } catch { return u; }
    }));
    console.log(`[harvester] Firecrawl /map discovered ${sitePages.length} URLs on ${primaryDomain || 'no-domain'}`);

    const claimedPaths = new Set<string>();

    for (const fn of funnels) {
      const fid = fn._id || fn.id;
      if (!fid) continue;
      const overrideDomain = overrides[fid] || primaryDomain;
      tasks.push({
        resource_type: 'funnel',
        ghl_id: fid,
        seed: { ...fn, _publishedDomain: overrideDomain },
      });
      const pageList = await ghlGet(
        `/funnels/page?locationId=${locationId}&funnelId=${fid}&limit=100&offset=0`,
        headers,
      );
      const pages: any[] = Array.isArray(pageList.body) ? pageList.body : (pageList.body?.data || []);
      const stepUrlById: Record<string, string> = {};
      for (const st of (fn.steps || [])) {
        const sid = st.id || st._id;
        if (sid) stepUrlById[sid] = st.url || '';
      }
      for (const pg of pages) {
        const pid = pg._id || pg.id;
        if (!pid) continue;
        const stepPath = pg.stepId ? (stepUrlById[pg.stepId] || '') : '';
        const slug = (fn.url || '').replace(/^\/+|\/+$/g, '');
        const sp = (stepPath || '').replace(/^\/+|\/+$/g, '');
        const fullPath = '/' + [slug, sp].filter(Boolean).join('/');
        claimedPaths.add(fullPath.replace(/\/+$/, '') || '/');
        tasks.push({
          resource_type: 'funnel_page',
          ghl_id: pid,
          parent_ghl_id: fid,
          seed: {
            ...pg,
            parentName: fn.name,
            parentSlug: fn.url || '',
            parentStepUrl: stepPath,
            parentDomain: overrideDomain,
          },
        });
      }
    }

    // Add Firecrawl-discovered pages that no GHL funnel claimed (extra
    // top-level marketing pages, thank-you pages, sub-steps under a slug
    // the API didn't list, etc.). These render through the same code path.
    if (primaryDomain) {
      let added = 0;
      for (const url of sitePages) {
        let path = '/';
        try { path = new URL(url).pathname.replace(/\/+$/, '') || '/'; } catch {}
        if (claimedPaths.has(path)) continue;
        // Skip GHL widget/admin URLs
        if (/\/(widget|api|hooks|webhooks)\//.test(path)) continue;
        const synthId = `site:${path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root'}`;
        tasks.push({
          resource_type: 'funnel_page',
          ghl_id: synthId,
          parent_ghl_id: null,
          seed: {
            name: `Site page ${path}`,
            fullUrl: url,
            parentDomain: primaryDomain,
            _discoveredVia: 'firecrawl_map',
          },
        });
        added++;
        if (added >= 200) break;
      }
      console.log(`[harvester] Added ${added} extra site pages from /map`);
    }
  }

  if (resources.includes('workflow')) {
    const list = await ghlGet(`/workflows/?locationId=${locationId}`, headers);
    const items: any[] = list.body?.workflows || list.body?.data || [];
    for (const wf of items) {
      const id = wf.id || wf._id;
      if (id) tasks.push({ resource_type: 'workflow', ghl_id: id, seed: wf });
    }
  }

  return tasks;
}
