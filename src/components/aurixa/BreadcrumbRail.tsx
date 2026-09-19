import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * BreadcrumbRail — Phase 1 primitive.
 *
 * A slim, semantic breadcrumb trail that derives itself from the current
 * route pathname. Consumers may override the last segment's label via
 * `currentLabel` for pages that render dynamic IDs.
 *
 * Kept intentionally lightweight — no icons per crumb, no dropdowns.
 * Uses ONLY semantic tokens.
 */
const SEGMENT_LABEL_OVERRIDES: Record<string, string> = {
  admin: 'Admin',
  aml: 'AML / CTF',
  qa: 'Q&A',
  crm: 'CRM',
  'finance-portal': 'Finance Portal',
  'portal-config': 'Client Portal',
  'model-hub': 'Model Hub',
  'market-updates': 'Market News Feed',
  'generated-reports': 'Generated Reports',
  'quantitative-reports': 'Quantitative Reports',
  'cash-flow-analysis': 'Cash Flow',
  'report-qa': 'Aurixa Intelligence Hub',
  listings: 'Property Marketplace',
  'email-copilot': 'Email Copilot',
  'call-logs': 'Call Logs',
  'client-tracker': 'Client Tracker',
  'portfolio-reports': 'Portfolio Reports',
  'report-requests': 'Report Requests',
  'deal-pipeline': 'Deal Pipeline',
  'game-plan': 'Game Plan',
  'marketing-analytics': 'Marketing',
  'user-guide': 'User Guide',
  'white-label': 'Branding',
  'api-usage': 'API Usage',
  'quality-assurance': 'QA',
  'data-import': 'Data Import',
  'error-logs': 'Error Logs',
  'activity-logs': 'Activity Logs',
  'depreciation-comps': 'Depreciation Comps',
  'finance-portal-admin': 'Finance Portal',
  'token-audit': 'Token Audit',
  'pdf-import-engine': 'PDF Import Engine',
  'pdf-import-diagnostics': 'PDF Import Diagnostics',
  'bc-segment-engine': 'BC Segment Engine',
  'reclassify-property': 'Reclassify Property',
};

function humanise(segment: string): string {
  if (SEGMENT_LABEL_OVERRIDES[segment]) return SEGMENT_LABEL_OVERRIDES[segment];
  if (/^[0-9a-f-]{20,}$/i.test(segment)) return '…';
  return segment
    .split('-')
    .map((part) => (part.length ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

export interface BreadcrumbRailProps {
  currentLabel?: string;
  className?: string;
  /** Hide the "Home" leading crumb (default: false). */
  hideHome?: boolean;
}

export function BreadcrumbRail({ currentLabel, className, hideHome = false }: BreadcrumbRailProps) {
  const { pathname } = useLocation();
  const segments = React.useMemo(() => pathname.split('/').filter(Boolean), [pathname]);

  if (segments.length === 0) return null; // don't render on Home

  const crumbs = segments.map((segment, index) => {
    const isLast = index === segments.length - 1;
    const href = '/' + segments.slice(0, index + 1).join('/');
    const label = isLast && currentLabel ? currentLabel : humanise(segment);
    return { href, label, isLast };
  });

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground',
        className
      )}
    >
      <ol className="flex min-w-0 items-center gap-1.5">
        {!hideHome && (
          <>
            <li className="flex items-center">
              <Link
                to="/"
                className="flex items-center gap-1 rounded px-1 py-0.5 transition-colors duration-[var(--motion-fast)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Home"
              >
                <Home className="h-3.5 w-3.5" />
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="h-3.5 w-3.5 opacity-60" />
            </li>
          </>
        )}
        {crumbs.map((crumb, idx) => (
          <React.Fragment key={crumb.href}>
            <li className="min-w-0">
              {crumb.isLast ? (
                <span
                  aria-current="page"
                  className="block truncate font-medium text-foreground"
                  title={crumb.label}
                >
                  {crumb.label}
                </span>
              ) : (
                <Link
                  to={crumb.href}
                  className="block truncate rounded px-1 py-0.5 transition-colors duration-[var(--motion-fast)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title={crumb.label}
                >
                  {crumb.label}
                </Link>
              )}
            </li>
            {!crumb.isLast && (
              <li aria-hidden="true">
                <ChevronRight className="h-3.5 w-3.5 opacity-60" />
              </li>
            )}
          </React.Fragment>
        ))}
      </ol>
    </nav>
  );
}

export default BreadcrumbRail;
