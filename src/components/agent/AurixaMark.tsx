import { cn } from '@/lib/utils';

/**
 * AurixaMark — the signature animated brand mark for the Aurixa Agent.
 * A layered aurora orb: gold core, orbiting aurora ring, subtle diamond
 * facet. Purely presentational; state prop only affects motion + glow.
 *
 * All colour comes from --aurixa-* tokens defined in tokens.css, so it
 * automatically follows white-label and dark/light theming.
 */

export type AurixaMarkSize = 'xs' | 'sm' | 'md' | 'lg' | 'hero';
export type AurixaMarkState = 'idle' | 'thinking' | 'speaking' | 'alert';

const SIZE_PX: Record<AurixaMarkSize, number> = {
  xs: 16,
  sm: 22,
  md: 32,
  lg: 48,
  hero: 96,
};

interface AurixaMarkProps {
  size?: AurixaMarkSize;
  state?: AurixaMarkState;
  className?: string;
  'aria-label'?: string;
}

export function AurixaMark({
  size = 'md',
  state = 'idle',
  className,
  'aria-label': ariaLabel = 'Aurixa',
}: AurixaMarkProps) {
  const px = SIZE_PX[size];
  const uid = `aurixa-${size}-${state}`;

  return (
    <span
      role="img"
      aria-label={ariaLabel}
      className={cn(
        'relative inline-flex items-center justify-center align-middle',
        state !== 'idle' && 'animate-aurixa-breathe',
        className
      )}
      style={{ width: px, height: px }}
    >
      {/* Outer aurora glow — softer for xs/sm */}
      <span
        aria-hidden
        className="absolute inset-[-14%] rounded-full opacity-70 blur-[6px]"
        style={{
          background: `conic-gradient(from 210deg,
            hsl(var(--aurixa-aurora-1) / 0.9),
            hsl(var(--aurixa-aurora-2) / 0.7),
            hsl(var(--aurixa-aurora-3) / 0.8),
            hsl(var(--aurixa-aurora-1) / 0.9))`,
          animation:
            state === 'thinking' || state === 'speaking'
              ? 'aurixa-orb-spin 6s linear infinite'
              : 'aurixa-orb-spin 24s linear infinite',
        }}
      />
      {/* Alert ping */}
      {state === 'alert' && (
        <span
          aria-hidden
          className="absolute inset-[-20%] rounded-full"
          style={{
            boxShadow: '0 0 0 2px hsl(var(--destructive) / 0.6)',
            animation: 'aurixa-orb-breathe 1.2s ease-in-out infinite',
          }}
        />
      )}
      <svg
        viewBox="0 0 100 100"
        width={px}
        height={px}
        className="relative z-10 drop-shadow-[0_0_6px_hsl(var(--aurixa-glow)/0.5)]"
      >
        <defs>
          <radialGradient id={`${uid}-core`} cx="50%" cy="45%" r="55%">
            <stop offset="0%" stopColor="hsl(var(--aurixa-glow))" stopOpacity="1" />
            <stop offset="55%" stopColor="hsl(var(--aurixa-aurora-1))" stopOpacity="0.95" />
            <stop offset="100%" stopColor="hsl(var(--aurixa-obsidian))" stopOpacity="1" />
          </radialGradient>
          <linearGradient id={`${uid}-facet`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--aurixa-glass-bg))" stopOpacity="0.9" />
            <stop offset="100%" stopColor="hsl(var(--aurixa-glass-bg))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="42" fill={`url(#${uid}-core)`} />
        {/* diamond facet highlight */}
        <path
          d="M50 18 L70 50 L50 82 L30 50 Z"
          fill={`url(#${uid}-facet)`}
          opacity="0.45"
        />
        {/* inner ring hairline */}
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke="hsl(var(--aurixa-glass-border))"
          strokeOpacity="0.6"
          strokeWidth="0.75"
        />
      </svg>
    </span>
  );
}

export default AurixaMark;
