/**
 * Batch 7.1 Command Palette + Batch 13 #69 Global Search Upgrade.
 * Now searches purchase files, clients, notes/comments, messages and docs.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandSeparator,
} from '@/components/ui/command';
import {
  LayoutDashboard, Briefcase, Users, MessageSquare, Wallet, Plus, Eye, FileText, MessageCircle, StickyNote,
} from 'lucide-react';
import { smartCapitalize } from '@/lib/nameUtils';
import { useDebounce } from '@/hooks/useDebounce';

export function FinanceCommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const { invokeFinanceFunction, user } = useFinancePortalAuth();
  const isAuthenticated = !!user;
  const debouncedQuery = useDebounce(query, 220);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { data: filesData } = useQuery({
    queryKey: ['finance-cmd-files'],
    queryFn: async () => {
      const { data } = await invokeFinanceFunction('finance-portal-purchase-files', { operation: 'list_files' });
      return data?.files || [];
    },
    enabled: isAuthenticated && open,
    staleTime: 30_000,
  });

  const { data: clientsData } = useQuery({
    queryKey: ['finance-cmd-clients'],
    queryFn: async () => {
      const { data } = await invokeFinanceFunction('finance-portal-client-data', { operation: 'list_assigned_clients' });
      return data?.records || [];
    },
    enabled: isAuthenticated && open,
    staleTime: 30_000,
  });

  // Batch 13 #69 — Global search across notes, messages and docs.
  const { data: deepResults } = useQuery({
    queryKey: ['finance-cmd-global', debouncedQuery],
    queryFn: async () => {
      const { data } = await invokeFinanceFunction('finance-portal-batch9-10', {
        operation: 'global_search',
        query: debouncedQuery,
      });
      return data?.results || { notes: [], messages: [], docs: [] };
    },
    enabled: isAuthenticated && open && debouncedQuery.trim().length >= 2,
    staleTime: 15_000,
  });

  const files = useMemo(() => (filesData || []).slice(0, 12), [filesData]);
  const clients = useMemo(() => (clientsData || []).slice(0, 12), [clientsData]);
  const notes = deepResults?.notes || [];
  const messages = deepResults?.messages || [];
  const docs = deepResults?.docs || [];

  const go = (path: string) => { setOpen(false); setQuery(''); navigate(path); };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search files, clients, notes, messages, docs… (⌘K)"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => go('/finance')}><LayoutDashboard className="h-4 w-4 mr-2" /> Dashboard</CommandItem>
          <CommandItem onSelect={() => go('/finance/purchase-files')}><Briefcase className="h-4 w-4 mr-2" /> Active Purchase Files</CommandItem>
          <CommandItem onSelect={() => go('/finance/clients')}><Users className="h-4 w-4 mr-2" /> My Clients</CommandItem>
          <CommandItem onSelect={() => go('/finance/messages')}><MessageSquare className="h-4 w-4 mr-2" /> Messages</CommandItem>
          <CommandItem onSelect={() => go('/finance/earnings')}><Wallet className="h-4 w-4 mr-2" /> Earnings</CommandItem>
        </CommandGroup>

        {files.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Purchase Files">
              {files.map((f: any) => {
                const name = smartCapitalize(`${f.clients?.primary_first_name || ''} ${f.clients?.primary_surname || ''}`.trim());
                return (
                  <CommandItem
                    key={f.id}
                    value={`${f.title} ${name} ${f.property_address || ''} ${f.lender || ''}`}
                    onSelect={() => go(`/finance/purchase-files/${f.id}`)}
                  >
                    <Briefcase className="h-4 w-4 mr-2 text-primary" />
                    <span className="truncate">{f.title}</span>
                    {name && <span className="ml-2 text-xs text-muted-foreground truncate">· {name}</span>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}

        {clients.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Clients">
              {clients.map((r: any) => {
                const name = r.client?.primary_contact_name || r.client?.primary_contact_email || r.client_id;
                return (
                  <CommandItem
                    key={r.client_id}
                    value={`${name} ${r.client?.primary_contact_email || ''}`}
                    onSelect={() => go(`/finance/clients/${r.client_id}`)}
                  >
                    <Users className="h-4 w-4 mr-2" />
                    <span className="truncate">{smartCapitalize(name)}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}

        {notes.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Notes & comments">
              {notes.slice(0, 8).map((n: any) => (
                <CommandItem
                  key={`note-${n.id}`}
                  value={`note ${n.body}`}
                  onSelect={() => go(`/finance/purchase-files/${n.purchase_file_id}`)}
                >
                  <StickyNote className="h-4 w-4 mr-2 text-primary/80" />
                  <span className="truncate">{n.body?.slice(0, 80) || 'Untitled note'}</span>
                  {n.pf_title && <span className="ml-2 text-xs text-muted-foreground truncate">· {n.pf_title}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {messages.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Messages">
              {messages.slice(0, 8).map((m: any) => (
                <CommandItem
                  key={`msg-${m.id}`}
                  value={`msg ${m.snippet}`}
                  onSelect={() => go(m.client_id ? `/finance/clients/${m.client_id}` : '/finance/messages')}
                >
                  <MessageCircle className="h-4 w-4 mr-2 text-primary/80" />
                  <span className="truncate">{m.snippet?.slice(0, 80)}</span>
                  {m.channel && <span className="ml-2 text-xs text-muted-foreground uppercase">· {m.channel}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {docs.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Documents">
              {docs.slice(0, 8).map((d: any) => (
                <CommandItem
                  key={`doc-${d.id}`}
                  value={`doc ${d.label}`}
                  onSelect={() => go(`/finance/purchase-files/${d.purchase_file_id}`)}
                >
                  <FileText className="h-4 w-4 mr-2 text-primary/80" />
                  <span className="truncate">{d.label}</span>
                  {d.pf_title && <span className="ml-2 text-xs text-muted-foreground truncate">· {d.pf_title}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Quick Actions">
          <CommandItem onSelect={() => go('/finance/purchase-files?new=1')}>
            <Plus className="h-4 w-4 mr-2" /> New purchase file
          </CommandItem>
          <CommandItem onSelect={() => go('/finance/purchase-files?inbox=watching')}>
            <Eye className="h-4 w-4 mr-2" /> View watchlist
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
