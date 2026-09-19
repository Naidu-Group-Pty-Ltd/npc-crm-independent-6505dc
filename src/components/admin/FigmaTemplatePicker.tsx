/**
 * FigmaTemplatePicker — reusable dropdown for selecting an active Figma-derived
 * report template at generation time. Reads from `figma_templates` via the
 * `figma-template-sync` edge function (op: list_active).
 *
 * Example:
 *   const [tplId, setTplId] = useState<string | undefined>();
 *   <FigmaTemplatePicker reportType="investment" value={tplId} onChange={setTplId} />
 *
 * Then pass `tplId` into your generator. The generator should fetch the
 * compiled_schema for that id and feed it to pdfRenderer().
 */
import { useEffect, useState } from 'react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Frame as FigmaIcon, Star } from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';

interface ActiveTemplate {
  id: string;
  label: string;
  description: string | null;
  report_type: string;
  tier: string | null;
  thumbnail_url: string | null;
  version: number;
  is_default: boolean;
}

interface Props {
  reportType: string;
  value?: string;
  onChange: (id: string | undefined) => void;
  label?: string;
  disabled?: boolean;
  /** When true, auto-select the default template if no value is set yet. */
  autoSelectDefault?: boolean;
}

const NONE_VALUE = '__none__';

export function FigmaTemplatePicker({
  reportType, value, onChange, label = 'Template', disabled, autoSelectDefault = true,
}: Props) {
  const [templates, setTemplates] = useState<ActiveTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await invokeSecureFunction('figma-template-sync', {
          op: 'list_active',
          report_type: reportType,
        });
        if (cancelled) return;
        const list = (data as any)?.templates ?? [];
        setTemplates(list);
        if (autoSelectDefault && !value) {
          const def = list.find((t: ActiveTemplate) => t.is_default) || list[0];
          if (def) onChange(def.id);
        }
      } catch {
        if (!cancelled) setTemplates([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportType]);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs flex items-center gap-1.5">
        <FigmaIcon className="h-3 w-3" />
        {label}
      </Label>
      <Select
        value={value ?? NONE_VALUE}
        onValueChange={(v) => onChange(v === NONE_VALUE ? undefined : v)}
        disabled={disabled || loading}
      >
        <SelectTrigger className="h-9">
          {loading
            ? <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</span>
            : <SelectValue placeholder="Use built-in renderer" />}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>
            <span className="text-muted-foreground">Built-in renderer (no Figma template)</span>
          </SelectItem>
          {templates.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              <span className="flex items-center gap-1.5">
                {t.is_default && <Star className="h-3 w-3 fill-primary text-primary" />}
                {t.label}
                {t.tier && <Badge variant="outline" className="ml-1 text-[10px] h-4 px-1">{t.tier}</Badge>}
                <Badge variant="outline" className="text-[10px] h-4 px-1">v{t.version}</Badge>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {templates.length === 0 && !loading && (
        <p className="text-[10px] text-muted-foreground">
          No active Figma templates for {reportType}. Register one in Admin → Figma Templates.
        </p>
      )}
    </div>
  );
}
