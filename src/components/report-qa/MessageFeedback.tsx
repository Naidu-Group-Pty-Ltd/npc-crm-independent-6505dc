import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface MessageFeedbackProps {
  messageId: string;
  conversationId: string;
  initialRating?: 1 | -1 | null;
  initialReason?: string | null;
}

export function MessageFeedback({
  messageId,
  conversationId,
  initialRating = null,
  initialReason = null,
}: MessageFeedbackProps) {
  const [rating, setRating] = useState<1 | -1 | null>(initialRating);
  const [reason, setReason] = useState(initialReason || '');
  const [reasonOpen, setReasonOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setRating(initialRating);
    setReason(initialReason || '');
  }, [initialRating, initialReason]);

  const submit = async (newRating: 1 | -1, reasonText?: string) => {
    setSubmitting(true);
    try {
      const { data, error } = await invokeSecureFunction('report-qa', {
        action: 'submit-feedback',
        messageId,
        conversationId,
        rating: newRating,
        reason: reasonText ?? null,
      });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      setRating(newRating);
      toast({ title: 'Thanks for the feedback' });
    } catch (e: any) {
      toast({ title: 'Failed to save feedback', description: e.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="inline-flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        disabled={submitting}
        className={cn('h-7 px-1.5', rating === 1 && 'text-success bg-success/10')}
        onClick={() => submit(1)}
        aria-label="Helpful"
      >
        <ThumbsUp className="h-3 w-3" />
      </Button>
      <Popover open={reasonOpen} onOpenChange={setReasonOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={submitting}
            className={cn('h-7 px-1.5', rating === -1 && 'text-destructive bg-destructive/10')}
            onClick={() => {
              if (rating !== -1) setReasonOpen(true);
            }}
            aria-label="Not helpful"
          >
            <ThumbsDown className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="start">
          <div className="space-y-2">
            <p className="text-xs font-medium">What was wrong?</p>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Inaccurate numbers, missing context, off-topic..."
              rows={3}
              className="text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setReasonOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={submitting}
                onClick={async () => {
                  await submit(-1, reason.trim() || undefined);
                  setReasonOpen(false);
                }}
              >
                Submit
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
