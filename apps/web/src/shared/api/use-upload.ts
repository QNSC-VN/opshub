/**
 * useUpload — 3-step presigned S3 upload hook
 *
 * Step 1: POST {domain endpoint}/presign  → { fileId, uploadUrl }
 * Step 2: PUT  uploadUrl (direct to S3)   → 200 OK
 * Step 3: POST {domain endpoint}/confirm  → { url }
 *
 * Usage:
 *   const { upload, uploading } = useUpload();
 *   await upload({
 *     file,
 *     presignUrl: `/employees/${id}/avatar/presign`,
 *     confirmUrl: `/employees/${id}/avatar/confirm`,
 *   });
 */

import { useState } from 'react';
import type {} from './client'; // typed via fetch

export interface UploadOptions {
  file: File;
  /** e.g. "/employees/emp-1/avatar/presign" */
  presignUrl: string;
  /** e.g. "/employees/emp-1/avatar/confirm" */
  confirmUrl: string;
  onProgress?: (percent: number) => void;
}

export interface UploadResult {
  fileId: string;
  url: string;
}

export function useUpload() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function upload(opts: UploadOptions): Promise<UploadResult> {
    setUploading(true);
    setError(null);

    try {
      // Step 1 — request presigned URL from our API
      // Step 1 — request presigned URL from our API
      const presignResp = await fetch(opts.presignUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: opts.file.name,
          mimeType: opts.file.type,
          sizeBytes: opts.file.size,
        }),
        credentials: 'include',
      });
      if (!presignResp.ok) throw new Error(`Presign failed: ${presignResp.status}`);
      const presignData = (await presignResp.json()) as { fileId: string; uploadUrl: string };

      opts.onProgress?.(10);

      // Step 2 — PUT file directly to S3
      const putRes = await fetch(presignData.uploadUrl, {
        method: 'PUT',
        body: opts.file,
        headers: { 'Content-Type': opts.file.type },
      });
      if (!putRes.ok) throw new Error(`S3 upload failed: ${putRes.status} ${putRes.statusText}`);

      opts.onProgress?.(80);

      // Step 3 — confirm upload in our API
      const confirmResp = await fetch(opts.confirmUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: presignData.fileId }),
        credentials: 'include',
      });
      if (!confirmResp.ok) throw new Error(`Confirm failed: ${confirmResp.status}`);
      const confirmRes = (await confirmResp.json()) as { fileId: string; url: string };

      opts.onProgress?.(100);

      return { fileId: confirmRes.fileId, url: confirmRes.url };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setUploading(false);
    }
  }

  return { upload, uploading, error };
}
