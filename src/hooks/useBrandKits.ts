/**
 * Brand Kits hook — fetches and mutates the reusable, org-scoped brand
 * bundles (logos, palette, font pairing, default footer/disclaimer) that
 * any template can attach to via `report_templates.brand_kit_id`.
 */
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface BrandKit {
  id: string;
  name: string;
  description: string | null;
  logo_primary_url: string | null;
  logo_secondary_url: string | null;
  logo_mark_url: string | null;
  palette: Record<string, string>;
  font_pairing: { heading?: string; body?: string; mono?: string };
  default_footer: string | null;
  default_disclaimer: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export function useBrandKits() {
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('brand_kits' as any)
      .select('*')
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false });
    if (error) {
      toast.error('Failed to load brand kits');
      setKits([]);
    } else {
      setKits((data ?? []) as unknown as BrandKit[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const upsert = useCallback(async (kit: Partial<BrandKit> & { name: string }) => {
    const { data, error } = await supabase
      .from('brand_kits' as any)
      .upsert(kit as any)
      .select()
      .maybeSingle();
    if (error) { toast.error('Save failed: ' + error.message); return null; }
    toast.success(`Brand kit "${kit.name}" saved`);
    await refresh();
    return data as unknown as BrandKit;
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from('brand_kits' as any).delete().eq('id', id);
    if (error) { toast.error('Delete failed'); return; }
    toast.success('Brand kit deleted');
    await refresh();
  }, [refresh]);

  return { kits, loading, refresh, upsert, remove };
}

/** Apply a brand kit's palette + fonts onto a template Tokens object. */
export function applyBrandKitToTokens<T extends { colors: Record<string,string>; fonts: Record<string,string> }>(
  tokens: T,
  kit: BrandKit,
): T {
  return {
    ...tokens,
    colors: { ...tokens.colors, ...(kit.palette || {}) },
    fonts: { ...tokens.fonts, ...(kit.font_pairing || {}) },
    brandKitId: kit.id,
  } as T;
}
