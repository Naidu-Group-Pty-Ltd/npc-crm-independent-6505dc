import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Emoji icon picker for checklist templates and sections.
 *
 * Icons here are plain emoji strings stored on the row. The old control was
 * a bare text input, which on a desktop keyboard can only DELETE an emoji,
 * not type one — "the icon can't be changed but can be deleted". A picker
 * makes choosing possible everywhere a keyboard exists.
 */
const ICON_CHOICES = [
  '📋', '✅', '📝', '🗂️', '📁', '🗓️', '⏰', '🎯',
  '🚀', '🏠', '🏢', '🏗️', '🔑', '💰', '💳', '📊',
  '📈', '📞', '✉️', '👥', '🤝', '🧾', '⚖️', '🛡️',
  '🔍', '🧭', '🛠️', '🔨', '⭐', '🏆', '🎉', '💡',
  '📌', '🔔', '❗', '🧱', '🌱', '🧮', '🖊️', '🗃️',
  '▶️', '🔁', '📦', '🧰', '🪜', '🧹', '🚦', '🏁',
];

interface IconPickerProps {
  value: string;
  onChange: (icon: string) => void;
  ariaLabel?: string;
  triggerClassName?: string;
}

export function IconPicker({ value, onChange, ariaLabel = 'Choose an icon', triggerClassName }: IconPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={ariaLabel}
          title={ariaLabel}
          className={cn('h-10 w-14 shrink-0 px-0 text-xl', triggerClassName)}
        >
          {value || '📋'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">Pick an icon</p>
        <div className="grid max-h-56 grid-cols-8 gap-1 overflow-y-auto" role="listbox" aria-label={ariaLabel}>
          {ICON_CHOICES.map((icon) => (
            <button
              key={icon}
              type="button"
              role="option"
              aria-selected={icon === value}
              onClick={() => {
                onChange(icon);
                setOpen(false);
              }}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md text-base transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                icon === value && 'bg-primary/15 ring-1 ring-primary/40'
              )}
            >
              {icon}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
