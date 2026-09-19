import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Check, Copy, ExternalLink, KeyRound, MailCheck } from "lucide-react";

/**
 * The one-time Passport link, at the one moment it exists.
 *
 * ── The defect this replaces ──────────────────────────────────────────
 * This was a `usePromptDialog` call with a single textarea field, and the
 * link was passed as that field's `placeholder` and `helpText`. `prompt()`
 * initialises every field to the empty string, so the box a reader saw as
 * "the link" held nothing at all: placeholder text cannot be selected, cannot
 * be copied, and is not in the DOM as a value. Reported, exactly, as "the
 * one-time link copy, but there is nothing in there".
 *
 * That is worse than an empty box. The token is stored only as a SHA-256
 * hash, so this dialog is the only moment the credential exists anywhere
 * outside the partner's inbox. If the email did not send — which the server
 * reports and which happens whenever mail is misconfigured — the link shown
 * here was the sole remaining copy, and it was uncopyable.
 *
 * ── What this is ─────────────────────────────────────────────────────
 * A read-only field holding the actual link as its VALUE, a copy button that
 * confirms it copied, and a delivery line that states what became of the
 * email rather than assuming it went. Nothing here mints, revokes or decides
 * anything: it is the presentation of a result the server has already
 * returned.
 */
export interface PassportIssueResult {
  partnerName: string;
  recipientEmail: string;
  passportLink: string;
  expiresAt: string;
  /** null when no delivery was requested. */
  emailSent: boolean | null;
  emailError: string | null;
}

export function PassportIssuedDialog({
  result, onClose,
}: {
  result: PassportIssueResult | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => { setCopied(false); }, [result?.passportLink]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result?.passportLink ?? "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* Clipboard access can be refused outright — an insecure origin, a
         permissions policy, a browser that has never granted it. The field is
         read-only rather than disabled precisely so that selecting and copying
         by hand still works when this does not. */
      const field = document.getElementById("passport-issued-link") as HTMLInputElement | null;
      field?.focus();
      field?.select();
    }
  };

  const delivered = result?.emailSent === true;

  return (
    <Dialog open={Boolean(result)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        {result && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" aria-hidden />
                Passport issued to {result.partnerName}
              </DialogTitle>
              <DialogDescription>
                The link opens without a portal account and expires{" "}
                {new Date(result.expiresAt).toLocaleDateString('en-AU')}. It is shown here once — only its
                hash is stored, so it cannot be read again.
              </DialogDescription>
            </DialogHeader>

            {/* Delivery, stated rather than assumed. */}
            <div
              className={
                delivered
                  ? "flex items-start gap-2 rounded-md border border-success/40 bg-success/5 p-3"
                  : "flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3"
              }
            >
              {delivered
                ? <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />}
              <p className="text-xs">
                {delivered ? (
                  <>Emailed to <span className="font-medium">{result.recipientEmail}</span>.</>
                ) : result.emailSent === false ? (
                  <>
                    The email to <span className="font-medium">{result.recipientEmail}</span> did not
                    send{result.emailError ? ` (${result.emailError})` : ""}. Copy the link below and
                    send it yourself — this is the only copy.
                  </>
                ) : (
                  <>No email was requested. Copy the link below and deliver it yourself.</>
                )}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="passport-issued-link" className="text-xs">
                One-time Passport link
              </Label>
              <div className="flex gap-2">
                <Input
                  id="passport-issued-link"
                  readOnly
                  value={result.passportLink}
                  onFocus={(e) => e.currentTarget.select()}
                  className="font-mono text-xs"
                />
                <Button type="button" variant="outline" size="sm" className="shrink-0"
                  onClick={() => void copy()}>
                  {copied
                    ? <><Check className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copied</>
                    : <><Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copy</>}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                The link is itself the credential — anyone holding it can open the Passport, so keep
                it to authorised personnel.
              </p>
            </div>

            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button" variant="ghost" size="sm" asChild
              >
                <a href={result.passportLink} target="_blank" rel="noreferrer noopener">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Open it as the partner sees it
                </a>
              </Button>
              <Button type="button" onClick={onClose}>
                {delivered ? "Done" : "I have copied the link"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
