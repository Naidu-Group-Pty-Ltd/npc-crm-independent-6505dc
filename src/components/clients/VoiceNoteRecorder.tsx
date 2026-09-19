import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Square, Loader2, Pause, Play } from 'lucide-react';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { cn } from '@/lib/utils';

interface VoiceNoteRecorderProps {
  onTranscriptReady: (cleanedText: string) => void;
  noteType: string;
  disabled?: boolean;
}

const MAX_RECORDING_DURATION = 300; // 5 minutes max for notes

function getSupportedAudioMimeType(): string | null {
  // Prefer opus/webm, but fall back to whatever the browser supports.
  // Safari often does not support webm, so we allow mp4 as a fallback.
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];

  if (typeof MediaRecorder === 'undefined') return null;

  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // ignore
    }
  }

  // Returning null means we will create MediaRecorder without specifying mimeType,
  // letting the browser choose a default.
  return null;
}

function getMicErrorMessage(error: any): string {
  const name = error?.name as string | undefined;
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Microphone permission was blocked. Please allow mic access in your browser/site settings.';
    case 'NotFoundError':
      return 'No microphone device found.';
    case 'NotReadableError':
      return 'Your microphone is in use by another app/tab.';
    case 'OverconstrainedError':
      return 'Microphone constraints could not be satisfied on this device.';
    default:
      return 'Failed to access microphone. Please check permissions and try again.';
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function VoiceNoteRecorder({ onTranscriptReady, noteType, disabled }: VoiceNoteRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState('');
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveTranscriptTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopModeRef = useRef<'pause' | 'finalize' | null>(null);
  const recorderMimeTypeRef = useRef<string | null>(null);

  const clearTimers = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (liveTranscriptTimeoutRef.current) {
      clearTimeout(liveTranscriptTimeoutRef.current);
      liveTranscriptTimeoutRef.current = null;
    }
  }, []);

  const stopAndReleaseStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      if (disabled || isProcessing) return;

      if (!navigator?.mediaDevices?.getUserMedia) {
        toast.error('Your browser does not support microphone recording.');
        return;
      }
      if (typeof MediaRecorder === 'undefined') {
        toast.error('Your browser does not support audio recording (MediaRecorder).');
        return;
      }

      // Clear any previous timers/state (prevents double intervals)
      clearTimers();
      stopModeRef.current = null;

      const stream = await navigator.mediaDevices.getUserMedia({ 
        // Use *ideal* constraints for maximum compatibility (hard constraints can fail on some devices/browsers)
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 16000 },
          channelCount: { ideal: 1 },
        },
      });
      
      streamRef.current = stream;

      // If the mic stream ends unexpectedly, reflect that in UI (this prevents the timer getting stuck at 0)
      stream.getTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          // If we didn't explicitly pause/finalize, treat this as an unexpected stop.
          if (!stopModeRef.current) {
            clearTimers();
            setIsRecording(false);
            setIsPaused(false);
            toast.error('Microphone stopped unexpectedly. Please try again.');
          }
        });
      });
      
      const chosenMimeType = getSupportedAudioMimeType();
      recorderMimeTypeRef.current = chosenMimeType;

      const mediaRecorder = chosenMimeType
        ? new MediaRecorder(stream, { mimeType: chosenMimeType })
        : new MediaRecorder(stream);

      // Prefer browser-reported mimeType when we didn't explicitly set one.
      recorderMimeTypeRef.current = recorderMimeTypeRef.current || mediaRecorder.mimeType || null;
      
      mediaRecorderRef.current = mediaRecorder;
      
      // Don't reset chunks if resuming from paused state
      if (!isPaused) {
        chunksRef.current = [];
        setLiveTranscript('');
        setRecordingDuration(0);
      }
      setIsPaused(false);
      
      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
          
          // Live transcription preview every 10 seconds (20 chunks × 500ms)
          if (chunksRef.current.length % 20 === 0 && chunksRef.current.length <= 120) {
            if (liveTranscriptTimeoutRef.current) {
              clearTimeout(liveTranscriptTimeoutRef.current);
            }
            liveTranscriptTimeoutRef.current = setTimeout(async () => {
              try {
                const recentChunks = chunksRef.current.slice(-40);
                const blobType = recorderMimeTypeRef.current || mediaRecorderRef.current?.mimeType || 'audio/webm';
                const partialBlob = new Blob(recentChunks, { type: blobType });
                const reader = new FileReader();
                reader.onloadend = async () => {
                  const base64 = (reader.result as string).split(',')[1];
                  const { data } = await invokeSecureFunction('voice-to-text', {
                    audio: base64,
                    mimeType: blobType,
                    fileName: blobType.includes('mp4') ? 'audio.mp4' : (blobType.includes('ogg') ? 'audio.ogg' : 'audio.webm'),
                  });
                  if (data?.text) {
                    setLiveTranscript(data.text);
                  }
                };
                reader.readAsDataURL(partialBlob);
              } catch {
                // Silent fail for live preview
              }
            }, 500);
          }
        }
      };

      mediaRecorder.onerror = (event: any) => {
        console.error('[VoiceNoteRecorder] MediaRecorder error:', event);
        clearTimers();
        setIsRecording(false);
        setIsPaused(false);
        stopAndReleaseStream();
        toast.error('Recording failed. Please try again.');
      };
      
      mediaRecorder.onstop = async () => {
        clearTimers();

        const stopMode = stopModeRef.current;
        stopModeRef.current = null;

        // Always release the mic after any stop (pause or finalize)
        stopAndReleaseStream();

        // Ensure UI reflects the stopped recorder
        setIsRecording(false);

        // If pausing, do NOT transcribe and do NOT reset duration/chunks
        if (stopMode === 'pause') {
          setIsPaused(true);
          return;
        }

        // Finalize: transcribe the full recording
        setIsPaused(false);
        if (chunksRef.current.length > 0) {
          const blobType = recorderMimeTypeRef.current || 'audio/webm';
          const audioBlob = new Blob(chunksRef.current, { type: blobType });
          await processAudio(audioBlob);
          setLiveTranscript('');
          setRecordingDuration(0);
        }
      };
      
      // Request data every 500ms for chunking
      mediaRecorder.start(500);

      // Start duration timer only once recorder has started
      durationIntervalRef.current = setInterval(() => {
        setRecordingDuration(prev => {
          const newDuration = prev + 1;
          if (newDuration >= MAX_RECORDING_DURATION) {
            // Avoid relying on stale hook closures; directly stop as finalize.
            stopModeRef.current = 'finalize';
            try {
              if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop();
              }
            } catch {
              // ignore
            }
            toast.info('Maximum recording reached (5 min). Transcribing...');
          }
          return newDuration;
        });
      }, 1000);

      setIsRecording(true);
      toast.info('Recording started...', { duration: 2000 });
    } catch (error: any) {
      console.error('Failed to start recording:', error);
      clearTimers();
      stopAndReleaseStream();
      setIsRecording(false);
      setIsPaused(false);
      toast.error(getMicErrorMessage(error));
    }
  }, [clearTimers, disabled, isPaused, isProcessing, stopAndReleaseStream]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording && !isPaused) {
      stopModeRef.current = 'pause';
      // Clear timer but keep duration
      clearTimers();

      try {
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch (e) {
        console.warn('[VoiceNoteRecorder] pause stop failed:', e);
        // Ensure mic released even if recorder is already inactive
        stopAndReleaseStream();
      }

      setIsPaused(true);
      setIsRecording(false);
      toast.info('Recording paused');
    }
  }, [clearTimers, isPaused, isRecording, stopAndReleaseStream]);

  const resumeRecording = useCallback(async () => {
    if (isPaused) {
      await startRecording();
    }
  }, [isPaused, startRecording]);

  const finalizeRecording = useCallback(() => {
    if (mediaRecorderRef.current && (isRecording || isPaused)) {
      stopModeRef.current = 'finalize';
      setIsPaused(false);
      
      if (isRecording) {
        try {
          if (mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
          }
        } catch (e) {
          console.warn('[VoiceNoteRecorder] finalize stop failed:', e);
          stopAndReleaseStream();
        }
      } else if (isPaused && chunksRef.current.length > 0) {
        // If paused, manually process since recorder already stopped
        clearTimers();
        stopAndReleaseStream();
        const blobType = recorderMimeTypeRef.current || 'audio/webm';
        const audioBlob = new Blob(chunksRef.current, { type: blobType });
        processAudio(audioBlob);
        setLiveTranscript('');
        setRecordingDuration(0);
      }
      
      setIsRecording(false);
    }
  }, [clearTimers, isPaused, isRecording, stopAndReleaseStream]);

  const processAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);
    
    try {
      // Convert blob to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
      });
      reader.readAsDataURL(audioBlob);
      const base64Audio = await base64Promise;

      // Step 1: Transcribe audio
      const { data: transcribeData, error: transcribeError } = await invokeSecureFunction('voice-to-text', {
        audio: base64Audio,
        mimeType: audioBlob.type || recorderMimeTypeRef.current || undefined,
        fileName: (audioBlob.type || '').includes('mp4')
          ? 'audio.mp4'
          : ((audioBlob.type || '').includes('ogg') ? 'audio.ogg' : 'audio.webm'),
      });

      if (transcribeError || !transcribeData?.text) {
        throw new Error(transcribeError?.message || 'Transcription failed');
      }

      const rawTranscript = transcribeData.text;
      toast.info('Processing your note...', { duration: 2000 });

      // Step 2: Clean up with AI
      const { data: cleanData, error: cleanError } = await invokeSecureFunction('clean-note-transcript', {
        transcript: rawTranscript, noteType
      });

      if (cleanError) {
        console.error('Clean transcript error:', cleanError);
        onTranscriptReady(rawTranscript);
        toast.warning('Used raw transcript (AI cleanup failed)');
      } else {
        onTranscriptReady(cleanData.cleanedNote || rawTranscript);
        toast.success('Voice note ready!');
      }
      
      // Clear chunks after successful processing
      chunksRef.current = [];

    } catch (error: any) {
      console.error('Audio processing error:', error);
      toast.error('Failed to process voice note: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const progressPercent = Math.min((recordingDuration / MAX_RECORDING_DURATION) * 100, 100);
  const isNearLimit = recordingDuration >= MAX_RECORDING_DURATION - 30;

  // Processing state
  if (isProcessing) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Processing...
      </Button>
    );
  }

  // Active recording or paused state - show full controls
  if (isRecording || isPaused) {
    return (
      <div className="space-y-2">
        {/* Recording indicator */}
        <div 
          className={cn(
            "flex flex-col gap-2 p-3 rounded-lg border",
            isPaused ? "bg-warning/10 border-warning/30" : "bg-destructive/10 border-destructive/30"
          )}
        >
          <div className="flex items-center gap-3">
            {/* Recording/Paused indicator */}
            <div className="relative">
              {isPaused ? (
                <div className="w-5 h-5 rounded-full bg-warning/20 flex items-center justify-center">
                  <Pause className="w-3 h-3 text-warning" />
                </div>
              ) : (
                <>
                  <div className="w-3 h-3 rounded-full bg-destructive animate-pulse" />
                  <div className="absolute inset-0 w-3 h-3 rounded-full bg-destructive animate-ping opacity-50" />
                </>
              )}
            </div>
            
            {/* Waveform animation - only when recording */}
            {!isPaused && (
              <div className="flex items-center gap-0.5 h-5">
                {[...Array(12)].map((_, i) => (
                  <div
                    key={i}
                    className="w-0.5 bg-destructive/70 rounded-full"
                    style={{
                      height: '100%',
                      animation: 'waveform 1s ease-in-out infinite',
                      animationDelay: `${i * 0.05}s`,
                      transform: `scaleY(${0.3 + Math.random() * 0.7})`,
                    }}
                  />
                ))}
              </div>
            )}
            
            <span className={cn(
              "text-xs font-medium",
              isPaused ? "text-warning" : "text-destructive animate-pulse"
            )}>
              {isPaused ? 'Paused' : 'Recording...'}
            </span>
            
            <span className={cn(
              "text-xs font-mono ml-auto",
              isNearLimit ? "text-warning font-semibold" : (isPaused ? "text-warning/70" : "text-destructive/70")
            )}>
              {formatDuration(recordingDuration)} / {formatDuration(MAX_RECORDING_DURATION)}
            </span>
          </div>
          
          {/* Progress bar */}
          <div className={cn(
            "h-1 w-full rounded-full overflow-hidden",
            isPaused ? "bg-warning/20" : "bg-destructive/20"
          )}>
            <div 
              className={cn(
                "h-full rounded-full transition-all duration-1000",
                isNearLimit ? "bg-warning" : (isPaused ? "bg-warning/60" : "bg-destructive/60")
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          
          {/* Near limit warning */}
          {isNearLimit && (
            <p className="text-xs text-warning font-medium">
              ⚠️ Recording will stop in {formatDuration(MAX_RECORDING_DURATION - recordingDuration)}
            </p>
          )}
          
          {/* Live transcript preview */}
          {liveTranscript && !isPaused && (
            <div className="text-sm text-muted-foreground italic border-t border-destructive/20 pt-2 mt-1">
              <span className="text-destructive/60 text-xs mr-1">Live:</span>
              {liveTranscript.length > 100 ? `${liveTranscript.slice(0, 100)}...` : liveTranscript}
              <span className="inline-block w-1 h-3 bg-destructive/50 ml-0.5 animate-pulse" />
            </div>
          )}
          
          {/* Paused instructions */}
          {isPaused && (
            <p className="text-xs text-muted-foreground mt-1">
              Click <span className="text-warning font-medium">Resume</span> to continue or <span className="text-destructive font-medium">Stop</span> to transcribe
            </p>
          )}
        </div>
        
        {/* Control buttons */}
        <div className="flex gap-2">
          {isRecording ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={pauseRecording}
                className="gap-1.5"
              >
                <Pause className="h-3.5 w-3.5" />
                Pause
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={finalizeRecording}
                className="gap-1.5"
              >
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={resumeRecording}
                className="gap-1.5 border-warning/30 text-warning hover:bg-warning/10"
              >
                <Play className="h-3.5 w-3.5" />
                Resume
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={finalizeRecording}
                className="gap-1.5"
              >
                <Square className="h-3.5 w-3.5" />
                Stop & Transcribe
              </Button>
            </>
          )}
        </div>
        
        <style>{`
          @keyframes waveform {
            0%, 100% { transform: scaleY(0.3); }
            50% { transform: scaleY(1); }
          }
        `}</style>
      </div>
    );
  }

  // Default idle state
  return (
    <Button 
      variant="outline" 
      size="sm" 
      onClick={startRecording}
      disabled={disabled}
      className="gap-2"
      title="Record voice note"
    >
      <Mic className="h-4 w-4" />
      Voice Note
    </Button>
  );
}
