import type { Context, Next } from 'hono';
import type { Env } from '../types';

/**
 * Cache middleware for Cloudflare Workers.
 *
 * - Sets `Cache-Control: public, max-age=86400` on 200 responses
 * - Generates and checks `ETag` headers for conditional requests (304 Not Modified)
 * - Uses Cloudflare Cache API to cache D1 query results at the edge (when available)
 */

const CACHE_MAX_AGE = 86400; // 24 hours

/**
 * Generate a simple hash for ETag from response body.
 */
async function generateETag(body: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(body);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `"${hashHex.substring(0, 16)}"`;
}

/**
 * Hono middleware that adds caching headers and ETag support.
 */
export async function cacheMiddleware(c: Context<{ Bindings: Env }>, next: Next): Promise<void | Response> {
    // Only cache GET requests
    if (c.req.method !== 'GET') {
        await next();
        return;
    }

    // Skip caching for health/ready/stats endpoints
    const path = c.req.path;
    if (path === '/health' || path === '/ready' || path.endsWith('/stats')) {
        await next();
        return;
    }

    // Try Cloudflare Cache API (only available in Workers runtime)
    const hasCache = typeof caches !== 'undefined' && caches.default;

    if (hasCache) {
        const cacheKey = new Request(c.req.url, { method: 'GET' });
        const cache = caches.default;

        const cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) {
            // Check If-None-Match for conditional request
            const clientETag = c.req.header('If-None-Match');
            const cachedETag = cachedResponse.headers.get('ETag');

            if (clientETag && cachedETag && clientETag === cachedETag) {
                return c.body(null, 304);
            }

            return new Response(cachedResponse.body, cachedResponse);
        }
    }

    // Execute the request
    await next();

    // Only cache successful JSON responses
    if (c.res.status === 200) {
        const responseBody = await c.res.clone().text();
        const etag = await generateETag(responseBody);

        // Check If-None-Match
        const clientETag = c.req.header('If-None-Match');
        if (clientETag && clientETag === etag) {
            c.res = new Response(null, { status: 304 });
            return;
        }

        // Create cacheable response with headers
        const headers = new Headers(c.res.headers);
        headers.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE}`);
        headers.set('ETag', etag);

        const cacheableResponse = new Response(responseBody, {
            status: 200,
            headers,
        });

        // Store in edge cache if available (non-blocking)
        if (hasCache) {
            const cacheKey = new Request(c.req.url, { method: 'GET' });
            c.executionCtx.waitUntil(caches.default.put(cacheKey, cacheableResponse.clone()));
        }

        // Return response with cache headers
        c.res = new Response(responseBody, {
            status: 200,
            headers,
        });
    }
}
