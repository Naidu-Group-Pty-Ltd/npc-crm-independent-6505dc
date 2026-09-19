// Shared storage signing helpers (STOR-005).
//
// The investment-reports bucket is private: hero/visual assets can no longer be
// read via getPublicUrl. Every read path signs a short-lived URL from the
// object's storage_path instead. Callers keep returning the URL in the same
// `public_url`/`url` field they used before, so frontends need no change.
//
// A single service-role client is expected (these run inside edge functions
// that already bypass RLS with the service role).

type StorageClient = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number,
      ) => Promise<{ data: { signedUrl: string } | null; error: unknown }>;
      createSignedUrls: (
        paths: string[],
        expiresIn: number,
      ) => Promise<{
        data: Array<{ path: string | null; signedUrl: string; error: string | null }> | null;
        error: unknown;
      }>;
    };
  };
};

/** Sign a single object path. Returns null on missing path or failure. */
export async function signStoragePath(
  supabase: StorageClient,
  bucket: string,
  path: string | null | undefined,
  expiresIn = 3600,
): Promise<string | null> {
  if (!path) return null;
  try {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Sign many object paths in one round-trip. Returns a map of path -> signed URL
 * (paths that failed or were empty are simply absent from the map).
 */
export async function signStoragePaths(
  supabase: StorageClient,
  bucket: string,
  paths: Array<string | null | undefined>,
  expiresIn = 3600,
): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  if (unique.length === 0) return {};
  const out: Record<string, string> = {};
  try {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(unique, expiresIn);
    for (const item of data ?? []) {
      if (item?.path && item.signedUrl && !item.error) out[item.path] = item.signedUrl;
    }
  } catch {
    // fall through — caller treats missing entries as "no URL"
  }
  return out;
}
