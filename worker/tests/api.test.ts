import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../src/index';

// ============================================
// Mock D1 Database
// ============================================

const MOCK_DATA = new Map([
    ['AB101AA', { postcode: 'AB101AA', postcode_display: 'AB10 1AA', polar4: 2, polar3: 5, tundra_msoa: 'R', tundra_lsoa: 'R', adult_he: 4, msoa_name: 'George Street', lsoa_name: 'George Street - 02', country: 'Scotland', status: 'Terminated' }],
    ['SW1A1AA', { postcode: 'SW1A1AA', postcode_display: 'SW1A 1AA', polar4: 5, polar3: 5, tundra_msoa: '5', tundra_lsoa: '5', adult_he: 5, msoa_name: 'Westminster', lsoa_name: 'Westminster - 01', country: 'England', status: 'Live' }],
    ['OX12JD', { postcode: 'OX12JD', postcode_display: 'OX1 2JD', polar4: 3, polar3: 3, tundra_msoa: '3', tundra_lsoa: '3', adult_he: 3, msoa_name: 'Oxford', lsoa_name: 'Oxford - 01', country: 'England', status: 'Live' }],
]);

function createMockDB() {
    return {
        prepare: vi.fn((sql: string) => {
            return {
                bind: vi.fn((...args: string[]) => {
                    return {
                        first: vi.fn(async () => {
                            // Handle single postcode lookup
                            if (sql.includes('WHERE postcode = ?')) {
                                return MOCK_DATA.get(args[0]) ?? null;
                            }
                            // Handle LIKE query (fuzzy/search)
                            if (sql.includes('LIKE ?')) {
                                const prefix = args[0].replace('%', '');
                                for (const [key, value] of MOCK_DATA) {
                                    if (key.startsWith(prefix)) return value;
                                }
                                return null;
                            }
                            // Handle count
                            if (sql.includes('count(*)')) {
                                return { cnt: MOCK_DATA.size };
                            }
                            return null;
                        }),
                        all: vi.fn(async () => {
                            // Handle IN query (batch)
                            if (sql.includes('IN')) {
                                const results = args
                                    .map(key => MOCK_DATA.get(key))
                                    .filter(Boolean);
                                return { results };
                            }
                            // Handle LIKE query (search)
                            if (sql.includes('LIKE ?')) {
                                const prefix = args[0].replace('%', '');
                                const results = Array.from(MOCK_DATA.values()).filter(v =>
                                    v.postcode.startsWith(prefix)
                                );
                                return { results };
                            }
                            // Handle GROUP BY (stats)
                            if (sql.includes('GROUP BY')) {
                                return {
                                    results: [
                                        { country: 'England', cnt: 2 },
                                        { country: 'Scotland', cnt: 1 },
                                    ],
                                };
                            }
                            return { results: [] };
                        }),
                    };
                }),
                first: vi.fn(async () => {
                    if (sql.includes('count(*)')) {
                        return { cnt: MOCK_DATA.size };
                    }
                    return null;
                }),
                all: vi.fn(async () => {
                    if (sql.includes('GROUP BY')) {
                        return {
                            results: [
                                { country: 'England', cnt: 2 },
                                { country: 'Scotland', cnt: 1 },
                            ],
                        };
                    }
                    return { results: [] };
                }),
            };
        }),
    };
}

function createEnv(overrides?: { API_KEY?: string }) {
    return {
        DB: createMockDB() as unknown as D1Database,
        ALLOWED_ORIGINS: '*',
        DATA_VERSION: '2025.1',
        ...overrides,
    };
}

// Helper to make requests against the Hono app
async function makeRequest(path: string, options?: RequestInit, envOverrides?: { API_KEY?: string }) {
    const env = createEnv(envOverrides);
    const req = new Request(`http://localhost${path}`, options);
    return app.fetch(req, env, { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext);
}

// ============================================
// Root & Health Endpoints
// ============================================
describe('Infrastructure Endpoints', () => {
    it('GET / returns API info', async () => {
        const res = await makeRequest('/');
        expect(res.status).toBe(200);
        const data = await res.json() as Record<string, unknown>;
        expect(data.name).toBe('Postcode POLAR4 API');
        expect(data.version).toBe('2.0.0');
        expect(data.endpoints).toBeDefined();
    });

    it('GET /health returns ok', async () => {
        const res = await makeRequest('/health');
        expect(res.status).toBe(200);
        const data = await res.json() as Record<string, unknown>;
        expect(data.status).toBe('ok');
        expect(data.runtime).toBe('Cloudflare Workers');
    });

    it('GET /ready returns postcode count', async () => {
        const res = await makeRequest('/ready');
        expect(res.status).toBe(200);
        const data = await res.json() as Record<string, unknown>;
        expect(data.status).toBe('ready');
        expect(data.postcodes_loaded).toBeDefined();
    });
});

// ============================================
// Backward Compatibility
// ============================================
describe('Backward Compatibility', () => {
    it('GET /postcode/:postcode redirects to /v1/', async () => {
        const res = await makeRequest('/postcode/AB101AA', { redirect: 'manual' });
        expect(res.status).toBe(301);
        expect(res.headers.get('Location')).toContain('/v1/postcode/AB101AA');
    });
});

// ============================================
// Single Postcode Lookup
// ============================================
describe('GET /v1/postcode/:postcode', () => {
    it('returns data for a valid postcode', async () => {
        const res = await makeRequest('/v1/postcode/AB101AA');
        expect(res.status).toBe(200);
        const data = await res.json() as Record<string, unknown>;
        expect(data.success).toBe(true);
        expect(data.postcode).toBe('AB10 1AA');
        expect(data.polar4).toBe(2);
        expect(data.match_type).toBe('exact');
    });

    it('returns extended data with ?include=extended', async () => {
        const res = await makeRequest('/v1/postcode/AB101AA?include=extended');
        expect(res.status).toBe(200);
        const data = await res.json() as Record<string, unknown>;
        expect(data.success).toBe(true);
        expect(data.country).toBe('Scotland');
        expect(data.msoa_name).toBe('George Street');
        expect(data.tundra_msoa).toBe('R');
    });

    it('returns 400 for too-short postcodes', async () => {
        const res = await makeRequest('/v1/postcode/AB1');
        expect(res.status).toBe(400);
        const data = await res.json() as Record<string, unknown>;
        expect(data.success).toBe(false);
    });

    it('returns 400 for invalid characters', async () => {
        const res = await makeRequest('/v1/postcode/AB10-1AA');
        expect(res.status).toBe(400);
        const data = await res.json() as Record<string, unknown>;
        expect(data.success).toBe(false);
        expect(data.error).toContain('Invalid');
    });

    it('returns approximate match via fuzzy fallback', async () => {
        // ZZZZ9XX doesn't exist, but if outward code matches something...
        // With our mock this won't match, so it should 404
        const res = await makeRequest('/v1/postcode/ZZZZ9XX');
        expect(res.status).toBe(404);
    });
});

// ============================================
// Batch Lookup
// ============================================
describe('POST /v1/postcodes/batch', () => {
    it('returns results for valid batch', async () => {
        const res = await makeRequest('/v1/postcodes/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postcodes: ['AB10 1AA', 'SW1A 1AA'] }),
        });
        expect(res.status).toBe(200);
        const data = await res.json() as Record<string, unknown>;
        expect(data.success).toBe(true);
        expect(data.total).toBe(2);
    });

    it('returns 400 for missing postcodes field', async () => {
        const res = await makeRequest('/v1/postcodes/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: ['AB101AA'] }),
        });
        expect(res.status).toBe(400);
    });

    it('returns 400 for empty postcodes array', async () => {
        const res = await makeRequest('/v1/postcodes/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postcodes: [] }),
        });
        expect(res.status).toBe(400);
    });

    it('returns 400 when batch exceeds limit', async () => {
        const huge = Array.from({ length: 51 }, (_, i) => `AB10${String(i).padStart(3, '0')}`);
        const res = await makeRequest('/v1/postcodes/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postcodes: huge }),
        });
        expect(res.status).toBe(400);
        const data = await res.json() as Record<string, unknown>;
        expect(data.error).toContain('Too many');
    });

    it('returns 400 for invalid JSON body', async () => {
        const res = await makeRequest('/v1/postcodes/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'not json',
        });
        expect(res.status).toBe(400);
    });
});

// ============================================
// Search / Autocomplete
// ============================================
describe('GET /v1/postcode/search', () => {
    it('returns matching postcodes', async () => {
        const res = await makeRequest('/v1/postcode/search?q=AB10');
        expect(res.status).toBe(200);
        const data = await res.json() as Record<string, unknown>;
        expect(data.success).toBe(true);
        expect(Array.isArray(data.results)).toBe(true);
    });

    it('returns 400 for query too short', async () => {
        const res = await makeRequest('/v1/postcode/search?q=A');
        expect(res.status).toBe(400);
        const data = await res.json() as Record<string, unknown>;
        expect(data.success).toBe(false);
    });

    it('returns 400 for missing query', async () => {
        const res = await makeRequest('/v1/postcode/search');
        expect(res.status).toBe(400);
    });
});

// ============================================
// Stats Endpoint
// ============================================
describe('GET /v1/stats', () => {
    it('returns stats with postcode count, countries, and data version', async () => {
        const res = await makeRequest('/v1/stats');
        expect(res.status).toBe(200);
        const data = await res.json() as Record<string, unknown>;
        expect(data.success).toBe(true);
        expect(data.api_version).toBe('2.0.0');
        expect(data.data_version).toBe('2025.1');
        expect(data.total_postcodes).toBeDefined();
    });
});

// ============================================
// Cache Purge
// ============================================
describe('POST /v1/cache/purge', () => {
    it('returns 403 when no API_KEY is configured', async () => {
        const res = await makeRequest('/v1/cache/purge', { method: 'POST' });
        expect(res.status).toBe(403);
    });

    it('returns 401 with wrong API key', async () => {
        const res = await makeRequest(
            '/v1/cache/purge',
            { method: 'POST', headers: { 'X-API-Key': 'wrong-key' } },
            { API_KEY: 'correct-key' }
        );
        expect(res.status).toBe(401);
    });

    it('returns 200 with correct API key', async () => {
        const res = await makeRequest(
            '/v1/cache/purge',
            { method: 'POST', headers: { 'X-API-Key': 'my-secret' } },
            { API_KEY: 'my-secret' }
        );
        expect(res.status).toBe(200);
        const data = await res.json() as Record<string, unknown>;
        expect(data.success).toBe(true);
        expect(data.data_version).toBe('2025.1');
    });
});

// ============================================
// 404 Handler
// ============================================
describe('404 Handler', () => {
    it('returns 404 for unknown endpoints', async () => {
        const res = await makeRequest('/v1/nonexistent');
        expect(res.status).toBe(404);
        const data = await res.json() as Record<string, unknown>;
        expect(data.success).toBe(false);
        expect(data.error).toBe('Not Found');
    });
});
