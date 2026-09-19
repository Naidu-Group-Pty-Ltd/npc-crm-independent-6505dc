import { useState } from 'react';
import { usePortalEmailsData } from '@/hooks/usePortalData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { SearchInput } from '@/components/ui/search-input';
import { Mail, Loader2, Inbox, Clock, AlertTriangle } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { PortalEmptyState } from '@/components/finance-portal/PortalEmptyState';

function extractName(sender: string): string {
  // "John Smith <john@email.com>" → "John Smith"
  const match = sender.match(/^(.+?)\s*<.+>$/);
  return match ? match[1].trim() : sender;
}

function UrgencyBadge({ level }: { level?: string | null }) {
  if (!level || level === 'low') return null;
  if (level === 'high') return <Badge className="bg-destructive/10 text-destructive text-xs">Urgent</Badge>;
  if (level === 'medium') return <Badge className="bg-warning/10 text-warning text-xs">Medium</Badge>;
  return null;
}

export default function PortalEmails() {
  const { data, isLoading, error } = usePortalEmailsData();
  const [search, setSearch] = useState('');

  const emails = data?.emails || [];

  const filtered = search
    ? emails.filter((e: any) =>
        e.subject?.toLowerCase().includes(search.toLowerCase()) ||
        e.sender?.toLowerCase().includes(search.toLowerCase())
      )
    : emails;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="client-portal-page-header">
        <h1 className="text-2xl font-bold text-foreground">Correspondence</h1>
        <p className="mt-1 text-muted-foreground">Email communications related to your account</p>
      </div>

      {/* Search */}
      {emails.length > 0 && (
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search emails by subject or sender..."
          containerClassName="client-portal-soft-panel rounded-2xl p-4"
          className="border-border/60 bg-background/70"
        />
      )}

      {/* Email List */}
      {filtered.length === 0 ? (
        <PortalEmptyState
          className="client-portal-soft-panel"
          icon={<Inbox className="h-8 w-8" />}
          title={search ? 'No emails match your search' : 'No correspondence found'}
          description={search ? 'Try a broader subject or sender search to locate the conversation you need.' : 'Email communications related to your account will appear here when available.'}
        />
      ) : (
        <Card className="client-portal-soft-panel overflow-hidden">
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {filtered.map((email: any) => (
                <div
                  key={email.id}
                  className="px-5 py-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-primary/10 shrink-0 mt-0.5">
                      <Mail className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-semibold text-foreground truncate">{email.subject || '(No Subject)'}</p>
                        <UrgencyBadge level={email.urgency_level} />
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        From: {extractName(email.sender)}
                      </p>
                      {email.to_recipients?.length > 0 && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          To: {email.to_recipients.map((r: string) => extractName(r)).join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      {email.received_at ? (
                        <>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(email.received_at), 'dd MMM yyyy')}
                          </p>
                          <p className="text-xs text-muted-foreground/70 mt-0.5">
                            {format(new Date(email.received_at), 'h:mm a')}
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">—</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Showing {filtered.length} email{filtered.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}
