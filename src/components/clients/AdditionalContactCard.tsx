import { memo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { User, Trash2 } from 'lucide-react';

export interface AdditionalContact {
  id?: string;
  client_id?: string;
  relationship: string;
  first_name: string;
  surname: string;
  middle_name?: string;
  email?: string;
  mobile?: string;
  dob?: string;
  gender?: string;
  notes?: string;
  display_order: number;
  isNew?: boolean; // Flag for newly added contacts not yet saved
}

interface AdditionalContactCardProps {
  contact: AdditionalContact;
  index: number;
  onChange: (index: number, contact: AdditionalContact) => void;
  onRemove: (index: number) => void;
  isEditing?: boolean;
}

const genderOptions = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const relationshipOptions = [
  { value: 'Spouse', label: 'Spouse' },
  { value: 'Partner', label: 'Partner' },
  { value: 'Family Member', label: 'Family Member' },
  { value: 'Guarantor', label: 'Guarantor' },
  { value: 'Business Partner', label: 'Business Partner' },
  { value: 'Accountant', label: 'Accountant' },
  { value: 'Solicitor', label: 'Solicitor' },
  { value: 'Financial Advisor', label: 'Financial Advisor' },
  { value: 'Power of Attorney', label: 'Power of Attorney' },
  { value: 'Trustee', label: 'Trustee' },
  { value: 'Director', label: 'Director' },
  { value: 'Additional Applicant', label: 'Additional Applicant' },
  { value: 'Other', label: 'Other' },
];

export const AdditionalContactCard = memo(function AdditionalContactCard({
  contact,
  index,
  onChange,
  onRemove,
  isEditing = true,
}: AdditionalContactCardProps) {
  const updateField = useCallback((field: keyof AdditionalContact, value: string) => {
    onChange(index, { ...contact, [field]: value });
  }, [onChange, index, contact]);

  const ordinalLabel = getOrdinalLabel(index + 3); // +3 because Primary=1, Secondary=2

  return (
    <Card className="relative">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <User className="h-4 w-4" />
            {ordinalLabel} Contact
          </CardTitle>
          {isEditing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRemove(index)}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Relationship */}
        <div className="space-y-2">
          <Label className="text-xs">Relationship / Role *</Label>
          <Select
            value={contact.relationship}
            onValueChange={(v) => updateField('relationship', v)}
            disabled={!isEditing}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select relationship" />
            </SelectTrigger>
            <SelectContent>
              {relationshipOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Name fields */}
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label className="text-xs">First Name *</Label>
            <Input
              value={contact.first_name}
              onChange={(e) => updateField('first_name', e.target.value)}
              placeholder="John"
              disabled={!isEditing}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Middle Name</Label>
            <Input
              value={contact.middle_name || ''}
              onChange={(e) => updateField('middle_name', e.target.value)}
              placeholder=""
              disabled={!isEditing}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Surname *</Label>
            <Input
              value={contact.surname}
              onChange={(e) => updateField('surname', e.target.value)}
              placeholder="Smith"
              disabled={!isEditing}
            />
          </div>
        </div>

        {/* Contact details */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-xs">Mobile</Label>
            <Input
              type="tel"
              value={contact.mobile || ''}
              onChange={(e) => updateField('mobile', e.target.value)}
              placeholder="0400 000 000"
              disabled={!isEditing}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Email</Label>
            <Input
              type="email"
              value={contact.email || ''}
              onChange={(e) => updateField('email', e.target.value)}
              placeholder="email@example.com"
              disabled={!isEditing}
            />
          </div>
        </div>

        {/* Gender and DOB */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-xs">Gender</Label>
            <Select
              value={contact.gender || ''}
              onValueChange={(v) => updateField('gender', v)}
              disabled={!isEditing}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select gender" />
              </SelectTrigger>
              <SelectContent>
                {genderOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Date of Birth</Label>
            <Input
              type="date"
              value={contact.dob || ''}
              onChange={(e) => updateField('dob', e.target.value)}
              disabled={!isEditing}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

// Helper function for ordinal labels
function getOrdinalLabel(n: number): string {
  const ordinals: Record<number, string> = {
    3: 'Third',
    4: 'Fourth',
    5: 'Fifth',
    6: 'Sixth',
    7: 'Seventh',
    8: 'Eighth',
    9: 'Ninth',
    10: 'Tenth',
  };
  return ordinals[n] || `${n}th`;
}

export { relationshipOptions };
