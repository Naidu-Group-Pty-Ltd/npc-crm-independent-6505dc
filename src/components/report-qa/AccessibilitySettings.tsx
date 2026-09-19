import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Settings2, Moon, Sun, Zap, ZapOff, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';

type Theme = 'light' | 'dark' | 'system';

interface AccessibilitySettingsProps {
  className?: string;
}

export function AccessibilitySettings({ className }: AccessibilitySettingsProps) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [theme, setTheme] = useState<Theme>('system');
  const [highContrast, setHighContrast] = useState(false);

  // Load settings from localStorage
  useEffect(() => {
    const savedMotion = localStorage.getItem('qa-reduced-motion');
    const savedTheme = localStorage.getItem('qa-theme') as Theme | null;
    const savedContrast = localStorage.getItem('qa-high-contrast');
    
    if (savedMotion === 'true') {
      setReducedMotion(true);
      document.documentElement.classList.add('reduce-motion');
    }
    if (savedTheme) setTheme(savedTheme);
    if (savedContrast === 'true') {
      setHighContrast(true);
      document.documentElement.classList.add('high-contrast');
    }
  }, []);

  const handleReducedMotionChange = useCallback((checked: boolean) => {
    setReducedMotion(checked);
    localStorage.setItem('qa-reduced-motion', String(checked));
    if (checked) {
      document.documentElement.classList.add('reduce-motion');
    } else {
      document.documentElement.classList.remove('reduce-motion');
    }
  }, []);

  const handleHighContrastChange = useCallback((checked: boolean) => {
    setHighContrast(checked);
    localStorage.setItem('qa-high-contrast', String(checked));
    if (checked) {
      document.documentElement.classList.add('high-contrast');
    } else {
      document.documentElement.classList.remove('high-contrast');
    }
  }, []);

  const handleThemeChange = useCallback((newTheme: Theme) => {
    setTheme(newTheme);
    localStorage.setItem('qa-theme', newTheme);
    
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    
    if (newTheme === 'system') {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.add(systemDark ? 'dark' : 'light');
    } else {
      root.classList.add(newTheme);
    }
  }, []);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className={cn("report-qa-toolbar-control h-8 gap-1.5 px-3 text-xs font-medium", className)}
          aria-label="Accessibility settings"
          title="Accessibility settings"
        >
          <Settings2 className="h-3 w-3" />
          <span className="hidden sm:inline">A11y</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <div className="space-y-4">
          <div className="space-y-1">
            <h4 className="font-medium text-sm">Accessibility Settings</h4>
            <p className="text-xs text-muted-foreground">
              Customize your viewing experience
            </p>
          </div>
          
          {/* Theme selector */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Theme</Label>
            <div className="flex gap-1">
              <Button
                variant={theme === 'light' ? 'default' : 'outline'}
                size="sm"
                className="flex-1 h-8"
                onClick={() => handleThemeChange('light')}
                aria-pressed={theme === 'light'}
              >
                <Sun className="h-3 w-3 mr-1" />
                Light
              </Button>
              <Button
                variant={theme === 'dark' ? 'default' : 'outline'}
                size="sm"
                className="flex-1 h-8"
                onClick={() => handleThemeChange('dark')}
                aria-pressed={theme === 'dark'}
              >
                <Moon className="h-3 w-3 mr-1" />
                Dark
              </Button>
              <Button
                variant={theme === 'system' ? 'default' : 'outline'}
                size="sm"
                className="flex-1 h-8"
                onClick={() => handleThemeChange('system')}
                aria-pressed={theme === 'system'}
              >
                <Monitor className="h-3 w-3 mr-1" />
                Auto
              </Button>
            </div>
          </div>
          
          {/* Reduced motion toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="reduced-motion" className="text-sm flex items-center gap-1.5">
                {reducedMotion ? (
                  <ZapOff className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <Zap className="h-3.5 w-3.5 text-primary" />
                )}
                Reduced motion
              </Label>
              <p className="text-xs text-muted-foreground">
                Minimize animations
              </p>
            </div>
            <Switch
              id="reduced-motion"
              checked={reducedMotion}
              onCheckedChange={handleReducedMotionChange}
              aria-describedby="reduced-motion-desc"
            />
          </div>
          
          {/* High contrast toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="high-contrast" className="text-sm">
                High contrast
              </Label>
              <p className="text-xs text-muted-foreground">
                Increase text visibility
              </p>
            </div>
            <Switch
              id="high-contrast"
              checked={highContrast}
              onCheckedChange={handleHighContrastChange}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
