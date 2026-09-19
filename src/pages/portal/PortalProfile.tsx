import { useState, useEffect } from 'react';
import { usePortalProfileData, usePortalUpdateData } from '@/hooks/usePortalData';
import { smartCapitalize } from '@/lib/nameUtils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Loader2, Save, User, Users, CheckCircle, Shield, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

const GENDER_OPTIONS = ['Male', 'Female', 'Other', 'Prefer not to say'];
const MARITAL_OPTIONS = ['Single', 'Married', 'De Facto', 'Divorced', 'Widowed', 'Separated'];
const LIVING_OPTIONS = ['Renting', 'Owner Occupied', 'Living with Parents', 'Boarding', 'Other'];
const RESIDENTIAL_OPTIONS = ['Australian Citizen', 'Permanent Resident', 'Temporary Visa', 'NZ Citizen', 'Other'];

interface FormData {
  [key: string]: any;
}

function getInitials(firstName?: string, surname?: string): string {
  return [firstName?.[0], surname?.[0]].filter(Boolean).join('').toUpperCase() || '?';
}

export default function PortalProfile() {
  const { data, isLoading, error } = usePortalProfileData();
  const updateMutation = usePortalUpdateData();
  const [formData, setFormData] = useState<FormData>({});
  const [hasChanges, setHasChanges] = useState(false);

  const client = data?.client;

  useEffect(() => {
    if (client) {
      setFormData({
        primary_first_name: client.primary_first_name || '',
        primary_middle_name: client.primary_middle_name || '',
        primary_surname: client.primary_surname || '',
        primary_email: client.primary_email || '',
        primary_mobile: client.primary_mobile || '',
        primary_dob: client.primary_dob || '',
        primary_gender: client.primary_gender || '',
        current_address: client.current_address || '',
        current_suburb: client.current_suburb || '',
        current_state: client.current_state || '',
        current_postcode: client.current_postcode || '',
        country: client.country || '',
        marital_status: client.marital_status || '',
        dependents_count: client.dependents_count ?? '',
        living_situation: client.living_situation || '',
        residential_status: client.residential_status || '',
        secondary_first_name: client.secondary_first_name || '',
        secondary_middle_name: client.secondary_middle_name || '',
        secondary_surname: client.secondary_surname || '',
        secondary_email: client.secondary_email || '',
        secondary_mobile: client.secondary_mobile || '',
        secondary_dob: client.secondary_dob || '',
        secondary_gender: client.secondary_gender || '',
        secondary_current_address: client.secondary_current_address || '',
        secondary_current_suburb: client.secondary_current_suburb || '',
        secondary_current_state: client.secondary_current_state || '',
        secondary_current_postcode: client.secondary_current_postcode || '',
        secondary_country: client.secondary_country || '',
        secondary_living_situation: client.secondary_living_situation || '',
        secondary_residential_status: client.secondary_residential_status || '',
        secondary_same_address_as_primary: client.secondary_same_address_as_primary || false,
      });
      setHasChanges(false);
    }
  }, [client]);

  const updateField = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        operation: 'update',
        table: 'clients',
        data: formData,
      });
      setHasChanges(false);
      toast.success('Profile updated successfully');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update profile');
    }
  };

  const hasSecondary = !!(formData.secondary_first_name || formData.secondary_surname);
  const displayName = smartCapitalize(`${formData.primary_first_name || ''} ${formData.primary_surname || ''}`.trim());

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading your profile...</p>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/20 bg-destructive/5">
        <CardContent className="py-12 text-center">
          <AlertCircle className="h-10 w-10 text-destructive/40 mx-auto mb-3" />
          <p className="text-destructive font-medium">Unable to load profile</p>
          <p className="text-muted-foreground text-sm mt-1">Please try refreshing the page or logging in again.</p>
        </CardContent>
      </Card>
    );
  }

  return (
      <div className="space-y-6">
      {/* Header */}
      <div className="client-portal-page-header flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14 border-2 border-primary/20 shadow-md hidden sm:flex">
            <AvatarFallback className="bg-primary/10 text-primary font-bold text-lg">
              {getInitials(formData.primary_first_name, formData.primary_surname)}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              {displayName || 'My Profile'}
            </h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Shield className="h-3.5 w-3.5" />
              View and update your personal details
            </p>
          </div>
        </div>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || updateMutation.isPending}
          className="gap-2 rounded-xl shadow-lg shadow-primary/10"
          size="lg"
        >
          {updateMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : hasChanges ? (
            <Save className="h-4 w-4" />
          ) : (
            <CheckCircle className="h-4 w-4" />
          )}
          {updateMutation.isPending ? 'Saving...' : hasChanges ? 'Save Changes' : 'All Saved'}
        </Button>
      </div>

      {/* Primary Contact */}
      <Card className="client-portal-soft-panel overflow-hidden">
        <CardHeader className="border-b border-border/50 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 shadow-sm">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Primary Contact</CardTitle>
              <CardDescription className="text-xs">Your main contact information</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          {/* Name row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">First Name</Label>
              <Input value={formData.primary_first_name} onChange={(e) => updateField('primary_first_name', e.target.value)} className="border-border/60" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Middle Name</Label>
              <Input value={formData.primary_middle_name} onChange={(e) => updateField('primary_middle_name', e.target.value)} className="border-border/60" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Surname</Label>
              <Input value={formData.primary_surname} onChange={(e) => updateField('primary_surname', e.target.value)} className="border-border/60" />
            </div>
          </div>

          {/* Contact row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</Label>
              <Input type="email" value={formData.primary_email} onChange={(e) => updateField('primary_email', e.target.value)} className="border-border/60" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mobile</Label>
              <Input type="tel" value={formData.primary_mobile} onChange={(e) => updateField('primary_mobile', e.target.value)} className="border-border/60" />
            </div>
          </div>

          {/* Personal details row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Date of Birth</Label>
              <Input type="date" value={formData.primary_dob} onChange={(e) => updateField('primary_dob', e.target.value)} className="border-border/60" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Gender</Label>
              <Select value={formData.primary_gender} onValueChange={(v) => updateField('primary_gender', v)}>
                <SelectTrigger className="border-border/60"><SelectValue placeholder="Select gender" /></SelectTrigger>
                <SelectContent>
                  {GENDER_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dependents</Label>
              <Input type="number" min="0" value={formData.dependents_count} onChange={(e) => updateField('dependents_count', e.target.value ? Number(e.target.value) : null)} className="border-border/60" />
            </div>
          </div>

          <Separator className="bg-border/40" />

          {/* Address & living */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Current Address</Label>
              <Input value={formData.current_address} onChange={(e) => updateField('current_address', e.target.value)} className="border-border/60" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Suburb / City</Label>
              <Input value={formData.current_suburb} onChange={(e) => updateField('current_suburb', e.target.value)} className="border-border/60" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">State</Label>
              <Input value={formData.current_state} onChange={(e) => updateField('current_state', e.target.value.toUpperCase())} maxLength={3} className="border-border/60" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Postcode</Label>
              <Input value={formData.current_postcode} onChange={(e) => updateField('current_postcode', e.target.value)} maxLength={4} className="border-border/60" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Country</Label>
              <Input value={formData.country} onChange={(e) => updateField('country', e.target.value)} className="border-border/60" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Marital Status</Label>
              <Select value={formData.marital_status} onValueChange={(v) => updateField('marital_status', v)}>
                <SelectTrigger className="border-border/60"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {MARITAL_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Living Situation</Label>
              <Select value={formData.living_situation} onValueChange={(v) => updateField('living_situation', v)}>
                <SelectTrigger className="border-border/60"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {LIVING_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Residential Status</Label>
              <Select value={formData.residential_status} onValueChange={(v) => updateField('residential_status', v)}>
                <SelectTrigger className="border-border/60"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {RESIDENTIAL_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Secondary Contact */}
      {hasSecondary && (
        <Card className="client-portal-soft-panel overflow-hidden">
          <CardHeader className="border-b border-border/50 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2.5 shadow-sm">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Secondary Contact</CardTitle>
                <CardDescription className="text-xs">Joint applicant details</CardDescription>
              </div>
              <Badge variant="secondary" className="ml-auto text-xs">Joint Applicant</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">First Name</Label>
                <Input value={formData.secondary_first_name} onChange={(e) => updateField('secondary_first_name', e.target.value)} className="border-border/60" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Middle Name</Label>
                <Input value={formData.secondary_middle_name} onChange={(e) => updateField('secondary_middle_name', e.target.value)} className="border-border/60" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Surname</Label>
                <Input value={formData.secondary_surname} onChange={(e) => updateField('secondary_surname', e.target.value)} className="border-border/60" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</Label>
                <Input type="email" value={formData.secondary_email} onChange={(e) => updateField('secondary_email', e.target.value)} className="border-border/60" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mobile</Label>
                <Input type="tel" value={formData.secondary_mobile} onChange={(e) => updateField('secondary_mobile', e.target.value)} className="border-border/60" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Date of Birth</Label>
                <Input type="date" value={formData.secondary_dob} onChange={(e) => updateField('secondary_dob', e.target.value)} className="border-border/60" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Gender</Label>
                <Select value={formData.secondary_gender} onValueChange={(v) => updateField('secondary_gender', v)}>
                  <SelectTrigger className="border-border/60"><SelectValue placeholder="Select gender" /></SelectTrigger>
                  <SelectContent>
                    {GENDER_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Living Situation</Label>
                <Select value={formData.secondary_living_situation} onValueChange={(v) => updateField('secondary_living_situation', v)}>
                  <SelectTrigger className="border-border/60"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {LIVING_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Address</Label>
                <Input value={formData.secondary_current_address} onChange={(e) => updateField('secondary_current_address', e.target.value)} placeholder={formData.secondary_same_address_as_primary ? 'Same as primary' : 'Enter address'} className="border-border/60" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Residential Status</Label>
                <Select value={formData.secondary_residential_status} onValueChange={(v) => updateField('secondary_residential_status', v)}>
                  <SelectTrigger className="border-border/60"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {RESIDENTIAL_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}