import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { 
  Settings, 
  X, 
  RotateCcw, 
  Info, 
  Shield, 
  Target, 
  Clock, 
  TrendingUp,
  Percent,
  Building2,
  Wallet,
  PiggyBank,
  ChartBar,
  Landmark,
  Save,
  FolderOpen
} from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

export interface PortfolioAnalysisSettings {
  riskTolerance: 'conservative' | 'moderate' | 'aggressive' | null;
  investmentStrategy: 'capital_growth' | 'cash_flow' | 'balanced' | 'wealth_accumulation' | null;
  timeHorizon: 'short' | 'medium' | 'long' | 'multi_generational' | null;
  projectionPeriod: 5 | 10 | 15 | 20 | null;
  growthRateAssumption: 'conservative' | 'moderate' | 'optimistic' | null;
  interestRateScenario: 'current' | 'plus_1' | 'plus_2' | null;
  equityStrategy: 'aggressive' | 'conservative' | 'moderate' | null;
  debtReductionPriority: 'aggressive' | 'interest_only' | 'balanced' | null;
  nextPropertyPreference: 'growth' | 'yield' | 'regional' | 'metro' | 'none' | null;
  taxOptimizationPriority: 'high' | 'medium' | 'low' | null;
  retirementTimeline: number | null;
  marketOutlook: 'bullish' | 'neutral' | 'bearish' | null;
}

export const DEFAULT_SETTINGS: PortfolioAnalysisSettings = {
  riskTolerance: null,
  investmentStrategy: null,
  timeHorizon: null,
  projectionPeriod: null,
  growthRateAssumption: null,
  interestRateScenario: null,
  equityStrategy: null,
  debtReductionPriority: null,
  nextPropertyPreference: null,
  taxOptimizationPriority: null,
  retirementTimeline: null,
  marketOutlook: null,
};

interface PortfolioAnalysisConfigProps {
  settings: PortfolioAnalysisSettings;
  onChange: (settings: PortfolioAnalysisSettings) => void;
}

interface ConfigFieldProps {
  label: string;
  tooltip: string;
  icon: React.ReactNode;
  value: string | number | null;
  onClear: () => void;
  children: React.ReactNode;
}

function ConfigField({ label, tooltip, icon, value, onClear, children }: ConfigFieldProps) {
  const hasValue = value !== null && value !== undefined && value !== '';
  
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <Label className="text-sm font-medium">{label}</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-xs">{tooltip}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {hasValue && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={onClear}
          >
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

interface SavedTemplate {
  id: string;
  name: string;
  description: string | null;
  settings: PortfolioAnalysisSettings;
  is_default: boolean;
}

export function PortfolioAnalysisConfig({ settings, onChange }: PortfolioAnalysisConfigProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'portfolio_analysis_templates',
        listOptions: { orderBy: 'created_at', orderAsc: false }
      });

      if (error) throw error;
      setSavedTemplates(data?.records || []);
    } catch (error) {
      console.error('Error loading templates:', error);
    }
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) {
      toast.error('Please enter a template name');
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await invokeSecureFunction('manage-templates', {
        operation: 'insert',
        table: 'portfolio_analysis_templates',
        data: {
          name: templateName.trim(),
          settings: settings,
          is_default: false
        }
      });

      if (error) throw error;
      toast.success('Template saved successfully');
      setTemplateName('');
      loadTemplates();
    } catch (error) {
      console.error('Error saving template:', error);
      toast.error('Failed to save template');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadTemplate = (template: SavedTemplate) => {
    onChange(template.settings);
    toast.success(`Loaded template: ${template.name}`);
  };

  const updateField = <K extends keyof PortfolioAnalysisSettings>(
    field: K, 
    value: PortfolioAnalysisSettings[K]
  ) => {
    onChange({ ...settings, [field]: value });
  };

  const clearField = <K extends keyof PortfolioAnalysisSettings>(field: K) => {
    onChange({ ...settings, [field]: null });
  };

  const clearAll = () => {
    onChange(DEFAULT_SETTINGS);
    toast.info('All configuration options cleared');
  };

  const hasAnySettings = Object.values(settings).some(v => v !== null);

  return (
    <Card className="border-accent/30 bg-accent/50 dark:border-accent/30 dark:bg-accent/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings className="h-5 w-5 text-accent" />
            AI Analysis Configuration
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Configure these parameters to tailor the AI-generated portfolio analysis to your client's specific situation and goals.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
          <div className="flex items-center gap-2">
            {hasAnySettings && (
              <Button 
                variant="outline" 
                size="sm" 
                className="text-xs"
                onClick={clearAll}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Clear All
              </Button>
            )}
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? 'Collapse' : 'Expand'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isExpanded && (
          <p className="text-sm text-muted-foreground">
            {hasAnySettings 
              ? `${Object.values(settings).filter(v => v !== null).length} options configured`
              : 'Click expand to configure AI analysis parameters'}
          </p>
        )}

        {isExpanded && (
          <>
            {/* Saved Templates */}
            {savedTemplates.length > 0 && (
              <div className="space-y-2 pb-4 border-b">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 text-accent" />
                  Load Saved Template
                </Label>
                <div className="flex flex-wrap gap-2">
                  {savedTemplates.map(template => (
                    <Button
                      key={template.id}
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => handleLoadTemplate(template)}
                    >
                      {template.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Section: Core Risk & Strategy */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground border-b pb-1">
                Core Risk & Strategy
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ConfigField
                  label="Risk Tolerance"
                  tooltip="Determines how aggressive the recommendations will be regarding leverage, property selection, and growth strategies."
                  icon={<Shield className="h-4 w-4 text-accent" />}
                  value={settings.riskTolerance}
                  onClear={() => clearField('riskTolerance')}
                >
                  <Select 
                    value={settings.riskTolerance || ''} 
                    onValueChange={(v) => updateField('riskTolerance', v as any)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select risk tolerance..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="conservative">Conservative</SelectItem>
                      <SelectItem value="moderate">Moderate</SelectItem>
                      <SelectItem value="aggressive">Aggressive</SelectItem>
                    </SelectContent>
                  </Select>
                </ConfigField>

                <ConfigField
                  label="Investment Strategy Focus"
                  tooltip="The primary investment approach - whether to prioritize capital appreciation, rental income, or a balanced approach."
                  icon={<Target className="h-4 w-4 text-accent" />}
                  value={settings.investmentStrategy}
                  onClear={() => clearField('investmentStrategy')}
                >
                  <Select 
                    value={settings.investmentStrategy || ''} 
                    onValueChange={(v) => updateField('investmentStrategy', v as any)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select strategy focus..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="capital_growth">Capital Growth</SelectItem>
                      <SelectItem value="cash_flow">Cash Flow</SelectItem>
                      <SelectItem value="balanced">Balanced</SelectItem>
                      <SelectItem value="wealth_accumulation">Wealth Accumulation</SelectItem>
                    </SelectContent>
                  </Select>
                </ConfigField>

                <ConfigField
                  label="Time Horizon"
                  tooltip="How long until the client expects to achieve their investment goals or need returns."
                  icon={<Clock className="h-4 w-4 text-accent" />}
                  value={settings.timeHorizon}
                  onClear={() => clearField('timeHorizon')}
                >
                  <Select 
                    value={settings.timeHorizon || ''} 
                    onValueChange={(v) => updateField('timeHorizon', v as any)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select time horizon..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="short">Short-term (1-3 years)</SelectItem>
                      <SelectItem value="medium">Medium-term (3-7 years)</SelectItem>
                      <SelectItem value="long">Long-term (7-15 years)</SelectItem>
                      <SelectItem value="multi_generational">Multi-generational (15+ years)</SelectItem>
                    </SelectContent>
                  </Select>
                </ConfigField>
              </div>
            </div>

            {/* Section: Financial Projections */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground border-b pb-1">
                Financial Projections
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ConfigField
                  label="Projection Period"
                  tooltip="Number of years to project portfolio growth and cashflow."
                  icon={<TrendingUp className="h-4 w-4 text-accent" />}
                  value={settings.projectionPeriod}
                  onClear={() => clearField('projectionPeriod')}
                >
                  <Select 
                    value={settings.projectionPeriod?.toString() || ''} 
                    onValueChange={(v) => updateField('projectionPeriod', parseInt(v) as any)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select projection period..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 Years</SelectItem>
                      <SelectItem value="10">10 Years</SelectItem>
                      <SelectItem value="15">15 Years</SelectItem>
                      <SelectItem value="20">20 Years</SelectItem>
                    </SelectContent>
                  </Select>
                </ConfigField>

                <ConfigField
                  label="Growth Rate Assumption"
                  tooltip="The assumed annual capital growth rate for projections."
                  icon={<Percent className="h-4 w-4 text-accent" />}
                  value={settings.growthRateAssumption}
                  onClear={() => clearField('growthRateAssumption')}
                >
                  <Select 
                    value={settings.growthRateAssumption || ''} 
                    onValueChange={(v) => updateField('growthRateAssumption', v as any)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select growth assumption..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="conservative">Conservative (3-4%)</SelectItem>
                      <SelectItem value="moderate">Moderate (5-6%)</SelectItem>
                      <SelectItem value="optimistic">Optimistic (7-8%)</SelectItem>
                    </SelectContent>
                  </Select>
                </ConfigField>

                <ConfigField
                  label="Interest Rate Scenario"
                  tooltip="Stress test the portfolio against potential interest rate changes."
                  icon={<ChartBar className="h-4 w-4 text-accent" />}
                  value={settings.interestRateScenario}
                  onClear={() => clearField('interestRateScenario')}
                >
                  <Select 
                    value={settings.interestRateScenario || ''} 
                    onValueChange={(v) => updateField('interestRateScenario', v as any)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select rate scenario..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="current">Current Rates</SelectItem>
                      <SelectItem value="plus_1">+1% Stress Test</SelectItem>
                      <SelectItem value="plus_2">+2% Stress Test</SelectItem>
                    </SelectContent>
                  </Select>
                </ConfigField>
              </div>
            </div>

            {/* Section: Portfolio Strategy */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground border-b pb-1">
                Portfolio Strategy
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ConfigField
                  label="Equity Strategy"
                  tooltip="How aggressively should equity be redeployed for portfolio growth?"
                  icon={<Building2 className="h-4 w-4 text-accent" />}
                  value={settings.equityStrategy}
                  onClear={() => clearField('equityStrategy')}
                >
                  <Select 
                    value={settings.equityStrategy || ''} 
                    onValueChange={(v) => updateField('equityStrategy', v as any)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select equity strategy..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="aggressive">Aggressive Leveraging</SelectItem>
                      <SelectItem value="moderate">Moderate Redeployment</SelectItem>
                      <SelectItem value="conservative">Conservative (Low LVR)</SelectItem>
                    </SelectContent>
                  </Select>
                </ConfigField>

                <ConfigField
                  label="Debt Reduction Priority"
                  tooltip="The approach to managing and reducing debt across the portfolio."
                  icon={<Wallet className="h-4 w-4 text-accent" />}
                  value={settings.debtReductionPriority}
                  onClear={() => clearField('debtReductionPriority')}
                >
                  <Select 
                    value={settings.debtReductionPriority || ''} 
                    onValueChange={(v) => updateField('debtReductionPriority', v as any)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select debt priority..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="aggressive">Aggressive Paydown</SelectItem>
                      <SelectItem value="interest_only">Interest-Only Focus</SelectItem>
                      <SelectItem value="balanced">Balanced Approach</SelectItem>
                    </SelectContent>
                  </Select>
                </ConfigField>

                <ConfigField
                  label="Next Property Preference"
                  tooltip="What type of property should be recommended for the next acquisition?"
                  icon={<Building2 className="h-4 w-4 text-accent" />}
                  value={settings.nextPropertyPreference}
                  onClear={() => clearField('nextPropertyPreference')}
                >
                  <Select 
                    value={settings.nextPropertyPreference || ''} 
                    onValueChange={(v) => updateField('nextPropertyPreference', v as any)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select property preference..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="growth">Growth Suburbs</SelectItem>
                      <SelectItem value="yield">High Yield Areas</SelectItem>
                      <SelectItem value="regional">Regional Focus</SelectItem>
                      <SelectItem value="metro">Metro Focus</SelectItem>
                      <SelectItem value="none">No Recommendation Needed</SelectItem>
                    </SelectContent>
                  </Select>
                </ConfigField>
              </div>
            </div>

            {/* Section: Client-Specific Context */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground border-b pb-1">
                Client-Specific Context
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ConfigField
                  label="Tax Optimization Priority"
                  tooltip="How much emphasis to place on tax deductions and negative gearing strategies."
                  icon={<PiggyBank className="h-4 w-4 text-accent" />}
                  value={settings.taxOptimizationPriority}
                  onClear={() => clearField('taxOptimizationPriority')}
                >
                  <Select 
                    value={settings.taxOptimizationPriority || ''} 
                    onValueChange={(v) => updateField('taxOptimizationPriority', v as any)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select tax priority..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="high">High (Maximize Deductions)</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="low">Low (Focus on Cash Flow)</SelectItem>
                    </SelectContent>
                  </Select>
                </ConfigField>

                <ConfigField
                  label="Retirement Timeline"
                  tooltip="Years until retirement - affects long-term strategy recommendations."
                  icon={<Landmark className="h-4 w-4 text-accent" />}
                  value={settings.retirementTimeline}
                  onClear={() => clearField('retirementTimeline')}
                >
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    placeholder="Years until retirement..."
                    value={settings.retirementTimeline ?? ''}
                    onChange={(e) => updateField('retirementTimeline', e.target.value ? parseInt(e.target.value) : null)}
                  />
                </ConfigField>

                <ConfigField
                  label="Market Outlook"
                  tooltip="Your assessment of the current property market conditions - shapes risk commentary."
                  icon={<ChartBar className="h-4 w-4 text-accent" />}
                  value={settings.marketOutlook}
                  onClear={() => clearField('marketOutlook')}
                >
                  <Select 
                    value={settings.marketOutlook || ''} 
                    onValueChange={(v) => updateField('marketOutlook', v as any)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select market outlook..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bullish">Bullish</SelectItem>
                      <SelectItem value="neutral">Neutral</SelectItem>
                      <SelectItem value="bearish">Bearish</SelectItem>
                    </SelectContent>
                  </Select>
                </ConfigField>
              </div>
            </div>

            {/* Save Template */}
            <div className="pt-4 border-t space-y-2">
              <Label className="text-sm font-medium">Save as Template</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Template name..."
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  className="flex-1"
                />
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleSaveTemplate}
                  disabled={isSaving || !templateName.trim() || !hasAnySettings}
                >
                  <Save className="h-4 w-4 mr-1" />
                  Save
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
