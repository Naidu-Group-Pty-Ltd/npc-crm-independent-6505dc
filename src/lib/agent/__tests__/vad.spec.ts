import { describe, expect, it } from 'vitest';
import { createVad, rmsFromBytes } from '../vad.pure';

/** Feed a constant loudness for a duration in 20 ms frames. */
function feed(vad: ReturnType<typeof createVad>, rms: number, ms: number) {
  let last = vad.state();
  for (let t = 0; t < ms; t += 20) last = vad.push(rms, 20);
  return last;
}

describe('createVad', () => {
  it('calibrates the room before it listens', () => {
    const vad = createVad();
    expect(vad.push(0.01, 20).phase).toBe('calibrating');
    const after = feed(vad, 0.01, 300);
    expect(after.phase).toBe('waiting');
    expect(after.threshold).toBeGreaterThanOrEqual(0.018);
  });

  it('raises the threshold in a noisy room', () => {
    const vad = createVad();
    const s = feed(vad, 0.05, 300);
    expect(s.threshold).toBeCloseTo(0.13, 2);
    // The air-conditioner alone never starts a turn.
    expect(feed(vad, 0.05, 2000).phase).toBe('waiting');
  });

  it('ignores a click but hears a sentence', () => {
    const vad = createVad();
    feed(vad, 0.005, 300);
    expect(feed(vad, 0.2, 60).phase).toBe('waiting');
    feed(vad, 0.005, 200);
    expect(feed(vad, 0.2, 400).phase).toBe('speaking');
  });

  it('ends the turn after a sustained pause, not a breath', () => {
    const vad = createVad({ silenceMs: 1000 });
    feed(vad, 0.005, 300);
    feed(vad, 0.2, 600);
    expect(feed(vad, 0.005, 400).phase).toBe('speaking');
    feed(vad, 0.2, 200);
    expect(feed(vad, 0.005, 1040).phase).toBe('ended');
  });

  it('says nothing was heard rather than sending silence', () => {
    const vad = createVad({ noSpeechMs: 3000 });
    expect(feed(vad, 0.004, 3100).phase).toBe('no-speech');
  });

  it('stops a turn that runs past the limit', () => {
    const vad = createVad({ maxMs: 2000 });
    feed(vad, 0.004, 300);
    expect(feed(vad, 0.3, 2000).phase).toBe('max-length');
  });

  it('stays put once a turn has ended', () => {
    const vad = createVad({ silenceMs: 200 });
    feed(vad, 0.004, 300);
    feed(vad, 0.3, 400);
    feed(vad, 0.004, 300);
    expect(vad.push(0.5, 20).phase).toBe('ended');
  });

  it('reports a drawing level between nought and one', () => {
    const vad = createVad();
    feed(vad, 0.004, 300);
    const loud = vad.push(0.9, 20);
    expect(loud.level).toBe(1);
    expect(vad.push(0, 20).level).toBe(0);
  });
});

describe('rmsFromBytes', () => {
  it('reads 128 as silence', () => {
    expect(rmsFromBytes(new Uint8Array(64).fill(128))).toBe(0);
    expect(rmsFromBytes([])).toBe(0);
  });

  it('reads a full-scale square wave as one', () => {
    const frame = Array.from({ length: 64 }, (_, i) => (i % 2 ? 0 : 256));
    expect(rmsFromBytes(frame)).toBeCloseTo(1, 5);
  });
});
