/**
 * AurixaPresence — Aurixa as someone, not something.
 *
 * The brand mark (`AurixaMark`) is a logo; this is a character. A dark,
 * glossy orb with the aurora moving inside it and two small eyes that do what
 * a colleague's do: they blink, they glance about while idle, look up while
 * thinking, settle down to the page while working or writing, widen while
 * listening and squint happily when something is done. Every mood comes from
 * `derivePresence`, so the orb in the launcher, the header, the home screen
 * and voice mode are always saying the same thing.
 *
 * Listening is literal: given `getLevel`, the orb swells with the speaker's
 * voice. The level is written straight to a CSS custom property on each
 * animation frame — it never triggers a React render.
 *
 * Decorative by default (`aria-hidden`); the surrounding status text is what
 * a screen reader hears. Motion is CSS only and stops entirely under
 * `prefers-reduced-motion`.
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import type { PresenceMood } from '@/lib/agent/presence.pure';
import '../aurixa.css';

export interface AurixaPresenceProps {
  mood?: PresenceMood;
  /** Diameter in px. */
  size?: number;
  /** 0..1 loudness, polled each frame while listening. */
  getLevel?: () => number;
  /** Drop the idle glance/blink loop (for small repeated uses). */
  still?: boolean;
  className?: string;
  label?: string;
}

export function AurixaPresence({ mood = 'idle', size = 48, getLevel, still, className, label }: AurixaPresenceProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (mood !== 'listening' || !getLevel) {
      el.style.setProperty('--ap-level', '0');
      return;
    }
    let raf = 0;
    const tick = () => {
      el.style.setProperty('--ap-level', getLevel().toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.style.setProperty('--ap-level', '0');
    };
  }, [mood, getLevel]);

  return (
    <span
      ref={ref}
      className={cn('aurixa-presence', still && 'aurixa-presence--still', className)}
      data-mood={mood}
      style={{ '--ap-size': `${size}px` } as CSSProperties}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="aurixa-presence__halo" />
      <span className="aurixa-presence__ring" />
      <span className="aurixa-presence__body">
        <span className="aurixa-presence__swirl" />
        <span className="aurixa-presence__sheen" />
        <span className="aurixa-presence__face">
          <span className="aurixa-presence__eye" />
          <span className="aurixa-presence__eye" />
        </span>
      </span>
      <span className="aurixa-presence__satellite" />
    </span>
  );
}
