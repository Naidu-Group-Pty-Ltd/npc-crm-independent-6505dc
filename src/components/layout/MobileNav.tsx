import { useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Home, Building2, BarChart3, FileText, MoreHorizontal, UserCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { MobileSidebar } from './MobileSidebar';
import { useNavigationVisibility } from '@/hooks/useNavigation';

// Candidates for the bottom bar; each is gated by the same capability rule
// as the sidebars via its moduleKey, so e.g. Marketplace disappears for a
// workspace without the Property Marketplace entitlement.
const mobileNavCandidates = [
  { title: 'Overview', url: '/', icon: Home, moduleKey: 'overview' },
  { title: 'Marketplace', url: '/listings', icon: Building2, moduleKey: 'listings' },
  { title: 'Clients', url: '/clients', icon: UserCircle, moduleKey: 'clients' },
  { title: 'Reports', url: '/reports', icon: BarChart3, moduleKey: 'reports' },
  { title: 'Generated', url: '/generated-reports', icon: FileText, moduleKey: 'generated_reports' },
];

export function MobileNav() {
  const location = useLocation();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { isNavItemVisible } = useNavigationVisibility();

  const mobileNavItems = useMemo(
    () =>
      mobileNavCandidates.filter((item) =>
        isNavItemVisible({ ...item, group: 'Main Dashboard' }),
      ),
    [isNavItemVisible],
  );

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const isMoreActive = !mobileNavItems.some(item => isActive(item.url));

  // `data-mobile-nav` lets a full-bleed surface measure how much of the
  // viewport bottom this covers; see useFillViewportHeight.
  return (
    <div data-mobile-nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden">
      {/* Toggle pill - always visible */}
      <div className="flex justify-center">
        <button
          onClick={() => setIsCollapsed(prev => !prev)}
            className={cn(
              'dashboard-mobile-nav-toggle flex items-center justify-center rounded-t-xl',
              'h-5 w-10 rounded-t-xl border border-b-0 border-b-transparent',
              'hover:text-foreground transition-all duration-300 ease-out active:scale-95'
            )}
          aria-label={isCollapsed ? 'Show navigation' : 'Hide navigation'}
        >
          {isCollapsed ? (
            <ChevronUp className="h-3.5 w-3.5 animate-[pulse_2s_ease-in-out_infinite]" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Nav bar */}
      <nav
          className={cn(
            'dashboard-mobile-nav safe-area-bottom overflow-hidden border-t transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            isCollapsed ? 'max-h-0 border-t-0' : 'max-h-20'
          )}
      >
        <div className="flex h-16 items-center justify-around gap-1 px-2">
          {mobileNavItems.map((item) => (
            <NavLink
              key={item.url}
              to={item.url}
              className={cn(
                'dashboard-mobile-nav-item mx-0.5 relative active:scale-90',
                isActive(item.url)
                  ? 'dashboard-mobile-nav-item-active'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <div className={cn(
                'relative rounded-xl p-1.5 transition-all duration-200',
                isActive(item.url) && 'dashboard-chip-accent'
              )}>
                <item.icon className={cn(
                  'h-5 w-5 transition-transform duration-200',
                  isActive(item.url) && 'scale-110'
                )} />
              </div>
              <span className={cn(
                'mt-0.5 max-w-[60px] truncate text-[10px] font-medium',
                isActive(item.url) && 'font-semibold'
              )}>
                {item.title}
              </span>
              {isActive(item.url) && (
                <div className="dashboard-nav-indicator absolute bottom-1.5 h-1 w-1 rounded-full" />
              )}
            </NavLink>
          ))}

          {/* More Menu */}
          <Sheet open={isMoreOpen} onOpenChange={setIsMoreOpen}>
            <SheetTrigger asChild>
              <button
                className={cn(
                  'dashboard-mobile-nav-item mx-0.5 relative active:scale-90',
                  isMoreActive
                    ? 'dashboard-mobile-nav-item-active'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <div className={cn(
                  'relative rounded-xl p-1.5 transition-all duration-200',
                  isMoreActive && 'dashboard-chip-accent'
                )}>
                  <MoreHorizontal className={cn(
                    'h-5 w-5 transition-transform duration-200',
                    isMoreActive && 'scale-110'
                  )} />
                </div>
                <span className={cn(
                  'mt-0.5 text-[10px] font-medium',
                  isMoreActive && 'font-semibold'
                )}>
                  More
                </span>
                {isMoreActive && (
                  <div className="dashboard-nav-indicator absolute bottom-1.5 h-1 w-1 rounded-full" />
                )}
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="dashboard-mobile-sheet w-[280px] p-0" hideClose>
              <MobileSidebar onNavigate={() => setIsMoreOpen(false)} />
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </div>
  );
}
