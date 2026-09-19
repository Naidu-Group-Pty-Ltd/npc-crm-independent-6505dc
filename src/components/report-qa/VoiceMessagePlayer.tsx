import { useEffect, useRef, useState, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VoiceMessagePlayerProps {
  audioUrl: string;
  compact?: boolean;
  waveColor?: string;
  progressColor?: string;
}

export function VoiceMessagePlayer({ 
  audioUrl, 
  compact = false,
  waveColor = 'rgba(139, 92, 246, 0.4)',
  progressColor = 'rgb(139, 92, 246)'
}: VoiceMessagePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;

    const wavesurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor: waveColor,
      progressColor: progressColor,
      cursorColor: 'transparent',
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      height: compact ? 32 : 48,
      normalize: true,
      backend: 'WebAudio',
    });

    wavesurferRef.current = wavesurfer;

    wavesurfer.load(audioUrl);

    wavesurfer.on('ready', () => {
      setIsReady(true);
      setDuration(wavesurfer.getDuration());
    });

    wavesurfer.on('audioprocess', () => {
      setCurrentTime(wavesurfer.getCurrentTime());
    });

    wavesurfer.on('seeking', () => {
      setCurrentTime(wavesurfer.getCurrentTime());
    });

    wavesurfer.on('play', () => setIsPlaying(true));
    wavesurfer.on('pause', () => setIsPlaying(false));
    wavesurfer.on('finish', () => {
      setIsPlaying(false);
      setCurrentTime(0);
    });

    return () => {
      wavesurfer.destroy();
    };
  }, [audioUrl, waveColor, progressColor, compact]);

  const togglePlay = useCallback(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause();
    }
  }, []);

  const handleVolumeChange = useCallback((value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(newVolume);
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (wavesurferRef.current) {
      if (isMuted) {
        wavesurferRef.current.setVolume(volume || 1);
        setIsMuted(false);
      } else {
        wavesurferRef.current.setVolume(0);
        setIsMuted(true);
      }
    }
  }, [isMuted, volume]);

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className={cn(
      "flex items-center gap-3 p-3 rounded-lg bg-background/50 border",
      compact ? "p-2" : "p-3"
    )}>
      {/* Play/Pause Button */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "rounded-full flex-shrink-0",
          compact ? "h-8 w-8" : "h-10 w-10",
          isPlaying && "bg-primary/10"
        )}
        onClick={togglePlay}
        disabled={!isReady}
      >
        {isPlaying ? (
          <Pause className={compact ? "h-4 w-4" : "h-5 w-5"} />
        ) : (
          <Play className={cn(compact ? "h-4 w-4" : "h-5 w-5", "ml-0.5")} />
        )}
      </Button>

      {/* Waveform Container */}
      <div className="flex-1 min-w-0">
        <div 
          ref={containerRef} 
          className={cn(
            "w-full cursor-pointer",
            !isReady && "opacity-50"
          )}
        />
        
        {/* Time Display */}
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-muted-foreground font-mono">
            {formatTime(currentTime)}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Volume Control - Only show if not compact */}
      {!compact && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggleMute}
          >
            {isMuted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>
          <Slider
            className="w-20"
            value={[isMuted ? 0 : volume]}
            min={0}
            max={1}
            step={0.1}
            onValueChange={handleVolumeChange}
          />
        </div>
      )}
    </div>
  );
}

// Hook to create audio URL from blob
export function useAudioUrl(audioBlob: Blob | null): string | null {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    if (audioBlob) {
      const url = URL.createObjectURL(audioBlob);
      setAudioUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    return undefined;
  }, [audioBlob]);

  return audioUrl;
}
