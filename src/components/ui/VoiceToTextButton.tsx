import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Loader2, Pause, Play, Square } from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface VoiceToTextButtonProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  size?: 'sm' | 'default';
  className?: string;
}

/** Detect the best supported audio MIME type for cross-browser compatibility */
function getSupportedMimeType(): { mimeType: string; ext: string } {
  const types = [
    { mimeType: 'audio/webm;codecs=opus', ext: 'webm' },
    { mimeType: 'audio/webm', ext: 'webm' },
    { mimeType: 'audio/mp4', ext: 'mp4' },
    { mimeType: 'audio/ogg;codecs=opus', ext: 'ogg' },
    { mimeType: 'audio/ogg', ext: 'ogg' },
  ];
  for (const t of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t.mimeType)) {
      return t;
    }
  }
  return { mimeType: 'audio/webm', ext: 'webm' };
}

const MAX_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export function VoiceToTextButton({ onTranscript, disabled, size = 'default', className }: VoiceToTextButtonProps) {
  const [state, setState] = useState<'idle' | 'recording' | 'paused' | 'transcribing'>('idle');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mimeRef = useRef(getSupportedMimeType());
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setElapsed(0);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const { mimeType } = mimeRef.current;
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (intervalRef.current) clearInterval(intervalRef.current);
        streamRef.current?.getTracks().forEach(t => t.stop());

        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size < 100) {
          toast.error('Recording too short');
          setState('idle');
          cleanup();
          return;
        }

        setState('transcribing');
        try {
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          const { data, error } = await invokeSecureFunction('voice-to-text', {
            audio: base64,
            mimeType,
            fileName: `audio.${mimeRef.current.ext}`,
          });

          if (error) throw new Error(error.message || 'Transcription failed');
          if (data?.text) {
            onTranscript(data.text);
          } else {
            toast.error('No speech detected');
          }
        } catch (err: any) {
          console.error('Voice-to-text error:', err);
          toast.error('Transcription failed: ' + (err.message || 'Unknown error'));
        } finally {
          setState('idle');
          cleanup();
        }
      };

      recorder.start(1000); // collect chunks every second
      setState('recording');
      setElapsed(0);
      intervalRef.current = setInterval(() => setElapsed(prev => prev + 1), 1000);

      // Auto-stop at 5 minutes
      timerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
          toast.info('Recording stopped — 5 minute limit reached');
        }
      }, MAX_DURATION_MS);
    } catch (err: any) {
      console.error('Microphone access error:', err);
      toast.error('Microphone access required for voice recording');
      setState('idle');
      cleanup();
    }
  }, [onTranscript, cleanup]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      if (intervalRef.current) clearInterval(intervalRef.current);
      setState('paused');
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
      intervalRef.current = setInterval(() => setElapsed(prev => prev + 1), 1000);
      setState('recording');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const btnHeight = size === 'sm' ? 'h-7' : 'h-8';

  if (state === 'transcribing') {
    return (
      <Button variant="outline" size="sm" disabled className={cn(btnHeight, 'gap-1.5 text-xs', className)}>
        <Loader2 className={cn(iconSize, 'animate-spin')} />
        Transcribing...
      </Button>
    );
  }

  if (state === 'recording' || state === 'paused') {
    return (
      <div className={cn('flex items-center gap-1', className)}>
        {state === 'recording' && (
          <span className="flex items-center gap-1 text-xs text-destructive font-medium">
            <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
            {formatTime(elapsed)}
          </span>
        )}
        {state === 'paused' && (
          <span className="flex items-center gap-1 text-xs text-warning font-medium">
            <Pause className="h-2 w-2" />
            {formatTime(elapsed)}
          </span>
        )}
        {state === 'recording' ? (
          <Button variant="outline" size="icon" className={cn(btnHeight, 'w-7')} onClick={pauseRecording}>
            <Pause className={iconSize} />
          </Button>
        ) : (
          <Button variant="outline" size="icon" className={cn(btnHeight, 'w-7')} onClick={resumeRecording}>
            <Play className={iconSize} />
          </Button>
        )}
        <Button variant="destructive" size="icon" className={cn(btnHeight, 'w-7')} onClick={stopRecording}>
          <Square className={iconSize} />
        </Button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn(btnHeight, 'w-7 shrink-0', className)}
      onClick={startRecording}
      disabled={disabled}
      title="Record voice note"
    >
      <Mic className={iconSize} />
    </Button>
  );
}
