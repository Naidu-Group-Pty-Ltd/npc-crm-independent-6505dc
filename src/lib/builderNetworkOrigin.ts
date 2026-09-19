/**
 * The Builders Network's public origin — the ONE place this workspace names it.
 *
 * The Builder / Developer Portal left the per-workspace deployment for the
 * central multi-vendor platform (extraction plan §7 Phase 6). The origin is
 * fleet-wide and public by design — every workspace's `/builder/*` sends its
 * builders to the same place — so a literal here is configuration in the same
 * sense the Mission Control origin is: the product, not a secret, and a clone
 * inherits it correctly by copying the code.
 *
 * `?from=` carries which workspace sent the visitor. The plan writes
 * `?from=<slug>`, but a workspace's MC slug has never been published into the
 * frontend bundle and inventing a second identity channel for one query
 * parameter would be a new secret to provision on every clone. The hostname IS
 * the workspace's public name, is already in the address bar, and maps one to
 * one onto a clone — so it travels instead, and Mission Control can resolve it.
 */
export const BUILDER_NETWORK_ORIGIN = "https://builders.aurixasystems.com.au";

/** Where `/builder/*` sends a visitor, stamped with the sending workspace. */
export function builderNetworkPortalUrl(fromHostname: string): string {
  const from = (fromHostname ?? "").trim();
  return from
    ? `${BUILDER_NETWORK_ORIGIN}/?from=${encodeURIComponent(from)}`
    : `${BUILDER_NETWORK_ORIGIN}/`;
}
