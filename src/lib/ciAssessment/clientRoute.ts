/**
 * Where a client's Commercial & Industrial file lives.
 *
 * One function, because "open the client" was being written by hand at each
 * call site and every one of them landed on the client list — which is the
 * general Command Centre page, not this client, and certainly not the C&I
 * records the user was looking at a moment earlier. Sending someone from a
 * linked assessment to a list of every client is an invitation to search for
 * the person they were already looking at.
 *
 * The Command Centre reads `clientId` and `tab` off the query string and opens
 * the client's workspace on that tab (`ClientManagement`'s deep-link effect),
 * so this is a normal in-app route rather than anything the C&I module has to
 * know about the client modal.
 */

/** The tab id in `CLIENT_TABS` that holds the C&I records. */
export const CLIENT_CI_TAB = 'commercial-industrial';

/**
 * A route to one client's Commercial / Industrial file.
 *
 * `tab` is overridable for the rare caller that wants the same client on a
 * different tab; leaving it alone is the point of this module.
 */
export function clientCommercialIndustrialPath(clientId: string, tab: string = CLIENT_CI_TAB): string {
  return `/clients?clientId=${encodeURIComponent(clientId)}&tab=${encodeURIComponent(tab)}`;
}
