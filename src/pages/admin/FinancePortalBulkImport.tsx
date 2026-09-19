/**
 * Finance Portal — Bulk Client Assignment Import (Phase 6C)
 * Upload CSV (partner_email, client_email|client_name, permission_template),
 * preview matches via dry-run, then commit.
 */
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import {
  Upload, Download, Loader2, Eye, Save, FileSpreadsheet, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

interface CsvRow {
  partner_email: string;
  client_email?: string;
  client_name?: string;
  permission_template?: string;
}

interface ResultRow {
  row: number;
  status: 'created' | 'updated' | 'would_create' | 'would_update' | 'error';
  message?: string;
  partner?: string;
  client?: string;
  template?: string;
}

const SAMPLE_CSV = `partner_email,client_email,client_name,permission_template
broker@example.com,jane@client.com,,view_only
broker@example.com,,John Smith,view_edit
finance@partner.com,acme@client.com,,full_access`;

function parseCsv(text: string): CsvRow[] {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const cells = line.split(',').map(c => c.trim());
    const row: any = {};
    headers.forEach((h, i) => { row[h] = cells[i] || ''; });
    return row as CsvRow;
  });
}

export default function FinancePortalBulkImport() {
  const [csvText, setCsvText] = useState('');
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [summary, setSummary] = useState<{ total: number; created: number; updated: number; errors: number } | null>(null);
  const [dryRun, setDryRun] = useState(true);

  const handleFile = async (file: File) => {
    const text = await file.text();
    setCsvText(text);
    const parsed = parseCsv(text);
    setRows(parsed);
    setResults([]);
    setSummary(null);
    toast.success(`Parsed ${parsed.length} rows`);
  };

  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'finance-portal-bulk-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const submit = async (asDryRun: boolean) => {
    const parsed = rows.length ? rows : parseCsv(csvText);
    if (!parsed.length) {
      toast.error('No CSV rows to process');
      return;
    }
    if (asDryRun) setPreviewing(true); else setCommitting(true);
    try {
      const { data, error } = await invokeSecureFunction('finance-portal-admin', {
        operation: 'bulk_import_assignments',
        rows: parsed,
        dry_run: asDryRun,
      });
      if (error) throw new Error(error.message);
      setResults(data?.results || []);
      setSummary(data?.summary || null);
      setDryRun(asDryRun);
      if (asDryRun) {
        toast.success(`Preview: ${data.summary.created} new, ${data.summary.updated} updates, ${data.summary.errors} errors`);
      } else {
        toast.success(`Imported: ${data.summary.created} created, ${data.summary.updated} updated`);
      }
    } catch (e: any) {
      toast.error(e.message || 'Import failed');
    } finally {
      setPreviewing(false);
      setCommitting(false);
    }
  };

  return (
    <DashboardThemeFrame variant="page" className="space-y-6 p-4 sm:p-6">
      <DashboardThemeFrame variant="hero" as="header" className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight sm:text-3xl">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm shadow-primary/10">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <span className="truncate">Bulk Client Assignment</span>
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Upload a CSV to assign clients to finance partners in bulk with permission templates.
          </p>
        </div>
        <Button variant="outline" onClick={downloadSample} className="min-h-10 gap-2 rounded-xl border-border/70 bg-card/70 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/10 hover:text-primary">
          <Download className="h-4 w-4" /> Download CSV Template
        </Button>
      </DashboardThemeFrame>

      <DashboardThemeFrame variant="section" className="p-0">
      <Card className="border-0 bg-transparent shadow-none">
        <CardHeader className="border-b border-border/60 bg-gradient-to-r from-card/80 to-muted/25 p-4 sm:p-5">
          <CardTitle className="text-lg tracking-tight">1. Upload or paste CSV</CardTitle>
          <CardDescription className="leading-6">
            Required: <code className="text-primary">partner_email</code>. One of <code className="text-primary">client_email</code> or <code className="text-primary">client_name</code>.
            Optional: <code className="text-primary">permission_template</code> = <code>default</code> | <code>view_only</code> | <code>view_edit</code> | <code>full_access</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            aria-label="Upload finance portal assignment CSV"
            className="h-10 rounded-xl border-border/70 bg-background/75"
          />
          <Textarea
            rows={8}
            placeholder="Or paste CSV content here..."
            value={csvText}
            aria-label="Paste finance portal assignment CSV content"
            onChange={e => {
              setCsvText(e.target.value);
              setRows(parseCsv(e.target.value));
              setResults([]);
              setSummary(null);
            }}
            className="rounded-xl border-border/70 bg-background/75 font-mono text-xs shadow-inner focus-visible:ring-primary/35"
          />
          {rows.length > 0 && (
            <div className="inline-flex rounded-full border border-success/20 bg-success/10 px-3 py-1 text-sm text-success">
              Parsed <strong className="text-foreground">{rows.length}</strong> data rows.
            </div>
          )}
        </CardContent>
      </Card>
      </DashboardThemeFrame>

      <DashboardThemeFrame variant="section" className="p-0">
      <Card className="border-0 bg-transparent shadow-none">
        <CardHeader className="border-b border-border/60 bg-gradient-to-r from-card/80 to-muted/25 p-4 sm:p-5">
          <CardTitle className="text-lg tracking-tight">2. Preview & commit</CardTitle>
          <CardDescription className="leading-6">Always dry-run first to validate matches before applying changes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => submit(true)} disabled={previewing || rows.length === 0} aria-label="Run dry-run preview for bulk import" className="gap-2">
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Dry Run Preview
            </Button>
            <Button
              variant="default"
              onClick={() => submit(false)}
              disabled={committing || rows.length === 0 || (results.length > 0 && summary?.errors === rows.length)}
              className="gap-2"
            >
              {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Commit Import
            </Button>
          </div>

          {summary && (
            <Alert variant={summary.errors > 0 && summary.errors === summary.total ? 'destructive' : 'default'} className="rounded-2xl border-border/70 bg-card/80">
              {summary.errors > 0 ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              <AlertTitle>{dryRun ? 'Preview' : 'Import'} Result</AlertTitle>
              <AlertDescription>
                {summary.created} {dryRun ? 'would be created' : 'created'} · {summary.updated} {dryRun ? 'would be updated' : 'updated'} · {summary.errors} errors out of {summary.total} rows.
              </AlertDescription>
            </Alert>
          )}

          {results.length > 0 && (
            <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card/75 shadow-inner shadow-black/5 dark:bg-background/35">
              <Table className="min-w-[860px]" aria-label="Bulk import preview results">
                <TableHeader className="bg-muted/35">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-16">Row</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Partner</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Template</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map(r => (
                    <TableRow key={r.row} className="transition-colors hover:bg-primary/5">
                      <TableCell className="font-mono text-xs">{r.row}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-sm">{r.partner || '—'}</TableCell>
                      <TableCell className="text-sm">{r.client || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.template || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.message || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      </DashboardThemeFrame>
    </DashboardThemeFrame>
  );
}

function StatusBadge({ status }: { status: ResultRow['status'] }) {
  const map: Record<ResultRow['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    created:        { label: 'Created',       variant: 'default' },
    updated:        { label: 'Updated',       variant: 'secondary' },
    would_create:   { label: 'Will create',   variant: 'default' },
    would_update:   { label: 'Will update',   variant: 'secondary' },
    error:          { label: 'Error',         variant: 'destructive' },
  };
  const m = map[status];
  return <Badge variant={m.variant} className="text-[10px]">{m.label}</Badge>;
}
