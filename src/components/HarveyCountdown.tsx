import { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PartyPopper, Rocket, Star, Sparkles, Trophy, Heart } from 'lucide-react';

const TARGET_DATE = new Date('2026-02-28T00:00:00').getTime();
// Auto-deprecate: end of March 2, 2026 (Sydney time ~ 2026-03-02T13:00:00Z)
const DEPRECATE_DATE = new Date('2026-03-03T00:00:00').getTime();

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
}

function getTimeLeft(): TimeLeft {
  const now = Date.now();
  const diff = Math.max(TARGET_DATE - now, 0);
  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60),
    milliseconds: Math.floor(diff % 1000),
  };
}

function pad(n: number, len = 2) {
  return String(n).padStart(len, '0');
}

// Confetti particle component
interface ConfettiParticle {
  id: number;
  x: number;
  y: number;
  color: string;
  size: number;
  rotation: number;
  delay: number;
  duration: number;
  shape: 'circle' | 'square' | 'star';
}

function generateConfetti(count: number): ConfettiParticle[] {
  const colors = [
    '#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
    '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE',
    '#FF69B4', '#00CED1', '#FF4500', '#7FFF00', '#DA70D6',
  ];
  const shapes: ConfettiParticle['shape'][] = ['circle', 'square', 'star'];
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: -10 - Math.random() * 20,
    color: colors[Math.floor(Math.random() * colors.length)],
    size: 6 + Math.random() * 10,
    rotation: Math.random() * 360,
    delay: Math.random() * 3,
    duration: 2.5 + Math.random() * 3,
    shape: shapes[Math.floor(Math.random() * shapes.length)],
  }));
}

// Firework burst
function FireworkBurst({ x, y, delay }: { x: number; y: number; delay: number }) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${delay}s` }}
    >
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className="absolute w-2 h-2 rounded-full"
          style={{
            background: ['#FFD700', '#FF6B6B', '#4ECDC4', '#FF69B4', '#7FFF00', '#DA70D6', '#00CED1', '#FFEAA7'][i],
            animation: `firework-particle ${1.2 + Math.random() * 0.6}s ease-out ${delay}s both`,
            transform: `rotate(${i * 45}deg) translateY(-30px)`,
          }}
        />
      ))}
    </div>
  );
}

const DigitBlock = ({ value, label }: { value: string; label: string }) => (
  <div className="flex flex-col items-center gap-1">
    <div className="bg-background/80 border border-primary/30 rounded-lg px-3 py-2 min-w-[56px] text-center shadow-[0_0_15px_hsl(var(--primary)/0.15)]">
      <span className="font-mono text-2xl sm:text-3xl font-bold text-primary tracking-wider">
        {value}
      </span>
    </div>
    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
  </div>
);

const Separator = () => (
  <span className="font-mono text-2xl sm:text-3xl font-bold text-primary/60 self-start mt-2 animate-pulse">:</span>
);

// Floating emoji component
function FloatingEmoji({ emoji, delay, x }: { emoji: string; delay: number; x: number }) {
  return (
    <span
      className="absolute text-2xl pointer-events-none"
      style={{
        left: `${x}%`,
        bottom: '-10%',
        animation: `float-up 3.5s ease-out ${delay}s both`,
      }}
    >
      {emoji}
    </span>
  );
}

export function HarveyCountdown() {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState<TimeLeft>(getTimeLeft);
  const [confetti, setConfetti] = useState<ConfettiParticle[]>([]);
  const [showCelebration, setShowCelebration] = useState(false);
  const rafRef = useRef<number>();
  const celebrationTriggered = useRef(false);

  const isComplete = time.days === 0 && time.hours === 0 && time.minutes === 0 && time.seconds === 0 && time.milliseconds === 0;

  // Check if we're past the deprecation date
  const isPastDeprecation = Date.now() >= DEPRECATE_DATE;

  // Show once per session (unless deprecated)
  useEffect(() => {
    if (isPastDeprecation) return; // Don't show at all after March 2
    const key = 'harvey_countdown_dismissed';
    if (!sessionStorage.getItem(key)) {
      setOpen(true);
    }
  }, [isPastDeprecation]);

  useEffect(() => {
    if (!open) return;
    const tick = () => {
      setTime(getTimeLeft());
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [open]);

  // Trigger celebration when complete
  useEffect(() => {
    if (isComplete && !celebrationTriggered.current) {
      celebrationTriggered.current = true;
      setShowCelebration(true);
      setConfetti(generateConfetti(60));
      // Regenerate confetti waves
      const interval = setInterval(() => {
        setConfetti(generateConfetti(40));
      }, 4000);
      return () => clearInterval(interval);
    }
  }, [isComplete]);

  const handleClose = () => {
    sessionStorage.setItem('harvey_countdown_dismissed', '1');
    setOpen(false);
  };

  // Don't render at all after deprecation
  if (isPastDeprecation) return null;

  const emojis = ['🎉', '🥳', '🎊', '🍾', '🔥', '💪', '⭐', '🚀', '🏆', '👏'];
  const floatingEmojis = emojis.flatMap((emoji, i) => [
    { emoji, delay: i * 0.4, x: 5 + Math.random() * 90 },
    { emoji, delay: i * 0.4 + 2, x: 5 + Math.random() * 90 },
  ]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-lg border-primary/20 bg-gradient-to-b from-card to-background p-0 overflow-hidden">
        {/* Header glow */}
        <div className={`absolute inset-x-0 top-0 h-32 pointer-events-none transition-all duration-1000 ${
          showCelebration 
            ? 'bg-gradient-to-b from-brand-500/20 via-primary/10 to-transparent' 
            : 'bg-gradient-to-b from-primary/10 to-transparent'
        }`} />

        {/* Confetti layer */}
        {showCelebration && (
          <div className="absolute inset-0 overflow-hidden pointer-events-none z-10">
            {confetti.map((p) => (
              <div
                key={p.id}
                className="absolute"
                style={{
                  left: `${p.x}%`,
                  top: `${p.y}%`,
                  width: p.size,
                  height: p.shape === 'circle' ? p.size : p.size * 0.6,
                  backgroundColor: p.color,
                  borderRadius: p.shape === 'circle' ? '50%' : p.shape === 'star' ? '2px' : '0',
                  transform: `rotate(${p.rotation}deg)`,
                  animation: `confetti-fall ${p.duration}s ease-in ${p.delay}s both`,
                  opacity: 0.9,
                }}
              />
            ))}

            {/* Firework bursts */}
            <FireworkBurst x={20} y={15} delay={0.2} />
            <FireworkBurst x={75} y={20} delay={0.8} />
            <FireworkBurst x={50} y={10} delay={1.4} />
            <FireworkBurst x={30} y={25} delay={2.2} />
            <FireworkBurst x={70} y={30} delay={3.0} />

            {/* Floating emojis */}
            {floatingEmojis.map((e, i) => (
              <FloatingEmoji key={i} emoji={e.emoji} delay={e.delay} x={e.x} />
            ))}
          </div>
        )}

        <div className="relative flex flex-col items-center text-center px-6 pt-8 pb-6 gap-5 z-20">
          {/* Icon */}
          <div className="flex items-center gap-2">
            {showCelebration ? (
              <>
                <Trophy className="h-7 w-7 text-brand-500 animate-bounce" />
                <PartyPopper className="h-6 w-6 text-primary animate-bounce [animation-delay:100ms]" />
                <Sparkles className="h-7 w-7 text-brand-500 animate-bounce [animation-delay:200ms]" />
                <Star className="h-6 w-6 text-primary animate-bounce [animation-delay:300ms]" />
                <Heart className="h-7 w-7 text-destructive animate-bounce [animation-delay:400ms]" />
              </>
            ) : (
              <>
                <PartyPopper className="h-6 w-6 text-primary animate-bounce" />
                <Rocket className="h-6 w-6 text-primary animate-bounce [animation-delay:150ms]" />
              </>
            )}
          </div>

          {/* Title */}
          <div>
            {showCelebration ? (
              <>
                <h2 className="text-2xl sm:text-3xl font-bold text-foreground animate-pulse">
                  🎉 THE WAIT IS OVER! 🎉
                </h2>
                <p className="text-sm text-muted-foreground mt-2">
                  Feb 28, 2026 &bull; The day job era has officially ended!
                </p>
              </>
            ) : (
              <>
                <h2 className="text-xl sm:text-2xl font-bold text-foreground">
                  Harvey Goes Full-Time In
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Feb 28, 2026 &bull; The day job era ends 🎉
                </p>
              </>
            )}
          </div>

          {isComplete ? (
            <div className="py-4 flex flex-col items-center gap-4">
              <div className="relative">
                <p className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-r from-brand-400 via-primary to-accent bg-clip-text text-transparent animate-pulse">
                  HE'S HERE FULL-TIME!
                </p>
                <div className="absolute -inset-2 bg-gradient-to-r from-brand-400/20 via-primary/10 to-accent/20 blur-xl rounded-lg -z-10" />
              </div>

              <div className="flex gap-1.5 text-3xl">
                {['🎊', '🥳', '🍾', '🔥', '💪'].map((e, i) => (
                  <span
                    key={i}
                    className="inline-block"
                    style={{
                      animation: `celebration-bounce 0.6s ease-in-out ${i * 0.12}s infinite alternate`,
                    }}
                  >
                    {e}
                  </span>
                ))}
              </div>

              <p className="text-sm text-muted-foreground max-w-xs">
                Harvey is now officially full-time. A new chapter begins! 🚀
              </p>
            </div>
          ) : (
            /* Timer */
            <div className="flex items-start gap-1.5 sm:gap-2 flex-wrap justify-center">
              <DigitBlock value={pad(time.days)} label="Days" />
              <Separator />
              <DigitBlock value={pad(time.hours)} label="Hrs" />
              <Separator />
              <DigitBlock value={pad(time.minutes)} label="Min" />
              <Separator />
              <DigitBlock value={pad(time.seconds)} label="Sec" />
              <Separator />
              <DigitBlock value={pad(time.milliseconds, 3)} label="Ms" />
            </div>
          )}

          <Button
            onClick={handleClose}
            variant="outline"
            className={`mt-2 ${
              showCelebration
                ? 'border-brand-500/40 hover:bg-brand-500/10 text-foreground shadow-[0_0_20px_rgba(234,179,8,0.15)]'
                : 'border-primary/30 hover:bg-primary/10 text-foreground'
            }`}
          >
            {showCelebration ? '🎉 Amazing! Let\'s Go!' : 'Let\'s Go! 🚀'}
          </Button>
        </div>

        {/* Celebration animations */}
        <style>{`
          @keyframes confetti-fall {
            0% {
              transform: translateY(0) rotate(0deg) scale(1);
              opacity: 1;
            }
            100% {
              transform: translateY(500px) rotate(720deg) scale(0.3);
              opacity: 0;
            }
          }

          @keyframes firework-particle {
            0% {
              transform: rotate(var(--angle, 0deg)) translateY(0) scale(1);
              opacity: 1;
            }
            50% {
              opacity: 1;
            }
            100% {
              transform: rotate(var(--angle, 0deg)) translateY(-60px) scale(0);
              opacity: 0;
            }
          }

          @keyframes float-up {
            0% {
              transform: translateY(0) scale(0.5) rotate(0deg);
              opacity: 0;
            }
            15% {
              opacity: 1;
              transform: translateY(-40px) scale(1) rotate(10deg);
            }
            100% {
              transform: translateY(-400px) scale(0.3) rotate(-20deg);
              opacity: 0;
            }
          }

          @keyframes celebration-bounce {
            0% { transform: translateY(0) scale(1); }
            100% { transform: translateY(-8px) scale(1.2); }
          }

          @keyframes shimmer {
            0% { background-position: -200% center; }
            100% { background-position: 200% center; }
          }
        `}</style>
      </DialogContent>
    </Dialog>
  );
}
