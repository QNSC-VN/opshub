import { uuidv7 } from 'uuidv7';

/** Generate a time-sortable UUIDv7 — used as the primary key for all entities. */
export function newId(): string {
  return uuidv7();
}
