-- Schema for postcode POLAR4 data (expanded with TUNDRA, Adult HE, geography)
DROP TABLE IF EXISTS postcodes;

CREATE TABLE postcodes (
    postcode TEXT PRIMARY KEY,
    postcode_display TEXT NOT NULL,
    polar4 INTEGER NOT NULL,
    polar3 INTEGER,
    tundra_msoa TEXT,
    tundra_lsoa TEXT,
    adult_he INTEGER,
    msoa_name TEXT,
    lsoa_name TEXT,
    country TEXT,
    status TEXT
);

-- Index for fast exact lookups (primary key already indexed)
CREATE INDEX IF NOT EXISTS idx_postcodes_outward ON postcodes(substr(postcode, 1, 4));
CREATE INDEX IF NOT EXISTS idx_postcodes_country ON postcodes(country);
