// ============================================
// Environment & D1 Bindings
// ============================================

export interface Env {
    DB: D1Database;
    ALLOWED_ORIGINS?: string; // comma-separated allowed CORS origins
    API_KEY?: string;         // optional API key for private usage
    DATA_VERSION?: string;    // data version for cache busting (e.g., "2025.1")
}

// ============================================
// Database Row Types
// ============================================

export interface PostcodeRow {
    postcode: string;
    postcode_display: string;
    polar4: number;
    polar3: number | null;
    tundra_msoa: string | null;
    tundra_lsoa: string | null;
    adult_he: number | null;
    msoa_name: string | null;
    lsoa_name: string | null;
    country: string | null;
    status: string | null;
}

// ============================================
// API Response Types
// ============================================

export interface PostcodeResponse {
    success: true;
    postcode: string;
    polar4: number;
    polar_description: string;
    match_type?: 'exact' | 'approximate';
}

export interface ExtendedPostcodeResponse extends PostcodeResponse {
    polar3: number | null;
    tundra_msoa: string | null;
    tundra_lsoa: string | null;
    adult_he: number | null;
    msoa_name: string | null;
    lsoa_name: string | null;
    country: string | null;
    status: string | null;
}

export interface BatchResult {
    postcode: string;
    found: boolean;
    polar4?: number;
    polar_description?: string;
    // Extended fields (when ?include=extended)
    polar3?: number | null;
    tundra_msoa?: string | null;
    tundra_lsoa?: string | null;
    adult_he?: number | null;
    msoa_name?: string | null;
    lsoa_name?: string | null;
    country?: string | null;
    status?: string | null;
}

export interface BatchResponse {
    success: true;
    results: BatchResult[];
    total: number;
    found: number;
    not_found: number;
}

export interface ErrorResponse {
    success: false;
    error: string;
    message?: string;
    searched?: string;
}

export interface SearchResult {
    postcode: string;
    polar4: number;
    polar_description: string;
}
