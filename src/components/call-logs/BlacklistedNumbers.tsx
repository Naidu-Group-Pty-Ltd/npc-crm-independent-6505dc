import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { callLogBadgeTone, type CallLogBadgeTone } from './badgeStyles';
import { useToast } from '@/hooks/use-toast';
import { Ban, Loader2, MessageSquareOff, Plus, ShieldAlert, Trash2, Volume2 } from 'lucide-react';
import { format } from 'date-fns';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { cn } from '@/lib/utils';

interface BlacklistedNumber {
  id: string;
  phone_number: string;
  normalized_number: string;
  category: string;
  kill_mode: string;
  announce_message: string | null;
  notes: string | null;
  is_active: boolean;
  hit_count: number;
  last_hit_at: string | null;
  created_by_username: string | null;
  created_at: string;
}

interface BlacklistedNumbersProps {
  canEdit: boolean;
  canDelete: boolean;
}

const CATEGORIES: Array<{ value: string; label: string; tone: CallLogBadgeTone }> = [
  { value: 'spam', label: 'Spam', tone: 'warning' },
  { value: 'scam', label: 'Scam', tone: 'danger' },
  { value: 'telemarketer', label: 'Telemarketer', tone: 'info' },
  { value: 'abusive', label: 'Abusive', tone: 'attention' },
  { value: 'other', label: 'Other', tone: 'neutral' },
];

const DEFAULT_ANNOUNCE_PLACEHOLDER = 'This number has been blocked and cannot use this service. Goodbye.';

const sectionCard =
  'relative overflow-hidden rounded-3xl border border-border dark:border-white/10 bg-gradient-to-br from-card dark:from-background/95 via-card dark:via-background/80 to-background dark:to-black/90 shadow-xl shadow-sm dark:shadow-black/25 before:pointer-events-none before:absolute before:inset-x-6 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand-200/35 before:to-transparent';
const controlStyle =
  'rounded-2xl border-border dark:border-white/10 bg-background dark:bg-black/45 text-foreground dark:text-foreground shadow-inner shadow-sm dark:shadow-black/25 transition-all placeholder:text-muted-foreground hover:border-brand-300/35 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black';
const primaryButton =
  'rounded-2xl bg-gradient-to-r from-brand-300 via-brand-400 to-brand-500 font-semibold text-black shadow-lg shadow-brand-500/20 transition-all hover:-translate-y-0.5 hover:from-brand-200 hover:via-brand-300 hover:to-brand-400 hover:shadow-brand-500/30 disabled:translate-y-0 disabled:opacity-50';

// Secure API helpers
async function fetchBlacklistSecure(): Promise<BlacklistedNumber[]> {
  const { data, error } = await invokeSecureFunction('manage-call-settings', {
    operation: 'list',
    table: 'blacklisted_numbers',
  });

  if (error || !data?.success) {
    console.error('Error fetching blacklist:', error || data?.error);
    return [];
  }
  return data.items || [];
}

async function createBlacklistEntrySecure(entry: Partial<BlacklistedNumber>): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await invokeSecureFunction('manage-call-settings', {
    operation: 'create',
    table: 'blacklisted_numbers',
    data: entry,
  });

  if (error) return { success: false, error: error.message };
  if (!data?.success) return { success: false, error: data?.error };
  return { success: true };
}

async function updateBlacklistEntrySecure(entryId: string, update: Partial<BlacklistedNumber>): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await invokeSecureFunction('manage-call-settings', {
    operation: 'update',
    table: 'blacklisted_numbers',
    recordId: entryId,
    data: update,
  });

  if (error) return { success: false, error: error.message };
  if (!data?.success) return { success: false, error: data?.error };
  return { success: true };
}

async function deleteBlacklistEntrySecure(entryId: string): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await invokeSecureFunction('manage-call-settings', {
    operation: 'delete',
    table: 'blacklisted_numbers',
    recordId: entryId,
  });

  if (error) return { success: false, error: error.message };
  if (!data?.success) return { success: false, error: data?.error };
  return { success: true };
}

const categoryMeta = (category: string) =>
  CATEGORIES.find(c => c.value === category) ?? CATEGORIES[CATEGORIES.length - 1];

export const BlacklistedNumbers = ({ canEdit, canDelete }: BlacklistedNumbersProps) => {
  const { toast } = useToast();
  const [entries, setEntries] = useState<BlacklistedNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);

  // Add-entry form state
  const [newPhone, setNewPhone] = useState('');
  const [newCategory, setNewCategory] = useState('spam');
  const [newKillMode, setNewKillMode] = useState('silent');
  const [newAnnounceMessage, setNewAnnounceMessage] = useState('');
  const [newNotes, setNewNotes] = useState('');

  const fetchEntries = useCallback(async () => {
    const items = await fetchBlacklistSecure();
    setEntries(items);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchEntries();

    // Enhancement only: the table is service-role locked, so realtime may not
    // deliver to the anonymous browser client. Mutations always refetch.
    const channel = supabase
      .channel('blacklisted-numbers-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blacklisted_numbers' }, () => {
        fetchEntries();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchEntries]);

  const handleAdd = async () => {
    const digits = newPhone.replace(/\D/g, '');
    if (digits.length < 6) {
      toast({
        title: 'Invalid phone number',
        description: 'Enter a phone number with at least 6 digits.',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    const { success, error } = await createBlacklistEntrySecure({
      phone_number: newPhone.trim(),
      category: newCategory,
      kill_mode: newKillMode,
      announce_message: newKillMode === 'announce' && newAnnounceMessage.trim() ? newAnnounceMessage.trim() : null,
      notes: newNotes.trim() || null,
    });
    setSubmitting(false);

    if (!success) {
      toast({
        title: 'Unable to blacklist number',
        description: error || 'Unknown error',
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Number blacklisted',
      description: `Inbound calls from ${newPhone.trim()} will be terminated automatically.`,
    });
    logActivityDirect({
      actionType: 'blacklist_entry_created',
      entityType: 'blacklisted_number',
      entityName: newPhone.trim(),
      metadata: { category: newCategory, killMode: newKillMode },
    });
    setNewPhone('');
    setNewAnnounceMessage('');
    setNewNotes('');
    fetchEntries();
  };

  const handleToggleActive = async (entry: BlacklistedNumber, isActive: boolean) => {
    setBusyEntryId(entry.id);
    const { success, error } = await updateBlacklistEntrySecure(entry.id, { is_active: isActive });
    setBusyEntryId(null);

    if (!success) {
      toast({
        title: 'Unable to update entry',
        description: error || 'Unknown error',
        variant: 'destructive',
      });
      return;
    }

    logActivityDirect({
      actionType: 'blacklist_entry_updated',
      entityType: 'blacklisted_number',
      entityId: entry.id,
      entityName: entry.phone_number,
      metadata: { field: 'is_active', value: isActive },
    });
    fetchEntries();
  };

  const handleDelete = async (entry: BlacklistedNumber) => {
    setBusyEntryId(entry.id);
    const { success, error } = await deleteBlacklistEntrySecure(entry.id);
    setBusyEntryId(null);

    if (!success) {
      toast({
        title: 'Unable to remove entry',
        description: error || 'Unknown error',
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Number removed from blacklist',
      description: `${entry.phone_number} can reach the voice agents again.`,
    });
    logActivityDirect({
      actionType: 'blacklist_entry_deleted',
      entityType: 'blacklisted_number',
      entityId: entry.id,
      entityName: entry.phone_number,
    });
    fetchEntries();
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/10 text-destructive shadow-inner">
          <ShieldAlert className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground md:text-xl">Blacklisted Numbers</h2>
          <p className="text-xs text-muted-foreground md:text-sm">
            Inbound calls from these numbers are terminated automatically the moment they connect.
          </p>
        </div>
      </div>

      {canEdit && (
        <Card className={sectionCard}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="h-4 w-4 text-brand-300" />
              Blacklist a number
            </CardTitle>
            <CardDescription>
              Numbers match in any format — local or international (last 9 digits are compared).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="blacklist-phone">Phone number</Label>
                <Input
                  id="blacklist-phone"
                  className={controlStyle}
                  placeholder="+61 4xx xxx xxx"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={newCategory} onValueChange={setNewCategory}>
                  <SelectTrigger className={controlStyle}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((category) => (
                      <SelectItem key={category.value} value={category.value}>{category.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Kill behavior</Label>
                <Select value={newKillMode} onValueChange={setNewKillMode}>
                  <SelectTrigger className={controlStyle}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="silent">Silent kill — end immediately</SelectItem>
                    <SelectItem value="announce">Announce — speak a message, then end</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {newKillMode === 'announce' && (
              <div className="space-y-2">
                <Label htmlFor="blacklist-message">Announcement message (optional)</Label>
                <Textarea
                  id="blacklist-message"
                  className={cn(controlStyle, 'min-h-[64px]')}
                  placeholder={DEFAULT_ANNOUNCE_PLACEHOLDER}
                  maxLength={300}
                  value={newAnnounceMessage}
                  onChange={(e) => setNewAnnounceMessage(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Keep it short — the call stays connected (and billable) until the message finishes. Leave blank for the default.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="blacklist-notes">Notes (optional)</Label>
              <Input
                id="blacklist-notes"
                className={controlStyle}
                placeholder="Why is this number blocked?"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
              />
            </div>

            <Button className={primaryButton} onClick={handleAdd} disabled={submitting || !newPhone.trim()}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
              Add to blacklist
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className={sectionCard}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Blocked numbers ({entries.length})</CardTitle>
          <CardDescription>
            Toggle an entry off to let its calls through without deleting the record.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading blacklist…
            </div>
          ) : entries.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No blacklisted numbers yet. {canEdit ? 'Add one above to auto-kill unwanted callers.' : ''}
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => {
                const category = categoryMeta(entry.category);
                const busy = busyEntryId === entry.id;
                return (
                  <div
                    key={entry.id}
                    className={cn(
                      'flex flex-col gap-3 rounded-2xl border border-border dark:border-white/10 bg-background/60 dark:bg-black/30 p-3 md:flex-row md:items-center md:justify-between md:p-4',
                      !entry.is_active && 'opacity-55',
                    )}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-foreground md:text-base">{entry.phone_number}</span>
                        <Badge className={callLogBadgeTone(category.tone, 'h-5 text-[10px]')}>{category.label}</Badge>
                        <Badge className={callLogBadgeTone(entry.kill_mode === 'announce' ? 'info' : 'neutral', 'h-5 text-[10px]')}>
                          {entry.kill_mode === 'announce' ? (
                            <><Volume2 className="mr-1 h-3 w-3" />Announce + end</>
                          ) : (
                            <><MessageSquareOff className="mr-1 h-3 w-3" />Silent kill</>
                          )}
                        </Badge>
                        {!entry.is_active && (
                          <Badge className={callLogBadgeTone('neutral', 'h-5 text-[10px]')}>Disabled</Badge>
                        )}
                      </div>
                      {entry.notes && <p className="truncate text-xs text-muted-foreground">{entry.notes}</p>}
                      <p className="text-[11px] text-muted-foreground">
                        {entry.hit_count} call{entry.hit_count === 1 ? '' : 's'} blocked
                        {' · '}Last hit: {entry.last_hit_at ? format(new Date(entry.last_hit_at), 'dd MMM yyyy HH:mm') : 'Never'}
                        {entry.created_by_username ? ` · Added by ${entry.created_by_username}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Switch
                        checked={entry.is_active}
                        disabled={!canEdit || busy}
                        onCheckedChange={(checked) => handleToggleActive(entry, checked)}
                        aria-label={`Toggle blacklist entry for ${entry.phone_number}`}
                      />
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          disabled={busy}
                          onClick={() => handleDelete(entry)}
                          aria-label={`Remove ${entry.phone_number} from blacklist`}
                        >
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
