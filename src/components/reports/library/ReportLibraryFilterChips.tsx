import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface ReportLibraryFilterChip {
  key: string;
  label: string;
  onReset: () => void;
}

interface ReportLibraryFilterChipsProps {
  chips: ReportLibraryFilterChip[];
}

export function ReportLibraryFilterChips({ chips }: ReportLibraryFilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <Badge key={chip.key} variant="secondary" className="gap-1 rounded-full px-3 py-1 text-xs">
          {chip.label}
          <button type="button" onClick={chip.onReset} className="ml-1 rounded-full p-0.5 hover:bg-background/70" aria-label={`Remove ${chip.label} filter`}>
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}
