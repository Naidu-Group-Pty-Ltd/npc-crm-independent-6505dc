import { useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  Bold, Italic, Strikethrough, List, ListOrdered, Code,
  Send, Loader2,
} from 'lucide-react';

type Channel = 'sms' | 'email' | 'whatsapp';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  isSending: boolean;
  disabled?: boolean;
  channel: Channel;
  placeholder?: string;
  rows?: number;
}

// WhatsApp formatting differs from markdown
const FORMAT_CONFIGS: Record<Channel, Array<{ icon: any; label: string; prefix: string; suffix: string }>> = {
  whatsapp: [
    { icon: Bold, label: 'Bold', prefix: '*', suffix: '*' },
    { icon: Italic, label: 'Italic', prefix: '_', suffix: '_' },
    { icon: Strikethrough, label: 'Strikethrough', prefix: '~', suffix: '~' },
    { icon: Code, label: 'Monospace', prefix: '```', suffix: '```' },
    { icon: List, label: 'Bullet List', prefix: '- ', suffix: '' },
    { icon: ListOrdered, label: 'Numbered List', prefix: '1. ', suffix: '' },
  ],
  email: [
    { icon: Bold, label: 'Bold', prefix: '**', suffix: '**' },
    { icon: Italic, label: 'Italic', prefix: '_', suffix: '_' },
    { icon: Strikethrough, label: 'Strikethrough', prefix: '~~', suffix: '~~' },
    { icon: Code, label: 'Code', prefix: '`', suffix: '`' },
    { icon: List, label: 'Bullet List', prefix: '- ', suffix: '' },
    { icon: ListOrdered, label: 'Numbered List', prefix: '1. ', suffix: '' },
  ],
  sms: [], // No formatting for SMS
};

export function MessageComposer({ value, onChange, onSend, isSending, disabled, channel, placeholder, rows = 1 }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertFormatting = useCallback((prefix: string, suffix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.substring(start, end);
    const before = value.substring(0, start);
    const after = value.substring(end);

    const isLinePrefix = suffix === '' && (prefix.startsWith('- ') || prefix.startsWith('1.'));

    if (isLinePrefix) {
      // For line prefixes, add on a new line if we're not at the start
      const needsNewline = before.length > 0 && !before.endsWith('\n');
      const newValue = before + (needsNewline ? '\n' : '') + prefix + selected + after;
      onChange(newValue);
    } else {
      const text = selected || 'text';
      const newValue = before + prefix + text + suffix + after;
      onChange(newValue);
    }

    setTimeout(() => {
      textarea.focus();
      const offset = (suffix === '' && (prefix.startsWith('- ') || prefix.startsWith('1.')))
        ? (before.length > 0 && !before.endsWith('\n') ? 1 : 0)
        : 0;
      const newPos = start + offset + prefix.length + (selected.length || 4);
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  }, [value, onChange]);

  const formatItems = FORMAT_CONFIGS[channel] || [];
  const showToolbar = formatItems.length > 0;

  return (
    <div className={cn(
      'rounded-2xl border border-brand-200/15 bg-background dark:bg-background/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_12px_28px_rgba(0,0,0,0.18)] overflow-hidden transition-all duration-200 focus-within:border-brand-300/55 focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_1px_rgba(251,191,36,0.12),0_0_34px_rgba(245,158,11,0.16)]',
      showToolbar && 'ring-0 focus-within:ring-2 focus-within:ring-brand-300/20'
    )}>
      {showToolbar && (
        <div className="flex items-center gap-1 border-b border-brand-100/10 bg-brand-300/[0.045] px-2 py-1.5">
          {formatItems.map(({ icon: Icon, label, prefix, suffix }) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-lg text-muted-foreground dark:text-foreground transition-all hover:-translate-y-0.5 hover:bg-brand-300/10 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  onClick={() => insertFormatting(prefix, suffix)}
                >
                  <Icon className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {label}
              </TooltipContent>
            </Tooltip>
          ))}
          <span className="ml-auto text-[9px] text-muted-foreground/60 capitalize">
            {channel === 'whatsapp' ? 'WhatsApp' : channel}
          </span>
        </div>
      )}

      <div className="flex items-end gap-2 p-1.5">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            // Auto-resize textarea
            const el = e.target;
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, channel === 'email' ? 128 : 160) + 'px';
          }}
          placeholder={placeholder}
          rows={rows}
          className={cn("min-h-[60px] resize-none overflow-y-auto rounded-xl border-0 bg-transparent py-1.5 text-sm text-foreground dark:text-foreground placeholder:text-muted-foreground dark:placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0", channel === 'email' ? "max-h-32" : "max-h-40")}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        <Button
          size="sm"
          className="mb-0.5 h-8 w-8 shrink-0 rounded-full bg-brand-300 p-0 text-black shadow-[0_0_22px_rgba(251,191,36,0.20)] transition-all hover:-translate-y-0.5 hover:bg-brand-200 hover:shadow-[0_0_30px_rgba(251,191,36,0.32)] focus-visible:ring-2 focus-visible:ring-brand-200/80 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:translate-y-0 disabled:opacity-50"
          onClick={onSend}
          disabled={disabled || isSending}
          aria-label={`Send ${channel === 'sms' ? 'SMS' : channel === 'whatsapp' ? 'WhatsApp' : 'email'}`}
        >
          {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

/**
 * Render WhatsApp-formatted text as React nodes.
 * WhatsApp: *bold*, _italic_, ~strikethrough~, ```monospace```
 */
export function renderFormattedMessage(text: string, channel: string): React.ReactNode {
  if (!text) return null;
  const ch = channel?.toLowerCase() || 'sms';
  
  if (ch === 'whatsapp') {
    return renderWhatsAppFormatting(text);
  }
  // For email/sms, do basic markdown-like rendering
  return renderBasicFormatting(text);
}

function renderWhatsAppFormatting(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Monospace (triple backtick)
    const monoMatch = remaining.match(/```(.+?)```/s);
    // Bold
    const boldMatch = remaining.match(/\*(.+?)\*/);
    // Italic
    const italicMatch = remaining.match(/_(.+?)_/);
    // Strikethrough
    const strikeMatch = remaining.match(/~(.+?)~/);

    const matches = [
      monoMatch ? { type: 'mono', match: monoMatch, index: monoMatch.index! } : null,
      boldMatch ? { type: 'bold', match: boldMatch, index: boldMatch.index! } : null,
      italicMatch ? { type: 'italic', match: italicMatch, index: italicMatch.index! } : null,
      strikeMatch ? { type: 'strike', match: strikeMatch, index: strikeMatch.index! } : null,
    ].filter(Boolean).sort((a, b) => a!.index - b!.index);

    if (matches.length === 0) {
      parts.push(remaining);
      break;
    }

    const first = matches[0]!;
    if (first.index > 0) {
      parts.push(remaining.substring(0, first.index));
    }

    switch (first.type) {
      case 'bold':
        parts.push(<strong key={key++}>{first.match![1]}</strong>);
        break;
      case 'italic':
        parts.push(<em key={key++}>{first.match![1]}</em>);
        break;
      case 'strike':
        parts.push(<s key={key++}>{first.match![1]}</s>);
        break;
      case 'mono':
        parts.push(
          <code key={key++} className="px-1 py-0.5 rounded bg-muted text-[0.85em] font-mono">
            {first.match![1]}
          </code>
        );
        break;
    }

    remaining = remaining.substring(first.index + first.match![0].length);
  }

  return <>{parts}</>;
}

function renderBasicFormatting(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const italicMatch = remaining.match(/_(.+?)_/);
    const strikeMatch = remaining.match(/~~(.+?)~~/);
    const codeMatch = remaining.match(/`(.+?)`/);

    const matches = [
      boldMatch ? { type: 'bold', match: boldMatch, index: boldMatch.index! } : null,
      italicMatch ? { type: 'italic', match: italicMatch, index: italicMatch.index! } : null,
      strikeMatch ? { type: 'strike', match: strikeMatch, index: strikeMatch.index! } : null,
      codeMatch ? { type: 'code', match: codeMatch, index: codeMatch.index! } : null,
    ].filter(Boolean).sort((a, b) => a!.index - b!.index);

    if (matches.length === 0) {
      parts.push(remaining);
      break;
    }

    const first = matches[0]!;
    if (first.index > 0) {
      parts.push(remaining.substring(0, first.index));
    }

    switch (first.type) {
      case 'bold':
        parts.push(<strong key={key++}>{first.match![1]}</strong>);
        break;
      case 'italic':
        parts.push(<em key={key++}>{first.match![1]}</em>);
        break;
      case 'strike':
        parts.push(<s key={key++}>{first.match![1]}</s>);
        break;
      case 'code':
        parts.push(
          <code key={key++} className="px-1 py-0.5 rounded bg-muted text-[0.85em] font-mono">
            {first.match![1]}
          </code>
        );
        break;
    }

    remaining = remaining.substring(first.index + first.match![0].length);
  }

  return <>{parts}</>;
}
