import type { Context, Next } from 'hono';
import type { Env } from '../types';

/**
 * Aggressive cache middleware for Cloudflare Workers.
 *
 * Since POLAR4 data changes ~once per year, we use aggressive caching:
 *
 * - Browser:  30 days + immutable (no revalidation on back/forward)
 * - CDN edge: 1 year via CDN-Cache-Control (Cloudflare-specific)
 * - ETag:     versioned with DATA_VERSION env var for cache busting
 * - stale-while-revalidate: serves stale content instantly while revalidating
 */

// Browser cache: 30 days
const BROWSER_MAX_AGE = 2592000;

// CDN edge cache: 1 year
const CDN_MAX_AGE = 31536000;

/**
 * Generate a versioned ETag from response body + DATA_VERSION.
 * When you bump DATA_VERSION after a CSV re-import, all ETags change
 * and clients/CDN will fetch fresh data.
 */
async function generateETag(body: string, dataVersion: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(`${dataVersion}:${body}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `"${dataVersion}-${hashHex.substring(0, 16)}"`;
}

/**
 * Hono middleware that adds aggressive caching headers and ETag support.
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

    const dataVersion = c.env.DATA_VERSION ?? '1';

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
        const etag = await generateETag(responseBody, dataVersion);

        // Check If-None-Match
        const clientETag = c.req.header('If-None-Match');
        if (clientETag && clientETag === etag) {
            c.res = new Response(null, { status: 304 });
            return;
        }

        // Create cacheable response with aggressive headers
        const headers = new Headers(c.res.headers);

        // Browser cache: 30 days, immutable (skip revalidation on navigation),
        // stale-while-revalidate (serve stale for 1 day while refreshing)
        headers.set(
            'Cache-Control',
            `public, max-age=${BROWSER_MAX_AGE}, stale-while-revalidate=86400, immutable`
        );

        // CDN edge cache: 1 year (Cloudflare-specific, overrides Cache-Control for edge)
        headers.set('CDN-Cache-Control', `public, max-age=${CDN_MAX_AGE}`);

        // Versioned ETag for cache busting on data updates
        headers.set('ETag', etag);

        // Data version header for transparency
        headers.set('X-Data-Version', dataVersion);

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
