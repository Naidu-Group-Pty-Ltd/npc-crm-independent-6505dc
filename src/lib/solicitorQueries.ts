import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeSolicitorFunction } from '@/lib/solicitorPortal';
import type { LegalMatter } from '@/lib/legalMatters';

export const solicitorKeys = {
  session: () => ['solicitor','session'] as const,
  mattersRoot: () => ['solicitor','matters'] as const,
  matters: (filters: MatterFilters) => [...solicitorKeys.mattersRoot(), filters] as const,
  matter: (matterId: string) => ['solicitor','matter',matterId] as const,
  milestonesRoot: () => ['solicitor','milestones'] as const,
  milestones: (caseId: string) => [...solicitorKeys.milestonesRoot(),caseId] as const,
  documents: (caseId: string) => ['solicitor','documents',caseId] as const,
  conversations: (conversationId?: string) => ['solicitor','conversations',conversationId || 'all'] as const,
  notifications: () => ['solicitor','notifications'] as const,
};
export interface MatterFilters { search: string; status: string; page: number; pageSize: number }
export interface MattersPage { records: LegalMatter[]; pagination: { page:number; page_size:number; total:number; total_pages:number } }
export class SolicitorPortalError extends Error { constructor(message:string, public code:string, public status?:number){super(message)} }
export function mapSolicitorError(value:any){const code=value?.data?.code||value?.code||'PORTAL_REQUEST_FAILED';return new SolicitorPortalError(value?.data?.error||value?.message||'The request could not be completed',code,value?.status)}
async function invoke(functionName:string,payload:Record<string,unknown>={},signal?:AbortSignal){const result=await invokeSolicitorFunction(functionName,payload,{signal});if(result.error||result.data?.error)throw mapSolicitorError(result.error||{data:result.data});return result.data}
export function useSolicitorMatters(filters:MatterFilters){return useQuery({queryKey:solicitorKeys.matters(filters),queryFn:async({signal})=>await invoke('solicitor-portal-matters',{operation:'list_matters',...filters,page_size:filters.pageSize},signal) as MattersPage,placeholderData:previous=>previous,staleTime:30_000})}
export function useSolicitorMatter(matterId:string){return useQuery({queryKey:solicitorKeys.matter(matterId),queryFn:({signal})=>invoke('solicitor-portal-matters',{operation:'get_matter',matter_id:matterId},signal),enabled:Boolean(matterId)})}
export function useMatterMutation(matterId:string){const client=useQueryClient();return useMutation({mutationFn:(payload:Record<string,unknown>)=>invoke('solicitor-portal-matters',{...payload,matter_id:matterId}),onSuccess:async()=>{await Promise.all([client.invalidateQueries({queryKey:solicitorKeys.matter(matterId)}),client.invalidateQueries({queryKey:solicitorKeys.mattersRoot()})])}})}
