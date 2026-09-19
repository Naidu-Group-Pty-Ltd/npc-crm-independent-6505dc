import { Fragment, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAmlNavEntry } from '@/hooks/useAmlNavEntry';
import { useNavigationVisibility } from '@/hooks/useNavigation';
import { AML_NAV_GROUP_TITLE } from '@/lib/navigation/amlEntry';
import {
  NAVIGATION_GROUP_ORDER,
  navItemIsActive,
  type NavItemDef,
} from '@/lib/navigation/registry';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BrandLockup } from '@/components/branding/BrandAssets';

interface MobileSidebarProps {
  onNavigate?: () => void;
}

// Renders from the shared navigation registry — the same source as the
// desktop sidebar and command palette, filtered by the same capability rule.
export function MobileSidebar({ onNavigate }: MobileSidebarProps) {
  const location = useLocation();
  const currentPath = location.pathname;
  const { visibleNavItems, visibleAdminItems } = useNavigationVisibility();
  /* The AML/CTF module is gated by the `aml_ctf` flag and an assigned AML
     role rather than by a module entitlement, so it is not in the shared
     registry and this surface never drew it — on a phone the module had no
     door at all. One definition, asked here as it is asked by the desktop
     sidebar and the command palette. */
  const amlEntry = useAmlNavEntry();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const isActive = (item: NavItemDef) => navItemIsActive(item, currentPath);

  const mobileNavItems = useMemo(
    () => visibleNavItems.filter((item) => item.mobile !== false),
    [visibleNavItems],
  );

  const groupedNavItems = useMemo(
    () =>
      NAVIGATION_GROUP_ORDER.map((title) => ({
        title,
        items: mobileNavItems.filter((item) => item.group === title),
      })).filter((group) => group.items.length > 0),
    [mobileNavItems],
  );

  const amlGroup = useMemo(
    () => (amlEntry ? { title: AML_NAV_GROUP_TITLE, items: [amlEntry] } : null),
    [amlEntry],
  );

  const groupedAdminItems = useMemo(
    () => ({
      title: 'Administration',
      items: visibleAdminItems.filter((item) => item.mobile !== false),
    }),
    [visibleAdminItems],
  );

  const handleClick = () => onNavigate?.();

  const renderNavigationItem = (item: NavItemDef, isAdministration = false) => {
    const active = isActive(item);
    return (
      <li key={item.title} className="list-none">
        <NavLink
          to={item.url}
          onClick={handleClick}
          title={item.title}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'dashboard-sidebar-menu-button flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-sm font-medium',
            isAdministration && 'dashboard-sidebar-menu-button-admin',
            active && 'dashboard-sidebar-menu-button-active'
          )}
        >
          <item.icon className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate">{item.title}</span>
        </NavLink>
      </li>
    );
  };

  const renderGroup = (
    group: { title: string; items: NavItemDef[] },
    options: { administration?: boolean } = {}
  ) => {
    const hasActiveItem = group.items.some((item) => isActive(item));
    const isGroupCollapsed = !hasActiveItem && Boolean(collapsedGroups[group.title]);

    return (
      <div
        key={group.title}
        className={cn(
          'dashboard-sidebar-group',
          options.administration && 'dashboard-sidebar-admin-group'
        )}
      >
        <button
          type="button"
          className={cn(
            'dashboard-sidebar-group-trigger',
            hasActiveItem && 'dashboard-sidebar-group-trigger-active',
            options.administration && 'dashboard-sidebar-admin-trigger'
          )}
          aria-expanded={!isGroupCollapsed}
          onClick={() =>
            setCollapsedGroups((current) => ({ ...current, [group.title]: !current[group.title] }))
          }
        >
          <span>{group.title}</span>
          <ChevronDown className={cn('h-4 w-4 transition-transform', isGroupCollapsed && '-rotate-90')} />
        </button>
        {!isGroupCollapsed && (
          <ul className="mt-1 space-y-0.5">
            {group.items.map((item) => renderNavigationItem(item, options.administration))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="dashboard-sidebar-surface flex h-full flex-col overflow-hidden">
      {/* Brand — matches desktop expanded header */}
      <div className="dashboard-sidebar-header p-6">
        <BrandLockup
          slot="sidebar"
          meta="Intake Dashboard"
          className="dashboard-brand-lockup"
          logoClassName="brand-logo brand-logo-sidebar"
          fallbackClassName="h-10 w-10"
        />
      </div>

      <ScrollArea className="flex-1">
        <nav className="dashboard-sidebar-nav" aria-label="Dashboard navigation">
          {/* AML/CTF sits directly after Main Dashboard and before Reports &
              Analysis — the position it holds on the desktop sidebar. */}
          {groupedNavItems.map((group) => (
            <Fragment key={group.title}>
              {renderGroup(group)}
              {group.title === 'Main Dashboard' && amlGroup ? renderGroup(amlGroup) : null}
            </Fragment>
          ))}

          {/* Main Dashboard hidden or entitled away: AML still gets its door. */}
          {amlGroup && !groupedNavItems.some((g) => g.title === 'Main Dashboard')
            && renderGroup(amlGroup)}

          {groupedAdminItems.items.length > 0 && (
            <div className="dashboard-sidebar-admin-divider">
              {renderGroup(groupedAdminItems, { administration: true })}
            </div>
          )}
        </nav>
      </ScrollArea>
    </div>
  );
}
