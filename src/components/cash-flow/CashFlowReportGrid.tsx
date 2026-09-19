import { CashFlowReportCard } from './CashFlowReportCard';
import type { BuildType, InvestmentGrade, InvestmentReport } from './types';

interface CashFlowReportGridProps {
  reports: InvestmentReport[];
  openingReportId: string | null;
  getBuildType: (report: InvestmentReport) => BuildType;
  getInvestmentGrade: (report: InvestmentReport) => InvestmentGrade | null;
  onViewReport: (report: InvestmentReport) => void;
  onOpenCashFlow: (report: InvestmentReport) => void;
}

export function CashFlowReportGrid({ reports, openingReportId, getBuildType, getInvestmentGrade, onViewReport, onOpenCashFlow }: CashFlowReportGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-3">
      {reports.map((report) => (
        <CashFlowReportCard
          key={report.id}
          report={report}
          buildType={getBuildType(report)}
          gradeInfo={getInvestmentGrade(report)}
          isOpening={openingReportId === report.id}
          onViewReport={onViewReport}
          onOpenCashFlow={onOpenCashFlow}
        />
      ))}
    </div>
  );
}
