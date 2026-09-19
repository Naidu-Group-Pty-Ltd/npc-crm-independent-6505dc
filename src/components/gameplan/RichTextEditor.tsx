import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Bold, Italic, List, ListOrdered, Heading2, Link, Quote, Code } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}

const TOOLBAR_ITEMS = [
  { icon: Bold, label: 'Bold', prefix: '**', suffix: '**' },
  { icon: Italic, label: 'Italic', prefix: '_', suffix: '_' },
  { icon: Heading2, label: 'Heading', prefix: '## ', suffix: '' },
  { icon: Quote, label: 'Quote', prefix: '> ', suffix: '' },
  { icon: Code, label: 'Code', prefix: '`', suffix: '`' },
  { icon: List, label: 'Bullet List', prefix: '- ', suffix: '' },
  { icon: ListOrdered, label: 'Numbered List', prefix: '1. ', suffix: '' },
  { icon: Link, label: 'Link', prefix: '[', suffix: '](url)' },
];

export function RichTextEditor({ value, onChange, placeholder = 'Write using markdown...', rows = 4, className }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showPreview, setShowPreview] = useState(false);

  const insertFormatting = useCallback((prefix: string, suffix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.substring(start, end);
    const before = value.substring(0, start);
    const after = value.substring(end);

    const isLinePrefix = suffix === '' && (prefix.startsWith('- ') || prefix.startsWith('1.') || prefix.startsWith('> ') || prefix.startsWith('##'));

    if (isLinePrefix) {
      const newValue = before + prefix + selected + after;
      onChange(newValue);
    } else {
      const newValue = before + prefix + (selected || 'text') + suffix + after;
      onChange(newValue);
    }

    // Restore focus
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + prefix.length + (selected.length || 4);
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  }, [value, onChange]);

  return (
    <div className={cn('rounded-lg border border-input overflow-hidden', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border/50 bg-muted/30">
        {TOOLBAR_ITEMS.map(({ icon: Icon, label, prefix, suffix }) => (
          <Button
            key={label}
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={label}
            onClick={() => insertFormatting(prefix, suffix)}
          >
            <Icon className="h-3.5 w-3.5" />
          </Button>
        ))}
        <div className="flex-1" />
        <Button
          type="button"
          variant={showPreview ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 text-[10px] px-2"
          onClick={() => setShowPreview(!showPreview)}
        >
          {showPreview ? 'Edit' : 'Preview'}
        </Button>
      </div>

      {showPreview ? (
        <div className="p-3 min-h-[80px] prose prose-sm dark:prose-invert max-w-none text-sm">
          <MarkdownPreview content={value} />
        </div>
      ) : (
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className="border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 resize-y"
        />
      )}
    </div>
  );
}

/** Lightweight markdown preview without external deps */
function MarkdownPreview({ content }: { content: string }) {
  if (!content.trim()) {
    return <p className="text-muted-foreground italic">Nothing to preview</p>;
  }

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  lines.forEach((line, i) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('## ')) {
      elements.push(<h3 key={i} className="text-base font-semibold mt-2 mb-1">{formatInline(trimmed.slice(3))}</h3>);
    } else if (trimmed.startsWith('> ')) {
      elements.push(
        <blockquote key={i} className="border-l-2 border-primary/40 pl-3 italic text-muted-foreground my-1">
          {formatInline(trimmed.slice(2))}
        </blockquote>
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      elements.push(
        <div key={i} className="flex gap-2 items-start my-0.5">
          <span className="text-primary mt-0.5">•</span>
          <span>{formatInline(trimmed.slice(2))}</span>
        </div>
      );
    } else if (/^\d+\.\s/.test(trimmed)) {
      const match = trimmed.match(/^(\d+)\.\s(.*)$/);
      if (match) {
        elements.push(
          <div key={i} className="flex gap-2 items-start my-0.5">
            <span className="text-primary font-medium min-w-[1.2rem]">{match[1]}.</span>
            <span>{formatInline(match[2])}</span>
          </div>
        );
      }
    } else if (trimmed === '') {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="my-0.5">{formatInline(trimmed)}</p>);
    }
  });

  return <>{elements}</>;
}

function formatInline(text: string): React.ReactNode {
  // Process bold, italic, code, and links
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Italic
    const italicMatch = remaining.match(/_(.+?)_/);
    // Code
    const codeMatch = remaining.match(/`(.+?)`/);
    // Link
    const linkMatch = remaining.match(/\[(.+?)\]\((.+?)\)/);

    const matches = [
      boldMatch ? { type: 'bold', match: boldMatch, index: boldMatch.index! } : null,
      italicMatch ? { type: 'italic', match: italicMatch, index: italicMatch.index! } : null,
      codeMatch ? { type: 'code', match: codeMatch, index: codeMatch.index! } : null,
      linkMatch ? { type: 'link', match: linkMatch, index: linkMatch.index! } : null,
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
      case 'code':
        parts.push(
          <code key={key++} className="px-1.5 py-0.5 rounded bg-muted text-[0.85em] font-mono">
            {first.match![1]}
          </code>
        );
        break;
      case 'link':
        parts.push(
          <a key={key++} href={first.match![2]} className="text-primary underline" target="_blank" rel="noopener noreferrer">
            {first.match![1]}
          </a>
        );
        break;
    }

    remaining = remaining.substring(first.index + first.match![0].length);
  }

  return <>{parts}</>;
}
