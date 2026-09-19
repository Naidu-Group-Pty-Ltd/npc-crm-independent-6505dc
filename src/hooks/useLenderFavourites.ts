import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

export interface LenderFavourite {
  id: string;
  user_id: string;
  lender_id: string;
  lender_name: string;
  notes: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

async function call(action: string, params: Record<string, any> = {}) {
  const { data, error } = await invokeSecureFunction('manage-lender-favourites', { action, ...params });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Request failed');
  return data.data;
}

export function useLenderFavourites() {
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['lender-favourites'],
    queryFn: () => call('list') as Promise<LenderFavourite[]>,
    staleTime: 60_000,
  });

  const add = useMutation({
    mutationFn: (v: { lender_id: string; lender_name: string; notes?: string }) => call('add', v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lender-favourites'] }); toast.success('Lender pinned'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (lender_id: string) => call('remove', { lender_id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lender-favourites'] }); toast.success('Lender unpinned'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateNotes = useMutation({
    mutationFn: (v: { lender_id: string; notes: string | null }) => call('updateNotes', v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lender-favourites'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const isFavourite = (lender_id: string) => !!data?.some(f => f.lender_id === lender_id);

  return {
    favourites: data ?? [],
    isLoading,
    refetch,
    add: add.mutate,
    remove: remove.mutate,
    updateNotes: updateNotes.mutate,
    isFavourite,
    isMutating: add.isPending || remove.isPending,
  };
}
