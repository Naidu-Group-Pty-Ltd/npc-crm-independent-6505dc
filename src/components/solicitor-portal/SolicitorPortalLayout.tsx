import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Bell, Briefcase, KanbanSquare, LayoutDashboard, ListChecks, LogOut,
  Menu, MessageSquare, Scale, Settings as SettingsIcon, Shield, ShieldCheck, X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { BrandLockup, BrandLogo } from '@/components/branding/BrandAssets';
import { useWhiteLabel } from '@/contexts/WhiteLabelContext';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';
import { smartCapitalize } from '@/lib/nameUtils';
import { cn } from '@/lib/utils';
import { SolicitorNotificationBell } from './SolicitorNotificationBell';
import { SolicitorOnboardingTour } from './SolicitorOnboardingTour';
import { SolicitorRealtimeBridge } from './SolicitorRealtimeBridge';
import { usePartnerWorkspaceEnabled } from '@/lib/aml/usePartnerWorkspaceFlags';

const NAV_ITEMS = [
  { to: '/solicitor', label: 'Dashboard', icon: LayoutDashboard, end: true, tourId: 'dashboard' },
  // Second, directly under the Dashboard — see FinancePortalLayout for why.
  //
  // Feature-flagged (aml_partner_compliance_workspace + solicitor surface
  // flag); filtered out of the nav until enabled. Presentation gating only —
  // the server enforces the same flags on every workspace operation.
  { to: '/solicitor/compliance', label: 'AML/CTF Compliance', icon: ShieldCheck, end: false, tourId: 'compliance', partnerWorkspace: true },
  { to: '/solicitor/matters', label: 'Matters', icon: Briefcase, end: false, tourId: 'matters' },
  { to: '/solicitor/pipeline', label: 'Pipeline', icon: KanbanSquare, end: false, tourId: 'pipeline' },
  { to: '/solicitor/messages', label: 'Messages', icon: MessageSquare, end: false, tourId: 'messages' },
  { to: '/solicitor/tasks', label: 'Tasks', icon: ListChecks, end: false, tourId: 'tasks' },
  { to: '/solicitor/notifications', label: 'Notifications', icon: Bell, end: false, tourId: 'notifications' },
  { to: '/solicitor/settings', label: 'Settings', icon: SettingsIcon, end: false, tourId: 'settings' },
];

function getInitials(name?: string | null, email?: string | null): string {
  const source = name || email || 'S';
  return source
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { enabled: partnerWorkspaceEnabled } = usePartnerWorkspaceEnabled('solicitor');
  return (
    <nav aria-label="Solicitor portal" className="space-y-1 px-3">
      {NAV_ITEMS.filter((item) => !('partnerWorkspace' in item) || partnerWorkspaceEnabled)
        .map(({ to, label, icon: Icon, end, tourId }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          data-tour={tourId}
          className={({ isActive }) => cn(
            'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 focus-visible:ring-ring/80',
            isActive
              ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
              : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
          )}
        >
          <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

/** One authenticated layout owns portal chrome, session transport and realtime. */
export function SolicitorPortalLayout() {
  const { user, signOut } = useSolicitorPortalAuth();
  const { settings } = useWhiteLabel();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  const displayName = smartCapitalize(user?.name) || 'Solicitor';
  const initials = getInitials(displayName, user?.email);

  // Portal-specific document title / meta, driven by dynamic branding.
  useEffect(() => {
    const company = (settings.companyName || '').trim() || 'Dashboard';
    const portalTitle = `${company} — Solicitor Portal`;
    const portalDesc = `Secure solicitor portal for ${company} — manage conveyancing matters, critical dates and settlement coordination.`;

    document.title = portalTitle;

    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', portalDesc);

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', portalTitle);

    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute('content', portalDesc);

    const twitterTitle = document.querySelector('meta[name="twitter:title"]');
    if (twitterTitle) twitterTitle.setAttribute('content', portalTitle);

    return () => {
      if (settings.companyName) {
        document.title = `${settings.companyName} Dashboard`;
      }
    };
  }, [settings.companyName]);

  // Close the mobile drawer on route change so navigation never leaves it open.
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/solicitor/login', { replace: true });
  };

  return (
    <div className="solicitor-portal-theme flex min-h-screen flex-col">
      <SolicitorRealtimeBridge />
      <SolicitorOnboardingTour />

      <a
        href="#main-content"
        className="sr-only rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70]"
      >
        Skip to main content
      </a>

      <div className="flex flex-1">
        {/* ── Desktop sidebar ── */}
        <aside className="solicitor-portal-sidebar hidden w-72 flex-col border-r md:flex">
          <div className="flex items-center justify-between gap-3 p-6 pb-4">
            <Link to="/solicitor" className="min-w-0 flex-1 rounded-xl focus-visible:outline-none">
              <BrandLockup
                slot="auth"
                meta="Solicitor Portal"
                logoClassName="h-10 max-w-[160px] object-contain"
                fallbackClassName="h-10 w-10"
                companyClassName="text-base font-bold tracking-tight truncate"
                metaClassName="tracking-widest truncate"
              />
            </Link>
            <div className="shrink-0">
              <SolicitorNotificationBell />
            </div>
          </div>
          <Separator />

          {/* Practitioner card */}
          <div className="px-4 py-4">
            <div className="flex items-center gap-3 rounded-2xl border border-primary/15 bg-gradient-to-r from-primary/10 via-primary/5 to-card/90 p-3 shadow-lg shadow-primary/5">
              <Avatar className="h-10 w-10 border-2 border-primary/20">
                <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                <p className="truncate text-xs text-muted-foreground">{user?.firm_name || user?.email}</p>
              </div>
            </div>
          </div>

          <ScrollArea className="flex-1 py-2">
            <SidebarNav />
          </ScrollArea>

          <Separator />
          <div className="p-4">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start rounded-xl py-2.5 text-muted-foreground hover:bg-destructive/5 hover:text-destructive"
              onClick={() => void handleSignOut()}
            >
              <LogOut className="mr-3 h-4 w-4" aria-hidden />
              Sign Out
            </Button>
            <div className="mt-3 flex items-center gap-1.5 px-3 text-[10px] text-muted-foreground/50">
              <Shield className="h-3 w-3" aria-hidden />
              <span>Secured Portal • Privileged &amp; encrypted</span>
            </div>
          </div>
        </aside>

        {/* ── Main column ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="solicitor-portal-topbar sticky top-0 z-30 border-b">
            <div className="flex h-14 items-center gap-3 px-4 md:px-6">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 md:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation menu"
                aria-expanded={mobileOpen}
              >
                <Menu className="h-5 w-5" aria-hidden />
              </Button>

              <Link to="/solicitor" className="flex items-center gap-2 md:hidden">
                <BrandLogo slot="sidebar-icon" className="h-7 w-7 object-contain" fallbackClassName="h-7 w-7" />
                <span className="truncate text-sm font-bold text-foreground">Solicitor Portal</span>
              </Link>

              {location.pathname !== '/solicitor' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-1.5 rounded-full text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                  onClick={() => navigate('/solicitor')}
                  aria-label="Back to Solicitor Portal dashboard"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  <span className="hidden text-xs font-medium sm:inline">Back to dashboard</span>
                </Button>
              )}

              <div className="ml-auto flex items-center gap-2">
                <div className="hidden md:block">
                  <SolicitorNotificationBell />
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-9 gap-2 px-2">
                      <Avatar className="h-8 w-8 border border-primary/20">
                        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <span className="hidden text-sm font-medium sm:inline">{displayName}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{displayName}</span>
                        <span className="text-xs text-muted-foreground">{user?.email}</span>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate('/solicitor/settings')}>
                      <SettingsIcon className="mr-2 h-4 w-4" aria-hidden /> Settings
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate('/solicitor/settings/security')}>
                      <ShieldCheck className="mr-2 h-4 w-4" aria-hidden /> Session security
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent('solicitor:start-tour'))}>
                      <Scale className="mr-2 h-4 w-4" aria-hidden /> Replay portal tour
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => void handleSignOut()} className="text-destructive">
                      <LogOut className="mr-2 h-4 w-4" aria-hidden /> Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          <main id="main-content" className="solicitor-portal-main flex-1 overflow-auto">
            <div className="solicitor-portal-content">
              <AnimatePresence mode="wait">
                <motion.div
                  key={location.pathname}
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.2 }}
                >
                  <Outlet />
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
      </div>

      {/* ── Mobile drawer ── */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.2 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Solicitor portal navigation"
              className="solicitor-portal-sidebar fixed inset-y-0 left-0 z-50 flex w-72 touch-pan-y flex-col border-r md:hidden"
              initial={reduceMotion ? false : { x: '-100%' }}
              animate={{ x: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { x: '-100%' }}
              transition={reduceMotion ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 300 }}
              drag={reduceMotion ? false : 'x'}
              dragConstraints={{ left: -288, right: 0 }}
              dragElastic={0.1}
              onDragEnd={(_event, info) => {
                if (info.offset.x < -80 || info.velocity.x < -300) setMobileOpen(false);
              }}
            >
              <div className="flex items-center justify-between gap-3 border-b border-border/70 p-4">
                <BrandLockup
                  slot="sidebar-icon"
                  meta="Solicitor Portal"
                  logoClassName="h-9 w-9 object-contain"
                  fallbackClassName="h-9 w-9"
                  companyClassName="text-sm font-bold tracking-tight truncate"
                  metaClassName="tracking-widest truncate"
                />
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMobileOpen(false)} aria-label="Close navigation menu">
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>

              <div className="px-3 py-3">
                <div className="flex items-center gap-3 rounded-2xl border border-primary/15 bg-gradient-to-r from-primary/10 via-primary/5 to-card/90 p-3 shadow-lg shadow-primary/5">
                  <Avatar className="h-9 w-9 border border-primary/20">
                    <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                    <p className="truncate text-xs text-muted-foreground">{user?.firm_name || user?.email}</p>
                  </div>
                </div>
              </div>

              <ScrollArea className="flex-1 py-1">
                <SidebarNav onNavigate={() => setMobileOpen(false)} />
              </ScrollArea>

              <Separator />
              <div className="p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start rounded-xl py-2.5 text-muted-foreground hover:text-destructive"
                  onClick={() => void handleSignOut()}
                >
                  <LogOut className="mr-3 h-4 w-4" aria-hidden />
                  Sign Out
                </Button>
                <div className="mt-2 flex items-center gap-1.5 px-3 text-[10px] text-muted-foreground/50">
                  <Shield className="h-3 w-3" aria-hidden />
                  <span>Secured Portal • Privileged &amp; encrypted</span>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
