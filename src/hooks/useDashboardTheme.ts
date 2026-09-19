import { useMemo } from 'react';
import { useWhiteLabel } from '@/contexts/WhiteLabelContext';

export type DashboardTheme = 'light' | 'dark' | 'system';

export function useDashboardTheme() {
  const { themeMode, isDark, setThemeMode } = useWhiteLabel();

  const cycleTheme = useMemo(
    () => () => {
      setThemeMode((current) => {
        if (current === 'dark') return 'light';
        if (current === 'light') return 'system';
        return 'dark';
      });
    },
    [setThemeMode]
  );

  return {
    theme: themeMode,
    themeMode,
    isDark,
    setTheme: setThemeMode,
    setThemeMode,
    cycleTheme,
  };
}