import type { RefObject } from 'react';
import type { PixelPerfectPDFGeneratorHandle } from '@/components/reports/PixelPerfectPDFGenerator';
import type { PdfDesignOptions } from '@/components/reports/premiumPdfDesign';

export interface InvestmentReport {
  id: string;
  property_address: string;
  property_listing_id: string | null;
  report_content: string;
  sources_content?: string | null;
  created_at: string;
  current_version?: number | null;
  status?: string;
  manual_overrides?: any;
  financial_calculations?: any;
  demographics_data?: any;
  economic_data?: any;
  investment_score?: any;
  location_intelligence?: any;
  is_client_report?: boolean;
  client_property_id?: string | null;
  report_tier?: string | null;
  report_variant?: string | null;
  derived_from_report_id?: string | null;
  parent_report_id?: string | null;
  pdf_url?: string | null;
  /** Per-source provenance the generation recorded — null means attempted, nothing returned. */
  data_sources?: Record<string, unknown> | null;
  /** Quality/schema/fact findings recorded at generation; `type: 'fact'` are prose-vs-record contradictions. */
  validation_flags?: unknown[] | null;
}

export interface ClientInfo {
  id: string;
  primary_first_name: string;
  primary_surname: string;
}

export interface OverriddenField {
  key: string;
  displayName: string;
  value: any;
}

export interface ExportPanelProps {
  report: InvestmentReport;
  includeSources: boolean;
  includeScoring: boolean;
  includeCharts: boolean;
  includeHeroImages: boolean;
  includeSparklines: boolean;
  pdfDesignOptions: PdfDesignOptions;
  onIncludeSourcesChange: (checked: boolean) => void;
  onIncludeScoringChange: (checked: boolean) => void;
  onIncludeChartsChange: (checked: boolean) => void;
  onIncludeHeroImagesChange: (checked: boolean) => void;
  onIncludeSparklinesChange: (checked: boolean) => void;
  onPdfDesignOptionsChange: (options: PdfDesignOptions) => void;
  onHeroImagesManage: () => void;
  onRegenerated: () => void;
  onDownload: () => void;
}
