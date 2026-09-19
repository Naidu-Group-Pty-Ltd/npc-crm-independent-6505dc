import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Package, Download, FileWarning, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { toast } from 'sonner';
import JSZip from 'jszip';
import jsPDF from 'jspdf';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileLock2 } from 'lucide-react';
import { flattenPdfBlob } from '@/lib/pdf/flattenPdf';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fileId: string;
}

interface ManifestFile {
  sequence: number;
  packet_filename: string;
  original_filename: string;
  signed_url: string;
  category: string;
  label: string;
  mime_type: string;
  file_size: number;
  quality_status?: 'ok' | 'warning' | 'error' | 'unchecked';
  detected_date?: string | null;
  requirement_status?: string;
}

interface Gap { id: string; label: string; category?: string; quality_status?: string; quality_flags?: any }
interface Manifest {
  meta: any;
  files: ManifestFile[];
  gaps?: { missing_required: Gap[]; quality_issues: Gap[] };
}

const QUALITY_TONE: Record<string, { tone: string; label: string }> = {
  ok:        { tone: 'bg-success/15 text-success', label: 'OK' },
  warning:   { tone: 'bg-brand-500/15 text-brand-500',     label: 'Warning' },
  error:     { tone: 'bg-destructive/15 text-destructive', label: 'Error' },
  unchecked: { tone: 'bg-muted text-muted-foreground',     label: 'Unchecked' },
};

export function LenderPacketDialog({ open, onOpenChange, fileId }: Props) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [loading, setLoading] = useState(false);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [building, setBuilding] = useState(false);

  const fetchManifest = async () => {
    setLoading(true);
    try {
      const { data, error } = await invokeFinanceFunction('finance-portal-lender-packet', {
        purchase_file_id: fileId,
      });
      if (error) throw new Error(error.message);
      const m = data as Manifest;
      setManifest(m);
      setSelected(new Set(m.files.map(f => f.sequence)));
    } catch (e: any) {
      toast.error(e.message || 'Failed to load packet');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (seq: number) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(seq) ? n.delete(seq) : n.add(seq);
      return n;
    });
  };

  const buildCoverSheet = (m: Manifest, includedFiles: ManifestFile[]): Uint8Array => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    let y = 56;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('Lender Submission Packet', 40, y);
    y += 28;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Generated ${new Date(m.meta.generated_at).toLocaleString('en-AU')} by ${m.meta.generated_by}`, 40, y);
    y += 22;
    doc.setTextColor(20);

    // File summary
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('Purchase File', 40, y); y += 16;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    const addLine = (k: string, v: any) => {
      if (v === null || v === undefined || v === '') return;
      doc.setTextColor(120); doc.text(`${k}`, 40, y);
      doc.setTextColor(20); doc.text(String(v), 160, y);
      y += 14;
    };
    addLine('Title', m.meta.file?.title);
    addLine('Lender', m.meta.file?.lender_name);
    addLine('Loan amount', m.meta.file?.loan_amount ? `$${Number(m.meta.file.loan_amount).toLocaleString('en-AU')}` : null);
    addLine('Property', m.meta.file?.property_address);
    addLine('Settlement', m.meta.file?.settlement_date);
    addLine('Status', m.meta.file?.status);
    if (m.meta.client) {
      y += 8;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.text('Applicant', 40, y); y += 16;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
      addLine('Name', m.meta.client.name);
      addLine('Email', m.meta.client.email);
      addLine('Phone', m.meta.client.phone);
    }

    // Borrowing snapshot
    if (m.meta.borrowing_snapshot) {
      y += 8;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.text('Borrowing Snapshot', 40, y); y += 16;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
      const s = m.meta.borrowing_snapshot;
      addLine('Max borrow', s.max_borrowing_capacity ? `$${Number(s.max_borrowing_capacity).toLocaleString('en-AU')}` : null);
      addLine('Total income', s.total_income ? `$${Number(s.total_income).toLocaleString('en-AU')}` : null);
      addLine('Total expenses', s.total_expenses ? `$${Number(s.total_expenses).toLocaleString('en-AU')}` : null);
    }

    // Conditions
    if (m.meta.conditions?.length) {
      y += 8;
      if (y > 700) { doc.addPage(); y = 56; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.text('Conditions Ledger', 40, y); y += 16;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      for (const c of m.meta.conditions) {
        if (y > 760) { doc.addPage(); y = 56; }
        doc.setTextColor(120); doc.text(`[${c.status}]`, 40, y);
        doc.setTextColor(20); doc.text(c.label.slice(0, 70), 110, y);
        if (c.due_date) { doc.setTextColor(120); doc.text(`due ${c.due_date}`, 440, y); }
        y += 13;
      }
    }

    // Document index
    doc.addPage(); y = 56;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text('Document Index', 40, y); y += 22;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text('#', 40, y); doc.text('Category', 70, y); doc.text('Filename', 200, y); doc.text('Quality', 480, y);
    y += 6;
    doc.setDrawColor(200); doc.line(40, y, W - 40, y); y += 12;
    doc.setTextColor(20);
    for (const f of includedFiles) {
      if (y > 780) { doc.addPage(); y = 56; }
      doc.text(String(f.sequence), 40, y);
      doc.text(f.category.replace(/_/g, ' ').slice(0, 22), 70, y);
      doc.text(f.label.slice(0, 50), 200, y);
      doc.text((f.quality_status || 'unchecked').toUpperCase(), 480, y);
      y += 13;
    }

    return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
  };

  const build = async (flatten: boolean = false) => {
    if (!manifest) return;
    const included = manifest.files.filter(f => selected.has(f.sequence));
    if (!included.length) { toast.error('Select at least one document'); return; }
    setBuilding(true);
    try {
      const zip = new JSZip();
      if (flatten) toast.loading('Flattening each PDF…', { id: 'lender-flatten' });
      // Fetch all files in parallel
      const blobs = await Promise.all(included.map(async (f) => {
        const res = await fetch(f.signed_url);
        if (!res.ok) throw new Error(`Failed to fetch ${f.original_filename}`);
        let blob = await res.blob();
        if (flatten && (f.mime_type === 'application/pdf' || /\.pdf$/i.test(f.original_filename))) {
          blob = await flattenPdfBlob(blob);
        }
        return { f, blob };
      }));
      for (const { f, blob } of blobs) {
        zip.file(f.packet_filename, blob);
      }
      // Cover sheet — flatten too if requested
      const coverBytes = buildCoverSheet(manifest, included);
      let cover: Blob = new Blob([coverBytes as BlobPart], { type: 'application/pdf' });
      if (flatten) {
        cover = await flattenPdfBlob(cover);
      }
      zip.file('00 - Cover Sheet.pdf', cover);

      const out = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(out);
      const a = document.createElement('a');
      const safeTitle = (manifest.meta.file?.title || 'Lender Packet').replace(/[^a-zA-Z0-9._ -]/g, '_');
      const filename = `${safeTitle}${flatten ? ' - Flattened' : ''} - Lender Packet.zip`;
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      // Persist packet history
      try {
        await invokeFinanceFunction('finance-portal-lender-packet', {
          operation: 'record_generated',
          purchase_file_id: fileId,
          lender_name: manifest.meta.file?.lender_name,
          filename,
          file_count: included.length + 1,
          total_size_bytes: out.size,
          missing_required_count: manifest.gaps?.missing_required?.length || 0,
          missing_required: manifest.gaps?.missing_required || [],
          quality_flags: manifest.gaps?.quality_issues || [],
          manifest: { files: included.map(f => ({ seq: f.sequence, name: f.packet_filename, cat: f.category })) },
        });
      } catch (e) { console.warn('packet history failed', e); }

      if (flatten) toast.dismiss('lender-flatten');
      toast.success(`${flatten ? 'Flattened packet' : 'Packet'} built: ${included.length + 1} files`);
      onOpenChange(false);
    } catch (e: any) {
      if (flatten) toast.dismiss('lender-flatten');
      toast.error(e.message || 'Build failed');
    } finally {
      setBuilding(false);
    }
  };

  // Auto-fetch on open
  if (open && !manifest && !loading) fetchManifest();

  const close = (v: boolean) => {
    if (!v) { setManifest(null); setSelected(new Set()); }
    onOpenChange(v);
  };

  const errorCount = manifest?.files.filter(f => f.quality_status === 'error').length || 0;
  const warnCount = manifest?.files.filter(f => f.quality_status === 'warning').length || 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" /> Lender Packet
          </DialogTitle>
          <DialogDescription>
            Bundle the linked documents into a lender-ready ZIP with a cover sheet.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Building manifest…
          </div>
        )}

        {manifest && (
          <>
            <div className="flex flex-wrap gap-3 text-sm">
              <Badge variant="outline">Lender: {manifest.meta.file?.lender_name || 'N/A'}</Badge>
              <Badge variant="outline">{manifest.files.length} documents</Badge>
              {errorCount > 0 && (
                <Badge className="bg-destructive/15 text-destructive border-destructive/20">
                  <FileWarning className="h-3 w-3 mr-1" /> {errorCount} quality error(s)
                </Badge>
              )}
              {warnCount > 0 && (
                <Badge className="bg-brand-500/15 text-brand-500 border-brand-500/20">
                  <AlertTriangle className="h-3 w-3 mr-1" /> {warnCount} warning(s)
                </Badge>
              )}
            </div>

            {manifest.gaps?.missing_required?.length ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <p className="font-medium text-destructive flex items-center gap-1.5 mb-1">
                  <FileWarning className="h-4 w-4" /> {manifest.gaps.missing_required.length} required documents still missing
                </p>
                <ul className="text-xs text-destructive/80 list-disc list-inside space-y-0.5">
                  {manifest.gaps.missing_required.slice(0, 5).map(g => (
                    <li key={g.id}>{g.label} <span className="opacity-60">({g.category?.replace(/_/g,' ')})</span></li>
                  ))}
                  {manifest.gaps.missing_required.length > 5 && <li>…and {manifest.gaps.missing_required.length - 5} more</li>}
                </ul>
              </div>
            ) : (
              <div className="rounded-lg border border-success/30 bg-success/5 p-2.5 text-xs text-success flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> All required documents present.
              </div>
            )}

            <ScrollArea className="flex-1 -mx-6 px-6">
              <div className="space-y-2 py-2">
                {manifest.files.length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-8">
                    No uploaded documents on this file yet.
                  </div>
                )}
                {manifest.files.map(f => {
                  const q = QUALITY_TONE[f.quality_status || 'unchecked'];
                  return (
                    <label
                      key={f.sequence}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-2.5 cursor-pointer transition-colors',
                        selected.has(f.sequence) && 'border-primary/40 bg-primary/5',
                      )}
                    >
                      <Checkbox
                        checked={selected.has(f.sequence)}
                        onCheckedChange={() => toggle(f.sequence)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="font-medium text-sm truncate">
                            <span className="text-muted-foreground mr-1">{String(f.sequence).padStart(2, '0')}.</span>
                            {f.label}
                          </p>
                          <span className={cn('text-[10px] px-1.5 py-0.5 rounded', q.tone)}>{q.label}</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {f.category.replace(/_/g, ' ')} · {f.original_filename}
                          {f.detected_date && ` · dated ${f.detected_date}`}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </ScrollArea>
          </>
        )}

        <DialogFooter className="flex-shrink-0">
          <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
          <Button variant="outline" onClick={() => { void build(true); }} disabled={!manifest || building || selected.size === 0} className="gap-1.5" title="Each PDF inside the ZIP will be rasterised — no selectable text">
            {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileLock2 className="h-4 w-4" />}
            Build Flattened ZIP
          </Button>
          <Button onClick={() => { void build(false); }} disabled={!manifest || building || selected.size === 0} className="gap-1.5">
            {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Build ZIP ({selected.size} + cover)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
