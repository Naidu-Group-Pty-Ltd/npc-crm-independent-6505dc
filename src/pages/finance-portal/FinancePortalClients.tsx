import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchInput } from '@/components/ui/search-input';

import {
  Search, Users, Loader2, X, ArrowUpDown, UserCheck, Clock, SortAsc,
  ChevronRight, Shield, UserX, UserPlus, Upload, FileText, Sparkles, Download,
  Briefcase, AlertTriangle, CalendarClock, Gavel, TrendingUp, Wallet,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { smartCapitalize } from '@/lib/nameUtils';
import { motion, AnimatePresence } from 'framer-motion';
import { useBrand } from '@/branding/useBrand';
import { parseFormaraPdf } from '@/utils/formaraPdfParser';
import type { ParsedClient } from '@/utils/excelClientParser';
import { GHLExportDialog } from '@/components/shared/GHLExportDialog';

type SortKey = 'name' | 'date' | 'status' | 'urgency' | 'settlement' | 'finance_clause' | 'risk' | 'recent';
type IntakeMode = 'manual' | 'pdf';

interface NewClientFormData {
  primary_first_name: string;
  primary_surname: string;
  primary_email: string;
  primary_mobile: string;
  secondary_first_name: string;
  secondary_surname: string;
  current_address: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-success',
  lead: 'bg-brand-500',
  prospect: 'bg-info',
  inactive: 'bg-muted-foreground',
  nurture: 'bg-accent',
  settled: 'bg-success',
  'under contract': 'bg-info',
};

const EMPTY_CLIENT_FORM: NewClientFormData = {
  primary_first_name: '',
  primary_surname: '',
  primary_email: '',
  primary_mobile: '',
  secondary_first_name: '',
  secondary_surname: '',
  current_address: '',
};

function getInitials(name?: string): string {
  if (!name) return '?';
  return name.split(' ').map((n) => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function getAvatarColor(name?: string): string {
  if (!name) return 'hsl(var(--primary))';
  const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const hues = [25, 45, 200, 260, 330, 150, 10, 280];
  return `hsl(${hues[hash % hues.length]}, 55%, 50%)`;
}

function splitFullName(name?: string | null) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function mapParsedClientToForm(parsed: ParsedClient): NewClientFormData {
  return {
    primary_first_name: parsed.primaryContact?.firstName || '',
    primary_surname: parsed.primaryContact?.surname || '',
    primary_email: parsed.primaryContact?.email || '',
    primary_mobile: parsed.primaryContact?.mobile || '',
    secondary_first_name: parsed.secondaryContact?.firstName || '',
    secondary_surname: parsed.secondaryContact?.surname || '',
    current_address: parsed.address?.currentAddress || '',
  };
}

function PermissionBar({ granted, total }: { granted: number; total: number }) {
  const pct = total === 0 ? 0 : (granted / total) * 100;
  return (
    <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 max-w-[140px] sm:max-w-[140px]">
      <div className="flex-1 h-2 sm:h-1.5 rounded-full bg-muted overflow-hidden min-w-[40px]">
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground font-medium tabular-nums shrink-0">
        {granted}/{total}
      </span>
    </div>
  );
}

function ClientCardSkeleton() {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 border border-border/50 rounded-xl p-4">
      <div className="flex items-center gap-3 sm:gap-4">
        <Skeleton className="h-11 w-11 rounded-full shrink-0" />
        <div className="space-y-2 flex-1 sm:hidden">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-44" />
        </div>
      </div>
      <div className="hidden sm:block flex-1 space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
        <Skeleton className="h-1.5 w-28 rounded-full" />
      </div>
      <Skeleton className="h-8 w-full sm:w-28 rounded-lg" />
    </div>
  );
}

function CreateClientDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (clientId: string) => Promise<void> | void;
}) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [intakeMode, setIntakeMode] = useState<IntakeMode>('manual');
  const [formData, setFormData] = useState<NewClientFormData>(EMPTY_CLIENT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [parsingPdf, setParsingPdf] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [parsedMetrics, setParsedMetrics] = useState<{ properties: number; employment: number; liabilities: number } | null>(null);
  const [syncToGHL, setSyncToGHL] = useState(true);

  const resetState = useCallback(() => {
    setIntakeMode('manual');
    setFormData(EMPTY_CLIENT_FORM);
    setSubmitting(false);
    setParsingPdf(false);
    setParseProgress(0);
    setPdfFileName(null);
    setParsedMetrics(null);
    setSyncToGHL(true);
  }, []);


  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetState();
    onOpenChange(nextOpen);
  };

  const updateField = (field: keyof NewClientFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handlePdfDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setIntakeMode('pdf');
    setPdfFileName(file.name);
    setParsingPdf(true);
    setParseProgress(5);

    try {
      const parsed = await parseFormaraPdf(file, (progress) => {
        if (progress.stage === 'extracting') {
          const total = Math.max(progress.total, 1);
          setParseProgress(Math.round((progress.current / total) * 55));
          return;
        }
        if (progress.stage === 'parsing') {
          setParseProgress(80);
          return;
        }
        setParseProgress(100);
      });

      setFormData((prev) => ({ ...prev, ...mapParsedClientToForm(parsed) }));
      setParsedMetrics({
        properties: parsed.properties?.length || 0,
        employment: parsed.employment?.length || 0,
        liabilities: parsed.liabilities?.length || 0,
      });
      toast.success('PDF parsed and client details pre-filled');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to parse PDF');
    } finally {
      setParsingPdf(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handlePdfDrop,
    multiple: false,
    accept: { 'application/pdf': ['.pdf'] },
    disabled: parsingPdf || submitting,
    onDropRejected: (rejections) => {
      if (!rejections.length) return;
      const message = rejections.map((rejection) => {
        const reason = rejection.errors[0]?.message || 'Unsupported file';
        return `${rejection.file.name}: ${reason}`;
      }).join(' • ');
      toast.error('PDF upload rejected', { description: message });
    },
  });

  const handleCreateClient = async () => {
    if (!formData.primary_first_name.trim() || !formData.primary_surname.trim()) {
      toast.error('Primary first name and surname are required');
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await invokeFinanceFunction('finance-portal-client-data', {
        operation: 'create_client',
        payload: formData,
        intake_method: intakeMode === 'pdf' ? 'pdf_upload' : 'manual',
        ingestion_file_name: pdfFileName,
        sync_to_ghl: syncToGHL,
      });


      if (error || !data?.success || !data?.client?.id) {
        const detail = data?.details || data?.error || error?.message || 'Failed to create client';
        throw new Error(String(detail));
      }

      if (data.ghl_sync?.success) {
        toast.success('Client created and Command Centre notified');
      } else if (data.ghl_sync?.error) {
        toast.warning('Client created, but CRM sync needs attention', {
          description: data.ghl_sync.error,
        });
      } else {
        toast.success('Client created successfully');
      }

      await onCreated(data.client.id);
      handleOpenChange(false);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create client');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[95vw] max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Add new client
          </DialogTitle>
          <DialogDescription>
            Create a finance-partner-originated client record, notify the Command Centre, and keep the client available for downstream portal-access setup from the internal dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <Tabs value={intakeMode} onValueChange={(value) => setIntakeMode(value as IntakeMode)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual" className="gap-2">
                <UserPlus className="h-4 w-4" />
                Manual entry
              </TabsTrigger>
              <TabsTrigger value="pdf" className="gap-2">
                <FileText className="h-4 w-4" />
                PDF intake
              </TabsTrigger>
            </TabsList>

            <TabsContent value="manual" className="space-y-4">
              <Card className="border-dashed bg-muted/20">
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  Enter the client details directly. This creates the client in the shared data model, marks finance-portal provenance, assigns it back to your finance account, and notifies the Command Centre.
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="pdf" className="space-y-4">
              <div
                {...getRootProps()}
                className={cn(
                  'rounded-xl border border-dashed p-6 text-center transition-colors cursor-pointer',
                  isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/20',
                  (parsingPdf || submitting) && 'pointer-events-none opacity-70'
                )}
              >
                <input {...getInputProps()} />
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  {parsingPdf ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                </div>
                <p className="font-medium text-foreground">
                  {isDragActive ? 'Drop the Formara PDF here' : 'Drag and drop a Formara PDF here'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  We’ll parse the document, prefill the client details, then create the client through the same finance intake path.
                </p>
                {pdfFileName && (
                  <Badge variant="secondary" className="mt-4">{pdfFileName}</Badge>
                )}
              </div>

              {(parsingPdf || parseProgress > 0) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{parsingPdf ? 'Parsing PDF…' : 'PDF ready'}</span>
                    <span>{parseProgress}%</span>
                  </div>
                  <Progress value={parseProgress} />
                </div>
              )}

              {parsedMetrics && (
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="gap-1.5"><Sparkles className="h-3.5 w-3.5" /> {parsedMetrics.properties} properties</Badge>
                  <Badge variant="outline">{parsedMetrics.employment} employment records found</Badge>
                  <Badge variant="outline">{parsedMetrics.liabilities} liabilities found</Badge>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="finance-primary-first-name">Primary first name *</Label>
              <Input
                id="finance-primary-first-name"
                value={formData.primary_first_name}
                onChange={(event) => updateField('primary_first_name', event.target.value)}
                placeholder="John"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="finance-primary-surname">Primary surname *</Label>
              <Input
                id="finance-primary-surname"
                value={formData.primary_surname}
                onChange={(event) => updateField('primary_surname', event.target.value)}
                placeholder="Smith"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="finance-primary-email">Primary email</Label>
              <Input
                id="finance-primary-email"
                type="email"
                value={formData.primary_email}
                onChange={(event) => updateField('primary_email', event.target.value)}
                placeholder="john@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="finance-primary-mobile">Primary mobile</Label>
              <Input
                id="finance-primary-mobile"
                value={formData.primary_mobile}
                onChange={(event) => updateField('primary_mobile', event.target.value)}
                placeholder="0400 000 000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="finance-secondary-first-name">Secondary first name</Label>
              <Input
                id="finance-secondary-first-name"
                value={formData.secondary_first_name}
                onChange={(event) => updateField('secondary_first_name', event.target.value)}
                placeholder="Jane"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="finance-secondary-surname">Secondary surname</Label>
              <Input
                id="finance-secondary-surname"
                value={formData.secondary_surname}
                onChange={(event) => updateField('secondary_surname', event.target.value)}
                placeholder="Smith"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="finance-current-address">Current address</Label>
            <Input
              id="finance-current-address"
              value={formData.current_address}
              onChange={(event) => updateField('current_address', event.target.value)}
              placeholder="123 Main St, Sydney NSW 2000"
            />
          </div>

          {/* GHL sync (mirrors dashboard AddClientModal) */}
          <div className="space-y-3 rounded-lg border border-border/50 bg-muted/20 p-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="finance-syncToGHL"
                checked={syncToGHL}
                onCheckedChange={(checked) => setSyncToGHL(checked as boolean)}
              />
              <Label htmlFor="finance-syncToGHL" className="text-sm font-normal cursor-pointer">
                Sync to GoHighLevel after creating
              </Label>
            </div>

            <p className="text-xs text-muted-foreground">
              The client is created in the shared dashboard data model, linked to your finance account, and surfaced to the Command Centre with finance-portal provenance.
            </p>
          </div>
        </div>




        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleCreateClient} disabled={submitting || parsingPdf} className="gap-2">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Create client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function FinancePortalClients() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const navigate = useNavigate();
  const { settings: brandSettings } = useBrand();
  const brandName = brandSettings.companyName || 'the team';
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['finance-portal-clients-list'],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction('finance-portal-client-data', {
        operation: 'list_assigned_clients',
      });
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const records = data?.records || [];

  const statusOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    records.forEach((r: any) => {
      const status = (r.client?.status || 'active').toLowerCase();
      counts[status] = (counts[status] || 0) + 1;
    });
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([status, count]) => ({ status, count }));
  }, [records]);

  const filtered = useMemo(() => {
    let list = [...records];

    if (statusFilter) {
      list = list.filter((r: any) => (r.client?.status || 'active').toLowerCase() === statusFilter);
    }

    const query = search.trim().toLowerCase();
    if (query) {
      list = list.filter(
        (r: any) =>
          (r.client?.primary_contact_name || '').toLowerCase().includes(query) ||
          (r.client?.secondary_contact_name || '').toLowerCase().includes(query) ||
          (r.client?.primary_contact_email || '').toLowerCase().includes(query)
      );
    }

    list.sort((a: any, b: any) => {
      const aPf = a.active_purchase_file;
      const bPf = b.active_purchase_file;
      const aNext = a.next_deadline?.due_date || '';
      const bNext = b.next_deadline?.due_date || '';
      const riskRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
      if (sortKey === 'name') {
        return (a.client?.primary_contact_name || '').localeCompare(b.client?.primary_contact_name || '');
      }
      if (sortKey === 'date') {
        return (b.assigned_at || '').localeCompare(a.assigned_at || '');
      }
      if (sortKey === 'status') {
        return (a.client?.status || '').localeCompare(b.client?.status || '');
      }
      if (sortKey === 'urgency') {
        // PFs with a next deadline first, soonest first; then those without
        if (!aNext && !bNext) return 0;
        if (!aNext) return 1;
        if (!bNext) return -1;
        return aNext.localeCompare(bNext);
      }
      if (sortKey === 'settlement') {
        const aS = aPf?.settlement_date || '';
        const bS = bPf?.settlement_date || '';
        if (!aS && !bS) return 0;
        if (!aS) return 1;
        if (!bS) return -1;
        return aS.localeCompare(bS);
      }
      if (sortKey === 'finance_clause') {
        const aF = aPf?.finance_clause_date || '';
        const bF = bPf?.finance_clause_date || '';
        if (!aF && !bF) return 0;
        if (!aF) return 1;
        if (!bF) return -1;
        return aF.localeCompare(bF);
      }
      if (sortKey === 'risk') {
        return (riskRank[bPf?.risk_level] || 0) - (riskRank[aPf?.risk_level] || 0);
      }
      if (sortKey === 'recent') {
        return (bPf?.updated_at || b.assigned_at || '').localeCompare(aPf?.updated_at || a.assigned_at || '');
      }
      return 0;
    });

    return list;
  }, [records, search, sortKey, statusFilter]);

  // #13 — Simplified, fixed-column client export. Just the labelled essentials.
  const ghlExportFields = useMemo(
    () => [
      { key: 'first_name', label: 'First name' },
      { key: 'last_name', label: 'Last name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'tags', label: 'Tags' },
      { key: 'source', label: 'Source' },
    ],
    []
  );

  const ghlExportRecords = useMemo(
    () =>
      filtered.map((record: any) => {
        const { firstName, lastName } = splitFullName(record.client?.primary_contact_name);
        return {
          first_name: firstName,
          last_name: lastName,
          email: record.client?.primary_contact_email || '',
          phone: record.client?.primary_contact_phone || '',
          tags: 'Finance Portal',
          source: 'Finance Portal Export',
        };
      }),
    [filtered]
  );


  const handleClientCreated = async (clientId: string) => {
    await refetch();
    navigate(`/finance/clients/${clientId}`);
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const SORT_LABELS: Record<SortKey, string> = {
    name: 'Name',
    date: 'Date Assigned',
    status: 'Status',
    urgency: 'Urgency',
    settlement: 'Settlement Date',
    finance_clause: 'Finance Clause',
    risk: 'Risk Level',
    recent: 'Recently Updated',
  };
  const sortLabel = SORT_LABELS[sortKey];

  return (
    <>
      <CreateClientDialog open={createClientOpen} onOpenChange={setCreateClientOpen} onCreated={handleClientCreated} />
      <GHLExportDialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
        title="Export finance portal clients"
        description="Pick exactly the columns you need. Unticked or unmapped fields are excluded from the downloaded CSV/XLSX."
        fields={ghlExportFields}
        records={ghlExportRecords}
        fileBaseName={`finance-portal-clients-${new Date().toISOString().split('T')[0]}`}
        sheetName="Finance Portal Clients"
        onExported={(format, count) => toast.success(`Exported ${count} clients to ${format.toUpperCase()}`)}
      />

      <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2.5 text-foreground">
              <div className="p-2 rounded-xl bg-primary/10">
                <Users className="h-5 w-5 text-primary" />
              </div>
              My Clients
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5 ml-[42px]">
              {isLoading
                ? 'Loading your assigned clients…'
                : `${records.length} client${records.length !== 1 ? 's' : ''} assigned to you`}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 self-start">
            <Button variant="outline" onClick={() => setShowExportDialog(true)} className="gap-2">
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button onClick={() => setCreateClientOpen(true)} className="gap-2">
              <UserPlus className="h-4 w-4" />
              Add client
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'relative flex items-center flex-1 transition-all duration-300 rounded-xl border bg-card',
                searchFocused ? 'border-primary/40 shadow-md shadow-primary/5' : 'border-border/60'
              )}
            >
              <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
              <SearchInput
                value={search}
                onValueChange={setSearch}
                ref={inputRef}
                placeholder="Search clients… ⌘K"
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                hideIcon
                className="pl-9 pr-8 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <AnimatePresence>
                {search && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    onClick={() => {
                      setSearch('');
                      inputRef.current?.focus();
                    }}
                    className="absolute right-2 p-1 rounded-md hover:bg-muted transition-colors"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>

            {(search || statusFilter) && (
              <Badge variant="secondary" className="shrink-0 tabular-nums font-medium">
                {filtered.length}
              </Badge>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="shrink-0 gap-1.5 rounded-xl">
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{sortLabel}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[200px]">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Basic</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setSortKey('name')} className={cn(sortKey === 'name' && 'text-primary font-medium')}>
                  <SortAsc className="h-4 w-4 mr-2" /> Name
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortKey('date')} className={cn(sortKey === 'date' && 'text-primary font-medium')}>
                  <Clock className="h-4 w-4 mr-2" /> Date Assigned
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortKey('status')} className={cn(sortKey === 'status' && 'text-primary font-medium')}>
                  <UserCheck className="h-4 w-4 mr-2" /> Status
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Deal flow</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setSortKey('urgency')} className={cn(sortKey === 'urgency' && 'text-primary font-medium')}>
                  <AlertTriangle className="h-4 w-4 mr-2" /> Urgency
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortKey('finance_clause')} className={cn(sortKey === 'finance_clause' && 'text-primary font-medium')}>
                  <Gavel className="h-4 w-4 mr-2" /> Finance Clause
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortKey('settlement')} className={cn(sortKey === 'settlement' && 'text-primary font-medium')}>
                  <CalendarClock className="h-4 w-4 mr-2" /> Settlement Date
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortKey('risk')} className={cn(sortKey === 'risk' && 'text-primary font-medium')}>
                  <TrendingUp className="h-4 w-4 mr-2" /> Risk Level
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortKey('recent')} className={cn(sortKey === 'recent' && 'text-primary font-medium')}>
                  <Clock className="h-4 w-4 mr-2" /> Recently Updated
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {statusOptions.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setStatusFilter(null)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 touch-manipulation',
                  statusFilter === null
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                All
                <span className={cn(
                  'tabular-nums text-[10px] px-1 rounded-full min-w-[18px] text-center',
                  statusFilter === null ? 'bg-primary-foreground/20' : 'bg-background/60'
                )}>
                  {records.length}
                </span>
              </button>
              {statusOptions.map(({ status, count }) => {
                const isActive = statusFilter === status;
                const dotColor = STATUS_COLORS[status] || 'bg-muted-foreground';
                return (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(isActive ? null : status)}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-all duration-200 touch-manipulation',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <span className={cn('h-2 w-2 rounded-full shrink-0', dotColor)} />
                    {status}
                    <span className={cn(
                      'tabular-nums text-[10px] px-1 rounded-full min-w-[18px] text-center',
                      isActive ? 'bg-primary-foreground/20' : 'bg-background/60'
                    )}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <ClientCardSkeleton key={index} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="p-5 rounded-full bg-primary/5 mb-4">
                {records.length === 0 ? (
                  <UserX className="h-12 w-12 text-primary/30" />
                ) : (
                  <Search className="h-12 w-12 text-primary/30" />
                )}
              </div>
              <h3 className="font-semibold text-lg text-foreground mb-1">
                {records.length === 0 ? 'No clients assigned yet' : 'No matches found'}
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                {records.length === 0
                  ? `Create a new client from the finance portal or wait for ${brandName} to assign existing clients to your account.`
                  : 'No clients match your current filters. Try adjusting your search or status filter.'}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {records.length === 0 && (
                  <Button size="sm" onClick={() => setCreateClientOpen(true)} className="gap-1.5">
                    <UserPlus className="h-3.5 w-3.5" /> Add first client
                  </Button>
                )}
                {(search || statusFilter) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch('');
                      setStatusFilter(null);
                    }}
                    className="gap-1.5"
                  >
                    <X className="h-3.5 w-3.5" /> Clear filters
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {filtered.map((record: any, index: number) => {
                const name = smartCapitalize(record.client?.primary_contact_name) || '—';
                const secondaryName = smartCapitalize(record.client?.secondary_contact_name);
                const permissions = record.permissions || {};
                const grantedTables = Object.entries(permissions).filter(([_, permission]: any) => permission?.view).length;
                const totalTables = 12;
                const status = (record.client?.status || 'active').toLowerCase();
                const statusColor = STATUS_COLORS[status] || 'bg-muted-foreground';
                const avatarBg = getAvatarColor(name);
                const pf = record.active_purchase_file;
                const pfCount = record.purchase_file_count || 0;
                const nextDeadline = record.next_deadline;
                const daysToDeadline = nextDeadline?.due_date
                  ? Math.round((new Date(nextDeadline.due_date).getTime() - Date.now()) / 86400000)
                  : null;
                const riskTone = pf?.risk_level === 'high'
                  ? 'bg-destructive/10 text-destructive border-destructive/20'
                  : pf?.risk_level === 'medium'
                    ? 'bg-brand-500/10 text-brand-700 dark:text-brand-400 border-brand-500/20'
                    : '';
                const deadlineTone = daysToDeadline != null && daysToDeadline <= 2
                  ? 'bg-destructive/10 text-destructive border-destructive/20'
                  : daysToDeadline != null && daysToDeadline <= 7
                    ? 'bg-brand-500/10 text-brand-700 dark:text-brand-400 border-brand-500/20'
                    : 'bg-muted text-muted-foreground';

                return (
                  <motion.div
                    key={record.assignment_id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2, delay: index * 0.03 }}
                  >
                    <div
                      className={cn(
                        'group border border-border/50 rounded-xl transition-all duration-200 cursor-pointer touch-manipulation',
                        'hover:border-primary/20 hover:bg-primary/[0.02] hover:shadow-md hover:shadow-primary/5',
                        'active:scale-[0.99] active:bg-primary/[0.03]',
                        'flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 sm:p-4',
                        'min-h-[72px] sm:min-h-0'
                      )}
                      onClick={() => navigate(`/finance/clients/${record.client_id}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          navigate(`/finance/clients/${record.client_id}`);
                        }
                      }}
                    >
                      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        <div className="relative shrink-0">
                          <Avatar className="h-11 w-11 border-2 border-border/30">
                            <AvatarFallback
                              className="font-semibold text-sm text-foreground dark:text-white"
                              style={{ backgroundColor: avatarBg }}
                            >
                              {getInitials(name)}
                            </AvatarFallback>
                          </Avatar>
                          <span
                            className={cn(
                              'absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card',
                              statusColor
                            )}
                            title={status}
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-foreground break-words">{name}</span>
                            {secondaryName && (
                              <span className="text-xs text-muted-foreground break-words">
                                & {secondaryName}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 break-all">
                            {record.client?.primary_contact_email || ''}
                            {record.client?.primary_contact_phone && (
                              <span className="hidden xs:inline"> · {record.client.primary_contact_phone}</span>
                            )}
                          </div>
                          {record.client?.primary_contact_phone && (
                            <div className="text-xs text-muted-foreground xs:hidden">{record.client.primary_contact_phone}</div>
                          )}

                          {pf && (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 border-primary/20 bg-primary/5 text-primary">
                                <Briefcase className="h-2.5 w-2.5" />
                                {pf.title || 'Purchase file'}
                                {pfCount > 1 && <span className="opacity-70">+{pfCount - 1}</span>}
                              </Badge>
                              {pf.finance_status && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">
                                  {pf.finance_status.replace(/_/g, ' ')}
                                </Badge>
                              )}
                              {pf.lender && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                                  {pf.lender}
                                </Badge>
                              )}
                              {pf.max_approved_budget != null && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground gap-1">
                                  <Wallet className="h-2.5 w-2.5" />
                                  ${Number(pf.max_approved_budget).toLocaleString('en-AU')}
                                </Badge>
                              )}
                              {pf.risk_level && (
                                <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 capitalize gap-1', riskTone)}>
                                  <AlertTriangle className="h-2.5 w-2.5" />
                                  {pf.risk_level}
                                </Badge>
                              )}
                              {nextDeadline && (
                                <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 gap-1', deadlineTone)}>
                                  <CalendarClock className="h-2.5 w-2.5" />
                                  {nextDeadline.date_type.replace(/_/g, ' ')}
                                  {daysToDeadline != null && (
                                    <span>· {daysToDeadline < 0 ? `${-daysToDeadline}d overdue` : `${daysToDeadline}d`}</span>
                                  )}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>

                        <ChevronRight className="h-5 w-5 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0 sm:hidden" />
                      </div>

                      <div className="flex items-center justify-between gap-3 sm:contents pl-14 sm:pl-0">
                        <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                          <Badge variant="outline" className="text-[10px] capitalize px-1.5 py-0 shrink-0">
                            {status}
                          </Badge>
                          <PermissionBar granted={grantedTables} total={totalTables} />
                        </div>

                        <div className="hidden sm:flex items-center gap-2 shrink-0 relative z-10">
                          <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-primary transition-colors" />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {!isLoading && records.length > 0 && (
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/40 pt-2">
            <Shield className="h-3 w-3" />
            <span>Data access governed by permission policies</span>
          </div>
        )}
      </div>
    </>
  );
}
