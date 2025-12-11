const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Store postcode data in memory for fast lookups
let postcodeData = new Map();
let isReady = false;

// POLAR4 quintile descriptions
const POLAR_DESCRIPTIONS = {
    '1': 'Quintile 1 - Areas with lowest young participation in higher education (most disadvantaged)',
    '2': 'Quintile 2 - Areas with low young participation in higher education',
    '3': 'Quintile 3 - Areas with medium young participation in higher education',
    '4': 'Quintile 4 - Areas with high young participation in higher education',
    '5': 'Quintile 5 - Areas with highest young participation in higher education (most advantaged)'
};

// ============================================
// MIDDLEWARE - Production Security & Performance
// ============================================

// Security headers
app.use(helmet());

// Enable CORS for all origins (configure as needed for production)
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    methods: ['GET'],
    optionsSuccessStatus: 200
}));

// Compress responses
app.use(compression());

// Rate limiting - 100 requests per minute per IP
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: process.env.RATE_LIMIT || 100,
    message: {
        success: false,
        error: 'Too many requests, please try again later.',
        retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false
});
app.use(limiter);

// Request logging (simple)
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
});

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Normalize postcode by removing spaces and converting to uppercase
 */
function normalizePostcode(postcode) {
    return postcode.replace(/\s+/g, '').toUpperCase();
}

/**
 * Validate postcode format (basic UK postcode validation)
 */
function isValidPostcode(postcode) {
    // Basic validation: 5-8 characters, alphanumeric
    const normalized = normalizePostcode(postcode);
    return /^[A-Z0-9]{5,8}$/.test(normalized);
}

/**
 * Load CSV data into memory
 */
function loadCSVData(csvPath) {
    return new Promise((resolve, reject) => {
        const data = new Map();

        if (!fs.existsSync(csvPath)) {
            reject(new Error(`CSV file not found: ${csvPath}`));
            return;
        }

        fs.createReadStream(csvPath)
            .pipe(csv())
            .on('data', (row) => {
                const postcode = row['Postcode'] || row['postcode'] || row['POSTCODE'];
                const polar4 = row['POLAR4_quintile'] || row['POLAR4'] || row['polar4'];

                if (postcode) {
                    const normalized = normalizePostcode(postcode);
                    data.set(normalized, {
                        postcode: postcode,
                        polar4: polar4
                    });
                }
            })
            .on('end', () => {
                console.log(`✓ Loaded ${data.size} postcodes from CSV`);
                resolve(data);
            })
            .on('error', reject);
    });
}

// ============================================
// API ENDPOINTS
// ============================================

// Readiness check (for load balancers)
app.get('/ready', (req, res) => {
    if (isReady) {
        res.json({ status: 'ready', postcodes_loaded: postcodeData.size });
    } else {
        res.status(503).json({ status: 'loading', message: 'Data is still loading' });
    }
});

// Health check (for container orchestration)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        postcodes_loaded: postcodeData.size,
        environment: NODE_ENV
    });
});

// Main API endpoint - Get POLAR4 by postcode
app.get('/postcode/:postcode', (req, res) => {
    const { postcode } = req.params;

    // Input validation
    if (!postcode || postcode.length < 5 || postcode.length > 10) {
        return res.status(400).json({
            success: false,
            error: 'Invalid postcode format',
            message: 'Postcode must be 5-10 characters'
        });
    }

    if (!isValidPostcode(postcode)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid postcode format',
            message: 'Postcode contains invalid characters'
        });
    }

    const normalized = normalizePostcode(postcode);
    const result = postcodeData.get(normalized);

    if (result) {
        const polar4Value = result.polar4;
        res.json({
            success: true,
            postcode: result.postcode,
            polar4: polar4Value,
            polar_description: POLAR_DESCRIPTIONS[polar4Value] || 'Unknown quintile'
        });
    } else {
        res.status(404).json({
            success: false,
            error: 'Postcode not found',
            searched: postcode
        });
    }
});

// Root endpoint with API info
app.get('/', (req, res) => {
    res.json({
        name: 'Postcode POLAR4 API',
        version: '1.0.0',
        description: 'Lookup POLAR4 participation quintiles by UK postcode',
        endpoints: {
            lookup: 'GET /postcode/:postcode',
            health: 'GET /health',
            ready: 'GET /ready'
        },
        example: {
            request: 'GET /postcode/AB101AA',
            response: {
                success: true,
                postcode: 'AB10 1AA',
                polar4: '2',
                polar_description: 'Quintile 2 - Areas with low young participation in higher education'
            }
        },
        polar_quintiles: POLAR_DESCRIPTIONS
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Not Found',
        message: `Endpoint ${req.method} ${req.path} does not exist`
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
    });
});

// ============================================
// SERVER STARTUP & GRACEFUL SHUTDOWN
// ============================================

let server;

async function start() {
    const csvPath = process.env.CSV_PATH || path.join(__dirname, 'data', 'postcodes.csv');

    try {
        console.log(`[${NODE_ENV}] Loading CSV from: ${csvPath}`);
        postcodeData = await loadCSVData(csvPath);
        isReady = true;

        server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`\n🚀 Postcode POLAR4 API running at http://localhost:${PORT}`);
            console.log(`   Environment: ${NODE_ENV}`);
            console.log(`   Postcodes loaded: ${postcodeData.size.toLocaleString()}`);
            console.log(`\nEndpoints:`);
            console.log(`   GET /postcode/:postcode - Lookup POLAR4`);
            console.log(`   GET /health - Health check`);
            console.log(`   GET /ready - Readiness check`);
        });

    } catch (error) {
        console.error('Failed to start server:', error.message);
        console.log('\n📁 Please place your CSV file at: data/postcodes.csv');
        console.log('   Or set CSV_PATH environment variable');
        process.exit(1);
    }
}

// Graceful shutdown
function shutdown(signal) {
    console.log(`\n${signal} received. Shutting down gracefully...`);

    if (server) {
        server.close(() => {
            console.log('✓ HTTP server closed');
            process.exit(0);
        });

        // Force close after 10 seconds
        setTimeout(() => {
            console.error('Forcing shutdown after timeout');
            process.exit(1);
        }, 10000);
    } else {
        process.exit(0);
    }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    shutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

start();
