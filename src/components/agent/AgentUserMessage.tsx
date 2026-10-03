/**
 * AgentUserMessage — a user's turn, shown as they wrote it.
 *
 * The stored turn is what the model was sent (inlined document text, the
 * page line). `parseUserMessage` splits that back into the person's words, the
 * files as chips and the page as a chip. Nothing the user typed is dropped.
 */
import { FileText, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseUserMessage } from '@/lib/agent/userMessage.pure';

interface AgentUserMessageProps {
  content: string;
  /** Another team member's turn in a shared conversation. */
  other?: boolean;
}

export function AgentUserMessage({ content, other }: AgentUserMessageProps) {
  const parsed = parseUserMessage(content);
  const hasMeta = parsed.files.length > 0 || parsed.page;

  return (
    <div className={cn('flex max-w-[88%] flex-col gap-1', other ? 'items-start' : 'items-end')}>
      {hasMeta && (
        <div className={cn('flex flex-wrap gap-1', other ? 'justify-start' : 'justify-end')}>
          {parsed.page && (
            <span className="aurixa-context-chip" title={parsed.page.path}>
              <MapPin className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{parsed.page.label}</span>
            </span>
          )}
          {parsed.files.map((f) => (
            <span key={f.name} className="aurixa-context-chip" title={f.meta ? `${f.name} · ${f.meta}` : f.name}>
              <FileText className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{f.name}</span>
            </span>
          ))}
        </div>
      )}
      {parsed.text && (
        <div
          className={cn(
            'rounded-2xl px-3.5 py-2.5 text-sm shadow-sm',
            other
              ? 'rounded-bl-md border border-[hsl(var(--aurixa-glass-border)/0.5)] bg-[hsl(var(--aurixa-glass-bg)/0.7)] text-foreground backdrop-blur'
              : 'rounded-br-md bg-primary text-primary-foreground',
          )}
        >
          <p className="whitespace-pre-wrap break-words">{parsed.text}</p>
        </div>
      )}
    </div>
  );
}
