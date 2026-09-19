/**
 * WP-24: which columns a request body may write, per commercial/industrial table.
 *
 * ## Why these replaced a denylist
 *
 * `manage-commercial-data` and `manage-industrial-data` are generic table
 * proxies: the caller names a table and hands over `body.data`. Both allowlist
 * the *table* and verify ownership, which is the hard part and was already done.
 * What they did with the payload was:
 *
 *     const payload = { ...body.data };
 *     delete payload.id;
 *     delete payload.user_id;
 *     delete payload.property_id;
 *
 * That is safe for the three columns somebody thought of, and open for every
 * column added since. `industrial_properties` alone has 27 writable columns and
 * gains more with each migration; the set nobody thought of only ever grows.
 * It also let a caller overwrite `linked_at`, which is provenance rather than
 * data.
 *
 * A denylist has to be right about the future. An allowlist has to be right
 * about today, and going stale makes it *narrower* rather than wider — a new
 * column simply is not writable until somebody adds it here, which is a
 * failure that shows up as "my new field does not save" rather than as a
 * silent write to something that should never have been settable.
 *
 * ## Where these came from
 *
 * `information_schema.columns` on the live project, minus identity, audit and
 * ownership columns: `id`, `created_at`, `created_by`, `updated_at`,
 * `updated_by`, `deleted_at`, `deleted_by`, `user_id`, `property_id`,
 * `tenant_id`, `org_id`, `row_version`. Ownership is set by the handler from
 * the verified session, never from the body — that is the whole point of the
 * three `delete`s these lists replace.
 */

/** `public.commercial_*`, keyed by the table name the caller may name. */
export const COMMERCIAL_WRITABLE: Record<string, Set<string>> = {
  commercial_properties: new Set([
    'client_id', 'address', 'suburb', 'state', 'postcode', 'asset_class',
    'asset_sub_type', 'tenure', 'zoning', 'gfa_sqm', 'nla_sqm', 'site_area_sqm',
    'parking_bays', 'year_built', 'purchase_price', 'acquisition_date',
    'gst_treatment', 'valuation', 'valuation_date', 'valuer',
    'outgoings_recoverable', 'industrial_specs', 'notes',
  ]),
  commercial_leases: new Set([
    'tenant_name', 'suite_unit', 'nla_sqm', 'lease_start', 'lease_end',
    'option_terms', 'base_rent_pa', 'rent_basis', 'review_type',
    'review_freq_months', 'next_review_date', 'review_amount',
    'rent_free_months', 'fitout_contribution', 'cash_incentive',
    'outgoings_recovery_pct', 'security_type', 'security_amount', 'status', 'notes',
  ]),
  commercial_dcf_runs: new Set([
    'scenario_name', 'hold_period_years', 'discount_rate', 'terminal_cap_rate',
    'rental_growth_assumptions', 'vacancy_allowance_pct', 'capex_schedule',
    'loan_amount', 'interest_rate', 'loan_term_years', 'outputs', 'irr', 'npv',
    'equity_multiple', 'peak_equity',
  ]),
  commercial_capex: new Set(['year', 'amount', 'category', 'notes']),
  commercial_financing: new Set([
    'lender', 'loan_amount', 'loan_balance', 'interest_rate', 'loan_term_years',
    'io_period_years', 'repayment_type', 'lvr_pct', 'upfront_fees',
    'ongoing_fees_pa', 'rate_type', 'notes',
  ]),
};

/** `public.industrial_*`. */
export const INDUSTRIAL_WRITABLE: Record<string, Set<string>> = {
  industrial_properties: new Set([
    'client_id', 'property_name', 'street', 'suburb', 'state', 'postcode',
    'asset_subtype', 'purchase_price', 'purchase_date', 'current_valuation',
    'valuation_date', 'gla_sqm', 'site_area_sqm', 'site_cover_pct', 'office_pct',
    'hardstand_sqm', 'clearance_metres', 'power_kva', 'dock_doors',
    'ground_floor_load_kpa', 'zoning', 'year_built', 'condition_rating',
    'status', 'notes',
  ]),
  industrial_tenancies: new Set([
    'tenant_name', 'anzsic_industry', 'unit_label', 'gla_sqm', 'lease_start',
    'lease_end', 'base_rent_per_sqm_pa', 'base_rent_pa',
    'outgoings_recovery_type', 'annual_review_type', 'review_rate_pct',
    'option_terms_years', 'bank_guarantee_months', 'incentive_pct',
    'make_good_status', 'notes',
  ]),
  industrial_capex: new Set(['year', 'amount', 'category', 'notes']),
  industrial_financing: new Set([
    'lender', 'loan_amount', 'loan_balance', 'interest_rate', 'loan_term_years',
    'io_period_years', 'repayment_type', 'lvr_pct', 'upfront_fees',
    'ongoing_fees_pa', 'rate_type', 'notes',
  ]),
};

// Deliberately absent from the properties lists, though the columns exist:
//
//   linked_at            — provenance. Set when the record is linked to a
//                          client, by the code that does the linking.
//   industrial_financing — a column on `industrial_properties` that shadows the
//                          table of the same name. Whatever it is for, a
//                          generic table proxy is not the thing that should be
//                          writing it.
