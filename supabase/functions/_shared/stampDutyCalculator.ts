/**
 * Compatibility re-export for Edge Functions that already import this path.
 *
 * This was a hand-maintained "mirror" of `src/utils/stampDutyCalculator.ts`
 * carrying its own copy of every rate. It drifted from the file it mirrored —
 * different VIC brackets, a different NSW top band — and both were a financial
 * year behind the revenue offices. The engine now lives in `stampDuty/`; this
 * file exists only so `scenarioDeltaEngine.ts` and `agent-tools-registry.ts`
 * keep resolving, and it must never regain a rate of its own.
 */

export * from './stampDuty/index.pure.ts';
