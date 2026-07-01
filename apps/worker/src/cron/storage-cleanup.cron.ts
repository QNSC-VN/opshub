import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { StorageService } from '@platform';
import { MS_PER_HOUR } from '@shared-kernel';

/** Run the orphan cleanup sweep every hour. */
const CLEANUP_INTERVAL_MS = MS_PER_HOUR;

/**
 * StorageCleanupCron — purges orphaned pending file uploads.
 *
 * A pending StoredFile is an orphan when the client started the presigned-PUT
 * flow but never called /confirm.  This can happen if the browser tab is closed,
 * the upload times out, or the client crashes.
 *
 * Orphans are safe to delete after ORPHAN_CUTOFF_HOURS (24 h) because:
 *   - The presigned PUT URL expires after 5 min, so S3 won't accept late uploads.
 *   - Any linked entity (employee, asset, leave request) still shows null for
 *     its *StorageKey column, so the orphan is never visible in the domain.
 *
 * The S3 object delete is best-effort; failure is logged but does not re-queue
 * the row — the next hourly sweep will retry via the same DB query.
 */
@Injectable()
export class StorageCleanupCron {
  private readonly logger = new Logger(StorageCleanupCron.name);

  constructor(private readonly storage: StorageService) {}

  @Interval(CLEANUP_INTERVAL_MS)
  async tick(): Promise<void> {
    const purged = await this.storage.purgeOrphanedUploads();
    if (purged > 0) {
      this.logger.log(`Purged ${purged} orphaned pending upload(s)`);
    }
  }
}
