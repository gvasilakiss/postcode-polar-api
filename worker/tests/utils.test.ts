import { describe, it, expect } from 'vitest';
import { normalizePostcode, isValidPostcode, extractOutwardCode, getPolarDescription } from '../src/index';

// ============================================
// normalizePostcode
// ============================================
describe('normalizePostcode', () => {
    it('removes spaces and uppercases', () => {
        expect(normalizePostcode('AB10 1AA')).toBe('AB101AA');
    });

    it('removes multiple spaces', () => {
        expect(normalizePostcode('AB10  1AA')).toBe('AB101AA');
    });

    it('uppercases lowercase input', () => {
        expect(normalizePostcode('ab10 1aa')).toBe('AB101AA');
    });

    it('handles already normalized input', () => {
        expect(normalizePostcode('AB101AA')).toBe('AB101AA');
    });

    it('handles leading/trailing spaces', () => {
        expect(normalizePostcode(' AB10 1AA ')).toBe('AB101AA');
    });

    it('handles tabs and mixed whitespace', () => {
        expect(normalizePostcode('AB10\t1AA')).toBe('AB101AA');
    });
});

// ============================================
// isValidPostcode
// ============================================
describe('isValidPostcode', () => {
    it('accepts valid UK postcodes', () => {
        expect(isValidPostcode('AB10 1AA')).toBe(true);
        expect(isValidPostcode('SW1A 1AA')).toBe(true);
        expect(isValidPostcode('EC1A 1BB')).toBe(true);
        expect(isValidPostcode('W1A 0AX')).toBe(true);
    });

    it('accepts postcodes without spaces', () => {
        expect(isValidPostcode('AB101AA')).toBe(true);
        expect(isValidPostcode('SW1A1AA')).toBe(true);
    });

    it('accepts lowercase postcodes', () => {
        expect(isValidPostcode('ab101aa')).toBe(true);
    });

    it('rejects postcodes that are too short', () => {
        expect(isValidPostcode('AB1')).toBe(false);
        expect(isValidPostcode('AB10')).toBe(false);
    });

    it('rejects postcodes that are too long', () => {
        expect(isValidPostcode('AB10 1AAXX')).toBe(false);
    });

    it('rejects postcodes with special characters', () => {
        expect(isValidPostcode('AB10-1AA')).toBe(false);
        expect(isValidPostcode('AB10!1AA')).toBe(false);
        expect(isValidPostcode('AB10.1AA')).toBe(false);
    });

    it('rejects empty strings', () => {
        expect(isValidPostcode('')).toBe(false);
    });
});

// ============================================
// extractOutwardCode
// ============================================
describe('extractOutwardCode', () => {
    it('extracts outward code from normalized postcode', () => {
        expect(extractOutwardCode('AB101AA')).toBe('AB10');
        expect(extractOutwardCode('SW1A1AA')).toBe('SW1A');
        expect(extractOutwardCode('EC1A1BB')).toBe('EC1A');
        expect(extractOutwardCode('W1A0AX')).toBe('W1A');
    });

    it('handles short strings gracefully', () => {
        expect(extractOutwardCode('AB1')).toBe('AB1');
        expect(extractOutwardCode('AB')).toBe('AB');
        expect(extractOutwardCode('A')).toBe('A');
    });

    it('handles empty string', () => {
        expect(extractOutwardCode('')).toBe('');
    });
});

// ============================================
// getPolarDescription
// ============================================
describe('getPolarDescription', () => {
    it('returns correct description for quintile 1', () => {
        expect(getPolarDescription(1)).toContain('lowest');
        expect(getPolarDescription(1)).toContain('most disadvantaged');
    });

    it('returns correct description for quintile 5', () => {
        expect(getPolarDescription(5)).toContain('highest');
        expect(getPolarDescription(5)).toContain('most advantaged');
    });

    it('returns descriptions for all quintiles 1-5', () => {
        for (let i = 1; i <= 5; i++) {
            const desc = getPolarDescription(i);
            expect(desc).toContain(`Quintile ${i}`);
            expect(desc.length).toBeGreaterThan(10);
        }
    });

    it('returns "Unknown quintile" for invalid values', () => {
        expect(getPolarDescription(0)).toBe('Unknown quintile');
        expect(getPolarDescription(6)).toBe('Unknown quintile');
        expect(getPolarDescription(-1)).toBe('Unknown quintile');
    });
});
