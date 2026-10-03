/**
 * Browser entry point for the agent's shared protocol — the plan, the cards,
 * the links it may offer and the receipt each answer keeps.
 *
 * The implementation lives in `supabase/functions/_shared/agent/` so that the
 * Edge Function that builds these and the panel that draws them read ONE
 * definition: a link the server composes is re-checked here by the same
 * `isAgentHref`, and a stored receipt is read by the same `readReceipt` that
 * shaped it.
 */
export * from '../../../supabase/functions/_shared/agent/agentRoutes.pure';
export * from '../../../supabase/functions/_shared/agent/agentViews.pure';
export * from '../../../supabase/functions/_shared/agent/agentPlan.pure';
export * from '../../../supabase/functions/_shared/agent/agentReceipt.pure';
export { UI_TOOL_NAMES } from '../../../supabase/functions/_shared/agent/agentUiTools.pure';
