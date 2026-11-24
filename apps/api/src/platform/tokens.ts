/** Tokens de injeção. A injeção é sempre explícita (@Inject), sem depender de metadados de tipo. */
export const CONFIG = Symbol('CONFIG');
export const APP_POOL = Symbol('APP_POOL');
export const RELAY_POOL = Symbol('RELAY_POOL');
export const REDIS_QUEUE = Symbol('REDIS_QUEUE');
export const REDIS_CACHE = Symbol('REDIS_CACHE');
