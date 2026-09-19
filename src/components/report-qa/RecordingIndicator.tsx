import { cn } from '@/lib/utils';
import { Pause } from 'lucide-react';

interface RecordingIndicatorProps {
  isRecording: boolean;
  isPaused?: boolean;
  className?: string;
  liveTranscript?: string;
  duration?: number;
  maxDuration?: number;
  accumulatedText?: string;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function RecordingIndicator({ 
  isRecording, 
  isPaused = false,
  className,
  liveTranscript,
  duration = 0,
  maxDuration = 480,
  accumulatedText
}: RecordingIndicatorProps) {
  if (!isRecording && !isPaused) return null;

  const progressPercent = Math.min((duration / maxDuration) * 100, 100);
  const isNearLimit = duration >= maxDuration - 60; // Last minute warning

  // Different styling for paused vs recording state
  const borderColor = isPaused ? 'border-warning/30' : 'border-destructive/30';
  const bgColor = isPaused ? 'bg-warning/10' : 'bg-destructive/10';
  const accentColor = isPaused ? 'text-warning' : 'text-destructive';
  const progressBgColor = isPaused ? 'bg-warning/20' : 'bg-destructive/20';
  const progressFillColor = isNearLimit ? 'bg-warning' : (isPaused ? 'bg-warning/60' : 'bg-destructive/60');

  return (
    <div 
      className={cn(
        "flex flex-col gap-2 p-3 rounded-lg border",
        bgColor,
        borderColor,
        className
      )}
      role="status"
      aria-live="polite"
      aria-label={isPaused ? 'Recording paused' : (liveTranscript ? `Recording: ${liveTranscript}` : 'Recording in progress')}
    >
      <div className="flex items-center gap-3">
        {/* Recording/Paused indicator */}
        <div className="relative" aria-hidden="true">
          {isPaused ? (
            <div className="w-5 h-5 rounded-full bg-warning/20 flex items-center justify-center">
              <Pause className="w-3 h-3 text-warning" />
            </div>
          ) : (
            <>
              <div className="w-3 h-3 rounded-full bg-destructive animate-pulse motion-reduce:animate-none" />
              <div className="absolute inset-0 w-3 h-3 rounded-full bg-destructive animate-ping opacity-50 motion-reduce:animate-none" />
            </>
          )}
        </div>
        
        {/* Animated waveform bars - only show when recording, not paused */}
        {!isPaused && (
          <div className="flex items-center gap-0.5 h-6" aria-hidden="true">
            {[...Array(20)].map((_, i) => (
              <div
                key={i}
                className="w-1 bg-destructive/70 rounded-full motion-reduce:!transform-none"
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
        
        <span className={cn("text-xs font-medium", accentColor, !isPaused && "animate-pulse motion-reduce:animate-none")}>
          {isPaused ? 'Paused' : 'Recording...'}
        </span>
        
        {duration > 0 && (
          <span className={cn(
            "text-xs font-mono ml-auto",
            isNearLimit ? "text-warning font-semibold" : accentColor + '/70'
          )}>
            {formatDuration(duration)} / {formatDuration(maxDuration)}
          </span>
        )}
      </div>
      
      {/* Progress bar */}
      <div className={cn("h-1 w-full rounded-full overflow-hidden", progressBgColor)}>
        <div 
          className={cn("h-full rounded-full transition-all duration-1000", progressFillColor)}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      
      {/* Near limit warning */}
      {isNearLimit && (
        <p className="text-xs text-warning font-medium">
          ⚠️ Recording will stop in {formatDuration(maxDuration - duration)}
        </p>
      )}

      {/* Accumulated transcript preview (from previous segments) */}
      {accumulatedText && (
        <div className="text-xs text-muted-foreground border-t border-current/10 pt-2 mt-1">
          <span className="text-muted-foreground/60 mr-1">Previous:</span>
          <span className="italic">{accumulatedText.length > 100 ? `...${accumulatedText.slice(-100)}` : accumulatedText}</span>
        </div>
      )}
      
      {/* Live transcription preview */}
      {liveTranscript && !isPaused && (
        <div className="text-sm text-muted-foreground italic border-t border-destructive/20 pt-2 mt-1">
          <span className="text-destructive/60 text-xs mr-1">Live:</span>
          {liveTranscript}
          <span className="inline-block w-1 h-4 bg-destructive/50 ml-0.5 animate-pulse motion-reduce:animate-none" />
        </div>
      )}

      {/* Paused instructions */}
      {isPaused && (
        <p className="text-xs text-muted-foreground mt-1">
          Click <span className="text-warning font-medium">Resume</span> to continue or <span className="text-destructive font-medium">Stop</span> to transcribe
        </p>
      )}
      
      <style>{`
        @keyframes waveform {
          0%, 100% { transform: scaleY(0.3); }
          50% { transform: scaleY(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes waveform {
            0%, 100% { transform: scaleY(0.5); }
          }
        }
      `}</style>
    </div>
  );
}
