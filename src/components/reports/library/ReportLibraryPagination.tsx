import { Button } from '@/components/ui/button';

interface ReportLibraryPaginationProps {
  page: number;
  totalPages: number;
  onPrevious: () => void;
  onNext: () => void;
}

export function ReportLibraryPagination({ page, totalPages, onPrevious, onNext }: ReportLibraryPaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 mt-6">
      <Button variant="outline" size="sm" onClick={onPrevious} disabled={page === 1}>Previous</Button>
      <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
      <Button variant="outline" size="sm" onClick={onNext} disabled={page === totalPages}>Next</Button>
    </div>
  );
}
