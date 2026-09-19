import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Palette, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Theme {
  id: string;
  name: string;
  preview: string;
  userBg: string;
  assistantBg: string;
  accent: string;
}

const themes: Theme[] = [
  { 
    id: 'default', 
    name: 'Default', 
    preview: 'bg-gradient-to-r from-primary to-muted',
    userBg: 'bg-primary text-primary-foreground',
    assistantBg: 'bg-muted',
    accent: 'bg-primary/10'
  },
  { 
    id: 'ocean', 
    name: 'Ocean', 
    preview: 'bg-gradient-to-r from-info to-info',
    userBg: 'bg-info text-foreground dark:text-primary-foreground',
    assistantBg: 'bg-info/10 dark:bg-info',
    accent: 'bg-info/10'
  },
  { 
    id: 'forest', 
    name: 'Forest', 
    preview: 'bg-gradient-to-r from-success to-success',
    userBg: 'bg-success text-foreground dark:text-primary-foreground',
    assistantBg: 'bg-success/10 dark:bg-success',
    accent: 'bg-success/10'
  },
  { 
    id: 'sunset', 
    name: 'Sunset', 
    preview: 'bg-gradient-to-r from-warning to-accent',
    userBg: 'bg-gradient-to-r from-warning to-accent text-foreground dark:text-primary-foreground',
    assistantBg: 'bg-warning/10 dark:bg-warning',
    accent: 'bg-warning/10'
  },
  { 
    id: 'midnight', 
    name: 'Midnight', 
    preview: 'bg-gradient-to-r from-accent to-accent',
    userBg: 'bg-gradient-to-r from-accent to-accent text-foreground dark:text-primary-foreground',
    assistantBg: 'bg-accent/10 dark:bg-accent',
    accent: 'bg-accent/10'
  },
  { 
    id: 'minimal', 
    name: 'Minimal', 
    preview: 'bg-gradient-to-r from-muted to-muted',
    userBg: 'bg-background text-foreground dark:text-primary-foreground dark:bg-muted dark:text-foreground',
    assistantBg: 'bg-muted dark:bg-background',
    accent: 'bg-muted/10'
  },
];

interface ChatThemeSelectorProps {
  onThemeChange: (theme: Theme) => void;
}

export function ChatThemeSelector({ onThemeChange }: ChatThemeSelectorProps) {
  const [selectedTheme, setSelectedTheme] = useState<string>('default');

  useEffect(() => {
    const saved = localStorage.getItem('qa-chat-theme');
    if (saved) {
      setSelectedTheme(saved);
      const theme = themes.find(t => t.id === saved);
      if (theme) onThemeChange(theme);
    }
  }, []);

  const handleSelectTheme = (theme: Theme) => {
    setSelectedTheme(theme.id);
    localStorage.setItem('qa-chat-theme', theme.id);
    onThemeChange(theme);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="report-qa-toolbar-control h-8 gap-1.5 px-3 text-xs font-medium" title="Chat theme">
          <Palette className="h-3 w-3" />
          Theme
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="end">
        <div className="space-y-3">
          <div className="text-sm font-medium">Chat Theme</div>
          <div className="grid grid-cols-2 gap-2">
            {themes.map((theme) => (
              <button
                key={theme.id}
                className={cn(
                  "relative flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all hover:border-primary/50",
                  selectedTheme === theme.id && "border-primary ring-1 ring-primary"
                )}
                onClick={() => handleSelectTheme(theme)}
              >
                <div className={cn("w-full h-4 rounded", theme.preview)} />
                <span className="text-[10px] text-muted-foreground">{theme.name}</span>
                {selectedTheme === theme.id && (
                  <Check className="absolute top-1 right-1 h-3 w-3 text-primary" />
                )}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function useCurrentTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(themes[0]);

  useEffect(() => {
    const saved = localStorage.getItem('qa-chat-theme');
    if (saved) {
      const found = themes.find(t => t.id === saved);
      if (found) setTheme(found);
    }
  }, []);

  return theme;
}

export { themes };
export type { Theme };
