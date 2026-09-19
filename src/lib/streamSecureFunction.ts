/**
 * Streaming variant of invokeSecureFunction.
 *
 * Opens a POST to a Supabase Edge Function that returns a Server-Sent-Events
 * response, resolves auth the same way invokeSecureFunction does, and yields
 * parsed JSON event objects. Supports AbortController for user cancellation.
 *
 * The remote function is expected to write one `data: <json>\n\n` block per
 * event and (optionally) `event: <name>` lines. Events without an `event:`
 * label default to `type: 'message'`.
 */
import {
  describeAuthError,
  isAuthFailureResponse,
  refreshAccessToken,
  resolveAuthBearer,
} from "@/lib/secureInvoke";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';


export interface StreamEvent {
  event: string;
  data: any;
}

export interface StreamOptions {
  signal?: AbortSignal;
}

/**
 * Async iterator over SSE events from an edge function.
 * Throws on non-2xx responses. Aborts cleanly when the signal fires.
 */
export async function* streamSecureFunction(
  functionName: string,
  body: Record<string, any>,
  options: StreamOptions = {},
): AsyncGenerator<StreamEvent, void, unknown> {
  // WP-11B/C cookie-only: authenticate via the HttpOnly session cookie
  // (`credentials: 'include'`) plus the access-token JWT Bearer. No raw session
  // token is read from storage or sent in the body/headers.
  //
  // The token is resolved through `resolveAuthBearer` — storage, then the
  // native supabase-js session, then the cookie — because the tab-scoped access
  // token is the one carrier that routinely goes missing while the session
  // itself is fine, and sending the ANON key instead buys a guaranteed
  // "Authentication required".
  const payload = JSON.stringify(body);
  const send = (bearerToken: string) =>
    fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${bearerToken}`,
      },
      credentials: "include",
      body: payload,
      signal: options.signal,
    });

  const { token, authenticated } = await resolveAuthBearer({ refreshIfMissing: true });
  let response = await send(token);

  if (!response.ok) {
    const readDetail = async (res: Response) => {
      try {
        return (await res.text()).slice(0, 400);
      } catch {
        return "";
      }
    };
    let detail = await readDetail(response);

    // One refresh, one retry — the same allowance the JSON path gets. Skipped
    // when the resolver already came back empty-handed: the cookie was asked a
    // moment ago and had nothing to give, so asking again only delays the
    // message telling the person to sign in.
    if (authenticated && isAuthFailureResponse(response.status, detail)) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        response = await send(refreshed);
        if (!response.ok) detail = await readDetail(response);
      }
    }

    if (!response.ok) {
      const guidance = describeAuthError(detail);
      throw new Error(guidance ?? `Stream request failed: ${response.status} ${detail}`.trim());
    }
  }

  if (!response.body) throw new Error(`Stream request failed: ${response.status} (no response body)`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const rawBlock = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const lines = rawBlock.split("\n");
        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        const dataStr = dataLines.join("\n");
        if (dataStr === "[DONE]") return;
        try {
          yield { event: eventName, data: JSON.parse(dataStr) };
        } catch {
          yield { event: eventName, data: dataStr };
        }
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
}
