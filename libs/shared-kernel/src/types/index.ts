/** Shared primitive aliases used across bounded contexts. */
export type ISODateString = string;
export type UUID = string;

/** A nominal branded type helper for stronger ID typing where desired. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Authenticated principal passed as actor to service methods. */
export type Actor = { sub: string; email: string };
