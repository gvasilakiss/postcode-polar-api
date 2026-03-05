import { cors } from 'hono/cors';
import type { Context, Next, MiddlewareHandler } from 'hono';
import type { Env } from '../types';

/**
 * Create a dynamic CORS middleware that reads allowed origins from environment.
 *
 * - If ALLOWED_ORIGINS is set: only those origins are allowed
 * - If ALLOWED_ORIGINS is not set: all origins allowed (development mode)
 */
export function createCorsMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
    return async (c: Context<{ Bindings: Env }>, next: Next) => {
        const allowedOrigins = c.env.ALLOWED_ORIGINS;

        if (allowedOrigins && allowedOrigins !== '*') {
            const origins = allowedOrigins.split(',').map(o => o.trim());
            const corsHandler = cors({
                origin: origins,
                allowMethods: ['GET', 'POST', 'OPTIONS'],
                allowHeaders: ['Content-Type', 'X-API-Key'],
                maxAge: 86400,
            });
            return corsHandler(c, next);
        }

        // Default: allow all origins (development)
        const corsHandler = cors({
            origin: '*',
            allowMethods: ['GET', 'POST', 'OPTIONS'],
            allowHeaders: ['Content-Type', 'X-API-Key'],
            maxAge: 86400,
        });
        return corsHandler(c, next);
    };
}

/**
 * Optional API key middleware.
 *
 * If API_KEY env var is set, requires `X-API-Key` header on all
 * non-health/non-root endpoints.
 */
export async function apiKeyMiddleware(c: Context<{ Bindings: Env }>, next: Next): Promise<void | Response> {
    const apiKey = c.env.API_KEY;

    // If no API key configured, skip check
    if (!apiKey) {
        await next();
        return;
    }

    // Skip API key check for health, ready, and root endpoints
    const path = c.req.path;
    if (path === '/' || path === '/health' || path === '/ready') {
        await next();
        return;
    }

    const providedKey = c.req.header('X-API-Key');
    if (!providedKey || providedKey !== apiKey) {
        return c.json(
            {
                success: false,
                error: 'Unauthorized',
                message: 'Valid API key required. Provide via X-API-Key header.',
            },
            401
        );
    }

    await next();
}
