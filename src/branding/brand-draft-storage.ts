import type { WhiteLabelSettings } from './brand-types';

export interface PersistedBrandDraft {
  settings: WhiteLabelSettings;
  savedAt: string;
}

export interface StoredBrandPreset extends PersistedBrandDraft {
  id: string;
  name: string;
}

const WHITE_LABEL_DRAFT_STORAGE_KEY = 'white-label-editor-draft-v1';
const WHITE_LABEL_PRESET_STORAGE_KEY = 'white-label-editor-presets-v1';

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function savePersistedDraft(settings: WhiteLabelSettings) {
  const payload: PersistedBrandDraft = {
    settings,
    savedAt: new Date().toISOString(),
  };

  localStorage.setItem(WHITE_LABEL_DRAFT_STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function loadPersistedDraft(): PersistedBrandDraft | null {
  const parsed = safeParseJson<PersistedBrandDraft>(localStorage.getItem(WHITE_LABEL_DRAFT_STORAGE_KEY));
  if (!parsed) {
    localStorage.removeItem(WHITE_LABEL_DRAFT_STORAGE_KEY);
  }
  return parsed;
}

export function clearPersistedDraft() {
  localStorage.removeItem(WHITE_LABEL_DRAFT_STORAGE_KEY);
}

export function loadStoredBrandPresets(): StoredBrandPreset[] {
  const parsed = safeParseJson<StoredBrandPreset[]>(localStorage.getItem(WHITE_LABEL_PRESET_STORAGE_KEY));

  if (!parsed || !Array.isArray(parsed)) {
    localStorage.removeItem(WHITE_LABEL_PRESET_STORAGE_KEY);
    return [];
  }

  return parsed;
}

export function saveStoredBrandPresets(presets: StoredBrandPreset[]) {
  localStorage.setItem(WHITE_LABEL_PRESET_STORAGE_KEY, JSON.stringify(presets));
}