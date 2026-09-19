import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { invokeSecureFunction } from "@/lib/secureInvoke";

export type AmlRole = "analyst" | "reviewer" | "mlro" | "auditor";

const SUPERADMIN_AML_ROLES: AmlRole[] = ["analyst", "reviewer", "mlro", "auditor"];

interface AmlAccessSummary {
  flagEnabled: boolean;
  roles: AmlRole[];
}

export interface AmlAccess {
  loading: boolean;
  flagEnabled: boolean;
  roles: Set<AmlRole>;
  hasAnyRole: boolean;
  canWrite: boolean;
  isMlro: boolean;
  /**
   * The read FAILED — as distinct from the server answering "no access".
   *
   * They were the same value. A refused request, a dropped connection or a
   * fifteen-second timeout all set `flagEnabled: false` with no roles, and
   * every surface then asserted something false: the guard said "AML/CTF is
   * not enabled" about a module that is enabled, and the navigation quietly
   * deleted a statutory workspace. On a phone, where a request is far more
   * likely to fail, that is indistinguishable from having no access at all
   * and there was nothing to retry with.
   *
   * The same rule the partner surface already carries: a failure is never
   * cached and never reported as "off". Navigation still fails closed — a
   * door that cannot be verified is not drawn — but the page says which of
   * the two it is and offers the retry.
   */
  unavailable: boolean;
  refresh: () => Promise<void>;
}

export function useAmlAccess(): AmlAccess {
  const { user, loading: authLoading, isSuperadmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [flagEnabled, setFlagEnabled] = useState(false);
  const [roles, setRoles] = useState<Set<AmlRole>>(new Set());
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    setLoading(true);
    try {
      const uid = user?.id;

      if (!uid) {
        setUnavailable(false);
        setFlagEnabled(false);
        setRoles(new Set());
        return;
      }

      if (isSuperadmin) {
        setUnavailable(false);
        setFlagEnabled(true);
        setRoles(new Set(SUPERADMIN_AML_ROLES));
        return;
      }

      /*
       * One retry, for a transport failure only.
       *
       * A dropped connection on a train is not an answer about somebody's
       * access, and it is the commonest failure on a phone. `retryable` is
       * set by the transport for a network error, a timeout or a 5xx; a 401
       * or a 403 is an answer and is never retried. One attempt, not a loop:
       * a loop against an auth endpoint hides an outage.
       */
      let attempt = await invokeSecureFunction<AmlAccessSummary>(
        "aml-access", { op: "summary" }, { timeoutMs: 15000 },
      );
      if (attempt.error?.retryable) {
        attempt = await invokeSecureFunction<AmlAccessSummary>(
          "aml-access", { op: "summary" }, { timeoutMs: 15000 },
        );
      }
      if (attempt.error) throw new Error(attempt.error.message);

      setUnavailable(false);
      setFlagEnabled(Boolean(attempt.data?.flagEnabled));
      setRoles(new Set((attempt.data?.roles ?? []) as AmlRole[]));
    } catch (e) {
      console.warn("useAmlAccess failed", e);
      if (isSuperadmin) {
        setUnavailable(false);
        setFlagEnabled(true);
        setRoles(new Set(SUPERADMIN_AML_ROLES));
      } else {
        /* The reading is UNKNOWN, not "no access". Everything downstream
           still fails closed on the values themselves — this only stops the
           product asserting a reason it does not have. */
        setUnavailable(true);
        setFlagEnabled(false);
        setRoles(new Set());
      }
    } finally {
      setLoading(false);
    }
  }, [authLoading, user?.id, isSuperadmin]);

  useEffect(() => { load(); }, [load]);

  return {
    loading,
    flagEnabled,
    roles,
    unavailable,
    hasAnyRole: roles.size > 0,
    canWrite: roles.has("analyst") || roles.has("reviewer") || roles.has("mlro"),
    isMlro: roles.has("mlro"),
    refresh: load,
  };
}
