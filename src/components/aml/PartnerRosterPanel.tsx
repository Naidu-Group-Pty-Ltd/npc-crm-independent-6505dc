import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertTriangle, ChevronDown, ChevronRight, Clock, Copy, Download, FileSignature,
  Loader2, MoreHorizontal, Send, ShieldOff, Unlink, UserPlus, Users,
} from "lucide-react";

import {
  partnerRoster, type RosterFacts, type RosterRow,
} from "@/lib/aml/passport/partnerRoster.pure";

/**
 * The partners on this matter — one row each, one next step each.
 *
 * ── What this replaces ────────────────────────────────────────────────
 * Four lists of the same three organisations: "Who holds this Passport",
 * "Written arrangements", "Compliance agreement — sent for acceptance" and
 * "Partner links". Between them they drew eleven amber badges spelled in
 * database vocabulary — `builder_developer`, `reliance`, `active`,
 * `classification incomplete`, `eligibility not recorded`, `no assessment` —
 * and not one of them said what to do next.
 *
 * ── How it reads now ──────────────────────────────────────────────────
 * One row per partner. The name, what they are, and the single act that is
 * owed. A badge appears only when something is actually unmet, and it says
 * what it stops rather than naming a column. Everything else — the
 * arrangement's detail, the acceptance, the links, withdrawal — is inside the
 * row, one click away, because it is reference material rather than a step.
 *
 * Nothing here decides anything: `partnerRoster` is arithmetic over records
 * the case already holds, and every act is an existing server operation that
 * re-checks its own preconditions and refuses on its own terms.
 */

const PASSPORT_STYLE: Record<RosterRow["passport"], { label: string; className: string }> = {
  live: { label: "live", className: "border-success/40 text-success" },
  expiring: { label: "expiring", className: "border-warning/40 text-warning" },
  undelivered: { label: "never emailed", className: "border-destructive/40 text-destructive" },
  lapsed: { label: "expired", className: "border-border text-muted-foreground" },
  withdrawn: { label: "withdrawn", className: "border-border text-muted-foreground" },
  none: { label: "not sent", className: "border-border text-muted-foreground" },
};

export interface RosterHandlers {
  onSend: (row: RosterRow) => void;
  onRevoke: (row: RosterRow) => void;
  onCopyEmail: (email: string) => void;
  onRecordAssessment: (agreementId: string) => void;
  onResendAgreement: (acknowledgementId: string) => void;
  onDownloadAgreement: (acknowledgementId: string) => void;
  onEndLink: (linkId: string) => void;
  onOnboard: () => void;
}

function PartnerRow({
  row, busy, spinning, handlers,
}: {
  row: RosterRow;
  busy: boolean;
  spinning: boolean;
  handlers: RosterHandlers;
}) {
  const [open, setOpen] = useState(false);
  const style = PASSPORT_STYLE[row.passport];
  const blocking = row.flags.filter((f) => f.severity === "blocking");
  const records = row.flags.filter((f) => f.severity === "record");

  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          {open
            ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-medium">{row.partnerName}</span>
              <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${style.className}`}>
                {style.label}
              </Badge>
              <span className="text-[11px] text-muted-foreground">{row.partnerTypeLabel}</span>
              {/* Only what is UNMET earns a chip. `active` and `reliance` are
                  how a healthy record looks, and colouring them like problems
                  is what made eleven badges unreadable. */}
              {blocking.map((f) => (
                <Badge key={f.code} variant="outline"
                  className="h-5 border-warning/40 px-1.5 text-[10px] text-warning">
                  {f.label}
                </Badge>
              ))}
              {records.length > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  · {records.length} record{records.length === 1 ? "" : "s"} to complete
                </span>
              )}
            </span>
            {/* The step, not the standing: what to do is more useful on the
                closed row than what the register says. */}
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {row.step.waiting && (
                <Clock className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden />
              )}
              {row.step.detail}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {row.step.actionable ? (
            <Button
              size="sm"
              variant={row.passport === "live" || row.passport === "expiring" ? "outline" : "default"}
              className="h-7 px-2.5 text-xs"
              onClick={() => handlers.onSend(row)}
              disabled={busy}
            >
              {spinning
                ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden />
                : <Send className="mr-1.5 h-3 w-3" aria-hidden />}
              {row.step.label}
            </Button>
          ) : (
            <span className="text-[11px] text-muted-foreground">{row.step.label}</span>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={busy}
                aria-label={`More actions for ${row.partnerName}`}>
                <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {row.lastDeliveredTo && (
                <DropdownMenuItem onSelect={() => handlers.onCopyEmail(row.lastDeliveredTo!)}>
                  <Copy className="mr-2 h-3.5 w-3.5" aria-hidden />
                  <span className="truncate">Copy {row.lastDeliveredTo}</span>
                </DropdownMenuItem>
              )}
              {/* A live link can still be replaced — a partner who lost the
                  email, or an address that changed. It is not a STEP (nothing
                  is owed), so it belongs here rather than as a button that
                  makes a settled row look unfinished. */}
              {row.canAct && (row.passport === "live" || row.passport === "expiring") && (
                <DropdownMenuItem onSelect={() => handlers.onSend(row)}>
                  <Send className="mr-2 h-3.5 w-3.5" aria-hidden />
                  Re-issue their link
                </DropdownMenuItem>
              )}
              {row.canAct && row.agreementId && (
                <DropdownMenuItem onSelect={() => handlers.onRecordAssessment(row.agreementId!)}>
                  <FileSignature className="mr-2 h-3.5 w-3.5" aria-hidden />
                  Record arrangement assessment
                </DropdownMenuItem>
              )}
              {row.acknowledgementState === "accepted" && row.acknowledgementId && (
                <DropdownMenuItem onSelect={() => handlers.onDownloadAgreement(row.acknowledgementId!)}>
                  <Download className="mr-2 h-3.5 w-3.5" aria-hidden />
                  Executed agreement
                </DropdownMenuItem>
              )}
              {row.canAct && row.acknowledgementId && row.acknowledgementState !== "accepted" && (
                <DropdownMenuItem onSelect={() => handlers.onResendAgreement(row.acknowledgementId!)}>
                  <Send className="mr-2 h-3.5 w-3.5" aria-hidden />
                  Re-send the agreement
                </DropdownMenuItem>
              )}
              {row.canAct && row.linkIds.length > 0 && (
                <DropdownMenuItem onSelect={() => handlers.onEndLink(row.linkIds[0])}>
                  <Unlink className="mr-2 h-3.5 w-3.5" aria-hidden />
                  End their link to this matter
                </DropdownMenuItem>
              )}
              {row.revokeGrantId && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => handlers.onRevoke(row)}
                  >
                    <ShieldOff className="mr-2 h-3.5 w-3.5" aria-hidden />
                    Withdraw access
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* The reference material, one click away. It is not a step, so it does
          not occupy the list until somebody asks for it. */}
      {open && (
        <dl className="grid gap-x-6 gap-y-1.5 border-t border-border/40 bg-muted/20 px-3 py-2.5 pl-8 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Passport</dt>
            <dd>{row.passportDetail}</dd>
          </div>
          {row.routeLabel && (
            <div>
              <dt className="text-muted-foreground">Legal route</dt>
              <dd>{row.routeLabel}</dd>
            </div>
          )}
          {row.acknowledgementState && (
            <div>
              <dt className="text-muted-foreground">Compliance agreement</dt>
              <dd>{row.acknowledgementState.replace(/_/g, " ")}</dd>
            </div>
          )}
          {row.flags.length > 0 && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Outstanding</dt>
              <dd>
                <ul className="mt-0.5 space-y-0.5">
                  {row.flags.map((f) => (
                    <li key={f.code} className="flex items-start gap-1.5">
                      <AlertTriangle
                        className={`mt-0.5 h-3 w-3 shrink-0 ${
                          f.severity === "blocking" ? "text-warning" : "text-muted-foreground"
                        }`}
                        aria-hidden
                      />
                      <span>
                        <span className="font-medium">{f.label}</span>
                        {f.consequence ? ` — ${f.consequence}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}

export function PartnerRosterPanel({
  facts, busyKey, handlers, workspaceEnabled,
}: {
  facts: RosterFacts;
  /** The row mid-act, so only its own button spins. */
  busyKey: string | null;
  handlers: RosterHandlers;
  /** null while unread — never rendered as "off" on a failed read. */
  workspaceEnabled: boolean | null;
}) {
  const reading = partnerRoster(facts);
  const busy = busyKey !== null;

  return (
    <section className="rounded-lg border border-border/60" aria-label="Partners on this matter">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/60 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Users className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="text-sm font-medium">Partners on this matter</span>
          <span className="truncate text-xs text-muted-foreground">{reading.headline}</span>
        </div>
        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs"
          onClick={handlers.onOnboard} disabled={busy}>
          <UserPlus className="mr-1.5 h-3 w-3" aria-hidden />
          Add a partner
        </Button>
      </header>

      {reading.rows.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">
          A Passport goes to an organisation with a written CDD arrangement (AML/CTF Act Pt 2
          Div 7). Adding a partner records the organisation, the arrangement and their reason
          for seeing this matter on the way through.
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {reading.rows.map((row) => (
            <PartnerRow
              key={row.key}
              row={row}
              busy={busy}
              spinning={busyKey === row.key}
              handlers={handlers}
            />
          ))}
        </ul>
      )}

      <footer className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
        {workspaceEnabled === true
          ? "Partners enrolled for their portal can also open this Passport signed in, from their own AML/CTF Compliance page. "
          : workspaceEnabled === false
            ? "The in-portal Compliance Passport is switched off on this deployment, so the emailed link is the only way a partner reaches this record. "
            : ""}
        Withdrawing access stops a partner&apos;s link immediately; the grant is kept as the record
        that it was issued.
      </footer>
    </section>
  );
}
