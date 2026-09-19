import { invokeSecureFunction } from "@/lib/secureInvoke";

type StorageBucket = 
  | 'client-files'
  | 'client-documents' 
  | 'formara-forms'
  | 'vownet-forms' // legacy: read-only access to pre-rename objects
  | 'investment-reports'
  | 'quantitative-reports'
  | 'report-templates'
  | 'branding-assets'
  | 'qa_exports'
  | 'email-attachments';

interface UploadOptions {
  contentType?: string;
  upsert?: boolean;
  /**
   * The row this upload belongs to, which the server uses to derive the
   * destination path, the owner and the client binding.
   *
   * `secure-storage` requires it for every human caller and every bucket
   * except `branding-assets`, and refuses the upload with "Invalid upload
   * resource" without it — but this helper never sent the field, so no upload
   * from a browser could succeed. `client_files` records 13 uploads in July,
   * 25 in June and none since (audit items 5, 7 and 8).
   *
   * Which id depends on the bucket, and `resolveHumanUploadBinding` is the
   * authority: `investment-reports` wants an investment report, `qa_exports` a
   * Q&A conversation, and everything else the CLIENT the file belongs to.
   */
  resourceId?: string;
}

interface UploadResult {
  success: boolean;
  path?: string;
  fullPath?: string;
  error?: string;
}

interface DownloadResult {
  success: boolean;
  content?: string; // Base64 encoded
  contentType?: string;
  size?: number;
  blob?: Blob;
  error?: string;
}

interface DeleteResult {
  success: boolean;
  deleted?: string[];
  error?: string;
}

interface SignedUrlResult {
  success: boolean;
  signedUrl?: string;
  error?: string;
}

interface PublicUrlResult {
  success: boolean;
  publicUrl?: string;
  error?: string;
}

/**
 * Convert a File or Blob to base64 string
 */
export async function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix (e.g., "data:image/png;base64,")
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Convert base64 string to Blob — chunked to avoid call stack overflow on large files
 */
function base64ToBlob(base64: string, contentType: string = 'application/octet-stream'): Blob {
  const CHUNK_SIZE = 8192;
  const binaryString = atob(base64);
  const chunks: Uint8Array[] = [];
  
  for (let offset = 0; offset < binaryString.length; offset += CHUNK_SIZE) {
    const end = Math.min(offset + CHUNK_SIZE, binaryString.length);
    const chunk = new Uint8Array(end - offset);
    for (let i = 0; i < chunk.length; i++) {
      chunk[i] = binaryString.charCodeAt(offset + i);
    }
    chunks.push(chunk);
  }
  
  return new Blob(chunks as unknown as BlobPart[], { type: contentType });
}

/**
 * Secure storage operations hook
 * All storage operations go through the secure-storage Edge Function
 * which validates session tokens via HttpOnly cookies
 */
export function useSecureStorage() {
  
  /**
   * Upload a file to secure storage.
   *
   * Delegates rather than posting its own request. This was a second, complete
   * copy of the upload — and the copy never sent `resource_id`, which the
   * server requires from every human caller on every bucket but the two with no
   * owning row. It has no call sites today, so nothing was refused by it; a
   * dormant helper that would fail the moment somebody reached for it is worse
   * than none, and two copies of one request is how the field came to be
   * missing from one of them in the first place.
   */
  const upload = (
    bucket: StorageBucket,
    path: string,
    file: File | Blob,
    options?: UploadOptions
  ): Promise<UploadResult> => secureStorageUpload(bucket, path, file, options);

  /**
   * Download a file from secure storage
   */
  const download = async (
    bucket: StorageBucket,
    path: string
  ): Promise<DownloadResult> => {
    try {
      const { data, error } = await invokeSecureFunction('secure-storage', {
        operation: 'download',
        bucket,
        path
      });

      if (error) {
        console.error('[SecureStorage] Download error:', error);
        return { success: false, error: error.message };
      }

      if (!data?.success) {
        return { success: false, error: data?.error || 'Download failed' };
      }

      const blob = base64ToBlob(data.data.content, data.data.contentType);
      
      return { 
        success: true, 
        content: data.data.content,
        contentType: data.data.contentType,
        size: data.data.size,
        blob
      };
    } catch (err: any) {
      console.error('[SecureStorage] Download exception:', err);
      return { success: false, error: err.message };
    }
  };

  /**
   * Delete file(s) from secure storage
   */
  const remove = async (
    bucket: StorageBucket,
    paths: string | string[]
  ): Promise<DeleteResult> => {
    try {
      const { data, error } = await invokeSecureFunction('secure-storage', {
        operation: 'delete',
        bucket,
        path: paths
      });

      if (error) {
        console.error('[SecureStorage] Delete error:', error);
        return { success: false, error: error.message };
      }

      if (!data?.success) {
        return { success: false, error: data?.error || 'Delete failed' };
      }

      return { 
        success: true, 
        deleted: data.data.deleted
      };
    } catch (err: any) {
      console.error('[SecureStorage] Delete exception:', err);
      return { success: false, error: err.message };
    }
  };

  /**
   * Get a signed URL for temporary access
   */
  const createSignedUrl = async (
    bucket: StorageBucket,
    path: string,
    expiresIn: number = 3600
  ): Promise<SignedUrlResult> => {
    try {
      const { data, error } = await invokeSecureFunction('secure-storage', {
        operation: 'signedUrl',
        bucket,
        path,
        expires_in: expiresIn
      });

      if (error) {
        console.error('[SecureStorage] Signed URL error:', error);
        return { success: false, error: error.message };
      }

      if (!data?.success) {
        return { success: false, error: data?.error || 'Failed to create signed URL' };
      }

      return { 
        success: true, 
        signedUrl: data.data.signedUrl
      };
    } catch (err: any) {
      console.error('[SecureStorage] Signed URL exception:', err);
      return { success: false, error: err.message };
    }
  };

  /**
   * Get a public URL (for buckets with public read like branding-assets)
   */
  const getPublicUrl = async (
    bucket: StorageBucket,
    path: string
  ): Promise<PublicUrlResult> => {
    try {
      const { data, error } = await invokeSecureFunction('secure-storage', {
        operation: 'publicUrl',
        bucket,
        path
      });

      if (error) {
        console.error('[SecureStorage] Public URL error:', error);
        return { success: false, error: error.message };
      }

      if (!data?.success) {
        return { success: false, error: data?.error || 'Failed to get public URL' };
      }

      return { 
        success: true, 
        publicUrl: data.data.publicUrl
      };
    } catch (err: any) {
      console.error('[SecureStorage] Public URL exception:', err);
      return { success: false, error: err.message };
    }
  };

  return {
    upload,
    download,
    remove,
    createSignedUrl,
    getPublicUrl
  };
}

// Export standalone functions for use outside React components
export const secureStorageUpload = async (
  bucket: StorageBucket,
  path: string,
  file: File | Blob,
  options?: UploadOptions
): Promise<UploadResult> => {
  try {
    const fileData = await fileToBase64(file);
    const contentType = options?.contentType || (file instanceof File ? file.type : 'application/octet-stream');

    const { data, error } = await invokeSecureFunction('secure-storage', {
      operation: 'upload',
      bucket,
      path,
      file_data: fileData,
      content_type: contentType,
      resource_id: options?.resourceId,
      upsert: options?.upsert || false
    });

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data?.success) {
      return { success: false, error: data?.error || 'Upload failed' };
    }

    return { 
      success: true, 
      path: data.data.path,
      fullPath: data.data.fullPath
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
};

export const secureStorageDownload = async (
  bucket: StorageBucket,
  path: string
): Promise<DownloadResult> => {
  try {
    const { data, error } = await invokeSecureFunction('secure-storage', {
      operation: 'download',
      bucket,
      path
    });

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data?.success) {
      return { success: false, error: data?.error || 'Download failed' };
    }

    const blob = base64ToBlob(data.data.content, data.data.contentType);
    
    return { 
      success: true, 
      content: data.data.content,
      contentType: data.data.contentType,
      size: data.data.size,
      blob
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
};

export const secureStorageDelete = async (
  bucket: StorageBucket,
  paths: string | string[]
): Promise<DeleteResult> => {
  try {
    const { data, error } = await invokeSecureFunction('secure-storage', {
      operation: 'delete',
      bucket,
      path: paths
    });

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data?.success) {
      return { success: false, error: data?.error || 'Delete failed' };
    }

    return { 
      success: true, 
      deleted: data.data.deleted
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
};
