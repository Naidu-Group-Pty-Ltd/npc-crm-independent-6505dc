/**
 * PdfImportClientReportPanel — Phase 11G report generator form.
 *
 * Presentational form for generating a client-safe report preview and saving a
 * draft. All actions are permission-gated by the parent. No network calls here.
 */
import { useState } from 'react';
import { Loader2, PlayCircle, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  PDF_IMPORT_CLIENT_REPORT_AUDIENCES,
  PDF_IMPORT_CLIENT_REPORT_TYPES,
  getPdfImportClientReportAudienceLabel,
  getPdfImportClientReportTypeLabel,
  type BuildPdfImportClientReportOptions,
  type PdfImportClientReportAudience,
  type PdfImportClientReportType,
} from '@/lib/reportTemplate/ingestion/clientReports';

interface Props {
  canGenerate: boolean;
  canSave: boolean;
  generating: boolean;
  saving: boolean;
  hasPreview: boolean;
  onGeneratePreview: (options: BuildPdfImportClientReportOptions) => void;
  onSaveDraft: () => void;
}

export function PdfImportClientReportPanel({
  canGenerate, canSave, generating, saving, hasPreview, onGeneratePreview, onSaveDraft,
}: Props) {
  const [reportType, setReportType] = useState<PdfImportClientReportType>('import_status_summary');
  const [audience, setAudience] = useState<PdfImportClientReportAudience>('external_client');
  const [importId, setImportId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [operatorNote, setOperatorNote] = useState('');

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Generate client-safe report</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs text-muted-foreground">Report type</label>
            <Select value={reportType} onValueChange={(v) => setReportType(v as PdfImportClientReportType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PDF_IMPORT_CLIENT_REPORT_TYPES.map((t) => <SelectItem key={t} value={t}>{getPdfImportClientReportTypeLabel(t)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Audience</label>
            <Select value={audience} onValueChange={(v) => setAudience(v as PdfImportClientReportAudience)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PDF_IMPORT_CLIENT_REPORT_AUDIENCES.map((a) => <SelectItem key={a} value={a}>{getPdfImportClientReportAudienceLabel(a)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Import ID</label>
            <Input value={importId} onChange={(e) => setImportId(e.target.value)} placeholder="template_imports.id" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Template ID (optional)</label>
            <Input value={templateId} onChange={(e) => setTemplateId(e.target.value)} placeholder="report_templates.id" />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Approved operator note (optional, client-safe)</label>
          <Textarea value={operatorNote} onChange={(e) => setOperatorNote(e.target.value)} rows={2} placeholder="Client-safe note only — no internal details." />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!canGenerate || generating}
            onClick={() => onGeneratePreview({ reportType, audience, importId: importId.trim() || null, templateId: templateId.trim() || null, operatorNote: operatorNote.trim() || null })}
            title={!canGenerate ? 'Requires generate_client_report_preview' : undefined}
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            <span className="ml-1">Generate preview</span>
          </Button>
          <Button size="sm" variant="outline" disabled={!canSave || !hasPreview || saving} onClick={onSaveDraft} title={!canSave ? 'Requires save_client_report_draft' : undefined}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            <span className="ml-1">Save draft</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default PdfImportClientReportPanel;
