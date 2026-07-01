/**
 * PhotoUploadWidget — drag-or-click file upload with presigned S3.
 *
 * Calls presignUrl → PUT → confirmUrl, then invokes onSuccess.
 * Shows image preview for images; shows filename for other types.
 */
import { useRef, useState } from 'react';
import { Upload, X, FileText, Loader2 } from 'lucide-react';
import { useUpload } from '@/shared/api/use-upload';
import { cn } from '@/shared/lib/utils';

export interface PhotoUploadWidgetProps {
  /** Current URL to display (null = no upload yet) */
  currentUrl?: string | null;
  /** Whether the file is a document (PDF) vs image */
  mode?: 'image' | 'document';
  /** POST endpoint for presign step, e.g. "/v1/employees/emp-1/avatar/presign" */
  presignUrl: string;
  /** POST endpoint for confirm step */
  confirmUrl: string;
  /** Accepted MIME types, e.g. "image/jpeg,image/png,image/webp" */
  accept: string;
  /** Called after a successful upload with the new download URL */
  onSuccess: (url: string) => void;
  /** Optional: disable the widget */
  disabled?: boolean;
  label?: string;
}

export function PhotoUploadWidget({
  currentUrl,
  mode = 'image',
  presignUrl,
  confirmUrl,
  accept,
  onSuccess,
  disabled = false,
  label,
}: PhotoUploadWidgetProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { upload, uploading } = useUpload();

  const displayUrl = preview ?? currentUrl;

  async function handleFile(file: File) {
    setError(null);
    setProgress(0);
    setFileName(file.name);

    if (mode === 'image') {
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target?.result as string);
      reader.readAsDataURL(file);
    }

    try {
      const result = await upload({
        file,
        presignUrl,
        confirmUrl,
        onProgress: setProgress,
      });
      onSuccess(result.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setPreview(null);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset so the same file can be re-selected
    e.target.value = '';
  }

  return (
    <div className="flex flex-col gap-2">
      {label && <p className="text-xs font-medium text-fg-muted">{label}</p>}

      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className={cn(
          'relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors',
          disabled || uploading
            ? 'cursor-not-allowed border-border bg-surface-muted'
            : 'cursor-pointer border-border bg-surface hover:border-blue-400 hover:bg-accent-muted/30',
          mode === 'image' ? 'h-32 w-32' : 'h-20 w-full',
        )}
        onClick={() => !disabled && !uploading && inputRef.current?.click()}
      >
        {/* Image preview */}
        {mode === 'image' && displayUrl && !uploading && (
          <img
            src={displayUrl}
            alt="Preview"
            className="h-full w-full rounded-lg object-cover"
          />
        )}

        {/* Document display */}
        {mode === 'document' && (currentUrl || fileName) && !uploading && (
          <div className="flex items-center gap-2 px-3">
            <FileText className="h-4 w-4 shrink-0 text-accent" />
            <span className="truncate text-xs text-fg-muted">
              {fileName ?? 'Uploaded document'}
            </span>
          </div>
        )}

        {/* Upload uploading state */}
        {uploading && (
          <div className="flex flex-col items-center gap-1.5">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            <span className="text-xs text-fg-subtle">{progress}%</span>
          </div>
        )}

        {/* Empty state */}
        {!uploading && !displayUrl && mode === 'image' && (
          <div className="flex flex-col items-center gap-1 text-center">
            <Upload className="h-5 w-5 text-fg-subtle" />
            <span className="text-[10px] text-fg-subtle leading-tight px-1">
              Click or drag
            </span>
          </div>
        )}

        {!uploading && !currentUrl && !fileName && mode === 'document' && (
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-fg-subtle" />
            <span className="text-xs text-fg-subtle">Attach document</span>
          </div>
        )}

        {/* Overlay icon on hover (image mode with existing photo) */}
        {mode === 'image' && displayUrl && !uploading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 transition-colors hover:bg-black/30">
            <Upload className="h-5 w-5 text-white opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        )}
      </div>

      {/* Progress bar */}
      {uploading && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-muted">
          <div
            className="h-full rounded-full bg-accent-muted0 transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-1.5 text-xs text-danger">
          <X className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleChange}
        disabled={disabled || uploading}
      />
    </div>
  );
}
