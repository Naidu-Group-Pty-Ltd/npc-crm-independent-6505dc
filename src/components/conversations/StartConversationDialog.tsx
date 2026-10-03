/**
 * Opening a conversation with a client, on a deployment with no CRM vendor.
 *
 * Until this existed, a native thread was born only when a client texted in:
 * the inbound webhook was the one writer of `ghl_conversations`, so staff could
 * reply and could never speak first. The server decides everything that
 * matters — whether the caller may reach this client, which channels the
 * record can carry, and whether a thread already exists — and this dialog
 * renders its answer, including its refusal, in the server's own words.
 *
 * The act itself is `openClientConversation`, which a client's Conversations
 * tab calls directly; this is the picker the Conversations page puts in front
 * of it, so the cascaded page changes by a button and nothing more.
 */
import { useState } from "react";
import { Loader2, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClientSearchSelect } from "@/components/ui/ClientSearchSelect";
import {
  openClientConversation,
  type OpenedConversation,
} from "@/lib/crm/openClientConversation";

interface StartConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the thread to show, whether it was found or created. */
  onOpened: (conversation: OpenedConversation, created: boolean) => void;
}

export function StartConversationDialog({
  open,
  onOpenChange,
  onOpened,
}: StartConversationDialogProps) {
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const reset = () => {
    setClientId(null);
    setClientName(null);
    setRefusal(null);
    setPending(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleOpen = async () => {
    if (!clientId) return;
    setPending(true);
    setRefusal(null);
    try {
      const { conversation, created } = await openClientConversation(clientId);
      reset();
      onOpened(conversation, created);
      onOpenChange(false);
    } catch (err) {
      setRefusal(err instanceof Error ? err.message : "The conversation could not be opened.");
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>
            Choose a client. If they already have a conversation, it opens
            instead of starting a second one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <ClientSearchSelect
            value={clientId}
            onValueChange={(value, name) => {
              setClientId(value);
              setClientName(name ?? null);
              setRefusal(null);
            }}
            placeholder="Search clients…"
            allowNone={false}
            className="w-full"
          />
          {refusal && (
            <p role="alert" className="text-sm text-destructive">
              {refusal}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleOpen} disabled={!clientId || pending}>
            {pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <MessageSquarePlus className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {clientName ? `Message ${clientName}` : "Open conversation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
