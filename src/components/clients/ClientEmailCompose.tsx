/**
 * The client email composer.
 *
 * ## Two things it got wrong, both structural
 *
 * **The From field was not a chooser.** It listed whatever the browser could
 * see — the signed-in user's `personal_mailbox`, plus a hardcoded row reading
 * "Organisation shared mailbox" where an address belongs — because the shared
 * mailbox's address is a server secret. So the one line that says which account
 * a client's report leaves from could not say it. `useSenderMailboxes` asks
 * `send-email-reply`, the function that resolves and validates the sender, so
 * the list is exactly what will be accepted and each row carries a name and an
 * address.
 *
 * **The dialog had no scroll boundary.** `DialogContent` is `max-h-[85dvh]` and
 * `sm:overflow-visible` above the mobile breakpoint, so a taller body did not
 * scroll — it overflowed the viewport, taking Send Email with it. Expanding
 * Cc/Bcc adds two fields and did exactly that on a 768px-tall laptop. The
 * dialog is now a flex column: header and footer fixed, the fields between them
 * the only thing that scrolls, so Send is reachable in every state.
 */
import { useState, useEffect } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Mail, 
  Loader2, 
  Paperclip, 
  X, 
  ChevronDown, 
  ChevronUp,
  Send
} from 'lucide-react';
import { toast } from 'sonner';
import { fileToBase64, secureStorageDownload } from '@/hooks/useSecureStorage';
import { useSenderMailboxes } from '@/hooks/useSenderMailboxes';

interface ClientEmailComposeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  /**
   * Who this particular email is for, when that is not the client.
   *
   * Audit item 12 — "Send to Finance → Compose Email with PDF" opened this
   * dialog addressed to the customer, because `clientEmail` was the only
   * address it had ever been given. A finance send now names its recipient;
   * everything else omits it and keeps the client defaults unchanged.
   */
  recipient?: { name: string; email: string } | null;
  attachments?: Array<{
    id: string;
    file_name: string;
    file_path: string;
    file_size?: number | null;
    is_formara_form?: boolean;
  }>;
  preSelectedAttachmentId?: string;
  defaultSubject?: string;
  defaultBody?: string;
  inlineAttachment?: { blob: Blob; fileName: string } | null;
}

export function ClientEmailCompose({
  open,
  onOpenChange,
  clientId,
  clientName,
  clientEmail,
  recipient = null,
  attachments = [],
  preSelectedAttachmentId,
  defaultSubject,
  defaultBody,
  inlineAttachment = null
}: ClientEmailComposeProps) {
  const [to, setTo] = useState(recipient?.email || clientEmail || '');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [selectedMailbox, setSelectedMailbox] = useState<string>('');
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([]);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // The identities this person may send as, from the function that enforces it.
  // Choosing one here does not grant it: `send-email-reply` re-checks every send.
  const {
    mailboxes,
    defaultMailbox,
    isLoading: isLoadingMailboxes,
    error: mailboxesError,
    refetch: refetchMailboxes,
  } = useSenderMailboxes(open);

  // Set defaults when modal opens
  useEffect(() => {
    if (open) {
      setTo(recipient?.email || clientEmail || '');
      // Use provided defaults or fallback to a template addressed to whoever
      // this email is actually for. The client wording said "your updated
      // portfolio", which is wrong in both directions when the reader is the
      // finance partner: it is not their portfolio, and it does not say whose.
      setSubject(
        defaultSubject
          || (recipient
            ? `Client details - ${clientName}`
            : `Portfolio Update - ${clientName}`),
      );
      setBody(
        defaultBody
          || (recipient
            ? `Dear ${recipient.name.split(' ')[0]},\n\nPlease find attached the client details for ${clientName}.\n\nKind regards`
            : `Dear ${clientName.split(' ')[0]},\n\nPlease find attached your updated portfolio documentation.\n\nKind regards`),
      );
      
      // Pre-select attachment if specified
      if (preSelectedAttachmentId) {
        setSelectedAttachments([preSelectedAttachmentId]);
      }
      
      // Preselect the default sender once the list arrives, without overwriting
      // a choice already made — the query can settle after the dialog opens.
      if (defaultMailbox && !selectedMailbox) {
        setSelectedMailbox(defaultMailbox.id);
      }
    }
  }, [open, clientEmail, clientName, recipient, preSelectedAttachmentId, defaultMailbox, selectedMailbox, defaultSubject, defaultBody]);

  const toggleAttachment = (attachmentId: string) => {
    setSelectedAttachments(prev => 
      prev.includes(attachmentId) 
        ? prev.filter(id => id !== attachmentId)
        : [...prev, attachmentId]
    );
  };

  const handleSend = async () => {
    if (!to.trim()) {
      toast.error('Please enter a recipient email');
      return;
    }
    if (!selectedMailbox) {
      toast.error('Please select a sender mailbox');
      return;
    }
    if (!subject.trim()) {
      toast.error('Please enter a subject');
      return;
    }

    const sender = mailboxes.find((mailbox) => mailbox.id === selectedMailbox);
    if (!sender) {
      toast.error('Please select a valid sender mailbox');
      return;
    }

    setIsSending(true);

    try {
      // Read attachments through the authenticated storage proxy. The email
      // function expects file content, not a user-visible signed URL.
      const attachmentData = await Promise.all(
        selectedAttachments.map(async (attachmentId) => {
          const attachment = attachments.find(a => a.id === attachmentId);
          if (!attachment) return null;

          const result = await secureStorageDownload('client-documents', attachment.file_path);
          if (!result.success || !result.content) {
            throw new Error(`Unable to attach ${attachment.file_name}`);
          }

          return {
            name: attachment.file_name,
            contentType: 'application/pdf',
            contentBytes: result.content,
          };
        })
      );

      const validAttachments = attachmentData.filter(Boolean);
      if (inlineAttachment) {
        const contentBytes = await fileToBase64(inlineAttachment.blob);
        validAttachments.push({
          name: inlineAttachment.fileName,
          contentType: 'application/pdf',
          contentBytes,
        });
      }

      // Parse CC and BCC emails
      const ccEmails = cc.split(',').map(e => e.trim()).filter(Boolean);
      const bccEmails = bcc.split(',').map(e => e.trim()).filter(Boolean);

      const { data, error } = await invokeSecureFunction('send-email-reply', {
        to: to.trim(),
        cc: ccEmails,
        bcc: bccEmails,
        subject: subject.trim(),
        body: body,
        senderMailboxId: sender.source === 'personal' ? sender.id : undefined,
        mailboxSource: sender.source,
        attachments: validAttachments,
        clientId,
      });

      if (error) throw error;

      toast.success('Email sent successfully');
      onOpenChange(false);
      
      // Reset form
      setTo('');
      setCc('');
      setBcc('');
      setSubject('');
      setBody('');
      setSelectedAttachments([]);
      setShowCcBcc(false);

    } catch (error: any) {
      console.error('Send email error:', error);
      toast.error('Failed to send email: ' + error.message);
    } finally {
      setIsSending(false);
    }
  };

  const formatFileSize = (bytes: number | null | undefined) => {
    if (!bytes) return '';
    const kb = bytes / 1024;
    return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(0)} KB`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Flex column with a hard ceiling, so the composer is bounded by the
        viewport rather than by how many fields happen to be open. `gap-0`/`p-0`
        drop the shared grid spacing — the three regions carry their own padding
        so the scroll boundary sits exactly between header and footer.
      */}
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 p-0 sm:max-h-[85dvh] sm:max-w-2xl sm:p-0">
        <DialogHeader className="shrink-0 space-y-1.5 border-b border-border/60 p-4 sm:p-6">
          <DialogTitle className="flex items-center gap-2 pr-8 text-left">
            <Mail className="h-5 w-5" />
            Compose Email
          </DialogTitle>
          <DialogDescription className="text-left">
            {recipient
              ? `Send an email to ${recipient.name} about ${clientName}`
              : `Send an email to ${clientName}`}
          </DialogDescription>
        </DialogHeader>

        {/* The only region that scrolls. `min-h-0` is what lets it: a flex child
            defaults to min-height:auto and would push the footer off instead. */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
          {/* Sender */}
          <div className="space-y-2">
            <Label htmlFor="client-email-sender">From</Label>
            <Select value={selectedMailbox} onValueChange={setSelectedMailbox} disabled={isLoadingMailboxes || mailboxes.length === 0}>
              <SelectTrigger id="client-email-sender" aria-label="Sender mailbox" className="h-auto w-full py-2">
                <SelectValue placeholder={isLoadingMailboxes ? 'Loading available sending accounts…' : mailboxes.length === 0 ? 'No sender mailbox available' : 'Select sender mailbox'} />
              </SelectTrigger>
              <SelectContent className="z-[100]" position="popper">
                {/* Name over address, for both kinds: which account this email
                    leaves from is the question the field exists to answer. */}
                {mailboxes.map((mailbox) => (
                  <SelectItem key={mailbox.id} value={mailbox.id}>
                    <span className="flex min-w-0 flex-col text-left">
                      <span className="truncate">{mailbox.displayName}</span>
                      <span className="truncate text-xs text-muted-foreground">{mailbox.emailAddress}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mailboxesError && (
              <div className="flex items-center justify-between gap-2 text-xs text-destructive" role="alert">
                <span>Unable to retrieve authorised sending accounts.</span>
                <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => refetchMailboxes()}>Retry</Button>
              </div>
            )}
            {!isLoadingMailboxes && !mailboxesError && mailboxes.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No sender mailbox is available for your account. Ask an administrator to connect one in Settings.
              </p>
            )}
          </div>

          {/* Recipient */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>To</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowCcBcc(!showCcBcc)}
                aria-expanded={showCcBcc}
                aria-controls="client-email-ccbcc"
                className="h-auto py-0 px-1 text-xs text-muted-foreground"
              >
                {showCcBcc ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                Cc/Bcc
              </Button>
            </div>
            <Input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@email.com"
            />
          </div>

          {/* CC/BCC fields. They add height to the scroll region and nothing
              else — the footer is outside it, so nothing moves off screen. */}
          {showCcBcc && (
            <div id="client-email-ccbcc" className="space-y-4">
              <div className="space-y-2">
                <Label>Cc</Label>
                <Input
                  type="text"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="cc@email.com, another@email.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Bcc</Label>
                <Input
                  type="text"
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  placeholder="bcc@email.com"
                />
              </div>
            </div>
          )}

          {/* Subject */}
          <div className="space-y-2">
            <Label>Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject"
            />
          </div>

          {/* Body */}
          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message..."
              rows={6}
            />
          </div>

          {inlineAttachment && (
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <span className="flex items-center gap-2 min-w-0"><Paperclip className="h-4 w-4 shrink-0" /> <span className="truncate">{inlineAttachment.fileName}</span></span>
              <Badge variant="secondary">{formatFileSize(inlineAttachment.blob.size)}</Badge>
            </div>
          )}

          {/* Attachments */}
          {attachments.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Paperclip className="h-4 w-4" />
                  Attachments
                </Label>
                <div className="flex flex-wrap gap-2">
                  {attachments.map((attachment) => (
                    <Badge
                      key={attachment.id}
                      variant={selectedAttachments.includes(attachment.id) ? 'default' : 'outline'}
                      className="cursor-pointer transition-colors"
                      onClick={() => toggleAttachment(attachment.id)}
                    >
                      {attachment.is_formara_form && (
                        <span className="text-xs mr-1">📊</span>
                      )}
                      {attachment.file_name}
                      {attachment.file_size && (
                        <span className="text-xs opacity-70 ml-1">
                          ({formatFileSize(attachment.file_size)})
                        </span>
                      )}
                      {selectedAttachments.includes(attachment.id) && (
                        <X className="h-3 w-3 ml-1" />
                      )}
                    </Badge>
                  ))}
                </div>
                {selectedAttachments.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {selectedAttachments.length} file(s) will be attached
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Fixed: Send Email is reachable whatever the body's height, which is
            the property the Cc/Bcc expansion used to break. */}
        <DialogFooter className="shrink-0 gap-2 border-t border-border/60 p-4 sm:p-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={isSending}>
            {isSending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send Email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
