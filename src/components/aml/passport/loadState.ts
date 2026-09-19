/**
 * Shared classification of a Passport projection load failure.
 *
 * Both Passport surfaces (Command section, client booklet) must treat the
 * server's `passport_disabled` answer as "render nothing / quiet return" —
 * never as an error — so the flag-off product is indistinguishable from the
 * product before the Passport existed. One classifier keeps the two
 * components incapable of disagreeing about that.
 */
export type PassportLoadFailure = "disabled" | "error";

export function classifyPassportLoadFailure(e: unknown): {
  kind: PassportLoadFailure;
  message: string;
} {
  const message = e instanceof Error ? e.message : String(e);
  return /passport_disabled|not available/i.test(message)
    ? { kind: "disabled", message }
    : { kind: "error", message };
}

/**
 * What a Passport surface should render, given what it knows.
 *
 * Extracted from the component on purpose. "Renders NOTHING when the flag is
 * off" is the contract that keeps the dark launch honest, and it must be
 * assertable directly — a mocked rejection inside a full component graph is
 * mis-attributed as an unhandled error by the test runner even when
 * demonstrably caught (see this module's test header), so the branch that
 * matters most would otherwise be the one branch no test could pin.
 */
export type PassportSurfaceState = "hidden" | "loading" | "error" | "ready";

export function passportSurfaceState(input: {
  failure: PassportLoadFailure | null;
  loading: boolean;
  hasView: boolean;
}): PassportSurfaceState {
  // Disabled wins over every other signal, including loading: the surface must
  // never flash a skeleton on a deployment where the flag is off.
  if (input.failure === "disabled") return "hidden";
  if (input.loading) return "loading";
  if (input.failure === "error" || !input.hasView) return "error";
  return "ready";
}
