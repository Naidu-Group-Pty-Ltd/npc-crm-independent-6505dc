/**
 * Request client information — the composer the Passport opens.
 *
 * It does not start blank. The system already knows what is missing, so the
 * operator picks an outstanding item and gets a prepared request: the right
 * action code, the right destination, and a client-safe message they can edit
 * before it goes.
 *
 * Two things this must never do, and both are why the message is a plain
 * textarea over a derived default rather than anything generated here:
 *
 *  - it must not send an internal reason. The message reaches the client
 *    verbatim, so "address evidence insufficient for medium-risk CDD" is a
 *    disclosure of the risk band. The defaults are written in the client's
 *    words and the operator can only make them more plain, never less.
 *  - it must not invent a request type. Every send goes through
 *    `create_client_request` with an action code from the shared contract; an
 *    unrecognised code is dropped server-side, so a typo here cannot produce a
 *    request the portal has no button for.
 */
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { amlCasesApi } from "@/lib/aml/amlCasesApi";
import type { PassportView } from "@/lib/aml/passport";
import {
  deriveOutstandingItems, type OutstandingItem,
} from "@/lib/aml/passport/outstandingItems.pure";
import {
  CLIENT_ACTIONS, CLIENT_ACTION_CODES, kindForAction,
  type ClientActionCode,
} from "../../../../../supabase/functions/_shared/aml/clientRequestContract.pure";
import { SectionTitle, TonePill } from "./primitives";

export function RequestClientInformationDialog({
  caseId, view, onClose, onSent,
}: {
  caseId: string;
  view: PassportView;
  onClose: () => void;
  onSent: () => void;
}) {
  const items = useMemo(() => deriveOutstandingItems(view).filter((i) => i.request), [view]);

  const [picked, setPicked] = useState<OutstandingItem | null>(items[0] ?? null);
  const [action, setAction] = useState<ClientActionCode>(
    items[0]?.request?.action ?? "provide_clarification",
  );
  const [subject, setSubject] = useState(items[0]?.request?.subject ?? "");
  const [message, setMessage] = useState(items[0]?.request?.message ?? "");
  const [sending, setSending] = useState(false);

  function choose(item: OutstandingItem) {
    setPicked(item);
    if (!item.request) return;
    setAction(item.request.action);
    setSubject(item.request.subject);
    setMessage(item.request.message);
  }

  function chooseBlank(code: ClientActionCode) {
    setPicked(null);
    setAction(code);
    setSubject("");
    setMessage("");
  }

  async function send() {
    if (!subject.trim() || !message.trim()) return;
    setSending(true);
    try {
      await amlCasesApi.createClientRequest({
        case_id: caseId,
        kind: kindForAction(action),
        subject: subject.trim(),
        message: message.trim(),
        action_code: action,
        action_target: picked?.request?.target ?? undefined,
      });
      toast({
        title: "Request sent",
        description:
          "The client sees it as an action on their portal, and it appears on the case with the same status.",
      });
      onSent();
      onClose();
    } catch (e: unknown) {
      toast({
        title: "The request was not sent",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="passport-scope max-h-[86vh] max-w-2xl overflow-y-auto p-0">
        <DialogTitle className="sr-only">Request information from the client</DialogTitle>
        <div className="space-y-5 p-6">
          <div>
            <div className="passport-kicker">Ask the client</div>
            <h2 className="passport-display mt-1 text-lg font-semibold">Request client information</h2>
          </div>

          {items.length > 0 && (
            <div>
              <SectionTitle>Outstanding compliance items</SectionTitle>
              <ul className="space-y-2">
                {items.map((i) => (
                  <li key={i.key}>
                    <button
                      type="button"
                      onClick={() => choose(i)}
                      aria-pressed={picked?.key === i.key}
                      className={
                        "passport-card w-full p-3 text-left" +
                        (picked?.key === i.key ? " passport-card--pending" : "")
                      }
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="passport-dim text-[13px] font-semibold">{i.title}</span>
                        <TonePill tone="warn" className="text-[10.5px]">Request from client</TonePill>
                      </div>
                      <span className="passport-faint mt-1 block text-[11px]">{i.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <SectionTitle>{items.length > 0 ? "Or ask for something else" : "What do you need?"}</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {CLIENT_ACTION_CODES.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => chooseBlank(code)}
                  aria-pressed={picked === null && action === code}
                  className={
                    "passport-action w-auto" +
                    (picked === null && action === code ? " passport-action--primary" : "")
                  }
                >
                  {CLIENT_ACTIONS[code].operatorLabel}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <SectionTitle>What the client will see</SectionTitle>
            <label className="block">
              <span className="passport-field__k">Subject</span>
              <input
                className="passport-card mt-1 w-full p-2 text-[13px]"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="What you need, in one line"
              />
            </label>
            <label className="block">
              <span className="passport-field__k">Message</span>
              <textarea
                className="passport-card mt-1 w-full p-2 text-[13px]"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Plain English. The client reads this exactly as written."
              />
            </label>
            <p className="passport-faint text-[11px] leading-relaxed">
              This message is sent to the client word for word. Keep it to what you need and why it
              helps — never an internal reason, a risk assessment or a screening finding. The client
              is taken straight to{" "}
              <span className="passport-dim">{CLIENT_ACTIONS[action].label}</span>.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" className="passport-action w-auto" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="passport-action passport-action--primary w-auto"
              disabled={sending || !subject.trim() || !message.trim()}
              aria-disabled={sending || !subject.trim() || !message.trim()}
              onClick={() => void send()}
            >
              {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              {sending ? "Sending…" : "Send request"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
