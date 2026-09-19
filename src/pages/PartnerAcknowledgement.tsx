import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2, ShieldCheck, CheckCircle2, XCircle, Clock, AlertTriangle,
} from "lucide-react";
import { BrandLockup } from "@/components/branding/BrandAssets";
import { PortalAgreementConsent } from "@/components/portal/PortalAgreementConsent";
import {
  DIRECT_AGREEMENT_ACCEPTANCE_NOTICE, DIRECT_AGREEMENT_TITLE, DIRECT_TERMS_ACKNOWLEDGEMENTS,
} from "@/lib/portalAgreement";
import {
  partnerAcknowledgementPublicApi, type PublicAcknowledgementView,
} from "@/lib/aml/partnerAcknowledgementPublic";

/**
 * The AML/CTF Compliance Passport Agreement, for a partner OUTSIDE the
 * portals — public, token-addressed, no account and no password.
 *
 * The agreement, the mandatory acknowledgements, the acceptance notice and
 * the button are `PortalAgreementConsent`, the same component the three
 * portals mount at sign-up. That is deliberate: one instrument presented one
 * way. A second copy of this markup would drift, and the drift would only
 * surface when two acceptance records under the same document name turned
 * out to be acceptances of different things.
 *
 * This page adds exactly two things a portal sign-up gets for free — who is
 * accepting (there is no account to read it from) and the ability to
 * decline — and nothing else. It never shows the customer: at this point the
 * partner has been granted nothing, and the passport is a separate act.
 */
export default function PartnerAcknowledgement() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<PublicAcknowledgementView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [decliningOpen, setDecliningOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  useEffect(() => { document.title = "AML/CTF Compliance Agreement"; }, []);

  const load = useCallback(async () => {
    if (!token) { setLoadError("This link is not valid."); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await partnerAcknowledgementPublicApi.view(token);
      setView(res.acknowledgement);
      setSignerName((current) => current || res.acknowledgement.recipient_name || "");
      setLoadError(null);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "This link is not valid.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const terms = useMemo(() => (
    view?.terms
      ? {
          id: "direct", version: view.terms.version, title: view.terms.title,
          content_markdown: view.terms.content_markdown, document_hash: null,
        } as never
      : null
  ), [view?.terms]);

  const accept = async (acknowledgements: string[]) => {
    if (!token) return;
    const name = signerName.trim();
    if (name.length < 2) {
      setNameError("Enter the full name of the person accepting on behalf of the organisation.");
      return;
    }
    setNameError(null);
    setActionError(null);
    setBusy(true);
    try {
      const res = await partnerAcknowledgementPublicApi.accept(token, {
        accepted_by_name: name, acknowledgements,
      });
      setView(res.acknowledgement);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "The acceptance could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (!token) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await partnerAcknowledgementPublicApi.decline(token, declineReason.trim() || undefined);
      setView(res.acknowledgement);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "The response could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  /*
   * The mark is CONSTRAINED here. `BrandLockup` sets no default size, so the
   * uploaded asset rendered at its natural dimensions — several times the
   * height of the heading beside it, which made the logo the subject of the
   * page and the agreement its footnote. A signing page should lead with
   * what is being signed.
   */
  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-background px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <header className="flex justify-center border-b border-border/50 pb-5">
          <BrandLockup
            slot="auth"
            meta="Compliance Agreement"
            logoClassName="h-10 w-auto object-contain sm:h-12"
            fallbackClassName="h-10 w-10 sm:h-12 sm:w-12"
            companyClassName="text-sm sm:text-base"
          />
        </header>
        {children}
      </div>
    </div>
  );

  if (loading) {
    return shell(
      <div className="flex items-center justify-center py-20" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">Loading the agreement…</span>
      </div>,
    );
  }

  if (loadError || !view) {
    return shell(
      <StatusCard
        icon={XCircle}
        tone="text-destructive"
        title="This link is not valid"
        body={loadError ?? "The link may have been mistyped. Ask the issuing organisation to send a new one."}
      />,
    );
  }

  /* ── terminal states: a link is answered once ──────────────────────── */

  if (view.status === "accepted") {
    /* "Nothing further is needed from you" was true and useless: it told a
       signatory that something had been recorded and left them with no idea
       what arrives next, from whom, at which address, or when to chase it.
       The three facts they need are the ones this page can state exactly. */
    return shell(
      <StatusCard
        icon={CheckCircle2}
        tone="text-success"
        title="Agreement accepted"
        body={`Thank you. ${view.issuer_name} has recorded your organisation's acceptance${
          view.accepted_at ? ` on ${new Date(view.accepted_at).toLocaleDateString('en-AU')}` : ""
        }${view.accepted_by_name ? `, signed by ${view.accepted_by_name}` : ""}.`}
        after={(
          <div className="mx-auto max-w-prose space-y-3 pt-1 text-left">
            <p className="text-sm text-muted-foreground">
              Nothing further is needed from you now. {view.issuer_name} has been notified and will
              send the AML/CTF Compliance Passport itself.
            </p>
            <dl className="grid gap-2 rounded-md border border-border/60 p-3 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">It arrives</dt>
                <dd className="font-medium">By email, as a link</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Sent to</dt>
                <dd className="break-all font-medium">{view.recipient_email}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Open for</dt>
                <dd className="font-medium">90 days, re-issuable</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              The link is the credential — no account and no password — so keep it within authorised
              personnel. If it does not arrive, or you would prefer a different address, contact{" "}
              {view.issuer_name} and they can issue a new one. Completing your own independent
              customer due diligence remains available to you at any time.
            </p>
          </div>
        )}
      />,
    );
  }

  if (view.status === "declined") {
    return shell(
      <StatusCard
        icon={XCircle}
        tone="text-muted-foreground"
        title="Agreement declined"
        body="Your response has been recorded and nothing has been shared with your organisation. If this was not intended, contact the issuing organisation and they can send a new request."
      />,
    );
  }

  if (view.status === "expired" || view.status === "superseded") {
    return shell(
      <StatusCard
        icon={Clock}
        tone="text-warning"
        title={view.status === "superseded" ? "This link has been replaced" : "This link has expired"}
        body={
          view.status === "superseded"
            ? "A newer request has been sent for this agreement. Please use the most recent email you received."
            : "For security, the link is only valid for a limited time. Ask the issuing organisation to send a new one — nothing is lost by doing so."
        }
      />,
    );
  }

  /* ── live: read, name, accept or decline ───────────────────────────── */

  return shell(
    <>
      <Card className="glass-panel">
        <CardContent className="space-y-2 py-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div className="space-y-1">
              <h1 className="text-base font-semibold leading-snug">
                {view.issuer_name} has asked {view.organisation_name ?? "your organisation"} to accept
                this agreement
              </h1>
              <p className="text-sm text-muted-foreground">
                It sets out how an AML/CTF Compliance Passport is made available to you by link — no
                account and no password. Read it below, tick each acknowledgement, then confirm who is
                accepting.
              </p>
            </div>
          </div>
          {/* Three facts a signatory wants before reading 17 sections. */}
          <dl className="grid gap-2 border-t border-border/50 pt-3 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Access</dt>
              <dd className="font-medium">One link — no portal account</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Available for</dt>
              <dd className="font-medium">90 days, re-issuable</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">This request expires</dt>
              <dd className="font-medium">{new Date(view.expires_at).toLocaleDateString('en-AU')}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card className="glass-panel">
        <CardContent className="py-5">
          {/* The instrument itself — the SAME component the portals mount. */}
          <PortalAgreementConsent
            terms={terms}
            loading={false}
            busy={busy}
            onAccept={(keys) => void accept(keys as string[])}
            /* Same four keys the portals use; the words describe a link,
               because that is what this partner is actually given. */
            acknowledgements={DIRECT_TERMS_ACKNOWLEDGEMENTS}
            acceptanceNotice={DIRECT_AGREEMENT_ACCEPTANCE_NOTICE}
            fallbackTitle={DIRECT_AGREEMENT_TITLE}
            beforeAccept={(
              <div className="space-y-1.5">
                <Label htmlFor="pa-signer" className="text-xs">
                  Full name of the person accepting
                </Label>
                <Input
                  id="pa-signer"
                  value={signerName}
                  onChange={(e) => { setSignerName(e.target.value); setNameError(null); }}
                  placeholder="e.g. Jordan Lee"
                  aria-invalid={nameError ? true : undefined}
                  className="max-w-sm"
                />
                {nameError && (
                  <p className="text-xs text-destructive" aria-live="polite">{nameError}</p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Recorded with the acceptance, alongside the date, the agreement version and its
                  document hash.
                </p>
              </div>
            )}
          />
        </CardContent>
      </Card>

      {actionError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <p className="text-sm text-destructive" aria-live="polite">{actionError}</p>
        </div>
      )}

      {/* Declining is a real answer, not a dead end — and it records nothing
          against the organisation beyond the fact of the response. */}
      <Card className="glass-panel">
        <CardContent className="space-y-3 py-4">
          {!decliningOpen ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Not the right person, or not able to accept?
              </p>
              <Button variant="ghost" size="sm" onClick={() => setDecliningOpen(true)} disabled={busy}>
                Decline this request
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="pa-decline" className="text-xs">
                Reason (optional) — shared with {view.issuer_name}
              </Label>
              <textarea
                id="pa-decline"
                className="min-h-[64px] w-full rounded-md border border-input bg-background p-2 text-sm"
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="e.g. this should go to our compliance officer instead"
              />
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDecliningOpen(false)} disabled={busy}>
                  Back
                </Button>
                <Button variant="destructive" size="sm" onClick={() => void decline()} disabled={busy}>
                  {busy && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden />}
                  Confirm decline
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>,
  );
}

function StatusCard({ icon: Icon, tone, title, body, after }: {
  icon: typeof ShieldCheck; tone: string; title: string; body: string;
  /** What happens next, for the readings that have a next. */
  after?: React.ReactNode;
}) {
  return (
    <Card className="glass-panel">
      <CardContent className="space-y-2 py-8 text-center">
        <Icon className={`mx-auto h-8 w-8 ${tone}`} aria-hidden />
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="mx-auto max-w-prose text-sm text-muted-foreground">{body}</p>
        {after}
      </CardContent>
    </Card>
  );
}
