import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';
import { useToast } from '@/hooks/use-toast';
import { normalizeComparableReportType, type ReportVariant } from '@/lib/reports/reportVariants';

export interface SelectedReport {
  id: string;
  property_address: string;
  created_at: string;
  report_tier?: string | null;
}

interface ComparisonContextType {
  selectedReports: SelectedReport[];
  addReport: (report: SelectedReport) => void;
  removeReport: (reportId: string) => void;
  clearSelection: () => void;
  isSelected: (reportId: string) => boolean;
  canAddMore: boolean;
  activeComparisonType: ReportVariant | null;
  canSelectReport: (report: Pick<SelectedReport, 'id' | 'report_tier'>) => boolean;
}

const ComparisonContext = createContext<ComparisonContextType | undefined>(undefined);

const MAX_SELECTIONS = 5;

export function ComparisonProvider({ children }: { children: ReactNode }) {
  const [selectedReports, setSelectedReports] = useState<SelectedReport[]>([]);
  const { toast } = useToast();

  const activeComparisonType = useMemo(() => {
    const types = new Set(selectedReports.map(normalizeComparableReportType));
    return types.size === 1 ? [...types][0] ?? null : null;
  }, [selectedReports]);

  const hasInvalidSelection = useMemo(() => {
    const types = new Set(selectedReports.map(normalizeComparableReportType));
    return types.size > 1 || types.has(undefined);
  }, [selectedReports]);

  const canSelectReport = useCallback((report: Pick<SelectedReport, 'id' | 'report_tier'>) => {
    const reportType = normalizeComparableReportType(report);
    return !hasInvalidSelection && Boolean(reportType) && (selectedReports.some(selected => selected.id === report.id) ||
      (selectedReports.length < MAX_SELECTIONS && (!activeComparisonType || reportType === activeComparisonType)));
  }, [activeComparisonType, hasInvalidSelection, selectedReports]);

  const addReport = (report: SelectedReport) => {
    if (hasInvalidSelection) {
      setSelectedReports([]);
      toast({ title: 'Mixed report types cannot be compared', description: 'Your previous selection has been cleared. Please select reports of the same type.', variant: 'destructive' });
      return;
    }
    const reportType = normalizeComparableReportType(report);
    if (!reportType) {
      toast({ title: 'Report unavailable for comparison', description: 'This report does not have a supported report type.', variant: 'destructive' });
      return;
    }
    if (activeComparisonType && reportType !== activeComparisonType) {
      toast({ title: 'Incompatible report type', description: `Only ${activeComparisonType[0].toUpperCase()}${activeComparisonType.slice(1)} reports can be compared in the current selection.`, variant: 'destructive' });
      return;
    }
    if (selectedReports.length >= MAX_SELECTIONS) {
      toast({
        title: "Maximum Selection Reached",
        description: `You can only compare up to ${MAX_SELECTIONS} properties at once.`,
        variant: "destructive",
      });
      return;
    }

    if (selectedReports.some(r => r.id === report.id)) {
      toast({
        title: "Already Selected",
        description: "This property is already in your comparison basket.",
      });
      return;
    }

    setSelectedReports(prev => [...prev, report]);
    toast({
      title: "Added to Comparison",
      description: `${report.property_address} added to comparison basket.`,
    });
  };

  const removeReport = (reportId: string) => {
    setSelectedReports(prev => prev.filter(r => r.id !== reportId));
    toast({
      title: "Removed from Comparison",
      description: "Property removed from comparison basket.",
    });
  };

  const clearSelection = () => {
    setSelectedReports([]);
    toast({
      title: "Selection Cleared",
      description: "All properties removed from comparison basket.",
    });
  };

  const isSelected = (reportId: string) => {
    return selectedReports.some(r => r.id === reportId);
  };

  const canAddMore = selectedReports.length < MAX_SELECTIONS;

  return (
    <ComparisonContext.Provider
      value={{
        selectedReports,
        addReport,
        removeReport,
        clearSelection,
        isSelected,
        canAddMore,
        activeComparisonType,
        canSelectReport,
      }}
    >
      {children}
    </ComparisonContext.Provider>
  );
}

export function useComparison() {
  const context = useContext(ComparisonContext);
  if (context === undefined) {
    throw new Error('useComparison must be used within a ComparisonProvider');
  }
  return context;
}
