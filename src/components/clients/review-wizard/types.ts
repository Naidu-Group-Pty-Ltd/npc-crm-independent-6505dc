// Types for the Portfolio Review Wizard

export type ReviewStep = 
  | 'data_completeness'
  | 'metrics_review'
  | 'scorecard'
  | 'borrowing_capacity'
  | 'flags_scenarios'
  | 'recommendations'
  | 'generate_report';

export interface PropertyDataQuality {
  propertyId: string;
  address: string;
  propertyType?: string;
  isOwnerOccupied?: boolean;
  isRental?: boolean;
  missingFields: string[];
  completenessScore: number;
  issues: string[];
  warnings: string[];
}

export interface PropertyMetrics {
  propertyId: string;
  address: string;
  value: number;
  loanRemaining: number;
  lvr: number;
  monthlyRentalIncome: number;
  totalMonthlyExpenditure: number;
  netMonthlyCashflow: number;
  grossYield: number;
  netYield: number;
}

export interface PropertyScore {
  propertyId: string;
  address: string;
  propertyType?: string;
  isOwnerOccupied?: boolean;
  isRental?: boolean;
  overallScore: number;
  healthScore: number;
  cashFlowScore: number;
  growthPotential: number;
  classification: 'Star' | 'Good' | 'Average' | 'Underperformer';
  strengths: string[];
  concerns: string[];
}

export interface ValidationFlag {
  type: 'error' | 'warning' | 'info';
  severity: 'critical' | 'high' | 'medium' | 'low';
  field: string;
  message: string;
  propertyAddress?: string;
  recommendation?: string;
}

export interface Scenario {
  name: string;
  description: string;
  parameters: {
    rateChange?: number;
    vacancyWeeks?: number;
    rentChange?: number;
    valueChange?: number;
  };
  impact: {
    cashFlowChange: number;
    newNetCashflow: number;
    newLvr?: number;
  };
}

export interface ReviewWizardData {
  // Step 1: Data Completeness
  dataCompleteness: {
    overallScore: number;
    propertyData: PropertyDataQuality[];
    totalMissingFields: number;
    criticalIssues: number;
  };
  
  // Step 2: Metrics Review
  metrics: {
    properties: PropertyMetrics[];
    portfolioTotals: {
      totalValue: number;
      totalDebt: number;
      totalEquity: number;
      portfolioLvr: number;
      totalMonthlyCashflow: number;
      averageYield: number;
    };
  };
  
  // Step 3: Scorecard
  scorecard: {
    overallScore: number;
    portfolioHealth: number;
    cashFlowScore: number;
    growthPotential: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    riskFactors: string[];
    propertyScores: PropertyScore[];
  };
  
  // Step 4: Flags & Scenarios
  flags: ValidationFlag[];
  scenarios: Scenario[];
  
  // Step 5: Recommendations
  recommendations: {
    priority: 'high' | 'medium' | 'low';
    category: string;
    title: string;
    description: string;
    actionItems: string[];
  }[];
  
  // Step 6: Report
  executiveSummary: string;
  keyFindings: string[];
  actionItems: string[];
}

export interface ReviewWizardProps {
  clientId: string;
  clientName: string;
  properties: any[];
  clientData: any;
  isOpen: boolean;
  onClose: () => void;
  onComplete: (reviewId: string) => void;
}
