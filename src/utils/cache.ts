/**
 * Upstash Redis cache utility.
 *
 * Environment variables:
 *   UPSTASH_REDIS_REST_URL   – Upstash REST endpoint
 *   UPSTASH_REDIS_REST_TOKEN – Upstash REST token
 *   ENABLE_REDIS_CACHE       – set to "true" to activate caching
 *
 * When disabled (or credentials missing) every method is a safe no-op so the
 * rest of the app works without Redis.
 */

import { Redis } from '@upstash/redis';

// ── Singleton client (lazy) ──────────────────────────────────────────────────
let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn('[Cache] Upstash Redis credentials not set — caching disabled.');
    return null;
  }

  _redis = new Redis({ url, token });
  return _redis;
}

function isEnabled(): boolean {
  return process.env.ENABLE_REDIS_CACHE === 'true';
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get a value from the cache.
 * Returns `null` when the key doesn't exist or caching is disabled.
 */
export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  if (!isEnabled()) return null;
  const redis = getRedis();
  if (!redis) return null;

  try {
    const data = await redis.get<T>(key);
    return data ?? null;
  } catch (err) {
    console.error('[Cache] GET error:', err);
    return null;
  }
}

/**
 * Set a value in the cache with an optional TTL (seconds). Default 60s.
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
  if (!isEnabled()) return;
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.set(key, JSON.stringify(value), { ex: ttlSeconds });
  } catch (err) {
    console.error('[Cache] SET error:', err);
  }
}

/**
 * Delete one or more keys from the cache.
 */
export async function cacheDel(...keys: string[]): Promise<void> {
  if (!isEnabled()) return;
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.del(...keys);
  } catch (err) {
    console.error('[Cache] DEL error:', err);
  }
}

/**
 * Delete all keys matching a pattern (e.g. "events_*").
 * Uses SCAN to avoid blocking.
 */
export async function cacheFlushPattern(pattern: string): Promise<void> {
  if (!isEnabled()) return;
  const redis = getRedis();
  if (!redis) return;

  try {
    let cursor = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, { match: pattern, count: 100 });
      cursor = Number(nextCursor);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== 0);
  } catch (err) {
    console.error('[Cache] FLUSH error:', err);
  }
}
