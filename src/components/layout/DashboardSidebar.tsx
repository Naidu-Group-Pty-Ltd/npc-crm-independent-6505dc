import { Fragment, useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, Search, X as XIcon } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { useWhiteLabel } from '@/contexts/WhiteLabelContext';
import { useAmlNavEntry } from '@/hooks/useAmlNavEntry';
import { useNavigationVisibility } from '@/hooks/useNavigation';
import { AML_NAV_GROUP_TITLE } from '@/lib/navigation/amlEntry';
import {
  NAVIGATION_GROUP_ORDER,
  navItemIsActive,
  type NavItemDef,
} from '@/lib/navigation/registry';
import { BrandLockup, BrandLogo } from '@/components/branding/BrandAssets';
import { cn } from '@/lib/utils';

export function DashboardSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  const currentPath = location.pathname;
  const { settings } = useWhiteLabel();
  const { visibleNavItems, visibleAdminItems } = useNavigationVisibility();
  const amlEntry = useAmlNavEntry();
  const isCollapsed = state === 'collapsed';
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [navFilter, setNavFilter] = useState('');

  // Clear the sidebar search whenever the sidebar collapses to icon mode.
  useEffect(() => {
    if (isCollapsed) setNavFilter('');
  }, [isCollapsed]);

  const isActive = (item: NavItemDef) => navItemIsActive(item, currentPath);

  const normalisedFilter = navFilter.trim().toLowerCase();
  const matchesFilter = (title: string) =>
    normalisedFilter.length === 0 || title.toLowerCase().includes(normalisedFilter);

  const groupedNavItems = useMemo(
    () =>
      NAVIGATION_GROUP_ORDER.map((title) => ({
        title,
        items: visibleNavItems.filter(
          (item) => item.group === title && matchesFilter(item.title),
        ),
      })).filter((group) => group.items.length > 0),
     
    [visibleNavItems, normalisedFilter],
  );

  const groupedAdminItems = useMemo(
    () => ({
      title: 'Administration',
      items: visibleAdminItems.filter((item) => matchesFilter(item.title)),
    }),
     
    [visibleAdminItems, normalisedFilter],
  );

  // AML/CTF Compliance — one entry, defined in `lib/navigation/amlEntry.ts`
  // and asked for by every navigation surface. It used to be built here and
  // again in the command palette, and not at all in the two mobile surfaces,
  // which is why the module had no door on a phone.
  const amlGroupedItems = amlEntry
    ? { title: AML_NAV_GROUP_TITLE, items: [amlEntry] }
    : null;

  const renderNavigationItem = (item: NavItemDef, isAdministration = false) => {
    const active = isActive(item);

    return (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton
          asChild
          isActive={active}
          tooltip={item.title}
          className={cn(
            'dashboard-sidebar-menu-button',
            isAdministration && 'dashboard-sidebar-menu-button-admin',
            active && 'dashboard-sidebar-menu-button-active'
          )}
        >
          <NavLink
            to={item.url}
            className="flex min-w-0 items-center gap-2 text-sm font-medium"
            title={item.title}
            aria-current={active ? 'page' : undefined}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!isCollapsed && <span className="min-w-0 truncate">{item.title}</span>}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  const renderGroup = (
    group: { title: string; items: NavItemDef[] },
    options: { administration?: boolean } = {}
  ) => {
    const hasActiveItem = group.items.some((item) => isActive(item));
    const isGroupCollapsed = !hasActiveItem && Boolean(collapsedGroups[group.title]);

    if (isCollapsed) {
      return (
        <SidebarGroup
          key={group.title}
          className={cn(
            'dashboard-sidebar-group-collapsed',
            options.administration && 'dashboard-sidebar-admin-group-collapsed'
          )}
        >
          <SidebarGroupContent>
            <SidebarMenu>{group.items.map((item) => renderNavigationItem(item, options.administration))}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      );
    }

    return (
      <SidebarGroup
        key={group.title}
        className={cn('dashboard-sidebar-group', options.administration && 'dashboard-sidebar-admin-group')}
      >
        <button
          type="button"
          className={cn(
            'dashboard-sidebar-group-trigger',
            hasActiveItem && 'dashboard-sidebar-group-trigger-active',
            options.administration && 'dashboard-sidebar-admin-trigger'
          )}
          aria-expanded={!isGroupCollapsed}
          onClick={() => setCollapsedGroups((current) => ({ ...current, [group.title]: !current[group.title] }))}
        >
          <span>{group.title}</span>
          <ChevronDown className={cn('h-4 w-4 transition-transform', isGroupCollapsed && '-rotate-90')} />
        </button>
        {!isGroupCollapsed && (
          <SidebarGroupContent className="mt-1">
            <SidebarMenu>{group.items.map((item) => renderNavigationItem(item, options.administration))}</SidebarMenu>
          </SidebarGroupContent>
        )}
      </SidebarGroup>
    );
  };

  // Determine which logo to show based on sidebar state
  const currentLogo = isCollapsed
    ? (settings.sidebarIcon || settings.sidebarLogo)
    : settings.sidebarLogo;

  return (
    <Sidebar collapsible="icon" className="dashboard-sidebar-surface border-r-0">
      <SidebarContent className="dashboard-sidebar-content">
        {/* Brand */}
        <div className={`dashboard-sidebar-header ${isCollapsed ? 'p-3' : 'p-6'}`}>
          {isCollapsed ? (
            <div className="flex items-center justify-center">
              {currentLogo ? (
                <img src={currentLogo} alt={settings.companyName} className="h-8 w-8 object-contain" />
              ) : (
                <BrandLogo slot="sidebar-icon" fallbackClassName="h-8 w-8" />
              )}
            </div>
          ) : (
            <BrandLockup
              slot="sidebar"
              className="dashboard-brand-lockup"
              logoClassName="brand-logo brand-logo-sidebar"
              fallbackClassName="h-10 w-10"
            />

          )}
        </div>

        {!isCollapsed && (
          <div className="px-4 pb-2">
            <label className="relative block">
              <span className="sr-only">Filter navigation</span>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                value={navFilter}
                onChange={(event) => setNavFilter(event.target.value)}
                placeholder="Filter navigation…"
                aria-label="Filter navigation"
                className="glass-inset h-8 w-full rounded-md pl-8 pr-7 text-xs text-sidebar-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {navFilter.length > 0 && (
                <button
                  type="button"
                  onClick={() => setNavFilter('')}
                  aria-label="Clear navigation filter"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
          </div>
        )}

        <nav className="dashboard-sidebar-nav" aria-label="Dashboard navigation">
          {groupedNavItems.length === 0 && !isCollapsed && (
            <div className="mx-4 my-3 rounded-md border border-dashed border-[color:var(--sidebar-border)] p-3 text-center text-xs text-muted-foreground">
              No matches for “{navFilter}”.
            </div>
          )}
          {/* The framed/highlighted treatment now wraps the main modules
              (Main Dashboard → AML/CTF Compliance); Administration renders plain.
              AML/CTF sits directly after Main Dashboard, before Reports & Analysis. */}
          {groupedNavItems.map((group) => (
            <Fragment key={group.title}>
              {renderGroup(group, { administration: true })}
              {group.title === 'Main Dashboard' && amlGroupedItems
                ? renderGroup(amlGroupedItems, { administration: true })
                : null}
            </Fragment>
          ))}

          {/* Fallback: if Main Dashboard is hidden/filtered out, still show AML. */}
          {amlGroupedItems &&
            !groupedNavItems.some((group) => group.title === 'Main Dashboard') &&
            renderGroup(amlGroupedItems, { administration: true })}


          {groupedAdminItems.items.length > 0 && (
            <div className="dashboard-sidebar-admin-divider">
              {renderGroup(groupedAdminItems)}
            </div>

          )}
        </nav>
      </SidebarContent>
    </Sidebar>
  );
}
