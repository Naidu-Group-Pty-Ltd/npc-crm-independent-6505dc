import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info, Loader2, Mail, Phone, Send } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { PropertyListing } from '@/lib/airtable';
import { describeContactSource, listingContact } from '@/lib/listingContact';
import { displayPrice, formatArea, formatLocality } from '@/lib/listingDisplay';

interface SenderMailbox {
  id: string;
  emailAddress: string;
  displayName: string;
  source: 'personal' | 'admin';
}

export interface EmailAgentDialogProps {
  listing: PropertyListing | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Enquire about a property without leaving the listing.
 *
 * The alternative was a `mailto:` link, which is a worse answer here for two
 * reasons: it depends on the reader having a desktop mail client configured,
 * and — more importantly — it sends from wherever that client is signed in,
 * leaving no record on the platform. Routing through `send-email-reply` puts the
 * message in the same outbound path as every other email the app sends, from the
 * user's own connected mailbox or the organisation's.
 *
 * The draft is pre-written because the point is to remove the friction between
 * seeing a property and asking about it. It is left fully editable because a
 * generated enquiry that goes out unread is how an agent learns to ignore you.
 */
export function EmailAgentDialog({ listing, open, onOpenChange }: EmailAgentDialogProps) {
  const { user } = useAuth();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [selectedMailbox, setSelectedMailbox] = useState('');
  const [isSending, setIsSending] = useState(false);

  const contact = useMemo(() => (listing ? listingContact(listing) : null), [listing]);
  const sourceNote = describeContactSource(contact?.emailSource ?? null);

  const { data: mailboxes = [], isLoading: loadingMailboxes } = useQuery<SenderMailbox[]>({
    queryKey: ['mailboxes-for-email', user?.id],
    enabled: open && Boolean(user?.id),
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('custom_users')
        .select('id, email, personal_mailbox')
        .eq('id', user.id)
        .not('personal_mailbox', 'is', null)
        .maybeSingle();
      if (error) throw error;

      const available: SenderMailbox[] = [];
      const personal = data?.personal_mailbox?.trim();
      if (personal) {
        available.push({
          id: user.id,
          emailAddress: personal,
          displayName: data?.email || personal,
          source: 'personal',
        });
      }
      // The server stays the permission authority and rejects an unauthorised
      // shared-mailbox send; offering it here does not grant it.
      available.push({
        id: 'admin',
        emailAddress: 'Organisation shared mailbox',
        displayName: 'Organisation shared mailbox',
        source: 'admin',
      });
      return available;
    },
  });

  useEffect(() => {
    if (!open || !listing) return;
    setTo(contact?.email ?? '');
    setSubject(buildSubject(listing));
    setBody(buildBody(listing, contact?.name ?? null));
  }, [open, listing, contact]);

  useEffect(() => {
    if (mailboxes.length > 0 && !selectedMailbox) setSelectedMailbox(mailboxes[0].id);
  }, [mailboxes, selectedMailbox]);

  const send = async () => {
    const sender = mailboxes.find((mailbox) => mailbox.id === selectedMailbox);
    if (!sender) {
      toast.error('Choose which mailbox to send from');
      return;
    }
    if (!to.trim()) {
      toast.error('Add a recipient');
      return;
    }

    setIsSending(true);
    try {
      const { error } = await invokeSecureFunction('send-email-reply', {
        to: to.trim(),
        subject: subject.trim(),
        body,
        senderMailboxId: sender.source === 'personal' ? sender.id : undefined,
        mailboxSource: sender.source,
      });
      if (error) throw error;
      toast.success(`Enquiry sent to ${to.trim()}`);
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Could not send the enquiry: ${message}`);
    } finally {
      setIsSending(false);
    }
  };

  if (!listing) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
            Email the agent
          </DialogTitle>
          <DialogDescription>
            {listing.address ?? listing.fullAddress ?? 'This listing'}
            {formatLocality(listing) ? ` · ${formatLocality(listing)}` : ''}
          </DialogDescription>
        </DialogHeader>

        {/*
          No address, no action. 990 of 1,441 records are in this state, so this
          is a common path and it says what would fix it rather than just
          disabling a button.
        */}
        {!contact?.email ? (
          <div className="space-y-3 rounded-xl border border-dashed border-border/70 p-4 text-sm">
            <p className="font-medium text-foreground">
              This listing did not arrive with a contact address.
            </p>
            <p className="text-muted-foreground">
              The enrichment pass looks for one on the agency&rsquo;s listing page; if it finds an
              address it will appear here without anything else needing to change.
            </p>
            {contact?.phone && (
              <p className="flex items-center gap-1.5 text-foreground">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <a className="font-medium underline-offset-2 hover:underline" href={`tel:${contact.phone.replace(/\s/g, '')}`}>
                  {contact.phone}
                </a>
                <span className="text-muted-foreground">is on record</span>
              </p>
            )}
            {listing.url && (
              <Button asChild size="sm" variant="outline">
                <a href={listing.url} target="_blank" rel="noopener noreferrer">
                  Open the source listing
                </a>
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="agent-email-from">From</Label>
                <Select value={selectedMailbox} onValueChange={setSelectedMailbox}>
                  <SelectTrigger id="agent-email-from" aria-label="Sender mailbox">
                    <SelectValue
                      placeholder={loadingMailboxes ? 'Loading mailboxes…' : 'Select a mailbox'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {mailboxes.map((mailbox) => (
                      <SelectItem key={mailbox.id} value={mailbox.id}>
                        {mailbox.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="agent-email-to">To</Label>
                <Input
                  id="agent-email-to"
                  type="email"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </div>
            </div>

            {/* Where the address came from, when it was not the agent's own. */}
            {sourceNote && (
              <p className="flex items-start gap-1.5 rounded-lg border border-border/60 bg-muted/30 p-2.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {sourceNote}
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="agent-email-subject">Subject</Label>
              <Input
                id="agent-email-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="agent-email-body">Message</Label>
              <Textarea
                id="agent-email-body"
                rows={11}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="resize-y font-normal"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {contact.name && <Badge variant="outline">{contact.name}</Badge>}
              {contact.agency && <Badge variant="outline">{contact.agency}</Badge>}
              {contact.phone && (
                <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                  <a href={`tel:${contact.phone.replace(/\s/g, '')}`}>
                    <Phone className="mr-1 h-3 w-3" aria-hidden="true" />
                    {contact.phone}
                  </a>
                </Button>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {contact?.email && (
            <Button onClick={send} disabled={isSending || !selectedMailbox}>
              {isSending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:hidden" aria-hidden="true" />
              ) : (
                <Send className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              Send enquiry
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* The draft                                                                   */
/* -------------------------------------------------------------------------- */

function buildSubject(listing: PropertyListing): string {
  const where = listing.address ?? listing.fullAddress ?? listing.suburb ?? 'your listing';
  return `Enquiry — ${where}`;
}

/**
 * A short, specific enquiry.
 *
 * It quotes the property back so the agent knows which of their listings this
 * is about without opening anything, and it asks for exactly what the record is
 * missing — there is no point asking for a price the email already stated, and
 * an enquiry that asks for everything reads as a form letter.
 */
function buildBody(listing: PropertyListing, agentName: string | null): string {
  const greeting = agentName ? `Hi ${agentName.split(' ')[0]},` : 'Hello,';
  const where = [listing.address, listing.suburb].filter(Boolean).join(', ') || 'the property below';
  const price = displayPrice(listing);

  const facts: string[] = [];
  if (price.known) facts.push(`Listed at ${price.text}`);
  const specs = [
    listing.beds ? `${listing.beds} bed` : null,
    listing.baths ? `${listing.baths} bath` : null,
    listing.carSpaces ? `${listing.carSpaces} car` : null,
    formatArea(listing.landSizeSqm),
  ].filter(Boolean);
  if (specs.length > 0) facts.push(specs.join(' · '));
  if (listing.url) facts.push(listing.url);

  // Only ask about what is actually unknown.
  const asks: string[] = [];
  if (!price.known) asks.push('the current price guide');
  if (!listing.beds && !listing.baths) asks.push('the bedroom and bathroom configuration');
  if (!listing.landSizeSqm) asks.push('the land size');
  if (!listing.inspectionStart && !listing.nextInspectionDate) asks.push('upcoming inspection times');
  const question =
    asks.length > 0
      ? `Could you please confirm ${joinList(asks)}?`
      : 'Could you let me know whether it is still available, and send through the contract and any recent comparable sales?';

  return [
    greeting,
    '',
    `I'm enquiring about ${where}.`,
    facts.length > 0 ? '' : null,
    ...facts.map((fact) => `  ${fact}`),
    '',
    question,
    '',
    "I'd also appreciate anything you can share on the vendor's position and preferred settlement.",
    '',
    'Thanks,',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

function joinList(items: string[]): string {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export default EmailAgentDialog;
