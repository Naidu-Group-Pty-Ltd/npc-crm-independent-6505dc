import { useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { IndustrialMetricSource, useCascadedIndustrialField } from './industrialMetricCascade';

export interface IndustrialMetricPreview {
  actionId: string;
  label: string;
  suggestedValue: string;
  suggestedBenchmarkRange: string;
  confidence: 'Low' | 'Medium' | 'High';
  source: Extract<IndustrialMetricSource, 'AI Estimate' | 'Research Engine'>;
  sourceBasis: string;
  dataPointsUsed: string[];
  missingData: string[];
  riskNotes: string[];
  verificationRequirements: string[];
  targetField?: ReturnType<typeof useCascadedIndustrialField>;
}

export interface IndustrialMetricAiAction {
  id: string;
  label: string;
  buildPreview: () => IndustrialMetricPreview | null;
}

const insufficientContextMessage = 'More property, area or market information is required before this industrial metric can be estimated.';

export function IndustrialMetricAiWorkflow({ title = 'AI / Research Benchmarks', description = 'Generate previews only. Estimates are not applied or verified unless you accept them.', actions }: { title?: string; description?: string; actions: IndustrialMetricAiAction[] }) {
  const [preview, setPreview] = useState<IndustrialMetricPreview | null>(null);
  const [editedValue, setEditedValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const runAction = (action: IndustrialMetricAiAction) => {
    const next = action.buildPreview();
    if (!next) {
      setPreview(null);
      setEditing(false);
      setMessage(insufficientContextMessage);
      return;
    }
    setPreview(next);
    setEditedValue(next.suggestedValue);
    setEditing(false);
    setMessage(null);
  };

  const accept = (value: string) => {
    if (!preview?.targetField) return;
    preview.targetField.applySourceValue(value, preview.source);
    setPreview(null);
    setEditing(false);
  };

  return (
    <Card className="overflow-hidden border-accent/20 bg-gradient-to-br from-card/90 via-card/70 to-accent/5 shadow-sm transition-shadow hover:shadow-md">
      <details>
        <summary className="group cursor-pointer list-none">
          <CardHeader className="space-y-1 pb-3">
            <CardTitle className="flex items-center justify-between gap-2 text-base"><span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />{title}</span><ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" /></CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
        </summary>
        <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => <Button key={action.id} type="button" size="sm" variant="outline" className="rounded-full border-accent/30 bg-background/70 transition-all hover:-translate-y-0.5 hover:border-accent/30 hover:bg-accent/10 focus-visible:ring-accent" onClick={() => runAction(action)}>{action.label}</Button>)}
        </div>
        {message && <div className="rounded-md border border-brand-500/30 bg-brand-500/10 p-2 text-xs text-muted-foreground">{message}</div>}
        {preview && (
          <div className="rounded-2xl border border-accent/25 bg-background/60 p-4 text-sm shadow-inner">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-foreground">AI / Research Preview — {preview.label}</p>
                <p className="text-xs text-muted-foreground">Review before applying. AI estimates are never marked verified automatically.</p>
              </div>
              <div className="flex gap-2"><Badge variant="outline">{preview.source}</Badge><Badge variant="secondary">{preview.confidence} confidence</Badge></div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <PreviewRow label="Suggested value" value={preview.suggestedValue} />
              <PreviewRow label="Suggested benchmark range" value={preview.suggestedBenchmarkRange} />
              <PreviewList label="Data points used" values={preview.dataPointsUsed} />
              <PreviewList label="Missing data" values={preview.missingData} />
              <PreviewList label="Risk notes" values={preview.riskNotes} />
              <PreviewList label="Verification requirements" values={preview.verificationRequirements} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground"><span className="font-medium text-foreground">Source basis:</span> {preview.sourceBasis}</p>
            {editing && <Input className="mt-3" value={editedValue} onChange={(event) => setEditedValue(event.target.value)} />}
            <div className="mt-3 flex flex-wrap gap-2">
              {preview.targetField && <Button type="button" size="sm" onClick={() => accept(preview.suggestedValue)}>Accept estimate</Button>}
              {preview.targetField && <Button type="button" size="sm" variant="secondary" onClick={() => accept(editedValue)}>Accept selected estimate</Button>}
              {preview.targetField && <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>Edit before applying</Button>}
              <Button type="button" size="sm" variant="ghost" onClick={() => { setPreview(null); setEditing(false); }}>Reject estimate</Button>
              {preview.targetField && <Button type="button" size="sm" variant="outline" onClick={preview.targetField.markVerified}>Mark as verified</Button>}
            </div>
          </div>
        )}
        </CardContent>
      </details>
    </Card>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border/60 bg-card/60 p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-sm font-semibold text-foreground">{value}</p></div>;
}

function PreviewList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
        {(values.length ? values : ['None identified']).map((value) => <li key={value}>{value}</li>)}
      </ul>
    </div>
  );
}
