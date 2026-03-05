/**
 * Import CSV data into D1 database (expanded schema)
 *
 * Usage:
 * 1. First create the database: wrangler d1 create postcode-polar-db
 * 2. Update wrangler.toml with the database_id
 * 3. Initialize schema: wrangler d1 execute postcode-polar-db --remote --file=./schema.sql
 * 4. Run this script: node import-data.js
 * 5. Import data: wrangler d1 execute postcode-polar-db --remote --file=./import.sql
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CSV_PATH = path.join(__dirname, '..', 'data', 'postcodes.csv');
const OUTPUT_PATH = path.join(__dirname, 'import.sql');
const BATCH_SIZE = 500; // D1 has limits on statement size

// Column mapping: CSV header (lowercase) → DB column name
const COLUMN_MAP = {
    'postcode': null,               // handled specially (primary key + display)
    'polar4_quintile': 'polar4',
    'polar3_quintile': 'polar3',
    'tundra_msoa_quintile': 'tundra_msoa',
    'tundra_lsoa_quintile': 'tundra_lsoa',
    'adult_he_quintile': 'adult_he',
    'msoa_name': 'msoa_name',
    'lsoa_name': 'lsoa_name',
    'country': 'country',
    'postcode_status': 'status',
};

const INSERT_COLUMNS = 'postcode, postcode_display, polar4, polar3, tundra_msoa, tundra_lsoa, adult_he, msoa_name, lsoa_name, country, status';

/**
 * Escape a string value for SQL insertion.
 */
function escapeSql(value) {
    if (value === null || value === undefined || value === '') return 'NULL';
    const str = String(value).replace(/'/g, "''");
    return `'${str}'`;
}

/**
 * Try to parse a value as an integer. Returns null if not a valid integer.
 */
function parseIntOrNull(value) {
    if (!value || value === '' || value === 'NA' || value === 'N/A') return null;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
}

/**
 * Clean a string value, returning null for empty/NA values.
 */
function cleanString(value) {
    if (!value || value === '' || value === 'NA' || value === 'N/A') return null;
    return value.replace(/"/g, '').trim();
}

async function convertCsvToSql() {
    if (!fs.existsSync(CSV_PATH)) {
        console.error(`Error: CSV file not found at ${CSV_PATH}`);
        console.error('Make sure your postcodes.csv file is in the data/ folder');
        process.exit(1);
    }

    const fileStream = fs.createReadStream(CSV_PATH);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    // Create write stream with UTF-8 encoding
    const writeStream = fs.createWriteStream(OUTPUT_PATH, { encoding: 'utf8' });

    let isFirstLine = true;
    let columnIndices = {};
    let batch = [];
    let totalRows = 0;
    let skippedRows = 0;

    writeStream.write('-- Generated SQL for importing postcodes into D1 (expanded schema)\n');
    writeStream.write(`-- Generated at: ${new Date().toISOString()}\n`);
    writeStream.write('-- Run with: wrangler d1 execute postcode-polar-db --remote --file=./import.sql\n\n');

    for await (const line of rl) {
        if (isFirstLine) {
            // Parse header to find column indices
            const headers = line.split(',').map(h => h.trim().toLowerCase());

            // Find postcode column
            const postcodeIdx = headers.findIndex(h => h === 'postcode');
            if (postcodeIdx === -1) {
                console.error('Error: Could not find "postcode" column');
                console.error('Found headers:', headers);
                process.exit(1);
            }
            columnIndices['postcode'] = postcodeIdx;

            // Find all mapped columns
            for (const [csvHeader, dbColumn] of Object.entries(COLUMN_MAP)) {
                if (csvHeader === 'postcode') continue;

                const idx = headers.findIndex(h => h === csvHeader);
                if (idx !== -1) {
                    columnIndices[csvHeader] = idx;
                    console.log(`  ✓ Found column: ${csvHeader} → ${dbColumn} (index ${idx})`);
                } else {
                    console.warn(`  ⚠ Column not found: ${csvHeader} (will be NULL)`);
                }
            }

            isFirstLine = false;
            continue;
        }

        const columns = line.split(',');
        const postcodeIdx = columnIndices['postcode'];
        if (postcodeIdx === undefined || columns.length <= postcodeIdx) {
            skippedRows++;
            continue;
        }

        const postcodeDisplay = columns[postcodeIdx].trim().replace(/"/g, '');
        const postcode = postcodeDisplay.replace(/\s+/g, '').toUpperCase();

        // Get polar4 value (required)
        const polar4Idx = columnIndices['polar4_quintile'];
        const polar4 = polar4Idx !== undefined ? parseIntOrNull(columns[polar4Idx]) : null;

        if (!postcode || polar4 === null) {
            skippedRows++;
            continue;
        }

        // Get optional fields
        const polar3Idx = columnIndices['polar3_quintile'];
        const polar3 = polar3Idx !== undefined ? parseIntOrNull(columns[polar3Idx]) : null;

        const tundraMsoaIdx = columnIndices['tundra_msoa_quintile'];
        const tundraMsoa = tundraMsoaIdx !== undefined ? cleanString(columns[tundraMsoaIdx]) : null;

        const tundraLsoaIdx = columnIndices['tundra_lsoa_quintile'];
        const tundraLsoa = tundraLsoaIdx !== undefined ? cleanString(columns[tundraLsoaIdx]) : null;

        const adultHeIdx = columnIndices['adult_he_quintile'];
        const adultHe = adultHeIdx !== undefined ? parseIntOrNull(columns[adultHeIdx]) : null;

        const msoaNameIdx = columnIndices['msoa_name'];
        const msoaName = msoaNameIdx !== undefined ? cleanString(columns[msoaNameIdx]) : null;

        const lsoaNameIdx = columnIndices['lsoa_name'];
        const lsoaName = lsoaNameIdx !== undefined ? cleanString(columns[lsoaNameIdx]) : null;

        const countryIdx = columnIndices['country'];
        const country = countryIdx !== undefined ? cleanString(columns[countryIdx]) : null;

        const statusIdx = columnIndices['postcode_status'];
        const status = statusIdx !== undefined ? cleanString(columns[statusIdx]) : null;

        // Build INSERT values
        const values = [
            escapeSql(postcode),
            escapeSql(postcodeDisplay),
            polar4,
            polar3 !== null ? polar3 : 'NULL',
            escapeSql(tundraMsoa),
            escapeSql(tundraLsoa),
            adultHe !== null ? adultHe : 'NULL',
            escapeSql(msoaName),
            escapeSql(lsoaName),
            escapeSql(country),
            escapeSql(status),
        ].join(', ');

        batch.push(`(${values})`);
        totalRows++;

        // Write batch when full
        if (batch.length >= BATCH_SIZE) {
            writeStream.write(`INSERT INTO postcodes (${INSERT_COLUMNS}) VALUES\n`);
            writeStream.write(batch.join(',\n') + ';\n\n');
            batch = [];
        }
    }

    // Write remaining batch
    if (batch.length > 0) {
        writeStream.write(`INSERT INTO postcodes (${INSERT_COLUMNS}) VALUES\n`);
        writeStream.write(batch.join(',\n') + ';\n\n');
    }

    writeStream.write(`-- Total rows imported: ${totalRows}\n`);
    writeStream.write(`-- Rows skipped: ${skippedRows}\n`);
    writeStream.end();

    console.log(`\n✓ Generated import.sql (UTF-8 encoded)`);
    console.log(`  Imported: ${totalRows.toLocaleString()} postcodes`);
    console.log(`  Skipped: ${skippedRows.toLocaleString()} rows`);
    console.log(`\nNext step: wrangler d1 execute postcode-polar-db --remote --file=./import.sql`);
}

convertCsvToSql().catch(console.error);
