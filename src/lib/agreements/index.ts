/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * One implementation, re-exported (the `partnerAgreementRevision.pure.ts`
 * pattern): the locked template content, the field registry, the lifecycle
 * state machine and the validation rules are the same modules the server
 * enforces, so the wizard, the preview, the partner room and the API cannot
 * drift apart. Nothing may be added here.
 *
 * `documentHtml.pure.ts` is deliberately NOT bridged — it pulls the whole
 * report stylesheet into the bundle, and the browser renders the digital view
 * from the content model instead.
 */
export * from '../../../supabase/functions/_shared/agreements/index.pure.ts';
