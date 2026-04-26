import { describe, expect, it } from 'vitest';
import { PoliPage, PoliPageError } from '../src/index.js';

describe('PoliPage client', () => {
	it('constructs with a valid API key', () => {
		const client = new PoliPage({ apiKey: 'pp_test_dummy' });
		expect(client).toBeInstanceOf(PoliPage);
	});

	it('throws when apiKey is missing', () => {
		expect(() => new PoliPage({ apiKey: '' })).toThrow(PoliPageError);
	});
});
