/**
 * useSpeech — Aurixa's voice, using the browser's own speech synthesis.
 *
 * Nothing leaves the device and nothing is billed: `speechSynthesis` is built
 * into every browser this product supports. A reply is spoken as it streams —
 * the caller hands over whole sentences (`takeSpeakable`) and they are queued
 * as utterances short enough for every engine (`chunkUtterances`), so the
 * first sentence is heard while the model is still writing the third.
 *
 * Three rules:
 * - **An Australian voice when there is one**, an English one otherwise, and
 *   never a voice that would read English in another language's phonetics.
 * - **Speaking is always interruptible.** `cancel()` stops the current
 *   utterance and drops the queue; a person talking over Aurixa wins.
 * - **Unsupported is silent, never an error.** `supported` is false and every
 *   call is a no-op, so the UI hides the control rather than breaking.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chunkUtterances } from './speech.pure';

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  const pool = english.length ? english : [];
  const rank = (v: SpeechSynthesisVoice) => {
    let score = 0;
    if (/en[-_]AU/i.test(v.lang)) score += 40;
    else if (/en[-_]GB/i.test(v.lang)) score += 20;
    else if (/en[-_](NZ|IE)/i.test(v.lang)) score += 15;
    if (/natural|neural|premium|enhanced/i.test(v.name)) score += 12;
    if (/google|microsoft|siri|samantha|karen|catherine/i.test(v.name)) score += 4;
    if (v.localService) score += 2;
    return score;
  };
  return [...pool].sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

export interface SpeechControls {
  supported: boolean;
  speaking: boolean;
  /** Queue text for speaking. Safe to call repeatedly while a reply streams. */
  enqueue: (text: string) => void;
  /** Stop now and forget anything queued. */
  cancel: () => void;
  /** Resolves when the queue has finished (or was cancelled). */
  whenIdle: () => Promise<void>;
  /** Call from a user gesture once, so iOS Safari will allow later speech. */
  unlock: () => void;
}

export function useSpeech(): SpeechControls {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  const [speaking, setSpeaking] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const pendingRef = useRef(0);
  const idleWaitersRef = useRef<Array<() => void>>([]);
  const generationRef = useRef(0);
  const unlockedRef = useRef(false);

  useEffect(() => {
    if (!supported) return;
    const load = () => {
      voiceRef.current = pickVoice(window.speechSynthesis.getVoices());
    };
    load();
    window.speechSynthesis.addEventListener?.('voiceschanged', load);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', load);
      window.speechSynthesis.cancel();
    };
  }, [supported]);

  const settleIfIdle = useCallback(() => {
    if (pendingRef.current > 0) return;
    setSpeaking(false);
    const waiters = idleWaitersRef.current;
    idleWaitersRef.current = [];
    waiters.forEach((w) => w());
  }, []);

  const enqueue = useCallback(
    (text: string) => {
      if (!supported) return;
      const chunks = chunkUtterances(text);
      if (!chunks.length) return;
      const generation = generationRef.current;
      for (const chunk of chunks) {
        const u = new SpeechSynthesisUtterance(chunk);
        if (voiceRef.current) {
          u.voice = voiceRef.current;
          u.lang = voiceRef.current.lang;
        } else {
          u.lang = 'en-AU';
        }
        u.rate = 1.04;
        u.pitch = 1;
        const done = () => {
          if (generation !== generationRef.current) return;
          pendingRef.current = Math.max(0, pendingRef.current - 1);
          settleIfIdle();
        };
        u.onend = done;
        u.onerror = done;
        pendingRef.current += 1;
        window.speechSynthesis.speak(u);
      }
      setSpeaking(true);
      // Chrome pauses a long queue in a background tab; a resume is harmless.
      window.speechSynthesis.resume();
    },
    [supported, settleIfIdle],
  );

  const cancel = useCallback(() => {
    if (!supported) return;
    generationRef.current += 1;
    pendingRef.current = 0;
    window.speechSynthesis.cancel();
    settleIfIdle();
  }, [supported, settleIfIdle]);

  const whenIdle = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (!supported || pendingRef.current === 0) {
          resolve();
          return;
        }
        idleWaitersRef.current.push(resolve);
      }),
    [supported],
  );

  const unlock = useCallback(() => {
    if (!supported || unlockedRef.current) return;
    unlockedRef.current = true;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch {
      /* a refused warm-up costs nothing */
    }
  }, [supported]);

  return useMemo(
    () => ({ supported, speaking, enqueue, cancel, whenIdle, unlock }),
    [supported, speaking, enqueue, cancel, whenIdle, unlock],
  );
}
