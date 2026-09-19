import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { useWhiteLabel } from '@/contexts/WhiteLabelContext';
import { smartCapitalize } from '@/lib/nameUtils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Building2, User, Home as HomeIcon, Briefcase,
  FileText, LogOut, Menu, X, Shield, Bell, TrendingUp,
  MessageSquare, BarChart3, CalendarDays, Landmark, ListChecks, Banknote, Scale
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { PortalOnboardingTour } from './PortalOnboardingTour';
import { PortalNotificationBell } from './PortalNotificationBell';
import { PortalNotificationProvider } from '@/contexts/PortalNotificationContext';
import { PortalImpersonationBanner } from './PortalImpersonationBanner';
import { ClientPortalPushPrompt } from './ClientPortalPushPrompt';
import { BrandLockup, BrandLogo } from '@/components/branding/BrandAssets';

const portalNavItems = [
  { to: '/client', icon: HomeIcon, label: 'Dashboard', end: true, tourId: 'dashboard' },
  // Second, directly under the Dashboard. It is the customer's half of the
  // same AML/CTF record the partner portals now lead with, and it sat at the
  // foot of a seventeen-entry sidebar. The label stays the customer's own
  // words — what they do here is prove who they are — because regulator
  // vocabulary on a customer surface is a different defect.
  { to: '/client/aml', icon: Shield, label: 'Identity & Compliance', end: true, tourId: 'aml' },
  { to: '/client/profile', icon: User, label: 'My Profile', end: true, tourId: 'profile' },
  { to: '/client/deal-progress', icon: TrendingUp, label: 'Deal Progress', end: true, tourId: 'deal-progress' },
  { to: '/client/action-items', icon: ListChecks, label: 'Action Items', end: true, tourId: 'action-items' },
  { to: '/client/finance', icon: Banknote, label: 'Finance Hub', end: true, tourId: 'finance-hub' },
  ...(import.meta.env.VITE_CLIENT_LEGAL_WORKSPACE === 'true'
    ? [{ to: '/client/legal', icon: Scale, label: 'Legal Workspace', end: false, tourId: 'legal-workspace' }]
    : []),
  { to: '/client/properties', icon: Building2, label: 'Properties', end: true, tourId: 'properties' },
  { to: '/client/property-insights', icon: BarChart3, label: 'Property Insights', end: true, tourId: 'property-insights' },
  { to: '/client/employment', icon: Briefcase, label: 'Finances', end: true, tourId: 'finances' },
  { to: '/client/documents', icon: FileText, label: 'Documents', end: true, tourId: 'documents' },
  { to: '/client/reports', icon: FileText, label: 'Reports', end: true, tourId: 'reports' },
  { to: '/client/lenders', icon: Landmark, label: 'Lenders', end: true, tourId: 'lenders' },
  { to: '/client/messages', icon: MessageSquare, label: 'Messages', end: true, tourId: 'messages' },
  { to: '/client/notifications', icon: Bell, label: 'Notifications', end: true, tourId: 'notifications' },
  { to: '/client/appointments', icon: CalendarDays, label: 'My Appointments', end: true },
  { to: '/client/booking', icon: CalendarDays, label: 'Book Appointment', end: true },
];

function getInitials(name?: string): string {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

export function PortalLayout() {
  const { user, signOut } = usePortalAuth();
  const { settings } = useWhiteLabel();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const displayName = smartCapitalize(user?.name);

  // Set portal-specific document title and meta tags from dynamic branding
  useEffect(() => {
    const company = (settings.companyName || '').trim() || 'Dashboard';
    const portalTitle = `${company} — Client Portal`;
    const portalDesc = `Secure client portal for ${company} — access your property investments, documents, and deal progress.`;

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
      // Restore default title when leaving portal
      if (settings.companyName) {
        document.title = `${settings.companyName} Dashboard`;
      }
    };
  }, [settings.companyName]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/client/login', { replace: true });
  };

  return (
    <PortalNotificationProvider>
    <div className="client-portal-theme flex min-h-[100dvh] md:min-h-screen">
      {/* Sidebar - Desktop */}
      <aside className="client-portal-sidebar hidden w-72 flex-col border-r md:flex">
        {/* Logo Area */}
        <div className="flex items-center justify-between gap-3 p-6 pb-4">
          <div className="min-w-0 flex-1">
            <BrandLockup
              slot="auth"
              meta="Secure Access"
              logoClassName="h-10 max-w-[160px] object-contain"
              fallbackClassName="h-10 w-10"
              companyClassName="text-base font-bold tracking-tight truncate"
              metaClassName="tracking-widest truncate"
            />
          </div>
          <div className="shrink-0">
            <PortalNotificationBell />
          </div>
        </div>
        <Separator />

        {/* User Profile Card */}
        <div className="px-4 py-4">
          <div className="flex items-center gap-3 rounded-2xl border border-primary/15 bg-gradient-to-r from-primary/10 via-primary/5 to-card/90 p-3 shadow-lg shadow-primary/5">
            <Avatar className="h-10 w-10 border-2 border-primary/20">
              <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
                {getInitials(displayName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm text-foreground truncate">{displayName || 'Client'}</p>
              <p className="text-muted-foreground truncate text-xs">{user?.email}</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 py-2">
          <nav className="space-y-1 px-3">
            {portalNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                data-tour={item.tourId}
                className={({ isActive }) => cn(
                  'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 focus-visible:ring-ring/80',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                    : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
                )}
              >
                <item.icon className="h-[18px] w-[18px]" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </ScrollArea>

        {/* Footer */}
        <Separator />
        <div className="p-4">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/5 rounded-xl py-2.5"
            onClick={handleSignOut}
          >
            <LogOut className="h-4 w-4 mr-3" />
            Sign Out
          </Button>
          <div className="mt-3 flex items-center gap-1.5 px-3 text-[10px] text-muted-foreground/50">
            <Shield className="h-3 w-3" />
            <span>Secured Portal • End-to-end encrypted</span>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="client-portal-topbar fixed left-0 right-0 top-0 z-50 flex items-center justify-between border-b px-4 py-3 md:hidden">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <BrandLogo slot="sidebar-icon" className="h-8 w-8 shrink-0 object-contain" fallbackClassName="h-8 w-8 shrink-0" />
          <span className="font-bold text-foreground truncate">{settings.companyName}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PortalNotificationBell />
          <Avatar className="h-8 w-8 border border-primary/20">
            <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(!mobileOpen)} className="h-9 w-9">
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Nav Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute left-0 right-0 top-14 max-h-[calc(100dvh-3.5rem)] animate-in slide-in-from-top-2 overflow-y-auto overscroll-y-contain touch-pan-y rounded-b-3xl border-b border-border/70 bg-card/95 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl shadow-primary/10 backdrop-blur-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-3 rounded-2xl border border-primary/15 bg-gradient-to-r from-primary/10 via-primary/5 to-card/90 p-3 shadow-lg shadow-primary/5">
              <Avatar className="h-9 w-9 border border-primary/20">
                <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
                  {getInitials(displayName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-semibold text-sm text-foreground truncate">{displayName}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>
            </div>
            <nav className="space-y-1">
              {portalNavItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) => cn(
                     'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all focus-visible:ring-ring/80',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
                  )}
                >
                  <item.icon className="h-[18px] w-[18px]" />
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <Separator className="my-3" />
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground hover:text-destructive rounded-xl py-2.5"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4 mr-3" />
              Sign Out
            </Button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="client-portal-main min-w-0 flex-1 overflow-visible pt-14 md:overflow-auto md:pt-0">
        <PortalImpersonationBanner />
        <div className="client-portal-content">
          <Outlet />
        </div>
      </main>

      {/* Onboarding Tour */}
      <PortalOnboardingTour />
      <ClientPortalPushPrompt />
    </div>
    </PortalNotificationProvider>
  );
}
