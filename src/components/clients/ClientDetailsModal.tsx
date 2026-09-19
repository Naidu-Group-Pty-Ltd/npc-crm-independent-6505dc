import { useState, useCallback, useEffect, useMemo } from 'react';
import { smartCapitalize } from '@/lib/nameUtils';
import { isAdvisorySourced } from '@/utils/propertySourcing';
import { useIsMobile } from '@/hooks/use-mobile';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { useSecureClientData } from '@/hooks/useSecureClientData';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PortfolioAnalysisConfig, PortfolioAnalysisSettings, DEFAULT_SETTINGS } from '@/components/clients/review-wizard/PortfolioAnalysisConfig';
import {
  User,
  Building2,
  Briefcase,
  DollarSign,
  PiggyBank,
  CreditCard,
  TrendingUp,
  TrendingDown,
  MapPin,
  Phone,
  Mail,
  Calendar,
  MessageSquare,
  Tag,
  Bell,
  Activity,
  FileUp,
  Sparkles,
  UserCog,
  Send,
  Loader2,
  Settings,
  Edit,
  Landmark,
  ClipboardCheck,
  Inbox,
  FileSignature,
  ExternalLink,
} from 'lucide-react';
import { format } from 'date-fns';
import { ClientNotes } from './ClientNotes';
import { ClientAmlSummaryCard } from './ClientAmlSummaryCard';
import { ClientAmlActivateAction } from './ClientAmlActivateAction';
import { ClientTags } from './ClientTags';
import { ClientReminders } from './ClientReminders';
import { ClientActivityTimeline } from './ClientActivityTimeline';
import { ClientFiles } from './ClientFiles';
import { ClientScoreCard } from './ClientScoreCard';
import { BorrowingCapacityCard, BorrowingCapacityModal } from '@/components/borrowing-capacity';
import { ClientCommercialIndustrialTab } from './ClientCommercialIndustrialTab';
import { ClientCommercialIndustrialSnapshot } from './ClientCommercialIndustrialSnapshot';
import { ClientAIInsights } from './ClientAIInsights';
import { PORTFOLIO_REPORT_LABEL } from '@/lib/reports/portfolio/label';
import { ClientFormaraUpload } from './ClientFormaraUpload';
import { ClientFormaraForms } from './ClientFormaraForms';
import { PropertyManualEntry } from './PropertyManualEntry';
import { PersonalDetailsManualEntry } from './PersonalDetailsManualEntry';
import { EmploymentManualEntry } from './EmploymentManualEntry';
import { AddressHistoryManualEntry } from './AddressHistoryManualEntry';
import { useClientContacts } from './hooks/useClientContacts';
import { IncomeManualEntry } from './IncomeManualEntry';
import { AssetManualEntry } from './AssetManualEntry';
import { LiabilityManualEntry } from './LiabilityManualEntry';
import { ExpenseManualEntry } from './ExpenseManualEntry';
import { ExportFormaraButton } from './ExportFormaraButton';
import { ClientEmailCompose } from './ClientEmailCompose';
import { ClientReportsTab } from './ClientReportsTab';
import { FormaraPDFGenerator } from './FormaraPDFGenerator';
import { ClientDetailsDownloadButton } from './ClientDetailsDownloadButton';
import { PropertyEditSheet } from './PropertyEditSheet';
import { ClientPropertyInvestmentReport } from './ClientPropertyInvestmentReport';
import { CGTCalculator } from './CGTCalculator';
import { ClientPortfolioActions } from './ClientPortfolioActions';
import { PortfolioAnalysisPDFGenerator } from './PortfolioAnalysisPDFGenerator';
import { ReviewWizard } from './review-wizard';
import { ClientEmailsTab } from './ClientEmailsTab';
import { ClientSentReportsTab } from './ClientSentReportsTab';
import { SendPortfolioToClientDialog } from './SendPortfolioToClientDialog';
import { ClientReportRequestsTab } from './ClientReportRequestsTab';
import { ClientAppointmentsTab } from './ClientAppointmentsTab';
import { DealTrackerTab } from './deal-tracker';
import { SendAgreementDialog } from '../agreements/SendAgreementDialog';
import { SendPortalInviteDialog } from '../portal/SendPortalInviteDialog';
import { LeadSourceCard } from './LeadSourceCard';
import { ClientConversationsTab } from './ClientConversationsTab';
import { ClientPortalMessagesPanel } from './ClientPortalMessagesPanel';
import { StaffFinancePortalMessagesPanel } from './StaffFinancePortalMessagesPanel';
import { LenderSubmissionsPanel } from '@/components/lenders/LenderSubmissionsPanel';
import { LenderComparisonSheets } from '@/components/lenders/LenderComparisonSheets';
import { FinancePartnersCard } from './FinancePartnersCard';
import { ClientAssignmentsCard } from './ClientAssignmentsCard';
import { toast } from 'sonner';
import { useCapabilityResolver } from '@/hooks/useCapability';
import type { CapabilityKey } from '@/lib/entitlements';
import {
  CLIENT_TABS,
  CLIENT_ACTION_CAPABILITIES,
  resolveClientTab,
} from './clientWorkspaceRegistry';
import { CLIENT_CI_TAB } from '@/lib/ciAssessment/clientRoute';
interface ClientDetailsModalProps {
  client: {
    id: string;
    primary_first_name: string;
    primary_surname: string;
    primary_email: string | null;
    primary_mobile: string | null;
    /** Real active status from `clients.is_active` — distinct from is_favorite. */
    is_active?: boolean | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: string;
  initialDealId?: string;
}

export function ClientDetailsModal({ client, open, onOpenChange, initialTab, initialDealId }: ClientDetailsModalProps) {
  const isMobile = useIsMobile();
  const { resolve: resolveCapability } = useCapabilityResolver();

  // Capability gate for tabs and actions. While the entitlement snapshot is
  // still loading the surface stays visible (no flash of an emptied
  // workspace); once resolved the answer is exact and hidden tabs are
  // removed from the trigger list, the swipe order and the a11y tree.
  const can = useCallback(
    (key: CapabilityKey | string) => {
      const decision = resolveCapability(key);
      return decision.enabled || decision.status === 'loading';
    },
    [resolveCapability],
  );

  const visibleTabs = useMemo(() => CLIENT_TABS.filter((tab) => can(tab.capability)), [can]);
  const tabOrder = useMemo(() => visibleTabs.map((tab) => tab.value), [visibleTabs]);
  const [showEmailCompose, setShowEmailCompose] = useState(false);
  const [pdfAttachment, setPdfAttachment] = useState<{ blob: Blob; fileName: string } | null>(null);
  // Who the composed email is addressed to, when that is not the client.
  // Cleared when the dialog closes so the next send cannot inherit it.
  const [emailRecipient, setEmailRecipient] = useState<{ name: string; email: string } | null>(null);
  const [isPreparingPortfolio, setIsPreparingPortfolio] = useState(false);
  const [isSendPortfolioModalOpen, setIsSendPortfolioModalOpen] = useState(false);
  const [portfolioAnalysisConfig, setPortfolioAnalysisConfig] = useState<PortfolioAnalysisSettings>(DEFAULT_SETTINGS);
  const [showPortfolioConfig, setShowPortfolioConfig] = useState(false);
  const [portfolioEmailSubject, setPortfolioEmailSubject] = useState('');
  const [portfolioEmailBody, setPortfolioEmailBody] = useState('');
  const [editingProperty, setEditingProperty] = useState<any>(null);
  const [showReviewWizard, setShowReviewWizard] = useState(false);
  const [showBorrowingCalculator, setShowBorrowingCalculator] = useState(false);
  const [showAgreementDialog, setShowAgreementDialog] = useState(false);
  const [showPortalInviteDialog, setShowPortalInviteDialog] = useState(false);
  const [viewAsClientBusy, setViewAsClientBusy] = useState(false);
  const [activeTab, setActiveTab] = useState(() => resolveClientTab(initialTab, tabOrder));

  // A changed initialTab (deep link into an already-open workspace) and an
  // entitlement resolution that removed the active tab both land on a valid
  // tab — never a hidden pane, never a blank one.
  useEffect(() => {
    setActiveTab(resolveClientTab(initialTab, tabOrder));
     
  }, [initialTab, client.id]);
  useEffect(() => {
    if (!tabOrder.includes(activeTab)) {
      setActiveTab(resolveClientTab(null, tabOrder));
    }
     
  }, [tabOrder]);

  const handleViewAsClient = useCallback(async () => {
    if (viewAsClientBusy) return;
    setViewAsClientBusy(true);
    try {
      const { data, error } = await invokeSecureFunction('staff-client-portal-handoff-create', {
        client_id: client.id,
        readonly: false,
      });
      if (error || !data?.token) {
        throw new Error(error?.message || data?.error || 'Could not create portal access link');
      }
      const url = `/client/handoff?token=${encodeURIComponent(data.token)}&portalUserId=${encodeURIComponent(data.target_portal_user_id)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      toast.error(e?.message || 'Could not open client portal');
    } finally {
      setViewAsClientBusy(false);
    }
  }, [client.id, viewAsClientBusy]);

  // Swipe order IS the visible tab order — an entitlement change reshapes
  // both together, and the handlers depend on tabOrder so they never close
  // over a stale list.
  const tabSwipeHandlers = useSwipeGesture(
    useCallback(() => {
      // Swipe left = next tab
      setActiveTab(prev => {
        const idx = tabOrder.indexOf(prev);
        return idx < tabOrder.length - 1 ? tabOrder[idx + 1] : prev;
      });
    }, [tabOrder]),
    useCallback(() => {
      // Swipe right = previous tab
      setActiveTab(prev => {
        const idx = tabOrder.indexOf(prev);
        return idx > 0 ? tabOrder[idx - 1] : prev;
      });
    }, [tabOrder]),
    { threshold: 60 }
  );

  // Handle PDF email callback (for finance)
  /**
   * Audit item 12 — a PDF, and who it is for.
   *
   * This used to take the document alone, so the compose window fell back to
   * the client on every path. Two of them reach it: the client-details
   * download (which passes no recipient and stays addressed to the client)
   * and "Send to Finance → Compose Email with PDF" (which now asks who first,
   * through the same picker "Quick Send" uses).
   */
  const handlePdfEmailClick = (
    pdfBlob: Blob,
    fileName: string,
    recipient?: { name: string; email: string },
  ) => {
    setPdfAttachment({ blob: pdfBlob, fileName });
    setEmailRecipient(recipient ?? null);
    setShowEmailCompose(true);
    toast.success('PDF attached to email');
  };

  // The header action publishes an existing, saved report. Generation remains in the canonical Reports workflow.
  const handleSendPortfolioToClient = () => {
    if (isPreparingPortfolio) return;
    if (!client.id) {
      toast.error('This client could not be resolved. Please close and reopen the client.');
      return;
    }
    setIsPreparingPortfolio(true);
    setIsSendPortfolioModalOpen(true);
    window.setTimeout(() => setIsPreparingPortfolio(false), 0);
  };

  useEffect(() => {
    setIsSendPortfolioModalOpen(false);
    setIsPreparingPortfolio(false);
  }, [client.id]);

  const queryClient = useQueryClient();

  // Use secure data fetching hook - fetches all client data via Edge Function with fallback
  const { data: secureData, refetch: refetchSecureData } = useSecureClientData({
    clientId: client.id,
    include: {
      client: true,
      properties: true,
      employment: true,
      income: true,
      incomeSources: true,
      assets: true,
      liabilities: true,
      expenses: true,
      additionalContacts: true,
      // Deals are a Growth-and-up (or add-on) capability: a workspace that
      // does not hold it must not fetch deal records at all.
      deals: can('client.deals'),
      attributions: true,
    },
    enabled: open,
  });

  // Extract data from secure response
  const fullClient = secureData?.client || null;
  const properties = secureData?.properties || [];
  const employment = secureData?.employment || [];
  const income = secureData?.income || [];
  const incomeSources = secureData?.incomeSources || [];
  const assets = secureData?.assets || [];
  const liabilities = secureData?.liabilities || [];
  const expenses = secureData?.expenses || [];
  const additionalContacts = secureData?.additionalContacts || [];
  const attributions = secureData?.attributions || [];

  // Build dynamic contact list for employment/income tabs
  const contacts = useClientContacts(fullClient || undefined, additionalContacts);

  // Authoritative active status (clients.is_active). Never derived from
  // is_favorite — favourite and active are separate concepts.
  const clientIsActive: boolean | null =
    (fullClient as any)?.is_active ?? client.is_active ?? null;

  // Refetch function for backward compatibility
  const refetchClient = () => {
    refetchSecureData();
    // Also invalidate legacy query keys for components that might still use them
    queryClient.invalidateQueries({ queryKey: ['client-details', client.id] });
    queryClient.invalidateQueries({ queryKey: ['client-properties', client.id] });
  };

  const formatCurrency = (value: number | null) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return format(new Date(dateStr), 'dd MMM yyyy');
  };

  // Shared content for both mobile and desktop
  const modalContent = (
    <>
      {/* Header actions - always wrap cleanly to avoid overflow */}
      <div className={cn(
        "client-action-toolbar flex min-w-0 flex-wrap items-center gap-2 overflow-visible px-1 [&>button]:h-9 [&>button]:max-w-full [&>button]:whitespace-normal [&>button]:transition-all [&>button]:duration-200 [&>button]:focus-visible:ring-2 [&>button]:focus-visible:ring-ring sm:[&>button]:whitespace-nowrap",
        isMobile ? "pb-2 border-b border-border mb-2" : "mr-10 pr-2"
      )}>

        {/*
          First in the toolbar, and the document's one primary control since
          the legacy consolidation. It offers the same three destinations —
          save, attach to an email, send through the Finance Portal — and what
          arrives is selectable text rather than a stack of page images. The
          server reads the record itself, so this needs only the id. The two
          legacy raster buttons survive at the end of the toolbar with their
          layout named.
        */}
        {can(CLIENT_ACTION_CAPABILITIES.downloadPdf) && (
          <ClientDetailsDownloadButton
            clientId={client.id}
            clientName={`${client.primary_first_name} ${client.primary_surname}`}
            onAttachToEmail={handlePdfEmailClick}
          />
        )}

        {can(CLIENT_ACTION_CAPABILITIES.review) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowReviewWizard(true)}
            disabled={properties.length === 0}
            title={properties.length === 0 ? 'Add properties to start a review' : `Start the ${PORTFOLIO_REPORT_LABEL} wizard`}
          >
            <ClipboardCheck className="h-4 w-4 mr-1.5" />
            <span className={isMobile ? "text-xs" : ""}>Review</span>
          </Button>
        )}

        {can(CLIENT_ACTION_CAPABILITIES.portfolioAnalysis) && properties.length > 0 && (
          <PortfolioAnalysisPDFGenerator
            clientId={client.id}
            clientName={`${client.primary_first_name} ${client.primary_surname}`}
            onComplete={() => queryClient.invalidateQueries({ queryKey: ['portfolio-analysis-reports', client.id] })}
          />
        )}

        {can(CLIENT_ACTION_CAPABILITIES.sendPortfolio) && (
          <Button
            variant="default"
            size="sm"
            onClick={handleSendPortfolioToClient}
            type="button"
            disabled={isPreparingPortfolio}
            title="Send a saved portfolio analysis report to the client portal"
          >
            {isPreparingPortfolio ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-1.5" />
            )}
            <span className={isMobile ? "text-xs" : ""}>{isPreparingPortfolio ? "Preparing Portfolio…" : isMobile ? "Send" : "Send Portfolio to Client"}</span>
          </Button>
        )}

        {can(CLIENT_ACTION_CAPABILITIES.sendAgreement) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAgreementDialog(true)}
            disabled={!client.primary_email}
            title={!client.primary_email ? 'Client has no email' : 'Send Buyer\'s Agent Agreement via DocuSign'}
          >
            <FileSignature className="h-4 w-4 mr-1.5" />
            <span className={isMobile ? "text-xs" : ""}>{isMobile ? "Agreement" : "Send Agreement"}</span>
          </Button>
        )}

        {/* Direct AML/CTF activation entry point (route handoff — client ID
            only in the URL). Status-aware: Activate / Start / Open AML Case.
            Gated by the AML/CTF entitlement (SKU or add-on), then by the
            component's own AML role checks. */}
        {can('module.aml_ctf') && (
          <ClientAmlActivateAction
            clientId={client.id}
            isActive={clientIsActive}
            compact={isMobile}
          />
        )}

        {/*
          The legacy raster generator, demoted to the end of the toolbar with
          its layout named. The typeset control above owns all three
          destinations now; these stay because the raster document has
          capabilities the typeset one does not carry (the owner-occupied
          summary toggle, the borrowing-capacity appendix) and because a
          partner's workflow may depend on the exact document. Hidden behind
          the unified delivery, never deleted — the legacy-consolidation rule.
        */}
        {can(CLIENT_ACTION_CAPABILITIES.sendToFinance) && (
          <FormaraPDFGenerator
            data={{
              client: (fullClient || {
                id: client.id,
                primary_first_name: client.primary_first_name,
                primary_surname: client.primary_surname,
                primary_email: client.primary_email,
                primary_mobile: client.primary_mobile,
              }) as any,
              properties: properties as any[],
              employment: employment as any[],
              income: income as any[],
              incomeSources: incomeSources as any[],
              assets: assets as any[],
              liabilities: liabilities as any[],
              expenses: expenses as any[],
            }}
            clientName={`${client.primary_first_name} ${client.primary_surname}`}
            onEmailClick={handlePdfEmailClick}
            buttonLabel={isMobile ? "Finance (legacy)" : "Send to Finance (legacy layout)"}
            variant="ghost"
          />
        )}

        {can(CLIENT_ACTION_CAPABILITIES.downloadPdf) && (
          <FormaraPDFGenerator
            data={{
              client: (fullClient || client) as any,
              properties: properties as any[], employment: employment as any[], income: income as any[], incomeSources: incomeSources as any[],
              assets: assets as any[], liabilities: liabilities as any[], expenses: expenses as any[],
            }}
            clientName={`${client.primary_first_name} ${client.primary_surname}`}
            buttonLabel={isMobile ? 'Download (legacy)' : 'Download (legacy layout)'}
            action="download"
            variant="ghost"
          />
        )}

        {can(CLIENT_ACTION_CAPABILITIES.portalAccess) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPortalInviteDialog(true)}
            title="Manage client portal access"
          >
            <UserCog className="h-4 w-4 mr-1.5" />
            <span className={isMobile ? "text-xs" : ""}>{isMobile ? "Portal" : "Portal Access"}</span>
          </Button>
        )}

        {can(CLIENT_ACTION_CAPABILITIES.viewAsClient) && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleViewAsClient}
            disabled={viewAsClientBusy}
            title="Open the client portal in a new tab as this client"
          >
            {viewAsClientBusy
              ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              : <ExternalLink className="h-4 w-4 mr-1.5" />}
            <span className={isMobile ? "text-xs" : ""}>{isMobile ? "View" : "View as Client"}</span>
          </Button>
        )}
      </div>
      <Separator className="my-1" />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden w-full">
        <div className="sticky top-0 z-10 min-w-0 max-w-full flex-shrink-0 overflow-hidden bg-background pb-1">
          <TabsList className="!flex h-auto w-full max-w-full flex-wrap justify-start gap-1.5 !overflow-visible !snap-none p-1.5">
            {visibleTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="min-h-9 px-3 py-1.5 text-sm font-medium">
                {tab.icon && <tab.icon className="h-3 w-3 mr-0.5" />}
                {tab.showsPropertyCount ? `${tab.label} (${properties.length})` : tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable]">
          <div className="min-w-0 w-full" {...(isMobile ? tabSwipeHandlers : {})}>
            <TabsContent value="overview" className="space-y-4 mt-4">
              {/* Persistent AML/CTF summary — renders nothing for users
                  without AML access or while the integration flag is off. */}
              <ClientAmlSummaryCard
                clientId={client.id}
                clientName={`${smartCapitalize(client.primary_first_name || '')} ${smartCapitalize(client.primary_surname || '')}`.trim()}
                isActive={clientIsActive}
              />

              {/* Commercial & Industrial, when there is any. Renders nothing
                  for a client without linked assessments, and nothing for a
                  workspace that cannot see the module. */}
              {visibleTabs.some((tab) => tab.value === CLIENT_CI_TAB) ? (
                <ClientCommercialIndustrialSnapshot
                  clientId={client.id}
                  onOpenTab={() => setActiveTab(CLIENT_CI_TAB)}
                />
              ) : null}

              {/* Contact Info */}
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Primary Contact</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span>{fullClient?.primary_first_name} {fullClient?.primary_middle_name} {fullClient?.primary_surname}</span>
                    </div>
                    {fullClient?.primary_email && (
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <span>{fullClient.primary_email}</span>
                      </div>
                    )}
                    {fullClient?.primary_mobile && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <span>{fullClient.primary_mobile}</span>
                      </div>
                    )}
                    {fullClient?.primary_dob && (
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span>{formatDate(fullClient.primary_dob)}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {fullClient?.secondary_first_name && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Secondary Contact</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span>{fullClient.secondary_first_name} {fullClient.secondary_middle_name} {fullClient.secondary_surname}</span>
                      </div>
                      {fullClient.secondary_email && (
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          <span>{fullClient.secondary_email}</span>
                        </div>
                      )}
                      {fullClient.secondary_mobile && (
                        <div className="flex items-center gap-2">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          <span>{fullClient.secondary_mobile}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Portfolio Summary */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Portfolio Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Total Portfolio Value</p>
                      <p className="text-xl font-bold">{formatCurrency(Number(fullClient?.total_portfolio_value))}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Debt</p>
                      <p className="text-xl font-bold">{formatCurrency(Number(fullClient?.total_debt))}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Net Monthly Cash Flow</p>
                      <p className={`text-xl font-bold flex items-center gap-1 ${Number(fullClient?.net_monthly_cash_flow) >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {Number(fullClient?.net_monthly_cash_flow) >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                        {formatCurrency(Number(fullClient?.net_monthly_cash_flow))}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Lead Source Attribution */}
              <LeadSourceCard
                clientId={client.id}
                attributions={attributions}
                onRefresh={refetchClient}
              />

              {/* Client Assignments — Finance contact + Internal team member */}
              <ClientAssignmentsCard
                clientId={client.id}
                financeContactId={(fullClient as any)?.finance_contact_id ?? null}
                assignedTeamUserId={(fullClient as any)?.assigned_team_user_id ?? null}
                onSaved={refetchClient}
              />

              {/* Finance Partners (Three-way sync entry point) */}
              <FinancePartnersCard
                clientId={client.id}
                clientName={`${client.primary_first_name} ${client.primary_surname}`.trim()}
              />
            </TabsContent>

            {/* Personal Details Tab - Formara Mirror */}
            <TabsContent value="personal" className="mt-4">
              <PersonalDetailsManualEntry 
                clientId={client.id} 
                clientData={fullClient ? {
                  primary_first_name: fullClient.primary_first_name,
                  primary_middle_name: fullClient.primary_middle_name,
                  primary_surname: fullClient.primary_surname,
                  primary_mobile: fullClient.primary_mobile,
                  primary_email: fullClient.primary_email,
                  primary_gender: fullClient.primary_gender,
                  primary_dob: fullClient.primary_dob,
                  secondary_first_name: fullClient.secondary_first_name,
                  secondary_middle_name: fullClient.secondary_middle_name,
                  secondary_surname: fullClient.secondary_surname,
                  secondary_mobile: fullClient.secondary_mobile,
                  secondary_email: fullClient.secondary_email,
                  secondary_gender: fullClient.secondary_gender,
                  secondary_dob: fullClient.secondary_dob,
                  current_address: fullClient.current_address,
                  current_suburb: fullClient.current_suburb,
                  current_state: fullClient.current_state,
                  current_postcode: fullClient.current_postcode,
                  country: fullClient.country,
                  living_situation: fullClient.living_situation,
                  residential_status: fullClient.residential_status,
                  secondary_current_address: fullClient.secondary_current_address,
                  secondary_current_suburb: fullClient.secondary_current_suburb,
                  secondary_current_state: fullClient.secondary_current_state,
                  secondary_current_postcode: fullClient.secondary_current_postcode,
                  secondary_country: fullClient.secondary_country,
                  secondary_living_situation: fullClient.secondary_living_situation,
                  secondary_residential_status: fullClient.secondary_residential_status,
                  secondary_same_address_as_primary: fullClient.secondary_same_address_as_primary,
                  marital_status: fullClient.marital_status,
                  dependents_count: fullClient.dependents_count,
                } : undefined}
                additionalContacts={additionalContacts.map(c => ({
                  id: c.id,
                  client_id: c.client_id,
                  relationship: c.relationship,
                  first_name: c.first_name,
                  surname: c.surname,
                  middle_name: c.middle_name,
                  email: c.email,
                  mobile: c.mobile,
                  dob: c.dob,
                  gender: c.gender,
                  display_order: c.display_order,
                }))}
                onComplete={() => refetchClient()} 
              />
              <AddressHistoryManualEntry clientId={client.id} contacts={contacts} onComplete={() => refetchClient()} />
            </TabsContent>

            <TabsContent value="properties" className={cn("space-y-4 mt-4", !isMobile && "max-w-3xl mx-auto w-full")}>
              {/* Property Actions Bar */}
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <PropertyManualEntry 
                    clientId={client.id} 
                    onComplete={() => {
                      refetchClient();
                    }} 
                  />
                  <ExportFormaraButton 
                    clientId={client.id} 
                    clientName={`${client.primary_first_name} ${client.primary_surname}`}
                  />
                </div>
              </div>

              {/* Client Detail Form Upload Section */}
              <ClientFormaraUpload
                clientId={client.id}
                clientName={`${client.primary_first_name} ${client.primary_surname}`}
                existingProperties={properties.map(p => ({
                  id: p.id,
                  address: p.address,
                  property_type: p.property_type,
                  value: p.value ? Number(p.value) : null
                }))}
                onComplete={() => {
                  refetchClient();
                }}
              />

              {/* Portfolio Actions - Analysis & Comparison */}
              <ClientPortfolioActions
                clientId={client.id}
                clientName={`${client.primary_first_name} ${client.primary_surname}`}
                properties={properties.map(p => ({
                  id: p.id,
                  address: p.address,
                  property_type: p.property_type,
                  value: p.value ? Number(p.value) : null
                }))}
              />

              {properties.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <Building2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    No properties recorded
                  </CardContent>
                </Card>
              ) : (
                properties.map((property) => (
                  <Card key={property.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <Badge 
                            variant={property.property_type === 'owner_occupied' ? 'default' : property.property_type === 'smsf' ? 'outline' : property.property_type === 'rental' ? 'outline' : 'secondary'}
                            className={property.property_type === 'smsf' ? 'border-brand-500 text-brand-700 bg-brand-50' : property.property_type === 'rental' ? 'border-info/30 text-info bg-info/10' : ''}
                          >
                            {property.property_type === 'owner_occupied' ? (
                              <>Owner Occupied</>
                            ) : property.property_type === 'smsf' ? (
                              <span className="flex items-center gap-1">
                                <Landmark className="h-3 w-3" />
                                SMSF
                              </span>
                            ) : property.property_type === 'rental' ? (
                              'Rental (Tenant)'
                            ) : (
                              'Investment'
                            )}
                          </Badge>
                          {/* Sourced By Badge */}
                          {property.sourced_by && property.sourced_by !== 'unknown' && (
                            <Badge 
                              variant={isAdvisorySourced(property.sourced_by) ? 'default' : 'outline'}
                              className={
                                isAdvisorySourced(property.sourced_by)
                                  ? 'bg-success hover:bg-success/90 text-success-foreground' 
                                  : property.sourced_by === 'self_sourced'
                                    ? 'border-info text-info bg-info/10'
                                    : 'border-warning text-warning bg-warning/10'
                              }
                            >
                              {isAdvisorySourced(property.sourced_by) ? '🏆 Our Deal' 
                                : property.sourced_by === 'self_sourced' ? 'Self Sourced' 
                                : property.sourced_by === 'other_agency' ? 'Other Agency' 
                                : property.sourced_by}
                            </Badge>
                          )}
                          <CardTitle className="text-base font-medium mt-2 flex items-center gap-2">
                            <MapPin className="h-4 w-4" />
                            {property.address}
                          </CardTitle>
                          {property.property_type === 'smsf' && property.smsf_fund_name && (
                            <p className="text-xs text-muted-foreground mt-1">{property.smsf_fund_name}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {/* Investment Report Button - only for investment properties */}
                          {(property.property_type === 'investment' || property.property_type === 'smsf') && (
                            <ClientPropertyInvestmentReport
                              property={property as any}
                              clientId={client.id}
                              clientName={`${client.primary_first_name} ${client.primary_surname}`}
                            />
                          )}
                          <CGTCalculator
                            property={property as any}
                            clientGrossAnnualIncome={income.reduce((sum: number, inc: any) => sum + (Number(inc.gross_salary) || 0), 0) || Number(fullClient?.total_monthly_income || 0) * 12}
                          />
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => setEditingProperty(property)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-4 md:grid-cols-4 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Value</p>
                          <p className="font-medium">{formatCurrency(Number(property.value))}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Loan Remaining</p>
                          <p className="font-medium">{formatCurrency(Number(property.loan_remaining))}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Interest Rate</p>
                          <p className="font-medium">{property.interest_rate}%</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Ownership</p>
                          <p className="font-medium">{property.ownership_percentage}%</p>
                        </div>
                      </div>
                      {/* Lender & Loan Repayment row */}
                      {(property.lender_name || property.loan_repayment_amount) && (
                        <>
                          <Separator className="my-3" />
                          <div className="grid gap-4 md:grid-cols-3 text-sm">
                            {property.lender_name && (
                              <div>
                                <p className="text-xs text-muted-foreground">Lender / Bank</p>
                                <p className="font-medium">{property.lender_name}</p>
                              </div>
                            )}
                            {property.loan_repayment_amount ? (
                              <div>
                                <p className="text-xs text-muted-foreground">Loan Repayment</p>
                                <p className="font-medium">{formatCurrency(Number(property.loan_repayment_amount))}<span className="text-xs text-muted-foreground ml-1">/{property.loan_repayment_frequency || 'monthly'}</span></p>
                              </div>
                            ) : null}
                            {property.monthly_interest_repayment ? (
                              <div>
                                <p className="text-xs text-muted-foreground">Monthly Interest Repayment</p>
                                <p className="font-medium">{formatCurrency(Number(property.monthly_interest_repayment))}</p>
                              </div>
                            ) : null}
                          </div>
                        </>
                      )}
                      {(property.property_type === 'investment' || property.property_type === 'smsf') && (
                        <>
                          <Separator className="my-4" />
                          <div className="grid gap-4 md:grid-cols-3 text-sm">
                            <div>
                              <p className="text-xs text-muted-foreground">Monthly Rental Income</p>
                              <p className="font-medium text-success">{formatCurrency(Number(property.monthly_rental_income))}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Monthly Expenses</p>
                              <p className="font-medium text-destructive">{formatCurrency(Number(property.total_monthly_expenditure))}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Net Cash Flow</p>
                              <p className={`font-medium ${Number(property.net_monthly_cashflow) >= 0 ? 'text-success' : 'text-destructive'}`}>
                                {formatCurrency(Number(property.net_monthly_cashflow))}
                              </p>
                            </div>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}

              {/* Property Edit Sheet */}
              {editingProperty && (
                <PropertyEditSheet
                  property={editingProperty}
                  open={!!editingProperty}
                  onOpenChange={(open) => !open && setEditingProperty(null)}
                  onComplete={() => {
                    setEditingProperty(null);
                    refetchClient();
                  }}
                />
              )}
            </TabsContent>

            <TabsContent value="deals" className="space-y-4 mt-4">
              <DealTrackerTab
                clientId={client.id}
                deals={secureData?.deals || []}
                properties={properties}
                initialDealId={initialDealId}
              />
            </TabsContent>

            <TabsContent value="employment" className={cn("space-y-4 mt-4", !isMobile && "max-w-3xl mx-auto w-full")}>
              <EmploymentManualEntry clientId={client.id} contacts={contacts} onComplete={() => refetchClient()} />
            </TabsContent>

            <TabsContent value="financials" className={cn("space-y-6 mt-4", !isMobile && "max-w-3xl mx-auto w-full")}>
              {/* Income Section */}
              <IncomeManualEntry clientId={client.id} contacts={contacts} onComplete={() => refetchClient()} />
              
              <Separator />
              
              {/* Living Expenses Section */}
              <ExpenseManualEntry clientId={client.id} onComplete={() => refetchClient()} />
              
              <Separator />
              
              {/* Assets Section */}
              <AssetManualEntry clientId={client.id} onComplete={() => refetchClient()} />
              
              <Separator />
              
              {/* Liabilities Section */}
              <LiabilityManualEntry clientId={client.id} onComplete={() => refetchClient()} />
            </TabsContent>

            <TabsContent value="reports" className={cn("mt-4 min-w-0 overflow-hidden", !isMobile && "max-w-3xl mx-auto w-full")}>
              <ClientReportsTab
                clientId={client.id}
                clientName={`${client.primary_first_name} ${client.primary_surname}`}
                clientEmail={client.primary_email}
                fullClient={fullClient}
                properties={properties}
                employment={employment}
                income={income}
                assets={assets}
                liabilities={liabilities}
                expenses={expenses}
                onEmailClick={handlePdfEmailClick}
                onOpenEmailCompose={() => { setPdfAttachment(null); setShowEmailCompose(true); }}
              />
            </TabsContent>

            <TabsContent value="sent-reports" className={cn("mt-4", !isMobile && "max-w-3xl mx-auto w-full")}>
              <ClientSentReportsTab
                clientId={client.id}
                clientName={`${client.primary_first_name} ${client.primary_surname}`}
                properties={properties}
              />
            </TabsContent>

            <TabsContent value="report-requests" className={cn("mt-4", !isMobile && "max-w-3xl mx-auto w-full")}>
              <ClientReportRequestsTab
                clientId={client.id}
                clientName={smartCapitalize(`${client.primary_first_name || ''} ${client.primary_surname || ''}`.trim())}
              />
            </TabsContent>

            <TabsContent value="emails" className="mt-4 w-full min-w-0">
              <ClientEmailsTab clientId={client.id} clientName={`${client.primary_first_name} ${client.primary_surname}`} />
            </TabsContent>

            <TabsContent value="conversations" className="mt-4 w-full min-w-0">
              <ClientConversationsTab
                clientId={client.id}
                clientName={`${client.primary_first_name} ${client.primary_surname}`}
                clientEmail={client.primary_email}
                ghlContactId={fullClient?.ghl_contact_id}
              />
            </TabsContent>

            <TabsContent value="portal-messages" className="mt-4 w-full min-w-0">
              <ClientPortalMessagesPanel
                clientId={client.id}
                clientName={`${client.primary_first_name} ${client.primary_surname}`}
              />
            </TabsContent>

            <TabsContent value="finance-messages" className="mt-4 w-full min-w-0">
              <StaffFinancePortalMessagesPanel clientId={client.id} />
            </TabsContent>



            <TabsContent value="appointments" className={cn("mt-4", !isMobile && "max-w-3xl mx-auto w-full")}>
              <ClientAppointmentsTab
                clientId={client.id}
                ghlContactId={fullClient?.ghl_contact_id}
              />
            </TabsContent>

            <TabsContent value="notes" className="mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Activity Notes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ClientNotes clientId={client.id} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="reminders" className={cn("mt-4", !isMobile && "max-w-3xl mx-auto w-full")}>
              <ClientReminders clientId={client.id} followUpDate={fullClient?.follow_up_date} />
            </TabsContent>

            <TabsContent value="formara-forms" className={cn("mt-4", !isMobile && "max-w-3xl mx-auto w-full")}>
              <ClientFormaraForms 
                clientId={client.id}
                clientName={`${client.primary_first_name} ${client.primary_surname}`}
              />
            </TabsContent>

            <TabsContent value="files" className={cn("mt-4", !isMobile && "max-w-3xl mx-auto w-full")}>
              <ClientFiles 
                clientId={client.id} 
                onSendEmail={(attachment) => {
                  setShowEmailCompose(true);
                }}
              />
            </TabsContent>

            <TabsContent value="activity" className={cn("mt-4", !isMobile && "max-w-3xl mx-auto w-full")}>
              <ClientActivityTimeline clientId={client.id} />
            </TabsContent>

            <TabsContent value="borrowing" className="mt-4 space-y-4">
              <BorrowingCapacityCard 
                clientId={client.id}
                clientName={`${client.primary_first_name || ''} ${client.primary_surname || ''}`.trim()}
                onOpenCalculator={() => setShowBorrowingCalculator(true)}
              />
            </TabsContent>

            <TabsContent value="commercial-industrial" className="mt-4 space-y-4">
              <ClientCommercialIndustrialTab clientId={client.id} />
            </TabsContent>

            <TabsContent value="lenders" className="mt-4 space-y-4">
              <LenderSubmissionsPanel clientId={client.id} />
              <LenderComparisonSheets clientId={client.id} />
            </TabsContent>

            <TabsContent value="insights" className="mt-4 space-y-4">
              <ClientScoreCard clientId={client.id} />
              <ClientTags clientId={client.id} />
              <ClientAIInsights clientId={client.id} />
            </TabsContent>
          </div>
        </div>
      </Tabs>
      </>
  );

  return (
    <>
      {isMobile ? (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="bottom" className="h-[95vh] flex flex-col p-0">
            <SheetHeader className="px-4 pt-4 pb-2 border-b shrink-0">
              <SheetTitle className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2 text-base">
                  <User className="h-4 w-4" />
                  {client.primary_first_name} {client.primary_surname}
                </span>
                {client.primary_email && (
                  <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                    <Mail className="h-3 w-3" />
                    {client.primary_email}
                  </span>
                )}
                {client.primary_mobile && (
                  <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    {client.primary_mobile}
                  </span>
                )}
              </SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-auto px-4 py-2 pb-20">
              {modalContent}
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="flex flex-col overflow-hidden p-4 sm:p-6 h-[min(90vh,900px)] max-h-[90vh] w-[min(95vw,1400px)] max-w-[1400px] sm:h-[min(90vh,900px)] sm:max-h-[90vh] sm:w-[min(95vw,1400px)] sm:max-w-[1400px]">
            <DialogHeader className="min-w-0 shrink-0 pr-12">
              <DialogTitle className="flex min-w-0 items-start gap-3">
                <User className="h-5 w-5 shrink-0" />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="break-words leading-tight">{client.primary_first_name} {client.primary_surname}</span>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs font-normal text-muted-foreground">
                    {client.primary_email && (
                      <span className="flex min-w-0 items-center gap-1 break-all">
                        <Mail className="h-3 w-3 shrink-0" />
                        {client.primary_email}
                      </span>
                    )}
                    {client.primary_mobile && (
                      <span className="flex min-w-0 items-center gap-1 break-words">
                        <Phone className="h-3 w-3 shrink-0" />
                        {client.primary_mobile}
                      </span>
                    )}
                  </div>
                </div>
              </DialogTitle>
              <DialogDescription className="sr-only">
                View and manage client details, properties, and reports
              </DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {modalContent}
            </div>
          </DialogContent>
        </Dialog>
      )}

      <SendPortfolioToClientDialog
        client={client}
        open={isSendPortfolioModalOpen}
        onOpenChange={setIsSendPortfolioModalOpen}
        onGeneratePortfolioAnalysis={() => { setIsSendPortfolioModalOpen(false); setActiveTab('reports'); }}
      />

      {/* Email Compose Modal */}
      <ClientEmailCompose
        open={showEmailCompose}
        onOpenChange={(open) => {
          setShowEmailCompose(open);
          if (!open) {
            setPortfolioEmailSubject('');
            setPortfolioEmailBody('');
            setEmailRecipient(null);
          }
        }}
        clientId={client.id}
        clientEmail={client.primary_email}
        recipient={emailRecipient}
        clientName={`${client.primary_first_name} ${client.primary_surname}`}
        defaultSubject={portfolioEmailSubject || undefined}
        defaultBody={portfolioEmailBody || undefined}
        inlineAttachment={pdfAttachment}
      />

      {/* Portfolio Analysis Wizard */}
      <ReviewWizard
        clientId={client.id}
        clientName={`${client.primary_first_name} ${client.primary_surname}`}
        properties={properties}
        clientData={fullClient}
        isOpen={showReviewWizard}
        onClose={() => setShowReviewWizard(false)}
        onComplete={(reviewId) => {
          setShowReviewWizard(false);
          refetchClient();
          toast.success(`${PORTFOLIO_REPORT_LABEL} completed successfully`);
        }}
      />

      {/* Borrowing Capacity Calculator Modal */}
      <BorrowingCapacityModal
        clientId={client.id}
        open={showBorrowingCalculator}
        onOpenChange={setShowBorrowingCalculator}
      />

      {/* Send Agreement Dialog */}
      <SendAgreementDialog
        open={showAgreementDialog}
        onOpenChange={setShowAgreementDialog}
        client={{
          id: client.id,
          primary_first_name: client.primary_first_name,
          primary_surname: client.primary_surname,
          primary_email: client.primary_email,
          primary_mobile: client.primary_mobile,
          current_address: fullClient?.current_address,
          secondary_first_name: fullClient?.secondary_first_name,
          secondary_surname: fullClient?.secondary_surname,
          // The dialog renders a secondary buyer email field and the prop
          // type has always declared this, but it was never passed — so the
          // field sat blank on every client who has one.
          secondary_email: fullClient?.secondary_email,
        }}
      />

      {/* Portal Invite Dialog */}
      <SendPortalInviteDialog
        open={showPortalInviteDialog}
        onOpenChange={setShowPortalInviteDialog}
        clientId={client.id}
        clientName={`${client.primary_first_name} ${client.primary_surname}`}
        clientEmail={client.primary_email}
      />
    </>
  );
}
