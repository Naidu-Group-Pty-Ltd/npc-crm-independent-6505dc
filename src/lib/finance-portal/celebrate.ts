/**
 * Batch 13 #65 — Subtle confetti celebrations for delight moments.
 * Respects user "celebrations_enabled" preference cached in localStorage.
 */
import confetti from 'canvas-confetti';

const KEY = 'finance_celebrations_enabled';

export function setCelebrationsEnabled(enabled: boolean) {
  try {
    localStorage.setItem(KEY, enabled ? '1' : '0');
  } catch {}
}

export function celebrationsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export type CelebrationKind =
  | 'settlement'
  | 'unconditional_approval'
  | 'first_deal_of_month'
  | 'generic';

const PRIMARY_GOLD = ['#D4A843', '#F0C75A', '#E5B96A', '#B98A2E'];

export function triggerFinanceCelebration(kind: CelebrationKind = 'generic') {
  if (!celebrationsEnabled()) return;
  if (typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const burst = (opts: Partial<confetti.Options>) =>
    confetti({
      colors: PRIMARY_GOLD,
      spread: 60,
      ticks: 200,
      gravity: 0.85,
      scalar: 0.9,
      ...opts,
    });

  if (kind === 'settlement') {
    burst({ particleCount: 130, startVelocity: 55, spread: 95, origin: { x: 0.5, y: 0.7 } });
    setTimeout(() => burst({ particleCount: 60, origin: { x: 0.15, y: 0.75 } }), 180);
    setTimeout(() => burst({ particleCount: 60, origin: { x: 0.85, y: 0.75 } }), 320);
  } else if (kind === 'unconditional_approval') {
    burst({ particleCount: 90, startVelocity: 45, origin: { x: 0.5, y: 0.7 } });
  } else if (kind === 'first_deal_of_month') {
    burst({ particleCount: 110, startVelocity: 50, spread: 110, origin: { x: 0.5, y: 0.65 } });
  } else {
    burst({ particleCount: 60, origin: { x: 0.5, y: 0.7 } });
  }
}
