/**
 * E11 — map a pure StatusTone to a semantic shadcn Badge variant.
 * Semantic tokens only; never a raw palette class or hex.
 */
import type { StatusTone } from '@/lib/reportTemplate/pdfImport/review/statusLanguage';

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline';

export function toneToBadgeVariant(tone: StatusTone): BadgeVariant {
  switch (tone) {
    case 'success': return 'success';
    case 'review': return 'secondary';
    case 'warning': return 'warning';
    case 'danger': return 'destructive';
    default: return 'outline';
  }
}

/** A tone-driven text token class (semantic, never raw palette). */
export function toneToTextClass(tone: StatusTone): string {
  switch (tone) {
    case 'success': return 'text-[hsl(var(--success))]';
    case 'warning': return 'text-[hsl(var(--warning))]';
    case 'danger': return 'text-destructive';
    default: return 'text-muted-foreground';
  }
}
