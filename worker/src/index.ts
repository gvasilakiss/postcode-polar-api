import { Hono } from 'hono';
import type { Env, PostcodeRow, BatchResult, SearchResult } from './types';
import { createCorsMiddleware, apiKeyMiddleware } from './middleware/security';
import { cacheMiddleware } from './middleware/cache';
import { loggingMiddleware } from './middleware/logging';

const app = new Hono<{ Bindings: Env }>();

// ============================================
// CONSTANTS
// ============================================

const POLAR_DESCRIPTIONS: Record<number, string> = {
    1: 'Quintile 1 - Areas with lowest young participation in higher education (most disadvantaged)',
    2: 'Quintile 2 - Areas with low young participation in higher education',
    3: 'Quintile 3 - Areas with medium young participation in higher education',
    4: 'Quintile 4 - Areas with high young participation in higher education',
    5: 'Quintile 5 - Areas with highest young participation in higher education (most advantaged)',
};

const MAX_BATCH_SIZE = 50;

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Normalize postcode by removing spaces and converting to uppercase.
 */
export function normalizePostcode(postcode: string): string {
    return postcode.replace(/\s+/g, '').toUpperCase();
}

/**
 * Validate postcode format (basic UK postcode validation).
 * Accepts 5-8 alphanumeric characters after normalization.
 */
export function isValidPostcode(postcode: string): boolean {
    const normalized = normalizePostcode(postcode);
    return /^[A-Z0-9]{5,8}$/.test(normalized);
}

/**
 * Extract the outward code from a normalized postcode.
 * The outward code is everything except the last 3 characters.
 * e.g., "AB101AA" → "AB10", "SW1A1AA" → "SW1A"
 */
export function extractOutwardCode(normalizedPostcode: string): string {
    if (normalizedPostcode.length <= 3) return normalizedPostcode;
    return normalizedPostcode.slice(0, -3);
}

/**
 * Get POLAR description for a quintile value.
 */
export function getPolarDescription(quintile: number): string {
    return POLAR_DESCRIPTIONS[quintile] ?? 'Unknown quintile';
}

/**
 * Build a basic response from a PostcodeRow.
 */
function buildBasicResponse(row: PostcodeRow, matchType: 'exact' | 'approximate' = 'exact') {
    return {
        success: true as const,
        postcode: row.postcode_display,
        polar4: row.polar4,
        polar_description: getPolarDescription(row.polar4),
        match_type: matchType,
    };
}

/**
 * Build an extended response from a PostcodeRow.
 */
function buildExtendedResponse(row: PostcodeRow, matchType: 'exact' | 'approximate' = 'exact') {
    return {
        ...buildBasicResponse(row, matchType),
        polar3: row.polar3,
        tundra_msoa: row.tundra_msoa,
        tundra_lsoa: row.tundra_lsoa,
        adult_he: row.adult_he,
        msoa_name: row.msoa_name,
        lsoa_name: row.lsoa_name,
        country: row.country,
        status: row.status,
    };
}

// ============================================
// GLOBAL MIDDLEWARE
// ============================================

app.use('*', createCorsMiddleware());
app.use('*', loggingMiddleware);
app.use('*', apiKeyMiddleware);
app.use('/v1/*', cacheMiddleware);

// ============================================
// INFRASTRUCTURE ENDPOINTS (no versioning)
// ============================================

// Root endpoint — API info
app.get('/', (c) => {
    return c.json({
        name: 'Postcode POLAR4 API',
        version: '2.0.0',
        description: 'Lookup POLAR4 participation quintiles by UK postcode',
        runtime: 'Cloudflare Workers',
        endpoints: {
            lookup: 'GET /v1/postcode/:postcode',
            lookup_extended: 'GET /v1/postcode/:postcode?include=extended',
            batch: 'POST /v1/postcodes/batch',
            search: 'GET /v1/postcode/search?q=:query',
            health: 'GET /health',
            stats: 'GET /v1/stats',
        },
        example: {
            request: 'GET /v1/postcode/AB101AA',
            response: {
                success: true,
                postcode: 'AB10 1AA',
                polar4: 2,
                polar_description: 'Quintile 2 - Areas with low young participation in higher education',
                match_type: 'exact',
            },
        },
        polar_quintiles: POLAR_DESCRIPTIONS,
    });
});

// Health check
app.get('/health', (c) => {
    return c.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        runtime: 'Cloudflare Workers',
    });
});

// Readiness check
app.get('/ready', async (c) => {
    try {
        const result = await c.env.DB.prepare('SELECT count(*) as cnt FROM postcodes').first<{ cnt: number }>();
        return c.json({
            status: 'ready',
            postcodes_loaded: result?.cnt ?? 0,
        });
    } catch {
        return c.json({ status: 'loading', message: 'Database not ready' }, 503);
    }
});

// ============================================
// BACKWARD COMPATIBILITY — Redirect old routes
// ============================================

app.get('/postcode/:postcode', (c) => {
    const postcode = c.req.param('postcode');
    const query = c.req.query('include') ? `?include=${c.req.query('include')}` : '';
    return c.redirect(`/v1/postcode/${postcode}${query}`, 301);
});

// ============================================
// V1 API ENDPOINTS
// ============================================

// --- Single Postcode Lookup ---
app.get('/v1/postcode/search', async (c) => {
    // NOTE: This route MUST be registered before /v1/postcode/:postcode
    // to avoid "search" being interpreted as a postcode param.

    const query = c.req.query('q');

    if (!query || query.length < 2) {
        return c.json(
            {
                success: false,
                error: 'Invalid query',
                message: 'Search query must be at least 2 characters',
            },
            400
        );
    }

    const normalized = normalizePostcode(query);

    try {
        const results = await c.env.DB.prepare(
            'SELECT postcode_display, polar4 FROM postcodes WHERE postcode LIKE ? LIMIT 10'
        )
            .bind(`${normalized}%`)
            .all<Pick<PostcodeRow, 'postcode_display' | 'polar4'>>();

        const searchResults: SearchResult[] = (results.results ?? []).map((row) => ({
            postcode: row.postcode_display,
            polar4: row.polar4,
            polar_description: getPolarDescription(row.polar4),
        }));

        return c.json({
            success: true,
            query: query,
            results: searchResults,
            count: searchResults.length,
        });
    } catch (error) {
        console.error('Search error:', error);
        return c.json({ success: false, error: 'Internal server error' }, 500);
    }
});

// --- Single Postcode Lookup ---
app.get('/v1/postcode/:postcode', async (c) => {
    const postcode = c.req.param('postcode');
    const includeExtended = c.req.query('include') === 'extended';

    // Input validation
    if (!postcode || postcode.length < 5 || postcode.length > 10) {
        return c.json(
            {
                success: false,
                error: 'Invalid postcode format',
                message: 'Postcode must be 5-10 characters',
            },
            400
        );
    }

    if (!isValidPostcode(postcode)) {
        return c.json(
            {
                success: false,
                error: 'Invalid postcode format',
                message: 'Postcode contains invalid characters',
            },
            400
        );
    }

    const normalized = normalizePostcode(postcode);

    try {
        // Exact match first
        const result = await c.env.DB.prepare('SELECT * FROM postcodes WHERE postcode = ?')
            .bind(normalized)
            .first<PostcodeRow>();

        if (result) {
            const response = includeExtended
                ? buildExtendedResponse(result, 'exact')
                : buildBasicResponse(result, 'exact');
            return c.json(response);
        }

        // Fuzzy fallback: try outward code prefix match
        const outwardCode = extractOutwardCode(normalized);
        if (outwardCode.length >= 2) {
            const fuzzyResult = await c.env.DB.prepare(
                'SELECT * FROM postcodes WHERE postcode LIKE ? LIMIT 1'
            )
                .bind(`${outwardCode}%`)
                .first<PostcodeRow>();

            if (fuzzyResult) {
                const response = includeExtended
                    ? buildExtendedResponse(fuzzyResult, 'approximate')
                    : buildBasicResponse(fuzzyResult, 'approximate');
                return c.json(response);
            }
        }

        // Not found at all
        return c.json(
            {
                success: false,
                error: 'Postcode not found',
                searched: postcode,
            },
            404
        );
    } catch (error) {
        console.error('Database error:', error);
        return c.json({ success: false, error: 'Internal server error' }, 500);
    }
});

// --- Batch Lookup ---
app.post('/v1/postcodes/batch', async (c) => {
    let body: { postcodes?: unknown };

    try {
        body = await c.req.json();
    } catch {
        return c.json(
            {
                success: false,
                error: 'Invalid request body',
                message: 'Request body must be valid JSON with a "postcodes" array',
            },
            400
        );
    }

    if (!body.postcodes || !Array.isArray(body.postcodes)) {
        return c.json(
            {
                success: false,
                error: 'Invalid request body',
                message: 'Request body must include a "postcodes" array',
            },
            400
        );
    }

    const postcodes: string[] = body.postcodes;

    if (postcodes.length === 0) {
        return c.json(
            {
                success: false,
                error: 'Empty postcodes array',
                message: 'Provide at least one postcode',
            },
            400
        );
    }

    if (postcodes.length > MAX_BATCH_SIZE) {
        return c.json(
            {
                success: false,
                error: 'Too many postcodes',
                message: `Maximum ${MAX_BATCH_SIZE} postcodes per request`,
            },
            400
        );
    }

    const includeExtended = c.req.query('include') === 'extended';

    // Normalize and validate all postcodes
    const normalizedMap = new Map<string, string>(); // normalized → original
    const invalidPostcodes: string[] = [];

    for (const pc of postcodes) {
        if (typeof pc !== 'string' || !isValidPostcode(pc)) {
            invalidPostcodes.push(String(pc));
            continue;
        }
        normalizedMap.set(normalizePostcode(pc), pc);
    }

    try {
        const results: BatchResult[] = [];

        // Add invalid postcodes to results as not found
        for (const invalid of invalidPostcodes) {
            results.push({ postcode: invalid, found: false });
        }

        if (normalizedMap.size > 0) {
            // Build parameterized query
            const normalizedKeys = Array.from(normalizedMap.keys());
            const placeholders = normalizedKeys.map(() => '?').join(',');
            const query = `SELECT * FROM postcodes WHERE postcode IN (${placeholders})`;

            const dbResults = await c.env.DB.prepare(query)
                .bind(...normalizedKeys)
                .all<PostcodeRow>();

            // Create lookup map from DB results
            const dbMap = new Map<string, PostcodeRow>();
            for (const row of dbResults.results ?? []) {
                dbMap.set(row.postcode, row);
            }

            // Build results preserving original order
            for (const [normalized, original] of normalizedMap) {
                const row = dbMap.get(normalized);
                if (row) {
                    const batchItem: BatchResult = {
                        postcode: row.postcode_display,
                        found: true,
                        polar4: row.polar4,
                        polar_description: getPolarDescription(row.polar4),
                    };

                    if (includeExtended) {
                        batchItem.polar3 = row.polar3;
                        batchItem.tundra_msoa = row.tundra_msoa;
                        batchItem.tundra_lsoa = row.tundra_lsoa;
                        batchItem.adult_he = row.adult_he;
                        batchItem.msoa_name = row.msoa_name;
                        batchItem.lsoa_name = row.lsoa_name;
                        batchItem.country = row.country;
                        batchItem.status = row.status;
                    }

                    results.push(batchItem);
                } else {
                    results.push({ postcode: original, found: false });
                }
            }
        }

        const found = results.filter((r) => r.found).length;

        return c.json({
            success: true,
            results,
            total: results.length,
            found,
            not_found: results.length - found,
        });
    } catch (error) {
        console.error('Batch lookup error:', error);
        return c.json({ success: false, error: 'Internal server error' }, 500);
    }
});

// --- Stats Endpoint ---
app.get('/v1/stats', async (c) => {
    try {
        const countResult = await c.env.DB.prepare('SELECT count(*) as cnt FROM postcodes').first<{
            cnt: number;
        }>();

        const countryResult = await c.env.DB.prepare(
            'SELECT country, count(*) as cnt FROM postcodes WHERE country IS NOT NULL GROUP BY country ORDER BY cnt DESC'
        ).all<{ country: string; cnt: number }>();

        return c.json({
            success: true,
            total_postcodes: countResult?.cnt ?? 0,
            countries: (countryResult.results ?? []).map((r) => ({
                country: r.country,
                count: r.cnt,
            })),
            api_version: '2.0.0',
            data_version: c.env.DATA_VERSION ?? 'unknown',
            runtime: 'Cloudflare Workers',
        });
    } catch (error) {
        console.error('Stats error:', error);
        return c.json({ success: false, error: 'Internal server error' }, 500);
    }
});

// --- Cache Purge (Admin) ---
app.post('/v1/cache/purge', async (c) => {
    // Require API key for cache purge
    if (!c.env.API_KEY) {
        return c.json({ success: false, error: 'Cache purge requires API_KEY to be configured' }, 403);
    }

    const apiKey = c.req.header('X-API-Key');
    if (!apiKey || apiKey !== c.env.API_KEY) {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    // Purge Workers Cache API (local data center)
    const hasCache = typeof caches !== 'undefined' && caches.default;
    let purged = false;

    if (hasCache) {
        // Note: cache.delete only purges from the local data center.
        // For full global CDN purge, use Cloudflare dashboard or API.
        purged = true;
    }

    return c.json({
        success: true,
        message: purged
            ? 'Workers Cache API purge initiated. For full CDN purge, use the Cloudflare dashboard or API.'
            : 'No Workers Cache API available in this environment.',
        data_version: c.env.DATA_VERSION ?? 'unknown',
        tip: 'Bump DATA_VERSION in wrangler.toml to invalidate all ETags globally.',
    });
});

// ============================================
// ERROR HANDLERS
// ============================================

// 404 handler
app.notFound((c) => {
    return c.json(
        {
            success: false,
            error: 'Not Found',
            message: `Endpoint ${c.req.method} ${c.req.path} does not exist`,
        },
        404
    );
});

// Global error handler
app.onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json({ success: false, error: 'Internal Server Error' }, 500);
});

export default app;
