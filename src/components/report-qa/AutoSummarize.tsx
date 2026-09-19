import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkles, Loader2, Copy, Check } from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useToast } from '@/hooks/use-toast';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AutoSummarizeProps {
  messages: Message[];
  reportNames: string[];
  /**
   * The saved conversation this chat belongs to. The report-qa gateway
   * refuses any action without one (it answers 404), which is exactly how
   * every Summarize click used to fail — the id was simply never sent.
   */
  conversationId: string | null;
  disabled?: boolean;
}

export function AutoSummarize({ messages, reportNames, conversationId, disabled }: AutoSummarizeProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generateSummary = async () => {
    if (messages.length < 2) {
      toast({
        title: 'Not enough messages',
        description: 'Have a longer conversation before summarizing',
        variant: 'destructive',
      });
      return;
    }

    if (!conversationId) {
      toast({
        title: 'No saved conversation yet',
        description: 'Send a message first so the conversation exists, then summarize it.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setSummary(null);

    try {
      const { data, error } = await invokeSecureFunction('report-qa', {
        action: 'chat',
        conversationId,
        reportContents: [],
        reportNames,
        question: `Please provide a concise executive summary of our entire conversation so far. Include:
1. Main topics discussed
2. Key findings and insights
3. Important numbers or data points mentioned
4. Action items or recommendations made
5. Any unanswered questions

Keep it brief but comprehensive.`,
        chatHistory: messages.map(m => ({ role: m.role, content: m.content })),
      });

      if (error) throw error;

      setSummary(data.response);
    } catch (error) {
      console.error('Summary error:', error);
      toast({
        title: 'Failed to generate summary',
        description: error instanceof Error && error.message ? error.message : 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (summary) {
      navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: 'Copied',
        description: 'Summary copied to clipboard',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="report-qa-toolbar-control h-8 gap-1.5 px-3 text-xs font-medium disabled:border-dashed"
          disabled={disabled || messages.length < 2}
          title={disabled || messages.length < 2 ? 'Summarize is available after a longer conversation' : 'Summarize conversation'}
          onClick={() => {
            setIsOpen(true);
            if (!summary) generateSummary();
          }}
        >
          <Sparkles className="h-3 w-3" />
          Summarize
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Conversation Summary
          </DialogTitle>
          <DialogDescription>
            AI-generated summary of your conversation
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[200px]">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-[200px] gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Generating summary...</p>
            </div>
          ) : summary ? (
            <ScrollArea className="h-[300px] pr-4">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <div className="whitespace-pre-wrap text-sm">{summary}</div>
              </div>
            </ScrollArea>
          ) : (
            <div className="flex flex-col items-center justify-center h-[200px] gap-3">
              <p className="text-sm text-muted-foreground">No summary generated yet</p>
              <Button onClick={generateSummary}>Generate Summary</Button>
            </div>
          )}
        </div>

        {summary && (
          <div className="flex justify-between items-center pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={generateSummary}
              disabled={isLoading}
            >
              Regenerate
            </Button>
            <Button
              size="sm"
              onClick={handleCopy}
              className="gap-1.5"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
