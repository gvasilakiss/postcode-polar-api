-- Schema for postcode POLAR4 data
CREATE TABLE IF NOT EXISTS postcodes (
    postcode TEXT PRIMARY KEY,
    postcode_display TEXT NOT NULL,
    polar4 INTEGER NOT NULL
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_postcodes_postcode ON postcodes(postcode);
