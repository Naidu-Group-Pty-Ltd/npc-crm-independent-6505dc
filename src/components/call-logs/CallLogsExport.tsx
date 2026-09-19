import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FlattenPdfIconButton } from '@/components/common/FlattenPdfIconButton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { format } from 'date-fns';
import jsPDF from 'jspdf';

interface CallLog {
  id: string;
  vapi_call_id: string;
  agent_name: string | null;
  phone_number: string | null;
  customer_name: string | null;
  call_direction: string | null;
  call_outcome: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  cost: number | null;
  summary: string | null;
  sentiment: string | null;
  squad_name: string | null;
  call_intent: string | null;
}

interface CallStats {
  totalCalls: number;
  completedCalls: number;
  successRate: number;
  avgDuration: number;
  totalCost: number;
  inboundCalls: number;
  outboundCalls: number;
  voicemails: number;
  squadCalls: number;
}

interface CallLogsExportProps {
  calls: CallLog[];
  stats: CallStats;
  triggerClassName?: string;
}

export const CallLogsExport = ({ calls, stats, triggerClassName }: CallLogsExportProps) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'pdf'>('csv');
  const [includeAnalytics, setIncludeAnalytics] = useState(true);
  const [includeTranscripts, setIncludeTranscripts] = useState(false);

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const exportToCSV = () => {
    const headers = [
      'Call ID',
      'Customer Name',
      'Phone Number',
      'Agent',
      'Direction',
      'Outcome',
      'Sentiment',
      'Duration',
      'Cost',
      'Squad',
      'Intent',
      'Started At',
      'Summary'
    ];

    const rows = calls.map(call => [
      call.vapi_call_id,
      call.customer_name || '',
      call.phone_number || '',
      call.agent_name || '',
      call.call_direction || '',
      call.call_outcome || '',
      call.sentiment || '',
      formatDuration(call.duration_seconds),
      call.cost?.toFixed(4) || '0',
      call.squad_name || '',
      call.call_intent || '',
      call.started_at ? format(new Date(call.started_at), 'yyyy-MM-dd HH:mm:ss') : '',
      (call.summary || '').replace(/"/g, '""')
    ]);

    let csvContent = headers.join(',') + '\n';
    csvContent += rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    if (includeAnalytics) {
      csvContent += '\n\n"Analytics Summary"\n';
      csvContent += `"Total Calls","${stats.totalCalls}"\n`;
      csvContent += `"Completed Calls","${stats.completedCalls}"\n`;
      csvContent += `"Success Rate","${stats.successRate}%"\n`;
      csvContent += `"Average Duration","${formatDuration(stats.avgDuration)}"\n`;
      csvContent += `"Total Cost","$${stats.totalCost.toFixed(2)}"\n`;
      csvContent += `"Inbound Calls","${stats.inboundCalls}"\n`;
      csvContent += `"Outbound Calls","${stats.outboundCalls}"\n`;
      csvContent += `"Voicemails","${stats.voicemails}"\n`;
      csvContent += `"Squad Calls","${stats.squadCalls}"\n`;
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `call-logs-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);

    toast({
      title: 'Export Complete',
      description: `Exported ${calls.length} call logs to CSV`,
    });
    setOpen(false);
  };

  const buildPdfDoc = () => {
    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();
    let yPos = 20;

    pdf.setFontSize(20);
    pdf.setTextColor(0, 0, 0);
    pdf.text('Call Logs Report', pageWidth / 2, yPos, { align: 'center' });
    yPos += 10;

    pdf.setFontSize(10);
    pdf.setTextColor(100, 100, 100);
    pdf.text(`Generated: ${format(new Date(), 'PPpp')}`, pageWidth / 2, yPos, { align: 'center' });
    yPos += 15;

    if (includeAnalytics) {
      pdf.setFontSize(14);
      pdf.setTextColor(0, 0, 0);
      pdf.text('Analytics Summary', 14, yPos);
      yPos += 8;

      pdf.setFontSize(10);
      pdf.setTextColor(60, 60, 60);
      const analyticsData = [
        ['Total Calls', stats.totalCalls.toString()],
        ['Completed Calls', stats.completedCalls.toString()],
        ['Success Rate', `${stats.successRate}%`],
        ['Avg Duration', formatDuration(stats.avgDuration)],
        ['Total Cost', `$${stats.totalCost.toFixed(2)}`],
        ['Inbound', stats.inboundCalls.toString()],
        ['Outbound', stats.outboundCalls.toString()],
        ['Squad Calls', stats.squadCalls.toString()],
      ];

      const colWidth = (pageWidth - 28) / 4;
      analyticsData.forEach((item, index) => {
        const col = index % 4;
        const row = Math.floor(index / 4);
        const x = 14 + col * colWidth;
        const y = yPos + row * 15;
        pdf.setFontSize(8);
        pdf.setTextColor(100, 100, 100);
        pdf.text(item[0], x, y);
        pdf.setFontSize(12);
        pdf.setTextColor(0, 0, 0);
        pdf.text(item[1], x, y + 5);
      });

      yPos += 40;
    }

    pdf.setFontSize(14);
    pdf.setTextColor(0, 0, 0);
    pdf.text('Call Details', 14, yPos);
    yPos += 8;

    const headers = ['Customer', 'Phone', 'Agent', 'Direction', 'Outcome', 'Duration', 'Cost'];
    // 2mm gutter is reserved inside each column by truncateToWidth below.
    const colWidths = [32, 27, 26, 18, 34, 15, 15];

    // Every cell is measured and truncated to its own column, so a long
    // outcome ("customer-did-not-answer") can never run into Duration/Cost.
    const truncateToWidth = (text: string, maxWidth: number) => {
      if (pdf.getTextWidth(text) <= maxWidth) return text;
      let truncated = text;
      while (truncated.length > 1 && pdf.getTextWidth(`${truncated}…`) > maxWidth) {
        truncated = truncated.slice(0, -1);
      }
      return `${truncated}…`;
    };

    const drawTableHeader = () => {
      pdf.setFillColor(240, 240, 240);
      pdf.rect(14, yPos - 4, pageWidth - 28, 8, 'F');
      pdf.setFontSize(8);
      pdf.setTextColor(60, 60, 60);
      let headerX = 14;
      headers.forEach((header, i) => {
        pdf.text(header, headerX, yPos);
        headerX += colWidths[i];
      });
      yPos += 8;
      pdf.setTextColor(0, 0, 0);
    };

    drawTableHeader();

    // Export every filtered call — the reader asked for the register, not a
    // sample — repeating the column header at the top of each page.
    calls.forEach((call, index) => {
      if (yPos > 270) {
        pdf.addPage();
        yPos = 20;
        drawTableHeader();
      }
      const row = [
        call.customer_name || 'Unknown',
        call.phone_number || '-',
        call.agent_name || '-',
        call.call_direction || '-',
        call.call_outcome || '-',
        formatDuration(call.duration_seconds),
        `$${call.cost?.toFixed(2) || '0.00'}`,
      ];
      if (index % 2 === 0) {
        pdf.setFillColor(248, 248, 248);
        pdf.rect(14, yPos - 4, pageWidth - 28, 7, 'F');
      }
      pdf.setFontSize(7);
      let xPos = 14;
      row.forEach((cell, i) => {
        pdf.text(truncateToWidth(cell, colWidths[i] - 2), xPos, yPos);
        xPos += colWidths[i];
      });
      yPos += 7;
    });

    return pdf;
  };

  const callLogsPdfFilename = () => `call-logs-${format(new Date(), 'yyyy-MM-dd')}.pdf`;

  const exportToPDF = () => {
    const pdf = buildPdfDoc();
    pdf.save(callLogsPdfFilename());
    toast({ title: 'Export Complete', description: `Exported call logs to PDF` });
    setOpen(false);
  };

  const handleExport = () => {
    if (exportFormat === 'csv') {
      exportToCSV();
    } else {
      exportToPDF();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={`gap-2 ${triggerClassName || ''}`}>
          <Download className="w-4 h-4 shrink-0" />
          Export
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Call Logs</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-3">
            <Label>Export Format</Label>
            <RadioGroup
              value={exportFormat}
              onValueChange={(v) => setExportFormat(v as 'csv' | 'pdf')}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="csv" id="csv" />
                <Label htmlFor="csv" className="flex items-center gap-2 cursor-pointer">
                  <FileSpreadsheet className="w-4 h-4 text-success" />
                  CSV
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="pdf" id="pdf" />
                <Label htmlFor="pdf" className="flex items-center gap-2 cursor-pointer">
                  <FileText className="w-4 h-4 text-destructive" />
                  PDF
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-3">
            <Label>Include</Label>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="analytics"
                  checked={includeAnalytics}
                  onCheckedChange={(checked) => setIncludeAnalytics(checked as boolean)}
                />
                <Label htmlFor="analytics" className="cursor-pointer">
                  Analytics Summary
                </Label>
              </div>
              {exportFormat === 'csv' && (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="transcripts"
                    checked={includeTranscripts}
                    onCheckedChange={(checked) => setIncludeTranscripts(checked as boolean)}
                  />
                  <Label htmlFor="transcripts" className="cursor-pointer">
                    Call Summaries
                  </Label>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-muted p-3">
            <p className="text-sm text-muted-foreground">
              <strong>{calls.length}</strong> calls will be exported with current filters applied.
            </p>
          </div>

          <div className="flex items-center gap-1">
            <Button onClick={handleExport} className="flex-1">
              <Download className="w-4 h-4 mr-2" />
              Export {exportFormat.toUpperCase()}
            </Button>
            {exportFormat === 'pdf' && (
              <FlattenPdfIconButton
                getPdfBlob={async () => buildPdfDoc().output('blob')}
                filename={callLogsPdfFilename()}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
