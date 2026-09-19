import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sparkles, Loader2, Mic, MicOff, Wand2, ChevronLeft, ChevronRight,
  Check, ScrollText, Languages, Type, Gauge, MessageSquare,
  Scissors, Expand, BookOpenCheck, Heart, Zap, Square, Copy, RefreshCw,
} from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export type ReplyTone = 'formal' | 'friendly' | 'direct' | 'empathetic' | 'enthusiastic';
export type ReplyLength = 'short' | 'medium' | 'long';
export type ReplyIntent =
  | 'acknowledge' | 'answer' | 'decline' | 'schedule'
  | 'request_info' | 'send_document' | 'follow_up' | 'thank';

const INTENTS: { value: ReplyIntent; label: string; emoji: string }[] = [
  { value: 'acknowledge', label: 'Acknowledge', emoji: '👍' },
  { value: 'answer', label: 'Answer', emoji: '💬' },
  { value: 'thank', label: 'Thank', emoji: '🙏' },
  { value: 'schedule', label: 'Schedule call', emoji: '📅' },
  { value: 'request_info', label: 'Request info', emoji: '❓' },
  { value: 'send_document', label: 'Send document', emoji: '📎' },
  { value: 'decline', label: 'Politely decline', emoji: '🙅' },
  { value: 'follow_up', label: 'Follow up', emoji: '🔁' },
];

const TONES: { value: ReplyTone; label: string; icon: any }[] = [
  { value: 'friendly', label: 'Friendly', icon: Heart },
  { value: 'formal', label: 'Formal', icon: ScrollText },
  { value: 'direct', label: 'Direct', icon: Zap },
  { value: 'empathetic', label: 'Empathetic', icon: Heart },
  { value: 'enthusiastic', label: 'Enthusiastic', icon: Sparkles },
];

const LENGTHS: { value: ReplyLength; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'long', label: 'Long' },
];

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'zh', label: 'Mandarin' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ar', label: 'Arabic' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
];

const IMPROVE_ACTIONS: { label: string; instruction: string; icon: any }[] = [
  { label: 'Shorten', instruction: 'Make this significantly shorter while keeping all critical info.', icon: Scissors },
  { label: 'Expand', instruction: 'Expand this with more helpful detail and structure.', icon: Expand },
  { label: 'Fix grammar', instruction: 'Fix any grammar, spelling and punctuation. Do not change meaning.', icon: BookOpenCheck },
  { label: 'Make warmer', instruction: 'Make the tone warmer and more empathetic without being unprofessional.', icon: Heart },
  { label: 'More direct', instruction: 'Rewrite to be more direct, punchy, and concise. Cut filler.', icon: Zap },
  { label: 'More formal', instruction: 'Rewrite in a more formal, polished business tone.', icon: ScrollText },
];

interface ThreadEmailLite {
  sender: string;
  subject: string;
  body: string;
  received_at?: string;
}

interface Props {
  email: { sender: string; subject: string; body: string; received_at?: string };
  emailId: string;
  linkedPropertyAddress?: string | null;
  threadEmails?: ThreadEmailLite[];
  /** Currently displayed body in the composer */
  draft: string;
  onDraftChange: (next: string) => void;
  /** Initialise reply To/Subject/Cc/Bcc */
  onInitialiseFields?: () => void;
  /** Voice — reuse parent's mic so we don't duplicate streams */
  isRecording: boolean;
  isTranscribing: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  /** Composer textarea ref so we can read the current selection */
  composerRef?: React.RefObject<HTMLTextAreaElement>;
}

export function AIReplyAssistant({
  email, emailId, linkedPropertyAddress, threadEmails,
  draft, onDraftChange, onInitialiseFields,
  isRecording, isTranscribing, onStartRecording, onStopRecording,
  composerRef,
}: Props) {
  const [context, setContext] = useState('');
  const [tone, setTone] = useState<ReplyTone>('friendly');
  const [length, setLength] = useState<ReplyLength>('medium');
  const [language, setLanguage] = useState('en');
  const [intent, setIntent] = useState<ReplyIntent | null>(null);
  const [variantsCount, setVariantsCount] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isImproving, setIsImproving] = useState(false);
  const [variants, setVariants] = useState<string[]>([]);
  const [activeVariant, setActiveVariant] = useState(0);
  const [improvePopoverOpen, setImprovePopoverOpen] = useState(false);

  const threadCount = threadEmails?.length || 0;

  const contextChips = useMemo(() => {
    const chips: string[] = [];
    chips.push('This email');
    if (threadCount > 1) chips.push(`+${threadCount - 1} prior message${threadCount - 1 > 1 ? 's' : ''}`);
    if (linkedPropertyAddress) chips.push(`Property: ${linkedPropertyAddress.split(',')[0]}`);
    return chips;
  }, [threadCount, linkedPropertyAddress]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setVariants([]);
    try {
      const { data, error } = await invokeSecureFunction('email-copilot', {
        action: 'draft_reply_v2',
        email,
        emailId,
        linkedPropertyAddress,
        replyContext: context || undefined,
        tone, length, intent: intent || undefined, language,
        threadEmails: (threadEmails || []).slice(0, 4).map(e => ({
          sender: e.sender, subject: e.subject, body: e.body, received_at: e.received_at,
        })),
        variants: variantsCount,
      });
      if (error) throw error;
      const drafts: string[] = data?.drafts || (data?.draftReply ? [data.draftReply] : []);
      if (drafts.length === 0) throw new Error('No drafts returned');
      setVariants(drafts);
      setActiveVariant(0);
      onDraftChange(drafts[0]);
      onInitialiseFields?.();
      toast.success(drafts.length > 1 ? `Generated ${drafts.length} variants` : 'Draft generated');
    } catch (e: any) {
      console.error('Generate error', e);
      toast.error(e?.message?.includes('429') ? 'Rate limit — please wait a moment' :
                  e?.message?.includes('402') ? 'AI credits exhausted' :
                  'Failed to generate reply');
    } finally {
      setIsGenerating(false);
    }
  };

  const pickVariant = (idx: number) => {
    if (!variants[idx]) return;
    setActiveVariant(idx);
    onDraftChange(variants[idx]);
  };

  const runImprove = async (instruction: string, label: string) => {
    if (!draft.trim()) {
      toast.error('Nothing to improve yet');
      return;
    }
    // If there's a selection, improve only the selection. Otherwise improve full draft.
    const ta = composerRef?.current;
    const hasSelection = !!ta && ta.selectionEnd > ta.selectionStart && (ta.selectionEnd - ta.selectionStart) > 4;
    const target = hasSelection ? draft.substring(ta!.selectionStart, ta!.selectionEnd) : draft;

    setIsImproving(true);
    setImprovePopoverOpen(false);
    try {
      const { data, error } = await invokeSecureFunction('email-copilot', {
        action: 'improve_text',
        text: target,
        instruction,
        tone,
        language,
      });
      if (error) throw error;
      const improved: string = (data?.improved || '').trim();
      if (!improved) throw new Error('No improvement returned');

      if (hasSelection && ta) {
        const before = draft.substring(0, ta.selectionStart);
        const after = draft.substring(ta.selectionEnd);
        onDraftChange(before + improved + after);
      } else {
        onDraftChange(improved);
      }
      toast.success(`${label}${hasSelection ? ' (selection)' : ''}`);
    } catch (e: any) {
      console.error('Improve error', e);
      toast.error('Failed to improve');
    } finally {
      setIsImproving(false);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-3 p-3 rounded-lg border border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
        {/* Header + context strip */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-primary/15 flex items-center justify-center">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            </div>
            <div>
              <Label className="text-sm font-semibold">AI Reply Assistant</Label>
              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                {contextChips.map((c) => (
                  <span key={c} className="text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Intent chips */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
            <MessageSquare className="h-3 w-3" /> Intent
          </div>
          <div className="flex flex-wrap gap-1.5">
            {INTENTS.map((i) => (
              <button
                key={i.value}
                type="button"
                onClick={() => setIntent(intent === i.value ? null : i.value)}
                className={cn(
                  'text-xs px-2 py-1 rounded-full border transition-colors',
                  intent === i.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background hover:bg-muted border-border'
                )}
              >
                <span className="mr-1">{i.emoji}</span>{i.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tone / Length / Language */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
              <Type className="h-3 w-3" /> Tone
            </div>
            <div className="flex flex-wrap gap-1">
              {TONES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTone(t.value)}
                  className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded border',
                    tone === t.value ? 'bg-primary/20 border-primary text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
              <Gauge className="h-3 w-3" /> Length
            </div>
            <div className="flex gap-1">
              {LENGTHS.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => setLength(l.value)}
                  className={cn(
                    'text-[10px] flex-1 px-1.5 py-0.5 rounded border',
                    length === l.value ? 'bg-primary/20 border-primary text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
              <Languages className="h-3 w-3" /> Language
            </div>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full h-7 text-xs rounded border border-input bg-background px-1.5"
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Variants toggle */}
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-muted-foreground">Variants</div>
          <div className="flex gap-1">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setVariantsCount(n)}
                className={cn(
                  'text-[10px] w-7 h-6 rounded border',
                  variantsCount === n ? 'bg-primary/20 border-primary' : 'border-border text-muted-foreground'
                )}
              >
                {n}×
              </button>
            ))}
          </div>
        </div>

        {/* Context input + voice */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Optional guidance (what to say)</Label>
          <div className="flex gap-2">
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="e.g. confirm the meeting Thursday at 2pm and attach the report"
              className="min-h-[56px] resize-none flex-1 text-sm"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isRecording ? 'destructive' : 'outline'}
                  size="icon"
                  className="h-[56px] w-10 shrink-0"
                  onClick={isRecording ? onStopRecording : onStartRecording}
                  disabled={isTranscribing}
                >
                  {isTranscribing ? <Loader2 className="h-4 w-4 animate-spin" /> :
                   isRecording ? <MicOff className="h-4 w-4" /> :
                   <Mic className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isRecording ? 'Stop recording' : 'Speak your guidance'}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Generate button */}
        <Button onClick={handleGenerate} disabled={isGenerating || isImproving} className="w-full">
          {isGenerating ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating{variantsCount > 1 ? ` ${variantsCount} variants` : ''}…</>
          ) : (
            <><Sparkles className="h-4 w-4 mr-2" /> {variants.length ? 'Regenerate' : 'Generate AI reply'}</>
          )}
        </Button>

        {/* Variant carousel */}
        {variants.length > 1 && (
          <div className="flex items-center justify-between rounded border bg-muted/30 px-2 py-1.5">
            <Button variant="ghost" size="icon" className="h-6 w-6"
              onClick={() => pickVariant(Math.max(0, activeVariant - 1))} disabled={activeVariant === 0}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">Variant {activeVariant + 1} / {variants.length}</Badge>
              {variants.map((_, i) => (
                <button key={i} onClick={() => pickVariant(i)}
                  className={cn('h-1.5 w-4 rounded-full transition-colors',
                    i === activeVariant ? 'bg-primary' : 'bg-muted-foreground/30 hover:bg-muted-foreground/60')} />
              ))}
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6"
              onClick={() => pickVariant(Math.min(variants.length - 1, activeVariant + 1))} disabled={activeVariant === variants.length - 1}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Improve toolbar */}
        {draft.trim() && (
          <div className="flex items-center justify-between rounded border bg-muted/20 px-2 py-1.5">
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Wand2 className="h-3 w-3" /> Refine the draft (or selection)
            </span>
            <div className="flex gap-1">
              <Popover open={improvePopoverOpen} onOpenChange={setImprovePopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={isImproving || isGenerating}>
                    {isImproving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wand2 className="h-3 w-3 mr-1" />}
                    Improve
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-1" align="end">
                  <div className="grid gap-0.5">
                    {IMPROVE_ACTIONS.map((a) => (
                      <button
                        key={a.label}
                        onClick={() => runImprove(a.instruction, a.label)}
                        className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted text-left"
                      >
                        <a.icon className="h-3.5 w-3.5 text-muted-foreground" />
                        {a.label}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
