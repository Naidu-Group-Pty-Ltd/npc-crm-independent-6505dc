import { useEffect, useRef, useState, KeyboardEvent } from 'react';
import { Check, X, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  value: string | number | null | undefined;
  onSave: (next: string) => Promise<void> | void;
  type?: 'text' | 'number' | 'date';
  placeholder?: string;
  display?: (v: string | number | null | undefined) => string;
  className?: string;
  disabled?: boolean;
}

/** Lightweight click-to-edit cell. Enter to save, Esc to cancel. */
export function InlineEdit({
  value, onSave, type = 'text', placeholder = 'Click to edit',
  display, className, disabled,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(value ?? ''));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setVal(String(value ?? '')); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = async () => {
    if (val === String(value ?? '')) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(val); setEditing(false); }
    finally { setSaving(false); }
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { setVal(String(value ?? '')); setEditing(false); }
  };

  if (disabled) {
    return <span className={className}>{display ? display(value) : (value ?? placeholder)}</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        className={cn(
          'group inline-flex items-center gap-1 rounded px-1 -mx-1 hover:bg-accent/40 transition-colors text-left',
          className,
        )}
      >
        <span>{display ? display(value) : (value || placeholder)}</span>
        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />
      </button>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type={type}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={handleKey}
        disabled={saving}
        className="bg-background border border-border rounded px-1.5 py-0.5 text-sm min-w-[80px] focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <button
        type="button"
        onClick={commit}
        disabled={saving}
        className="text-success hover:text-success disabled:opacity-50"
      ><Check className="h-3.5 w-3.5" /></button>
      <button
        type="button"
        onClick={() => { setVal(String(value ?? '')); setEditing(false); }}
        disabled={saving}
        className="text-muted-foreground hover:text-foreground"
      ><X className="h-3.5 w-3.5" /></button>
    </span>
  );
}
