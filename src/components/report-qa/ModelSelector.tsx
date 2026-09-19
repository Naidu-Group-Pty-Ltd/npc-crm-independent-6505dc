import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ModelProvider = 'openai' | 'openai-direct' | 'perplexity' | 'gemini';

interface ModelSelectorProps {
  selectedModel: ModelProvider;
  onModelChange: (model: ModelProvider) => void;
  disabled?: boolean;
}

// OpenAI Logo SVG Component
export function OpenAILogo({ className }: { className?: string }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      className={className}
      fill="currentColor"
    >
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.8956zm16.5963 3.8558L13.1038 8.364l2.0201-1.1638a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.4069-.6813zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}

// Perplexity Logo SVG Component
export function PerplexityLogo({ className }: { className?: string }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      className={className}
      fill="currentColor"
    >
      <path d="M12 0L4 4v8l8 4 8-4V4L12 0zm0 2.18l5.45 2.73L12 7.63 6.55 4.91 12 2.18zM5.5 5.89l5.5 2.74v6.48l-5.5-2.75V5.89zm13 0v6.47l-5.5 2.75V8.63l5.5-2.74z"/>
      <path d="M12 14.5l-6.5-3.25v6.5L12 21l6.5-3.25v-6.5L12 14.5z" opacity="0.6"/>
    </svg>
  );
}

// Google Gemini Logo SVG Component
export function GeminiLogo({ className }: { className?: string }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      className={className}
      fill="currentColor"
    >
      <path d="M12 0C12 6.627 17.373 12 24 12C17.373 12 12 17.373 12 24C12 17.373 6.627 12 0 12C6.627 12 12 6.627 12 0Z" />
    </svg>
  );
}

const MODEL_OPTIONS = [
  {
    id: 'gemini' as ModelProvider,
    name: 'Gemini Pro',
    description: 'Large context window — best for big docs',
    Icon: GeminiLogo,
  },
  {
    id: 'openai' as ModelProvider,
    name: 'OpenAI GPT-5.2',
    description: 'Advanced reasoning & analysis',
    Icon: OpenAILogo,
  },
  {
    id: 'openai-direct' as ModelProvider,
    name: 'OpenAI Direct',
    description: 'Direct API — bypasses gateway',
    Icon: OpenAILogo,
  },
  {
    id: 'perplexity' as ModelProvider,
    name: 'Perplexity',
    description: 'Web-grounded with citations',
    Icon: PerplexityLogo,
  },
];

export function ModelSelector({ selectedModel, onModelChange, disabled }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const selected = MODEL_OPTIONS.find(m => m.id === selectedModel) || MODEL_OPTIONS[0];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          className="report-qa-toolbar-control h-11 min-w-11 max-w-full gap-2.5 px-3 text-xs font-semibold shadow-sm sm:h-9 sm:px-3.5"
          disabled={disabled}
          title={`Model: ${selected.name}`}
          aria-label={`Select AI model. Current model: ${selected.name}`}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/12 text-primary">
            <selected.Icon className="h-3.5 w-3.5" />
          </span>
          <span className="hidden max-w-[10rem] truncate sm:inline">{selected.name}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(18rem,calc(100vw-2rem))] border-primary/20 bg-popover/95 p-1.5 shadow-xl backdrop-blur">
        {MODEL_OPTIONS.map((model) => (
          <DropdownMenuItem
            key={model.id}
            onClick={() => {
              onModelChange(model.id);
              setOpen(false);
            }}
            className={cn(
              "flex items-center gap-3 rounded-xl px-2.5 py-3",
              selectedModel === model.id && "bg-primary/10 text-primary"
            )}
          >
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
              <model.Icon className="h-[18px] w-[18px]" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{model.name}</div>
              <div className="text-xs text-muted-foreground">{model.description}</div>
            </div>
            {selectedModel === model.id && (
              <Check className="h-4 w-4 text-primary flex-shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
