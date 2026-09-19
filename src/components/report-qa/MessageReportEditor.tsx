import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { 
  Loader2, 
  Download, 
  Eye, 
  Type, 
  FileText, 
  RefreshCw 
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { fetchGlobalReportSettings } from '@/hooks/useGlobalReportSettings';
import { drawJsPDFDisclaimerPage } from '@/utils/pdfDisclaimerPage';
import jsPDF from 'jspdf';

import { ReportQaDownloadButton } from './ReportQaDownloadButton';

interface MessageReportEditorProps {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  messageId: string;
  /** Needed by the typeset export, which reads the answer from the record. */
  conversationId?: string | null;
  title: string;
  reportNames: string[];
}

export function MessageReportEditor({ 
  isOpen, 
  onClose, 
  content: originalContent, 
  messageId,
  conversationId,
  title, 
  reportNames 
}: MessageReportEditorProps) {
  const [reportContent, setReportContent] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [activeTab, setActiveTab] = useState('edit');
  const [hasEdited, setHasEdited] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();
  const initialContent = useRef('');

  // Load content: use persisted edited_content if available, otherwise use original
  useEffect(() => {
    if (isOpen) {
      loadPersistedContent();
    }
  }, [isOpen, messageId]);

  const loadPersistedContent = async () => {
    try {
      // Try to load persisted edited content from database
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'list',
        table: 'report_qa_messages',
        filters: { id: messageId }
      });

      if (!error && data?.records?.length > 0) {
        const record = data.records[0];
        if (record.edited_content) {
          setReportContent(record.edited_content);
          initialContent.current = record.edited_content;
          setHasEdited(false);
          return;
        }
      }
    } catch (err) {
      console.warn('Could not load persisted content, using original:', err);
    }
    
    // Fallback to original message content
    setReportContent(originalContent);
    initialContent.current = originalContent;
    setHasEdited(false);
  };

  const handleContentChange = (value: string) => {
    setReportContent(value);
    setHasEdited(value !== initialContent.current);
  };

  const saveEditedContent = async () => {
    setIsSaving(true);
    try {
      await invokeSecureFunction('manage-client-data', {
        operation: 'update',
        table: 'report_qa_messages',
        id: messageId,
        data: { edited_content: reportContent }
      });

      initialContent.current = reportContent;
      setHasEdited(false);

      toast({
        title: 'Saved',
        description: 'Your edits have been saved.',
      });
    } catch (err: any) {
      console.error('Failed to save edited content:', err);
      toast({
        title: 'Save failed',
        description: err.message || 'Failed to save edits',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const resetToOriginal = () => {
    setReportContent(originalContent);
    setHasEdited(originalContent !== initialContent.current);
  };

  // ========== PDF EXPORT (mirrors the deleted QAPDFGenerator template) ==========
  const sanitizeForPDF = (text: string): string => {
    let clean = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
    clean = clean.replace(/%æ\s*/g, '- ');
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
    clean = clean.replace(/"d\$/g, '<=$');
    clean = clean.replace(/[^\x00-\x7F]/g, (ch) => {
      if (/[àáâãäåèéêëìíîïòóôõöùúûüýÿñçÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝÑÇ×÷]/.test(ch)) return ch;
      return '';
    });
    return clean;
  };

  const exportAsPDF = async () => {
    setIsExporting(true);
    try {
      // Save edits first if changed
      if (hasEdited) {
        await saveEditedContent();
      }

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const usableWidth = pageWidth - margin * 2;
      let yPos = margin;

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
        doc.setFillColor(15, 18, 25);
        doc.rect(0, 0, pageWidth, pageHeight, 'F');
        doc.setDrawColor(191, 155, 80);
        doc.setLineWidth(0.8);
        doc.line(pageWidth * 0.3, pageHeight * 0.42, pageWidth * 0.7, pageHeight * 0.42);
      }

      const dateStr = new Date().toLocaleDateString('en-AU', {
        day: 'numeric', month: 'long', year: 'numeric'
      });

      // ============= CONTENT PAGES =============
      doc.addPage();
      yPos = margin;

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

      // Detect markdown table block
      const isTableLine = (line: string) => line.trim().startsWith('|') && line.trim().endsWith('|');
      const isSeparatorLine = (line: string) => /^\|[\s\-:]+(\|[\s\-:]+)+\|$/.test(line.trim());

      const drawTable = (tableLines: string[]) => {
        const parseRow = (line: string) =>
          line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => sanitizeForPDF(c.trim()));

        const header = parseRow(tableLines[0]);
        const bodyLines = tableLines.slice(2);
        const rows = bodyLines.map(parseRow);
        const colCount = header.length;

        const colWidths: number[] = [];
        const totalChars = header.reduce((sum, h, i) => {
          const maxLen = Math.max(h.length, ...rows.map(r => (r[i] || '').length));
          colWidths.push(maxLen);
          return sum + maxLen;
        }, 0);
        const colWidthsMM = colWidths.map(w => Math.max((w / totalChars) * usableWidth, 25));
        const totalMM = colWidthsMM.reduce((a, b) => a + b, 0);
        const scale = usableWidth / totalMM;
        const finalWidths = colWidthsMM.map(w => w * scale);

        const cellPadding = 2;
        const baseCellLineHeight = 3.8;

        // Helper: calculate the row height based on wrapped text in each cell
        const calcRowHeight = (cells: string[], fontSize: number): number => {
          doc.setFontSize(fontSize);
          let maxLines = 1;
          for (let c = 0; c < colCount; c++) {
            const cellText = cells[c] || '';
            const wrapped = doc.splitTextToSize(cellText, finalWidths[c] - cellPadding * 2);
            if (wrapped.length > maxLines) maxLines = wrapped.length;
          }
          return maxLines * baseCellLineHeight + 4;
        };

        // Calculate header row height
        doc.setFontSize(8);
        const headerRowH = calcRowHeight(header, 8);

        const minTableHeight = Math.min(headerRowH + rows.slice(0, 2).reduce((s, r) => s + calcRowHeight(r, 8), 0) + 4, 60);
        ensureSpace(minTableHeight);

        let xPos = margin;
        doc.setFillColor(240, 245, 255);
        doc.rect(margin, yPos - 5, usableWidth, headerRowH, 'F');
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        for (let i = 0; i < colCount; i++) {
          const wrapped = doc.splitTextToSize(header[i], finalWidths[i] - cellPadding * 2);
          doc.text(wrapped, xPos + cellPadding, yPos);
          xPos += finalWidths[i];
        }
        doc.setDrawColor(200, 210, 230);
        doc.setLineWidth(0.3);
        doc.line(margin, yPos + headerRowH - 5, margin + usableWidth, yPos + headerRowH - 5);
        yPos += headerRowH;

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(51, 51, 51);
        doc.setFontSize(8);
        for (const row of rows) {
          const dynRowH = calcRowHeight(row, 8);
          ensureSpace(dynRowH + 2);
          xPos = margin;
          for (let i = 0; i < colCount; i++) {
            const cellText = row[i] || '';
            const wrapped = doc.splitTextToSize(cellText, finalWidths[i] - cellPadding * 2);
            doc.text(wrapped, xPos + cellPadding, yPos);
            xPos += finalWidths[i];
          }
          doc.setDrawColor(230, 230, 230);
          doc.line(margin, yPos + dynRowH - 5, margin + usableWidth, yPos + dynRowH - 5);
          yPos += dynRowH;
        }
        yPos += 4;
      };

      const lines = reportContent.split('\n');
      let i = 0;
      
      while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

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

        ensureSpace(8);

        if (!trimmed) {
          yPos += 4;
          i++;
          continue;
        }

        // H1
        if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
          ensureSpace(20);
          yPos += 4;
          doc.setFontSize(16);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(15, 23, 42);
          const h1Text = sanitizeForPDF(trimmed.replace(/^# /, ''));
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
          const h2Text = sanitizeForPDF(trimmed.replace(/^## /, ''));
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
          const h3Text = sanitizeForPDF(trimmed.replace(/^### /, ''));
          const wrappedH3 = doc.splitTextToSize(h3Text, usableWidth);
          doc.text(wrappedH3, margin, yPos);
          yPos += wrappedH3.length * 5 + 3;
          i++;
          continue;
        }

        // H5 (must be before H4)
        if (trimmed.startsWith('##### ')) {
          ensureSpace(14);
          yPos += 2;
          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(71, 85, 105);
          const h5Text = sanitizeForPDF(trimmed.replace(/^#####+ /, ''));
          const wrappedH5 = doc.splitTextToSize(h5Text, usableWidth);
          doc.text(wrappedH5, margin, yPos);
          yPos += wrappedH5.length * 4.5 + 3;
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
          const h4Text = sanitizeForPDF(trimmed.replace(/^####+ /, ''));
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

        // Numbered list items
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

        // Nested bullet points
        if (/^\s{2,}-\s/.test(line) || trimmed.startsWith('- -') || trimmed.startsWith('%æ')) {
          doc.setFontSize(9);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(80, 80, 80);
          const bulletText = trimmed.replace(/^-\s*-\s*/, '').replace(/^-\s/, '').replace(/^%æ\s*/, '');
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

        // Bold-only lines (rendered as styled sub-headings)
        if (trimmed.startsWith('**') && trimmed.endsWith('**') && !trimmed.startsWith('***')) {
          ensureSpace(14);
          yPos += 2;
          doc.setFontSize(10.5);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(30, 41, 59);
          const boldText = sanitizeForPDF(trimmed.replace(/^\*\*|\*\*$/g, ''));
          const wrappedBold = doc.splitTextToSize(boldText, usableWidth);
          doc.text(wrappedBold, margin, yPos);
          yPos += wrappedBold.length * 4.5 + 3;
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

      // Footer on each page (skip cover = page 1, skip disclaimer = last page)
      const totalPages = doc.getNumberOfPages();
      const companyFooterName = contact.company_name || 'Property Report';
      for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages) continue;
        doc.setPage(p);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(150, 150, 150);
        doc.text(
          `${companyFooterName} -- Confidential -- Page ${p - 1} of ${totalPages - 2}`,
          pageWidth / 2,
          pageHeight - 8,
          { align: 'center' }
        );
      }

      const fileName = reportNames.length > 0 
        ? `Summary - ${reportNames.join(', ')}.pdf`
        : `Q&A Summary - ${new Date().toLocaleDateString('en-AU')}.pdf`;
      
      doc.save(fileName);

      toast({
        title: 'PDF exported',
        description: 'Your report has been downloaded.',
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
    a.download = `${title.replace(/[^a-z0-9]/gi, '_').substring(0, 50)}_message.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: 'Markdown exported',
      description: 'Message content has been downloaded as markdown.',
    });
  };

  const handleClose = () => {
    if (hasEdited) {
      if (!confirm('You have unsaved edits. Are you sure you want to close?')) return;
    }
    onClose();
  };

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
    h4: ({ children }: any) => (
      <h4 className="text-base font-medium mt-3 mb-2 text-foreground">{children}</h4>
    ),
    h5: ({ children }: any) => (
      <h5 className="text-sm font-medium mt-2 mb-1 text-muted-foreground">{children}</h5>
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
      <DialogContent className="flex h-[min(92dvh,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] w-[min(92vw,1500px)] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(92vw,1500px)] sm:p-0 sm:max-h-[calc(100dvh-3rem)] sm:h-[min(92dvh,calc(100dvh-3rem))]">
        <DialogHeader className="flex-shrink-0 px-5 pb-3 pt-5 pr-14 sm:px-6 sm:pb-4 sm:pt-6 sm:pr-16">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Export Message as PDF
          </DialogTitle>
          <DialogDescription>
            Review and edit the message content before exporting as a professional PDF report.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-5 sm:px-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <TabsList className="grid w-full flex-shrink-0 grid-cols-2">
              <TabsTrigger value="edit" className="flex items-center gap-2">
                <Type className="h-4 w-4" />
                Edit Content
              </TabsTrigger>
              <TabsTrigger value="preview" className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Preview
              </TabsTrigger>
            </TabsList>

            <TabsContent value="edit" className="mt-4 min-h-0 min-w-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col">
              <Textarea
                aria-label="PDF report content editor"
                value={reportContent}
                onChange={(e) => handleContentChange(e.target.value)}
                placeholder="Message content will appear here..."
                className="h-full min-h-0 w-full min-w-0 resize-none overflow-y-auto whitespace-pre-wrap break-words rounded-md p-4 font-mono text-sm leading-relaxed focus-visible:ring-1 sm:p-5 sm:text-[15px]"
              />
            </TabsContent>

            <TabsContent value="preview" className="mt-4 min-h-0 min-w-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col">
              <div aria-label="PDF report preview" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-md border bg-muted/20 p-4 sm:p-6">
                <div className="mx-auto w-full max-w-5xl min-w-0 rounded-md bg-background p-5 shadow-sm sm:p-8 [&_*]:max-w-full [&_a]:break-words [&_td]:break-words [&_th]:break-words">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {reportContent}
                  </ReactMarkdown>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="flex flex-shrink-0 flex-col gap-3 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:space-x-0 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            {hasEdited && (
              <Badge variant="outline" className="text-warning border-warning/30 text-xs">
                Unsaved edits
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {reportContent.length} chars
            </span>
          </div>
          
          <div className="flex flex-wrap justify-end gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={resetToOriginal}
              disabled={!hasEdited}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Reset
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={saveEditedContent}
              disabled={!hasEdited || isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Download className="h-3 w-3 mr-1" />
              )}
              Save
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={exportAsMarkdown}
              disabled={!reportContent}
            >
              <Download className="h-3 w-3 mr-1" />
              Markdown
            </Button>
            {/*
              Beside the jsPDF export, not in place of it. This one reads the
              answer back out of `report_qa_messages` and typesets it through
              WeasyPrint, so what a broker receives is selectable text.
            */}
            <ReportQaDownloadButton
              conversationId={conversationId ?? null}
              only="answer"
              messageId={messageId}
              label="Typeset PDF"
            />
            <Button 
              size="sm"
              onClick={exportAsPDF}
              disabled={!reportContent || isExporting}
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
