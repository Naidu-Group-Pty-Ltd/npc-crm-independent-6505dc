import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
// scroll-area removed: tab row now scrolls natively so arrow buttons work
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Loader2, ArrowLeft, Mail, Phone, Lock, Copy, Check,
  Building2, DollarSign, CreditCard, Briefcase, PiggyBank,
  FileText, Users, MapPin, StickyNote, FolderOpen,
  Calculator, MessageSquare, ChevronRight, Shield, LockOpen, ChevronLeft,
} from 'lucide-react';
import { FINANCE_TABLE_CONFIGS, FINANCE_TABLE_KEYS, FinanceTableKey } from '@/components/finance-portal/financeTableConfig';
import { FinanceRecordList } from '@/components/finance-portal/FinanceRecordList';
import { DocumentVaultPanel } from '@/components/finance-portal/DocumentVaultPanel';
import { BorrowingCapacityPanel } from '@/components/finance-portal/BorrowingCapacityPanel';
import { FinancePortalMessagesPanel } from '@/components/finance-portal/FinancePortalMessagesPanel';
import { ClientPurchaseFilesPanel } from '@/components/finance-portal/ClientPurchaseFilesPanel';
import { ClientMirrorCard } from '@/components/finance-portal/ClientMirrorCard';
import { cn } from '@/lib/utils';
import { smartCapitalize } from '@/lib/nameUtils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

const TAB_ICONS: Record<string, any> = {
  properties: Building2,
  income: DollarSign,
  expenses: CreditCard,
  assets: PiggyBank,
  liabilities: CreditCard,
  employment: Briefcase,
  notes: StickyNote,
  contacts: Users,
  address_history: MapPin,
  documents: FolderOpen,
  borrowing_capacity: Calculator,
  messages: MessageSquare,
};

function getInitials(name?: string): string {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function getAvatarColor(name?: string): string {
  if (!name) return 'hsl(var(--primary))';
  const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const hues = [25, 45, 200, 260, 330, 150, 10, 280];
  return `hsl(${hues[hash % hues.length]}, 55%, 50%)`;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  }, [text, label]);

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded-md hover:bg-muted/60 transition-colors inline-flex items-center"
      title={`Copy ${label}`}
    >
      {copied ? (
        <Check className="h-3 w-3 text-success" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground/50 hover:text-muted-foreground" />
      )}
    </button>
  );
}

function ProfileSkeleton() {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <Skeleton className="h-5 w-32" />
      <div className="flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-28 rounded-lg shrink-0" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

interface TabDef {
  key: string;
  label: string;
  icon: any;
  locked: boolean;
  count?: number;
}

export default function FinancePortalClientProfile() {
  const { clientId } = useParams<{ clientId: string }>();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab');
  const { invokeFinanceFunction } = useFinancePortalAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ['finance-portal-client-summary', clientId],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction('finance-portal-client-data', {
        operation: 'get_client_summary',
        client_id: clientId,
      });
      if (error) throw new Error(error.message);
      return data as {
        client: any;
        permissions: Record<string, { view: boolean; edit: boolean; delete: boolean }>;
        counts?: Record<string, number>;
      };
    },
    enabled: !!clientId,
  });

  const permissions = data?.permissions || {};
  const counts = data?.counts || {};

  // Build tab definitions with icons, lock status, and counts
  const allTabs = useMemo(() => {
    const tabs: TabDef[] = [];

    // Standard table tabs
    FINANCE_TABLE_KEYS.forEach((k) => {
      const hasView = permissions[k]?.view;
      tabs.push({
        key: k,
        label: FINANCE_TABLE_CONFIGS[k].label,
        icon: TAB_ICONS[k] || FileText,
        locked: !hasView,
        count: counts[k],
      });
    });

    // Special tabs
    // Phase 4: Purchase Files tab — default-allow, mirrors the matrix default in the edge fn
    const pfVisible = permissions.purchase_files ? !!permissions.purchase_files.view : true;
    tabs.push({ key: 'purchase_files', label: 'Purchase Files', icon: Briefcase, locked: !pfVisible });

    const docsVisible = permissions.documents ? !!permissions.documents.view : true;
    tabs.push({ key: 'documents', label: 'Documents', icon: FolderOpen, locked: !docsVisible, count: counts.documents });

    const bcVisible = permissions.borrowing_capacity ? !!permissions.borrowing_capacity.view : true;
    tabs.push({ key: 'borrowing_capacity', label: 'Borrowing Capacity', icon: Calculator, locked: !bcVisible });

    const msgVisible = permissions.messages ? !!permissions.messages.view : true;
    tabs.push({ key: 'messages', label: 'Messages', icon: MessageSquare, locked: !msgVisible, count: counts.messages });

    return tabs;
  }, [permissions, counts]);

  const unlockedTabs = allTabs.filter(t => !t.locked);
  const defaultTab = initialTab && unlockedTabs.some(t => t.key === initialTab)
    ? initialTab
    : unlockedTabs[0]?.key || '';

  const [activeTab, setActiveTab] = useState(defaultTab);
  const tabsScrollRef = useRef<HTMLDivElement | null>(null);

  // Update active tab when default changes
  useEffect(() => {
    if (!activeTab && defaultTab) setActiveTab(defaultTab);
  }, [defaultTab]);

  const activeIndex = unlockedTabs.findIndex(t => t.key === activeTab);
  const canGoPrev = activeIndex > 0;
  const canGoNext = activeIndex >= 0 && activeIndex < unlockedTabs.length - 1;

  const goToTab = useCallback((direction: 'prev' | 'next') => {
    if (activeIndex < 0) return;
    const nextIdx = direction === 'prev' ? activeIndex - 1 : activeIndex + 1;
    const target = unlockedTabs[nextIdx];
    if (target) setActiveTab(target.key);
  }, [activeIndex, unlockedTabs]);

  // Keep the active tab scrolled into view
  useEffect(() => {
    const node = tabsScrollRef.current;
    if (!node || !activeTab) return;
    const activeButton = node.querySelector<HTMLButtonElement>(`button[data-tab-key="${activeTab}"]`);
    activeButton?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeTab]);

  if (isLoading) return <ProfileSkeleton />;

  if (error || !data?.client) {
    const msg = (error as Error)?.message || 'Client not accessible';
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Card>
          <CardContent className="py-16 text-center">
            <div className="p-4 rounded-full bg-destructive/5 mx-auto w-fit mb-4">
              <Lock className="h-10 w-10 text-destructive/40" />
            </div>
            <p className="text-sm text-destructive font-medium">{msg}</p>
            <Button asChild variant="outline" className="mt-4 gap-2">
              <Link to="/finance/clients"><ArrowLeft className="h-4 w-4" /> Back to clients</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const client = data.client;
  const name = smartCapitalize(client.primary_contact_name) || '—';
  const secondaryName = smartCapitalize(client.secondary_contact_name);
  const avatarBg = getAvatarColor(name);
  const status = (client.status || 'active').toLowerCase();

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      {/* Back button */}
      <Button variant="ghost" asChild size="sm" className="gap-1.5 -ml-2 text-muted-foreground hover:text-foreground">
        <Link to="/finance/clients"><ArrowLeft className="h-4 w-4" /> Back to clients</Link>
      </Button>

      {/* Profile Header */}
      <Card className="overflow-hidden">
        {/* Gold accent stripe */}
        <div className="h-1 bg-gradient-to-r from-primary/80 via-primary to-primary/60" />
        <CardContent className="pt-6 pb-5">
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-5">
            {/* Large Avatar */}
            <Avatar className="h-16 w-16 sm:h-20 sm:w-20 border-3 border-border/30 shrink-0 self-center sm:self-start">
              <AvatarFallback
                className="font-bold text-xl sm:text-2xl text-foreground dark:text-white"
                style={{ backgroundColor: avatarBg }}
              >
                {getInitials(name)}
              </AvatarFallback>
            </Avatar>

            {/* Info */}
            <div className="flex-1 min-w-0 text-center sm:text-left">
              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                <h1 className="text-xl sm:text-2xl font-bold text-foreground truncate">{name}</h1>
                {secondaryName && (
                  <span className="text-sm text-muted-foreground">& {secondaryName}</span>
                )}
                <Badge variant="outline" className="capitalize w-fit mx-auto sm:mx-0">{status}</Badge>
              </div>

              {/* Contact info with copy buttons */}
              <div className="mt-2 space-y-1">
                {client.primary_contact_email && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground justify-center sm:justify-start">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground/60" />
                    <span className="truncate">{client.primary_contact_email}</span>
                    <CopyButton text={client.primary_contact_email} label="Email" />
                  </div>
                )}
                {client.primary_contact_phone && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground justify-center sm:justify-start">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground/60" />
                    <span>{client.primary_contact_phone}</span>
                    <CopyButton text={client.primary_contact_phone} label="Phone" />
                  </div>
                )}
              </div>

              {/* Permission summary */}
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground/60 justify-center sm:justify-start">
                <Shield className="h-3 w-3" />
                <span>{unlockedTabs.length} of {allTabs.length} sections accessible</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Phase 7.3 — Client portal mirror */}
      <ClientMirrorCard clientId={clientId!} />

      {/* Scrollable Tab Bar */}
      {unlockedTabs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <div className="p-4 rounded-full bg-muted mx-auto w-fit mb-4">
              <Lock className="h-10 w-10 text-muted-foreground/30" />
            </div>
            <p className="font-medium text-foreground mb-1">No accessible sections</p>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              You have been assigned to this client but have no view permissions on any section. Contact your account manager.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <TooltipProvider delayDuration={300}>
            <div className="relative">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="absolute left-0 top-1/2 z-10 inline-flex -translate-y-1/2 h-8 w-8 md:h-9 md:w-9 shadow-sm bg-card"
                onClick={() => goToTab('prev')}
                disabled={!canGoPrev}
                aria-label="Previous tab"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="absolute right-0 top-1/2 z-10 inline-flex -translate-y-1/2 h-8 w-8 md:h-9 md:w-9 shadow-sm bg-card"
                onClick={() => goToTab('next')}
                disabled={!canGoNext}
                aria-label="Next tab"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <div className="w-full px-9 md:px-10">
                <div ref={tabsScrollRef} className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-2 px-0.5 scroll-smooth">
                {allTabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.key;
                  const isLocked = tab.locked;

                  const tabButton = (
                    <button
                      key={tab.key}
                      data-tab-key={tab.key}
                      onClick={() => !isLocked && setActiveTab(tab.key)}
                      disabled={isLocked}
                      className={cn(
                        'flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all duration-200 shrink-0 border',
                        isActive
                          ? 'bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20'
                          : isLocked
                            ? 'bg-muted/30 text-muted-foreground/40 border-border/30 cursor-not-allowed'
                            : 'bg-card text-muted-foreground border-border/50 hover:border-primary/20 hover:text-foreground hover:bg-primary/5'
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{tab.label}</span>
                      {tab.count != null && tab.count > 0 && (
                        <Badge
                          variant={isActive ? 'secondary' : 'outline'}
                          className={cn(
                            'h-4 min-w-[16px] px-1 text-[9px] font-bold',
                            isActive && 'bg-primary-foreground/20 text-primary-foreground border-0'
                          )}
                        >
                          {tab.count}
                        </Badge>
                      )}
                      {isLocked ? (
                        <Lock className="h-3 w-3 opacity-50" />
                      ) : (
                        !isActive && <LockOpen className="h-3 w-3 opacity-30" />
                      )}
                    </button>
                  );

                  if (isLocked) {
                    return (
                      <Tooltip key={tab.key}>
                        <TooltipTrigger asChild>{tabButton}</TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">
                          <Lock className="h-3 w-3 inline mr-1" />
                          No permission to view {tab.label}
                        </TooltipContent>
                      </Tooltip>
                    );
                  }
                  return tabButton;
                })}
                </div>
              </div>
            </div>
          </TooltipProvider>

          {/* Tab Content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              {FINANCE_TABLE_KEYS.includes(activeTab as FinanceTableKey) && (
                <FinanceRecordList
                  clientId={clientId!}
                  config={FINANCE_TABLE_CONFIGS[activeTab as FinanceTableKey]}
                />
              )}
              {activeTab === 'documents' && <DocumentVaultPanel clientId={clientId!} />}
              {activeTab === 'borrowing_capacity' && <BorrowingCapacityPanel clientId={clientId!} />}
              {activeTab === 'messages' && <FinancePortalMessagesPanel clientId={clientId!} />}
              {activeTab === 'purchase_files' && <ClientPurchaseFilesPanel clientId={clientId!} />}
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
