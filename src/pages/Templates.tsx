import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TemplateUploader } from '@/components/templates/TemplateUploader';
import { TemplateList } from '@/components/templates/TemplateList';

import { GlobalReportSettings } from '@/components/templates/GlobalReportSettings';
import { QATemplateUploader } from '@/components/templates/QATemplateUploader';
import { QATemplateList } from '@/components/templates/QATemplateList';
import { CashFlowTemplateUploader } from '@/components/templates/CashFlowTemplateUploader';
import { CashFlowTemplateList } from '@/components/templates/CashFlowTemplateList';
import { ReportFormatGroup } from '@/components/templates/ReportFormatGroup';
import { CoverPageOverlayManager } from '@/components/templates/cover-editor/CoverPageOverlayManager';
import {
  FileText, Brain, BarChart3, TrendingUp, Building2, Settings, MessageSquare,
  Calculator, MapPin, Hash, Map, Layers, Edit, Trash2, CheckCircle2, Plus, Search,
  LibraryBig,
  ArrowRight,
} from 'lucide-react';
import { ReportTemplateBindings } from '@/components/reports/ReportTemplateBindings';
import { TemplateLibraryTab } from '@/components/templateLibrary/TemplateLibraryTab';
import { TemplateStartChoices } from '@/components/templateBuilder/TemplateStartChoices';
import { isTemplateLibraryEnabled } from '@/lib/templateLibrary/featureFlag';

type ReportFormat =
  | 'investment_compass' 
  | 'investment_executive' 
  | 'investment_snapshot'
  | 'suburb_compass'
  | 'suburb_executive'
  | 'suburb_snapshot'
  | 'postcode_compass'
  | 'postcode_executive'
  | 'postcode_snapshot'
  | 'statewide_compass'
  | 'statewide_executive'
  | 'statewide_snapshot'
  | 'comparison_specific'
  | 'comparison_cashflow'
  | 'individual_cashflow';

interface ReportFormatConfig {
  id: ReportFormat;
  label: string;
  description: string;
  category: 'investment' | 'suburb' | 'postcode' | 'statewide' | 'comparison' | 'cash_flow';
  tier?: 'compass' | 'executive' | 'snapshot';
  icon: React.ElementType;
}

const REPORT_TYPE_LABELS: Record<string, string> = {
  investment: 'Investment Report',
  cashflow: 'Cash Flow',
  qa: 'Q&A Export',
  borrowing_capacity: 'Borrowing Capacity',
  portfolio: 'Portfolio Analysis',
  suburb: 'Suburb Analysis',
  postcode: 'Postcode Analysis',
  statewide: 'Statewide Analysis',
  comparison: 'Comparison Report',
  formara: 'Formara / Client Form',
};

const REPORT_FORMATS: ReportFormatConfig[] = [
  { id: 'investment_compass', label: 'Investor Compass', description: 'Comprehensive investment analysis report', category: 'investment', tier: 'compass', icon: Building2 },
  { id: 'investment_executive', label: 'Executive Brief', description: 'Condensed executive summary report', category: 'investment', tier: 'executive', icon: FileText },
  { id: 'investment_snapshot', label: 'Snapshot', description: 'Quick property snapshot overview', category: 'investment', tier: 'snapshot', icon: FileText },
  { id: 'suburb_compass', label: 'Suburb Compass', description: 'Comprehensive suburb-wide investment analysis', category: 'suburb', tier: 'compass', icon: MapPin },
  { id: 'suburb_executive', label: 'Suburb Executive Brief', description: 'Condensed suburb market summary', category: 'suburb', tier: 'executive', icon: FileText },
  { id: 'suburb_snapshot', label: 'Suburb Snapshot', description: 'Quick suburb overview', category: 'suburb', tier: 'snapshot', icon: FileText },
  { id: 'postcode_compass', label: 'Postcode Compass', description: 'Comprehensive postcode zone analysis', category: 'postcode', tier: 'compass', icon: Hash },
  { id: 'postcode_executive', label: 'Postcode Executive Brief', description: 'Condensed postcode market summary', category: 'postcode', tier: 'executive', icon: FileText },
  { id: 'postcode_snapshot', label: 'Postcode Snapshot', description: 'Quick postcode overview', category: 'postcode', tier: 'snapshot', icon: FileText },
  { id: 'statewide_compass', label: 'Statewide Compass', description: 'Comprehensive state-level market analysis', category: 'statewide', tier: 'compass', icon: Map },
  { id: 'statewide_executive', label: 'Statewide Executive Brief', description: 'Condensed state market summary', category: 'statewide', tier: 'executive', icon: FileText },
  { id: 'statewide_snapshot', label: 'Statewide Snapshot', description: 'Quick state overview', category: 'statewide', tier: 'snapshot', icon: FileText },
  { id: 'comparison_specific', label: 'Specific Property Comparison', description: 'Side-by-side property comparison analysis', category: 'comparison', icon: BarChart3 },
  { id: 'comparison_cashflow', label: '10 Year Cash Flow Comparison', description: 'Multi-property cash flow projection comparison', category: 'comparison', icon: TrendingUp },
  { id: 'individual_cashflow', label: 'Individual 10 Year Cash Flow', description: 'Single property detailed cash flow analysis', category: 'cash_flow', icon: TrendingUp },
];

const FORMAT_GROUPS = [
  { key: 'investment', title: 'Investment Reports', description: 'Templates for individual property investment analysis reports', icon: Building2, columns: 3 as const },
  { key: 'suburb', title: 'Suburb Analysis', description: 'Templates for suburb-wide market and investment analysis reports', icon: MapPin, columns: 3 as const },
  { key: 'postcode', title: 'Postcode Analysis', description: 'Templates for postcode-zone market and investment analysis reports', icon: Hash, columns: 3 as const },
  { key: 'statewide', title: 'Statewide Analysis', description: 'Templates for state-level macro market and investment analysis reports', icon: Map, columns: 3 as const },
  { key: 'comparison', title: 'Comparison Analysis', description: 'Templates for comparing multiple properties side-by-side', icon: BarChart3, columns: 2 as const },
  { key: 'cash_flow', title: 'Individual Cash Flow Analysis', description: 'Templates for detailed single property cash flow projections', icon: TrendingUp, columns: 2 as const },
];

export default function Templates() {
  const navigate = useNavigate();
  const { canEdit: canEditTemplates } = useModulePermissions('templates');
  const [activeTab, setActiveTab] = useState('report-formats');
  const [selectedFormat, setSelectedFormat] = useState<ReportFormat | null>(null);
  // Read once per mount: the flag is resolved from the URL, localStorage and
  // the build env, none of which change under a mounted component.
  const [templateLibraryEnabled] = useState(isTemplateLibraryEnabled);


  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ['report-structure-templates'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'report_structure_templates',
        listOptions: { orderBy: 'priority', orderAsc: false }
      });
      if (error) throw new Error(error.message);
      return data?.records || [];
    },
  });

  const filterTemplatesByType = (type: string) => {
    return templates?.filter(t => t.template_type === type) || [];
  };

  const filterTemplatesByFormat = (format: ReportFormatConfig) => {
    return templates?.filter(t => {
      if (format.tier) {
        return t.report_category === format.category && t.report_tier === format.tier;
      }
      return t.report_category === format.category;
    }) || [];
  };

  const getTemplateCountByFormat = (format: { id: string }) => {
    const config = REPORT_FORMATS.find(f => f.id === format.id);
    if (!config) return 0;
    return filterTemplatesByFormat(config).length;
  };

  const selectedConfig = REPORT_FORMATS.find(f => f.id === selectedFormat);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Template Management</h1>
        <p className="text-muted-foreground">
          Manage report templates, PDF layouts, and client branding profiles
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <TabsList className={`inline-flex w-auto min-w-full md:grid md:w-full ${templateLibraryEnabled ? 'md:grid-cols-8' : 'md:grid-cols-7'}`}>
            <TabsTrigger value="report-formats" className="flex items-center gap-1.5 text-xs md:text-sm whitespace-nowrap">
              <Brain className="h-3.5 w-3.5 md:h-4 md:w-4" />
              Formats
            </TabsTrigger>
            <TabsTrigger value="builder" className="flex items-center gap-1.5 text-xs md:text-sm whitespace-nowrap">
              <Layers className="h-3.5 w-3.5 md:h-4 md:w-4" />
              Builder
            </TabsTrigger>
            {templateLibraryEnabled && (
              <TabsTrigger value="template-library" className="flex items-center gap-1.5 text-xs md:text-sm whitespace-nowrap">
                <LibraryBig className="h-3.5 w-3.5 md:h-4 md:w-4" />
                Library
              </TabsTrigger>
            )}
            <TabsTrigger value="cover-editor" className="flex items-center gap-1.5 text-xs md:text-sm whitespace-nowrap">
              <Layers className="h-3.5 w-3.5 md:h-4 md:w-4" />
              Cover Page
            </TabsTrigger>
            <TabsTrigger value="pdf-layout" className="flex items-center gap-1.5 text-xs md:text-sm whitespace-nowrap">
              <FileText className="h-3.5 w-3.5 md:h-4 md:w-4" />
              PDF
            </TabsTrigger>
            <TabsTrigger value="qa-export" className="flex items-center gap-1.5 text-xs md:text-sm whitespace-nowrap">
              <MessageSquare className="h-3.5 w-3.5 md:h-4 md:w-4" />
              Q&A
            </TabsTrigger>
            <TabsTrigger value="cashflow-export" className="flex items-center gap-1.5 text-xs md:text-sm whitespace-nowrap">
              <Calculator className="h-3.5 w-3.5 md:h-4 md:w-4" />
              Cash Flow
            </TabsTrigger>
            {/* The Branding tab is retired (audit F14): it collected
                per-client logos and colours into client_branding_profiles,
                and no document generator ever read them — a decoy control
                that promised branding the reports never applied. The table
                and its rows are untouched; the real brand source remains
                whitelabel_settings through the brand resolvers. If
                per-client report branding is wanted, it is a design-system
                feature on that chain, not a settings table. */}
            <TabsTrigger value="global-settings" className="flex items-center gap-1.5 text-xs md:text-sm whitespace-nowrap">
              <Settings className="h-3.5 w-3.5 md:h-4 md:w-4" />
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="report-formats" className="space-y-6">
          {/* Which template each format's PDFs come out in. Separate from the
              groups below, which configure `report_structure_templates` — the
              prompts that decide what a report SAYS. This decides what it looks
              like, and until now nothing in the product did. */}
          <ReportTemplateBindings />

          {FORMAT_GROUPS.map((group) => (
            <ReportFormatGroup
              key={group.key}
              title={group.title}
              description={group.description}
              icon={group.icon}
              formats={REPORT_FORMATS.filter(f => f.category === group.key)}
              selectedFormat={selectedFormat}
              onSelectFormat={(id) => setSelectedFormat(id as ReportFormat | null)}
              getCount={getTemplateCountByFormat}
              columns={group.columns}
            />
          ))}

          {/* Selected Format Details — upload & list scoped to this format */}
          {selectedConfig && (
            <Card>
              <CardHeader>
                <CardTitle>{selectedConfig.label} Templates</CardTitle>
                <CardDescription>
                  Upload and manage AI structure templates for this report format
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <TemplateUploader
                  templateType="ai_structure"
                  defaultCategory={selectedConfig.category}
                  defaultTier={selectedConfig.tier}
                />
                <TemplateList
                  templates={filterTemplatesByFormat(selectedConfig)}
                  isLoading={templatesLoading}
                  templateType="ai_structure"
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="builder" className="space-y-6">
          {/* A pointer, not a second list.
              This tab used to duplicate the whole Template Builder landing page
              — its own search, sort, grid and New-template button — with a
              weaker delete that skipped the is_active / locked_for_review
              guards. Two surfaces doing one job, and only this one was
              reachable from the sidebar, which is why the converter felt
              missing. There is one list now; this is the way to it. */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Visual PDF Template Builder</h2>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Design PDF report layouts visually. Drag, drop, bind to live data, and preview the
                actual generated PDF in real time.
              </p>
            </div>
            <Button asChild>
              <Link to="/admin/template-builder">
                Open the Template Builder
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          <TemplateStartChoices
            onBlank={() => navigate('/admin/template-builder')}
            onImport={() => navigate('/admin/template-builder')}
            onConvert={() => navigate('/admin/template-builder/converter')}
            heading={null}
          />
        </TabsContent>

        {templateLibraryEnabled && (
          <TabsContent value="template-library" className="space-y-6">
            <TemplateLibraryTab />
          </TabsContent>
        )}

        <TabsContent value="cover-editor" className="space-y-4">
          <CoverPageOverlayManager />
        </TabsContent>

        <TabsContent value="pdf-layout" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>PDF Layout Templates</CardTitle>
              <CardDescription>
                HTML/CSS templates that control the visual layout and styling of generated PDF reports.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <TemplateUploader templateType="pdf_layout" />
              <TemplateList templates={filterTemplatesByType('pdf_layout')} isLoading={templatesLoading} templateType="pdf_layout" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="qa-export" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" />
                Q&A Export Templates
              </CardTitle>
              <CardDescription>
                Upload PDF templates to customize how Aurixa Intelligence Hub conversations are exported.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <QATemplateUploader />
              <QATemplateList />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cashflow-export" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5 text-primary" />
                Cash Flow Export Templates
              </CardTitle>
              <CardDescription>
                Upload PDF templates to customize how 10-Year Cash Flow analyses are exported.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <CashFlowTemplateUploader />
              <CashFlowTemplateList />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="global-settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Global Report Settings</CardTitle>
              <CardDescription>
                Configure contact details and professional disclaimer that will be applied across all generated reports.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GlobalReportSettings />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
