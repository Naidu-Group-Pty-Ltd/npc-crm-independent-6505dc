import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { KeyRound, LogIn, MailCheck, MailWarning, ShieldOff, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { SendPortalInviteDialog } from "@/components/portal/SendPortalInviteDialog";
import {
  deriveAmlPortalAccess,
  type AmlPortalAccessCode,
  type AmlPortalAccessFacts,
} from "@/lib/aml/portalAccessState";

/**
 * The hand-off from AML activation into the Client Portal.
 *
 * ── The seam this closes ──────────────────────────────────────────────
 * Activation and portal provisioning were both complete, and nothing joined
 * them. `activate_client` detects `has_portal_access === false` and returns
 * a sentence saying "send them a portal invitation" — with no way to send
 * one. `client-portal-invite` can provision in a single call, but its only
 * entry point was a button on the Clients page, in a different part of the
 * app, reached by remembering to go there.
 *
 * The result was measurable: AML-2026-00005 was activated, its portal
 * notification written to `/client/aml` at 15:41, and the client has no
 * `client_portal_users` row at all. The notification is sitting behind a
 * login the client cannot pass.
 *
 * ── Reuse, not reimplementation ───────────────────────────────────────
 * Issuing is handed to `SendPortalInviteDialog` — the component that already
 * owns status, send, resend, copy-link and revoke. This card decides
 * nothing: it renders a reading derived from server facts and opens that
 * dialog. `client_portal_users` carries `UNIQUE(client_id)`, so there is
 * only ever one account; a second issuing path here would be a second set of
 * semantics over a row the database already makes singular.
 */

const ICONS: Record<AmlPortalAccessCode, typeof KeyRound> = {
  unavailable: KeyRound,
  no_email: MailWarning,
  not_issued: UserPlus,
  invited: MailCheck,
  invitation_expired: MailWarning,
  issued_not_signed_in: LogIn,
  signed_in_terms_pending: LogIn,
  active: MailCheck,
  disabled: ShieldOff,
};

/** Tone by code — attention where the client is stuck, quiet where they are not. */
const TONE: Record<AmlPortalAccessCode, string> = {
  unavailable: "text-muted-foreground",
  no_email: "text-warning",
  not_issued: "text-warning",
  invited: "text-muted-foreground",
  invitation_expired: "text-warning",
  issued_not_signed_in: "text-muted-foreground",
  signed_in_terms_pending: "text-muted-foreground",
  active: "text-success",
  disabled: "text-warning",
};

export interface AmlPortalAccessCardProps {
  /** Server-read facts. `null` reads as "not available", never "not issued". */
  facts: AmlPortalAccessFacts | null;
  /** True while the read is still in flight. */
  loading?: boolean;
  clientId: string | null;
  clientName: string;
  /** Called after the dialog closes, so the reading can be refreshed. */
  onChanged?: () => void;
}

export function AmlPortalAccessCard({
  facts, loading, clientId, clientName, onChanged,
}: AmlPortalAccessCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const reading = deriveAmlPortalAccess(facts);
  const Icon = ICONS[reading.code];

  if (loading) {
    return (
      <div
        className="rounded-lg border border-border/60 bg-card/40 p-4"
        role="status"
        aria-label="Loading client portal access"
      >
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="mt-2.5 h-4 w-56" />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Client portal access
          </p>
          <p className="flex items-center gap-2 text-sm font-medium">
            <Icon aria-hidden="true" className={cn("h-4 w-4 shrink-0", TONE[reading.code])} />
            {reading.label}
          </p>
          <p className="max-w-prose text-xs text-muted-foreground">{reading.detail}</p>
          {reading.canSignIn && (
            <Badge variant="outline" className="mt-1 border-success/40 bg-success/10 text-success">
              Can sign in
            </Badge>
          )}
        </div>

        {/*
          The action is offered only where it is both possible and safe.
          There is none for a live account: the server's re-issue downgrades
          it and clears the client's acknowledgements, which belongs behind
          the client record's own dialog rather than beside a case.
        */}
        {reading.action !== "none" && clientId && (
          <Button
            type="button"
            size="sm"
            variant={reading.blocking ? "default" : "outline"}
            onClick={() => setDialogOpen(true)}
          >
            {reading.actionLabel}
          </Button>
        )}
      </div>

      {clientId && (
        <SendPortalInviteDialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            // The dialog can send, resend or revoke; whichever happened, the
            // reading on this card is now stale.
            if (!open) onChanged?.();
          }}
          clientId={clientId}
          clientName={clientName}
          clientEmail={facts?.email ?? ""}
        />
      )}
    </div>
  );
}
