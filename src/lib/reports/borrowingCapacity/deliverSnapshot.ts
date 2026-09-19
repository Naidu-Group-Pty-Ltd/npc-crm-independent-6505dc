/**
 * Getting a Borrowing Capacity Snapshot into someone's hands.
 *
 * ## Why this exists
 *
 * Four call sites each had their own copy of the same twelve lines: create an
 * anchor, set `download`, append it to the body, click it, remove it, remember
 * to revoke the object URL — but only when the blob was one we made. Two of the
 * four forgot the revoke. That is not a bug worth four fixes; it is a function.
 *
 * ## The variant, and why it is a parameter
 *
 * `requestSnapshot.ts` treats the legacy generator as a *deployment* fallback:
 * reached only when the render function is absent, and never otherwise. That was
 * right for landing the new path and wrong as a resting state — the moment the
 * function is deployed, the generator that has produced this document for the
 * life of the product becomes unreachable from every button in the app. Nobody
 * decided to retire it; it would simply have stopped happening.
 *
 * So the choice is explicit here. `variant: 'server'` is the default everywhere
 * and still carries the undeployed-fallback, because that is a different
 * situation with a different answer. `variant: 'legacy'` is a person choosing
 * the layout they know, and it is offered beside the other on every surface that
 * produces this document.
 */
import { supabase } from '@/integrations/supabase/client';
import { tryTemplateDocument } from '@/lib/reportTemplate/templateDocument';
import { requestBorrowingCapacitySnapshot, type SnapshotRequest } from './requestSnapshot';

/**
 * The assessment the document would be about, when the caller did not name one.
 *
 * The same row the render route resolves for `assessmentId: null` — most recent
 * for the client — read here because the template adapter renders a record and
 * cannot be handed "the most recent" as an instruction.
 *
 * Best-effort by rule: a refused or empty read answers null and the caller
 * carries on to the server route exactly as it did before, which resolves the
 * assessment itself. This must never be able to turn a working download into a
 * failed one.
 */
async function latestAssessmentId(clientId: string | null | undefined): Promise<string | null> {
  if (!clientId) return null;
  try {
    const { data, error } = await supabase
      .from('borrowing_capacity_assessments')
      .select('id')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { id?: string }).id ?? null;
  } catch {
    return null;
  }
}

/**
 * The assessment a request is about: the one it names, or the client's most
 * recent. Both paths resolve it the same way, because no Borrowing Capacity
 * surface in the product names one (`{ clientId, clientName }` everywhere) —
 * and the publish path used to hand the bare request through, so the template
 * ask answered null on every publish and the choice fired its own "not used"
 * notice while the download beside it honoured it (RS-5c.3).
 */
async function resolveAssessmentId(request: SnapshotRequest): Promise<string | null> {
  return request.assessmentId ?? await latestAssessmentId(request.clientId);
}

/** Which renderer produces the document. */
export type SnapshotVariant = 'server' | 'legacy';

/** What the legacy generator hands back. `undefined` is its failure shape. */
export type LegacySnapshot = { blob: Blob; fileName: string } | null | undefined;

export interface DeliverSnapshotInput {
  variant: SnapshotVariant;
  request: SnapshotRequest;
  /**
   * The in-browser generator, bound to whatever this call site knows.
   *
   * Passed in rather than imported so a bundle that only ever asks the server
   * does not carry jsPDF, and so a call site with live what-if overrides can
   * hand in the generator call that renders them.
   */
  legacy: () => Promise<LegacySnapshot>;
}

export interface DeliveredSnapshot {
  /** Which renderer actually produced it — `legacy` may mean chosen or fallen back to. */
  source: 'server' | 'legacy';
  fileName: string;
  /** What the tenant's brand snapshot was missing. Always empty for the legacy path. */
  brandGaps: string[];
  /**
   * Rendered from an activated template. Still `source: 'server'`, because
   * that field answers "typeset, or the in-browser generator?" and this is the
   * typeset one.
   */
  templated?: boolean;
}

/**
 * Save a file the way a browser saves files.
 *
 * An object URL is revoked and a signed URL is not — revoking a URL we did not
 * create does nothing, but the distinction is worth keeping visible because the
 * bug it prevents (a revoked blob URL clicked twice) is invisible until someone
 * clicks twice.
 */
function saveToBrowser(url: string, fileName: string, revoke: boolean): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (revoke) setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** The legacy generator, run and saved. */
async function deliverLegacy(legacy: () => Promise<LegacySnapshot>): Promise<DeliveredSnapshot> {
  const produced = await legacy();
  if (!produced?.blob) {
    throw new Error('The in-browser generator produced no document');
  }
  const url = URL.createObjectURL(produced.blob);
  saveToBrowser(url, produced.fileName, true);
  return { source: 'legacy', fileName: produced.fileName, brandGaps: [] };
}

/**
 * Produce the Snapshot and hand it to the browser.
 *
 * Throws on failure with the message the renderer gave, so a caller can put it
 * in front of the person who pressed the button rather than in a console.
 */
export async function deliverSnapshot(input: DeliverSnapshotInput): Promise<DeliveredSnapshot> {
  if (input.variant === 'legacy') return deliverLegacy(input.legacy);

  // Never over `variant: 'legacy'`, which is a person choosing the layout they
  // know — the whole reason that parameter exists is that a renderer should
  // not change under somebody who asked for a particular one.
  //
  // `assessmentId` is optional here ("omit for the most recent"), and this used
  // to hand it straight to `tryTemplateDocument`, which returns null the moment
  // it has no record id. **No Borrowing Capacity surface in the product fills
  // it in** — `ResultsPanel`, `BorrowingCapacityCard` and `ClientReportsTab` all
  // build `{ clientId, clientName }` — so the template path was skipped on every
  // download, before the "your chosen template was not used" notice could fire.
  // A template chosen for this format was inert and said nothing about it.
  //
  // Resolving "most recent" is the render route's job against the server's view
  // of the data, and it still is for the legacy path below. The adapter needs
  // the row it is rendering, so resolve the same thing here rather than give up.
  const assessmentId = await resolveAssessmentId(input.request);
  // The FINAL document: a chosen template is drawn by the pinned engine, the
  // same one this format's own route uses, never by the browser's jsPDF (RS-5c).
  const templated = await tryTemplateDocument('borrowing_capacity', assessmentId, { renderer: 'weasyprint' });
  if (templated) {
    saveToBrowser(URL.createObjectURL(templated.blob), templated.fileName, true);
    return { source: 'server', fileName: templated.fileName, brandGaps: [], templated: true };
  }

  const result = await requestBorrowingCapacitySnapshot(input.request, async () => {
    const produced = await input.legacy();
    if (!produced?.blob) return null;
    return {
      url: URL.createObjectURL(produced.blob),
      fileName: produced.fileName,
      bytes: produced.blob.size,
    };
  });

  if (result.source === 'legacy') {
    // The fallback already made an object URL; save it and revoke it.
    saveToBrowser(result.url, result.fileName, true);
    return { source: 'legacy', fileName: result.fileName, brandGaps: [] };
  }

  // A signed URL. Fetched rather than followed, so the file is *saved* — a PDF
  // that opens in a tab is a PDF the client has to find again.
  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const url = URL.createObjectURL(await response.blob());
  saveToBrowser(url, result.fileName, true);

  return { source: 'server', fileName: result.fileName, brandGaps: result.brandGaps };
}

/**
 * The Snapshot as bytes — and where they already are — for a caller that
 * publishes rather than saves.
 *
 * The portal publish (`publishReportToPortal`) is the only one of these, and
 * it has never handed the file to the browser. It used to upload the bytes to
 * `client-files/portal-reports/<clientId>/…` on every publish: a second copy of
 * a document the render route had ALREADY stored and ledgered, which doubles
 * the bytes and diverges from the ledger the moment the document is produced
 * again. Since RS-5c.3 the publish points the portal at `storagePath` whenever
 * the renderer stored the document, and uploads only what nothing stored —
 * the in-browser generator on the deployment-gap fallback.
 */
export async function snapshotBlob(input: DeliverSnapshotInput): Promise<{
  blob: Blob;
  fileName: string;
  source: 'server' | 'legacy';
  brandGaps: string[];
  /**
   * Where the final renderer stored these exact bytes, when a chosen template
   * was drawn by it — so a portal publish can point at the object rather than
   * upload a second copy. Null or absent for a document drawn in this tab or
   * by the format's own route (which answers a signed URL, not a path).
   */
  storagePath?: string | null;
}> {
  if (input.variant === 'legacy') {
    const produced = await input.legacy();
    if (!produced?.blob) throw new Error('The in-browser generator produced no document');
    return { blob: produced.blob, fileName: produced.fileName, source: 'legacy', brandGaps: [] };
  }

  // The same rule as the download path, resolved the same way: this is the
  // document a client will open, and it should be the one the tenant chose.
  const templated = await tryTemplateDocument('borrowing_capacity', await resolveAssessmentId(input.request), { renderer: 'weasyprint' });
  if (templated) {
    return {
      blob: templated.blob, fileName: templated.fileName, source: 'server', brandGaps: [],
      storagePath: templated.storagePath,
    };
  }

  let legacyBlob: Blob | null = null;
  const result = await requestBorrowingCapacitySnapshot(input.request, async () => {
    const produced = await input.legacy();
    if (!produced?.blob) return null;
    legacyBlob = produced.blob;
    // The URL is never used on this path; the caller wants the bytes.
    return { url: '', fileName: produced.fileName, bytes: produced.blob.size };
  });

  if (result.source === 'legacy') {
    if (!legacyBlob) throw new Error('The in-browser generator produced no document');
    return { blob: legacyBlob, fileName: result.fileName, source: 'legacy', brandGaps: [] };
  }

  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`Could not read the rendered document (${response.status})`);
  return {
    blob: await response.blob(),
    fileName: result.fileName,
    source: 'server',
    brandGaps: result.brandGaps,
    // Where `render-borrowing-capacity-pdf` stored and ledgered these bytes.
    storagePath: result.storagePath,
  };
}
