import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Bot, User, Wrench, ChevronRight, Clock } from 'lucide-react';

interface ArtifactMessage {
  role: string;
  message?: string;
  content?: string;
  time?: number;
  endTime?: number;
  duration?: number;
  name?: string;
  assistantId?: string;
  assistantName?: string;
  toolCalls?: Array<{
    id?: string;
    type?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
  toolCallId?: string;
  result?: string;
  [key: string]: unknown;
}

interface CallTranscriptChatProps {
  artifactMessages: ArtifactMessage[] | null;
  plainTranscript: string | null;
}

export const CallTranscriptChat = ({ artifactMessages, plainTranscript }: CallTranscriptChatProps) => {
  // Fallback to plain transcript if no artifact messages
  if (!artifactMessages || artifactMessages.length === 0) {
    if (plainTranscript) {
      return (
        <Card className="overflow-hidden rounded-3xl border-border dark:border-white/10 bg-gradient-to-br from-card dark:from-background/95 via-card dark:via-background/80 to-background dark:to-black/90 shadow-lg shadow-sm dark:shadow-black/25">
          <CardContent className="p-4">
            <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-2xl border border-border dark:border-white/10 bg-background dark:bg-black/45 p-4 font-mono text-sm text-muted-foreground dark:text-foreground [overflow-wrap:anywhere]">
              {plainTranscript}
            </pre>
          </CardContent>
        </Card>
      );
    }
    return (
      <Card className="overflow-hidden rounded-3xl border-border dark:border-white/10 bg-gradient-to-br from-card dark:from-background/95 via-card dark:via-background/80 to-background dark:to-black/90 shadow-lg shadow-sm dark:shadow-black/25">
        <CardContent className="p-8 text-center">
          <p className="text-muted-foreground dark:text-muted-foreground">No transcript available</p>
        </CardContent>
      </Card>
    );
  }

  // Build a result map for tool calls
  const resultMap = new Map<string, ArtifactMessage>();
  for (const msg of artifactMessages) {
    if ((msg.role === 'tool_call_result' || msg.role === 'tool') && msg.toolCallId) {
      resultMap.set(msg.toolCallId, msg);
    }
  }

  // Filter out system messages and tool results (they'll be shown inline with tool_calls)
  const visibleMessages = artifactMessages.filter(
    msg => msg.role !== 'system' && msg.role !== 'tool_call_result' && msg.role !== 'tool'
  );

  const formatTime = (time: number | undefined) => {
    if (!time) return null;
    return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  let toolCallCounter = 0;

  return (
    <div className="space-y-3 rounded-3xl border border-border dark:border-white/10 bg-background dark:bg-black/20 p-3">
      {visibleMessages.map((msg, idx) => {
        const isBot = msg.role === 'bot' || msg.role === 'assistant';
        const isUser = msg.role === 'user';
        const content = msg.message || msg.content;
        const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0;

        // Skip empty messages without tool calls
        if (!content && !hasToolCalls) return null;

        return (
          <div key={idx}>
            {/* Chat bubble */}
            {content && (
              <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
                {!isUser && (
                  <div className="mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-brand-300/20 bg-brand-500/10">
                    <Bot className="h-4 w-4 text-brand-200" />
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-2xl border px-4 py-2.5 text-sm shadow-sm ${
                    isUser
                      ? 'rounded-br-md border-primary/30 bg-primary text-primary-foreground'
                      : 'rounded-bl-md border-border dark:border-white/10 bg-white/[0.05] text-foreground dark:text-foreground'
                  }`}
                >
                  <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{content}</p>
                  {msg.time && (
                    <p className={`mt-1 text-[10px] ${isUser ? 'text-primary-foreground/70' : 'text-muted-foreground dark:text-muted-foreground'}`}>
                      {formatTime(msg.time)}
                    </p>
                  )}
                  {isBot && msg.assistantName && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground dark:text-muted-foreground">
                      {msg.assistantName}
                    </p>
                  )}
                </div>
                {isUser && (
                  <div className="mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-info/20 bg-info/10">
                    <User className="h-4 w-4 text-info" />
                  </div>
                )}
              </div>
            )}

            {/* Inline tool calls */}
            {hasToolCalls && (
              <div className="mx-8 my-2">
                <Accordion type="multiple">
                  {msg.toolCalls!.map((tc, tcIdx) => {
                    toolCallCounter++;
                    const tcId = tc.id || `inline-tc-${idx}-${tcIdx}`;
                    const resultMsg = tc.id ? resultMap.get(tc.id) : undefined;

                    let args: unknown = tc.function?.arguments || '{}';
                    try { if (typeof args === 'string') args = JSON.parse(args as string); } catch { /* keep */ }

                    let result: unknown = null;
                    let success = true;
                    if (resultMsg) {
                      const raw = resultMsg.result || resultMsg.content || resultMsg.message;
                      if (raw) {
                        try { result = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { result = raw; }
                      }
                      if (typeof result === 'object' && result !== null) {
                        const r = result as Record<string, unknown>;
                        if (r.error || r.success === false) success = false;
                      }
                    }

                    return (
                      <AccordionItem key={tcId} value={tcId} className="my-1 overflow-hidden rounded-2xl border border-dashed border-brand-300/20 bg-brand-500/[0.04] px-2">
                        <AccordionTrigger className="py-2 text-xs hover:no-underline">
                          <div className="flex items-center gap-2 text-left">
                            <Wrench className="h-3 w-3 text-brand-300" />
                            <span className="font-mono text-muted-foreground dark:text-muted-foreground">{tc.function?.name || 'tool_call'}</span>
                            <div className={`w-1.5 h-1.5 rounded-full ${success ? 'bg-success' : 'bg-destructive'}`} />
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-2 text-xs pb-1 overflow-hidden">
                            <div>
                              <p className="mb-1 flex items-center gap-1 font-medium text-muted-foreground dark:text-muted-foreground">
                                <ChevronRight className="w-3 h-3" /> Request
                              </p>
                              <pre className="max-h-40 w-full max-w-full overflow-auto whitespace-pre-wrap break-all rounded-xl border border-border dark:border-white/10 bg-background dark:bg-black/45 p-2 font-mono text-[11px] text-muted-foreground dark:text-foreground">
                                {typeof args === 'string' ? args : JSON.stringify(args, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <p className="mb-1 flex items-center gap-1 font-medium text-muted-foreground dark:text-muted-foreground">
                                <ChevronRight className="w-3 h-3" /> Response
                              </p>
                              <pre className="max-h-40 w-full max-w-full overflow-auto whitespace-pre-wrap break-all rounded-xl border border-border dark:border-white/10 bg-background dark:bg-black/45 p-2 font-mono text-[11px] text-muted-foreground dark:text-foreground">
                                {result ? (typeof result === 'string' ? result : JSON.stringify(result, null, 2)) : 'No response'}
                              </pre>
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
