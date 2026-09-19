import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FlattenPdfIconButton } from '@/components/common/FlattenPdfIconButton';
import { FileText, Loader2, Download, MapPin, DollarSign, TrendingUp, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

interface ClientProperty {
  id: string;
  property_type: string;
  address: string;
  value?: number | null;
  loan_remaining?: number | null;
  interest_rate?: number | null;
  ownership_percentage?: number | null;
  monthly_interest_repayment?: number | null;
  monthly_body_corporate?: number | null;
  monthly_council_rates?: number | null;
  monthly_water_rates?: number | null;
  monthly_repairs_maintenance?: number | null;
  monthly_property_management?: number | null;
  monthly_landlord_insurance?: number | null;
  monthly_building_insurance?: number | null;
  monthly_rental_income?: number | null;
  weekly_rental_income?: number | null;
  total_monthly_expenditure?: number | null;
  net_monthly_cashflow?: number | null;
}

interface PropertyReportData {
  property: ClientProperty;
  clientName: string;
  analysis: {
    investmentScore: number;
    investmentGrade: string;
    cashflowStatus: string;
    yieldAnalysis: string;
    equityPosition: string;
    keyMetrics: {
      grossYield: number;
      netYield: number;
      lvr: number;
      equity: number;
      annualCashflow: number;
      cashOnCashReturn: number;
    };
    strengths: string[];
    concerns: string[];
    opportunities: string[];
    risks: string[];
    recommendations: string[];
    marketComparison: string;
    tenYearProjection: {
      projectedValue: number;
      projectedEquity: number;
      totalCashflow: number;
    };
  };
  generatedAt: string;
}

interface PropertyReportGeneratorProps {
  property: ClientProperty;
  clientName: string;
  onComplete?: () => void;
}

const formatCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  return '$' + value.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const getGradeColor = (grade: string): string => {
  switch (grade?.toUpperCase()) {
    case 'A+':
    case 'A': return 'text-success';
    case 'B+':
    case 'B': return 'text-info';
    case 'C+':
    case 'C': return 'text-brand-600';
    case 'D':
    case 'F': return 'text-destructive';
    default: return 'text-muted-foreground';
  }
};

export function PropertyReportGenerator({ 
  property, 
  clientName,
  onComplete 
}: PropertyReportGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportData, setReportData] = useState<PropertyReportData | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const generateReport = async () => {
    setIsGenerating(true);
    
    try {
      // Calculate key metrics from property data
      const value = Number(property.value) || 0;
      const loan = Number(property.loan_remaining) || 0;
      const equity = value - loan;
      const lvr = value > 0 ? (loan / value) * 100 : 0;
      const weeklyRent = Number(property.weekly_rental_income) || 0;
      const annualRent = weeklyRent * 52;
      const grossYield = value > 0 ? (annualRent / value) * 100 : 0;
      const monthlyIncome = Number(property.monthly_rental_income) || 0;
      const monthlyExpenses = Number(property.total_monthly_expenditure) || 0;
      const netCashflow = Number(property.net_monthly_cashflow) || 0;
      const annualCashflow = netCashflow * 12;
      const netYield = value > 0 ? ((annualRent - (monthlyExpenses * 12)) / value) * 100 : 0;
      const cashOnCashReturn = equity > 0 ? (annualCashflow / equity) * 100 : 0;

      // Build analysis prompt
      const prompt = `You are an expert Australian property investment analyst. Analyze this individual investment property and provide a comprehensive assessment following the Investor Compass structure.

**PROPERTY DETAILS:**
- Address: ${property.address}
- Property Type: ${property.property_type === 'investment' ? 'Investment' : property.property_type === 'owner_occupied' ? 'Owner Occupied' : property.property_type === 'smsf' ? 'SMSF' : property.property_type === 'rental' ? 'Rental (Tenant)' : property.property_type}
- Current Value: ${formatCurrency(value)}
- Loan Remaining: ${formatCurrency(loan)}
- Equity: ${formatCurrency(equity)}
- LVR: ${lvr.toFixed(1)}%
- Interest Rate: ${property.interest_rate || 0}%
- Ownership: ${property.ownership_percentage || 100}%

**INCOME & EXPENSES:**
- Weekly Rent: ${formatCurrency(weeklyRent)}
- Monthly Rental Income: ${formatCurrency(monthlyIncome)}
- Monthly Interest Repayment: ${formatCurrency(property.monthly_interest_repayment)}
- Monthly Body Corporate: ${formatCurrency(property.monthly_body_corporate)}
- Monthly Council Rates: ${formatCurrency(property.monthly_council_rates)}
- Monthly Water Rates: ${formatCurrency(property.monthly_water_rates)}
- Monthly Repairs & Maintenance: ${formatCurrency(property.monthly_repairs_maintenance)}
- Monthly Property Management: ${formatCurrency(property.monthly_property_management)}
- Monthly Landlord Insurance: ${formatCurrency(property.monthly_landlord_insurance)}
- Monthly Building Insurance: ${formatCurrency(property.monthly_building_insurance)}
- Total Monthly Expenditure: ${formatCurrency(monthlyExpenses)}
- Net Monthly Cashflow: ${formatCurrency(netCashflow)}

**CALCULATED METRICS:**
- Gross Yield: ${grossYield.toFixed(2)}%
- Net Yield: ${netYield.toFixed(2)}%
- Annual Cashflow: ${formatCurrency(annualCashflow)}
- Cash-on-Cash Return: ${cashOnCashReturn.toFixed(2)}%

Provide a comprehensive property investment analysis. Return valid JSON:
{
  "investmentScore": number (0-100),
  "investmentGrade": "string (A+, A, B+, B, C+, C, D, F)",
  "cashflowStatus": "string (Strong Positive/Positive/Neutral/Negative/Strong Negative)",
  "yieldAnalysis": "string (detailed yield assessment)",
  "equityPosition": "string (Strong/Moderate/Weak/Critical)",
  "strengths": ["string (3-5 key strengths)"],
  "concerns": ["string (3-5 concerns)"],
  "opportunities": ["string (3-5 growth opportunities)"],
  "risks": ["string (3-5 risks to monitor)"],
  "recommendations": ["string (5-7 specific recommendations)"],
  "marketComparison": "string (how this property compares to market averages)",
  "tenYearProjection": {
    "projectedValue": number (assuming 5% annual growth),
    "projectedEquity": number,
    "totalCashflow": number (cumulative over 10 years)
  }
}`;

      // Call Lovable AI
      const { data, error } = await invokeSecureFunction('report-qa', {
        messages: [
          { role: 'system', content: 'You are an expert property investment analyst. Respond with valid JSON only, no markdown.' },
          { role: 'user', content: prompt }
        ],
        model: 'google/gemini-2.5-flash',
      });

      if (error) throw error;

      // Parse AI response
      let analysis;
      try {
        const responseText = data?.response || data?.choices?.[0]?.message?.content || '';
        let jsonString = responseText;
        const jsonMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (jsonMatch) jsonString = jsonMatch[1];
        analysis = JSON.parse(jsonString);
      } catch (parseError) {
        console.error('Parse error:', parseError);
        // Fallback analysis if AI parsing fails
        analysis = {
          investmentScore: Math.round(50 + (grossYield * 5) + (netCashflow > 0 ? 10 : -10)),
          investmentGrade: grossYield > 5 ? 'B+' : grossYield > 4 ? 'B' : 'C',
          cashflowStatus: netCashflow > 500 ? 'Strong Positive' : netCashflow > 0 ? 'Positive' : netCashflow > -200 ? 'Neutral' : 'Negative',
          yieldAnalysis: `This property has a gross yield of ${grossYield.toFixed(2)}% and net yield of ${netYield.toFixed(2)}%.`,
          equityPosition: lvr < 50 ? 'Strong' : lvr < 70 ? 'Moderate' : lvr < 80 ? 'Weak' : 'Critical',
          strengths: ['Established property', 'Regular rental income'],
          concerns: ['Market volatility', 'Interest rate sensitivity'],
          opportunities: ['Rent review potential', 'Value-add renovations'],
          risks: ['Vacancy risk', 'Maintenance costs'],
          recommendations: ['Review rental income annually', 'Consider refinancing options'],
          marketComparison: 'Performance aligned with market averages.',
          tenYearProjection: {
            projectedValue: Math.round(value * Math.pow(1.05, 10)),
            projectedEquity: Math.round(value * Math.pow(1.05, 10) - loan * 0.7),
            totalCashflow: Math.round(annualCashflow * 10 * 1.2)
          }
        };
      }

      setReportData({
        property,
        clientName,
        analysis: {
          ...analysis,
          keyMetrics: {
            grossYield,
            netYield,
            lvr,
            equity,
            annualCashflow,
            cashOnCashReturn
          }
        },
        generatedAt: new Date().toISOString()
      });
      
      setShowPreview(true);
      toast.success('Property report generated successfully');
      
    } catch (error: any) {
      console.error('Report generation error:', error);
      toast.error('Failed to generate report: ' + error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const buildPdf = async () => {
    const container = document.getElementById('property-report-content');
    if (!container) throw new Error('Content not found');

    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
    });

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const imgWidth = 210;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const pageHeight = 297;

    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    return pdf;
  };

  const pdfFilename = () => {
    const shortAddress = property.address.split(',')[0].replace(/\s+/g, '_');
    return `Property_Report_${shortAddress}_${new Date().toISOString().split('T')[0]}.pdf`;
  };

  const downloadPDF = async () => {
    if (!reportData) return;
    setIsDownloading(true);
    try {
      const pdf = await buildPdf();
      pdf.save(pdfFilename());
      toast.success('PDF downloaded successfully');
      onComplete?.();
    } catch (error: any) {
      console.error('PDF generation error:', error);
      toast.error('Failed to generate PDF');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <>
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={generateReport}
        disabled={isGenerating}
      >
        {isGenerating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FileText className="h-4 w-4" />
        )}
      </Button>

      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Property Investment Report
              </span>
              <div className="flex items-center gap-1">
                <Button
                  onClick={downloadPDF}
                  disabled={isDownloading}
                  size="sm"
                >
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Download PDF
                </Button>
                <FlattenPdfIconButton
                  getPdfBlob={async () => (await buildPdf()).output('blob')}
                  filename={pdfFilename()}
                  disabled={isDownloading || !reportData}
                />
              </div>
            </DialogTitle>
            <DialogDescription>
              Investment analysis for {property.address}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[calc(90vh-120px)]">
            {reportData && (
              <div id="property-report-content" className="p-6 bg-white space-y-6">
                {/* Header */}
                <div className="border-b pb-4">
                  <h1 className="text-2xl font-bold text-primary">Investment Property Analysis</h1>
                  <p className="text-lg">{reportData.property.address}</p>
                  <p className="text-sm text-muted-foreground">
                    Client: {reportData.clientName} • Generated: {new Date(reportData.generatedAt).toLocaleDateString('en-AU')}
                  </p>
                </div>

                {/* Score Card */}
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Investment Score</p>
                        <p className="text-4xl font-bold text-primary">{reportData.analysis.investmentScore}/100</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Grade</p>
                        <p className={`text-4xl font-bold ${getGradeColor(reportData.analysis.investmentGrade)}`}>
                          {reportData.analysis.investmentGrade}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Cashflow</p>
                        <Badge variant={reportData.analysis.keyMetrics.annualCashflow >= 0 ? 'default' : 'destructive'}>
                          {reportData.analysis.cashflowStatus}
                        </Badge>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Equity Position</p>
                        <Badge variant="outline">{reportData.analysis.equityPosition}</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Key Metrics */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <DollarSign className="h-5 w-5" />
                      Key Financial Metrics
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-sm text-muted-foreground">Property Value</p>
                        <p className="text-xl font-bold">{formatCurrency(property.value)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Equity</p>
                        <p className="text-xl font-bold text-success">{formatCurrency(reportData.analysis.keyMetrics.equity)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">LVR</p>
                        <p className="text-xl font-bold">{reportData.analysis.keyMetrics.lvr.toFixed(1)}%</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Gross Yield</p>
                        <p className="text-xl font-bold">{reportData.analysis.keyMetrics.grossYield.toFixed(2)}%</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Net Yield</p>
                        <p className="text-xl font-bold">{reportData.analysis.keyMetrics.netYield.toFixed(2)}%</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Cash-on-Cash</p>
                        <p className="text-xl font-bold">{reportData.analysis.keyMetrics.cashOnCashReturn.toFixed(2)}%</p>
                      </div>
                    </div>
                    <Separator className="my-4" />
                    <div className="grid grid-cols-2 gap-4 text-center">
                      <div>
                        <p className="text-sm text-muted-foreground">Monthly Cashflow</p>
                        <p className={`text-2xl font-bold ${Number(property.net_monthly_cashflow) >= 0 ? 'text-success' : 'text-destructive'}`}>
                          {formatCurrency(property.net_monthly_cashflow)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Annual Cashflow</p>
                        <p className={`text-2xl font-bold ${reportData.analysis.keyMetrics.annualCashflow >= 0 ? 'text-success' : 'text-destructive'}`}>
                          {formatCurrency(reportData.analysis.keyMetrics.annualCashflow)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Yield Analysis */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Yield Analysis</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{reportData.analysis.yieldAnalysis}</p>
                  </CardContent>
                </Card>

                {/* SWOT Analysis */}
                <div className="grid grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-success flex items-center gap-1">
                        <TrendingUp className="h-4 w-4" /> Strengths
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm space-y-1">
                        {reportData.analysis.strengths.map((s, i) => (
                          <li key={i}>• {s}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-brand-700 flex items-center gap-1">
                        <AlertTriangle className="h-4 w-4" /> Concerns
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm space-y-1">
                        {reportData.analysis.concerns.map((c, i) => (
                          <li key={i}>• {c}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-info">Opportunities</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm space-y-1">
                        {reportData.analysis.opportunities.map((o, i) => (
                          <li key={i}>• {o}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-destructive">Risks</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm space-y-1">
                        {reportData.analysis.risks.map((r, i) => (
                          <li key={i}>• {r}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>

                {/* 10-Year Projections */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">10-Year Projections</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-sm text-muted-foreground">Projected Value</p>
                        <p className="text-xl font-bold text-primary">
                          {formatCurrency(reportData.analysis.tenYearProjection.projectedValue)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Projected Equity</p>
                        <p className="text-xl font-bold text-success">
                          {formatCurrency(reportData.analysis.tenYearProjection.projectedEquity)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Total Cashflow</p>
                        <p className="text-xl font-bold">
                          {formatCurrency(reportData.analysis.tenYearProjection.totalCashflow)}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-4 text-center">
                      *Projections assume 5% annual capital growth and stable rental conditions
                    </p>
                  </CardContent>
                </Card>

                {/* Recommendations */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Recommendations</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="text-sm space-y-2">
                      {reportData.analysis.recommendations.map((r, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="font-bold text-primary">{i + 1}.</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                {/* Footer */}
                <div className="text-center text-xs text-muted-foreground pt-4 border-t">
                  <p>This report is for informational purposes only. Please consult with qualified financial advisors.</p>
                  <p>Generated by Property Analytics</p>
                </div>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
