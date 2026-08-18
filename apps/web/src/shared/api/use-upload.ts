import { useState } from 'react';
import { apiErrorMessage } from './errors';
import { sessionFetch } from './session-fetch';

/**
 * The three-step presigned upload: presign with our API, PUT the bytes to storage, confirm.
 *
 * THIS WAS BROKEN IN EVERY ENVIRONMENT. It used bare `fetch`, so the presign POST carried no
 * `X-CSRF-Token` and the server answered `403 FORBIDDEN: Invalid csrf token` — measured from a browser
 * against the running API. Every upload surface in the SPA was dead: the employee avatar, the asset
 * photo and the leave-request document. Nothing caught it because the failure is a toast on a widget no
 * test drove, and 403 reads like a permission problem rather than a missing header.
 *
 * Going through `sessionFetch` is the fix and the guarantee: it is the one place that knows a
 * cookie-authenticated request needs `credentials: 'include'` and a CSRF header on a mutation.
 *
 * THE PUT SENDS EXACTLY THE HEADERS THE SIGNATURE COVERS. `requiredHeaders` comes back from presign and
 * the API's own docblock is emphatic: all of them, and nothing else. The old code always added
 * `Content-Type`, which breaks the signature whenever the presign did not cover it — and the failure
 * arrives from storage as a 403 with no CORS headers, which a browser reports as an opaque network
 * error with nothing in it to diagnose.
 */

export interface UploadOptions {
  file: File;
  /** POST endpoint for the presign step, e.g. `/v1/employees/emp-1/avatar/presign`. */
  presignUrl: string;
  /**
   * POST endpoint for the confirm step.
   *
   * A function when the id belongs in the PATH — training certificates confirm at
   * `…/certificates/{fileId}/confirm` — and a plain string for the endpoints that take it in the body.
   * Both shapes exist in the API; pretending otherwise would mean one of the two call sites building
   * its own upload.
   */
  confirmUrl: string | ((fileId: string) => string);
  /** Overrides the confirm body. Defaults to `{ fileId }`, which is what the body-shaped ones take. */
  confirmBody?: (fileId: string) => unknown;
  /** Extra fields for the presign body — `checksumSha256`, for the endpoints that verify one. */
  presignExtras?: Record<string, unknown>;
  onProgress?: (percent: number) => void;
}

export interface UploadResult {
  fileId: string;
  /** The confirm response, for callers that need the record it created. */
  confirmed: unknown;
}

/*
 * THERE IS DELIBERATELY NO `url` HERE, and the history is worth keeping.
 *
 * This used to return `url`, read as `confirmed.url` — and not one of the four confirm endpoints returns a
 * key called `url`: the asset photo answers `{ photoUrl }`, the avatar `{ avatarUrl }`, the leave document
 * `{ documentUrl }`, and the training certificate a record with no URL at all. So `url` was null on every
 * upload in the SPA and each caller stored that null.
 *
 * NOTHING LOOKED WRONG, which is why it survived. `FileUploadWidget` renders a local preview of the file
 * just chosen, so the picture appeared the moment it was picked and the loss only showed on a reload, with
 * the object sitting in storage and the screen saying there was none.
 *
 * The fix is not a better guess at the key. A URL for an attachment now comes from ONE place — the readback
 * hooks in `attachment-urls.ts`, which ask the endpoint whose job it is and are what a reload reads too.
 * Returning a second, differently-sourced URL from here is what created the ambiguity in the first place.
 */

interface PresignResponse {
  fileId: string;
  uploadUrl: string;
  /** Absent on the endpoints that sign nothing but the URL. */
  requiredHeaders?: Record<string, string>;
}

export function useUpload() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function upload(opts: UploadOptions): Promise<UploadResult> {
    setUploading(true);
    setError(null);

    try {
      const presignRes = await sessionFetch(opts.presignUrl, {
        method: 'POST',
        body: JSON.stringify({
          fileName: opts.file.name,
          mimeType: opts.file.type,
          sizeBytes: opts.file.size,
          ...opts.presignExtras,
        }),
      });
      if (!presignRes.ok) {
        // The API names the rule: the MIME allow-list, the size ceiling, the per-record quota.
        throw new Error(
          apiErrorMessage(await presignRes.json().catch(() => null), 'Could not start the upload.'),
        );
      }
      const presigned = (await presignRes.json()) as PresignResponse;

      // Coarse, not fake: `fetch` cannot report upload progress, and a bar that animates on a timer
      // would be a lie about how far the transfer has got. These are the three real milestones.
      opts.onProgress?.(10);

      const putRes = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        body: opts.file,
        headers: presigned.requiredHeaders ?? { 'Content-Type': opts.file.type },
      });
      if (!putRes.ok) throw new Error(`Storage rejected the file (${putRes.status}).`);

      opts.onProgress?.(80);

      const confirmUrl =
        typeof opts.confirmUrl === 'function' ? opts.confirmUrl(presigned.fileId) : opts.confirmUrl;
      const confirmRes = await sessionFetch(confirmUrl, {
        method: 'POST',
        body: JSON.stringify(opts.confirmBody?.(presigned.fileId) ?? { fileId: presigned.fileId }),
      });
      if (!confirmRes.ok) {
        throw new Error(
          apiErrorMessage(
            await confirmRes.json().catch(() => null),
            'The file uploaded but could not be attached.',
          ),
        );
      }
      const confirmed: unknown = await confirmRes.json().catch(() => null);

      opts.onProgress?.(100);

      return { fileId: presigned.fileId, confirmed };
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
