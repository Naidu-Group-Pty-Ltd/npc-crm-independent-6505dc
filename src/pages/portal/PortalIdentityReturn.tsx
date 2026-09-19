import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ShieldCheck, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * Where the secure identity check returns the customer.
 *
 * ## This page is a receipt, not a result
 *
 * The provider appends its own query parameters to this URL — a session
 * identifier and a status word among them — and NOTHING here reads them. They
 * are not parsed, not displayed, not sent anywhere and not used to choose what
 * this page says. A redirect is a navigation event authored by whatever the
 * customer's browser was last pointed at; treating one as an identity outcome
 * would mean anyone who can type a URL could mark themselves verified.
 *
 * The identity decision reaches NPC on a signed server-to-server webhook and
 * is then re-read from the provider over an authenticated call. That is the
 * only path. This page's entire contribution is to tell the customer their
 * information arrived and to close itself.
 *
 * ## Why it is public
 *
 * It sits outside the portal's authenticated tree on purpose. The customer may
 * arrive here in a window that has no portal session at all — a phone they
 * handed off to mid-check is the ordinary case — and bouncing them to a login
 * screen at the end of a verification is exactly the third-party-looking
 * ending this work exists to remove. It shows nothing that needs protecting:
 * no case, no name, no status, no data of any kind.
 */

/** Message the opener understands. It carries no status and cannot: see below. */
const RETURN_NOTICE = { type: 'npc:identity-return' } as const;

export default function PortalIdentityReturn() {
  /**
   * Whether this window can close itself.
   *
   * Only a script-opened window may be closed by script, so a customer who got
   * here by a full-page navigation on their phone gets a link instead of a
   * button that silently does nothing.
   */
  const [canSelfClose, setCanSelfClose] = useState(false);
  const notified = useRef(false);

  useEffect(() => {
    if (notified.current) return;
    notified.current = true;

    const opener = window.opener as Window | null;
    if (!opener || opener.closed) return;
    setCanSelfClose(true);

    /**
     * Tell the portal the customer came back.
     *
     * Targeted at THIS origin, so the message is deliverable only to an NPC
     * page — the provider's window, wherever it went, cannot receive it. The
     * payload is a bare type with no status, no session id and no outcome,
     * because the listener's only permitted response is to re-read what the
     * server already knows. There is deliberately no field that could carry a
     * verdict, so there is nothing for a future edit to start trusting.
     */
    try { opener.postMessage(RETURN_NOTICE, window.location.origin); } catch { /* gone */ }
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            NPC Identity Verification
          </div>
          <CardTitle>Verification received</CardTitle>
          <CardDescription>
            Thank you. Your identity check has been securely received and is being reviewed.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/*
            The tick is paired with words, and the words are "received" — never
            "verified". Nothing on this page knows the outcome, and a customer
            who reads a green tick as a pass has been told something we cannot
            support.
          */}
          <p className="flex items-start gap-2 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            <span>Your information has been received.</span>
          </p>
          <p className="text-sm text-muted-foreground">
            You do not need to repeat this process unless we ask you to. You can close this
            window and return to Identity &amp; Compliance.
          </p>

          {canSelfClose ? (
            <div className="space-y-2">
              <Button className="w-full" onClick={() => window.close()}>
                Close this window
              </Button>
              <p className="text-xs text-muted-foreground">
                Your NPC session is still open in the window behind this one.
              </p>
            </div>
          ) : (
            <Button asChild className="w-full">
              <Link to="/client/aml">
                Return to Identity &amp; Compliance <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
