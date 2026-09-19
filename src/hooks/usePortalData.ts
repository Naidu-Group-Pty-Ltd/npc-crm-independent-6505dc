import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePortalAuth } from './usePortalAuth';
import { portalSessionBodyFields, portalSessionHeaders } from '@/lib/portalSession';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';

export async function invokePortalEdge(functionName: string, body: Record<string, any>) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      ...portalSessionHeaders(),
    },
    // The HttpOnly session cookie must be attached; see src/lib/portalSession.ts.
    credentials: 'include',
    body: JSON.stringify({ ...body, ...portalSessionBodyFields() }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

export interface PortalDataInclude {
  client?: boolean;
  properties?: boolean;
  employment?: boolean;
  income?: boolean;
  expenses?: boolean;
  assets?: boolean;
  liabilities?: boolean;
  deals?: boolean;
  emails?: boolean;
  files?: boolean;
  borrowingCapacity?: boolean;
  notifications?: boolean;
  messages?: boolean;
  reports?: boolean;
  reportRequests?: boolean;
  lenderSubmissions?: boolean;
  lenderComparisons?: boolean;
  addressHistory?: boolean;
}

/**
 * Fetch all portal client data in a single request
 */
export function usePortalClientData(include: PortalDataInclude = {}) {
  const { user } = usePortalAuth();

  return useQuery({
    queryKey: ['portal-client-data', user?.client_id, include],
    queryFn: () => invokePortalEdge('get-portal-client-data', { include }),
    enabled: !!user?.client_id,
    staleTime: 30000,
  });
}

/**
 * Fetch portal dashboard data (client + properties + deals)
 */
export function usePortalDashboardData() {
  return usePortalClientData({
    client: true,
    properties: true,
    deals: true,
    borrowingCapacity: true,
    notifications: true,
  });
}

/**
 * Fetch portal notifications
 */
export function usePortalNotificationsData() {
  return usePortalClientData({
    client: false,
    properties: false,
    notifications: true,
  });
}

/**
 * Fetch portal messages
 */
export function usePortalMessagesData() {
  return usePortalClientData({
    client: false,
    properties: false,
    messages: true,
  });
}

/**
 * Fetch the client's unified inbox — portal + SMS/WhatsApp/email correspondence
 * across every channel, newest first.
 */
export function usePortalUnifiedInbox() {
  const { user } = usePortalAuth();

  return useQuery({
    queryKey: ['portal-unified-inbox', user?.client_id],
    queryFn: () => invokePortalEdge('client-portal-comms', { operation: 'list' }),
    enabled: !!user?.client_id,
    staleTime: 10000,
    // Poll so CC/Finance-side replies surface without manual refresh.
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Send a client reply into a permitted Finance ↔ Client thread.
 */
export function usePortalSendFinanceReply() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { thread_id: string; message: string }) =>
      invokePortalEdge('client-portal-comms', { operation: 'send_finance_reply', ...params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-unified-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['portal-client-data'] });
    },
  });
}

/** Reply in the canonical Client ↔ Solicitor conversation. */
export function usePortalSendLegalReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { conversation_id: string; message: string; idempotency_key: string }) =>
      invokePortalEdge('client-portal-comms', { operation: 'send_legal_reply', ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal-unified-inbox'] }),
  });
}

/**
 * Fetch portal deal progress data
 */
export function usePortalDealProgressData() {
  return usePortalClientData({
    client: false,
    properties: false,
    deals: true,
  });
}

/**
 * Fetch portal profile data
 */
export function usePortalProfileData() {
  return usePortalClientData({
    client: true,
    properties: false,
  });
}

/**
 * Fetch portal properties data
 */
export function usePortalPropertiesData() {
  return usePortalClientData({
    client: false,
    properties: true,
  });
}

/**
 * Fetch portal employment & finances data
 */
export function usePortalFinancesData() {
  return usePortalClientData({
    client: true,
    employment: true,
    income: true,
    expenses: true,
    assets: true,
    liabilities: true,
  });
}

/**
 * Fetch portal emails
 */
export function usePortalEmailsData() {
  return usePortalClientData({
    client: false,
    properties: false,
    emails: true,
  });
}

/**
 * Fetch portal reports and report requests
 */
export function usePortalReportsAndRequestsData() {
  return usePortalClientData({
    client: false,
    properties: true,
    reports: true,
    reportRequests: true,
  });
}

/**
 * Fetch portal documents
 */
export function usePortalDocumentsData() {
  return usePortalClientData({
    client: false,
    properties: false,
    files: true,
  });
}

/**
 * Fetch portal lender submissions and shared comparisons
 */
export function usePortalLendersData() {
  return usePortalClientData({
    client: false,
    properties: false,
    lenderSubmissions: true,
    lenderComparisons: true,
  });
}

/**
 * Mutation hook for updating portal client data
 */
export function usePortalUpdateData() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { operation: string; table: string; data?: Record<string, any>; id?: string }) =>
      invokePortalEdge('manage-portal-client-data', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-client-data'] });
      queryClient.invalidateQueries({ queryKey: ['portal-unified-inbox'] });
    },
  });
}
