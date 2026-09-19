/**
 * Finance Portal — Compliance Export (Phase 6D)
 * Pull a date-bounded audit slice (optionally per-partner) and export
 * to CSV or printable PDF for compliance reviews.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import {
  Loader2, FileText, Download, Printer, Search, ShieldCheck,
} from 'lucide-react';
import { format } from 'date-fns';
import { useBrand } from '@/branding/useBrand';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

interface PartnerOption { id: string; name: string; email: string; }
interface ExportRow {
  timestamp: string;
  source?: 'auth' | 'audit';
  severity?: 'info' | 'notice' | 'warn' | 'critical';
  category?: string;
  partner_name: string | null;
  partner_email: string | null;
  client_name: string | null;
  client_email: string | null;
  actor_type: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  ip_address: string | null;
  metadata: any;
}

function isoToday() { return new Date().toISOString().slice(0, 10); }
function isoDaysAgo(d: number) { return new Date(Date.now() - d * 86400000).toISOString().slice(0, 10); }

function csvEscape(v: any): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function FinancePortalCompliance() {
  const { settings: brandSettings } = useBrand();
  const brandName = brandSettings.companyName || 'Command Centre';
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [partnerId, setPartnerId] = useState<string>('all');
  const [since, setSince] = useState<string>(isoDaysAgo(30));
  const [until, setUntil] = useState<string>(isoToday());
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ExportRow[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});

  const loadPartners = async () => {
    try {
      const { data } = await invokeSecureFunction('finance-portal-admin', { operation: 'list_users' });
      const list: PartnerOption[] = (data?.records || [])
        .filter((u: any) => u.portal_user)
        .map((u: any) => ({ id: u.portal_user.id, name: u.name, email: u.email }));
      setPartners(list);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load partners');
    }
  };

  useEffect(() => { void loadPartners(); }, []);

  const runReport = async () => {
    setLoading(true);
    try {
      const { data, error } = await invokeSecureFunction('finance-portal-admin', {
        operation: 'compliance_export',
        finance_user_id: partnerId === 'all' ? undefined : partnerId,
        since: new Date(since + 'T00:00:00Z').toISOString(),
        until: new Date(until + 'T23:59:59Z').toISOString(),
      });
      if (error) throw new Error(error.message);
      setRows(data?.rows || []);
      setSummary(data?.summary || {});
      toast.success(`${data?.total || 0} audit records loaded`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (rows.length === 0) { toast.error('Run a report first'); return; }
    const headers = ['timestamp', 'source', 'severity', 'category', 'partner_name', 'partner_email', 'client_name', 'client_email', 'actor_type', 'action', 'entity_type', 'entity_id', 'ip_address', 'metadata'];
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push(headers.map(h => csvEscape((r as any)[h])).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const partnerName = partnerId === 'all' ? 'all-partners' : partners.find(p => p.id === partnerId)?.email || partnerId;
    a.href = url;
    a.download = `finance-portal-compliance_${partnerName}_${since}_to_${until}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printPdf = () => {
    if (rows.length === 0) { toast.error('Run a report first'); return; }
    const rootStyles = getComputedStyle(document.documentElement);
    const cssToken = (name: string, fallback: string) => rootStyles.getPropertyValue(name).trim() || fallback;
    const printToken = (name: string, fallback: string) => `hsl(${cssToken(name, fallback)})`;
    const printForeground = printToken('--foreground', '215 50% 18%');
    const printBackground = printToken('--background', '0 0% 100%');
    const printCard = printToken('--card', '0 0% 100%');
    const printPrimary = printToken('--primary', '38 45% 53%');
    const printMuted = printToken('--muted', '42 22% 92%');
    const printMutedForeground = printToken('--muted-foreground', '215 16% 47%');
    const printBorder = printToken('--border', '214 32% 91%');
    const partnerLabel = partnerId === 'all' ? 'All Partners' : partners.find(p => p.id === partnerId)?.name || 'Partner';
    const summaryHtml = Object.entries(summary)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<tr><td>${k}</td><td style="text-align:right">${v}</td></tr>`)
      .join('');
    const rowsHtml = rows.map(r => `
      <tr>
        <td>${format(new Date(r.timestamp), 'yyyy-MM-dd HH:mm:ss')}</td>
        <td>${r.partner_name || '—'}</td>
        <td>${r.client_name || '—'}</td>
        <td>${r.actor_type}</td>
        <td><strong>${r.action}</strong></td>
        <td>${r.entity_type || ''}</td>
        <td style="font-family:monospace;font-size:10px">${r.ip_address || ''}</td>
      </tr>`).join('');

    const w = window.open('', '_blank', 'width=1024,height=768');
    if (!w) { toast.error('Popup blocked. Allow popups to print.'); return; }
    w.document.write(`
      <!doctype html><html><head><meta charset="utf-8"><title>Finance Portal Compliance Report</title>
      <style>
        :root {
          --print-background: ${printBackground};
          --print-card: ${printCard};
          --print-foreground: ${printForeground};
          --print-primary: ${printPrimary};
          --print-muted: ${printMuted};
          --print-muted-foreground: ${printMutedForeground};
          --print-border: ${printBorder};
        }
        body { font-family: -apple-system, system-ui, sans-serif; color: var(--print-foreground); background: var(--print-background); margin: 24px; }
        h1 { color: var(--print-foreground); border-bottom: 3px solid var(--print-primary); padding-bottom: 8px; margin-bottom: 4px; }
        h2 { color: var(--print-primary); font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-top: 24px; }
        .meta { color: var(--print-muted-foreground); font-size: 12px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { padding: 6px 8px; border-bottom: 1px solid var(--print-border); text-align: left; vertical-align: top; }
        th { background: var(--print-muted); color: var(--print-foreground); font-weight: 600; }
        tr:nth-child(even) { background: var(--print-card); }
        .footer { margin-top: 32px; font-size: 10px; color: var(--print-muted-foreground); text-align: center; }
      </style></head><body>
      <h1>Finance Portal — Compliance Report</h1>
      <div class="meta">
        <strong>${partnerLabel}</strong> · Period: ${since} → ${until} · Generated: ${format(new Date(), 'PPpp')} · ${rows.length} records
      </div>
      <h2>Action Summary</h2>
      <table><thead><tr><th>Action</th><th style="text-align:right">Count</th></tr></thead><tbody>${summaryHtml}</tbody></table>
      <h2>Audit Trail</h2>
      <table><thead><tr>
        <th>Timestamp</th><th>Partner</th><th>Client</th><th>Actor</th><th>Action</th><th>Entity</th><th>IP</th>
      </tr></thead><tbody>${rowsHtml}</tbody></table>
      <div class="footer">Generated by ${brandName} · Confidential</div>
      <script>window.print();</script>
      </body></html>`);
    w.document.close();
  };

  return (
    <DashboardThemeFrame variant="page" className="space-y-6 p-4 sm:p-6">
      <DashboardThemeFrame variant="hero" as="header" className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight sm:text-3xl">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm shadow-primary/10">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <span className="truncate">Compliance Export</span>
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Audit-grade export of finance portal activity for compliance and partner reviews.
          </p>
        </div>
      </DashboardThemeFrame>

      <DashboardThemeFrame variant="section" className="p-0">
      <Card className="border-0 bg-transparent shadow-none">
        <CardHeader className="border-b border-border/60 bg-gradient-to-r from-card/80 to-muted/25 p-4 sm:p-5">
          <CardTitle className="text-lg tracking-tight">Report parameters</CardTitle>
          <CardDescription className="leading-6">Filter by partner and time window. CSV and printable PDF available after running.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Partner</label>
              <Select value={partnerId} onValueChange={setPartnerId}>
                <SelectTrigger aria-label="Select compliance report partner" className="h-10 rounded-xl border-border/70 bg-background/75 shadow-sm focus:ring-primary/35"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All partners</SelectItem>
                  {partners.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} <span className="text-muted-foreground">({p.email})</span></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Input aria-label="Compliance report start date" className="h-10 rounded-xl border-border/70 bg-background/75" type="date" value={since} onChange={e => setSince(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input aria-label="Compliance report end date" className="h-10 rounded-xl border-border/70 bg-background/75" type="date" value={until} onChange={e => setUntil(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={runReport} disabled={loading} aria-label="Run compliance report" className="h-10 w-full gap-2 rounded-xl shadow-md shadow-primary/20">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Run Report
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      </DashboardThemeFrame>

      {rows.length > 0 && (
        <DashboardThemeFrame variant="section" className="p-0">
        <Card className="border-0 bg-transparent shadow-none">
          <CardHeader className="flex flex-col gap-3 border-b border-border/60 bg-gradient-to-r from-card/80 to-muted/25 p-4 sm:p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Results — {rows.length} records</CardTitle>
              <CardDescription>
                Action breakdown:{' '}
                {Object.entries(summary).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => (
                  <Badge key={k} variant="outline" className="mr-1 rounded-full border-border/70 bg-background/70 text-[10px]">{k}: {v}</Badge>
                ))}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={exportCsv} className="gap-2 rounded-xl"><Download className="h-4 w-4" />CSV</Button>
              <Button variant="default" onClick={printPdf} className="gap-2 rounded-xl"><Printer className="h-4 w-4" />Print / PDF</Button>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-5">
            <div className="max-h-[60vh] overflow-auto rounded-2xl border border-border/70 bg-card/75 shadow-inner shadow-black/5 dark:bg-background/35">
              <Table className="min-w-[980px]" aria-label="Compliance export results">
                <TableHeader className="bg-muted/35">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Partner</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 500).map((r, i) => (
                    <TableRow key={i} className="transition-colors hover:bg-primary/5">
                      <TableCell className="text-xs whitespace-nowrap">{format(new Date(r.timestamp), 'MMM d, HH:mm:ss')}</TableCell>
                      <TableCell className="text-sm">
                        <div className="font-medium">{r.partner_name || '—'}</div>
                        <div className="text-[10px] text-muted-foreground">{r.partner_email}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{r.client_name || '—'}</div>
                        <div className="text-[10px] text-muted-foreground">{r.client_email}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant="outline" className="text-[10px] capitalize w-fit">{r.actor_type}</Badge>
                          {r.severity && r.severity !== 'info' && (
                            <Badge variant="outline" className={`text-[10px] capitalize w-fit ${
                              r.severity === 'critical' ? 'border-destructive/40 text-destructive' :
                              r.severity === 'warn' ? 'border-warning/40 text-warning' : 'border-primary/40 text-primary'
                            }`}>{r.severity}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {r.action}
                        {r.category && <div className="text-[10px] text-muted-foreground capitalize">{r.category.replace(/_/g, ' ')}</div>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.entity_type || '—'}
                        {r.entity_id && <span className="ml-1 font-mono">{r.entity_id.slice(0, 8)}</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">{r.ip_address || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rows.length > 500 && (
                <div className="p-3 text-center text-xs text-muted-foreground border-t">
                  Showing first 500 of {rows.length}. Use CSV/PDF export for the full set.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        </DashboardThemeFrame>
      )}
    </DashboardThemeFrame>
  );
}
