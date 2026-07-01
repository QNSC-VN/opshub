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

    this.client = new Redis(url, {
      keyPrefix: this.config.get('REDIS_KEY_PREFIX'),
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });

    this.client.on('error', (err) => this.logger.error('Redis error', err));
    this.client.on('connect', () => this.logger.log('Redis connected'));
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
