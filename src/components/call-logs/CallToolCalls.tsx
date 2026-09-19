import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { CheckCircle, XCircle, Wrench, Clock, ChevronRight } from 'lucide-react';
import { callLogBadgeTone } from './badgeStyles';

interface ArtifactMessage {
  role: string;
  message?: string;
  content?: string;
  time?: number;
  endTime?: number;
  duration?: number;
  name?: string;
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

interface CallToolCallsProps {
  artifactMessages: ArtifactMessage[] | null;
}

interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown> | string;
  result: Record<string, unknown> | string | null;
  success: boolean;
  timestamp: number | null;
  duration: number | null;
}

export const CallToolCalls = ({ artifactMessages }: CallToolCallsProps) => {
  if (!artifactMessages || artifactMessages.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Wrench className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-muted-foreground">No artifact message data available</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Tool call tracking is available for calls received after this feature was enabled</p>
        </CardContent>
      </Card>
    );
  }

  // Extract tool calls from messages
  const toolCalls: ParsedToolCall[] = [];
  
  // Build a map of tool call results by toolCallId
  const resultMap = new Map<string, ArtifactMessage>();
  for (const msg of artifactMessages) {
    if (msg.role === 'tool_call_result' || msg.role === 'tool') {
      if (msg.toolCallId) {
        resultMap.set(msg.toolCallId, msg);
      }
    }
  }

  for (const msg of artifactMessages) {
    if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
      for (const tc of msg.toolCalls) {
        const tcId = tc.id || `tc-${toolCalls.length}`;
        let args: Record<string, unknown> | string = tc.function?.arguments || '{}';
        try {
          if (typeof args === 'string') args = JSON.parse(args);
        } catch { /* keep as string */ }

        let result: Record<string, unknown> | string | null = null;
        let success = true;

        const resultMsg = resultMap.get(tcId);
        if (resultMsg) {
          const rawResult = resultMsg.result || resultMsg.content || resultMsg.message || null;
          if (rawResult) {
            try {
              result = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
            } catch {
              result = rawResult as string;
            }
          }
          // Check for error indicators
          if (typeof result === 'object' && result !== null) {
            const r = result as Record<string, unknown>;
            if (r.error || r.success === false || r.status === 'error') {
              success = false;
            }
          }
          if (typeof result === 'string' && (result.toLowerCase().includes('error') || result.toLowerCase().includes('failed'))) {
            success = false;
          }
        }

        toolCalls.push({
          id: tcId,
          name: tc.function?.name || 'Unknown Tool',
          arguments: args,
          result,
          success,
          timestamp: msg.time || null,
          duration: msg.duration || null,
        });
      }
    }
  }

  if (toolCalls.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Wrench className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-muted-foreground">No tool calls were made during this call</p>
        </CardContent>
      </Card>
    );
  }

  const successCount = toolCalls.filter(tc => tc.success).length;
  const failCount = toolCalls.length - successCount;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-3">
        <Badge variant="outline" className={callLogBadgeTone('neutral', 'gap-1')}>
          <Wrench className="w-3 h-3" />
          {toolCalls.length} Tool Call{toolCalls.length !== 1 ? 's' : ''}
        </Badge>
        {successCount > 0 && (
          <Badge className={callLogBadgeTone('success', 'gap-1')}>
            <CheckCircle className="w-3 h-3" />
            {successCount} Successful
          </Badge>
        )}
        {failCount > 0 && (
          <Badge className={callLogBadgeTone('danger', 'gap-1')}>
            <XCircle className="w-3 h-3" />
            {failCount} Failed
          </Badge>
        )}
      </div>

      {/* Tool Calls List */}
      <Accordion type="multiple" className="space-y-2 overflow-hidden">
        {toolCalls.map((tc, idx) => (
          <AccordionItem key={tc.id} value={tc.id} className="border rounded-lg px-1 overflow-hidden">
            <AccordionTrigger className="hover:no-underline py-3">
              <div className="flex items-center gap-3 text-left flex-1">
                <div className={`w-2 h-2 rounded-full ${tc.success ? 'bg-success' : 'bg-destructive'}`} />
                <span className="font-mono text-sm font-medium">{tc.name}</span>
                {tc.timestamp && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1 ml-auto mr-2">
                    <Clock className="w-3 h-3" />
                    {new Date(tc.timestamp).toLocaleTimeString('en-AU')}
                  </span>
                )}
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pb-2 overflow-hidden">
                {/* Request */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <ChevronRight className="w-3 h-3" /> Request Payload
                  </p>
                  <pre className="whitespace-pre-wrap break-all text-xs font-mono bg-muted p-3 rounded-lg overflow-auto max-h-60 w-full max-w-full">
                    {typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments, null, 2)}
                  </pre>
                </div>
                {/* Response */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <ChevronRight className="w-3 h-3" /> Response
                    {tc.success ? (
                      <Badge className={callLogBadgeTone('success', 'ml-1 px-1.5 py-0 text-[10px]')}>OK</Badge>
                    ) : (
                      <Badge className={callLogBadgeTone('danger', 'ml-1 px-1.5 py-0 text-[10px]')}>ERROR</Badge>
                    )}
                  </p>
                  <pre className="whitespace-pre-wrap break-all text-xs font-mono bg-muted p-3 rounded-lg overflow-auto max-h-60 w-full max-w-full">
                    {tc.result ? (typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2)) : 'No response recorded'}
                  </pre>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
};
