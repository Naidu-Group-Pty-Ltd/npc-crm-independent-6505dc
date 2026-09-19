/**
 * PdfImportClientReportPreview — Phase 11G.
 *
 * Presentational preview of a sanitized client-safe report payload. Shows the
 * title, audience, safety badge, summary, sections, and redaction count. Never
 * renders raw artifacts, signed URLs, or storage paths (the payload is already
 * sanitized).
 */
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getPdfImportClientReportAudienceLabel,
  getPdfImportClientReportSafetyLabel,
  getPdfImportClientReportSafetyTone,
  getPdfImportClientReportTypeLabel,
  type PdfImportClientReportPayload,
} from '@/lib/reportTemplate/ingestion/clientReports';

interface Props {
  payload: PdfImportClientReportPayload | null;
  canSave?: boolean;
  onSave?: () => void;
}

const SECTION_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pass: 'default', warning: 'secondary', fail: 'destructive', info: 'outline', not_applicable: 'outline',
};

export function PdfImportClientReportPreview({ payload }: Props) {
  if (!payload) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Generate a preview to see the client-safe report here.
        </CardContent>
      </Card>
    );
  }

  const blocked = payload.safetyLevel === 'blocked' || payload.safetyLevel === 'internal_only';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{getPdfImportClientReportTypeLabel(payload.reportType)}</Badge>
          <Badge variant="outline">{getPdfImportClientReportAudienceLabel(payload.audience)}</Badge>
          <Badge variant={getPdfImportClientReportSafetyTone(payload.safetyLevel)}>
            {getPdfImportClientReportSafetyLabel(payload.safetyLevel)}
          </Badge>
        </div>
        <CardTitle className="mt-2 text-base">{payload.title}</CardTitle>
        <p className="text-sm text-muted-foreground">{payload.summary}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {blocked && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            This report is {payload.safetyLevel === 'blocked' ? 'blocked' : 'internal only'} and must not be sent externally.
          </div>
        )}
        {payload.sections.map((s) => (
          <div key={s.id} className="rounded-md border p-3">
            <div className="flex items-center gap-2">
              <Badge variant={SECTION_TONE[s.status] ?? 'outline'}>{s.status}</Badge>
              <span className="text-sm font-medium">{s.title}</span>
            </div>
            {s.body && <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>}
            {s.items.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                {s.items.map((it, i) => <li key={i}>{it}</li>)}
              </ul>
            )}
          </div>
        ))}
        <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          No raw PDFs, screenshots, signed URLs, storage paths, or logs are included.
          {payload.redactions.length > 0 && ` ${payload.redactions.length} field(s) were redacted for safety.`}
        </div>
        <div className="text-[11px] text-muted-foreground">Generated: {payload.generatedAt}</div>
      </CardContent>
    </Card>
  );
}

export default PdfImportClientReportPreview;
