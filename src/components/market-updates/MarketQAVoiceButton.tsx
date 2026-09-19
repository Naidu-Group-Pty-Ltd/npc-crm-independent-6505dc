/**
 * Market Updates Q&A voice-to-text button.
 * Mirrors the finance-portal VoiceMemo pattern: MediaRecorder → base64 →
 * server transcription → callback with transcript. No persistence.
 */
import { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Square, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  onTranscript: (text: string) => void;
  maxSeconds?: number;
  disabled?: boolean;
  size?: 'sm' | 'icon';
}

export function MarketQAVoiceButton({ onTranscript, maxSeconds = 45, disabled, size = 'sm' }: Props) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAt = useRef<number>(0);

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (mediaRef.current && mediaRef.current.state !== 'inactive') {
      try { mediaRef.current.stop(); } catch {/* noop */}
    }
  }, []);

  const stop = () => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    if (mediaRef.current && mediaRef.current.state !== 'inactive') mediaRef.current.stop();
    setRecording(false);
  };

  const start = async () => {
    if (busy || recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const mimeType = mimeCandidates.find((m) => (window as any).MediaRecorder?.isTypeSupported?.(m)) || '';
      const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        await transcribe(blob);
      };
      mr.start();
      mediaRef.current = mr;
      startedAt.current = Date.now();
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => {
        setElapsed((e) => {
          const next = Math.round((Date.now() - startedAt.current) / 1000);
          if (next >= maxSeconds) { stop(); return maxSeconds; }
          return next;
        });
      }, 250);
    } catch (err) {
      toast.error('Microphone access denied');
      console.warn('[MarketQAVoiceButton] mic error', err);
    }
  };

  const transcribe = async (blob: Blob) => {
    if (blob.size < 512) {
      toast.error('That recording was too short — please try again.');
      return;
    }
    setBusy(true);
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
      const { data, error } = await supabase.functions.invoke('market-updates-voice-transcribe', {
        body: { audio_base64: b64.split(',')[1], mime_type: blob.type || 'audio/webm' },
      });
      if (error) throw new Error(error.message);
      const transcript = (data?.transcript ?? '').trim();
      if (!transcript) {
        toast.error('No speech detected — please try again.');
        return;
      }
      onTranscript(transcript);
      toast.success('Transcribed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transcription failed';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  if (busy) {
    return (
      <Button type="button" size={size} variant="outline" disabled className="gap-1.5">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {size !== 'icon' && <span>Transcribing…</span>}
      </Button>
    );
  }

  if (recording) {
    return (
      <Button type="button" size={size} variant="destructive" onClick={stop} className="gap-1.5">
        <Square className="h-3.5 w-3.5" />
        {size !== 'icon' && <span>Stop · {elapsed}s</span>}
      </Button>
    );
  }

  return (
    <Button type="button" size={size} variant="outline" onClick={start} disabled={disabled} className="gap-1.5" title="Record voice question">
      <Mic className="h-3.5 w-3.5" />
      {size !== 'icon' && <span>Voice</span>}
    </Button>
  );
}
