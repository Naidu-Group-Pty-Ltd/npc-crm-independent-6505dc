import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { internalError } from '../_shared/errorResponse.ts';
import {
  AUSTRALIA_BBOX, COORD_RATIO_FLOOR_ROWS, GTFS_CANDIDATES, GTFS_FEEDS,
  IMPOSSIBLE_COORD_TOLERANCE, ZIP_TAIL_BYTES, assertNotTruncated, feedByKey,
  findMember, memberDataStart, parseGtfsCsv, projectStops,
  readZipDirectoryFromTail, zipLinksIn,
  type GtfsFeed, type ZipMember,
} from '../_shared/gtfsFeed.pure.ts';

/**
 * A fixed input for `digest`, carrying every shape the real feeds actually
 * contain: NT's unquoted values with a leading space on the coordinate, NSW's
 * fully-quoted row, a column ORDER that differs from NSW's, a row of the
 * wrong width, a coordinate outside Australia, and a repeated stop_id.
 *
 * Its parse is part of the digest, so two deployments agreeing on this string
 * agree on the parser's behaviour where it is hardest to get right.
 */
const DIGEST_SAMPLE = [
  'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,location_type,parent_station',
  '12,004,"Trower Road after Bradshaw Terrace",, -12.369522, 130.883003,0,',
  '"2533211","2533211","Kiama Station, Platform 1","","-34.67255547","150.85455900","","253330"',
  'G268012,,"Brinagee St At Gunbar St",,0.0,0.0,1,',
  '12,004,"A repeat of the first id",, -12.369522, 130.883003,0,',
  'short,row,only',
  '99,,"No name test",, -23.742994, 133.867567,,',
].join('\n');

/**
 * Load published GTFS feeds into `transport_stops` — the loader IS this
 * function, running where the egress lives (the `abs-poa-ingest` /
 * `crime-data-ingest` pattern, which is the sanctions-register lesson: a
 * loader that cannot reach its source from where it will actually run is a
 * loader that has never been tested).
 *
 * ## `probe` exists because reachability is a fact about THIS egress
 *
 * SALM is stalled in exactly this way: the file is published, and every
 * vantage this programme holds is refused at the IP level. Reaching a host
 * from a developer sandbox says nothing about the Edge Function that will run
 * the load, so `{"stage":"probe"}` asks the question from here — per feed, it
 * reports whether a range request was honoured, whether the zip's central
 * directory parses, and whether the member inflates to its declared size.
 * It writes nothing.
 *
 * Its answer is what decides whether a feed may be declared at all.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const UA = 'NPC-Property-Dashboard/1.0 (+reporting-engine; GTFS ingest)';

async function ranged(url: string, start: number, end: number): Promise<Uint8Array> {
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}`, 'User-Agent': UA } });
  // A 200 to a Range request means the server is sending the WHOLE archive —
  // 279 MB for NSW. Refused rather than consumed: accepting it would exhaust
  // the function's memory instead of reporting that a source changed.
  if (r.status !== 206) {
    await r.body?.cancel();
    throw new Error(`range request not honoured: HTTP ${r.status}`);
  }
  return new Uint8Array(await r.arrayBuffer());
}

/**
 * The archive's length, asked with a one-byte range rather than a HEAD.
 *
 * TransLink answers HEAD with no `content-length` at all while answering a
 * ranged GET with `Content-Range: bytes 0-0/37356493` and
 * `accept-ranges: bytes`. Reading HEAD alone therefore reported a perfectly
 * range-addressable feed as un-addressable — a fault in this loader rather
 * than in the publisher, and one only a real request could find.
 */
async function totalSize(url: string): Promise<number> {
  const r = await fetch(url, { headers: { Range: 'bytes=0-0', 'User-Agent': UA } });
  await r.body?.cancel();
  if (r.status !== 206) throw new Error(`range request not honoured on probe: HTTP ${r.status}`);
  const cr = r.headers.get('content-range') ?? '';
  const m = /\/(\d+)\s*$/.exec(cr);
  if (!m) throw new Error(`Content-Range did not carry a total length: "${cr}"`);
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`implausible archive length in "${cr}"`);
  return n;
}

async function inflate(bytes: Uint8Array, method: number): Promise<Uint8Array> {
  if (method === 0) return bytes;
  if (method !== 8) throw new Error(`compression method ${method} is neither stored nor deflate`);
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Fetch one named member and return its bytes, or throw naming the reason. */
async function readMember(feed: GtfsFeed, name: string): Promise<{ bytes: Uint8Array; member: ZipMember; total: number }> {
  const total = await totalSize(feed.url);
  const tail = await ranged(feed.url, Math.max(0, total - ZIP_TAIL_BYTES), total - 1);
  const members = readZipDirectoryFromTail(tail, total);
  const member = findMember(members, name);
  if (!member) throw new Error(`archive has no ${name} (members: ${members.map((m) => m.name).join(', ')})`);
  const lh = await ranged(feed.url, member.localHeaderOffset, member.localHeaderOffset + 29);
  const dataStart = memberDataStart(lh, member.localHeaderOffset);
  const comp = await ranged(feed.url, dataStart, dataStart + member.compressedSize - 1);
  const bytes = await inflate(comp, member.method);
  // The declared size is the archive's own checksum on our arithmetic: an
  // off-by-n in the local-header skip inflates to something plausible-looking
  // rather than failing, and this is what catches it.
  if (bytes.length !== member.uncompressedSize) {
    throw new Error(`${name} inflated to ${bytes.length} bytes, archive declares ${member.uncompressedSize}`);
  }
  return { bytes, member, total };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let body: Record<string, unknown> = {};
  try { body = JSON.parse(await req.text()); } catch { /* defaults below */ }
  const stage = String(body?.stage ?? 'probe');

  const internalSecret = Deno.env.get('INTERNAL_EDGE_SECRET') ?? '';
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  let authorised = internalSecret !== '' && bearer === internalSecret;

  // The bootstrap arm is PER FEED, for the reason the crime ingest's is per
  // STATE: a whole-table emptiness gate seals on the first feed loaded and
  // locks every remaining feed out of its own first load.
  // Two things this got wrong, both found by running it rather than reading
  // it. Without the `.eq('feed', ...)` it counted the WHOLE table, so loading
  // nt_darwin sealed nt_alice and qld_seq out of their own first load with a
  // 403 — the exact fault the comment above describes.
  //
  // And counting ANY row for the feed sealed it on its own FAILURE. NSW needs
  // more than one invocation; the first died at 117,000 of 171,061 and left a
  // `running` row, and the resume was then refused — a feed could be locked
  // permanently half-loaded, which is the worst of the three states. What
  // seals a feed is a load that SUCCEEDED; until then a resume or a retry is
  // still part of its first load.
  if (!authorised && stage !== 'probe' && stage !== 'digest' && stage !== 'probe_candidates') {
    const { count, error } = await supabase
      .from('transport_feed_syncs')
      .select('id', { count: 'exact', head: true })
      .eq('feed', stage)
      .eq('status', 'succeeded');
    if (!error && (count ?? 0) === 0) {
      console.log(`[transport-gtfs-ingest] bootstrap arm: no successful ${stage} load yet, permitted`);
      authorised = true;
    }
  } else if (!authorised) {
    // `probe`, `probe_candidates` and `digest` write nothing and read nothing
    // out of the database, and they can reach only the fixed, public
    // addresses compiled into this deployment — never a URL from the caller.
    // Behind the gateway's JWT that exposes nothing, so they are permitted.
    //
    // They were gated on `succeeded < loadable feeds` at first, and that was
    // wrong in a way worth keeping written down: the diagnostics SEALED
    // THEMSELVES the moment every feed had loaded, which is exactly when a
    // maintainer needs them. `probe_candidates` made it plainest — it exists
    // for networks that are NOT loaded, so gating it on loaded ones could
    // never have been right.
    authorised = true;
  }
  if (!authorised) return json({ success: false, error: 'forbidden' }, 403);

  try {
    // `digest` hashes the modules AS DEPLOYED. Deploying through the
    // Management API means re-sending every dependency by hand, and a
    // deployed copy that silently differs from the file it was built from is
    // a fault this programme has already paid for once — so the deployment is
    // SHOWN to be the repo's source rather than assumed to be. Compare
    // against `sha256sum` on the checkout.
    if (stage === 'digest') {
      // Digests what the modules DO, not their source text. A first attempt
      // read the files back through `import.meta.url` and every path answered
      // "path not found": Supabase compiles the function and does not keep
      // the sources on disk at runtime, so a source hash is not available to
      // a deployed function at all. Behaviour is the better subject anyway —
      // it is what a caller depends on, and `sectionRegistry`'s digest hashes
      // a data structure for the same reason.
      const canon = JSON.stringify({
        feeds: GTFS_FEEDS,
        bbox: AUSTRALIA_BBOX,
        impossibleCoordTolerance: IMPOSSIBLE_COORD_TOLERANCE,
        coordRatioFloorRows: COORD_RATIO_FLOOR_ROWS,
        zipTailBytes: ZIP_TAIL_BYTES,
        sample: projectStops(parseGtfsCsv(DIGEST_SAMPLE)),
      });
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon));
      return json({
        success: true,
        stage: 'digest',
        digest: Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join(''),
        sampleResult: projectStops(parseGtfsCsv(DIGEST_SAMPLE)),
      });
    }

    // Probes networks this platform does NOT hold, from the egress that would
    // load them. It exists because SA, TAS and ACT were written off as
    // refusing "this project's vantages" when only the developer sandbox had
    // ever tried them — asserting more than had been measured, about exactly
    // the distinction `probe` was built to make. Writes nothing, loads
    // nothing, and takes no URL from the caller.
    if (stage === 'probe_candidates') {
      const results = [];
      for (const c of GTFS_CANDIDATES) {
        const started = Date.now();
        try {
          if (c.kind === 'archive') {
            const total = await totalSize(c.url);
            const tail = await ranged(c.url, Math.max(0, total - ZIP_TAIL_BYTES), total - 1);
            const members = readZipDirectoryFromTail(tail, total);
            results.push({
              candidate: c.key,
              reachable: true,
              totalBytes: total,
              members: members.map((m) => ({ name: m.name, unc: m.uncompressedSize, comp: m.compressedSize })),
              sandboxResult: c.sandboxResult,
              ms: Date.now() - started,
            });
          } else {
            const r = await fetch(c.url, { headers: { 'User-Agent': UA } });
            const body = r.ok ? (await r.text()).slice(0, 400_000) : '';
            if (!r.ok) await r.body?.cancel();
            results.push({
              candidate: c.key,
              reachable: r.ok,
              status: r.status,
              contentType: r.headers.get('content-type'),
              zipLinks: r.ok ? zipLinksIn(body) : [],
              sandboxResult: c.sandboxResult,
              ms: Date.now() - started,
            });
          }
        } catch (e) {
          results.push({
            candidate: c.key,
            reachable: false,
            reason: (e as Error).message,
            sandboxResult: c.sandboxResult,
            ms: Date.now() - started,
          });
        }
      }
      return json({ success: true, stage: 'probe_candidates', wrote: false, results });
    }

    if (stage === 'probe') {
      // Reads nothing and writes nothing. Its whole job is to answer whether
      // this egress can address these archives at all.
      const results = [];
      for (const feed of GTFS_FEEDS) {
        const started = Date.now();
        // A feed this loader cannot address is reported as exactly that,
        // never as one that answered nothing.
        if (!feed.loadable) {
          results.push({ feed: feed.key, reachable: false, loadable: false, reason: feed.unloadableReason, ms: 0 });
          continue;
        }
        try {
          const { bytes, member, total } = await readMember(feed, 'stops.txt');
          const firstLine = new TextDecoder().decode(bytes.subarray(0, 600)).split('\n')[0].replace(/^\uFEFF/, '').trim();
          results.push({
            feed: feed.key,
            reachable: true,
            totalBytes: total,
            fetchedBytes: member.compressedSize,
            fetchedPercent: Number((100 * member.compressedSize / total).toFixed(3)),
            inflatedBytes: bytes.length,
            header: firstLine,
            ms: Date.now() - started,
          });
        } catch (e) {
          results.push({ feed: feed.key, reachable: false, reason: (e as Error).message, ms: Date.now() - started });
        }
      }
      return json({ success: true, stage: 'probe', wrote: false, results });
    }

    const feed = feedByKey(stage);
    if (!feed) return json({ success: false, error: 'unknown_stage', stage, known: GTFS_FEEDS.map((f) => f.key) }, 400);
    if (!feed.loadable) {
      return json({ success: false, error: 'feed_not_loadable', stage: feed.key, reason: feed.unloadableReason }, 409);
    }

    // Resumable: 171,061 NSW stops do not insert inside one invocation, so a
    // call writes what it can inside its budget and hands back the offset to
    // resume from. Re-reading the archive costs ~5s and is paid again on each
    // call, which is cheaper and less fragile than holding parsed state.
    const offset = Math.max(0, Number(body?.offset ?? 0) | 0);
    const budgetMs = Math.min(120_000, Math.max(10_000, Number(body?.budgetMs ?? 100_000) | 0));
    const started = Date.now();

    const { bytes, member, total } = await readMember(feed, 'stops.txt');
    const parsed = parseGtfsCsv(new TextDecoder('utf-8').decode(bytes));
    const { stops, audit } = projectStops(parsed);
    assertNotTruncated(stops.length, feed.minStops, feed.key);

    let syncId: string | null = null;
    if (offset === 0) {
      const { data: sync, error: syncError } = await supabase
        .from('transport_feed_syncs')
        .insert({
          feed: feed.key,
          status: 'running',
          detail: {
            archiveBytes: total,
            fetchedBytes: member.compressedSize,
            fetchedPercent: Number((100 * member.compressedSize / total).toFixed(3)),
            audit,
            sourceLabel: feed.sourceLabel,
            licence: feed.licence,
          },
        })
        .select('id')
        .single();
      if (syncError) throw new Error(`sync row insert failed: ${syncError.message}`);
      syncId = (sync as { id: string }).id;

      // Replaced wholesale: a stop withdrawn from the timetable must not go
      // on being served as though it were still there.
      const { error: clearError } = await supabase.from('transport_stops').delete().eq('feed', feed.key);
      if (clearError) throw new Error(`clearing ${feed.key} failed: ${clearError.message}`);
    }

    const BATCH = 1_000;
    let written = 0;
    let i = offset;
    for (; i < stops.length; i += BATCH) {
      if (Date.now() - started > budgetMs) break;
      const slice = stops.slice(i, i + BATCH).map((s) => ({
        feed: feed.key,
        stop_id: s.stopId,
        stop_name: s.stopName,
        lat: s.lat,
        lon: s.lon,
        location_type: s.locationType,
        parent_station: s.parentStation,
        // Not established by this feed's structure. Never a guessed mode.
        route_type: null,
        source_label: feed.sourceLabel,
      }));
      const { error: insertError } = await supabase
        .from('transport_stops').upsert(slice, { onConflict: 'feed,stop_id' });
      if (insertError) throw new Error(`insert at ${i} failed: ${insertError.message}`);
      written += slice.length;
    }

    const done = i >= stops.length;
    if (done) {
      const { count } = await supabase
        .from('transport_stops').select('feed', { count: 'exact', head: true }).eq('feed', feed.key);
      await supabase.from('transport_feed_syncs')
        .update({ status: 'succeeded', finished_at: new Date().toISOString(), stops_written: count ?? null })
        .eq('feed', feed.key).eq('status', 'running');
    }

    return json({
      success: true,
      stage: feed.key,
      archiveBytes: total,
      fetchedBytes: member.compressedSize,
      fetchedPercent: Number((100 * member.compressedSize / total).toFixed(3)),
      parsedStops: stops.length,
      audit,
      offset,
      written,
      nextOffset: done ? null : i,
      done,
      syncId,
      ms: Date.now() - started,
    });
  } catch (e) {
    console.error('[transport-gtfs-ingest] failed:', e);
    // A load that broke must be RECORDED as broken. Left at `running`, a
    // half-written feed is indistinguishable from one still in progress, and
    // the reading would serve a partial network as though it were complete —
    // which is the whole failure class this replaces.
    if (stage !== 'probe') {
      const { error: markError } = await supabase
        .from('transport_feed_syncs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error: e instanceof Error ? e.message : String(e),
        })
        .eq('feed', stage).eq('status', 'running');
      if (markError) console.error('[transport-gtfs-ingest] could not mark the sync failed:', markError.message);
    }
    return json({ success: false, ...internalError(e, 'transport-gtfs-ingest') }, 500);
  }
});
