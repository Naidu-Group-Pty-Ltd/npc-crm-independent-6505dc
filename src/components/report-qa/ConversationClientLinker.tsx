import { useEffect, useState } from 'react';
import { ClientSearchSelect } from '@/components/ui/ClientSearchSelect';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useToast } from '@/hooks/use-toast';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { UserCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConversationClientLinkerProps {
  conversationId: string | null;
  /** Current linked client_id from the parent's conversation record. */
  initialClientId?: string | null;
  /** Optional callback so parent state stays in sync after a change. */
  onClientChange?: (clientId: string | null) => void;
  className?: string;
}

/**
 * Compact widget that lets the advisor link the current Report Q&A
 * conversation to a client so the agent picks up that client's durable
 * memory (goals, risk profile, decisions) automatically.
 *
 * Client linkage is optional — free-floating threads remain supported.
 */
export function ConversationClientLinker({
  conversationId,
  initialClientId = null,
  onClientChange,
  className,
}: ConversationClientLinkerProps) {
  const [clientId, setClientId] = useState<string | null>(initialClientId);
  const [clientName, setClientName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => { setClientId(initialClientId ?? null); }, [initialClientId, conversationId]);

  const handleChange = async (newId: string | null, newName?: string) => {
    if (!conversationId) {
      toast({ title: 'Start a conversation first', description: 'Send a message before linking a client.' });
      return;
    }
    setLoading(true);
    try {
      const { error } = await invokeSecureFunction('report-qa', {
        action: 'update-conversation',
        conversationId,
        clientId: newId,
      });
      if (error) throw error;
      setClientId(newId);
      setClientName(newName ?? null);
      onClientChange?.(newId);
      toast({
        title: newId ? 'Client linked' : 'Client unlinked',
        description: newId
          ? 'The agent will now use this client\'s saved context.'
          : 'This thread is no longer linked to a client.',
      });
      setOpen(false);
    } catch (e: any) {
      toast({ title: 'Failed to update client link', description: e?.message || 'Try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const label = clientId ? (clientName || 'Linked to client') : 'Link client';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={loading || !conversationId}
          className={cn('report-qa-toolbar-control h-8 gap-2 px-3 text-xs font-medium', clientId && 'border-primary/40 text-primary', className)}
          data-active={clientId ? 'true' : undefined}
          title={conversationId ? (clientId ? 'Linked client — click to change' : 'Link this thread to a client') : 'Start a conversation first'}
        >
          <UserCircle2 className="h-3.5 w-3.5" />
          <span className="truncate max-w-[140px]">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-3">
        <p className="text-xs text-muted-foreground mb-2">
          Linking a client lets the agent remember their goals, risk profile and prior decisions across threads.
        </p>
        <ClientSearchSelect
          value={clientId}
          onValueChange={handleChange}
          placeholder="Search clients..."
          allowNone
        />
      </PopoverContent>
    </Popover>
  );
}
