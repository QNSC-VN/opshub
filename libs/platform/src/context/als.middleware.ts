import { Injectable, NestMiddleware } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { requestContextStorage } from './request-context';

/**
 * Establishes an AsyncLocalStorage context for every request and stamps a
 * correlation id (incoming X-Correlation-Id header or a fresh uuid).
 */
@Injectable()
export class AsyncLocalStorageMiddleware implements NestMiddleware {
  use(req: FastifyRequest['raw'], res: FastifyReply['raw'], next: () => void): void {
    const headerId = req.headers['x-correlation-id'];
    const raw = Array.isArray(headerId) ? headerId[0] : headerId;
    // Accept only valid UUIDs from clients; anything else (log injection, garbage) gets a fresh id.
    const correlationId =
      raw && /^[0-9a-f-]{32,36}$/i.test(raw) ? raw.slice(0, 36) : randomUUID();

    res.setHeader('X-Correlation-Id', correlationId);
    requestContextStorage.run({ correlationId }, () => next());
  }
}
