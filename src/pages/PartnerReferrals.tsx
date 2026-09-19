import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchInput } from '@/components/ui/search-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ArrowLeftRight,
  Plus,
  RefreshCw,
  Loader2,
  Inbox,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import {
  ELIGIBILITY_LABELS,
  REFERRAL_DIRECTION_LABELS,
  REFERRAL_STATUS_LABELS,
  usePartnerReferrals,
  type CommercialEligibility,
  type PartnerReferral,
  type ReferralDirection,
  type ReferralStatus,
} from '@/hooks/usePartnerReferrals';
import PartnerReferralDialog from '@/components/partner-referrals/PartnerReferralDialog';
import PartnerReferralDetailSheet, {
  referralStatusVariant,
} from '@/components/partner-referrals/PartnerReferralDetailSheet';

type DirectionFilter = 'all' | ReferralDirection;

export default function PartnerReferrals() {
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ReferralStatus>('all');
  const [eligibilityFilter, setEligibilityFilter] = useState<'all' | CommercialEligibility>('all');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PartnerReferral | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: referrals = [], isLoading, isFetching, refetch } = usePartnerReferrals({
    ...(directionFilter === 'all' ? {} : { direction: directionFilter }),
    ...(statusFilter === 'all' ? {} : { status: statusFilter }),
    ...(eligibilityFilter === 'all' ? {} : { commercial_eligibility: eligibilityFilter }),
  });

  useEffect(() => {
    document.title = 'Partner Referrals | Command Centre';
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return referrals;
    return referrals.filter((r) =>
      [r.reference, r.client_first_name, r.client_surname, r.client_email, r.client_phone, r.referring_entity_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [referrals, search]);

  const stats = useMemo(() => {
    const open = referrals.filter(
      (r) => !['settled', 'declined', 'withdrawn'].includes(r.status),
    ).length;
    const awaitingConsent = referrals.filter((r) => !r.consent_obtained || !r.benefit_disclosed).length;
    const duplicates = referrals.filter((r) => r.prior_client_check === 'duplicate').length;
    return { total: referrals.length, open, awaitingConsent, duplicates };
  }, [referrals]);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (referral: PartnerReferral) => {
    setSelectedId(null);
    setEditing(referral);
    setDialogOpen(true);
  };

  return (
    <>
      <div className="space-y-6 p-4 sm:p-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
              <ArrowLeftRight className="h-6 w-6 text-primary" />
              Partner Referrals
            </h1>
            <p className="text-sm text-muted-foreground">
              Annexure A register for inbound property and outbound finance referrals — consent, disclosure,
              status flow and commercial eligibility under the governing agreement.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" /> New referral
            </Button>
          </div>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total referrals" value={stats.total} icon={Inbox} />
          <StatCard label="Open" value={stats.open} icon={ArrowLeftRight} accent="text-primary" />
          <StatCard label="Compliance outstanding" value={stats.awaitingConsent} icon={ShieldCheck} accent="text-warning" />
          <StatCard label="Duplicate flags" value={stats.duplicates} icon={AlertTriangle} accent="text-destructive" />
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={directionFilter} onValueChange={(v) => setDirectionFilter(v as DirectionFilter)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="outbound_finance_referral">Outbound finance</TabsTrigger>
              <TabsTrigger value="inbound_property_referral">Inbound property</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {(Object.keys(REFERRAL_STATUS_LABELS) as ReferralStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{REFERRAL_STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={eligibilityFilter} onValueChange={(v) => setEligibilityFilter(v as typeof eligibilityFilter)}>
              <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Eligibility" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All eligibility</SelectItem>
                {(Object.keys(ELIGIBILITY_LABELS) as CommercialEligibility[]).map((e) => (
                  <SelectItem key={e} value={e}>{ELIGIBILITY_LABELS[e]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search reference, client, partner…"
              containerClassName="w-full sm:w-64"
            />
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <Inbox className="h-10 w-10 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">No referrals yet</p>
                  <p className="text-sm text-muted-foreground">
                    Register a referral to capture consent, disclosure and the general purpose before any
                    client detail is shared with the partner.
                  </p>
                </div>
                <Button onClick={openNew}>
                  <Plus className="mr-2 h-4 w-4" /> New referral
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>Partner</TableHead>
                    <TableHead>Compliance</TableHead>
                    <TableHead>Eligibility</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelectedId(r.id)}>
                      <TableCell className="font-medium text-foreground">{r.reference}</TableCell>
                      <TableCell>
                        <div className="text-foreground">
                          {[r.client_first_name, r.client_surname].filter(Boolean).join(' ')}
                        </div>
                        <div className="text-xs text-muted-foreground">{r.client_email || r.client_phone || '—'}</div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.direction === 'inbound_property_referral' ? 'Inbound property' : 'Outbound finance'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.referring_entity_name || '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Badge variant={r.consent_obtained ? 'secondary' : 'outline'} className="text-[10px]">
                            Consent
                          </Badge>
                          <Badge variant={r.benefit_disclosed ? 'secondary' : 'outline'} className="text-[10px]">
                            Disclosure
                          </Badge>
                          {r.prior_client_check === 'duplicate' && (
                            <Badge variant="destructive" className="text-[10px]">Dup</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {ELIGIBILITY_LABELS[r.commercial_eligibility]}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(r.created_at), 'd MMM yyyy')}
                      </TableCell>
                      <TableCell>
                        <Badge variant={referralStatusVariant(r.status)}>
                          {REFERRAL_STATUS_LABELS[r.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          {REFERRAL_DIRECTION_LABELS.inbound_property_referral} · {REFERRAL_DIRECTION_LABELS.outbound_finance_referral}
        </p>
      </div>

      <PartnerReferralDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        referral={editing}
        defaultDirection={directionFilter === 'all' ? undefined : directionFilter}
      />
      <PartnerReferralDetailSheet
        referralId={selectedId}
        onOpenChange={(open) => !open && setSelectedId(null)}
        onEdit={openEdit}
      />
    </>
  );
}

function StatCard({
  label, value, icon: Icon, accent = 'text-foreground',
}: { label: string; value: number; icon: React.ElementType; accent?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-2xl font-semibold ${accent}`}>{value}</p>
        </div>
        <Icon className={`h-5 w-5 ${accent}`} />
      </CardContent>
    </Card>
  );
}
