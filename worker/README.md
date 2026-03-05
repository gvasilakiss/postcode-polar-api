# Postcode POLAR4 API — Cloudflare Worker

Production-ready API for POLAR4 postcode lookups, running on Cloudflare Workers with D1.

**Live**: `postcode-prod.abrodly.com`

## Features

- ✅ TypeScript + Hono framework
- ✅ Single & batch postcode lookups
- ✅ Extended data (POLAR3, TUNDRA, Adult HE, MSOA/LSOA, Country)
- ✅ Fuzzy/partial postcode matching
- ✅ Autocomplete search
- ✅ Edge caching with ETag support
- ✅ Environment-specific CORS
- ✅ Optional API key authentication
- ✅ Structured JSON logging
- ✅ Cloudflare D1 (SQLite) backend
- ✅ API versioning (`/v1/`)
- ✅ 39 tests (Vitest)

## Quick Start

```bash
cd worker
npm install
npm run dev          # Local server at http://localhost:8787
npm run typecheck    # TypeScript check
npm run test         # Run all tests
```

## API Endpoints

### Lookup POLAR4 (single)

```
GET /v1/postcode/:postcode
GET /v1/postcode/:postcode?include=extended
```

**Response:**
```json
{
  "success": true,
  "postcode": "AB10 1AA",
  "polar4": 2,
  "polar_description": "Quintile 2 - Areas with low young participation in higher education",
  "match_type": "exact"
}
```

Extended response adds: `polar3`, `tundra_msoa`, `tundra_lsoa`, `adult_he`, `msoa_name`, `lsoa_name`, `country`, `status`.

### Batch Lookup (up to 50)

```
POST /v1/postcodes/batch
POST /v1/postcodes/batch?include=extended
```

**Body:**
```json
{ "postcodes": ["AB10 1AA", "SW1A 1AA", "OX1 2JD"] }
```

### Autocomplete Search

```
GET /v1/postcode/search?q=AB10
```

### Stats

```
GET /v1/stats
```

### Health & Readiness

```
GET /health
GET /ready
```

### Backward Compatibility

Old routes (`/postcode/:postcode`) redirect 301 to `/v1/postcode/:postcode`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOWED_ORIGINS` | `*` | Comma-separated CORS origins |
| `API_KEY` | — | Optional API key (require `X-API-Key` header) |

## Deployment

```bash
# Staging (workers.dev)
npm run deploy:staging

# Production (custom domain)
npm run deploy:production
```

### Database Setup

```bash
# 1. Initialize schema (drops + recreates table)
wrangler d1 execute postcode-polar-db --remote --file=./schema.sql

# 2. Generate import SQL from CSV
node import-data.js

# 3. Import data
wrangler d1 execute postcode-polar-db --remote --file=./import.sql
```

## POLAR4 Quintiles

| Quintile | Description |
|----------|-------------|
| 1 | Lowest HE participation (most disadvantaged) |
| 2 | Low HE participation |
| 3 | Medium HE participation |
| 4 | High HE participation |
| 5 | Highest HE participation (most advantaged) |

## Free Tier Limits

| Resource | Limit |
|----------|-------|
| Requests | 100,000/day |
| D1 Reads | 5,000,000/day |
| D1 Storage | 5 GB |
| Workers | Unlimited |
