import { Button } from '@/components/ui/button';
import { Shield, Eye, Pencil, Sparkles } from 'lucide-react';

interface PermissionSetting {
  module_key: string;
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

interface PermissionPresetsProps {
  modules: Array<{ module_key: string }>;
  onApply: (permissions: PermissionSetting[]) => void;
}

const presets = [
  {
    id: 'full_access',
    label: 'Full Access',
    description: 'View, edit, and delete everything',
    icon: Shield,
    apply: (modules: Array<{ module_key: string }>): PermissionSetting[] =>
      modules.map(m => ({ module_key: m.module_key, can_view: true, can_edit: true, can_delete: true })),
  },
  {
    id: 'read_only',
    label: 'Read Only',
    description: 'View all modules, no editing or deleting',
    icon: Eye,
    apply: (modules: Array<{ module_key: string }>): PermissionSetting[] =>
      modules.map(m => ({ module_key: m.module_key, can_view: true, can_edit: false, can_delete: false })),
  },
  {
    id: 'editor',
    label: 'Editor',
    description: 'View and edit all modules, no deleting',
    icon: Pencil,
    apply: (modules: Array<{ module_key: string }>): PermissionSetting[] =>
      modules.map(m => ({ module_key: m.module_key, can_view: true, can_edit: true, can_delete: false })),
  },
  {
    id: 'none',
    label: 'No Access',
    description: 'Remove all permissions',
    icon: Sparkles,
    apply: (modules: Array<{ module_key: string }>): PermissionSetting[] =>
      modules.map(m => ({ module_key: m.module_key, can_view: false, can_edit: false, can_delete: false })),
  },
];

export function PermissionPresets({ modules, onApply }: PermissionPresetsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className="text-xs text-muted-foreground self-center mr-1">Presets:</span>
      {presets.map(preset => (
        <Button
          key={preset.id}
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => onApply(preset.apply(modules))}
          title={preset.description}
        >
          <preset.icon className="h-3 w-3" />
          {preset.label}
        </Button>
      ))}
    </div>
  );
}
