import React from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { ClientFacingOutlet } from '@/components/auth/ClientFacingGate';
import { DashboardSidebar } from './DashboardSidebar';
import { DashboardHeader } from './DashboardHeader';
import { MobileHeader } from './MobileHeader';
import { MobileNav } from './MobileNav';
import { useBreakpoint } from '@/hooks/use-breakpoint';
import { AgentChatWidget } from '@/components/agent/AgentChatWidget';
import { InternalMessageToasts } from '@/components/agent/InternalMessageToasts';

import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useDashboardTheme } from '@/hooks/useDashboardTheme';
import { DashboardPageShell } from './DashboardPageShell';
import { TokenBalanceBanner } from '@/components/billing/TokenBalanceBanner';
import { PaymentGateOutlet } from '@/components/billing/PaymentGateOutlet';
import { AnnouncementHost } from '@/components/announcements/AnnouncementHost';
import { PaymentGateBanner } from '@/components/billing/PaymentGateScreen';
import { PlanChangeBanner } from '@/components/billing/PlanChangeBanner';
import { FeedbackPromptBanner } from '@/components/billing/FeedbackPromptBanner';
import { GlobalCommandPalette } from './GlobalCommandPalette';

export function DashboardLayout() {
  const breakpoint = useBreakpoint();
  const { theme, isDark, cycleTheme } = useDashboardTheme();

  // Mobile + Tablet share the same chrome (top bar + bottom nav).
  // Desktop sidebar shell only mounts at >= 1024px.
  if (breakpoint !== 'desktop') {
    return (
      <PaymentGateOutlet>
      <div className="dashboard-shell flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden">
        <MobileHeader
          theme={theme}
          isDark={isDark}
          onCycleTheme={cycleTheme}
        />

        <main
          className="dashboard-main flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain [-webkit-overflow-scrolling:touch]"
        >
          <div className="dashboard-content">
            <ErrorBoundary>
              <DashboardPageShell>
                <PaymentGateBanner />
                <AnnouncementHost />
                <PlanChangeBanner />
                <FeedbackPromptBanner />
                <TokenBalanceBanner />
                <ClientFacingOutlet />
              </DashboardPageShell>
            </ErrorBoundary>
          </div>
        </main>

        <MobileNav />
        <AgentChatWidget />
        <InternalMessageToasts />
        <GlobalCommandPalette />
      </div>
      </PaymentGateOutlet>
    );
  }

  // Desktop Layout (>= 1024px)
  return (
    <PaymentGateOutlet>
    <SidebarProvider>
      <div className="dashboard-shell flex min-h-svh w-full">
        <DashboardSidebar />

        <div className="dashboard-main flex flex-1 flex-col min-w-0">
          <DashboardHeader
            theme={theme}
            isDark={isDark}
            onCycleTheme={cycleTheme}
          />

          <main className="dashboard-main flex-1 overflow-visible">
            <div className="dashboard-content">
              <ErrorBoundary>
                <DashboardPageShell>
                  <PaymentGateBanner />
                  <AnnouncementHost />
                  <PlanChangeBanner />
                  <FeedbackPromptBanner />
                  <TokenBalanceBanner />
                  <ClientFacingOutlet />
                </DashboardPageShell>
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
      <AgentChatWidget />
      <InternalMessageToasts />
      <GlobalCommandPalette />
    </SidebarProvider>
    </PaymentGateOutlet>
  );
}
