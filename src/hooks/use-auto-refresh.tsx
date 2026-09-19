import { useEffect, useRef } from 'react';

interface AutoRefreshSettings {
  autoRefresh: boolean;
  refreshInterval: number; // in minutes
}

export const useAutoRefresh = (callback: () => void | Promise<void>) => {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const callbackRef = useRef(callback);
  const errorCountRef = useRef(0);
  const maxErrors = 3; // Stop auto-refresh after 3 consecutive errors

  // Update callback ref when callback changes
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const startAutoRefresh = (settings: AutoRefreshSettings) => {
    // Clear existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    if (!settings.autoRefresh) {
      return;
    }

    // Reset error count when starting fresh
    errorCountRef.current = 0;

    // Convert minutes to milliseconds
    const intervalMs = settings.refreshInterval * 60 * 1000;

    intervalRef.current = setInterval(async () => {
      try {
        await callbackRef.current();
        errorCountRef.current = 0; // Reset error count on success
      } catch (error) {
        errorCountRef.current++;
        console.warn(`Auto-refresh error ${errorCountRef.current}/${maxErrors}:`, error);
        
        // Stop auto-refresh if too many consecutive errors
        if (errorCountRef.current >= maxErrors) {
          console.error('Auto-refresh stopped due to repeated failures');
          stopAutoRefresh();
        }
      }
    }, intervalMs);
  };

  const stopAutoRefresh = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAutoRefresh();
    };
  }, []);

  return { startAutoRefresh, stopAutoRefresh };
};