import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import type { CoverPageOverlay, OverlayElement } from '@/components/templates/cover-editor/types';

const QUERY_KEY = ['cover-page-overlays'];

export function useCoverPageOverlays() {
  const queryClient = useQueryClient();

  const { data: overlays = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'cover_page_overlays',
        listOptions: { orderBy: 'created_at', orderAsc: false }
      });
      if (error) throw new Error(error.message);
      return (data?.records || []) as CoverPageOverlay[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (overlay: Partial<CoverPageOverlay> & { id?: string }) => {
      const operation = overlay.id ? 'update' : 'insert';
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation,
        table: 'cover_page_overlays',
        ...(overlay.id ? { recordId: overlay.id } : {}),
        data: {
          ...overlay,
          updated_at: new Date().toISOString(),
        },
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success('Cover page overlay saved');
    },
    onError: (err: Error) => {
      toast.error(`Failed to save: ${err.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await invokeSecureFunction('manage-templates', {
        operation: 'delete',
        table: 'cover_page_overlays',
        recordId: id,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success('Cover page overlay deleted');
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete: ${err.message}`);
    },
  });

  return { overlays, isLoading, saveMutation, deleteMutation };
}
