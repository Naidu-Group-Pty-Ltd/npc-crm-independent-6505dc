/**
 * Bridge — the canonical post-processor lives with the edge functions.
 *
 * This was a hand-maintained COPY under a "keep in sync" header, and it had
 * already drifted: measured 20 Sep 2026 the frontend copy was missing Phase 7
 * entirely — `scrubBlocks`, the pass that drops a stat card stating nothing
 * and a chart already drawn earlier — along with the two report fields that
 * count what it removed. Two specs imported this file, so both were asserting
 * against a module production does not run.
 *
 * `compassRegistryParity.spec.ts` records the same pair of files as the
 * cautionary case for exactly this, and says a bridge is the remedy where one
 * is available. For the registries it is not: the edge copy keeps
 * `HEADING_ROUTING`/`routeHeading` and the frontend copy keeps
 * `normaliseReportTier`/`sectionCountForTier`, so those two are legitimately
 * different files and are held together by that spec instead. Here there was
 * no such divergence — one file was simply behind — so the copy goes.
 */
export * from '../../../supabase/functions/_shared/compassPostProcessor.ts';
