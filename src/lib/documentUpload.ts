import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { FileRejection } from 'react-dropzone';

export const MAX_DOCUMENT_UPLOAD_FILES = 10;
export const MAX_DOCUMENT_BATCH_BYTES = 50 * 1024 * 1024;

export const DOCUMENT_UPLOAD_ACCEPT = {
  'application/pdf': ['.pdf'],
  'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'text/csv': ['.csv'],
} as const;

export type UploadProcessingMode = 'parallel' | 'sequential';
export type UploadQueueStatus = 'pending' | 'uploading' | 'success' | 'failed';

export interface UploadFailure {
  fileName: string;
  error: string;
}

export interface UploadQueueItem {
  id: string;
  file: File;
  status: UploadQueueStatus;
  progress: number;
  error?: string;
}

export function formatUploadBytes(bytes?: number | null): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function createUploadQueueItems(files: File[]): UploadQueueItem[] {
  return files.map((file, index) => ({
    id: `${file.name}-${file.size}-${file.lastModified}-${index}-${crypto.randomUUID()}`,
    file,
    status: 'pending',
    progress: 0,
  }));
}

export function calculateTotalUploadSize(filesOrItems: Array<File | UploadQueueItem>) {
  return filesOrItems.reduce((sum, entry) => sum + ('file' in entry ? entry.file.size : entry.size), 0);
}

export function getOverallUploadProgress(items: UploadQueueItem[]) {
  if (!items.length) return 0;
  return Math.round(items.reduce((sum, item) => sum + item.progress, 0) / items.length);
}

export function getRejectedFilesMessage(rejections: FileRejection[]) {
  const lines = rejections.slice(0, 6).map(({ file, errors }) => {
    const reason = errors.map((error) => error.message).join(', ');
    return `${file.name}: ${reason}`;
  });

  return {
    title: 'Some files were rejected',
    description: lines.join(' • '),
  };
}

/**
 * `mergeFilesWithLimit` lived here and is DELETED rather than left dormant.
 *
 * It enforced the file cap with a `slice`, so the eleventh file a person
 * chose was simply not there and nothing said so — and it de-duplicated
 * nothing, so choosing the same document twice staged it twice. Three trays
 * called it or hand-rolled around it. `stageUploadFiles` in
 * `lib/uploads/stageUploadFiles.pure` is the one decision now; a helper that
 * silently drops files is one import away from putting the defect back.
 */

export function getUploadModePreferenceKey(scope: string, userId?: string | null) {
  return `upload-mode:${scope}:${userId || 'anonymous'}`;
}

export function getPersistedUploadMode(scope: string, userId?: string | null): UploadProcessingMode | null {
  try {
    const raw = localStorage.getItem(getUploadModePreferenceKey(scope, userId));
    return raw === 'sequential' || raw === 'parallel' ? raw : null;
  } catch {
    return null;
  }
}

export function persistUploadMode(scope: string, userId: string | null | undefined, mode: UploadProcessingMode) {
  try {
    localStorage.setItem(getUploadModePreferenceKey(scope, userId), mode);
  } catch {
    // ignore storage failures
  }
}

export async function runTasksByMode<TItem, TResult>(
  items: TItem[],
  mode: UploadProcessingMode,
  processor: (item: TItem, index: number) => Promise<TResult>,
) {
  if (mode === 'sequential') {
    const results: PromiseSettledResult<TResult>[] = [];
    for (let index = 0; index < items.length; index += 1) {
      try {
        results.push({ status: 'fulfilled', value: await processor(items[index], index) });
      } catch (error) {
        results.push({ status: 'rejected', reason: error });
      }
    }
    return results;
  }

  return Promise.allSettled(items.map((item, index) => processor(item, index)));
}

export async function processFilesByMode<T>(
  files: File[],
  mode: UploadProcessingMode,
  processor: (file: File, index: number) => Promise<T>,
) {
  const results = await runTasksByMode(files, mode, processor);
  const successes: T[] = [];
  const failures: UploadFailure[] = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      successes.push(result.value);
      return;
    }

    failures.push({
      fileName: files[index]?.name || `File ${index + 1}`,
      error: result.reason?.message || 'Upload failed',
    });
  });

  return { successes, failures };
}

function fileToBase64WithProgress(file: File | Blob, onProgress?: (progress: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress(Math.min(90, Math.round((event.loaded / event.total) * 90)));
    };
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || result;
      onProgress?.(95);
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export async function uploadSecureStorageFileWithProgress(input: {
  bucket: string;
  path: string;
  file: File | Blob;
  contentType?: string;
  upsert?: boolean;
  onProgress?: (progress: number) => void;
  // WP-06 Phase B — object-level binding metadata so the uploaded object is
  // authorizable on future reads via storage_object_bindings.
  resourceType?: string;
  resourceId?: string | null;
  clientId?: string | null;
  ownerUserId?: string | null;
}) {
  const fileData = await fileToBase64WithProgress(input.file, input.onProgress);

  const { data, error } = await invokeSecureFunction('secure-storage', {
    operation: 'upload',
    bucket: input.bucket,
    path: input.path,
    file_data: fileData,
    content_type: input.contentType || (input.file instanceof File ? input.file.type : 'application/octet-stream'),
    upsert: input.upsert || false,
    resource_type: input.resourceType,
    resource_id: input.resourceId ?? null,
    client_id: input.clientId ?? null,
    owner_user_id: input.ownerUserId ?? null,
  });

  if (error) throw new Error(error.message || 'Upload failed');
  if (!data?.success) throw new Error(data?.error || 'Upload failed');

  input.onProgress?.(100);
  return data.data as { path: string; fullPath?: string };
}

export async function uploadFormDataWithProgress<T = any>(input: {
  url: string;
  headers?: Record<string, string>;
  formData: FormData;
  onProgress?: (progress: number) => void;
}) {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', input.url);

    Object.entries(input.headers || {}).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !input.onProgress) return;
      input.onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      try {
        const payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        if (xhr.status >= 200 && xhr.status < 300) {
          input.onProgress?.(100);
          resolve(payload);
          return;
        }
        reject(new Error(payload?.error || `Upload failed (${xhr.status})`));
      } catch (error) {
        reject(error);
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(input.formData);
  });
}