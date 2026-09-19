/**
 * The module keys that actually exist in `public.dashboard_modules`.
 *
 * This file exists because nothing in the repository listed them, and a
 * permission check against a module key that does not exist does not fail — it
 * falls open. `secure-storage` gated reads of every client-document bucket on
 * the module key `clients`; the registered key is `client_management`, so
 * `checkModuleView` took its "unregistered module → allow" branch and the gate
 * authorized nothing at all for exactly the buckets holding client PII.
 *
 * A typo in a module key is invisible at runtime and silent in review. Listing
 * the keys makes it a test failure instead.
 *
 * To regenerate:
 *   select module_key from public.dashboard_modules where is_active order by 1;
 */
export const DASHBOARD_MODULE_KEYS = [
  'activity_logs',
  'admin_email_access',
  'agent',
  'agreements',
  'automation',
  'borrowing_capacity',
  'calendar',
  'call_logs',
  'cash_flow',
  'charts',
  'checklists',
  'client_management',
  'client_portal_admin',
  'client_tracker',
  'cloudflare',
  'conversations',
  'data_import',
  'deal_pipeline',
  'depreciation_comps',
  'email_copilot',
  'error_logs',
  'finance_portal_admin',
  'game_plans',
  'generated_reports',
  'listings',
  'marketing_analytics',
  'monitoring',
  'overview',
  'portal_config',
  'portfolio_reports',
  'quality_assurance',
  'reminders',
  'report_qa',
  'report_requests',
  'reports',
  'settings',
  'solicitor_portal_admin',
  'sources',
  'templates',
  'user_guide',
  'user_management',
  'white_label',
] as const;

export type DashboardModuleKey = (typeof DASHBOARD_MODULE_KEYS)[number];

export function isRegisteredModuleKey(key: string): boolean {
  return (DASHBOARD_MODULE_KEYS as readonly string[]).includes(key);
}
