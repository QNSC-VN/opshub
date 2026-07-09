import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/app-config.service';

export const CACHE_CLIENT = Symbol('CACHE_CLIENT');

/**
 * Thin wrapper around ioredis with graceful connect/disconnect lifecycle.
 * Only created when REDIS_URL is set — callers must handle undefined.
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client: Redis | null = null;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    const url = this.config.get('REDIS_URL');
    if (!url) {
      this.logger.warn('REDIS_URL not set — cache disabled');
      return;
    }

    // NB: lazyConnect MUST be false. With lazyConnect the client stays in the
    // `wait` state until the first command is issued, but the RateLimitGuard
    // (and other callers) short-circuit on `isAvailable` (status === 'ready')
    // and never issue a command — so the connection is never established and
    // Redis is permanently reported "unavailable". Eager connect avoids this.
    this.client = new Redis(url, {
      keyPrefix: this.config.get('REDIS_KEY_PREFIX'),
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });

    this.client.on('error', (err) => this.logger.error('Redis error', err));
    this.client.on('ready', () => this.logger.log('Redis connected'));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }

  get redis(): Redis | null {
    return this.client;
  }

  /** Set a key with optional TTL (seconds). */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client) return;
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  /** Get a key. Returns null if not found or cache disabled. */
  async get(key: string): Promise<string | null> {
    return this.client?.get(key) ?? null;
  }

  /** Set a JSON-serializable value with optional TTL (seconds). */
  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  /** Get and parse a JSON value. Returns null if missing, disabled, or corrupt. */
  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      this.logger.warn(`Corrupt JSON in cache for key ${key} — ignoring`);
      return null;
    }
  }

  /** Delete one or more keys. */
  async del(...keys: string[]): Promise<void> {
    if (!this.client || keys.length === 0) return;
    await this.client.del(...keys);
  }

  /** Check if cache is available. */
  get isAvailable(): boolean {
    return this.client?.status === 'ready';
  }
}
