/**
 * store.ts — Storage abstraction for Qora Xotin API
 *
 * Priority order:
 * 1. Upstash Redis  → if UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set (best)
 * 2. Vercel KV      → if KV_REST_API_URL + KV_REST_API_TOKEN are set (Vercel native)
 * 3. In-memory      → fallback (works for single instance / local dev)
 *
 * NOTE: In-memory mode loses data on cold starts. For reliable multi-player
 * games on Vercel, configure Upstash Redis env vars in your Vercel project.
 */

import { Redis } from '@upstash/redis';

// ─── Detect which backend to use ────────────────────────────────────────────
const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const hasRedis = Boolean(upstashUrl && upstashToken);

export const usingMemoryFallback = !hasRedis;

// ─── KVStore interface ───────────────────────────────────────────────────────
interface KVStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<void>;
}

// ─── In-memory fallback ──────────────────────────────────────────────────────
// Attach to globalThis so the same Map is reused across invocations on the
// same warm Lambda instance (Vercel reuses instances for burst traffic).
type Entry = { value: unknown; expiresAt: number | null };
const memoryStore: Map<string, Entry> =
  (globalThis as any).__qx_store__ ??
  ((globalThis as any).__qx_store__ = new Map<string, Entry>());

function cleanExpired() {
  const now = Date.now();
  for (const [k, v] of memoryStore) {
    if (v.expiresAt !== null && v.expiresAt < now) memoryStore.delete(k);
  }
}

const memoryDriver: KVStore = {
  async get<T>(key: string): Promise<T | null> {
    cleanExpired();
    const entry = memoryStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      memoryStore.delete(key);
      return null;
    }
    return JSON.parse(JSON.stringify(entry.value)) as T;
  },
  async set(key: string, value: unknown, opts?: { ex?: number }): Promise<void> {
    const expiresAt = opts?.ex ? Date.now() + opts.ex * 1000 : null;
    memoryStore.set(key, { value: JSON.parse(JSON.stringify(value)), expiresAt });
  },
};

// ─── Redis driver ────────────────────────────────────────────────────────────
function makeRedisDriver(): KVStore {
  const redis = new Redis({ url: upstashUrl!, token: upstashToken! });
  return {
    async get<T>(key: string): Promise<T | null> {
      try {
        return await redis.get<T>(key);
      } catch (e) {
        console.error('[store] Redis get error:', e);
        return null;
      }
    },
    async set(key: string, value: unknown, opts?: { ex?: number }): Promise<void> {
      try {
        if (opts?.ex) {
          await redis.set(key, value, { ex: opts.ex });
        } else {
          await redis.set(key, value);
        }
      } catch (e) {
        console.error('[store] Redis set error:', e);
      }
    },
  };
}

export const store: KVStore = hasRedis ? makeRedisDriver() : memoryDriver;

if (usingMemoryFallback) {
  console.warn(
    '[qora-xotin] Redis topilmadi — in-memory store ishlatilmoqda. ' +
    'Vercel cold start da xona yo\'qolishi mumkin. ' +
    'Upstash Redis sozlash uchun: https://console.upstash.com/'
  );
}
