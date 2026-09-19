/**
 * TypingPresence — shared "someone is typing" surface for every chat surface.
 *
 * Wordmark treatment inspired by the NPC property-advisory identity: the name
 * is the hero, followed by blue, gold and purple live-status words. It is a
 * clean typographic signal rather than another chat pill.
 */
import { cn } from '@/lib/utils';

export interface TypingPerson {
  name: string;
  /** Optional stable id — used to keep the assigned colour consistent. */
  id?: string | null;
}

/** Blue · Yellow · Purple — semantic tokens only. */
const TINTS = [
  {
    key: 'blue',
    name: 'text-info',
  },
  {
    key: 'yellow',
    name: 'text-warning',
  },
  {
    key: 'purple',
    name: 'text-chart-5',
  },
] as const;

function tintFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 9973;
  return TINTS[hash % TINTS.length];
}

/** Three-dot cadence. */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-[3px]', className)} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-current opacity-70 animate-bounce motion-reduce:animate-none"
          style={{ animationDelay: `${i * 140}ms`, animationDuration: '900ms' }}
        />
      ))}
    </span>
  );
}

export function TypingPresence({
  people,
  size = 'md',
  className,
}: {
  people: TypingPerson[];
  size?: 'sm' | 'md';
  className?: string;
}) {
  const unique: TypingPerson[] = [];
  const seen = new Set<string>();
  for (const p of people) {
    const key = (p.name || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  if (!unique.length) return null;

  const shown = unique.slice(0, 3);
  const extra = unique.length - shown.length;
  const verb = unique.length === 1 ? 'is typing' : 'are typing';
  const sm = size === 'sm';

  return (
    <div
      className={cn(
        'relative flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 overflow-hidden px-1 py-1 font-semibold',
        className,
      )}
      aria-live="polite"
      aria-label={`${shown.map((p) => p.name).join(', ')} ${verb}`}
    >
      {shown.map((p) => {
        const tint = tintFor(p.id || p.name);
        return (
          <span
            key={p.id ?? p.name}
            className={cn(
              'relative min-w-0 truncate',
              tint.name,
              sm ? 'text-xs' : 'text-sm',
            )}
          >
            {p.name}
          </span>
        );
      })}

      {extra > 0 && (
        <span className={cn('text-muted-foreground', sm ? 'text-[10px]' : 'text-[11px]')}>
          +{extra}
        </span>
      )}

      <span
        className={cn(
          'flex shrink-0 items-center gap-1.5',
          sm ? 'text-xs' : 'text-sm',
        )}
      >
        <span className="text-info">{verb.split(' ')[0]}</span>
        <span className="text-warning">typing</span>
        <TypingDots className="shrink-0 text-chart-5" />
      </span>
      <span aria-hidden className="absolute inset-x-1 bottom-0 h-px origin-left animate-pulse bg-gradient-to-r from-info via-warning to-chart-5 motion-reduce:animate-none" />
    </div>
  );
}

export default TypingPresence;
