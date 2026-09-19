/**
 * Upload queue for internal-message attachments.
 *
 * Tracks every staged file with its own progress / status / error so the UI can
 * show a per-file bar and offer a Retry button. Nothing ever fails silently:
 * a file is either `done` (uploaded, path known) or `error` with a message.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_INTERNAL_ATTACHMENTS,
  UPLOAD_ATTEMPTS,
  uploadInternalAttachment,
  type InternalAttachment,
} from '@/lib/internalMessageAttachments';

export type QueueStatus = 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';

export interface QueueItem {
  id: string;
  file: File;
  status: QueueStatus;
  /** 0…1 */
  progress: number;
  attempt: number;
  attempts: number;
  error?: string | null;
  uploaded?: InternalAttachment | null;
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function useInternalAttachmentQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const itemsRef = useRef<QueueItem[]>([]);
  itemsRef.current = items;
  const controllers = useRef<Record<string, AbortController>>({});
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
    Object.values(controllers.current).forEach((c) => c.abort());
  }, []);

  const patch = useCallback((id: string, next: Partial<QueueItem>) => {
    if (!mounted.current) return;
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...next } : i)));
  }, []);

  const addFiles = useCallback((files: File[]) => {
    if (!files.length) return;
    setItems((prev) => {
      const room = MAX_INTERNAL_ATTACHMENTS - prev.length;
      if (room <= 0) return prev;
      const additions: QueueItem[] = files.slice(0, room).map((file) => ({
        id: newId(),
        file,
        status: 'queued',
        progress: 0,
        attempt: 0,
        attempts: UPLOAD_ATTEMPTS,
        error: null,
        uploaded: null,
      }));
      return [...prev, ...additions];
    });
  }, []);

  const remove = useCallback((id: string) => {
    controllers.current[id]?.abort();
    delete controllers.current[id];
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clear = useCallback(() => {
    Object.values(controllers.current).forEach((c) => c.abort());
    controllers.current = {};
    setItems([]);
  }, []);

  const runOne = useCallback(
    async (threadId: string, item: QueueItem): Promise<InternalAttachment | null> => {
      if (item.uploaded) return item.uploaded;
      const controller = new AbortController();
      controllers.current[item.id] = controller;
      patch(item.id, { status: 'uploading', progress: 0, error: null });
      try {
        const uploaded = await uploadInternalAttachment(threadId, item.file, {
          signal: controller.signal,
          onProgress: (fraction) => patch(item.id, { progress: fraction }),
          onAttempt: (attempt, attempts) => patch(item.id, { attempt, attempts }),
        });
        patch(item.id, { status: 'done', progress: 1, uploaded, error: null });
        return uploaded;
      } catch (error) {
        const cancelled = error instanceof DOMException && error.name === 'AbortError';
        patch(item.id, {
          status: cancelled ? 'cancelled' : 'error',
          error: cancelled ? 'Cancelled' : error instanceof Error ? error.message : 'Upload failed',
        });
        return null;
      } finally {
        delete controllers.current[item.id];
      }
    },
    [patch],
  );

  /**
   * Upload everything not yet uploaded, sequentially. Resolves with the list of
   * successfully uploaded attachments plus the files that failed, so the caller
   * can decide whether to send or hold the message.
   */
  const uploadAll = useCallback(
    async (threadId: string) => {
      const pending = itemsRef.current.filter((i) => i.status !== 'done');
      const uploaded: InternalAttachment[] = itemsRef.current
        .filter((i) => i.status === 'done' && i.uploaded)
        .map((i) => i.uploaded!) as InternalAttachment[];
      const failed: QueueItem[] = [];

      for (const item of pending) {
        const result = await runOne(threadId, item);
        if (result) uploaded.push(result);
        else failed.push(item);
      }
      return { uploaded, failed };
    },
    [runOne],
  );

  /** Retry a single failed file. */
  const retry = useCallback(
    async (threadId: string, id: string) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item) return null;
      return runOne(threadId, { ...item, uploaded: null });
    },
    [runOne],
  );

  const stats = useMemo(() => {
    const total = items.length;
    const done = items.filter((i) => i.status === 'done').length;
    const failedCount = items.filter((i) => i.status === 'error').length;
    const uploading = items.some((i) => i.status === 'uploading');
    const bytes = items.reduce((sum, i) => sum + i.file.size, 0);
    const sent = items.reduce((sum, i) => sum + i.file.size * i.progress, 0);
    return {
      total,
      done,
      failedCount,
      uploading,
      overall: bytes ? sent / bytes : 0,
    };
  }, [items]);

  return { items, addFiles, remove, clear, uploadAll, retry, stats };
}
