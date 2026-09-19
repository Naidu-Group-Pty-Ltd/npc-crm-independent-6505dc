/**
 * One-call preflight wrapper. Returns true if generation may proceed,
 * false if the user is out of tokens (banner is dispatched automatically).
 * Callers can also surface their own loading UI around this.
 */
import {
  preflightTokens,
  estimateTokens,
  InsufficientTokensError,
  type TokenKind,
} from "@/lib/missionControl";
import { emitOutOfTokens } from "@/lib/tokenEvents";

export interface PreflightArgs {
  kind: TokenKind;
  estimatedTokens?: number;
  estimate?: { extraSections?: number; aiNarrative?: boolean; multiplier?: number };
  functionName: string;
  label?: string;
}

export async function runPreflight(args: PreflightArgs): Promise<boolean> {
  const estimate = args.estimatedTokens ?? estimateTokens(args.kind, args.estimate);
  try {
    await preflightTokens(estimate);
    return true;
  } catch (e) {
    if (e instanceof InsufficientTokensError) {
      emitOutOfTokens({
        available: e.available,
        requested: e.requested,
        functionName: args.functionName,
        label: args.label,
      });
      return false;
    }
    // Balance fetch failed (network/MC unconfigured) — let server gate the call.
    console.warn("[preflight] balance check failed, continuing:", e);
    return true;
  }
}
