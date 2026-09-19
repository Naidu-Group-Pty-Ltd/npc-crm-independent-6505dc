import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Loader2, ShieldCheck, XCircle, Clock, CheckCircle2, AlertTriangle,
  ArrowRight, Building2,
} from "lucide-react";
import { BrandLockup } from "@/components/branding/BrandAssets";
import { PassportBook } from "@/components/aml/passport/design/PassportBook";
import { buildBooklet, type PassportView } from "@/lib/aml/passport";
import { buildPartnerBooklet } from "@/lib/aml/passport/partnerBooklet.pure";
import {
  passportPublicApi, type PassportRedemption,
} from "@/lib/aml/partnerAcknowledgementPublic";

/**
 * The Compliance Passport, opened from a link — no portal, no account.
 *
 * The bearer token in the URL is the same credential a system-to-system
 * integration uses, redeemed through the same `redeem_attestation`
 * operation. This page adds no disclosure of its own: what it renders is
 * exactly what the server chose to disclose, and the server intersects the
 * payload with the grant's manifest before sending it.
 *
 * Two things are given deliberate prominence rather than fine print:
 *
 *   1. THE RESPONSIBILITY NOTICE. Relying on another entity's
 *      identification does not transfer that entity's obligations. The
 *      server states this at the point of use and this page leads with it.
 *
 *   2. THE INDEPENDENT ASSESSMENT. A partner may make their OWN
 *      determination against the same records instead of relying — always
 *      available, at their prerogative, and it never moves the issuing
 *      organisation's case.
 */
export default function PublicPassport() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PassportRedemption | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState<string | null>(null);

  /* The partner's own determination. */
  const [assessOpen, setAssessOpen] = useState(false);
  const [assessorName, setAssessorName] = useState("");
  const [assessorRole, setAssessorRole] = useState("");
  const [assessStatus, setAssessStatus] =
    useState<"satisfied" | "not_satisfied" | "records_requested">("satisfied");
  const [assessNotes, setAssessNotes] = useState("");
  const [assessDone, setAssessDone] = useState<string | null>(null);
  const [assessError, setAssessError] = useState<string | null>(null);

  useEffect(() => { document.title = "Compliance Passport"; }, []);

  const load = useCallback(async () => {
    if (!token) { setError({ message: "This link is not valid.", code: null }); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await passportPublicApi.redeem(token);
      setData(res);
      setError(null);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "This link is not valid.";
      // The server's own denial vocabulary decides what may be offered —
      // only an expiry may be self-renewed.
      const code = /expired/i.test(message) ? "expired"
        : /revoked/i.test(message) ? "revoked"
        : /superseded|refresh/i.test(message) ? "refresh_required"
        : null;
      setError({ message, code });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  /* The document's pages.
     `buildBooklet` is the Command Centre's own composer and the server now
     sends the partner-audience view it takes, so the two documents are the
     same document rather than two compositions that resemble each other.
     `buildPartnerBooklet` remains the fallback for a deployment still serving
     a build that predates the view — it composes the same leaf sequence from
     the attestation payload, so an older server degrades to a thinner
     document rather than to no document.

     Kept with the other hooks so it precedes every early return — the loading
     and error branches below return before this point in the JSX, and a hook
     after them would run on some renders and not others. */
  const bookletPages = useMemo(() => {
    if (!data) return [];
    if (data.passport) return buildBooklet(data.passport as PassportView);
    return buildPartnerBooklet(data);
  }, [data]);

  const requestNewLink = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const res = await passportPublicApi.requestNewLink(token);
      setRequested(res.message);
    } catch (e: unknown) {
      setRequested(e instanceof Error ? e.message : "The request could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  const submitAssessment = async () => {
    if (!token) return;
    if (assessorName.trim().length < 2) {
      setAssessError("Enter the name of the person making the determination.");
      return;
    }
    if (assessNotes.trim().length < 10) {
      setAssessError("Record at least a brief rationale (10 characters or more).");
      return;
    }
    setAssessError(null);
    setBusy(true);
    try {
      const res = await passportPublicApi.recordIndependentAssessment(token, {
        assessor_name: assessorName.trim(),
        assessor_role: assessorRole.trim() || undefined,
        status: assessStatus,
        decision_notes: assessNotes.trim(),
      });
      setAssessDone(res.message);
      setAssessOpen(false);
    } catch (e: unknown) {
      setAssessError(e instanceof Error ? e.message : "The determination could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-background px-4 py-10">
      {/* Wider than a reading column, because the artefact on this page is a
          two-up booklet spread rather than prose. */}
      <div className="mx-auto w-full max-w-5xl space-y-4">
        {/* The mark is constrained explicitly as well as by the floor in
            `BrandLogo`: this page's own header is a compliance document's
            letterhead, and the document is the subject of it. */}
        <header className="flex justify-center border-b border-border/50 pb-5">
          <BrandLockup
            slot="auth"
            meta="Compliance Passport"
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
        <span className="sr-only">Opening the Compliance Passport…</span>
      </div>,
    );
  }

  if (error || !data) {
    const expired = error?.code === "expired";
    return shell(
      <Card className="glass-panel">
        <CardContent className="space-y-3 py-8 text-center">
          {expired ? (
            <Clock className="mx-auto h-8 w-8 text-warning" aria-hidden />
          ) : (
            <XCircle className="mx-auto h-8 w-8 text-destructive" aria-hidden />
          )}
          <h1 className="text-base font-semibold">
            {expired ? "This access has expired" : "This link cannot be opened"}
          </h1>
          <p className="mx-auto max-w-prose text-sm text-muted-foreground">
            {error?.message ?? "The link may have been mistyped."}
          </p>
          {/* Only an expiry may be renewed from here. A revoked access is a
              decision by the issuing organisation, and this page never
              invites its subject to undo it. */}
          {expired && !requested && (
            <Button onClick={() => void requestNewLink()} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden />}
              Request a new link
            </Button>
          )}
          {requested && (
            <p className="mx-auto max-w-prose text-sm text-success" aria-live="polite">{requested}</p>
          )}
        </CardContent>
      </Card>,
    );
  }

  return shell(
    <>
      {/* 1 · What this is, and what it is not. */}
      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle className="text-sm">
          Compliance Passport for {data.agreement.partner_org_name}
        </AlertTitle>
        <AlertDescription className="text-xs">{data.notice}</AlertDescription>
      </Alert>

      {/* ── the second route to the same record ────────────────────────
          A link is a delivery; a portal is a place you go back to. A partner
          who also holds a portal account should not have to keep this email
          to re-read a record they may rely on — the same Passport is on
          their own AML/CTF Compliance page, permanently, behind their own
          sign-in.

          Offered only when the SERVER says so: `available` is false unless
          that page exists on this deployment and the organisation has an
          active membership somebody could sign in with. Sending a partner to
          a page that answers "your account is not enrolled" is worse than
          the link they already have — it reads as a broken product rather
          than an unconfigured one.

          The destination carries a matter identifier and never this token: a
          credential in a browser address bar survives in history, referrers
          and screenshots, and the portal session decides what may be read
          when they arrive. */}
      {data.portal_handoff?.available && data.portal_handoff.path && (
        <Card className="glass-panel">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex min-w-0 items-start gap-2">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0 space-y-0.5">
                <h2 className="text-sm font-semibold">
                  You also hold a {data.portal_handoff.label} account
                </h2>
                <p className="text-xs text-muted-foreground">
                  This same Passport is on your <strong>AML/CTF Compliance</strong> page there —
                  signed in, with no link to keep. You will be taken straight to this matter.
                </p>
              </div>
            </div>
            <Button asChild size="sm" className="shrink-0">
              <a href={data.portal_handoff.url || data.portal_handoff.path}>
                <Building2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                View in your portal
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* The document itself.
          This used to be `JSON.stringify` in a `<pre>` — the literal payload,
          braces and quoted keys and all. Everyone inside the issuing business
          sees this record as a bound navy-and-gold booklet; the one audience
          the document exists FOR was handed source code.
          It is the SAME viewer the Command Centre and the Client Portal use,
          drawing pages composed from this disclosure alone. Nothing is added
          to what the server sent — the manifest already decided that. */}
      <Card className="glass-panel overflow-hidden p-0">
        <CardContent className="p-0">
          <div className="passport-scope flex h-[min(78vh,860px)] flex-col">
            <div className="passport-bookbar flex flex-none flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="passport-display text-sm font-semibold uppercase tracking-[0.12em]">
                  AML/CTF Compliance Passport
                </div>
                <div className="passport-mono passport-faint mt-0.5 truncate text-[10px]">
                  {[
                    data.agreement.agreement_reference,
                    `Issued ${new Date(data.issued_at).toLocaleDateString('en-AU')}`,
                  ].filter(Boolean).join("  ·  ")}
                </div>
              </div>
              <span className="passport-mono passport-faint text-[10px]">
                sha {data.attestation_sha256.slice(0, 12)}…
              </span>
            </div>
            <PassportBook pages={bookletPages} className="min-h-0 flex-1" />
          </div>
        </CardContent>
      </Card>

      {/* The raw payload used to sit here behind a disclosure. It is gone:
          the document IS the record now, page for page with the issuing
          organisation's own, and a fold-out of the object it was drawn from
          invited a relying entity to read the source instead of the
          instrument. An integration that needs the object still redeems the
          same token through `redeem_attestation` and receives it. */}

      {/* 2 · Their own determination — always available, at their prerogative. */}
      <Card className="glass-panel">
        <CardContent className="space-y-3 py-5 text-sm">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">Make your own determination</h2>
              <p className="text-xs text-muted-foreground">
                Relying on these procedures does not transfer your organisation&apos;s AML/CTF
                obligations. Safe practice is to satisfy yourself independently — you can record your
                own determination against these same records, without approaching the customer again.
                It is recorded against this access and never alters the issuing organisation&apos;s
                own case.
              </p>
            </div>
          </div>

          {assessDone && (
            <p className="rounded-md border border-success/40 bg-success/5 p-3 text-xs text-success"
              aria-live="polite">{assessDone}</p>
          )}

          {!assessDone && !assessOpen && (
            <Button variant="outline" size="sm" onClick={() => setAssessOpen(true)}>
              Record an independent assessment
            </Button>
          )}

          {!assessDone && assessOpen && (
            <div className="space-y-3 border-t border-border/50 pt-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pp-name" className="text-xs">Your name</Label>
                  <Input id="pp-name" value={assessorName}
                    onChange={(e) => setAssessorName(e.target.value)} placeholder="e.g. Jordan Lee" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pp-role" className="text-xs">Your role (optional)</Label>
                  <Input id="pp-role" value={assessorRole}
                    onChange={(e) => setAssessorRole(e.target.value)} placeholder="e.g. Compliance Officer" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Your determination</Label>
                <div role="radiogroup" aria-label="Determination" className="grid gap-2 sm:grid-cols-3">
                  {([
                    { value: "satisfied", label: "Satisfied", meaning: "These procedures meet our requirements." },
                    { value: "not_satisfied", label: "Not satisfied", meaning: "We will complete our own CDD." },
                    { value: "records_requested", label: "Records requested", meaning: "We need more before deciding." },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={assessStatus === option.value}
                      onClick={() => setAssessStatus(option.value)}
                      className={
                        assessStatus === option.value
                          ? "rounded-md border border-primary bg-primary/5 p-2.5 text-left"
                          : "rounded-md border border-border/60 p-2.5 text-left hover:border-primary/50"
                      }
                    >
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span className="block text-xs text-muted-foreground">{option.meaning}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pp-notes" className="text-xs">Rationale</Label>
                <textarea
                  id="pp-notes"
                  className="min-h-[64px] w-full rounded-md border border-input bg-background p-2 text-sm"
                  value={assessNotes}
                  onChange={(e) => setAssessNotes(e.target.value)}
                  placeholder="What you reviewed and what you concluded…"
                />
              </div>
              {assessError && (
                <p className="flex items-start gap-1.5 text-xs text-destructive" aria-live="polite">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {assessError}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setAssessOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void submitAssessment()} disabled={busy}>
                  {busy && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden />}
                  Record determination
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>,
  );
}
