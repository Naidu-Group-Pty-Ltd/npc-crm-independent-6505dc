/**
 * GoldenRegressionQualityGatePanel — Phase 9B.
 * Renders a Phase 8C quality gate report (summary + per-gate table). Pure display.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  PdfImportQualityGateReport,
  PdfImportQualityGateStatus,
} from '@/lib/reportTemplate/ingestion/qualityGates';

interface GoldenRegressionQualityGatePanelProps {
  report: PdfImportQualityGateReport | null;
}

function gateVariant(status: PdfImportQualityGateStatus | string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'pass': return 'default';
    case 'warning': return 'secondary';
    case 'fail': return 'destructive';
    case 'blocked': return 'destructive';
    default: return 'outline'; // not_evaluated
  }
}

export function GoldenRegressionQualityGatePanel({ report }: GoldenRegressionQualityGatePanelProps) {
  if (!report) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No quality gate report yet.
        </CardContent>
      </Card>
    );
  }

  const s = report.summary;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex flex-wrap items-center gap-2">
          Quality gates
          <Badge variant={gateVariant(report.overallStatus)}>{report.overallStatus}</Badge>
          <span className="text-xs font-normal text-muted-foreground">
            {s.total} gates · {s.pass} pass · {s.warning} warn · {s.fail} fail · {s.blocked} blocked · {s.notEvaluated} n/e
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Gate</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.gates.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="text-xs font-medium">{g.label}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{g.category}</TableCell>
                  <TableCell><Badge variant={gateVariant(g.status)} className="text-[10px] px-1 py-0">{g.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{g.severity}</TableCell>
                  <TableCell className="text-xs max-w-[360px]">{g.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default GoldenRegressionQualityGatePanel;
