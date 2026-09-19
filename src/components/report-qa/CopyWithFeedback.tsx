import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CopyWithFeedbackProps {
  content: string;
  className?: string;
  variant?: 'ghost' | 'outline' | 'secondary';
  showLabel?: boolean;
}

export function CopyWithFeedback({ 
  content, 
  className,
  variant = 'ghost',
  showLabel = true
}: CopyWithFeedbackProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <Button
      variant={variant}
      size="sm"
      className={cn(
        "h-7 px-2 text-xs transition-all",
        copied && "text-success dark:text-success",
        className
      )}
      onClick={handleCopy}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 mr-1" />
          {showLabel && 'Copied!'}
        </>
      ) : (
        <>
          <Copy className="h-3 w-3 mr-1" />
          {showLabel && 'Copy'}
        </>
      )}
    </Button>
  );
}
