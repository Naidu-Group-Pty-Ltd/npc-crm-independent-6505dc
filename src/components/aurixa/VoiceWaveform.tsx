import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * VoiceWaveform — Phase 6 primitive.
 *
 * Compact animated bar chart giving live feedback while a voice-to-text
 * capture is active. Accepts either:
 *   - a synthetic mode driven by CSS animation (no audio wiring), or
 *   - a `levels` array of 0..1 amplitude samples updated by the caller.
 *
 * Respects `prefers-reduced-motion` by rendering flat resting bars.
 */

export interface VoiceWaveformProps {
  active: boolean;
  /** Optional live amplitude samples (0..1). If omitted, uses synthetic animation. */
  levels?: number[];
  /** Number of bars when synthetic. Defaults to 16. */
  bars?: number;
  /** Accessible label for screen readers. */
  ariaLabel?: string;
  className?: string;
}

export function VoiceWaveform({
  active,
  levels,
  bars = 16,
  ariaLabel = 'Voice input level',
  className,
}: VoiceWaveformProps) {
  const rendered = levels && levels.length > 0
    ? levels
    : Array.from({ length: bars }, (_, i) => i);

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      aria-live={active ? 'polite' : 'off'}
      className={cn('flex items-center gap-[3px] h-6', className)}
    >
      {rendered.map((sample, i) => {
        const level = typeof sample === 'number' && sample >= 0 && sample <= 1 ? sample : undefined;
        const height = level !== undefined ? Math.max(0.15, level) : undefined;

        return (
          <span
            key={i}
            aria-hidden="true"
            className={cn(
              'block w-[3px] rounded-full',
              active ? 'bg-primary' : 'bg-muted-foreground/40',
              !level && active && 'aurixa-waveform-bar motion-reduce:animate-none',
            )}
            style={
              level !== undefined
                ? { height: `${height! * 100}%` }
                : { animationDelay: `${(i % 8) * 90}ms` }
            }
          />
        );
      })}
    </div>
  );
}

export default VoiceWaveform;
