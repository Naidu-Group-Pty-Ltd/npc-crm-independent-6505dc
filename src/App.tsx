// App configuration - updated Mar 9, 2026
import { Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { SearchProvider } from "@/contexts/SearchContext";
import { NotificationsProvider } from "@/contexts/NotificationsContext";
import { ComparisonProvider } from "@/contexts/ComparisonContext";
import { BrandProvider } from "@/branding/BrandProvider";
import { useBuildVersionCheck } from "@/hooks/useBuildVersionCheck";
import { AuthProvider } from "@/hooks/useAuth";
import { PermissionsProvider } from "@/hooks/usePermissions";
import { WorkspaceEntitlementsProvider } from "@/hooks/useWorkspaceEntitlements";
import { PaymentGateProvider } from "@/hooks/usePaymentGate";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

import { ModuleGuard } from "@/components/auth/ModuleGuard";
import { InternalToolingGuard } from '@/components/auth/InternalToolingGuard';
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { BackgroundJobTracker } from "./components/BackgroundJobTracker";
import { ReportGenerationProgress } from "./components/reports/ReportGenerationProgress";
import { CallNotificationListener } from "./components/CallNotificationListener";
import { Phase1NotificationListeners } from "./components/Phase1NotificationListeners";
import { TokenEventsListener } from "@/components/billing/TokenEventsListener";
import { PricingMockBanner } from "@/components/billing/PricingMockBanner";
import { PushNotificationPrompt } from "./components/PushNotificationPrompt";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { PublicLinkErrorFallback } from "@/components/portal/PublicLinkErrorFallback";
import { DashboardErrorFallback } from "@/components/layout/DashboardErrorFallback";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { HarveyCountdown } from "@/components/HarveyCountdown";
import { Button } from "@/components/ui/button";
const Overview = lazyWithRetry(() => import("./pages/Overview"));
const Listings = lazyWithRetry(() => import("./pages/Listings"));
const ListingDetail = lazyWithRetry(() => import("./pages/ListingDetail"));
const Calendar = lazyWithRetry(() => import("./pages/Calendar"));
const MarketUpdates = lazyWithRetry(() => import("./pages/MarketUpdates"));
import { MarketArchivePage } from "./components/market-updates/MarketArchivePage";
const Sources = lazyWithRetry(() => import("./pages/Sources"));
const Reports = lazyWithRetry(() => import("./pages/Reports"));
const QuantitativeReports = lazyWithRetry(() => import("./pages/QuantitativeReports"));
const Charts = lazyWithRetry(() => import("./pages/Charts"));
const GeneratedReports = lazyWithRetry(() => import("./pages/GeneratedReports"));
const ReportViewer = lazyWithRetry(() => import("./pages/ReportViewer"));
const Settings = lazyWithRetry(() => import("./pages/Settings"));
const UserGuide = lazyWithRetry(() => import("./pages/UserGuide"));
const Feedback = lazyWithRetry(() => import("./pages/Feedback"));
const Support = lazyWithRetry(() => import("./pages/Support"));
import DataImport from './pages/DataImport';
import Monitoring from './pages/Monitoring';
import QualityAssurance from './pages/QualityAssurance';
import ErrorLogs from './pages/ErrorLogs';
import Automation from './pages/Automation';
import EmailCopilot from './pages/EmailCopilot';
import CallLogs from './pages/CallLogs';
import Conversations from './pages/Conversations';
import Messages from './pages/Messages';
import Lenders from './pages/Lenders';
import CashFlowAnalysis from './pages/CashFlowAnalysis';
import CashFlowAnalysisDetail from './pages/CashFlowAnalysisDetail';
import ReportQA from './pages/ReportQA';
import SharedQAAnswer from './pages/SharedQAAnswer';
import InvestmentReportView from './pages/InvestmentReportView';
import Templates from './pages/Templates';
import WhiteLabel from './pages/WhiteLabel';
const Auth = lazyWithRetry(() => import("./pages/Auth"));
const AcceptInvite = lazyWithRetry(() => import("./pages/AcceptInvite"));
const UserManagement = lazyWithRetry(() => import("./pages/admin/UserManagement"));
const GhlMigration = lazyWithRetry(() => import("./pages/admin/GhlMigration"));
const FinancePortalAdmin = lazyWithRetry(() => import("./pages/admin/FinancePortalAdmin"));
const SolicitorPortalAdmin = lazyWithRetry(() => import("./pages/admin/SolicitorPortalAdmin"));
const FinancePortalAnalytics = lazyWithRetry(() => import("./pages/admin/FinancePortalAnalytics"));
const FinancePortalBulkImport = lazyWithRetry(() => import("./pages/admin/FinancePortalBulkImport"));
const FinancePortalCompliance = lazyWithRetry(() => import("./pages/admin/FinancePortalCompliance"));
const FinancePortalHealth = lazyWithRetry(() => import("./pages/admin/FinancePortalHealth"));
const FinancePortalCommissions = lazyWithRetry(() => import("./pages/admin/FinancePortalCommissions"));
const ActivityLogs = lazyWithRetry(() => import("./pages/ActivityLogs"));
import { DepreciationCompsAdmin } from "./components/admin/DepreciationCompsAdmin";
const TemplateBuilder = lazyWithRetry(() => import("./pages/admin/TemplateBuilder"));
const TemplateBuilderEdit = lazyWithRetry(() => import("./pages/admin/TemplateBuilderEdit"));
const TemplateConverter = lazyWithRetry(() => import("./pages/admin/TemplateConverter"));
const BrandSystems = lazyWithRetry(() => import("./pages/admin/BrandSystems"));
const TemplateSharePreview = lazyWithRetry(() => import("./pages/TemplateSharePreview"));
const ReportEngineInspector = lazyWithRetry(() => import("./pages/admin/ReportEngineInspector"));
const FigmaTemplates = lazyWithRetry(() => import("./pages/admin/FigmaTemplates"));
const PdfImportEngineAdmin = lazyWithRetry(() => import("./pages/admin/PdfImportEngineAdmin"));
const BcSegmentEngineAdmin = lazyWithRetry(() => import("./pages/admin/BcSegmentEngineAdmin"));
const AmlV3Cutover = lazyWithRetry(() => import("./pages/admin/AmlV3Cutover"));
const AmlIntegrationHealth = lazyWithRetry(() => import("./pages/admin/AmlIntegrationHealth"));
const PdfImportDiagnostics = lazyWithRetry(() => import("./pages/admin/PdfImportDiagnostics"));
const PdfImportMonitoring = lazyWithRetry(() => import("./pages/admin/PdfImportMonitoring"));
const PdfImportRetention = lazyWithRetry(() => import("./pages/admin/PdfImportRetention"));
const PdfImportClientReports = lazyWithRetry(() => import("./pages/admin/PdfImportClientReports"));
const TemplateImportQuality = lazyWithRetry(() => import("./pages/admin/TemplateImportQuality"));
const PdfGoldenRegression = lazyWithRetry(() => import("./pages/admin/PdfGoldenRegression"));
const MarketQAQuality = lazyWithRetry(() => import("./pages/admin/MarketQAQuality"));
const ReclassifyPropertyAdmin = lazyWithRetry(() => import("./pages/admin/ReclassifyPropertyAdmin"));
const AgentQuality = lazyWithRetry(() => import("./pages/admin/AgentQuality"));
const AmlCases = lazyWithRetry(() => import("./pages/aml/AmlCases"));
const AmlCaseWorkspace = lazyWithRetry(() => import("./pages/aml/AmlCaseWorkspace"));
const AmlOverview = lazyWithRetry(() => import("./pages/aml/AmlOverview"));
const AmlPassports = lazyWithRetry(() => import("./pages/aml/AmlPassports"));
import {
  AmlVerification, AmlScreening, AmlRisk, AmlCounterparty,
  AmlFinance, AmlTransactions,
  AmlMonitoring, AmlInvestigations, AmlAustracReporting, AmlAustracReportDraft,
  AmlRecords, AmlGovernance, AmlConfiguration,
} from "./pages/aml/AmlShellPages";
const AmlLaunchOps = lazyWithRetry(() => import("./pages/aml/AmlLaunchOps"));
const AmlPartnerOperations = lazyWithRetry(() => import("./pages/aml/AmlPartnerOperations"));
import { AmlLayout } from "@/components/aml/AmlLayout";
import { AmlGuard } from "@/components/aml/AmlGuard";
const AgentMemoryManager = lazyWithRetry(() => import("./pages/agent/MemoryManager"));
const AgentInsights = lazyWithRetry(() => import("./pages/agent/AgentInsights"));
const AgentPlans = lazyWithRetry(() => import("./pages/agent/AgentPlans"));
const AgentSkills = lazyWithRetry(() => import("./pages/agent/AgentSkills"));
const SharedMarketQAAnswer = lazyWithRetry(() => import("./pages/qa/SharedMarketQAAnswer"));
const MarketQASubscriptions = lazyWithRetry(() => import("./pages/qa/MarketQASubscriptions"));
const MarketQADigests = lazyWithRetry(() => import("./pages/qa/MarketQADigests"));

const Integrations = lazyWithRetry(() => import("./pages/Integrations"));
const WorkflowPlayground = lazyWithRetry(() => import("./pages/WorkflowPlayground"));
const MarketingAnalytics = lazyWithRetry(() => import("./pages/MarketingAnalytics"));
const CloudflareManagement = lazyWithRetry(() => import("./pages/CloudflareManagement"));
const ClientManagement = lazyWithRetry(() => import("./pages/ClientManagement"));
const ClientTracker = lazyWithRetry(() => import("./pages/ClientTracker"));
const PortfolioReports = lazyWithRetry(() => import("./pages/PortfolioReports"));
const ReportRequests = lazyWithRetry(() => import("./pages/ReportRequests"));
const ApiUsage = lazyWithRetry(() => import("./pages/ApiUsage"));
const DealPipeline = lazyWithRetry(() => import("./pages/DealPipeline"));
const RemindersHub = lazyWithRetry(() => import("./pages/RemindersHub"));
const Checklists = lazyWithRetry(() => import("./pages/Checklists"));
const Agreements = lazyWithRetry(() => import("./pages/Agreements"));
const AgreementTemplates = lazyWithRetry(() => import("./pages/AgreementTemplates"));
const PartnerCompliance = lazyWithRetry(() => import("./pages/PartnerCompliance"));

const PartnerReferrals = lazyWithRetry(() => import("./pages/PartnerReferrals"));
const LoanWriterUndertakings = lazyWithRetry(() => import("./pages/LoanWriterUndertakings"));
const PublicPartnerConsent = lazyWithRetry(() => import("./pages/PublicPartnerConsent"));
const PartnerAcknowledgement = lazyWithRetry(() => import("./pages/PartnerAcknowledgement"));
const PublicPassport = lazyWithRetry(() => import("./pages/PublicPassport"));

const GamePlan = lazyWithRetry(() => import("./pages/GamePlan"));
const Commissions = lazyWithRetry(() => import("./pages/Commissions"));
const ReportsAnalytics = lazyWithRetry(() => import("./pages/ReportsAnalytics"));
const ModelHub = lazyWithRetry(() => import("./pages/ModelHub"));
const Billing = lazyWithRetry(() => import("./pages/Billing"));
const TokenAuditLog = lazyWithRetry(() => import("./pages/TokenAuditLog"));
const CommercialIndustrial = lazyWithRetry(() => import("./pages/commercial/CommercialIndustrial"));
const CommercialAssessmentWorkspace = lazyWithRetry(() => import("./pages/commercial/CommercialAssessmentWorkspace"));
const CommercialPropertyDetail = lazyWithRetry(() => import("./pages/commercial/CommercialPropertyDetail"));

const IndustrialPropertyDetail = lazyWithRetry(() => import("./pages/industrial/IndustrialPropertyDetail"));
const PropertyCalculators = lazyWithRetry(() => import("./pages/calculators/PropertyCalculators"));
const CommercialIndustrialWorkspace = lazyWithRetry(() => import("./pages/calculators/CommercialIndustrialWorkspace"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound"));
import { PortalAuthProvider } from "@/hooks/usePortalAuth";
import { PortalProtectedRoute } from "@/components/portal/PortalProtectedRoute";
import { PortalLayout } from "@/components/portal/PortalLayout";
const PortalAuth = lazyWithRetry(() => import("./pages/portal/PortalAuth"));
const PortalHandoff = lazyWithRetry(() => import("./pages/portal/PortalHandoff"));
const PortalDashboard = lazyWithRetry(() => import("./pages/portal/PortalDashboard"));
const PortalProfile = lazyWithRetry(() => import("./pages/portal/PortalProfile"));
const PortalProperties = lazyWithRetry(() => import("./pages/portal/PortalProperties"));
const PortalEmployment = lazyWithRetry(() => import("./pages/portal/PortalEmployment"));
const PortalReports = lazyWithRetry(() => import("./pages/portal/PortalReports"));
const PortalDocuments = lazyWithRetry(() => import("./pages/portal/PortalDocuments"));
const PortalAcceptInvite = lazyWithRetry(() => import("./pages/portal/PortalAcceptInvite"));
const PortalNotifications = lazyWithRetry(() => import("./pages/portal/PortalNotifications"));
const PortalDealProgress = lazyWithRetry(() => import("./pages/portal/PortalDealProgress"));
const PortalActionItems = lazyWithRetry(() => import("./pages/portal/PortalActionItems"));
const PortalFinanceHub = lazyWithRetry(() => import("./pages/portal/PortalFinanceHub"));
const PortalLenders = lazyWithRetry(() => import("./pages/portal/PortalLenders"));
const PortalMessages = lazyWithRetry(() => import("./pages/portal/PortalMessages"));
const PortalPropertyInsights = lazyWithRetry(() => import("./pages/portal/PortalPropertyInsights"));
const PortalBooking = lazyWithRetry(() => import("./pages/portal/PortalBooking"));
const PortalAppointments = lazyWithRetry(() => import("./pages/portal/PortalAppointments"));
const PortalAml = lazyWithRetry(() => import("./pages/portal/PortalAml"));
const PortalPassport = lazyWithRetry(() => import("./pages/portal/PortalPassport"));
const PortalIdentityReturn = lazyWithRetry(() => import("./pages/portal/PortalIdentityReturn"));
const PortalLegal = lazyWithRetry(() => import("./pages/portal/PortalLegal"));
const PortalLegalDetail = lazyWithRetry(() => import("./pages/portal/PortalLegalDetail"));
const PortalConfig = lazyWithRetry(() => import("./pages/PortalConfig"));
import { PortalConsentWall } from "@/components/portal/PortalConsentWall";
import { FinancePortalAuthProvider } from "@/hooks/useFinancePortalAuth";
import { SolicitorPortalAuthProvider } from "@/hooks/useSolicitorPortalAuth";
import { SolicitorPortalProtectedRoute } from "@/components/solicitor-portal/SolicitorPortalProtectedRoute";
import { SolicitorPortalLayout } from "@/components/solicitor-portal/SolicitorPortalLayout";
const SolicitorLogin = lazyWithRetry(() => import("@/pages/solicitor/SolicitorLogin"));
const SolicitorAcceptInvite = lazyWithRetry(() => import("@/pages/solicitor/SolicitorAcceptInvite"));
const SolicitorForgotPassword = lazyWithRetry(() => import("@/pages/solicitor/SolicitorForgotPassword"));
const SolicitorChangePassword = lazyWithRetry(() => import("@/pages/solicitor/SolicitorChangePassword"));
const SolicitorDashboard = lazyWithRetry(() => import("@/pages/solicitor/SolicitorDashboard"));
const SolicitorMatters = lazyWithRetry(() => import("@/pages/solicitor/SolicitorMatters"));
const SolicitorCompliance = lazyWithRetry(() => import("@/pages/solicitor/SolicitorCompliance"));
const SolicitorPipeline = lazyWithRetry(() => import("@/pages/solicitor/SolicitorPipeline"));
const SolicitorMatterDetail = lazyWithRetry(() => import("@/pages/solicitor/SolicitorMatterDetail"));
const SolicitorTerms = lazyWithRetry(() => import("@/pages/solicitor/SolicitorTerms"));
const SolicitorOnboarding = lazyWithRetry(() => import("@/pages/solicitor/SolicitorOnboarding"));
const SolicitorSecurity = lazyWithRetry(() => import("@/pages/solicitor/SolicitorSecurity"));
const SolicitorSettings = lazyWithRetry(() => import("@/pages/solicitor/SolicitorSettings"));
const SolicitorWorkspacePage = lazyWithRetry(() => import("@/pages/solicitor/SolicitorWorkspacePage"));
/*
 * The Builder / Developer Portal LEFT this deployment for the central
 * Builders Network (extraction plan §7; Phase 6 unrouted it, Phase 7 deleted
 * it). Every `/builder/*` path resolves to the redirect below, which is all
 * that remains of the portal here.
 */
const BuilderPortalMoved = lazyWithRetry(() => import("@/pages/BuilderPortalMoved"));
import { FinancePortalProtectedRoute } from "@/components/finance-portal/FinancePortalProtectedRoute";
import { FinancePortalLayout } from "@/components/finance-portal/FinancePortalLayout";
const FinancePortalLogin = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalLogin"));
const FinancePortalAcceptInvite = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalAcceptInvite"));
const FinancePortalChangePassword = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalChangePassword"));
const FinancePortalTerms = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalTerms"));
const FinancePortalOnboarding = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalOnboarding"));
const FinancePortalDashboard = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalDashboard"));
const FinancePortalClients = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalClients"));
const FinancePortalClientProfile = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalClientProfile"));
const FinancePortalMessages = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalMessages"));
const FinancePortalEarnings = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalEarnings"));
const FinancePortalLenderIntelligence = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalLenderIntelligence"));
const FinancePortalReports = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalReports"));
const FinancePortalSettings = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalSettings"));

const FinancePortalPurchaseFiles = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalPurchaseFiles"));
const FinancePortalPurchaseFileDetail = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalPurchaseFileDetail"));
const FinancePortalClientInbox = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalClientInbox"));
const FinancePortalPipeline = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalPipeline"));
const FinancePortalComplianceWorkspace = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalComplianceWorkspace"));
const FinancePortalInsights = lazyWithRetry(() => import("./pages/finance-portal/FinancePortalInsights"));
const PartnerReferralInbox = lazyWithRetry(() => import("./pages/finance-portal/PartnerReferralInbox"));
const AmlCaseSnapshot = lazyWithRetry(() => import("./pages/finance-portal/AmlCaseSnapshot"));


/**
 * The listing queries behind Overview and Listings are expensive — a cold read
 * is one sequential request per 100 records. React Query's defaults are
 * `staleTime: 0` plus refetch-on-mount and refetch-on-focus, which meant every
 * navigation between the two pages, and every alt-tab back to the window, threw
 * the whole set away and asked for it again. `propertyDataService` now holds the
 * durable cache; these defaults stop the query layer fighting it.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * Shown while a route's chunk is in flight.
 *
 * Every page is now its own chunk, so this is the one thing a reader can see
 * between clicking a link and the page arriving. Deliberately quiet — a
 * centred pulse on the app's own surface rather than a spinner that flashes
 * on every navigation — and it uses semantic tokens so it re-themes with the
 * brand like everything else.
 */
const RouteFallback = () => (
  <div className="flex min-h-[60vh] w-full items-center justify-center" aria-busy="true">
    <div className="flex flex-col items-center gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none" />
      <span className="text-xs font-medium text-muted-foreground">Loading…</span>
    </div>
  </div>
);

const CalendarErrorFallback = () => (
  <div className="p-6">
    <div className="rounded-md border border-border bg-muted/40 p-4 text-sm">
      <div className="font-medium text-foreground">Calendar failed to load.</div>
      <div className="mt-1 text-muted-foreground">
        A malformed appointment may have caused this section to crash.
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  </div>
);

const PathNormalizer = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const normalizedPath = location.pathname.replace(/\/{2,}/g, '/');
    if (normalizedPath !== location.pathname) {
      navigate(`${normalizedPath}${location.search}${location.hash}`, { replace: true });
    }
  }, [location.pathname, location.search, location.hash, navigate]);

  return null;
};

/** Notifies the user when this tab is running a cached, outdated build. */
const BuildVersionWatcher = () => {
  useBuildVersionCheck();
  return null;
};

/**
 * Last line of defence for the whole application.
 *
 * `index.html` ships an empty `#root`, so an uncaught render error anywhere in
 * the provider tree below unmounts everything and leaves a blank white page —
 * indistinguishable from "the site is down", and with no way back short of
 * clearing browser data. The providers above the router all mount for a signed
 * OUT visitor too, so this covers the sign-in page as much as the dashboard.
 */
const AppErrorFallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-background p-4">
    <div className="w-full max-w-xl">
      <DashboardErrorFallback />
    </div>
  </div>
);

const App = () => (
  <ErrorBoundary fallback={<AppErrorFallback />}>
  <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <BrandProvider>
            <PermissionsProvider>
              <WorkspaceEntitlementsProvider>
              <PaymentGateProvider>
              <BrowserRouter>
                <PathNormalizer />
                <NotificationsProvider>
                  {/*
                    Ambient background listeners: they render nothing the page
                    depends on, but they mount above every route — including
                    /auth, for a visitor who has no session for them to watch.
                    A throw in one of them used to unmount the entire tree and
                    leave a blank page nobody could sign in from, so they are
                    isolated: one failing degrades its own feature and nothing
                    else. `null` because there is no UI here to replace.
                  */}
                  <ErrorBoundary fallback={null}>
                    <BackgroundJobTracker />
                    <ReportGenerationProgress />
                    <CallNotificationListener />
                    <Phase1NotificationListeners />
                    <TokenEventsListener />
                    <PricingMockBanner />
                    <PushNotificationPrompt />
                  </ErrorBoundary>
                  <ComparisonProvider>
                    <SearchProvider>
                      <Toaster />
                      <Sonner />
                      <BuildVersionWatcher />
                      <Suspense fallback={<RouteFallback />}>
                      <Routes>
                        {/* Public shareable answer link (no auth) */}
                        <Route path="/qa/shared/:token" element={<SharedQAAnswer />} />
                        {/* Public shareable market Q&A answer (no auth) */}
                        <Route path="/qa/market/:slug" element={<SharedMarketQAAnswer />} />
                        {/* Public template share preview (no auth) */}
                        <Route path="/template-share/:token" element={<TemplateSharePreview />} />
                        {/* Public partner referral consent signing (no auth) */}
                        <Route path="/partner-consent/:token" element={<PublicPartnerConsent />} />
                        {/* AML/CTF Compliance Passport Agreement for a partner
                            outside the portals. Public and token-addressed:
                            the link is the whole credential.

                            Both link pages carry their OWN boundary. The
                            recipient has no account and no support channel, so
                            the application's generic "Something went wrong"
                            reads to them as a broken link and leaves them with
                            no step; this one names the re-send. */}
                        <Route
                          path="/partner-acknowledgement/:token"
                          element={(
                            <ErrorBoundary fallback={<PublicLinkErrorFallback />}>
                              <PartnerAcknowledgement />
                            </ErrorBoundary>
                          )}
                        />
                        {/* The Compliance Passport itself, opened from a
                            link. The grant token is the whole credential. */}
                        <Route
                          path="/passport/:token"
                          element={(
                            <ErrorBoundary fallback={<PublicLinkErrorFallback />}>
                              <PublicPassport />
                            </ErrorBoundary>
                          )}
                        />

                        {/* Client Portal Routes */}
                        <Route path="/client/login" element={
                          <PortalAuthProvider>
                            <PortalAuth />
                          </PortalAuthProvider>
                        } />
                        <Route path="/client/accept-invite" element={
                          <PortalAcceptInvite />
                        } />
                        <Route path="/portal/accept-invite" element={
                          <PortalAcceptInvite />
                        } />
                        <Route path="/client/handoff" element={<PortalHandoff />} />
                        {/*
                          Where the secure identity check returns the customer.
                          Outside the authenticated tree on purpose: they may
                          land here in a window with no portal session — a
                          handed-off phone is the ordinary case — and a login
                          wall at the end of a verification is the third-party
                          ending this flow exists to remove. The page displays
                          no case data and reads no status from the redirect.
                        */}
                        <Route path="/client/aml/identity-return" element={<PortalIdentityReturn />} />
                        <Route path="/client/consent" element={
                          <PortalAuthProvider>
                            <PortalConsentWall />
                          </PortalAuthProvider>
                        } />
                        <Route path="/client" element={
                          <PortalAuthProvider>
                            <PortalProtectedRoute>
                              <PortalLayout />
                            </PortalProtectedRoute>
                          </PortalAuthProvider>
                        }>
                          <Route index element={<PortalDashboard />} />
                          <Route path="profile" element={<PortalProfile />} />
                          <Route path="properties" element={<PortalProperties />} />
                          <Route path="employment" element={<PortalEmployment />} />
                          <Route path="emails" element={<PortalReports />} />
                          <Route path="reports" element={<PortalReports />} />
                          <Route path="request-report" element={<PortalReports />} />
                          <Route path="documents" element={<PortalDocuments />} />
                          <Route path="notifications" element={<PortalNotifications />} />
                          <Route path="deal-progress" element={<PortalDealProgress />} />
                          <Route path="action-items" element={<PortalActionItems />} />
                          <Route path="finance" element={<PortalFinanceHub />} />
                          <Route path="lenders" element={<PortalLenders />} />
                          <Route path="messages" element={<PortalMessages />} />
                          <Route path="legal" element={<PortalLegal />} />
                          <Route path="legal/:caseId" element={<PortalLegalDetail />} />
                          <Route path="property-insights" element={<PortalPropertyInsights />} />
                          <Route path="booking" element={<PortalBooking />} />
                          <Route path="appointments" element={<PortalAppointments />} />
                          <Route path="aml" element={<PortalAml />} />
                          <Route path="aml/passport" element={<PortalPassport />} />
                        </Route>

                        {/* Finance Portal Routes - single provider wrapping all /finance/* */}
                        <Route path="/finance/*" element={
                          <FinancePortalAuthProvider>
                            <Routes>
                              <Route path="login" element={<FinancePortalLogin />} />
                              <Route path="accept-invite" element={<FinancePortalAcceptInvite />} />
                              <Route path="change-password" element={
                                <FinancePortalProtectedRoute>
                                  <FinancePortalChangePassword />
                                </FinancePortalProtectedRoute>
                              } />
                              {/*
                                Governance gates, in the order the guard enforces:
                                terms, then onboarding. Both sit OUTSIDE the portal
                                layout so neither shares a tree with the welcome tour,
                                and so each contains itself in the viewport instead of
                                being squeezed into a dialog. Same shape as
                                /solicitor/terms and /solicitor/onboarding.
                              */}
                              <Route path="terms" element={
                                <FinancePortalProtectedRoute>
                                  <FinancePortalTerms />
                                </FinancePortalProtectedRoute>
                              } />
                              <Route path="onboarding" element={
                                <FinancePortalProtectedRoute>
                                  <FinancePortalOnboarding />
                                </FinancePortalProtectedRoute>
                              } />
                              <Route path="" element={
                                <FinancePortalProtectedRoute>
                                  <FinancePortalLayout />
                                </FinancePortalProtectedRoute>
                              }>
                                <Route index element={<FinancePortalDashboard />} />
                                <Route path="purchase-files" element={<FinancePortalPurchaseFiles />} />
                                <Route path="purchase-files/:fileId" element={<FinancePortalPurchaseFileDetail />} />
                                <Route path="clients" element={<FinancePortalClients />} />
                                <Route path="clients/:clientId" element={<FinancePortalClientProfile />} />
                                <Route path="messages" element={<FinancePortalMessages />} />
                                <Route path="client-inbox" element={<FinancePortalClientInbox />} />
                                <Route path="earnings" element={<FinancePortalEarnings />} />
                                <Route path="lender-intelligence" element={<FinancePortalLenderIntelligence />} />
                                <Route path="pipeline" element={<FinancePortalPipeline />} />
                                <Route path="insights" element={<FinancePortalInsights />} />
                                <Route path="referrals" element={<PartnerReferralInbox />} />
                                {/* The agreement workflow is retired and the templates
                                    now live on the dashboard, so there is ONE destination
                                    rather than a page that still looks like an inbox. */}
                                <Route path="agreements" element={<Navigate to="/finance" replace />} />
                                {/* Emailed deep links to a specific issued agreement are
                                    still in people's inboxes; land them on the dashboard
                                    rather than a 404. */}
                                <Route path="agreements/:id" element={<Navigate to="/finance" replace />} />
                                <Route path="reports" element={<FinancePortalReports />} />
                                <Route path="settings" element={<FinancePortalSettings />} />
                                <Route path="aml-snapshot/:token" element={<AmlCaseSnapshot />} />
                                <Route path="compliance" element={<FinancePortalComplianceWorkspace />} />
                                



                              </Route>
                            </Routes>
                          </FinancePortalAuthProvider>
                        } />

                        {/* Solicitor Portal Routes - single provider wrapping all /solicitor/* */}
                        <Route path="/solicitor/*" element={
                          <SolicitorPortalAuthProvider>
                            <Routes>
                              <Route path="login" element={<SolicitorLogin />} />
                              <Route path="accept-invite" element={<SolicitorAcceptInvite />} />
                              <Route path="forgot-password" element={<SolicitorForgotPassword />} />
                              <Route element={<SolicitorPortalProtectedRoute />}>
                                <Route path="change-password" element={<SolicitorChangePassword />} />
                                <Route path="terms" element={<SolicitorTerms />} />
                                <Route path="onboarding" element={<SolicitorOnboarding />} />
                                <Route element={<SolicitorPortalLayout />}>
                                  <Route index element={<SolicitorDashboard />} />
                                  <Route path="matters" element={<SolicitorMatters />} />
                                  <Route path="pipeline" element={<SolicitorPipeline />} />
                                  <Route path="matters/:matterId" element={<SolicitorMatterDetail />} />
                                  <Route path="messages" element={<SolicitorWorkspacePage kind="messages" />} />
                                  <Route path="tasks" element={<SolicitorWorkspacePage kind="tasks" />} />
                                  <Route path="notifications" element={<SolicitorWorkspacePage kind="notifications" />} />
                                  <Route path="compliance" element={<SolicitorCompliance />} />
                                  <Route path="settings" element={<SolicitorSettings />} />
                                  <Route path="settings/security" element={<SolicitorSecurity />} />
                                </Route>
                              </Route>
                            </Routes>
                          </SolicitorPortalAuthProvider>
                        } />

                        {/*
                          Builder / Developer Portal — MOVED (plan §7 Phase 6).

                          The portal is served centrally at the Builders
                          Network now; every path under /builder, bookmarks
                          and deep links included, resolves to one element
                          that replaces the location with the network origin,
                          `?from=` naming this workspace. One route, not a
                          per-page map: the clone no longer knows the
                          portal's inner geography. The old subtree (auth
                          provider, layout, withdrawn-section notices) is
                          unrouted, not deleted — Phase 7 removes the files.
                        */}
                        <Route path="/builder/*" element={<BuilderPortalMoved />} />

                        {/* Internal Dashboard Routes */}
                        <Route path="/auth" element={<Auth />} />

                        <Route path="/accept-invite" element={<AcceptInvite />} />
                        <Route path="/" element={
                          <ProtectedRoute>
                            <HarveyCountdown />
                            <DashboardLayout />
                          </ProtectedRoute>
                        }>
                <Route index element={<Overview />} />
                <Route path="dashboard" element={<Overview />} />
                <Route path="listings" element={<ModuleGuard moduleKey="listings"><Listings /></ModuleGuard>} />
                {/* A listing is the thing people send each other, and a modal
                    has no URL. This one survives a paste into Slack. */}
                <Route
                  path="listings/:listingId"
                  element={<ModuleGuard moduleKey="listings"><ListingDetail /></ModuleGuard>}
                />
                <Route path="market-updates" element={<ModuleGuard moduleKey="market_updates"><MarketUpdates /></ModuleGuard>} />
                <Route path="market-updates/archived" element={<ModuleGuard moduleKey="market_updates"><MarketArchivePage /></ModuleGuard>} />
                <Route
                  path="calendar"
                  element={
                    <ModuleGuard moduleKey="calendar">
                      <ErrorBoundary fallback={<CalendarErrorFallback />}>
                        <Calendar />
                      </ErrorBoundary>
                    </ModuleGuard>
                  }
                />
                <Route path="sources" element={<ModuleGuard moduleKey="sources"><Sources /></ModuleGuard>} />
                <Route path="reports" element={<ModuleGuard moduleKey="reports"><Reports /></ModuleGuard>} />
                <Route path="quantitative-reports" element={<ModuleGuard moduleKey="generated_reports"><QuantitativeReports /></ModuleGuard>} />
                <Route path="quantitative-reports/:reportId" element={<ModuleGuard moduleKey="generated_reports"><ReportViewer /></ModuleGuard>} />
                <Route path="charts" element={<ModuleGuard moduleKey="charts"><Charts /></ModuleGuard>} />
                <Route path="generated-reports" element={<ModuleGuard moduleKey="generated_reports"><GeneratedReports /></ModuleGuard>} />
                <Route path="generated-reports/:reportId" element={<ModuleGuard moduleKey="generated_reports"><ReportViewer /></ModuleGuard>} />
                <Route path="user-guide" element={<UserGuide />} />
                <Route path="feedback" element={<Feedback />} />
                <Route path="support" element={<Support />} />
                <Route path="monitoring" element={<ModuleGuard moduleKey="monitoring"><Monitoring /></ModuleGuard>} />
                <Route path="quality-assurance" element={<ModuleGuard moduleKey="quality_assurance"><QualityAssurance /></ModuleGuard>} />
                <Route path="data-import" element={<ModuleGuard moduleKey="data_import"><DataImport /></ModuleGuard>} />
                <Route path="automation" element={<ModuleGuard moduleKey="automation"><Automation /></ModuleGuard>} />
                <Route path="email-copilot" element={<ModuleGuard moduleKey="email_copilot"><EmailCopilot /></ModuleGuard>} />
                <Route path="call-logs" element={<ModuleGuard moduleKey="call_logs"><CallLogs /></ModuleGuard>} />
                <Route path="cash-flow-analysis" element={<ModuleGuard moduleKey="cash_flow"><CashFlowAnalysis /></ModuleGuard>} />
                <Route path="cash-flow-analysis/:id" element={<ModuleGuard moduleKey="cash_flow"><CashFlowAnalysisDetail /></ModuleGuard>} />
                <Route path="report-qa" element={<ModuleGuard moduleKey="report_qa"><ReportQA /></ModuleGuard>} />
                <Route path="investment-report/:id" element={<ModuleGuard moduleKey="reports"><InvestmentReportView /></ModuleGuard>} />
                <Route path="templates" element={<ModuleGuard moduleKey="templates"><Templates /></ModuleGuard>} />
                <Route path="white-label" element={<ModuleGuard moduleKey="white_label"><WhiteLabel /></ModuleGuard>} />
                <Route path="error-logs" element={<ModuleGuard moduleKey="error_logs"><ErrorLogs /></ModuleGuard>} />
                <Route path="settings" element={<ModuleGuard moduleKey="settings"><Settings /></ModuleGuard>} />
                <Route path="admin/users" element={<ModuleGuard moduleKey="user_management"><UserManagement /></ModuleGuard>} />
                <Route path="admin/finance-portal" element={<ModuleGuard moduleKey="finance_portal_admin"><FinancePortalAdmin /></ModuleGuard>} />
                <Route path="admin/solicitor-portal" element={<ModuleGuard moduleKey="solicitor_portal_admin"><SolicitorPortalAdmin /></ModuleGuard>} />
                <Route path="admin/finance-portal/analytics" element={<ModuleGuard moduleKey="finance_portal_admin"><FinancePortalAnalytics /></ModuleGuard>} />
                <Route path="admin/finance-portal/bulk-import" element={<ModuleGuard moduleKey="finance_portal_admin"><FinancePortalBulkImport /></ModuleGuard>} />
                <Route path="admin/finance-portal/compliance" element={<ModuleGuard moduleKey="finance_portal_admin"><FinancePortalCompliance /></ModuleGuard>} />
                <Route path="admin/finance-portal/health" element={<ModuleGuard moduleKey="finance_portal_admin"><FinancePortalHealth /></ModuleGuard>} />
                <Route path="admin/finance-portal/commissions" element={<ModuleGuard moduleKey="finance_portal_admin"><FinancePortalCommissions /></ModuleGuard>} />
                <Route path="admin/activity-logs" element={<ModuleGuard moduleKey="activity_logs"><ActivityLogs /></ModuleGuard>} />
                <Route path="admin/depreciation-comps" element={<ModuleGuard moduleKey="depreciation_comps"><DepreciationCompsAdmin /></ModuleGuard>} />
                <Route path="admin/template-builder" element={<ModuleGuard moduleKey="templates"><TemplateBuilder /></ModuleGuard>} />
                {/* Before the `:id` route for readability; react-router ranks the
                    static segment above the dynamic one regardless. */}
                <Route path="admin/template-builder/converter" element={<ModuleGuard moduleKey="templates" requireEdit><TemplateConverter /></ModuleGuard>} />
                {/* Before `:id`, or the parameterised route swallows it. */}
                <Route path="admin/template-builder/brand-systems" element={<ModuleGuard moduleKey="templates" requireEdit><BrandSystems /></ModuleGuard>} />
                <Route path="admin/template-builder/:id" element={<ModuleGuard moduleKey="templates" requireEdit><TemplateBuilderEdit /></ModuleGuard>} />
                <Route path="admin/report-engine-inspector" element={<ReportEngineInspector />} />
                <Route path="admin/figma-templates" element={<ModuleGuard moduleKey="templates"><FigmaTemplates /></ModuleGuard>} />
                <Route path="admin/pdf-import-engine" element={<ModuleGuard moduleKey="templates"><PdfImportEngineAdmin /></ModuleGuard>} />
                <Route path="admin/pdf-import-diagnostics" element={<ModuleGuard moduleKey="templates"><PdfImportDiagnostics /></ModuleGuard>} />
                <Route path="admin/pdf-import-monitoring" element={<ModuleGuard moduleKey="templates"><PdfImportMonitoring /></ModuleGuard>} />
                <Route path="admin/pdf-import-retention" element={<ModuleGuard moduleKey="templates"><PdfImportRetention /></ModuleGuard>} />
                <Route path="admin/pdf-import-client-reports" element={<ModuleGuard moduleKey="templates"><PdfImportClientReports /></ModuleGuard>} />
                <Route path="admin/template-import-quality" element={<ModuleGuard moduleKey="templates"><TemplateImportQuality /></ModuleGuard>} />
                <Route path="admin/pdf-golden-regression" element={<ModuleGuard moduleKey="templates"><PdfGoldenRegression /></ModuleGuard>} />
                <Route path="admin/market-qa-quality" element={<ModuleGuard moduleKey="activity_logs"><MarketQAQuality /></ModuleGuard>} />
                <Route path="admin/bc-segment-engine" element={<ModuleGuard moduleKey="__superadmin_only__"><BcSegmentEngineAdmin /></ModuleGuard>} />
                <Route path="admin/reclassify-property" element={<ReclassifyPropertyAdmin />} />
                <Route path="admin/agent-quality" element={<ModuleGuard moduleKey="__superadmin_only__"><AgentQuality /></ModuleGuard>} />
                <Route path="admin/aml" element={<AmlLayout />}>
                  <Route index element={<AmlGuard capability="aml.view"><AmlOverview /></AmlGuard>} />
                  <Route path="cases" element={<AmlGuard capability="aml.view"><AmlCases /></AmlGuard>} />
                  <Route path="cases/:caseId" element={<AmlGuard capability="aml.view"><AmlCaseWorkspace /></AmlGuard>} />
                  <Route path="passport" element={<AmlGuard capability="aml.view"><AmlPassports /></AmlGuard>} />
                  <Route path="verification" element={<AmlGuard capability="aml.view"><AmlVerification /></AmlGuard>} />
                  <Route path="screening" element={<AmlGuard capability="aml.view"><AmlScreening /></AmlGuard>} />
                  <Route path="risk" element={<AmlGuard capability="aml.view"><AmlRisk /></AmlGuard>} />
                  <Route path="counterparty" element={<AmlGuard capability="aml.view"><AmlCounterparty /></AmlGuard>} />
                  <Route path="finance" element={<AmlGuard capability="aml.investigate"><AmlFinance /></AmlGuard>} />
                  <Route path="transactions" element={<AmlGuard capability="aml.investigate"><AmlTransactions /></AmlGuard>} />
                  <Route path="monitoring" element={<AmlGuard capability="aml.view"><AmlMonitoring /></AmlGuard>} />
                  <Route path="investigations" element={<AmlGuard capability="aml.investigate"><AmlInvestigations /></AmlGuard>} />
                  <Route path="austrac" element={<AmlGuard capability="aml.report"><AmlAustracReporting /></AmlGuard>} />
                  {/*
                    Drafting a report is a page rather than a dialog, so it has
                    a URL that can be linked, returned to and reached with the
                    back button. Both sit UNDER `austrac`, which is what keeps
                    them in the Regulatory & Assurance workspace —
                    `pathMatchesWorkspace` matches a prefix followed by `/`.
                  */}
                  <Route path="austrac/new" element={<AmlGuard capability="aml.report"><AmlAustracReportDraft /></AmlGuard>} />
                  <Route path="austrac/:reportId/edit" element={<AmlGuard capability="aml.report"><AmlAustracReportDraft /></AmlGuard>} />
                  <Route path="records" element={<AmlGuard capability="aml.view"><AmlRecords /></AmlGuard>} />
                  <Route path="governance" element={<AmlGuard capability="aml.view"><AmlGovernance /></AmlGuard>} />
                  <Route path="launch-ops" element={<AmlGuard capability="aml.view"><AmlLaunchOps /></AmlGuard>} />
                  <Route path="partner-operations" element={<AmlGuard capability="aml.view"><AmlPartnerOperations /></AmlGuard>} />
                  <Route path="configuration" element={<AmlGuard capability="aml.configure"><AmlConfiguration /></AmlGuard>} />
                </Route>
                <Route path="admin/aml-v3-cutover" element={<AmlV3Cutover />} />
                <Route path="admin/aml-integration-health" element={<AmlIntegrationHealth />} />
                <Route path="agent/memories" element={<ModuleGuard moduleKey="agent"><AgentMemoryManager /></ModuleGuard>} />
                <Route path="agent-insights" element={<ModuleGuard moduleKey="agent"><AgentInsights /></ModuleGuard>} />
                <Route path="agent/plans" element={<ModuleGuard moduleKey="agent"><AgentPlans /></ModuleGuard>} />
                <Route path="agent/skills" element={<ModuleGuard moduleKey="agent"><AgentSkills /></ModuleGuard>} />
                <Route path="qa/subscriptions" element={<MarketQASubscriptions />} />
                <Route path="qa/digests" element={<MarketQADigests />} />

                <Route path="integrations" element={<ModuleGuard moduleKey="integrations"><Integrations /></ModuleGuard>} />
                <Route path="integrations/ghl-migration" element={<InternalToolingGuard><GhlMigration /></InternalToolingGuard>} />
                <Route path="workflow-playground" element={<ModuleGuard moduleKey="integrations"><WorkflowPlayground /></ModuleGuard>} />
                <Route path="cloudflare" element={<ModuleGuard moduleKey="cloudflare"><CloudflareManagement /></ModuleGuard>} />
                <Route path="api-usage" element={<ModuleGuard moduleKey="api_usage"><ApiUsage /></ModuleGuard>} />
                <Route path="clients" element={<ModuleGuard moduleKey="clients"><ClientManagement /></ModuleGuard>} />
                <Route path="client-tracker" element={<ModuleGuard moduleKey="client_tracker"><ClientTracker /></ModuleGuard>} />
                <Route path="portfolio-reports" element={<ModuleGuard moduleKey="portfolio_reports"><PortfolioReports /></ModuleGuard>} />
                <Route path="report-requests" element={<ModuleGuard moduleKey="reports"><ReportRequests /></ModuleGuard>} />
                <Route path="deal-pipeline" element={<ModuleGuard moduleKey="deal_pipeline"><DealPipeline /></ModuleGuard>} />
                <Route path="reminders" element={<ModuleGuard moduleKey="reminders"><RemindersHub /></ModuleGuard>} />
                <Route path="checklists" element={<ModuleGuard moduleKey="checklists"><Checklists /></ModuleGuard>} />
                <Route path="agreements" element={<ModuleGuard moduleKey="agreements"><Agreements /></ModuleGuard>} />
                <Route path="partner-agreements" element={<ModuleGuard moduleKey="agreements"><AgreementTemplates /></ModuleGuard>} />
                {/* The issuance workflow is retired. Every route it owned now
                    lands on the template desk rather than 404-ing, because the
                    links are in bookmarks, emails and activity trails. */}
                <Route path="partner-agreements/new" element={<Navigate to="/partner-agreements" replace />} />
                <Route path="partner-agreements/register" element={<Navigate to="/partner-agreements" replace />} />
                <Route path="partner-agreements/:id" element={<Navigate to="/partner-agreements" replace />} />
                <Route path="partner-agreements/:id/edit" element={<Navigate to="/partner-agreements" replace />} />
                <Route path="partner-referrals" element={<ModuleGuard moduleKey="agreements"><PartnerReferrals /></ModuleGuard>} />
                <Route path="loan-writer-undertakings" element={<ModuleGuard moduleKey="agreements"><LoanWriterUndertakings /></ModuleGuard>} />
                <Route path="partner-compliance" element={<ModuleGuard moduleKey="agreements"><PartnerCompliance /></ModuleGuard>} />


                <Route path="game-plan" element={<ModuleGuard moduleKey="game_plans"><GamePlan /></ModuleGuard>} />
                <Route path="portal-config" element={<ModuleGuard moduleKey="portal_config"><PortalConfig /></ModuleGuard>} />
                <Route path="marketing-analytics" element={<ModuleGuard moduleKey="marketing_analytics"><MarketingAnalytics /></ModuleGuard>} />
                <Route path="conversations" element={<ModuleGuard moduleKey="conversations"><Conversations /></ModuleGuard>} />
                <Route path="messages" element={<ModuleGuard moduleKey="conversations"><Messages /></ModuleGuard>} />
                <Route path="lenders" element={<ModuleGuard moduleKey="lenders"><Lenders /></ModuleGuard>} />
                <Route path="commissions" element={<Commissions />} />
                <Route path="reports/analytics" element={<ReportsAnalytics />} />
                <Route path="model-hub" element={<ModuleGuard moduleKey="model_hub" requireEdit><ModelHub /></ModuleGuard>} />
                <Route path="billing" element={<Billing />} />
                {/* Legacy deep links land on the consolidated page's Usage tab. */}
                <Route path="billing/usage" element={<Navigate to="/billing?tab=usage" replace />} />
                <Route path="admin/token-audit" element={<TokenAuditLog />} />
                <Route path="commercial" element={<ModuleGuard moduleKey="commercial"><CommercialIndustrial /></ModuleGuard>} />
                {/* The analysis workspace is what `/calculators` now means.
                    Every historical entry point keeps working: the domain and
                    property query parameters are read by the workspace's own
                    bootstrap, which opens an analysis around that property
                    rather than dead-ending. The pre-workspace calculator suite
                    stays reachable at `calculators/classic` until every engine
                    it holds has a home in a stage. */}
                <Route path="commercial/calculators" element={<ModuleGuard moduleKey="commercial"><CommercialIndustrialWorkspace /></ModuleGuard>} />
                {/* Assessment routes sit above the :id property route so an
                    assessment id is never swallowed by the property detail page. */}
                <Route path="commercial/assessments/:id" element={<ModuleGuard moduleKey="commercial"><CommercialAssessmentWorkspace /></ModuleGuard>} />
                <Route path="commercial/:id" element={<ModuleGuard moduleKey="commercial"><CommercialPropertyDetail /></ModuleGuard>} />
                <Route path="industrial" element={<ModuleGuard moduleKey="commercial"><CommercialIndustrial /></ModuleGuard>} />
                <Route path="industrial/calculators" element={<ModuleGuard moduleKey="commercial"><CommercialIndustrialWorkspace /></ModuleGuard>} />
                <Route path="calculators" element={<ModuleGuard moduleKey="commercial"><CommercialIndustrialWorkspace /></ModuleGuard>} />
                <Route path="calculators/classic" element={<ModuleGuard moduleKey="commercial"><PropertyCalculators /></ModuleGuard>} />
                <Route path="industrial/:id" element={<ModuleGuard moduleKey="commercial"><IndustrialPropertyDetail /></ModuleGuard>} />
                        </Route>
                        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                      </Suspense>
                    </SearchProvider>
                  </ComparisonProvider>
                </NotificationsProvider>
              </BrowserRouter>
              </PaymentGateProvider>
              </WorkspaceEntitlementsProvider>
            </PermissionsProvider>
          </BrandProvider>
        </AuthProvider>
      </TooltipProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
