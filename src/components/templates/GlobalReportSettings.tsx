import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, Phone, Mail, Globe, MapPin, FileText, Save, Loader2, Type } from 'lucide-react';
import { useAuthenticatedSupabase } from '@/hooks/useAuthenticatedSupabase';
import { toast } from 'sonner';

interface ContactDetails {
  company_name: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  abn: string;
}

interface ProfessionalDisclaimer {
  text: string;
  is_enabled: boolean;
  font_size?: 'small' | 'medium' | 'large';
}

export function GlobalReportSettings() {
  // Writes carry the staff JWT so Phase 7 RLS can gate them to admins.
  const { supabase: authedSupabase } = useAuthenticatedSupabase();
  const [contactDetails, setContactDetails] = useState<ContactDetails>({
    company_name: '',
    phone: '',
    email: '',
    website: '',
    address: '',
    abn: ''
  });
  
  const [disclaimer, setDisclaimer] = useState<ProfessionalDisclaimer>({
    text: '',
    is_enabled: true,
    font_size: 'small'
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      // Read with the staff JWT so the settings table can drop its anon SELECT
      // grant (RLS-W2) without breaking this load.
      const { data, error } = await authedSupabase
        .from('global_report_settings')
        .select('*');

      if (error) throw error;

      data?.forEach((setting) => {
        if (setting.setting_key === 'contact_details') {
          setContactDetails(setting.setting_value as unknown as ContactDetails);
        } else if (setting.setting_key === 'professional_disclaimer') {
          setDisclaimer(setting.setting_value as unknown as ProfessionalDisclaimer);
        }
      });
    } catch (error) {
      console.error('Error fetching settings:', error);
      toast.error('Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  };

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      // Update contact details
      const { error: contactError } = await authedSupabase
        .from('global_report_settings')
        .update({ setting_value: JSON.parse(JSON.stringify(contactDetails)) })
        .eq('setting_key', 'contact_details');

      if (contactError) throw contactError;

      // Update disclaimer
      const { error: disclaimerError } = await authedSupabase
        .from('global_report_settings')
        .update({ setting_value: JSON.parse(JSON.stringify(disclaimer)) })
        .eq('setting_key', 'professional_disclaimer');

      if (disclaimerError) throw disclaimerError;

      toast.success('Settings saved successfully');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Contact Details Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Contact Details
          </CardTitle>
          <CardDescription>
            These details appear in the footer and contact sections of all generated reports.
            Company Name and ABN are also used at checkout — they become the billing name and
            business tax ID on your Aurixa invoices, so nobody has to retype them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="company_name">Company Name</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="company_name"
                  placeholder="Your Company Name"
                  className="pl-10"
                  value={contactDetails.company_name}
                  onChange={(e) => setContactDetails(prev => ({ ...prev, company_name: e.target.value }))}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="abn">ABN</Label>
              <Input
                id="abn"
                placeholder="12 345 678 901"
                value={contactDetails.abn}
                onChange={(e) => setContactDetails(prev => ({ ...prev, abn: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="phone"
                  type="tel"
                  placeholder="1300 000 000"
                  className="pl-10"
                  value={contactDetails.phone}
                  onChange={(e) => setContactDetails(prev => ({ ...prev, phone: e.target.value }))}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="info@company.com.au"
                  className="pl-10"
                  value={contactDetails.email}
                  onChange={(e) => setContactDetails(prev => ({ ...prev, email: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="website"
                  type="url"
                  placeholder="www.company.com.au"
                  className="pl-10"
                  value={contactDetails.website}
                  onChange={(e) => setContactDetails(prev => ({ ...prev, website: e.target.value }))}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="address">Business Address</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="address"
                  placeholder="123 Business St, Sydney NSW 2000"
                  className="pl-10"
                  value={contactDetails.address}
                  onChange={(e) => setContactDetails(prev => ({ ...prev, address: e.target.value }))}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Professional Disclaimer Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Professional Disclaimer
          </CardTitle>
          <CardDescription>
            This disclaimer will be included at the end of all generated reports
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="disclaimer-enabled">Include Disclaimer in Reports</Label>
              <p className="text-sm text-muted-foreground">
                Toggle to enable or disable the disclaimer in generated reports
              </p>
            </div>
            <Switch
              id="disclaimer-enabled"
              checked={disclaimer.is_enabled}
              onCheckedChange={(checked) => setDisclaimer(prev => ({ ...prev, is_enabled: checked }))}
            />
          </div>
          
          <Separator />

          {/* Font Size Selection */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Type className="h-4 w-4" />
              Font Size
            </Label>
            <Select
              value={disclaimer.font_size || 'small'}
              onValueChange={(value: 'small' | 'medium' | 'large') => 
                setDisclaimer(prev => ({ ...prev, font_size: value }))
              }
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select font size" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="small">Small (8pt)</SelectItem>
                <SelectItem value="medium">Medium (10pt)</SelectItem>
                <SelectItem value="large">Large (12pt)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Choose the font size for the disclaimer text in reports
            </p>
          </div>
          
          <Separator />
          
          <div className="space-y-2">
            <Label htmlFor="disclaimer-text">Disclaimer Text</Label>
            <Textarea
              id="disclaimer-text"
              placeholder="Enter your professional disclaimer...&#10;&#10;Use blank lines to create paragraph breaks.&#10;&#10;Each paragraph will be properly formatted in the report."
              className="min-h-[180px] resize-y font-mono text-sm"
              value={disclaimer.text}
              onChange={(e) => setDisclaimer(prev => ({ ...prev, text: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Use blank lines (press Enter twice) to create paragraph breaks. This text will appear in the disclaimer section of all reports.
            </p>
          </div>

          {/* Live Preview */}
          {disclaimer.text && (
            <div className="space-y-2 pt-2">
              <Label className="text-sm font-medium">Preview</Label>
              <div className="border rounded-lg p-4 bg-muted/30">
                <div 
                  className={`whitespace-pre-wrap ${
                    disclaimer.font_size === 'large' ? 'text-sm' : 
                    disclaimer.font_size === 'medium' ? 'text-xs' : 'text-[10px]'
                  } text-muted-foreground leading-relaxed`}
                >
                  {disclaimer.text}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={saveSettings} disabled={isSaving} size="lg">
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Global Settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
