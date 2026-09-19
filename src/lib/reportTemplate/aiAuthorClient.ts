/**
 * Phase 15 — Client wrapper for the template-ai-author edge function.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';

async function call<T = any>(action: string, payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeSecureFunction<T>(
    'template-ai-author',
    { action, ...payload },
    { timeoutMs: 60_000 },
  );
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export interface GeneratedLayout {
  pageName: string;
  rationale?: string;
  blocks: Array<{ type: string; name?: string; props?: Record<string, unknown> }>;
}

export const aiAuthor = {
  generateLayout: (p: { prompt: string; tier?: string; pageWidth?: number; pageHeight?: number; availableBlocks?: string[] }) =>
    call<GeneratedLayout>('generate_layout', p),
  rewriteCopy: (p: { text: string; mode?: 'improve'|'shorten'|'lengthen'|'simplify'|'punch'; tone?: string; audience?: string; preserveBindings?: boolean }) =>
    call<{ text: string }>('rewrite_copy', p),
  suggestBindings: (p: { target: string; samplePaths: string[] }) =>
    call<{ suggestions: Array<{ path: string; filter?: string; confidence: number; reason?: string }> }>('suggest_bindings', p),
  nameSuggest: (p: { summary: string }) =>
    call<{ name: string; description: string }>('name_suggest', p),
  generateCover: (p: { brief: string; tier?: string; pageWidth?: number; pageHeight?: number; brand?: any }) =>
    call<{ pageName: string; heroImagePrompt?: string; rationale?: string; background?: any; blocks: any[] }>('generate_cover', p),
};
