import { cn } from '@/lib/utils';
import { OpenAILogo, PerplexityLogo, GeminiLogo, type ModelProvider } from './ModelSelector';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

interface ModelBadgeProps {
  provider: ModelProvider | null;
  className?: string;
  showLabel?: boolean;
}

export function ModelBadge({ provider, className, showLabel = false }: ModelBadgeProps) {
  if (!provider) return null;

  const configs: Record<string, { Icon: typeof OpenAILogo; label: string; color: string; bgColor: string; borderColor: string }> = {
    openai: {
      Icon: OpenAILogo,
      label: 'GPT-5.2',
      color: 'text-success dark:text-success',
      bgColor: 'bg-success/10 dark:bg-success/30',
      borderColor: 'border-success/30 dark:border-success/30',
    },
    'openai-direct': {
      Icon: OpenAILogo,
      label: 'GPT-4.1',
      color: 'text-success dark:text-success',
      bgColor: 'bg-success/10 dark:bg-success/30',
      borderColor: 'border-success/30 dark:border-success/30',
    },
    perplexity: {
      Icon: PerplexityLogo,
      label: 'Perplexity',
      color: 'text-info dark:text-info',
      bgColor: 'bg-info/10 dark:bg-info/30',
      borderColor: 'border-info/30 dark:border-info/30',
    },
    gemini: {
      Icon: GeminiLogo,
      label: 'Gemini Pro',
      color: 'text-accent dark:text-accent',
      bgColor: 'bg-accent/10 dark:bg-accent/30',
      borderColor: 'border-accent/30 dark:border-accent/30',
    },
  };

  const config = configs[provider] || configs.openai;

  const badge = (
    <div 
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border',
        config.bgColor,
        config.borderColor,
        config.color,
        className
      )}
    >
      <config.Icon className="h-3 w-3" />
      {showLabel && <span>{config.label}</span>}
    </div>
  );

  if (!showLabel) {
    return (
      <TooltipProvider>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            {badge}
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Powered by {config.label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return badge;
}
