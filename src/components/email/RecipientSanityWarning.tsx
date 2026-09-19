import { useMemo } from 'react';
import { AlertTriangle, ShieldCheck, Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';

const PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.com.au', 'hotmail.com',
  'outlook.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me',
  'protonmail.com', 'msn.com', 'bigpond.com', 'optusnet.com.au',
]);

const COMMON_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'hotnail.com': 'hotmail.com',
  'hotmial.com': 'hotmail.com',
  'yahooo.com': 'yahoo.com',
  'outlok.com': 'outlook.com',
  'outloook.com': 'outlook.com',
};

interface RecipientInfo {
  raw: string;
  domain: string | null;
  isPublic: boolean;
  typoFix: string | null;
}

function parseRecipients(value: string): RecipientInfo[] {
  return value
    .split(/[,;\s]+/)
    .map(v => v.trim())
    .filter(v => v.includes('@'))
    .map(raw => {
      const domain = raw.split('@')[1]?.toLowerCase() || null;
      return {
        raw,
        domain,
        isPublic: !!domain && PUBLIC_DOMAINS.has(domain),
        typoFix: domain ? (COMMON_TYPOS[domain] || null) : null,
      };
    });
}

interface RecipientSanityProps {
  to: string;
  cc?: string;
  bcc?: string;
  expectedDomain?: string | null;
  bodyText: string;
  attachmentCount: number;
  onApplyFix?: (oldEmail: string, fixedEmail: string) => void;
}

const ATTACHMENT_REGEX = /(please find attached|attached please find|i('|')ve attached|i have attached|attached is|see attached|pfa|attachment[s]?\s+(below|enclosed|above))/i;

export function RecipientSanityWarning({ to, cc, bcc, expectedDomain, bodyText, attachmentCount, onApplyFix }: RecipientSanityProps) {
  const all = useMemo(() => [...parseRecipients(to), ...parseRecipients(cc || ''), ...parseRecipients(bcc || '')], [to, cc, bcc]);

  const warnings: { kind: 'typo' | 'public' | 'mismatch' | 'attachment'; message: string; fix?: { from: string; to: string } }[] = [];

  for (const r of all) {
    if (r.typoFix) {
      const fixed = r.raw.replace(/@.+$/, '@' + r.typoFix);
      warnings.push({ kind: 'typo', message: `"${r.raw}" looks like a typo. Did you mean ${fixed}?`, fix: { from: r.raw, to: fixed } });
    }
  }

  if (expectedDomain) {
    const expected = expectedDomain.toLowerCase();
    const mismatched = all.filter(r => r.domain && r.domain !== expected && !r.isPublic);
    if (mismatched.length > 0) {
      warnings.push({
        kind: 'mismatch',
        message: `Replying to a ${expected} thread but recipient(s) are on different domains: ${mismatched.map(r => r.domain).join(', ')}`,
      });
    }
  }

  const externalCount = all.filter(r => !r.isPublic).length;
  const publicCount = all.filter(r => r.isPublic).length;
  if (publicCount > 0 && expectedDomain && !PUBLIC_DOMAINS.has(expectedDomain.toLowerCase())) {
    warnings.push({ kind: 'public', message: `Sending to ${publicCount} personal email address${publicCount > 1 ? 'es' : ''}. Confirm before sending sensitive info.` });
  }

  if (attachmentCount === 0 && bodyText && ATTACHMENT_REGEX.test(bodyText)) {
    warnings.push({ kind: 'attachment', message: 'Your message mentions an attachment but none are attached.' });
  }

  if (warnings.length === 0) {
    if (all.length === 0) return null;
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-success" />
        {all.length} recipient{all.length > 1 ? 's' : ''} look{all.length === 1 ? 's' : ''} good. {externalCount} external.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {warnings.map((w, i) => (
        <div
          key={i}
          className={cn(
            'flex items-start gap-2 text-xs p-2 rounded border',
            // `-foreground` is the ink for a SOLID `bg-warning`/`bg-info` and is
            // near-black in dark mode. On a 10% tint it renders the warning
            // unreadable — which is exactly how it was reported: "there is some
            // kind of warning but I can't read it".
            w.kind === 'typo' || w.kind === 'attachment' ? 'border-warning/40 bg-warning/10 text-warning' :
            'border-info/40 bg-info/10 text-info',
          )}
        >
          {w.kind === 'attachment' ? <Paperclip className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />}
          <span className="flex-1">{w.message}</span>
          {w.fix && onApplyFix && (
            <button className="underline font-medium" onClick={() => onApplyFix(w.fix!.from, w.fix!.to)}>Fix</button>
          )}
        </div>
      ))}
    </div>
  );
}

export function AttachmentSummary({ files }: { files: { name: string; size: number }[] }) {
  if (files.length === 0) return null;
  const total = files.reduce((a, f) => a + (f.size || 0), 0);
  const totalMb = total / (1024 * 1024);
  const tooBig = files.filter(f => f.size > 10 * 1024 * 1024);
  return (
    <div className="text-xs text-muted-foreground flex items-center gap-2">
      <Paperclip className="h-3 w-3" />
      <span>{files.length} file{files.length > 1 ? 's' : ''} • {totalMb.toFixed(1)} MB total</span>
      {tooBig.length > 0 && (
        <span className="text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          {tooBig.length} file{tooBig.length > 1 ? 's' : ''} over 10 MB
        </span>
      )}
    </div>
  );
}
