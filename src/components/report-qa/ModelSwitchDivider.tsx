import { cn } from '@/lib/utils';
import { OpenAILogo, PerplexityLogo, GeminiLogo, type ModelProvider } from './ModelSelector';
import { ArrowRight } from 'lucide-react';

interface ModelSwitchDividerProps {
  fromModel: ModelProvider;
  toModel: ModelProvider;
  className?: string;
}

function getModelIcon(model: ModelProvider) {
  if (model === 'gemini') return GeminiLogo;
  if (model === 'perplexity') return PerplexityLogo;
  return OpenAILogo;
}

function getModelLabel(model: ModelProvider) {
  if (model === 'gemini') return 'Gemini Pro';
  if (model === 'perplexity') return 'Perplexity';
  if (model === 'openai-direct') return 'GPT-4.1';
  return 'GPT-5.2';
}

export function ModelSwitchDivider({ fromModel, toModel, className }: ModelSwitchDividerProps) {
  const FromIcon = getModelIcon(fromModel);
  const ToIcon = getModelIcon(toModel);
  const toLabel = getModelLabel(toModel);

  return (
    <div className={cn('flex items-center gap-3 py-3', className)}>
      <div className="flex-1 h-px bg-border" />
      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
        <FromIcon className="h-3.5 w-3.5 opacity-50" />
        <ArrowRight className="h-3 w-3" />
        <ToIcon className="h-3.5 w-3.5" />
        <span className="font-medium">Switched to {toLabel}</span>
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}
