/**
 * InlineAiTextActions — quick AI rewrite/translate actions on a selected text overlay.
 *
 * Invokes the template-design-agent in `inline_text` mode targeting exactly
 * the selected overlay; receives a `update_overlay` patch and applies it
 * via the inspector's onUpdateOverlay callback.
 */
import { useState } from 'react';
import { Wand2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { Overlay, ReportTemplate } from '@/lib/reportTemplate/templateSchema';

const QUICK = [
  { label: 'Shorter', instruction: 'Rewrite this text to be roughly 30% shorter while keeping the meaning and tone.' },
  { label: 'Longer', instruction: 'Expand this text with one extra clarifying sentence; keep the tone and any {{bindings}} intact.' },
  { label: 'More persuasive', instruction: 'Rewrite this copy to be more persuasive and confident; keep claims grounded.' },
  { label: 'More formal', instruction: 'Rewrite this copy in a more formal, professional register.' },
  { label: 'Plain English', instruction: 'Rewrite this copy in plain, jargon-free English suitable for everyday readers.' },
  { label: 'Fix grammar', instruction: 'Correct grammar, punctuation, and typography. Do not change the meaning.' },
];

interface Props {
  template: ReportTemplate;
  overlay: Overlay;
  pageId: string;
  blockId: string | null;
  onPatchContent: (newContent: string) => void;
}

export function InlineAiTextActions({ template, overlay, pageId, blockId, onPatchContent }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [translateOpen, setTranslateOpen] = useState(false);
  const [language, setLanguage] = useState('Spanish');

  if (overlay.type !== 'text') return null;

  const run = async (instruction: string, label: string) => {
    setBusy(label);
    try {
      const { data, error } = await invokeSecureFunction('template-design-agent', {
        schema: template,
        messages: [{ role: 'user', content: instruction }],
        instruction,
        activePageId: pageId,
        selectedBlockId: blockId,
        selectedOverlayId: overlay.id,
        mode: 'inline_text',
      }, { timeoutMs: 120000 });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      const ops: any[] = (data as any).raw_ops || [];
      const patchOp = ops.find((o) => o.op === 'update_overlay' && o.overlayId === overlay.id);
      const newContent = patchOp?.patch?.content;
      if (typeof newContent === 'string' && newContent.trim()) {
        onPatchContent(newContent);
        toast.success(`Rewritten: ${label}`);
      } else {
        toast.warning('AI did not return a usable rewrite.');
      }
    } catch (e) {
      toast.error(`AI error: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-2 space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
        <Wand2 className="h-3 w-3" /> Inline AI
        {busy && <Loader2 className="h-3 w-3 animate-spin ml-auto" />}
      </div>
      <div className="flex flex-wrap gap-1">
        {QUICK.map((q) => (
          <Button
            key={q.label}
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[10px]"
            disabled={!!busy}
            onClick={() => run(q.instruction, q.label)}
          >
            {busy === q.label ? <Loader2 className="h-3 w-3 animate-spin" /> : q.label}
          </Button>
        ))}
        <Popover open={translateOpen} onOpenChange={setTranslateOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={!!busy}>
              Translate…
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2 space-y-2">
            <Input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="e.g. Spanish, Mandarin, French"
              className="h-7 text-xs"
            />
            <Button
              size="sm"
              className="w-full h-7 text-xs"
              disabled={!language.trim() || !!busy}
              onClick={() => {
                setTranslateOpen(false);
                run(
                  `Translate this text into ${language}. Preserve any {{binding}} tokens verbatim. Return only the translated text.`,
                  `Translate → ${language}`,
                );
              }}
            >
              Translate
            </Button>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
