/**
 * Voice activity detection — knowing when a person has finished speaking.
 *
 * A hands-free conversation lives or dies on one decision: when to stop
 * listening. Stop too early and Aurixa answers half a question; too late and
 * the pause before the reply feels like a dropped call. This is a small,
 * deterministic state machine over the microphone's loudness, kept pure so the
 * decision is tested rather than tuned by ear.
 *
 * - **The room is measured first.** The opening moment calibrates a noise
 *   floor, so an air-conditioner is not mistaken for a voice and a quiet
 *   office is not mistaken for silence.
 * - **Speech must be sustained.** A cough or a door click does not count;
 *   loudness above the threshold has to add up before the turn has begun.
 * - **Silence ends a turn only after speech.** Thinking before speaking is
 *   allowed; a person who never speaks is told nothing was heard rather than
 *   sent an empty recording.
 */

export type VadPhase = 'calibrating' | 'waiting' | 'speaking' | 'ended' | 'no-speech' | 'max-length';

export interface VadOptions {
  calibrationMs?: number;
  /** Loud time needed before a turn counts as begun. */
  minSpeechMs?: number;
  /** Quiet time after speech that ends the turn. */
  silenceMs?: number;
  /** Give up if nothing is said for this long. */
  noSpeechMs?: number;
  maxMs?: number;
  /** The quietest a threshold may be, whatever the room measured. */
  minThreshold?: number;
}

export interface VadState {
  phase: VadPhase;
  floor: number;
  threshold: number;
  speechMs: number;
  quietMs: number;
  /** 0..1, how far above the floor the last frame was — for drawing. */
  level: number;
}

export interface Vad {
  push: (rms: number, dtMs: number) => VadState;
  state: () => VadState;
}

const DEFAULTS: Required<VadOptions> = {
  calibrationMs: 280,
  minSpeechMs: 160,
  silenceMs: 1250,
  noSpeechMs: 9000,
  maxMs: 60_000,
  minThreshold: 0.018,
};

export function createVad(options: VadOptions = {}): Vad {
  const o = { ...DEFAULTS, ...options };
  let elapsed = 0;
  let calibSum = 0;
  let calibCount = 0;
  const s: VadState = { phase: 'calibrating', floor: 0, threshold: o.minThreshold, speechMs: 0, quietMs: 0, level: 0 };

  const terminal = () => s.phase === 'ended' || s.phase === 'no-speech' || s.phase === 'max-length';

  function push(rms: number, dtMs: number): VadState {
    if (terminal()) return { ...s };
    const value = Number.isFinite(rms) && rms > 0 ? rms : 0;
    const dt = Math.max(0, dtMs);
    elapsed += dt;

    if (s.phase === 'calibrating') {
      calibSum += value;
      calibCount += 1;
      if (elapsed >= o.calibrationMs) {
        s.floor = calibCount ? calibSum / calibCount : 0;
        s.threshold = Math.max(o.minThreshold, s.floor * 2.6);
        s.phase = 'waiting';
      }
      s.level = 0;
      return { ...s };
    }

    s.level = Math.max(0, Math.min(1, (value - s.floor) / Math.max(0.08, s.threshold * 4)));
    const loud = value >= s.threshold;

    if (s.phase === 'waiting') {
      if (loud) {
        s.speechMs += dt;
        if (s.speechMs >= o.minSpeechMs) {
          s.phase = 'speaking';
          s.quietMs = 0;
        }
      } else {
        // Brief blips decay rather than accumulate forever.
        s.speechMs = Math.max(0, s.speechMs - dt / 2);
        if (elapsed >= o.noSpeechMs) s.phase = 'no-speech';
      }
    } else if (s.phase === 'speaking') {
      // Hysteresis: a dip below the threshold is not yet silence.
      if (value < s.threshold * 0.7) {
        s.quietMs += dt;
        if (s.quietMs >= o.silenceMs) s.phase = 'ended';
      } else {
        s.quietMs = 0;
        s.speechMs += dt;
      }
    }

    if (!terminal() && elapsed >= o.maxMs) s.phase = s.phase === 'speaking' ? 'max-length' : 'no-speech';
    return { ...s };
  }

  return { push, state: () => ({ ...s }) };
}

/** Root-mean-square loudness of an 8-bit time-domain frame (128 = silence). */
export function rmsFromBytes(frame: ArrayLike<number>): number {
  if (!frame.length) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) {
    const v = (frame[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / frame.length);
}
