import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

export interface RequestContext {
  correlationId?: string;
  userId?: string;
  userEmail?: string;
}

/** Per-request store propagated via AsyncLocalStorage (set by AsyncLocalStorageMiddleware). */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

@Injectable()
export class RequestContextService {
  getStore(): RequestContext | undefined {
    return requestContextStorage.getStore();
  }

  getCorrelationId(): string | undefined {
    return requestContextStorage.getStore()?.correlationId;
  }

  getUserId(): string | undefined {
    return requestContextStorage.getStore()?.userId;
  }
}
