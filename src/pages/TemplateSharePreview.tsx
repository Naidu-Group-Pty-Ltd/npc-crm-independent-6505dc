/**
 * Public share preview page for templates. Resolves a share token via the
 * `template-share` edge function and renders the template HTML inside an
 * iframe. Read-only.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, FileWarning, ExternalLink } from 'lucide-react';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { parseTemplate, type ReportTemplate } from '@/lib/reportTemplate/templateSchema';
import { DEFAULT_SAMPLE_DATA_PRESET } from '@/lib/reportTemplate/sampleDataPresets';
import { Button } from '@/components/ui/button';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/integrations/supabase/env';

export default function TemplateSharePreview() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState<ReportTemplate | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [link, setLink] = useState<any>(null);

  useEffect(() => {
    if (!token) return;
    // Built from the resolved project rather than from VITE_SUPABASE_PROJECT_ID,
    // which is a THIRD name for the same project and free to disagree with the
    // other two: unset, this line fetched `https://undefined.supabase.co/...`.
    const url = `${SUPABASE_URL}/functions/v1/template-share?token=${encodeURIComponent(token)}`;
    fetch(url, { headers: { apikey: SUPABASE_ANON_KEY } })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`);
        const parsed = parseTemplate(json.template.schema);
        if (json.link?.theme_id) parsed.activeThemeId = json.link.theme_id;
        setTemplate(parsed);
        setMeta(json.template);
        setLink(json.link);
        setState('ready');
      })
      .catch((e) => {
        setError(e?.message || 'Failed to load share link');
        setState('error');
      });
  }, [token]);

  // Pure render pass — failures are returned as data and surfaced below.
  // Never call setState here: this runs during render.
  const rendered = useMemo<{ html: string; error: string | null }>(() => {
    if (!template) return { html: '', error: null };
    try {
      const sample = (meta?.sample_data && typeof meta.sample_data === 'object')
        ? meta.sample_data
        : DEFAULT_SAMPLE_DATA_PRESET.data;
      const { html } = renderTemplateToHtml(template, {
        data: sample,
        title: meta?.name || 'Template Preview',
        customCss: meta?.custom_css || undefined,
      });
      return { html, error: null };
    } catch (e: any) {
      return { html: '', error: e?.message || 'Render failed' };
    }
  }, [template, meta]);

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading shared template…
        </div>
      </div>
    );
  }

  if (state === 'error' || rendered.error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
        <FileWarning className="h-12 w-12 text-destructive mb-4" />
        <h1 className="text-lg font-semibold">Cannot open share link</h1>
        <p className="text-sm text-muted-foreground mt-1">{error ?? rendered.error}</p>
      </div>
    );
  }

  const isPreviewMode = link?.mode === 'preview';

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      <header className="flex items-center justify-between px-4 py-2 border-b bg-card">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{meta?.name || 'Shared template'}</div>
          {link?.label && <div className="text-[11px] text-muted-foreground truncate">{link.label}</div>}
        </div>
        <div className="flex items-center gap-2">
          {isPreviewMode && (
            <span className="text-[10px] uppercase tracking-wider rounded bg-brand-500/20 text-brand-700 px-2 py-0.5 font-semibold">
              Preview
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <ExternalLink className="h-3 w-3 mr-1" /> Print / Save PDF
          </Button>
        </div>
      </header>
      <iframe
        title="Shared template"
        sandbox=""
        srcDoc={rendered.html}
        className="flex-1 w-full bg-white"
        style={{ minHeight: 'calc(100vh - 49px)' }}
      />
    </div>
  );
}
