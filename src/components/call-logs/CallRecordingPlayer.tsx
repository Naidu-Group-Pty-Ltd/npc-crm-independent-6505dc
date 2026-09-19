import { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Download, AlertCircle } from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import { invokeSecureFunction } from '@/lib/secureInvoke';

interface CallRecordingPlayerProps {
  recordingUrl: string;
  duration?: number | null;
  callLogId?: string;
}

export interface CallRecordingPlayerHandle {
  stop: () => void;
}

export const CallRecordingPlayer = forwardRef<CallRecordingPlayerHandle, CallRecordingPlayerProps>(
  ({ recordingUrl, duration, callLogId }, ref) => {
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const isInitializedRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(duration || 0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Expose stop method to parent
  useImperativeHandle(ref, () => ({
    stop: () => {
      if (wavesurferRef.current) {
        wavesurferRef.current.stop();
        setIsPlaying(false);
        setCurrentTime(0);
      }
    }
  }), []);

  // Resolve a playable URL: if we have the call log id, ask the backend for a
  // freshly-signed Vapi recording URL (R2 signed URLs expire), otherwise fall
  // back to the stored URL.
  useEffect(() => {
    let cancelled = false;
    setErrorMessage(null);
    setIsLoading(true);
    setIsReady(false);
    setResolvedUrl(null);

    (async () => {
      if (!callLogId) {
        if (!cancelled) setResolvedUrl(recordingUrl || null);
        return;
      }
      try {
        const { data, error } = await invokeSecureFunction('get-call-recording', {
          callLogId,
          mode: 'url',
        });
        if (cancelled) return;
        if (error || !data?.url) {
          console.warn('[CallRecordingPlayer] Falling back to stored URL:', error);
          setResolvedUrl(recordingUrl || null);
          if (!recordingUrl) setErrorMessage('Recording is unavailable.');
        } else {
          setResolvedUrl(data.url as string);
        }
      } catch (e) {
        if (cancelled) return;
        console.error('[CallRecordingPlayer] resolve failed', e);
        setResolvedUrl(recordingUrl || null);
        if (!recordingUrl) setErrorMessage('Recording is unavailable.');
      }
    })();

    return () => { cancelled = true; };
  }, [callLogId, recordingUrl]);

  // Initialize WaveSurfer once we have a resolved URL
  useEffect(() => {
    if (!waveformRef.current || !resolvedUrl) return;

    // Clear any existing content in the container
    waveformRef.current.innerHTML = '';
    isInitializedRef.current = true;

    // Check if dark mode is active
    const isDarkMode = document.documentElement.classList.contains('dark');

    const wavesurfer = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: isDarkMode ? '#6b7280' : '#000000',
      progressColor: isDarkMode ? '#a1a1aa' : '#6b7280',
      cursorColor: isDarkMode ? '#f87171' : '#ef4444',
      cursorWidth: 1,
      height: 80,
      barWidth: 1,
      barHeight: 1,
      barGap: 1,
      barRadius: 0,
      normalize: true,
      fillParent: true,
      interact: true,
      dragToSeek: true,
      hideScrollbar: true,
      autoScroll: false,
      backend: 'WebAudio',
    });

    wavesurferRef.current = wavesurfer;

    // Load audio
    wavesurfer.load(resolvedUrl);

    // Event handlers
    wavesurfer.on('ready', () => {
      setAudioDuration(wavesurfer.getDuration());
      setIsLoading(false);
      setIsReady(true);
    });

    wavesurfer.on('audioprocess', () => {
      setCurrentTime(wavesurfer.getCurrentTime());
    });

    wavesurfer.on('seeking', () => {
      setCurrentTime(wavesurfer.getCurrentTime());
    });

    wavesurfer.on('play', () => {
      setIsPlaying(true);
    });

    wavesurfer.on('pause', () => {
      setIsPlaying(false);
    });

    wavesurfer.on('finish', () => {
      setIsPlaying(false);
    });

    wavesurfer.on('error', (error) => {
      console.error('WaveSurfer error:', error);
      setIsLoading(false);
      setErrorMessage('Could not decode recording. It may have expired — try reopening the call.');
    });

    return () => {
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
        wavesurferRef.current = null;
      }
      isInitializedRef.current = false;
    };
  }, [resolvedUrl]);

  const handlePlayPause = useCallback(() => {
    if (!wavesurferRef.current || !isReady) return;
    wavesurferRef.current.playPause();
  }, [isReady]);

  const handleSeek = useCallback((value: number[]) => {
    if (!wavesurferRef.current || !isReady || audioDuration === 0) return;
    const newTime = value[0];
    wavesurferRef.current.seekTo(newTime / audioDuration);
    setCurrentTime(newTime);
  }, [isReady, audioDuration]);

  const handleVolumeChange = useCallback((value: number[]) => {
    if (!wavesurferRef.current) return;
    const newVolume = value[0];
    wavesurferRef.current.setVolume(newVolume);
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
  }, []);

  const toggleMute = useCallback(() => {
    if (!wavesurferRef.current) return;
    if (isMuted) {
      wavesurferRef.current.setVolume(volume || 1);
      setIsMuted(false);
    } else {
      wavesurferRef.current.setVolume(0);
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  const skipTime = useCallback((seconds: number) => {
    if (!wavesurferRef.current || !isReady || audioDuration === 0) return;
    const newTime = Math.max(0, Math.min(currentTime + seconds, audioDuration));
    wavesurferRef.current.seekTo(newTime / audioDuration);
    setCurrentTime(newTime);
  }, [isReady, currentTime, audioDuration]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Card className="max-w-full overflow-hidden rounded-3xl border-border dark:border-white/10 bg-gradient-to-br from-card dark:from-background/95 via-card dark:via-background/80 to-background dark:to-black/90 shadow-lg shadow-sm dark:shadow-black/25">
      <CardHeader className="border-b border-border dark:border-white/10 bg-gradient-to-r from-brand-500/10 via-transparent to-info/10 pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-foreground dark:text-foreground">
          <span className="flex h-8 w-8 items-center justify-center rounded-2xl border border-brand-300/20 bg-brand-500/10 text-brand-200">
            <Volume2 className="h-4 w-4 flex-shrink-0" />
          </span>
          Call Recording
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 max-w-full overflow-hidden">
        {/* WaveSurfer Waveform */}
        <div className="relative max-w-full overflow-hidden rounded-2xl border border-border dark:border-white/10 bg-background dark:bg-black/45 p-3 shadow-inner shadow-sm dark:shadow-black/30">
          <div 
            ref={waveformRef} 
            className="w-full min-h-[80px]"
          />
          {isLoading && !errorMessage && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background dark:bg-black/80 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 animate-pulse rounded-full bg-brand-300" />
                <span className="text-sm text-muted-foreground dark:text-muted-foreground">Loading audio...</span>
              </div>
            </div>
          )}
          {errorMessage && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background dark:bg-black/80 backdrop-blur-sm p-3">
              <div className="flex items-center gap-2 text-center">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <span className="text-sm text-muted-foreground">{errorMessage}</span>
              </div>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <Slider
            value={[currentTime]}
            min={0}
            max={audioDuration || 100}
            step={0.1}
            onValueChange={handleSeek}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground dark:text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(audioDuration)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-1 sm:gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => skipTime(-10)}
              className="h-8 w-8 flex-shrink-0 rounded-xl text-muted-foreground dark:text-muted-foreground hover:bg-white/10 hover:text-brand-100"
            >
              <SkipBack className="w-4 h-4" />
            </Button>
            <Button
              variant="default"
              size="icon"
              onClick={handlePlayPause}
              disabled={isLoading}
              className="h-10 w-10 flex-shrink-0 rounded-full bg-gradient-to-r from-brand-300 to-brand-500 text-black shadow-lg shadow-brand-500/20 hover:from-brand-200 hover:to-brand-400"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5 ml-0.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => skipTime(10)}
              className="h-8 w-8 flex-shrink-0 rounded-xl text-muted-foreground dark:text-muted-foreground hover:bg-white/10 hover:text-brand-100"
            >
              <SkipForward className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleMute}
              className="h-8 w-8 flex-shrink-0 rounded-xl text-muted-foreground dark:text-muted-foreground hover:bg-white/10 hover:text-brand-100"
            >
              {isMuted ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </Button>
            <Slider
              value={[isMuted ? 0 : volume]}
              min={0}
              max={1}
              step={0.1}
              onValueChange={handleVolumeChange}
              className="w-16 sm:w-20 flex-shrink-0"
            />
            <Button
              variant="outline"
              size="sm"
              asChild
              className="flex-shrink-0 rounded-2xl border-brand-300/25 bg-brand-500/10 text-brand-100 hover:bg-brand-500/20"
            >
              <a href={resolvedUrl || recordingUrl} download target="_blank" rel="noopener noreferrer">
                <Download className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline">Download</span>
                <span className="sm:hidden">DL</span>
              </a>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

CallRecordingPlayer.displayName = 'CallRecordingPlayer';
