# Cloudflare Workers Deployment

Deploy the Postcode POLAR4 API to Cloudflare Workers with D1 database.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)

## Deployment Steps

### 1. Install Dependencies

```bash
cd worker
npm install
```

### 2. Login to Cloudflare

```bash
npx wrangler login
```

This opens a browser for authentication.

### 3. Create D1 Database

```bash
npx wrangler d1 create postcode-polar-db
```

**Copy the `database_id` from the output** and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "postcode-polar-db"
database_id = "YOUR_DATABASE_ID_HERE"  # <-- Paste here
```

### 4. Initialize Database Schema

```bash
npx wrangler d1 execute postcode-polar-db --file=./schema.sql
```

### 5. Import Postcode Data

Generate and import the SQL:

```bash
node import-data.js > import.sql
npx wrangler d1 execute postcode-polar-db --file=./import.sql
```

⚠️ **Note**: This may take a few minutes for large CSV files.

### 6. Deploy Worker

```bash
npm run deploy
```

Your API will be live at: `https://postcode-polar-api.<your-subdomain>.workers.dev`

## Test Your API

```bash
# Health check
curl https://postcode-polar-api.<your-subdomain>.workers.dev/health

# Postcode lookup
curl https://postcode-polar-api.<your-subdomain>.workers.dev/postcode/AB101AA
```

## Local Development

```bash
npm run dev
```

This starts a local server at `http://localhost:8787`.

## Free Tier Limits

| Resource | Limit |
|----------|-------|
| Requests | 100,000/day |
| D1 Reads | 5,000,000/day |
| D1 Storage | 5 GB |
| Workers | Unlimited |
