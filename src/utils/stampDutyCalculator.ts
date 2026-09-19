/**
 * Browser entry point for the Australian stamp duty engine.
 *
 * The engine and every rate live in
 * `supabase/functions/_shared/stampDuty/`, because the borrowing-capacity
 * scenario engine, the agent tool registry and the reports UI all need the same
 * answer and the Edge runtime cannot import from `src/`.
 *
 * This file used to hold its own copy of the rate tables, "mirrored" by hand
 * into `_shared/`. The two drifted, a third copy grew inside
 * `financial-calculator-service`, a fourth was seeded into
 * `stamp_duty_rates_cache`, and by August 2026 no two agreed — WA base amounts,
 * a missing South Australian band, three wrong Tasmanian rates, and a Northern
 * Territory that is quadratic being modelled as linear. Re-exporting is what
 * stops that happening again: there is nothing here to drift.
 */

export * from '../../supabase/functions/_shared/stampDuty/index.pure.ts';
