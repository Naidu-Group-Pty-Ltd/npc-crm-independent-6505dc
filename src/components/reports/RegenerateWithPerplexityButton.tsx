import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useChunkedRegeneration } from '@/hooks/useChunkedRegeneration';

interface RegenerateWithPerplexityButtonProps {
  reportId: string;
  propertyAddress: string;
  onRegenerated?: () => void;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

export function RegenerateWithPerplexityButton({
  reportId,
  propertyAddress,
  onRegenerated,
  variant = 'outline',
  size = 'sm',
  className = ''
}: RegenerateWithPerplexityButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const { logActivity } = useActivityLogger();
  
  const { 
    isRegenerating, 
    currentSection, 
    totalSections, 
    regenerate 
  } = useChunkedRegeneration();

  const handleRegenerate = async () => {
    setShowConfirm(false);

    await regenerate({
      reportId,
      propertyAddress,
      onComplete: () => {
        logActivity({
          actionType: 'report_regenerated',
          entityType: 'investment_report',
          entityId: reportId,
          entityName: propertyAddress,
          metadata: { regenerationType: 'qualitative_chunked' }
        });
        onRegenerated?.();
      }
    });
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={`${className}`}
        onClick={() => setShowConfirm(true)}
        disabled={isRegenerating}
        aria-label="Regenerate this report using the latest available data and current settings"
        title="Regenerate this report using the latest available data and current settings."
        style={variant === 'default' ? { 
          background: 'linear-gradient(135deg, #1A1A2E 0%, #20B2AA 100%)',
        } : undefined}
      >
        {isRegenerating ? (
          <>
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            Regenerating… {currentSection}/{totalSections}
          </>
        ) : (
          <>
            <RefreshCw className="mr-1 h-3 w-3" />
            Regenerate
          </>
        )}
      </Button>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-success" />
              Regenerate this report?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                This refreshes the qualitative analysis sections using the latest available data and your current settings:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>All your manual overrides injected as context</li>
                <li>Updated narrative to reflect adjusted figures</li>
                <li>Revised recommendations based on new calculations</li>
                <li>Aligned risk assessments with current data</li>
              </ul>
              <p className="pt-2 font-medium">
                A new version will be created and can be rolled back if needed.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleRegenerate}
              className="text-foreground dark:text-white border-0"
              style={{ 
                background: 'linear-gradient(135deg, #1A1A2E 0%, #20B2AA 100%)',
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Regenerate report
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
