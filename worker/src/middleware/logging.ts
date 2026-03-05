import type { Context, Next } from 'hono';
import type { Env } from '../types';

/**
 * Structured request logging middleware.
 *
 * Logs request details as JSON to console (picked up by Workers Logpush / Tail).
 */
export async function loggingMiddleware(c: Context<{ Bindings: Env }>, next: Next): Promise<void> {
    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;
    const userAgent = c.req.header('User-Agent') ?? 'unknown';

    await next();

    const duration = Date.now() - start;
    const status = c.res.status;

    // cf object contains Cloudflare-specific request metadata
    const cf = c.req.raw.cf;
    const colo = cf?.colo ?? 'unknown';

    console.log(
        JSON.stringify({
            level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
            method,
            path,
            status,
            duration_ms: duration,
            colo,
            user_agent: userAgent,
            timestamp: new Date().toISOString(),
        })
    );
}
