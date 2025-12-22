/**
 * Import CSV data into D1 database
 * 
 * Usage:
 * 1. First create the database: wrangler d1 create postcode-polar-db
 * 2. Update wrangler.toml with the database_id
 * 3. Initialize schema: wrangler d1 execute postcode-polar-db --file=./schema.sql
 * 4. Run this script: node import-data.js
 * 5. Import data: wrangler d1 execute postcode-polar-db --remote --file=./import.sql
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CSV_PATH = path.join(__dirname, '..', 'data', 'postcodes.csv');
const OUTPUT_PATH = path.join(__dirname, 'import.sql');
const BATCH_SIZE = 500; // D1 has limits on statement size

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

    // Create write stream with UTF-8 encoding (fixes PowerShell UTF-16 issue)
    const writeStream = fs.createWriteStream(OUTPUT_PATH, { encoding: 'utf8' });

    let isFirstLine = true;
    let postcodeIndex = -1;
    let polar4Index = -1;
    let batch = [];
    let totalRows = 0;

    writeStream.write('-- Generated SQL for importing postcodes into D1\n');
    writeStream.write('-- Run with: wrangler d1 execute postcode-polar-db --remote --file=./import.sql\n\n');

    for await (const line of rl) {
        if (isFirstLine) {
            // Parse header to find column indices
            const headers = line.split(',').map(h => h.trim().toLowerCase());
            postcodeIndex = headers.findIndex(h => h === 'postcode');
            polar4Index = headers.findIndex(h => h.includes('polar4') || h === 'polar4_quintile');

            if (postcodeIndex === -1 || polar4Index === -1) {
                console.error('Error: Could not find required columns (Postcode, POLAR4_quintile)');
                console.error('Found headers:', headers);
                process.exit(1);
            }

            isFirstLine = false;
            continue;
        }

        const columns = line.split(',');
        if (columns.length <= Math.max(postcodeIndex, polar4Index)) continue;

        const postcodeDisplay = columns[postcodeIndex].trim().replace(/"/g, '');
        const postcode = postcodeDisplay.replace(/\s+/g, '').toUpperCase();
        const polar4 = parseInt(columns[polar4Index].trim().replace(/"/g, ''), 10);

        if (!postcode || isNaN(polar4)) continue;

        // Escape single quotes for SQL
        const safePostcode = postcode.replace(/'/g, "''");
        const safeDisplay = postcodeDisplay.replace(/'/g, "''");

        batch.push(`('${safePostcode}', '${safeDisplay}', ${polar4})`);
        totalRows++;

        // Write batch when full
        if (batch.length >= BATCH_SIZE) {
            writeStream.write(`INSERT INTO postcodes (postcode, postcode_display, polar4) VALUES\n`);
            writeStream.write(batch.join(',\n') + ';\n\n');
            batch = [];
        }
    }

    // Write remaining batch
    if (batch.length > 0) {
        writeStream.write(`INSERT INTO postcodes (postcode, postcode_display, polar4) VALUES\n`);
        writeStream.write(batch.join(',\n') + ';\n\n');
    }

    writeStream.write(`-- Total rows: ${totalRows}\n`);
    writeStream.end();

    console.log(`✓ Generated import.sql with ${totalRows.toLocaleString()} postcodes (UTF-8 encoded)`);
}

convertCsvToSql().catch(console.error);
