import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { User } from 'lucide-react';

const genderOptions = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

interface ContactFieldsProps {
  prefix: 'primary' | 'secondary';
  title: string;
  formData: {
    primary_first_name: string;
    primary_middle_name: string;
    primary_surname: string;
    primary_mobile: string;
    primary_email: string;
    primary_gender: string;
    primary_dob: string;
    secondary_first_name: string;
    secondary_middle_name: string;
    secondary_surname: string;
    secondary_mobile: string;
    secondary_email: string;
    secondary_gender: string;
    secondary_dob: string;
  };
  updateField: (field: string, value: string) => void;
}

export function ContactFields({ prefix, title, formData, updateField }: ContactFieldsProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <User className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label className="text-xs">First Name {prefix === 'primary' && '*'}</Label>
            <Input
              value={formData[`${prefix}_first_name`]}
              onChange={(e) => updateField(`${prefix}_first_name`, e.target.value)}
              placeholder="John"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Middle Name</Label>
            <Input
              value={formData[`${prefix}_middle_name`]}
              onChange={(e) => updateField(`${prefix}_middle_name`, e.target.value)}
              placeholder=""
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Surname {prefix === 'primary' && '*'}</Label>
            <Input
              value={formData[`${prefix}_surname`]}
              onChange={(e) => updateField(`${prefix}_surname`, e.target.value)}
              placeholder="Smith"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-xs">Mobile</Label>
            <Input
              type="tel"
              value={formData[`${prefix}_mobile`]}
              onChange={(e) => updateField(`${prefix}_mobile`, e.target.value)}
              placeholder="0400 000 000"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Email</Label>
            <Input
              type="email"
              value={formData[`${prefix}_email`]}
              onChange={(e) => updateField(`${prefix}_email`, e.target.value)}
              placeholder="email@example.com"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-xs">Gender</Label>
            <Select
              value={formData[`${prefix}_gender`]}
              onValueChange={(v) => updateField(`${prefix}_gender`, v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select gender" />
              </SelectTrigger>
              <SelectContent>
                {genderOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Date of Birth</Label>
            <Input
              type="date"
              value={formData[`${prefix}_dob`]}
              onChange={(e) => updateField(`${prefix}_dob`, e.target.value)}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
