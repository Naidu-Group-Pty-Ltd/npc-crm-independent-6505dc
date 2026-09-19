import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchInput } from '@/components/ui/search-input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  FileSignature, Plus, RefreshCw, Loader2, MoreHorizontal, ShieldCheck, AlertTriangle, Trash2,
} from 'lucide-react';
import {
  UNDERTAKING_STATUS_LABELS,
  UNDERTAKING_TRANSITIONS,
  undertakingStatusVariant,
  useLoanWriterUndertakingMutations,
  useLoanWriterUndertakings,
  type LoanWriterUndertaking,
  type UndertakingStatus,
} from '@/hooks/useLoanWriterUndertakings';
import LoanWriterUndertakingDialog from '@/components/partner-referrals/LoanWriterUndertakingDialog';

type StatusFilter = 'all' | UndertakingStatus;

export default function LoanWriterUndertakings() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LoanWriterUndertaking | null>(null);

  const { data: undertakings = [], isLoading, isFetching, refetch } = useLoanWriterUndertakings(
    statusFilter === 'all' ? undefined : { status: statusFilter },
  );
  const { transitionUndertaking, recordSignature, deleteDraft } = useLoanWriterUndertakingMutations();

  useEffect(() => {
    document.title = 'Loan Writer Undertakings | Command Centre';
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return undertakings;
    return undertakings.filter((u) =>
      [u.reference, u.writer_full_name, u.writer_email, u.writer_entity_name, u.licensee_name, u.crn]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [undertakings, search]);

  const stats = useMemo(() => {
    const liveCount = undertakings.filter((u) => u.status === 'active' && u.is_live !== false).length;
    const lapsing = undertakings.filter((u) => {
      if (u.status !== 'active') return false;
      const end = u.authorisation_end_date || u.expiry_date;
      if (!end) return false;
      const days = (new Date(end).getTime() - Date.now()) / 86_400_000;
      return days >= 0 && days <= 30;
    }).length;
    return { total: undertakings.length, liveCount, lapsing };
  }, [undertakings]);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  return (
    <>
      <div className="space-y-6 p-4 sm:p-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
              <FileSignature className="h-6 w-6 text-primary" />
              Loan Writer Undertakings
            </h1>
            <p className="text-sm text-muted-foreground">
              Annexure B register. Each individual loan writer must hold a live undertaking before an
              outbound finance referral can be assigned to them.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" /> New undertaking
            </Button>
          </div>
        </header>

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Registered" value={stats.total} icon={FileSignature} />
          <StatCard label="Live" value={stats.liveCount} icon={ShieldCheck} accent="text-success" />
          <StatCard label="Lapsing within 30 days" value={stats.lapsing} icon={AlertTriangle} accent="text-warning" />
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="pending_signature">Pending</TabsTrigger>
              <TabsTrigger value="draft">Draft</TabsTrigger>
              <TabsTrigger value="expired">Expired</TabsTrigger>
            </TabsList>
          </Tabs>

          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search writer, licensee, CRN…"
            containerClassName="w-full sm:w-72"
          />
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <FileSignature className="h-10 w-10 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">No undertakings registered</p>
                  <p className="text-sm text-muted-foreground">
                    Register the loan writers named under an outbound finance agreement so referrals can be assigned.
                  </p>
                </div>
                <Button onClick={openNew}>
                  <Plus className="mr-2 h-4 w-4" /> New undertaking
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Loan writer</TableHead>
                    <TableHead>Licensee / ACL</TableHead>
                    <TableHead>Authorised to</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((u) => {
                    const end = u.authorisation_end_date || u.expiry_date;
                    return (
                      <TableRow
                        key={u.id}
                        className="cursor-pointer"
                        onClick={() => {
                          setEditing(u);
                          setDialogOpen(true);
                        }}
                      >
                        <TableCell className="font-mono text-xs">{u.reference}</TableCell>
                        <TableCell>
                          <div className="font-medium text-foreground">{u.writer_full_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {u.writer_entity_name || u.writer_email || '—'}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {u.licensee_name || '—'}
                          {u.acl_number ? ` · ${u.acl_number}` : ''}
                          {u.crn ? ` · CRN ${u.crn}` : ''}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {end ? format(new Date(end), 'dd MMM yyyy') : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant={undertakingStatusVariant(u.status)}>
                              {UNDERTAKING_STATUS_LABELS[u.status]}
                            </Badge>
                            {u.status === 'active' && u.is_live === false && (
                              <Badge variant="destructive">Lapsed</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {u.status === 'pending_signature' && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    recordSignature.mutate({
                                      id: u.id,
                                      signed_by_name: u.writer_full_name,
                                      signature_method: 'manual',
                                    })
                                  }
                                >
                                  Record signature
                                </DropdownMenuItem>
                              )}
                              {UNDERTAKING_TRANSITIONS[u.status].map((next) => (
                                <DropdownMenuItem
                                  key={next}
                                  onClick={() => transitionUndertaking.mutate({ id: u.id, status: next })}
                                >
                                  Mark {UNDERTAKING_STATUS_LABELS[next].toLowerCase()}
                                </DropdownMenuItem>
                              ))}
                              {u.status === 'draft' && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() => deleteDraft.mutate(u.id)}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" /> Delete draft
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <LoanWriterUndertakingDialog open={dialogOpen} onOpenChange={setDialogOpen} undertaking={editing} />
    </>
  );
}

function StatCard({
  label, value, icon: Icon, accent = 'text-muted-foreground',
}: { label: string; value: number; icon: React.ElementType; accent?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold text-foreground">{value}</p>
        </div>
        <Icon className={`h-5 w-5 ${accent}`} />
      </CardContent>
    </Card>
  );
}
