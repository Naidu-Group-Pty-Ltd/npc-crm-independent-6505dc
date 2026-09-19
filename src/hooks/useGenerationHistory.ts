import { useCallback, useEffect, useState } from 'react';

export interface GenerationHistoryEntry {
  id: string;
  property_address: string;
  status: 'completed' | 'failed' | 'dismissed' | 'cancelled';
  totalSections: number;
  sectionsCompleted: number;
  durationMs: number;
  error_message?: string | null;
  finishedAt: number; // epoch ms
  cancelledBy?: string; // username/email of the user who clicked Stop
}

const STORAGE_KEY = 'report-generation-history-v1';
const MAX_ENTRIES = 10;

function readStorage(): GenerationHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

function writeStorage(entries: GenerationHistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* ignore quota */
  }
}

export function useGenerationHistory() {
  const [entries, setEntries] = useState<GenerationHistoryEntry[]>(() => readStorage());

  const addEntry = useCallback((entry: GenerationHistoryEntry) => {
    setEntries((prev) => {
      // De-dupe by id; newest first
      const filtered = prev.filter((e) => e.id !== entry.id);
      const next = [entry, ...filtered].slice(0, MAX_ENTRIES);
      writeStorage(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    writeStorage([]);
    setEntries([]);
  }, []);

  // Multi-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setEntries(readStorage());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { entries, addEntry, clear };
}
