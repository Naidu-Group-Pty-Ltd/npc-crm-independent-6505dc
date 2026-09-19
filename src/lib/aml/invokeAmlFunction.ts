import { invokeSecureFunction } from "@/lib/secureInvoke";
import { getStepUpToken, requiredCapabilityFor } from "./stepUpTokenStore";

export async function invokeAmlFunction<T = any>(functionName: string, payload: Record<string, any>): Promise<T> {
  // Attach a step-up session token for privileged ops so the server can enforce it.
  const capability = requiredCapabilityFor(functionName, payload?.op);
  const enriched = { ...payload };
  if (capability) {
    const token = getStepUpToken(capability);
    if (token) enriched.step_up_session_token = token;
  }
  const { data, error } = await invokeSecureFunction<T>(functionName, enriched, { timeoutMs: 60000 });
  if (error) throw new Error(error.message ?? `${functionName} failed`);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}
