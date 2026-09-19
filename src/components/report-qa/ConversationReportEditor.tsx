import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { 
  Loader2, 
  Download, 
  Eye, 
  Type, 
  FileText, 
  Sparkles, 
  RefreshCw 
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { fetchGlobalReportSettings } from '@/hooks/useGlobalReportSettings';
import { drawJsPDFDisclaimerPage } from '@/utils/pdfDisclaimerPage';
import jsPDF from 'jspdf';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
}

interface ConversationReportEditorProps {
  isOpen: boolean;
  onClose: () => void;
  messages: Message[];
  title: string;
  reportNames: string[];
  conversationId?: string | null;
}

export function ConversationReportEditor({ 
  isOpen, 
  onClose, 
  messages, 
  title, 
  reportNames,
  conversationId 
}: ConversationReportEditorProps) {
  const [reportContent, setReportContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [activeTab, setActiveTab] = useState('edit');
  const [hasEdited, setHasEdited] = useState(false);
  const { toast } = useToast();
  const initialContent = useRef('');

  useEffect(() => {
    if (isOpen && messages.length > 0) {
      loadCachedOrGenerate();
    }
  }, [isOpen]);

  const loadCachedOrGenerate = async () => {
    if (conversationId) {
      try {
        const { data, error } = await invokeSecureFunction('manage-client-data', {
          operation: 'list',
          table: 'report_qa_conversations',
          filters: { id: conversationId }
        });
        if (!error && data?.records?.length > 0 && data.records[0].structured_report) {
          setReportContent(data.records[0].structured_report);
          initialContent.current = data.records[0].structured_report;
          setHasEdited(false);
          setActiveTab('edit');
          return;
        }
      } catch (err) {
        console.warn('Could not load cached report:', err);
      }
    }
    if (!reportContent) {
      generateStructuredReport();
    }
  };

  const generateStructuredReport = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await invokeSecureFunction('report-qa', {
        action: 'summarize-conversation',
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        reportNames,
        title,
      });

      if (error) throw new Error(error.message);
      if (!data?.structuredReport) throw new Error('No report generated');

      setReportContent(data.structuredReport);
      initialContent.current = data.structuredReport;
      setHasEdited(false);
      setActiveTab('edit');

      // Persist to database
      if (conversationId) {
        invokeSecureFunction('manage-client-data', {
          operation: 'update',
          table: 'report_qa_conversations',
          id: conversationId,
          data: { structured_report: data.structuredReport }
        }).catch(err => console.warn('Failed to cache structured report:', err));
      }

      toast({
        title: 'Report generated',
        description: 'AI has structured your conversation into a report. Review and edit before exporting.',
      });
    } catch (err: any) {
      console.error('Failed to generate structured report:', err);
      toast({
        title: 'Generation failed',
        description: err.message || 'Failed to generate structured report',
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleContentChange = (value: string) => {
    setReportContent(value);
    setHasEdited(value !== initialContent.current);
  };

  const exportAsPDF = async () => {
    setIsExporting(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const usableWidth = pageWidth - margin * 2;
      let yPos = margin;

      // Fetch global settings for contact/disclaimer
      const globalSettings = await fetchGlobalReportSettings();
      const contact = globalSettings.contactDetails;
      const disclaimerSettings = globalSettings.disclaimer;

      const ensureSpace = (needed: number) => {
        if (yPos + needed > pageHeight - 25) {
          doc.addPage();
          yPos = margin;
        }
      };

      // ============= COVER PAGE =============
      // Try to load the QA cover image template
      let coverImageLoaded = false;
      try {
        const coverResponse = await fetch('/templates/npc-qa-cover.jpg');
        if (coverResponse.ok) {
          const coverBlob = await coverResponse.blob();
          const coverDataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(coverBlob);
          });
          doc.addImage(coverDataUrl, 'JPEG', 0, 0, pageWidth, pageHeight);
          coverImageLoaded = true;
        }
      } catch (e) {
        console.warn('Cover template not loaded, using fallback:', e);
      }

      if (!coverImageLoaded) {
        // Fallback programmatic cover page
        doc.setFillColor(15, 18, 25);
        doc.rect(0, 0, pageWidth, pageHeight, 'F');
        
        // Gold accent line
        doc.setDrawColor(191, 155, 80);
        doc.setLineWidth(0.8);
        doc.line(pageWidth * 0.3, pageHeight * 0.42, pageWidth * 0.7, pageHeight * 0.42);
      }

      // No overlay text on cover — the template image is used as-is

      const dateStr = new Date().toLocaleDateString('en-AU', {
        day: 'numeric', month: 'long', year: 'numeric'
      });

      // ============= CONTENT PAGES =============
      doc.addPage();
      yPos = margin;

      // Content page header
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageWidth, 35, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text(contact.company_name || 'Property Report', margin, 15);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text('Investment Property Analysis', margin, 22);
      doc.text(`Generated: ${dateStr}`, margin, 28);
      
      yPos = 45;
      doc.setTextColor(0, 0, 0);

      const sanitizeForPDF = (text: string): string => {
        // Strip markdown bold/italic
        let clean = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
        // Replace %æ sub-bullet markers with dash
        clean = clean.replace(/%æ\s*/g, '- ');
        // Replace common Unicode chars that cause letter-spacing issues in jsPDF
        clean = clean.replace(/[≤≥→←↑↓•·…—–‐‑−⁃''""″′]/g, (ch) => {
          const map: Record<string, string> = {
            '≤': '<=', '≥': '>=', '→': '->', '←': '<-', '↑': '^', '↓': 'v',
            '•': '-', '·': '-', '…': '...', '—': '--', '–': '-',
            '\u2010': '-', '\u2011': '-', '\u2212': '-', '\u2043': '-',
            '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"',
            '″': '"', '′': "'",
          };
          return map[ch] || ch;
        });
        // Fix "d$1M type artifacts (corrupted ≤$1M)
        clean = clean.replace(/"d\$/g, '<=$');
        // Replace any remaining non-ASCII chars that jsPDF can't render
        clean = clean.replace(/[^\x00-\x7F]/g, (ch) => {
          // Keep common extended latin chars
          if (/[àáâãäåèéêëìíîïòóôõöùúûüýÿñçÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝÑÇ×÷]/.test(ch)) return ch;
          return '';
        });
        return clean;
      };

      // Detect markdown table block
      const isTableLine = (line: string) => line.trim().startsWith('|') && line.trim().endsWith('|');
      const isSeparatorLine = (line: string) => /^\|[\s\-:]+(\|[\s\-:]+)+\|$/.test(line.trim());

      const drawTable = (tableLines: string[]) => {
        // Parse header, separator, and body
        const parseRow = (line: string) =>
          line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => sanitizeForPDF(c.trim()));

        const header = parseRow(tableLines[0]);
        const bodyLines = tableLines.slice(2); // skip separator
        const rows = bodyLines.map(parseRow);
        const colCount = header.length;

        // Calculate column widths proportionally
        const allRows = [header, ...rows];
        const colWidths: number[] = [];
        const totalChars = header.reduce((sum, h, i) => {
          const maxLen = Math.max(h.length, ...rows.map(r => (r[i] || '').length));
          colWidths.push(maxLen);
          return sum + maxLen;
        }, 0);
        const colWidthsMM = colWidths.map(w => Math.max((w / totalChars) * usableWidth, 25));
        // Normalize to fit usableWidth
        const totalMM = colWidthsMM.reduce((a, b) => a + b, 0);
        const scale = usableWidth / totalMM;
        const finalWidths = colWidthsMM.map(w => w * scale);

        const cellPadding = 2;
        const rowHeight = 8;

        // Estimate total height
        const totalHeight = (rows.length + 1) * rowHeight + 4;
        ensureSpace(Math.min(totalHeight, 60)); // at least fit header + a few rows

        // Draw header
        let xPos = margin;
        doc.setFillColor(240, 245, 255);
        doc.rect(margin, yPos - 5, usableWidth, rowHeight, 'F');
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        for (let i = 0; i < colCount; i++) {
          doc.text(header[i], xPos + cellPadding, yPos, { maxWidth: finalWidths[i] - cellPadding * 2 });
          xPos += finalWidths[i];
        }
        // Header border
        doc.setDrawColor(200, 210, 230);
        doc.setLineWidth(0.3);
        doc.line(margin, yPos + 3, margin + usableWidth, yPos + 3);
        yPos += rowHeight;

        // Draw body rows
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(51, 51, 51);
        for (const row of rows) {
          ensureSpace(rowHeight + 2);
          xPos = margin;
          for (let i = 0; i < colCount; i++) {
            const cellText = row[i] || '';
            doc.text(cellText, xPos + cellPadding, yPos, { maxWidth: finalWidths[i] - cellPadding * 2 });
            xPos += finalWidths[i];
          }
          // Row border
          doc.setDrawColor(230, 230, 230);
          doc.line(margin, yPos + 3, margin + usableWidth, yPos + 3);
          yPos += rowHeight;
        }
        yPos += 4;
      };

      const lines = reportContent.split('\n');
      let i = 0;
      
      while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        // Collect table block
        if (isTableLine(trimmed)) {
          const tableLines: string[] = [];
          while (i < lines.length && isTableLine(lines[i].trim())) {
            if (!isSeparatorLine(lines[i].trim()) || tableLines.length === 1) {
              tableLines.push(lines[i]);
            }
            i++;
          }
          if (tableLines.length >= 2) {
            drawTable(tableLines);
          }
          continue;
        }

        // Check for page break
        ensureSpace(8);

        if (!trimmed) {
          yPos += 4;
          i++;
          continue;
        }

        // H1 - also check next line has content to avoid orphan
        if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
          ensureSpace(20); // Prevent orphaned heading
          yPos += 4;
          doc.setFontSize(16);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(15, 23, 42);
          const h1Text = trimmed.replace(/^# /, '');
          const wrappedH1 = doc.splitTextToSize(h1Text, usableWidth);
          doc.text(wrappedH1, margin, yPos);
          yPos += wrappedH1.length * 7 + 2;
          doc.setDrawColor(59, 130, 246);
          doc.setLineWidth(0.5);
          doc.line(margin, yPos, pageWidth - margin, yPos);
          yPos += 6;
          i++;
          continue;
        }

        // H2
        if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
          ensureSpace(18);
          yPos += 3;
          doc.setFontSize(13);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(37, 99, 235);
          const h2Text = trimmed.replace(/^## /, '');
          const wrappedH2 = doc.splitTextToSize(h2Text, usableWidth);
          doc.text(wrappedH2, margin, yPos);
          yPos += wrappedH2.length * 6 + 4;
          i++;
          continue;
        }

        // H3
        if (trimmed.startsWith('### ') && !trimmed.startsWith('#### ')) {
          ensureSpace(16);
          yPos += 2;
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(30, 64, 175);
          const h3Text = trimmed.replace(/^### /, '');
          const wrappedH3 = doc.splitTextToSize(h3Text, usableWidth);
          doc.text(wrappedH3, margin, yPos);
          yPos += wrappedH3.length * 5 + 3;
          i++;
          continue;
        }

        // H4
        if (trimmed.startsWith('#### ')) {
          ensureSpace(14);
          yPos += 2;
          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(51, 65, 85);
          const h4Text = trimmed.replace(/^#### /, '');
          const wrappedH4 = doc.splitTextToSize(h4Text, usableWidth);
          doc.text(wrappedH4, margin, yPos);
          yPos += wrappedH4.length * 4.5 + 3;
          i++;
          continue;
        }

        // Horizontal rule
        if (trimmed === '---' || trimmed === '***') {
          yPos += 2;
          doc.setDrawColor(200, 200, 200);
          doc.setLineWidth(0.3);
          doc.line(margin, yPos, pageWidth - margin, yPos);
          yPos += 4;
          i++;
          continue;
        }

        // Numbered list items (e.g., "1. ", "2. ")
        if (/^\d+\.\s/.test(trimmed)) {
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(51, 51, 51);
          const match = trimmed.match(/^(\d+\.)\s(.*)$/);
          if (match) {
            const num = match[1];
            const text = sanitizeForPDF(match[2]);
            doc.setFont('helvetica', 'bold');
            doc.text(num, margin + 2, yPos);
            doc.setFont('helvetica', 'normal');
            const wrappedNum = doc.splitTextToSize(text, usableWidth - 12);
            ensureSpace(wrappedNum.length * 4.5 + 2);
            doc.text(wrappedNum, margin + 10, yPos);
            yPos += wrappedNum.length * 4.5 + 2;
          }
          i++;
          continue;
        }

        // Nested bullet points (- - or indented - or %æ sub-bullets)
        if (/^\s{2,}-\s/.test(line) || trimmed.startsWith('- -') || trimmed.startsWith('%æ') || trimmed.startsWith('%æ')) {
          doc.setFontSize(9);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(80, 80, 80);
          const bulletText = trimmed.replace(/^-\s*-\s*/, '').replace(/^-\s/, '').replace(/^%æ\s*/, '').replace(/^%æ\s*/, '');
          const cleanText = sanitizeForPDF(bulletText);
          const wrappedBullet = doc.splitTextToSize(cleanText, usableWidth - 16);
          ensureSpace(wrappedBullet.length * 4 + 2);
          doc.text('-', margin + 8, yPos);
          doc.text(wrappedBullet, margin + 14, yPos);
          yPos += wrappedBullet.length * 4 + 1.5;
          i++;
          continue;
        }

        // Bullet points
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(51, 51, 51);
          const bulletText = trimmed.replace(/^[-*] /, '');
          const cleanText = sanitizeForPDF(bulletText);
          const wrappedBullet = doc.splitTextToSize(cleanText, usableWidth - 10);
          ensureSpace(wrappedBullet.length * 4.5 + 2);
          doc.text('•', margin + 2, yPos);
          doc.text(wrappedBullet, margin + 8, yPos);
          yPos += wrappedBullet.length * 4.5 + 1.5;
          i++;
          continue;
        }

        // Italic/meta lines
        if (trimmed.startsWith('*') && trimmed.endsWith('*') && !trimmed.startsWith('**')) {
          doc.setFontSize(8);
          doc.setFont('helvetica', 'italic');
          doc.setTextColor(120, 120, 120);
          const metaText = trimmed.replace(/^\*|\*$/g, '');
          const wrappedMeta = doc.splitTextToSize(metaText, usableWidth);
          ensureSpace(wrappedMeta.length * 3.5 + 2);
          doc.text(wrappedMeta, margin, yPos);
          yPos += wrappedMeta.length * 3.5 + 2;
          i++;
          continue;
        }

        // Regular text
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(51, 51, 51);
        const cleanLine = sanitizeForPDF(trimmed);
        const wrappedText = doc.splitTextToSize(cleanLine, usableWidth);
        ensureSpace(wrappedText.length * 4.5 + 2);
        doc.text(wrappedText, margin, yPos);
        yPos += wrappedText.length * 4.5 + 2;
        i++;
      }
      // ============= DISCLAIMER & CONTACT PAGE =============
      drawJsPDFDisclaimerPage(doc, contact, disclaimerSettings);

      // Footer on each page (skip cover page = page 1, skip disclaimer = last page)
      const totalPages = doc.getNumberOfPages();
      const companyFooterName = contact.company_name || 'Property Report';
      for (let i = 1; i <= totalPages; i++) {
        // Skip cover (page 1) and disclaimer (last page)
        if (i === 1 || i === totalPages) continue;
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(150, 150, 150);
        doc.text(
          `${companyFooterName} -- Confidential -- Page ${i - 1} of ${totalPages - 2}`,
          pageWidth / 2,
          pageHeight - 8,
          { align: 'center' }
        );
      }

      const sanitizedTitle = title.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
      doc.save(`${sanitizedTitle}_report.pdf`);

      toast({
        title: 'PDF exported',
        description: 'Your structured report has been downloaded.',
      });
    } catch (err: any) {
      console.error('PDF export failed:', err);
      toast({
        title: 'Export failed',
        description: err.message || 'Failed to generate PDF',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const exportAsMarkdown = () => {
    const blob = new Blob([reportContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]/gi, '_').substring(0, 50)}_report.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: 'Markdown exported',
      description: 'Your structured report has been downloaded as markdown.',
    });
  };

  const handleClose = () => {
    if (hasEdited) {
      if (!confirm('You have unsaved edits. Are you sure you want to close?')) return;
    }
    setReportContent('');
    setHasEdited(false);
    initialContent.current = '';
    onClose();
  };

  // Markdown rendering components
  const markdownComponents = {
    h1: ({ children }: any) => (
      <h1 className="text-2xl font-bold mt-8 mb-4 text-foreground border-b pb-2">{children}</h1>
    ),
    h2: ({ children }: any) => (
      <h2 className="text-xl font-semibold mt-6 mb-3 text-primary">{children}</h2>
    ),
    h3: ({ children }: any) => (
      <h3 className="text-lg font-medium mt-4 mb-2 text-foreground">{children}</h3>
    ),
    p: ({ children }: any) => (
      <p className="mb-4 leading-relaxed text-foreground">{children}</p>
    ),
    ul: ({ children }: any) => (
      <ul className="mb-4 space-y-2 list-disc list-inside">{children}</ul>
    ),
    ol: ({ children }: any) => (
      <ol className="mb-4 space-y-2 list-decimal list-inside">{children}</ol>
    ),
    li: ({ children }: any) => (
      <li className="text-foreground leading-relaxed pl-2">{children}</li>
    ),
    table: ({ children }: any) => (
      <div className="not-prose overflow-x-auto my-8">
        <table className="min-w-full border-collapse border-2 border-border shadow-sm">{children}</table>
      </div>
    ),
    thead: ({ children }: any) => (
      <thead className="bg-gradient-to-r from-primary/10 to-primary/5 border-b-2 border-border">{children}</thead>
    ),
    tbody: ({ children }: any) => <tbody className="divide-y divide-border">{children}</tbody>,
    th: ({ children }: any) => (
      <th className="border border-border px-6 py-3 text-left font-bold text-foreground bg-muted/50">{children}</th>
    ),
    td: ({ children }: any) => (
      <td className="border border-border px-6 py-3 text-foreground">{children}</td>
    ),
    strong: ({ children }: any) => <strong className="font-semibold text-foreground">{children}</strong>,
    em: ({ children }: any) => <em className="italic text-muted-foreground">{children}</em>,
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-4 border-primary pl-4 my-4 italic text-muted-foreground">{children}</blockquote>
    ),
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Export Conversation Report
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            AI has structured your conversation into a professional report. Review, edit, then export.
          </p>
        </DialogHeader>

        {isGenerating ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-16">
            <div className="relative">
              <Sparkles className="h-8 w-8 text-primary animate-pulse" />
            </div>
            <div className="text-center space-y-2">
              <p className="font-medium text-foreground">Structuring your conversation...</p>
              <p className="text-sm text-muted-foreground">
                AI is analyzing {messages.length} messages and creating a professional report
              </p>
            </div>
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden min-h-0 h-0">
              <TabsList className="grid w-full grid-cols-2 mb-4 flex-shrink-0">
                <TabsTrigger value="edit" className="flex items-center gap-2">
                  <Type className="h-4 w-4" />
                  Edit Report
                </TabsTrigger>
                <TabsTrigger value="preview" className="flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Preview
                </TabsTrigger>
              </TabsList>

              <TabsContent value="edit" className="flex-1 overflow-hidden mt-0 min-h-0 data-[state=active]:flex flex-col">
                <ScrollArea className="flex-1 border rounded-md">
                  <Textarea
                    value={reportContent}
                    onChange={(e) => handleContentChange(e.target.value)}
                    placeholder="Report content will appear here..."
                    className="w-full min-h-[500px] resize-none border-0 focus-visible:ring-0 p-4 font-mono text-sm"
                  />
                </ScrollArea>
              </TabsContent>

              <TabsContent value="preview" className="flex-1 overflow-hidden mt-0 min-h-0 data-[state=active]:flex flex-col">
                <div className="flex-1 border rounded-md overflow-y-auto">
                  <div className="p-6">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {reportContent}
                    </ReactMarkdown>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}

        <DialogFooter className="flex-shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {hasEdited && (
              <Badge variant="outline" className="text-warning border-warning/30 text-xs">
                Edited
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {reportContent.length} chars • {messages.length} messages processed
            </span>
          </div>
          
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={generateStructuredReport}
              disabled={isGenerating}
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${isGenerating ? 'animate-spin' : ''}`} />
              Regenerate
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={exportAsMarkdown}
              disabled={!reportContent || isGenerating}
            >
              <Download className="h-3 w-3 mr-1" />
              Markdown
            </Button>
            <Button 
              size="sm"
              onClick={exportAsPDF}
              disabled={!reportContent || isGenerating || isExporting}
            >
              {isExporting ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Download className="h-3 w-3 mr-1" />
              )}
              Export PDF
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
