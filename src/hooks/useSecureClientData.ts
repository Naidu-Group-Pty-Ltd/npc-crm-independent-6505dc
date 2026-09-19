import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateClientQueries } from '@/lib/clients/invalidateClientQueries';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { supabase } from '@/integrations/supabase/client';

// Generic types that work with actual database schema
// Using Record<string, any> with key required fields to maintain flexibility
export interface ClientData {
  id: string;
  primary_first_name: string | null;
  primary_surname: string | null;
  created_at: string;
  [key: string]: any; // Allow additional fields from DB
}

export interface ClientProperty {
  id: string;
  client_id: string;
  created_at: string;
  [key: string]: any; // Allow additional fields from DB
}

export interface ClientIncome {
  id: string;
  client_id: string;
  created_at: string;
  [key: string]: any;
}

export interface ClientAsset {
  id: string;
  client_id: string;
  created_at: string;
  [key: string]: any;
}

export interface ClientLiability {
  id: string;
  client_id: string;
  created_at: string;
  [key: string]: any;
}

export interface ClientExpense {
  id: string;
  client_id: string;
  created_at: string;
  [key: string]: any;
}

export interface ClientEmployment {
  id: string;
  client_id: string;
  created_at: string;
  [key: string]: any;
}

export interface SecureClientDataResponse {
  client: ClientData | null;
  properties: ClientProperty[];
  employment: ClientEmployment[];
  income: ClientIncome[];
  assets: ClientAsset[];
  liabilities: ClientLiability[];
  expenses: ClientExpense[];
  incomeSources?: any[];
  notes?: any[];
  files?: any[];
  activities?: any[];
  borrowingCapacity?: any;
  additionalContacts?: AdditionalContactData[];
  deals?: any[];
  attributions?: any[];
}

export interface AdditionalContactData {
  id: string;
  client_id: string;
  relationship: string;
  first_name: string;
  surname: string;
  middle_name?: string;
  email?: string;
  mobile?: string;
  dob?: string;
  gender?: string;
  notes?: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

interface UseSecureClientDataOptions {
  clientId: string;
  include?: {
    client?: boolean;
    properties?: boolean;
    employment?: boolean;
    income?: boolean;
    assets?: boolean;
    liabilities?: boolean;
    expenses?: boolean;
    incomeSources?: boolean;
    notes?: boolean;
    files?: boolean;
    activities?: boolean;
    borrowingCapacity?: boolean;
    additionalContacts?: boolean;
    deals?: boolean;
    attributions?: boolean;
  };
  enabled?: boolean;
}

/**
 * Fetch client data securely via Edge Function
 * All client data access is now restricted to service_role (Edge Functions) only
 * Uses HttpOnly cookies for session authentication
 */
async function fetchClientDataSecure(
  clientId: string,
  include: UseSecureClientDataOptions['include'] = {}
): Promise<SecureClientDataResponse> {
  // Default includes if not specified
  const includeConfig = {
    client: include.client !== false,
    properties: include.properties !== false,
    employment: include.employment !== false,
    income: include.income !== false,
    assets: include.assets !== false,
    liabilities: include.liabilities !== false,
    expenses: include.expenses !== false,
    incomeSources: include.incomeSources ?? false,
    notes: include.notes ?? false,
    files: include.files ?? false,
    activities: include.activities ?? false,
    borrowingCapacity: include.borrowingCapacity ?? false,
    additionalContacts: include.additionalContacts ?? false,
    deals: include.deals ?? false,
    attributions: include.attributions ?? false,
  };

  const { data, error } = await invokeSecureFunction('get-client-data', {
    clientId,
    include: includeConfig,
  });

  if (error) {
    console.error('Secure client data fetch failed:', error);
    throw new Error(error.message || 'Failed to fetch client data');
  }

  if (!data?.success) {
    throw new Error(data?.error || 'Failed to fetch client data');
  }

  return {
    client: data.client || null,
    properties: data.properties || [],
    employment: data.employment || [],
    income: data.income || [],
    assets: data.assets || [],
    liabilities: data.liabilities || [],
    expenses: data.expenses || [],
    incomeSources: data.incomeSources || [],
    notes: data.notes || [],
    files: data.files || [],
    activities: data.activities || [],
    borrowingCapacity: data.borrowingCapacity || null,
    additionalContacts: data.additionalContacts || [],
    deals: data.deals || [],
    attributions: data.attributions || [],
  };
}

/**
 * Hook for fetching client data securely
 * Uses Edge Function with HttpOnly cookie session validation
 */
export function useSecureClientData({
  clientId,
  include = {},
  enabled = true,
}: UseSecureClientDataOptions) {
  return useQuery({
    queryKey: ['secure-client-data', clientId, include],
    queryFn: () => fetchClientDataSecure(clientId, include),
    enabled: enabled && !!clientId,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook for fetching just the client record
 */
export function useSecureClient(clientId: string, enabled = true) {
  return useQuery({
    queryKey: ['secure-client', clientId],
    queryFn: async () => {
      const result = await fetchClientDataSecure(clientId, { 
        client: true, 
        properties: false, 
        employment: false, 
        income: false, 
        assets: false, 
        liabilities: false,
        expenses: false,
      });
      return result.client;
    },
    enabled: enabled && !!clientId,
  });
}

/**
 * Hook for fetching client properties
 */
export function useSecureClientProperties(clientId: string, enabled = true) {
  return useQuery({
    queryKey: ['secure-client-properties', clientId],
    queryFn: async () => {
      const result = await fetchClientDataSecure(clientId, { 
        client: false, 
        properties: true, 
        employment: false, 
        income: false, 
        assets: false, 
        liabilities: false,
        expenses: false,
      });
      return result.properties;
    },
    enabled: enabled && !!clientId,
  });
}

// Type for manage operations
type ManageOperation = 'create' | 'update' | 'delete';
type ManageTable = 'clients' | 'client_properties' | 'client_income' | 'client_assets' | 
                   'client_liabilities' | 'client_expenses' | 'client_employment' | 
                   'client_notes' | 'client_files';

interface ManageClientDataParams {
  operation: ManageOperation;
  table: ManageTable;
  data?: Record<string, any>;
  id?: string;
  clientId?: string;
}

/**
 * Manage client data securely via Edge Function with fallback
 */
async function manageClientDataSecure(params: ManageClientDataParams): Promise<any> {
  try {
    const { data, error } = await invokeSecureFunction('manage-client-data', params);

    if (!error && data?.success) {
      return data.data;
    }
    
    if (error && !error.message?.includes('401')) {
      console.warn('Secure manage failed, falling back to direct query:', error.message);
    }
  } catch (err) {
    console.warn('Edge function call failed, falling back to direct query:', err);
  }

  // Fallback: Direct Supabase operations (backward compatible during transition)
  const { operation, table, data: payload, id } = params;

  switch (operation) {
    case 'create': {
      const { data: result, error } = await supabase
        .from(table)
        .insert(payload as any)
        .select()
        .single();
      if (error) throw error;
      return result;
    }
    case 'update': {
      if (!id) throw new Error('ID required for update');
      const { data: result, error } = await supabase
        .from(table)
        .update(payload as any)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return result;
    }
    case 'delete': {
      if (!id) throw new Error('ID required for delete');
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', id);
      if (error) throw error;
      return { deleted: true };
    }
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

/**
 * Hook for managing client data (create/update/delete)
 */
export function useManageClientData() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: manageClientDataSecure,
    onSuccess: (_, variables) => {
      // This list was correct and it was also the ONLY correct one: three other
      // surfaces wrote their own and each omitted `secure-client-data`, which is
      // what the open client card reads. It is one module now, so a surface can
      // no longer hold a private, shorter copy.
      invalidateClientQueries(queryClient, variables.clientId);
    },
  });
}

/**
 * @deprecated Session tokens are now stored in HttpOnly cookies
 * This function is kept for backward compatibility but always returns null
 */
export function useSessionToken() {
  return null;
}
