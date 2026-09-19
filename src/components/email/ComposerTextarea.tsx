import { forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Bold, Italic, List, ListOrdered, Link2, Wand2, Quote } from 'lucide-react';
import { SlashSnippetMenu, EmailSnippet } from './EmailSnippets';

export interface ComposerTextareaHandle {
  focus: () => void;
  getElement: () => HTMLTextAreaElement | null;
  insertAtCursor: (text: string) => void;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  snippets: EmailSnippet[];
  onManageSnippets?: () => void;
  placeholder?: string;
  className?: string;
  rows?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  showToolbar?: boolean;
  textareaRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
}

function wrapSelection(el: HTMLTextAreaElement, before: string, after: string = before, placeholder = '') {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const value = el.value;
  const sel = value.slice(start, end) || placeholder;
  const next = value.slice(0, start) + before + sel + after + value.slice(end);
  return { next, cursorStart: start + before.length, cursorEnd: start + before.length + sel.length };
}

function lineTransform(el: HTMLTextAreaElement, fn: (line: string, idx: number) => string) {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const value = el.value;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = value.indexOf('\n', end);
  const sliceEnd = lineEnd === -1 ? value.length : lineEnd;
  const block = value.slice(lineStart, sliceEnd);
  const newBlock = block.split('\n').map(fn).join('\n');
  const next = value.slice(0, lineStart) + newBlock + value.slice(sliceEnd);
  return { next, cursorStart: lineStart, cursorEnd: lineStart + newBlock.length };
}

export const ComposerTextarea = forwardRef<ComposerTextareaHandle, Props>(function ComposerTextarea(
  { value, onChange, snippets, onManageSnippets, placeholder, className, rows = 12, onKeyDown, showToolbar = true, textareaRef },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const setTaRef = useCallback((el: HTMLTextAreaElement | null) => {
    (taRef as any).current = el;
    if (textareaRef) textareaRef.current = el;
  }, [textareaRef]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashStart, setSlashStart] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    getElement: () => taRef.current,
    insertAtCursor: (text: string) => {
      const el = taRef.current; if (!el) return;
      const start = el.selectionStart, end = el.selectionEnd;
      const next = el.value.slice(0, start) + text + el.value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        if (taRef.current) {
          taRef.current.focus();
          taRef.current.selectionStart = taRef.current.selectionEnd = start + text.length;
        }
      });
    },
  }), [onChange]);

  const apply = (mode: 'bold' | 'italic' | 'ul' | 'ol' | 'quote' | 'link') => {
    const el = taRef.current; if (!el) return;
    let res;
    if (mode === 'bold') res = wrapSelection(el, '**', '**', 'bold text');
    else if (mode === 'italic') res = wrapSelection(el, '*', '*', 'italic text');
    else if (mode === 'link') {
      const url = prompt('Link URL?'); if (!url) return;
      const start = el.selectionStart, end = el.selectionEnd;
      const sel = el.value.slice(start, end) || url;
      const insert = `[${sel}](${url})`;
      const next = el.value.slice(0, start) + insert + el.value.slice(end);
      onChange(next);
      requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + insert.length; });
      return;
    }
    else if (mode === 'ul') res = lineTransform(el, l => l.startsWith('- ') ? l.slice(2) : '- ' + l);
    else if (mode === 'ol') res = lineTransform(el, (l, i) => `${i + 1}. ${l.replace(/^\d+\.\s+/, '')}`);
    else if (mode === 'quote') res = lineTransform(el, l => l.startsWith('> ') ? l.slice(2) : '> ' + l);
    if (res) {
      onChange(res.next);
      requestAnimationFrame(() => {
        if (!taRef.current) return;
        taRef.current.focus();
        taRef.current.selectionStart = res.cursorStart;
        taRef.current.selectionEnd = res.cursorEnd;
      });
    }
  };

  const computeAnchor = useCallback(() => {
    const el = taRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    setAnchor({ top: rect.bottom + 4, left: rect.left + 8 });
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    onChange(newVal);
    const el = e.target;
    const caret = el.selectionStart;
    // detect slash command: latest "/" on a word boundary up to caret
    const before = newVal.slice(0, caret);
    const m = before.match(/(?:^|\s)\/([\w-]*)$/);
    if (m) {
      const start = caret - m[1].length - 1; // position of "/"
      setSlashStart(start);
      setSlashQuery(m[1]);
      setSlashOpen(true);
      computeAnchor();
    } else {
      setSlashOpen(false);
      setSlashStart(null);
    }
  };

  const pickSnippet = (s: EmailSnippet) => {
    if (slashStart === null) return;
    const el = taRef.current; if (!el) return;
    const before = value.slice(0, slashStart);
    const after = value.slice(el.selectionStart);
    const next = before + s.body + after;
    onChange(next);
    setSlashOpen(false); setSlashStart(null); setSlashQuery('');
    requestAnimationFrame(() => {
      if (!taRef.current) return;
      const pos = before.length + s.body.length;
      taRef.current.focus();
      taRef.current.selectionStart = taRef.current.selectionEnd = pos;
    });
  };

  useEffect(() => {
    if (!slashOpen) return;
    const onScroll = () => computeAnchor();
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => { window.removeEventListener('resize', onScroll); window.removeEventListener('scroll', onScroll, true); };
  }, [slashOpen, computeAnchor]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // shortcut bold/italic
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
      if (e.key === 'b') { e.preventDefault(); apply('bold'); return; }
      if (e.key === 'i') { e.preventDefault(); apply('italic'); return; }
      if (e.key === 'k') { e.preventDefault(); apply('link'); return; }
    }
    onKeyDown?.(e);
  };

  return (
    <div className="relative">
      {showToolbar && (
        <div className="flex items-center gap-1 mb-2 p-1 border rounded-md bg-muted/30">
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => apply('bold')} title="Bold (Ctrl/Cmd+B)"><Bold className="h-3.5 w-3.5" /></Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => apply('italic')} title="Italic (Ctrl/Cmd+I)"><Italic className="h-3.5 w-3.5" /></Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => apply('ul')} title="Bulleted list"><List className="h-3.5 w-3.5" /></Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => apply('ol')} title="Numbered list"><ListOrdered className="h-3.5 w-3.5" /></Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => apply('quote')} title="Quote"><Quote className="h-3.5 w-3.5" /></Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => apply('link')} title="Link (Ctrl/Cmd+K)"><Link2 className="h-3.5 w-3.5" /></Button>
          <div className="w-px h-5 bg-border mx-1" />
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={onManageSnippets} title="Manage snippets">
            <Wand2 className="h-3.5 w-3.5" /> Snippets
          </Button>
          <span className="ml-auto text-[10px] text-muted-foreground pr-1">Type <kbd className="px-1 border rounded text-[10px]">/</kbd> for snippets</span>
        </div>
      )}
      <Textarea
        ref={setTaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKey}
        placeholder={placeholder}
        className={className}
        rows={rows}
      />
      <SlashSnippetMenu
        open={slashOpen}
        query={slashQuery}
        snippets={snippets}
        onPick={pickSnippet}
        onClose={() => { setSlashOpen(false); setSlashStart(null); }}
        onManage={onManageSnippets}
        anchor={anchor}
      />
    </div>
  );
});
