import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	parseRetryAfter,
	computeBackoff,
	parseErrorBody,
	buildHeaders,
} from '../../src/internal/http.js';

describe('parseRetryAfter', () => {
	it('returns undefined for null', () => {
		expect(parseRetryAfter(null)).toBeUndefined();
	});

	it('returns undefined for empty string', () => {
		expect(parseRetryAfter('')).toBeUndefined();
	});

	it('returns 0 for "0"', () => {
		expect(parseRetryAfter('0')).toBe(0);
	});

	it('returns 5000 for "5"', () => {
		expect(parseRetryAfter('5')).toBe(5000);
	});

	it('caps at 30000ms for very large second values', () => {
		expect(parseRetryAfter('999')).toBe(30_000);
		expect(parseRetryAfter('100000')).toBe(30_000);
	});

	it('returns undefined for non-numeric, non-date strings', () => {
		expect(parseRetryAfter('abc')).toBeUndefined();
		expect(parseRetryAfter('not a date')).toBeUndefined();
	});

	it('returns 0 for past HTTP-date', () => {
		const past = new Date(Date.now() - 60_000).toUTCString();
		expect(parseRetryAfter(past)).toBe(0);
	});

	it('returns ~delta milliseconds for a future HTTP-date', () => {
		const future = new Date(Date.now() + 5_000).toUTCString();
		const result = parseRetryAfter(future);
		expect(result).toBeGreaterThan(3_000);
		expect(result).toBeLessThanOrEqual(5_000);
	});

	it('caps a very-far-future HTTP-date at 30000ms', () => {
		const farFuture = new Date(Date.now() + 60 * 60_000).toUTCString();
		expect(parseRetryAfter(farFuture)).toBe(30_000);
	});
});

describe('computeBackoff', () => {
	beforeEach(() => {
		vi.spyOn(Math, 'random').mockReturnValue(0); // jitterFactor = 0.5
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns retryAfterMs as-is when defined (no jitter)', () => {
		expect(computeBackoff(1, 500, 1000)).toBe(1000);
		expect(computeBackoff(3, 500, 250)).toBe(250);
	});

	it('returns 0 when retryAfterMs is 0 (treats falsy 0 as defined)', () => {
		expect(computeBackoff(1, 500, 0)).toBe(0);
	});

	it('applies exponential backoff when retryAfterMs is undefined', () => {
		// jitterFactor = 0.5 (Math.random mocked to 0)
		expect(computeBackoff(1, 500, undefined)).toBe(250); // 500 * 1 * 0.5
		expect(computeBackoff(2, 500, undefined)).toBe(500); // 500 * 2 * 0.5
		expect(computeBackoff(3, 500, undefined)).toBe(1000); // 500 * 4 * 0.5
	});

	it('applies maximum jitter when Math.random returns 0.999...', () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.999); // jitterFactor ≈ 1.499
		expect(computeBackoff(1, 500, undefined)).toBeCloseTo(750, -1);
	});

	it('jitter factor stays within [0.5, 1.5) for any Math.random output', () => {
		vi.restoreAllMocks();
		const samples: number[] = [];
		for (let i = 0; i < 200; i++) {
			samples.push(computeBackoff(1, 1000, undefined));
		}
		for (const d of samples) {
			expect(d).toBeGreaterThanOrEqual(500);
			expect(d).toBeLessThanOrEqual(1500);
		}
	});

	it('calls Math.random exactly once when retryAfterMs is undefined', () => {
		const spy = vi.spyOn(Math, 'random').mockReturnValue(0.25);
		computeBackoff(2, 500, undefined);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('does not call Math.random when retryAfterMs is defined', () => {
		const spy = vi.spyOn(Math, 'random');
		computeBackoff(2, 500, 1000);
		expect(spy).not.toHaveBeenCalled();
	});
});

describe('parseErrorBody', () => {
	it('extracts code and message from a complete JSON body', () => {
		const result = parseErrorBody(
			'{"code":"VALIDATION_ERROR","message":"data is required"}',
			400,
		);
		expect(result).toEqual({ code: 'VALIDATION_ERROR', message: 'data is required' });
	});

	it('falls back to message as code when code is absent', () => {
		const result = parseErrorBody('{"message":"something broke"}', 400);
		expect(result).toEqual({ code: 'something broke', message: 'something broke' });
	});

	it('falls back to error field as code when code and message absent', () => {
		const result = parseErrorBody('{"error":"oops"}', 400);
		expect(result).toEqual({ code: 'oops', message: 'API error (400): oops' });
	});

	it('returns unknown_error code when JSON has no recognised fields', () => {
		const result = parseErrorBody('{}', 400);
		expect(result).toEqual({
			code: 'unknown_error',
			message: 'API error (400): unknown_error',
		});
	});

	it('returns INTERNAL_ERROR when body is not valid JSON', () => {
		const result = parseErrorBody('not json', 502);
		expect(result).toEqual({
			code: 'INTERNAL_ERROR',
			message: 'API error 502: response body was not valid JSON',
		});
	});

	it('returns INTERNAL_ERROR for HTML error pages', () => {
		const result = parseErrorBody('<html>upstream gone</html>', 502);
		expect(result.code).toBe('INTERNAL_ERROR');
		expect(result.message).toContain('502');
	});

	it('returns INTERNAL_ERROR for empty body', () => {
		const result = parseErrorBody('', 500);
		expect(result.code).toBe('INTERNAL_ERROR');
	});
});

describe('buildHeaders', () => {
	const ua = 'poli-page-sdk-node/1.0.0';

	it('sets Accept: application/pdf for /v1/render/pdf', () => {
		const h = buildHeaders('POST', '/v1/render/pdf', 'pp_test_x', 'idem-1', ua);
		expect(h.Accept).toBe('application/pdf');
	});

	it('sets Accept: application/json for /v1/render/preview', () => {
		const h = buildHeaders('POST', '/v1/render/preview', 'pp_test_x', 'idem-1', ua);
		expect(h.Accept).toBe('application/json');
	});

	it('sets Accept: application/json for /v1/render/thumbnails', () => {
		const h = buildHeaders('POST', '/v1/documents/doc_x/thumbnails', 'pp_test_x', 'idem-1', ua);
		expect(h.Accept).toBe('application/json');
	});

	it('always sets Content-Type: application/json', () => {
		const h = buildHeaders('POST', '/v1/render/pdf', 'pp_test_x', 'idem-1', ua);
		expect(h['Content-Type']).toBe('application/json');
	});

	it('sets Authorization with Bearer prefix', () => {
		const h = buildHeaders('POST', '/v1/render/pdf', 'pp_test_xyz', 'idem-1', ua);
		expect(h.Authorization).toBe('Bearer pp_test_xyz');
	});

	it('sets the supplied User-Agent verbatim', () => {
		const h = buildHeaders('POST', '/v1/render/pdf', 'pp_test_x', 'idem-1', 'custom-ua/9.9.9');
		expect(h['User-Agent']).toBe('custom-ua/9.9.9');
	});

	it('sets the Idempotency-Key header from the argument', () => {
		const h = buildHeaders('POST', '/v1/render/pdf', 'pp_test_x', 'idem-abc-123', ua);
		expect(h['Idempotency-Key']).toBe('idem-abc-123');
	});

	it('GET requests omit Content-Type and Idempotency-Key but keep auth/UA/Accept', () => {
		const h = buildHeaders('GET', '/v1/documents/doc_123', 'pp_test_x', undefined, ua);
		expect(h['Content-Type']).toBeUndefined();
		expect(h['Idempotency-Key']).toBeUndefined();
		expect(h.Authorization).toBe('Bearer pp_test_x');
		expect(h['User-Agent']).toBe(ua);
		expect(h.Accept).toBe('application/json');
	});
});
