# Postcode POLAR4 API

A production-ready Node.js API to lookup POLAR4 participation quintiles by UK postcode.

## Features

- ✅ Fast in-memory lookups (2.3M+ postcodes)
- ✅ CORS enabled
- ✅ Rate limiting (100 req/min)
- ✅ Security headers (Helmet)
- ✅ Response compression
- ✅ Input validation
- ✅ Graceful shutdown
- ✅ Health & readiness checks
- ✅ Docker ready

## Quick Start

```bash
# Install dependencies
npm install

# Add your CSV to data/postcodes.csv

# Start the server
npm start
```

## API Endpoints

### Lookup POLAR4
```
GET /postcode/:postcode
```

**Response:**
```json
{
  "success": true,
  "postcode": "AB10 1AA",
  "polar4": "2",
  "polar_description": "Quintile 2 - Areas with low young participation in higher education"
}
```

### Health Check
```
GET /health
```

### Readiness Check
```
GET /ready
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `NODE_ENV` | development | Environment mode |
| `CSV_PATH` | ./data/postcodes.csv | Path to CSV file |
| `RATE_LIMIT` | 100 | Requests per minute |
| `ALLOWED_ORIGINS` | * | Comma-separated CORS origins |

## Docker Deployment

```bash
# Build image
docker build -t postcode-api .

# Run container
docker run -p 3000:3000 postcode-api
```

## POLAR4 Quintiles

| Quintile | Description |
|----------|-------------|
| 1 | Lowest HE participation (most disadvantaged) |
| 2 | Low HE participation |
| 3 | Medium HE participation |
| 4 | High HE participation |
| 5 | Highest HE participation (most advantaged) |
