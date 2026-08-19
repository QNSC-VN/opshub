import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { useUpload } from '@/shared/api/use-upload';
import { Button, ConfirmDialog, FormError, RowActions } from '@/shared/ui';
import { formatDateTime } from '@/shared/lib/format';
import { CERTIFICATE_ACCEPT } from './training.types';
import { useCertificates } from './use-training';
import type { Certificate } from './training.types';

/**
 * The certificates attached to one training record.
 *
 * A COLLECTION, which is why this is not `FileUploadWidget`. That widget models one file replacing
 * another — an avatar, a photo — and shows a preview of the current one. A record can carry several
 * certificates (the completion letter, the provider's PDF, a scan of the signed attendance sheet), so
 * the interaction is a list with an add, and each row keeps its own download and delete.
 *
 * THE DOWNLOAD IS TWO STEPS. `GET …/download` returns a short-lived URL rather than the bytes, so the
 * click fetches the URL and then opens it. Opening our own endpoint directly would work only while the
 * session cookie travelled with a top-level navigation, which is exactly what `SameSite` stops.
 *
 * The upload goes through `useUpload`, which was broken until this branch: it sent no CSRF header, so
 * every presign in the SPA answered 403. Certificates would have been the fourth dead upload surface.
 */
export function CertificatesPanel({
  recordId,
  canManage,
}: {
  recordId: string;
  /** Verified records are still writable, but a revoked one takes no new evidence. */
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, uploading } = useUpload();
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<Certificate | null>(null);

  const certificates = useCertificates(recordId);
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['training', 'certificates', recordId] });

  async function attach(file: File) {
    setError('');
    try {
      await upload({
        file,
        presignUrl: `/v1/training/records/${recordId}/certificates/presign`,
        // The file id belongs in the PATH for this endpoint, and the body is empty — unlike the avatar
        // and photo endpoints, which take it in the body.
        confirmUrl: (fileId) => `/v1/training/records/${recordId}/certificates/${fileId}/confirm`,
        confirmBody: () => ({}),
      });
      toast.success('Certificate attached');
      invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    }
  }

  async function download(certificate: Certificate) {
    const { data, error: err } = await api.GET(
      '/v1/training/records/{id}/certificates/{fileId}/download',
      { params: { path: { id: recordId, fileId: certificate.fileId } } },
    );
    if (err || !data?.url) {
      toast.error(apiErrorMessage(err, 'Could not get a download link.'));
      return;
    }
    // `noopener` on a window we did not build the contents of.
    window.open(data.url, '_blank', 'noopener,noreferrer');
  }

  async function remove() {
    if (!deleting) return;
    const { error: err } = await api.DELETE('/v1/training/records/{id}/certificates/{fileId}', {
      params: { path: { id: recordId, fileId: deleting.fileId } },
    });
    setDeleting(null);
    if (err) {
      toast.error(apiErrorMessage(err, 'Failed to delete the certificate.'));
      return;
    }
    toast.success('Certificate deleted');
    invalidate();
  }

  const rows = certificates.data ?? [];

  return (
    <div className="flex flex-col gap-2">
      <ConfirmDialog
        open={!!deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete this certificate?"
        description="The file is removed from the record. If it was the only evidence of this completion, the record keeps the completion but loses its proof."
        confirmLabel="Delete certificate"
        variant="danger"
      />

      {certificates.isLoading && <p className="text-xs text-fg-subtle">Loading…</p>}
      {certificates.isError && (
        <p className="text-xs text-danger">Failed to load the certificates.</p>
      )}
      {!certificates.isLoading && !certificates.isError && rows.length === 0 && (
        <p className="text-xs text-fg-subtle">No certificate attached</p>
      )}

      {rows.map((certificate) => (
        <div
          key={certificate.fileId}
          className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5"
        >
          <FileText className="h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-fg">{certificate.fileName}</p>
            <p className="truncate text-xs text-fg-subtle">
              {formatKilobytes(certificate.sizeBytes)} · {formatDateTime(certificate.attachedAt)}
            </p>
          </div>
          <RowActions>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Download ${certificate.fileName}`}
              title="Download"
              onClick={() => download(certificate)}
            >
              <Download className="h-3.5 w-3.5" strokeWidth={2} />
            </Button>
            {canManage && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${certificate.fileName}`}
                title="Delete"
                onClick={() => setDeleting(certificate)}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              </Button>
            )}
          </RowActions>
        </div>
      ))}

      {canManage && (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={2} />
            {uploading ? 'Uploading…' : 'Attach certificate'}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={CERTIFICATE_ACCEPT}
            className="hidden"
            aria-label="Certificate file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared so the same file can be chosen again after a failure.
              e.target.value = '';
              if (file) void attach(file);
            }}
          />
        </>
      )}

      <FormError message={error} />
    </div>
  );
}

/** Sizes are shown in kB: certificates are documents, and "1.2 MB" hides nothing useful at this scale. */
function formatKilobytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}
