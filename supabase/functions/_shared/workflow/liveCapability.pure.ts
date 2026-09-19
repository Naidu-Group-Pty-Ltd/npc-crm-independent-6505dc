/**
 * Which steps can genuinely run, as opposed to being simulated.
 *
 * Three places need this answer and must not disagree:
 *
 *   • the browser, to refuse a step locally with a useful message rather than
 *     take a 400 from the executor;
 *   • the executor, as the boundary that stops either caller being turned into
 *     a general-purpose proxy;
 *   • the dispatcher, for the same reason, unattended.
 *
 * It used to be a hand-maintained list in two files kept honest by a test that
 * compared them — which holds until somebody adds an integration and updates
 * one. It is now derived from the catalog: a step is runnable because it
 * declares how to be run. Adding a vendor is a declaration next to the
 * operation, and all three callers change with it.
 *
 * Pure, and free of the executor's IO, so a test can assert the set without
 * pulling `npm:` specifiers into the browser's bundler.
 */

import { CATALOG } from './catalog/index.pure.ts';

/**
 * The few steps a descriptor cannot express, each performed by hand.
 *
 * `core.http` and `core.graphql` are generic protocols the author pointed
 * somewhere themselves; `core.notify_team` writes to our own tables; the
 * `mcp.*` four speak JSON-RPC rather than REST.
 */
export const HAND_WRITTEN_STEP_TYPES = [
  'core.http',
  'core.graphql',
  'core.notify_team',
  'mcp.list_tools',
  'mcp.call_tool',
  'mcp.read_resource',
  'mcp.get_prompt',
] as const;

/**
 * Performed in the page rather than on the server.
 *
 * `core.webhook_respond` shapes the reply to an inbound webhook, which the
 * *caller* of the workflow is holding open. There is no outbound request and no
 * credential, so sending it to the executor would gain nothing and cost
 * correctness — its allow-list would refuse a step that needed no server at all.
 */
export const CLIENT_ONLY_STEP_TYPES = ['core.webhook_respond'] as const;

/** Operations the catalog taught to call themselves. */
export const DESCRIBED_STEP_TYPES: readonly string[] = CATALOG
  .filter((node) => node.request)
  .map((node) => node.id);

/** What the server will perform. */
export const SERVER_CAPABLE_STEP_TYPES: ReadonlySet<string> = new Set<string>([
  ...HAND_WRITTEN_STEP_TYPES,
  ...DESCRIBED_STEP_TYPES,
]);

/** What the browser will attempt — the server's set plus what it does itself. */
export const CLIENT_CAPABLE_STEP_TYPES: ReadonlySet<string> = new Set<string>([
  ...SERVER_CAPABLE_STEP_TYPES,
  ...CLIENT_ONLY_STEP_TYPES,
]);
