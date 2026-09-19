/**
 * The Markdown renderer, re-exported.
 *
 * The body moved to `../markdown.pure.ts` when the Market Intelligence report
 * became the second format whose payload is model-authored Markdown. Re-exported
 * rather than re-imported at the call sites so this format's own modules, its
 * bridge and its 75 assertions are unchanged, and so there is exactly one parser
 * to fix.
 */
export * from '../markdown.pure.ts';
