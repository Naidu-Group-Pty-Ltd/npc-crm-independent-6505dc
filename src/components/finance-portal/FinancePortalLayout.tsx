import { ReactNode, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Button } from '@/components/ui/button';
import {
  Building2, LayoutDashboard, Users, LogOut, Menu, MessageSquare, Wallet, X, Shield, ShieldCheck, Briefcase, BookOpen, BarChart3, Settings as SettingsIcon, Inbox, Layers, Trophy, ArrowLeft,
  ArrowLeftRight,
} from 'lucide-react';

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FinancePortalNotificationBell } from './FinancePortalNotificationBell';
import { FinanceCommandPalette } from './FinanceCommandPalette';
import { QuickAddFab } from './QuickAddFab';
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';
import { FinanceOnboardingTour } from './FinanceOnboardingTour';
import { bootFinanceAppearance, clearFinanceAppearance } from '@/lib/finance-portal/theme';
import { cn } from '@/lib/utils';
import { usePartnerWorkspaceEnabled } from '@/lib/aml/usePartnerWorkspaceFlags';
import { motion, AnimatePresence } from 'framer-motion';

const NAV_ITEMS = [
  { to: '/finance', label: 'Dashboard', icon: LayoutDashboard, end: true, tour: 'dashboard' },
  // Second, directly under the Dashboard. A partner opens this page from an
  // email about a live purchase and has to find it again afterwards; at the
  // foot of a twelve-entry sidebar it read as an afterthought rather than as
  // the compliance record a purchase now depends on.
  //
  // Feature-flagged (aml_partner_compliance_workspace + finance surface
  // flag); filtered out of the nav until enabled. Presentation gating only —
  // the server enforces the same flags on every workspace operation.
  { to: '/finance/compliance', label: 'AML/CTF Compliance', icon: ShieldCheck, end: false, partnerWorkspace: true },
  { to: '/finance/purchase-files', label: 'Active Purchase Files', icon: Briefcase, end: false, tour: 'purchase-files' },
  { to: '/finance/pipeline', label: 'Pipeline Kanban', icon: Layers, end: false, tour: 'pipeline' },
  { to: '/finance/clients', label: 'My Clients', icon: Users, end: false, tour: 'clients' },
  { to: '/finance/messages', label: 'Messages', icon: MessageSquare, end: false, tour: 'messages' },
  { to: '/finance/client-inbox', label: 'Client Inbox', icon: Inbox, end: false, tour: 'client-inbox' },
  { to: '/finance/referrals', label: 'Referrals', icon: ArrowLeftRight, end: false, tour: 'referrals' },
  { to: '/finance/lender-intelligence', label: 'Lender Intelligence', icon: BookOpen, end: false, tour: 'lender-intelligence' },
  { to: '/finance/insights', label: 'Pipeline Insights', icon: Trophy, end: false, tour: 'insights' },
  { to: '/finance/reports', label: 'Reports & KPIs', icon: BarChart3, end: false },
  { to: '/finance/earnings', label: 'Earnings', icon: Wallet, end: false },
];


function getInitials(name?: string | null, email?: string | null): string {
  const source = name || email || 'F';
  return source
    .split(' ')
    .map(s => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { enabled: partnerWorkspaceEnabled } = usePartnerWorkspaceEnabled('finance');
  return (
    <nav className="flex flex-col gap-1 px-3">
      {NAV_ITEMS.filter(item => !('partnerWorkspace' in item) || partnerWorkspaceEnabled).map(item => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            data-tour={item.tour}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/10'
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

export function FinancePortalLayout({ children }: { children?: ReactNode }) {
  const { user, signOut } = useFinancePortalAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);


  // Batch 13 #66 — boot theme/density from cached prefs on mount.
  // The palette lives on <html>, so it is global state and has to be torn
  // down on unmount: without the cleanup it follows the user out of the
  // portal and the Command Centre inherits finance dark surfaces while its
  // own light-mode rules still apply. The preference itself is kept in
  // localStorage and restored on the next visit.
  useEffect(() => {
    bootFinanceAppearance();
    return () => { clearFinanceAppearance(); };
  }, []);

  const handleLogout = async () => {
    await signOut();
    navigate('/finance/login', { replace: true });
  };

  const initials = getInitials(user?.name, user?.email);

  return (
    <div className="finance-portal-theme flex min-h-screen flex-col">
      {/*
        Terms and onboarding are NOT here. They are routes the guard reaches
        before this layout mounts (`FinancePortalProtectedRoute`), which is what
        keeps the welcome tour below from opening on top of an agreement the
        partner has not read.
      */}
      <FinanceCommandPalette />
      <KeyboardShortcutsDialog />
      <QuickAddFab />
      <FinanceOnboardingTour />



      {/* ── Desktop Layout ── */}
      <div className="flex-1 flex">
        {/* Sidebar */}
        <aside className="finance-portal-sidebar hidden md:flex md:w-64 flex-col border-r">
          {/* Branded Header */}
          <div className="p-5 pb-4">
            <Link to="/finance" className="flex items-center gap-3">
              <div className="relative flex items-center justify-center h-10 w-10 rounded-xl bg-primary/10 border border-primary/20">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div className="leading-tight">
                <div className="text-sm font-bold text-foreground tracking-tight">Finance Portal</div>
                <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">Partner Access</div>
              </div>
            </Link>
          </div>

          {/* Gold accent stripe */}
          <div className="mx-4 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

          {/* User card */}
          <div className="px-3 py-4">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/10">
              <Avatar className="h-9 w-9 border-2 border-primary/20">
                <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-foreground truncate">{user?.name || 'Partner'}</p>
                <p className="text-muted-foreground truncate text-[11px]">{user?.company || user?.email}</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <ScrollArea className="flex-1 py-1">
            <SidebarNav />
          </ScrollArea>

          {/* Footer */}
          <div className="mx-4 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
          <div className="p-3">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/5 rounded-xl py-2.5"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4 mr-3" />
              Sign Out
            </Button>
            <div className="mt-2 flex items-center gap-1.5 px-3 text-[10px] text-muted-foreground/40">
              <Shield className="h-3 w-3" />
              <span>Secured · End-to-end encrypted</span>
            </div>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <header className="finance-portal-topbar sticky top-0 z-30 border-b">
            <div className="flex h-14 items-center gap-3 px-4 md:px-6">
              {/* Mobile hamburger */}
              <Button variant="ghost" size="icon" className="md:hidden h-9 w-9" onClick={() => setMobileOpen(true)}>
                <Menu className="h-5 w-5" />
              </Button>

              {/* Mobile logo */}
              <Link to="/finance" className="flex md:hidden items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                <span className="font-bold text-sm">Finance Portal</span>
              </Link>

              {/* Back-to-dashboard on every deep route (all viewports) */}
              {location.pathname !== '/finance' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/10"
                  onClick={() => navigate('/finance')}
                  aria-label="Back to Finance Portal dashboard"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="hidden sm:inline text-xs font-medium">Back to dashboard</span>
                </Button>
              )}

              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden md:inline-flex h-9 gap-2 text-muted-foreground"
                  onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
                  title="Search (⌘K)"
                >
                  <span className="text-xs">Search…</span>
                  <kbd className="hidden lg:inline-flex pointer-events-none h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">⌘K</kbd>
                </Button>
                <FinancePortalNotificationBell />

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="gap-2 h-9 px-2">
                      <Avatar className="h-8 w-8 border border-primary/20">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <span className="hidden sm:inline text-sm font-medium">{user?.name || user?.email}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{user?.name}</span>
                        <span className="text-xs text-muted-foreground">{user?.email}</span>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate('/finance/settings')}>
                      <SettingsIcon className="h-4 w-4 mr-2" /> Settings
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                      <LogOut className="h-4 w-4 mr-2" />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          <main className="finance-portal-main flex-1 overflow-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {children ?? <Outlet />}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>

      {/* ── Mobile Drawer ── */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              className="glass-scrim md:hidden fixed inset-0 z-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setMobileOpen(false)}
            />
            {/* Drawer panel with swipe-to-close */}
            <motion.div
              className="finance-portal-sidebar md:hidden fixed inset-y-0 left-0 z-50 w-72 border-r flex flex-col touch-pan-y"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              drag="x"
              dragConstraints={{ left: -288, right: 0 }}
              dragElastic={0.1}
              onDragEnd={(_e, info) => {
                if (info.offset.x < -80 || info.velocity.x < -300) {
                  setMobileOpen(false);
                }
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-primary/10 border border-primary/20">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <span className="font-bold text-sm">Finance Portal</span>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMobileOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Gold stripe */}
              <div className="mx-4 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

              {/* User card */}
              <div className="px-3 py-3">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/10">
                  <Avatar className="h-9 w-9 border border-primary/20">
                    <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{user?.name || 'Partner'}</p>
                    <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                  </div>
                </div>
              </div>

              {/* Nav */}
              <ScrollArea className="flex-1 py-1">
                <SidebarNav onNavigate={() => setMobileOpen(false)} />
              </ScrollArea>

              {/* Footer */}
              <div className="mx-4 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
              <div className="p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-muted-foreground hover:text-destructive rounded-xl py-2.5"
                  onClick={handleLogout}
                >
                  <LogOut className="h-4 w-4 mr-3" />
                  Sign Out
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
