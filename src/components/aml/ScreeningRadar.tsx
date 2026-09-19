/**
 * Live screening radar — the WAIT, made legible.
 *
 * While the engine screens the enrolled parties against the official lists,
 * the step used to say only "A check is in progress." That is true and it is
 * indistinguishable from a hang: an operator cannot tell whether anything is
 * happening, how much of the population has come back, or how long it has
 * been running — which is exactly the shape that made "screening never
 * starts" get reported as a UI defect four faults ago.
 *
 * ── What it will not do ───────────────────────────────────────────────
 * It is PRESENTATION ONLY. It fetches nothing, decides nothing, screens
 * nothing, and it never invents a number: the ring is
 * `returned / enrolled` from the parties the workspace already read, and a
 * case with no readable population renders an INDETERMINATE sweep with the
 * reason in words rather than a comforting percentage. A percentage nobody
 * measured is worse than no percentage at all on a compliance surface.
 *
 * It also never says "clear". A returned party is a party the engine has
 * answered about; whether that answer is a candidate, a match or nothing at
 * all belongs to adjudication, and the caption says so.
 *
 * Motion is decorative and honours `prefers-reduced-motion` (the sweep
 * stops; the reading stays).
 */
import { useEffect, useState } from "react";
import { Radar, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ScreeningRadarParty {
  name: string;
  /** The engine has come back about this party (whatever it came back with). */
  returned: boolean;
  /** A candidate is waiting for a person to adjudicate it. */
  candidate: boolean;
}

const SIZE = 132;
const C = SIZE / 2;
const R = 52;
const CIRCUM = 2 * Math.PI * R;

/** Deterministic placement: the same party sits in the same place every render. */
function blipAt(name: string, index: number, total: number) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 100000;
  const angle = ((index / Math.max(total, 1)) * 360 + (hash % 40) - 20) * (Math.PI / 180);
  const radius = 16 + (hash % 26);
  return { x: C + Math.cos(angle) * radius, y: C + Math.sin(angle) * radius };
}

function elapsedLabel(fromIso: string | null | undefined, now: number): string | null {
  if (!fromIso) return null;
  const started = new Date(fromIso).getTime();
  if (!Number.isFinite(started)) return null;
  const secs = Math.max(0, Math.round((now - started) / 1000));
  if (secs < 60) return `${secs}s elapsed`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s elapsed`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m elapsed`;
}

export function ScreeningRadar({
  parties,
  startedAt,
  className,
}: {
  parties: ScreeningRadarParty[];
  /** When the check was last dispatched, if the case records it. */
  startedAt?: string | null;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const total = parties.length;
  const returned = parties.filter((p) => p.returned).length;
  const candidates = parties.filter((p) => p.candidate).length;
  /* Indeterminate is a state, not a zero. */
  const measurable = total > 0;
  const pct = measurable ? Math.round((returned / total) * 100) : null;
  const elapsed = elapsedLabel(startedAt, now);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-5 rounded-md border border-primary/30 bg-primary/[0.04] p-4",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {/* ── The sweep ────────────────────────────────────────────────── */}
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
          <defs>
            <linearGradient id="aml-radar-sweep" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Rings — the grid the sweep travels over. */}
          {[18, 32, 46].map((r) => (
            <circle
              key={r} cx={C} cy={C} r={r} fill="none"
              className="stroke-primary/20" strokeWidth="1"
            />
          ))}
          <line x1={C} y1={C - 46} x2={C} y2={C + 46} className="stroke-primary/15" strokeWidth="1" />
          <line x1={C - 46} y1={C} x2={C + 46} y2={C} className="stroke-primary/15" strokeWidth="1" />

          {/* The rotating beam. Decorative: it carries no reading. */}
          <g
            className="origin-center text-primary motion-safe:animate-[spin_2.6s_linear_infinite] motion-reduce:animate-none"
            style={{ transformOrigin: `${C}px ${C}px` }}
          >
            <path
              d={`M ${C} ${C} L ${C + 46} ${C} A 46 46 0 0 0 ${C + 46 * Math.cos(-1.05)} ${C + 46 * Math.sin(-1.05)} Z`}
              fill="url(#aml-radar-sweep)"
            />
            <line x1={C} y1={C} x2={C + 46} y2={C} className="stroke-primary" strokeWidth="1.5" />
          </g>

          {/* Parties as blips. Returned reads solid; still out reads faint. */}
          {parties.map((p, i) => {
            const { x, y } = blipAt(p.name, i, total);
            return (
              <g key={`${p.name}-${i}`}>
                <circle
                  cx={x} cy={y} r={p.returned ? 3.2 : 2.4}
                  className={cn(
                    p.candidate
                      ? "fill-warning"
                      : p.returned ? "fill-success" : "fill-muted-foreground/50",
                    !p.returned && "motion-safe:animate-pulse",
                  )}
                />
                {p.returned && (
                  <circle
                    cx={x} cy={y} r="6" fill="none" strokeWidth="1"
                    className={cn(p.candidate ? "stroke-warning/40" : "stroke-success/40")}
                  />
                )}
              </g>
            );
          })}

          {/* The progress ring — measured, or absent. */}
          <circle cx={C} cy={C} r={R} fill="none" className="stroke-muted" strokeWidth="3" />
          {pct !== null && (
            <circle
              cx={C} cy={C} r={R} fill="none" strokeWidth="3" strokeLinecap="round"
              className="stroke-primary transition-[stroke-dashoffset] duration-700"
              strokeDasharray={CIRCUM}
              strokeDashoffset={CIRCUM * (1 - pct / 100)}
              transform={`rotate(-90 ${C} ${C})`}
            />
          )}
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {pct !== null ? (
            <>
              <span className="text-xl font-semibold tabular-nums text-foreground">{pct}%</span>
              <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                returned
              </span>
            </>
          ) : (
            <Radar className="h-6 w-6 text-primary motion-safe:animate-pulse" aria-hidden />
          )}
        </div>
      </div>

      {/* ── What the sweep is actually saying ────────────────────────── */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Screening is running</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {measurable
            ? `${returned} of ${total} enrolled part${total === 1 ? "y" : "ies"} answered `
              + "against the official lists."
            : "No readable party population yet, so there is nothing to measure — the "
              + "check is dispatched, not silent."}
        </p>

        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          <div className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full bg-success" />
            <dt className="text-muted-foreground">Answered</dt>
            <dd className="font-medium tabular-nums">{returned}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full bg-muted-foreground/50" />
            <dt className="text-muted-foreground">Still out</dt>
            <dd className="font-medium tabular-nums">{Math.max(total - returned, 0)}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full bg-warning" />
            <dt className="text-muted-foreground">Candidates to adjudicate</dt>
            <dd className="font-medium tabular-nums">{candidates}</dd>
          </div>
          {elapsed && (
            <div className="flex items-center gap-1.5">
              <dt className="text-muted-foreground">Running</dt>
              <dd className="font-medium tabular-nums">{elapsed}</dd>
            </div>
          )}
        </dl>

        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <ShieldQuestion aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
          A returned party is one the engine has answered about — it is not a clearance.
          Anything it returns goes to adjudication by a person.
        </p>
      </div>
    </div>
  );
}
