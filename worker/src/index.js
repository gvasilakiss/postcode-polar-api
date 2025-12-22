import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

// POLAR4 quintile descriptions
const POLAR_DESCRIPTIONS = {
    1: 'Quintile 1 - Areas with lowest young participation in higher education (most disadvantaged)',
    2: 'Quintile 2 - Areas with low young participation in higher education',
    3: 'Quintile 3 - Areas with medium young participation in higher education',
    4: 'Quintile 4 - Areas with high young participation in higher education',
    5: 'Quintile 5 - Areas with highest young participation in higher education (most advantaged)'
};

// Enable CORS for all origins
app.use('*', cors());

// Normalize postcode (remove spaces, uppercase)
function normalizePostcode(postcode) {
    return postcode.replace(/\s+/g, '').toUpperCase();
}

// Validate postcode format
function isValidPostcode(postcode) {
    const normalized = normalizePostcode(postcode);
    return /^[A-Z0-9]{5,8}$/.test(normalized);
}

// Root endpoint - API info
app.get('/', (c) => {
    return c.json({
        name: 'Postcode POLAR4 API',
        version: '1.0.0',
        description: 'Lookup POLAR4 participation quintiles by UK postcode',
        endpoints: {
            lookup: 'GET /postcode/:postcode',
            health: 'GET /health'
        },
        example: {
            request: 'GET /postcode/AB101AA',
            response: {
                success: true,
                postcode: 'AB10 1AA',
                polar4: 2,
                polar_description: 'Quintile 2 - Areas with low young participation in higher education'
            }
        },
        polar_quintiles: POLAR_DESCRIPTIONS
    });
});

// Health check endpoint
app.get('/health', (c) => {
    return c.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        runtime: 'Cloudflare Workers'
    });
});

// Main API endpoint - Get POLAR4 by postcode
app.get('/postcode/:postcode', async (c) => {
    const postcode = c.req.param('postcode');

    // Input validation
    if (!postcode || postcode.length < 5 || postcode.length > 10) {
        return c.json({
            success: false,
            error: 'Invalid postcode format',
            message: 'Postcode must be 5-10 characters'
        }, 400);
    }

    if (!isValidPostcode(postcode)) {
        return c.json({
            success: false,
            error: 'Invalid postcode format',
            message: 'Postcode contains invalid characters'
        }, 400);
    }

    const normalized = normalizePostcode(postcode);

    try {
        // Query D1 database
        const result = await c.env.DB.prepare(
            'SELECT postcode_display, polar4 FROM postcodes WHERE postcode = ?'
        ).bind(normalized).first();

        if (result) {
            return c.json({
                success: true,
                postcode: result.postcode_display,
                polar4: result.polar4,
                polar_description: POLAR_DESCRIPTIONS[result.polar4] || 'Unknown quintile'
            });
        } else {
            return c.json({
                success: false,
                error: 'Postcode not found',
                searched: postcode
            }, 404);
        }
    } catch (error) {
        console.error('Database error:', error);
        return c.json({
            success: false,
            error: 'Internal server error'
        }, 500);
    }
});

// 404 handler
app.notFound((c) => {
    return c.json({
        success: false,
        error: 'Not Found',
        message: `Endpoint ${c.req.method} ${c.req.path} does not exist`
    }, 404);
});

// Error handler
app.onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json({
        success: false,
        error: 'Internal Server Error'
    }, 500);
});

export default app;
