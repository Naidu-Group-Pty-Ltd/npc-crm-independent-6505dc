import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, FileText, FileDown, Loader2, MessageSquareText, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useReportTemplateMenu } from '@/components/reports/useReportTemplateMenu';
import { ConversationReportEditor } from './ConversationReportEditor';
import { useReportQaDelivery } from './useReportQaDelivery';
import { hubDocumentFileName, hubDocumentTopic } from '@/lib/reports/reportQa/documentIdentity.pure';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ConversationExportProps {
  messages: Message[];
  title: string;
  reportNames: string[];
  conversationId?: string | null;
}

export function ConversationExport({ messages, title, reportNames, conversationId }: ConversationExportProps) {
  const { toast } = useToast();
  const [editorOpen, setEditorOpen] = useState(false);
  // The typeset documents, as plain items in THIS menu. This used to embed the
  // whole ReportQaDownloadButton — a DropdownMenu inside this menu's content,
  // whose own template dialog was unmounted with it: the picker opened and
  // vanished in the same frame. Same delivery hook, same toasts, no nesting.
  const typeset = useReportQaDelivery({ conversationId: conversationId ?? null });
  const template = useReportTemplateMenu('qa');

  const exportAsText = () => {
    const header = `# ${title}\n\nReports: ${reportNames.join(', ')}\nExported: ${new Date().toLocaleString('en-AU')}\n\n---\n\n`;
    
    const content = messages.map(m => {
      const timestamp = m.timestamp.toLocaleString('en-AU');
      const role = m.role === 'user' ? '👤 You' : '🤖 Assistant';
      return `[${timestamp}] ${role}:\n${m.content}`;
    }).join('\n\n---\n\n');

    const blob = new Blob([header + content], { type: 'text/plain' });
    downloadBlob(blob, rawFileName('txt'));
    
    toast({
      title: 'Exported',
      description: 'Conversation saved as text file',
    });
  };

  const exportAsMarkdown = () => {
    const header = `# ${title}\n\n**Reports:** ${reportNames.join(', ')}\n\n**Exported:** ${new Date().toLocaleString('en-AU')}\n\n---\n\n`;
    
    const content = messages.map(m => {
      const timestamp = m.timestamp.toLocaleString('en-AU');
      const role = m.role === 'user' ? '**You**' : '**Assistant**';
      return `### ${role}\n*${timestamp}*\n\n${m.content}`;
    }).join('\n\n---\n\n');

    const blob = new Blob([header + content], { type: 'text/markdown' });
    downloadBlob(blob, rawFileName('md'));
    
    toast({
      title: 'Exported',
      description: 'Conversation saved as markdown file',
    });
  };

  const exportAsJSON = () => {
    const data = {
      title,
      reportNames,
      exportedAt: new Date().toISOString(),
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp.toISOString(),
      })),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, rawFileName('json'));
    
    toast({
      title: 'Exported',
      description: 'Conversation saved as JSON file',
    });
  };

  const exportAsCSV = () => {
    const escapeCSV = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const headers = ['First Name', 'Last Name', 'Email', 'Phone', 'Tags', 'Source', 'Conversation Title', 'Reports', 'Exported At', 'Timestamp', 'Role', 'Content'];
    const exportedAt = new Date().toLocaleString('en-AU');

    const rows = messages.map((message) => [
      '',
      '',
      '',
      '',
      'Q&A Export',
      'Report QA',
      title,
      reportNames.join(', '),
      exportedAt,
      message.timestamp.toLocaleString('en-AU'),
      message.role === 'user' ? 'User' : 'Assistant',
      message.content,
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => escapeCSV(cell)).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, rawFileName('csv'));

    toast({
      title: 'Exported',
      description: 'Conversation saved as CSV file',
    });
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /**
   * `Intelligence Hub Summary - Transcript - <topic> - 28 Sep 2026.<ext>` —
   * the same name the PDFs carry, so a conversation's files sort together.
   */
  const rawFileName = (extension: string) => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const firstQuestion = messages.find((m) => m.role === 'user')?.content ?? '';
    return hubDocumentFileName(
      hubDocumentTopic({ conversationTitle: title, question: firstQuestion }),
      today,
      { kind: 'transcript', extension },
    );
  };

  if (messages.length === 0) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="report-qa-toolbar-control h-8 gap-1.5 px-3 text-xs font-medium" title="Export conversation">
            <Download className="h-3 w-3" />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {/*
            The typeset documents, above the raster one. All of it stays: these
            produce real text through WeasyPrint, the item below them still
            opens the jsPDF editor, and the four raw exports underneath are
            untouched — the .md one is what the typeset document's own
            truncation notice points at.
          */}
          {conversationId && (
            <>
              <DropdownMenuItem disabled={typeset.busy} onClick={() => void typeset.run('structured')}>
                {typeset.running === 'structured'
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <Sparkles className="h-4 w-4 mr-2 text-primary" />}
                Summary report PDF (AI)
              </DropdownMenuItem>
              <DropdownMenuItem disabled={typeset.busy} onClick={() => void typeset.run('transcript')}>
                {typeset.running === 'transcript'
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <MessageSquareText className="h-4 w-4 mr-2" />}
                Transcript PDF
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={() => setEditorOpen(true)}>
            <Sparkles className="h-4 w-4 mr-2 text-primary" />
            Edit summary, then export (AI)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={exportAsText}>
            <FileText className="h-4 w-4 mr-2" />
            Export Raw Transcript (.txt)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={exportAsCSV}>
            <FileDown className="h-4 w-4 mr-2" />
            Export for CSV (.csv)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={exportAsMarkdown}>
            <FileDown className="h-4 w-4 mr-2" />
            Export Raw Transcript (.md)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={exportAsJSON}>
            <FileDown className="h-4 w-4 mr-2" />
            Export Raw Data (.json)
          </DropdownMenuItem>
          {/* Which template the typeset documents come out in, at the foot of
              the menu that produces them. */}
          {template.section}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Outside the menu: its content unmounts on close and would take the
          dialog with it. */}
      {template.dialog}

      <ConversationReportEditor
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        messages={messages}
        title={title}
        reportNames={reportNames}
        conversationId={conversationId}
      />
    </>
  );
}
