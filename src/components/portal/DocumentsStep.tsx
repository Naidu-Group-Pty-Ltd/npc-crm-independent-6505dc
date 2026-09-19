import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2, CheckCircle2, Clock, AlertTriangle, Upload, FileText, Eye,
  ArrowRight, ArrowLeft,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import {
  amlPortalApi, uploadAmlDocument, type AmlPortalDocument,
} from '@/lib/aml/amlPortalApi';
import {
  documentMetaLine, documentStatus, groupDocuments,
  type DocumentStatusPresentation,
} from '@/lib/aml/documentPresentation';

/**
 * The Client Portal's Documents step.
 *
 * ## What was wrong
 *
 * This screen rendered the case's document REQUIREMENTS and nothing else. It
 * never read the documents themselves — `listDocuments` existed, the backend
 * returned a portal-safe projection, and no caller in the portal had ever
 * asked for it.
 *
 * So a customer uploaded a file, the server stored it correctly, a toast said
 * "Uploaded", and then: no filename, no row, nothing. A reload showed the same
 * nothing. A case with no requirements — the common one — still said "No
 * document requirements have been set yet" underneath the file they had just
 * sent us. Every upload outside a requirement disappeared completely, because
 * there was no part of this screen that could render one.
 *
 * The upload was never broken. The screen simply never looked.
 *
 * ## What this does instead
 *
 * It reads the canonical list on mount, after every successful upload, and
 * whenever the case changes; renders each requirement with the document
 * actually attached to it (matched on `requirement_id`, never on a filename);
 * and gives everything else a home under "Additional documents".
 *
 * There is no second source of truth. Nothing is cached across mounts and no
 * document is invented locally from an upload that has just succeeded — the
 * row the customer sees is the row the server returned.
 */

/** Which upload control is busy. `null` when idle. */
type UploadTarget = string | null;

/**
 * The glyph for a document's state.
 *
 * Decorative — every row carries the status as words beside it, so nothing
 * here is the only way to know what the state is. It exists to stop a tick
 * appearing next to "Needs attention".
 */
function StatusIcon(
  { status, className }: { status: DocumentStatusPresentation; className?: string },
) {
  if (status.needsAttention) return <AlertTriangle className={className} aria-hidden="true" />;
  if (status.settled) return <CheckCircle2 className={className} aria-hidden="true" />;
  return <FileText className={className} aria-hidden="true" />;
}

export function DocumentsStep({
  caseId, requirements, onChange, onNext, onBack,
}: {
  caseId: string;
  requirements: any[];
  onChange: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const inputRef = useRef<Record<string, HTMLInputElement | null>>({});
  const [uploading, setUploading] = useState<UploadTarget>(null);
  const [documents, setDocuments] = useState<AmlPortalDocument[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  /**
   * The upload landed but the re-read did not.
   *
   * Held separately from `listError` because it is a different sentence: the
   * customer's file IS on the server, and telling them otherwise because a
   * second request failed would be a lie in the direction that makes them
   * upload it again.
   */
  const [staleAfterUpload, setStaleAfterUpload] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  /**
   * Which read is the current one.
   *
   * Bumped on every request so a slow response for the previous case — or a
   * mount read that lands after the post-upload refresh — cannot overwrite
   * fresher state with staler state.
   */
  const requestToken = useRef(0);

  const loadDocuments = useCallback(async () => {
    const token = ++requestToken.current;
    try {
      const res = await amlPortalApi.listDocuments(caseId);
      if (token !== requestToken.current) return true;
      setDocuments(res.documents ?? []);
      setListError(null);
      setStaleAfterUpload(false);
      return true;
    } catch (e: any) {
      if (token !== requestToken.current) return false;
      // Never collapse to an empty list: "we could not load them" and "you
      // have none" are opposite messages, and showing the second when the
      // first is true is exactly the bug this screen had.
      setListError(e?.message ?? 'Your uploaded documents could not be loaded just now.');
      return false;
    }
  }, [caseId]);

  // `loadDocuments` changes identity only when the case does, so this reads
  // once per case rather than on every render.
  useEffect(() => {
    setDocuments(null);
    setListError(null);
    void loadDocuments();
  }, [loadDocuments]);

  const handleUpload = async (reqId: string | null, file: File | undefined) => {
    if (!file) return;
    if (uploading) return;
    const target = reqId ?? 'freeform';
    setUploading(target);
    setStaleAfterUpload(false);
    try {
      await uploadAmlDocument(caseId, file, reqId);
    } catch (e: any) {
      // Failed before the server confirmed it. Nothing was stored, so nothing
      // is refreshed and the message is a plain failure.
      toast.error(e?.message ?? 'Upload failed');
      setUploading(null);
      return;
    }

    /*
     * Past this line the document EXISTS. Everything below is refreshing our
     * view of it, and a failure here is never reported as an upload failure —
     * the customer would send the file again, and we would hold two copies of
     * their identity document because our list request timed out.
     */
    const refreshed = await loadDocuments();
    // Requirement status is owned by the overview, and `confirm_upload` moves
    // it to `uploaded`. Independent of the list: one failing must not stop the
    // other from having run.
    try { onChange(); } catch { /* the parent reports its own load failure */ }

    if (refreshed) {
      toast.success('Uploaded');
    } else {
      setStaleAfterUpload(true);
    }
    setUploading(null);
  };

  /**
   * Open a document.
   *
   * ## Why the tab is opened before there is anything to put in it
   *
   * This is the whole of the "View does nothing" bug, and it was never the
   * server: `get_document_url` signs the object correctly and always has. The
   * window was opened AFTER the `await`, and a window opened after an `await`
   * is an unsolicited popup — Safari and Firefox drop it on default settings,
   * and `window.open`'s return value was not read, so the refusal produced no
   * tab, no toast and no console line. Pressing View did exactly nothing,
   * repeatably, with a working backend behind it.
   *
   * So the tab is opened SYNCHRONOUSLY inside the click, while the customer's
   * gesture is still current, and navigated once the URL arrives. It is the
   * same ordering `IdentityVerificationStep` opens the hosted-verification
   * window with, and for the same reason.
   *
   * `noopener` cannot be passed — the feature detaches the handle this needs —
   * so the reference is severed the other way, by nulling the child's
   * `opener`. The tab reaches the same place with the same authority: none.
   *
   * A window blocked even synchronously is reported and offered again rather
   * than swallowed. The second attempt runs inside its own click, which is
   * what makes it succeed where the first was refused.
   *
   * The URL is fetched at the moment of the click, used immediately, and
   * dropped. It is a short-lived credential for one file — it is never held in
   * state, never written to storage and never logged.
   */
  const openDocument = async (doc: AmlPortalDocument) => {
    // One at a time. The per-row `disabled` covers a double-click on the same
    // document; this covers a second row pressed while the first is signing.
    if (opening) return;
    setOpening(doc.id);

    const viewer = window.open('', '_blank');
    // See above: the substitute for the `noopener` feature, which would have
    // returned null instead of a handle.
    if (viewer) viewer.opener = null;

    try {
      const { url } = await amlPortalApi.documentUrl(caseId, doc.id);
      if (viewer && !viewer.closed) {
        // `replace`, not `href`: the placeholder must not become a back-button
        // stop between the portal and the document.
        viewer.location.replace(url);
      } else {
        /*
         * Blocked outright, or closed while we were signing. The link is live
         * for a couple of minutes, so it is offered rather than discarded —
         * held in this closure and nowhere else, exactly as long as the toast.
         */
        toast.error('Your browser blocked the document window.', {
          action: {
            label: 'Open',
            onClick: () => window.open(url, '_blank', 'noopener,noreferrer'),
          },
        });
      }
    } catch (e: any) {
      // Never leave a blank tab standing where a document was asked for.
      viewer?.close();
      if (import.meta.env.DEV) {
        // Deliberately not the signed link, which is a live credential.
        console.error('[DocumentsStep] could not open document', {
          document: doc.id, reason: e?.message, code: e?.code,
        });
      }
      toast.error(e?.message ?? 'We could not open that document just now. Please try again.');
    } finally {
      setOpening(null);
    }
  };

  const requirementIds = requirements.map((r) => String(r.id));
  const { byRequirement, additional } = groupDocuments(documents ?? [], requirementIds);
  const missing = requirements.filter(
    (r) => r.required && !['uploaded', 'accepted'].includes(r.status));
  const loading = documents === null && !listError;
  const hasAnyDocument = (documents?.length ?? 0) > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
        <CardDescription>
          Upload the items your adviser has requested. Accepted formats: PDF, JPG, PNG (≤ 25 MB).
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/*
          The upload landed; the refresh did not. Stated as a partial success,
          because it is one — and because the recovery is a page refresh, not
          another upload.
        */}
        {staleAfterUpload && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle className="text-sm">Your document was uploaded</AlertTitle>
            <AlertDescription className="text-xs">
              We could not refresh the list just now. Refresh the page to see it — there is no
              need to upload it again.
            </AlertDescription>
          </Alert>
        )}

        {listError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle className="text-sm">
              Your uploaded documents could not be loaded just now
            </AlertTitle>
            <AlertDescription className="text-xs space-y-2">
              {/*
                Deliberately does NOT say "you have no documents". Anything
                already uploaded is still safely held.
              */}
              <span className="block">
                Anything you have already sent us is still safely held. You can try again, or
                refresh the page.
              </span>
              <Button size="sm" variant="outline" onClick={() => void loadDocuments()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {loading && <Skeleton className="h-24 w-full" />}

        {/* ── Requirements, each with the document actually attached ─────── */}
        {requirements.length > 0 && (
          <ul className="divide-y divide-border/60">
            {requirements.map((r) => {
              const id = String(r.id);
              const attached = byRequirement.get(id) ?? [];
              // Newest first from the server; replacing adds a row rather than
              // rewriting one, so the current document is the first.
              const current = attached[0] ?? null;
              const done = ['uploaded', 'accepted'].includes(r.status);
              const rejected = r.status === 'rejected';
              const status = current ? documentStatus(current.status) : null;

              return (
                <li key={id} className="py-3">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      'h-8 w-8 rounded-full flex items-center justify-center shrink-0',
                      done ? 'bg-success/15 text-success'
                        : rejected ? 'bg-destructive/15 text-destructive'
                          : 'bg-muted text-muted-foreground',
                    )}>
                      {done ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        : rejected ? <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                          : <FileText className="h-4 w-4" aria-hidden="true" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{r.label}</p>
                        {r.required && (
                          <Badge variant="outline" className="text-[10px]">Required</Badge>
                        )}
                      </div>
                      {r.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>
                      )}

                      {current ? (
                        <div className="mt-2 rounded-md border bg-muted/30 p-2">
                          <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
                            {/*
                              The icon follows the STATUS, not the fact that a
                              file exists. A green tick beside "Needs
                              attention" is the one combination that actively
                              misleads — it reads as done to anyone scanning.
                            */}
                            <StatusIcon
                              status={status!}
                              className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', status!.tone)}
                            />
                            <div className="min-w-0 flex-1">
                              {/*
                                `break-all` and not `truncate`: a customer
                                checking they sent the right file needs to read
                                the end of the name, and a clipped
                                `passport-scan-fin…` is the half that does not
                                identify it. `title` keeps the full value for a
                                tooltip either way.
                              */}
                              <p
                                className="text-xs font-medium break-all"
                                title={current.filename}
                              >
                                {current.filename}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {documentMetaLine(current)}
                              </p>
                              <p className={cn('text-[11px] font-medium', status!.tone)}>
                                {status!.label}
                              </p>
                              {status!.needsAttention && current.rejection_reason && (
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  {current.rejection_reason}
                                </p>
                              )}
                            </div>
                            {/*
                              Inside the document card and beside the file it
                              opens, the same shape as an additional document.
                              On its own line below the row it read as an
                              orphaned control belonging to nothing.
                            */}
                            <Button
                              size="sm"
                              variant="outline"
                              className="shrink-0"
                              onClick={() => void openDocument(current)}
                              disabled={opening === current.id}
                              aria-label={`View ${current.filename}`}
                            >
                              {opening === current.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                : <Eye className="h-3.5 w-3.5 mr-1" aria-hidden="true" />}
                              View
                            </Button>
                          </div>
                        </div>
                      ) : done ? (
                        /*
                          The requirement says a document arrived but we have
                          no row for it — a list that failed to load, or a
                          staff upload the projection does not carry. Say what
                          is true and do not invent a filename.
                        */
                        <p className="mt-2 text-xs text-muted-foreground">Document received</p>
                      ) : null}
                    </div>

                    <input
                      ref={(el) => (inputRef.current[id] = el)}
                      type="file"
                      accept="application/pdf,image/*"
                      className="hidden"
                      // Reset so choosing the same file twice still fires.
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.currentTarget.value = '';
                        void handleUpload(id, file);
                      }}
                    />
                    <Button
                      size="sm"
                      variant={done ? 'outline' : 'default'}
                      onClick={() => inputRef.current[id]?.click()}
                      disabled={uploading !== null}
                      // The requirement's name, so a screen reader hears
                      // "Replace Proof of identity" rather than four
                      // identical "Replace" buttons.
                      aria-label={`${current ? 'Replace' : 'Upload'} ${r.label}`}
                    >
                      {uploading === id
                        ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /><span className="sr-only">Uploading</span></>
                        : <><Upload className="h-4 w-4 mr-1" aria-hidden="true" /> {current ? 'Replace' : 'Upload'}</>}
                    </Button>
                  </div>

                </li>
              );
            })}
          </ul>
        )}

        {/* ── Everything uploaded outside a requirement ──────────────────── */}
        {additional.length > 0 && (
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {requirements.length > 0 ? 'Additional documents' : 'Uploaded documents'}
            </h3>
            <ul className="mt-2 space-y-2">
              {additional.map((doc) => {
                const status = documentStatus(doc.status);
                return (
                  <li
                    key={doc.id}
                    className="flex flex-wrap items-start gap-3 rounded-md border p-3 sm:flex-nowrap"
                  >
                    <StatusIcon
                      status={status}
                      className={cn('h-4 w-4 mt-0.5 shrink-0', status.tone)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium break-all" title={doc.filename}>
                        {doc.filename}
                      </p>
                      <p className="text-xs text-muted-foreground">{documentMetaLine(doc)}</p>
                      {/* Words, not just the tick's colour. */}
                      <p className={cn('text-xs font-medium', status.tone)}>{status.label}</p>
                      {status.needsAttention && doc.rejection_reason && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {doc.rejection_reason}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => void openDocument(doc)}
                      disabled={opening === doc.id}
                      aria-label={`View ${doc.filename}`}
                    >
                      {opening === doc.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        : <Eye className="h-3.5 w-3.5 mr-1" aria-hidden="true" />}
                      View
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/*
          Empty states, in the order they are true.

          The old screen had one line for all of them — "No document
          requirements have been set yet" — and showed it under documents the
          customer had just uploaded. It now appears only when there genuinely
          is nothing on either side, and even then it points at what to do
          rather than stopping at what is absent.
        */}
        {!loading && !listError && requirements.length === 0 && !hasAnyDocument && (
          <p className="text-sm text-muted-foreground">
            No document requirements have been set yet. You can still upload a document below if
            your adviser has asked for one.
          </p>
        )}
        {!loading && !listError && requirements.length > 0 && !hasAnyDocument && (
          <p className="text-xs text-muted-foreground">
            Nothing uploaded yet. Use the buttons above to send each requested document.
          </p>
        )}

        <Separator />

        <div>
          <Label className="text-xs" htmlFor="aml-additional-document">
            {hasAnyDocument ? 'Upload another document' : 'Upload additional document'}
          </Label>
          <div className="mt-2 flex items-center gap-2">
            <input
              id="aml-additional-document"
              ref={(el) => (inputRef.current['freeform'] = el)}
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.currentTarget.value = '';
                void handleUpload(null, file);
              }}
            />
            <Button
              variant="outline"
              onClick={() => inputRef.current['freeform']?.click()}
              disabled={uploading !== null}
              aria-label={hasAnyDocument ? 'Upload another document' : 'Upload additional document'}
            >
              {uploading === 'freeform'
                ? <><Loader2 className="h-4 w-4 mr-1 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Uploading…</>
                : <><Upload className="h-4 w-4 mr-1" aria-hidden="true" /> Choose file</>}
            </Button>
          </div>
        </div>

        {missing.length > 0 && (
          <Alert>
            <Clock className="h-4 w-4" />
            <AlertTitle>
              {missing.length} required document{missing.length === 1 ? '' : 's'} still outstanding
            </AlertTitle>
            <AlertDescription>
              You can still continue and submit later once uploads are complete.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" aria-hidden="true" /> Back
          </Button>
          <Button onClick={onNext}>
            Continue <ArrowRight className="h-4 w-4 ml-1" aria-hidden="true" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
