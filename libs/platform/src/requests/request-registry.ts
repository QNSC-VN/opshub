import { Injectable } from '@nestjs/common';
import type { RequestTypeDef } from './request-engine.types';

/**
 * Global registry for RequestTypeDef implementations. Populated by domain
 * modules calling `register()` in their `onModuleInit()` lifecycle hook.
 *
 * Lives in the global PlatformModule so every module can inject it without
 * explicit imports.
 */
@Injectable()
export class RequestRegistry {
  private readonly defs = new Map<string, RequestTypeDef<unknown>>();

  /** Call from the domain module's TypeDef service `onModuleInit`. */
  register<T>(def: RequestTypeDef<T>): void {
    if (this.defs.has(def.type)) return; // idempotent — hot reload safe
    this.defs.set(def.type, def);
  }

  /** Returns the TypeDef or throws. Never returns null — fail fast at call site. */
  get(type: string): RequestTypeDef<unknown> {
    const def = this.defs.get(type);
    if (!def) throw new Error(`No RequestTypeDef registered for type '${type}'`);
    return def;
  }

  list(): RequestTypeDef<unknown>[] {
    return [...this.defs.values()];
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }
}
