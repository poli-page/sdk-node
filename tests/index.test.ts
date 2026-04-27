import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { PoliPage, PoliPageError } from '../src/index.js';

let server: Server;
let baseUrl: string;
let lastRequest: { method: string; path: string; headers: Record<string, string>; body: string };
let mockHandler: (req: IncomingMessage, res: ServerResponse) => void;

function setMockHandler(handler: typeof mockHandler) {
	mockHandler = handler;
}

function defaultHandler(_req: IncomingMessage, res: ServerResponse) {
	res.writeHead(200, { 'Content-Type': 'application/pdf' });
	res.end(Buffer.from('%PDF-1.4 test'));
}

beforeAll(async () => {
	mockHandler = defaultHandler;
	server = createServer((req, res) => {
		let body = '';
		req.on('data', (chunk) => (body += chunk));
		req.on('end', () => {
			lastRequest = {
				method: req.method ?? '',
				path: req.url ?? '',
				headers: req.headers as Record<string, string>,
				body,
			};
			mockHandler(req, res);
		});
	});
	await new Promise<void>((resolve) => {
		server.listen(0, () => resolve());
	});
	const addr = server.address();
	if (typeof addr === 'object' && addr) {
		baseUrl = `http://localhost:${addr.port}`;
	}
});

afterEach(() => {
	mockHandler = defaultHandler;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('PoliPage SDK', () => {
	describe('constructor', () => {
		it('throws PoliPageError with code "invalid_options" when apiKey is missing', () => {
			expect(() => new PoliPage({ apiKey: '' })).toThrowError(
				expect.objectContaining({ name: 'PoliPageError', code: 'invalid_options' }),
			);
		});

		it('accepts a custom baseUrl', () => {
			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			expect(client).toBeInstanceOf(PoliPage);
		});
	});

	describe('render()', () => {
		it('returns a PDF buffer', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			const pdf = await client.render({
				template: '<div>{{ name }}</div>',
				data: { name: 'Test' },
			});
			expect(Buffer.isBuffer(pdf)).toBe(true);
			expect(pdf.toString().startsWith('%PDF')).toBe(true);
		});

		it('sends Authorization header with Bearer token', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_xyz', baseUrl });
			await client.render({ template: '<p>hi</p>', data: {} });
			expect(lastRequest.headers.authorization).toBe('Bearer pp_test_xyz');
		});

		it('sends template, data, format, and orientation', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			await client.render({
				template: '<p>{{ x }}</p>',
				data: { x: 1 },
				format: 'A5',
				orientation: 'landscape',
			});
			const body = JSON.parse(lastRequest.body);
			expect(body.template).toBe('<p>{{ x }}</p>');
			expect(body.data).toEqual({ x: 1 });
			expect(body.format).toBe('A5');
			expect(body.orientation).toBe('landscape');
		});

		it('supports project + template slug mode', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			await client.render({
				project: 'billing',
				template: 'invoice',
				data: { amount: 100 },
			});
			const body = JSON.parse(lastRequest.body);
			expect(body.project).toBe('billing');
			expect(body.template).toBe('invoice');
		});

		it('throws PoliPageError on API errors', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ message: 'MISSING_DATA' }));
			});

			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			await expect(client.render({ template: '<p>x</p>', data: {} })).rejects.toBeInstanceOf(
				PoliPageError,
			);
		});

		it('includes status code in PoliPageError', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(401, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ code: 'invalid_api_key', message: 'API key invalid' }));
			});

			const client = new PoliPage({ apiKey: 'pp_test_bad', baseUrl });
			try {
				await client.render({ template: '<p>x</p>', data: {} });
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(PoliPageError);
				expect((error as PoliPageError).status).toBe(401);
				expect((error as PoliPageError).code).toBe('invalid_api_key');
			}
		});

		it('captures x-request-id header in PoliPageError', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(500, {
					'Content-Type': 'application/json',
					'x-request-id': 'req_abc123',
				});
				res.end(JSON.stringify({ code: 'internal_error', message: 'boom' }));
			});

			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl, maxRetries: 0 });
			try {
				await client.render({ template: '<p>x</p>', data: {} });
				expect.fail('Should have thrown');
			} catch (error) {
				expect((error as PoliPageError).requestId).toBe('req_abc123');
			}
		});

		it('maps non-2xx HTML body to PoliPageError with code INTERNAL_ERROR and HTTP status', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(502, { 'Content-Type': 'text/html' });
				res.end('<html>upstream gone</html>');
			});
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 0 });
			await expect(client.render({ template: '<p>x</p>', data: {} })).rejects.toMatchObject({
				name: 'PoliPageError',
				code: 'INTERNAL_ERROR',
				status: 502,
			});
		});

		it('rejects 2xx render response if Content-Type is not application/pdf', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'text/html' });
				res.end('<html>oops</html>');
			});
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 0 });
			await expect(client.render({ template: '<p>x</p>', data: {} })).rejects.toMatchObject({
				name: 'PoliPageError',
				code: 'INTERNAL_ERROR',
			});
		});
	});

	describe('renderToFile()', () => {
		it('writes the PDF to disk', async () => {
			const { mkdtemp, readFile, rm } = await import('node:fs/promises');
			const { tmpdir } = await import('node:os');
			const { join } = await import('node:path');

			const tempDir = await mkdtemp(join(tmpdir(), 'poli-sdk-'));
			const outputPath = join(tempDir, 'test.pdf');

			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			await client.renderToFile({ template: '<p>hi</p>', data: {} }, outputPath);

			const content = await readFile(outputPath);
			expect(content.toString().startsWith('%PDF')).toBe(true);

			await rm(tempDir, { recursive: true, force: true });
		});
	});

	describe('preview()', () => {
		it('returns html and totalPages', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ html: '<div>page 1</div>', totalPages: 2 }));
			});

			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			const result = await client.preview({ template: '<p>hi</p>', data: {} });
			expect(result.html).toContain('page 1');
			expect(result.totalPages).toBe(2);
		});

		it('POSTs to /v1/render/preview', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ html: '', totalPages: 1 }));
			});

			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			await client.preview({ template: '<p>x</p>', data: {} });
			expect(lastRequest.path).toBe('/v1/render/preview');
		});
	});

	describe('thumbnails()', () => {
		it('returns an array of thumbnails', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({
						thumbnails: [
							{
								page: 1,
								width: 210,
								height: 297,
								contentType: 'image/png',
								data: 'base64...',
							},
						],
					}),
				);
			});

			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			const result = await client.thumbnails({ template: '<p>x</p>', data: {} }, { width: 400 });
			expect(result).toHaveLength(1);
			expect(result[0].page).toBe(1);
		});

		it('sends quality option in payload', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ thumbnails: [] }));
			});

			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			await client.thumbnails(
				{ template: '<p>x</p>', data: {} },
				{ width: 400, quality: 90 },
			);
			const body = JSON.parse(lastRequest.body);
			expect(body.thumbnails.quality).toBe(90);
		});

		it('sends page option to request a single page', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ thumbnails: [] }));
			});

			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			await client.thumbnails({ template: '<p>x</p>', data: {} }, { width: 400, page: 2 });
			const body = JSON.parse(lastRequest.body);
			expect(body.thumbnails.page).toBe(2);
		});

		it('sends pages option to request multiple pages', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ thumbnails: [] }));
			});

			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			await client.thumbnails(
				{ template: '<p>x</p>', data: {} },
				{ width: 400, pages: [1, 3, 5] },
			);
			const body = JSON.parse(lastRequest.body);
			expect(body.thumbnails.pages).toEqual([1, 3, 5]);
		});
	});

	describe('HTTP transport headers', () => {
		it('sends User-Agent header in the form poli-page-sdk-node/<version>', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
			await client.render({ template: '<p>x</p>', data: {} });
			const ua = lastRequest.headers['user-agent'];
			expect(ua).toMatch(/^poli-page-sdk-node\/\d+\.\d+\.\d+/);
		});

		it('sends Accept: application/pdf for render', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
			await client.render({ template: '<p>x</p>', data: {} });
			expect(lastRequest.headers.accept).toBe('application/pdf');
		});

		it('sends Accept: application/json for preview', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ html: '', totalPages: 1 }));
			});
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
			await client.preview({ template: '<p>x</p>', data: {} });
			expect(lastRequest.headers.accept).toBe('application/json');
		});

		it('sends Accept: application/json for thumbnails', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ thumbnails: [] }));
			});
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
			await client.thumbnails({ template: '<p>x</p>', data: {} }, { width: 200 });
			expect(lastRequest.headers.accept).toBe('application/json');
		});

		it('sends Content-Type: application/json on every POST', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
			await client.render({ template: '<p>x</p>', data: {} });
			expect(lastRequest.headers['content-type']).toBe('application/json');
		});
	});

	describe('retry logic', () => {
		it('retries on 500 errors', async () => {
			let attempts = 0;
			setMockHandler((_req, res) => {
				attempts++;
				if (attempts < 3) {
					res.writeHead(500, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ code: 'internal_error' }));
				} else {
					res.writeHead(200, { 'Content-Type': 'application/pdf' });
					res.end(Buffer.from('%PDF-1.4 ok'));
				}
			});

			const client = new PoliPage({
				apiKey: 'pp_test_abc',
				baseUrl,
				maxRetries: 3,
				retryDelay: 10,
			});
			const pdf = await client.render({ template: '<p>x</p>', data: {} });
			expect(attempts).toBe(3);
			expect(Buffer.isBuffer(pdf)).toBe(true);
		});

		it('does not retry on 4xx errors', async () => {
			let attempts = 0;
			setMockHandler((_req, res) => {
				attempts++;
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ code: 'bad_request' }));
			});

			const client = new PoliPage({
				apiKey: 'pp_test_abc',
				baseUrl,
				maxRetries: 3,
				retryDelay: 10,
			});
			await expect(client.render({ template: '<p>x</p>', data: {} })).rejects.toThrow();
			expect(attempts).toBe(1);
		});

		it('honors Retry-After header in seconds (uses it instead of exponential backoff)', async () => {
			let attempts = 0;
			const startTimes: number[] = [];
			setMockHandler((_req, res) => {
				startTimes.push(Date.now());
				attempts++;
				if (attempts < 2) {
					res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '0' });
					res.end(JSON.stringify({ code: 'unavailable' }));
				} else {
					res.writeHead(200, { 'Content-Type': 'application/pdf' });
					res.end(Buffer.from('%PDF-1.4 ok'));
				}
			});
			const client = new PoliPage({
				apiKey: 'pp_test_x',
				baseUrl,
				maxRetries: 2,
				retryDelay: 10_000, // would make exponential backoff at least 10s — but Retry-After: 0 should override
			});
			const t0 = Date.now();
			await client.render({ template: '<p>x</p>', data: {} });
			const elapsed = Date.now() - t0;
			expect(elapsed).toBeLessThan(500); // Retry-After: 0 → immediate retry
		});

		it('caps Retry-After at 30 seconds', async () => {
			// parseRetryAfter is module-private; we verify the cap behaviorally via vi.spyOn.
			// We spy on globalThis.setTimeout to observe the delay the SDK schedules,
			// then check it equals 30_000 (the cap), without waiting the full 30s.
			const { vi } = await import('vitest');
			const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

			setMockHandler((_req, res) => {
				// Always return 503 with Retry-After: 999 — the SDK should cap it at 30s.
				res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '999' });
				res.end(JSON.stringify({ code: 'unavailable' }));
			});

			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 1 });
			const promise = client.render({ template: '<p>x</p>', data: {} });
			// Suppress the unhandled rejection — the promise will reject in ~30s.
			promise.catch(() => {});

			// Give the SDK ~150ms to receive the 503, parse Retry-After, and schedule the retry timer.
			await new Promise((r) => setTimeout(r, 150));

			const delays = setTimeoutSpy.mock.calls
				.map((c) => c[1] as number)
				.filter((d) => d === 30_000);
			expect(delays.length).toBeGreaterThan(0);

			setTimeoutSpy.mockRestore();
			// The dangling promise will reject after 30s, but the test finishes here.
		});

		it('parses Retry-After in HTTP-date format', async () => {
			// Integration: verify the SDK accepts HTTP-date format for Retry-After.
			// Use a past-dated HTTP-date (0ms delay) so the test stays fast.
			let attempts = 0;
			setMockHandler((_req, res) => {
				attempts++;
				if (attempts < 2) {
					const immediateDate = new Date(Date.now() - 1_000).toUTCString();
					res.writeHead(503, {
						'Content-Type': 'application/json',
						'Retry-After': immediateDate,
					});
					res.end(JSON.stringify({ code: 'unavailable' }));
				} else {
					res.writeHead(200, { 'Content-Type': 'application/pdf' });
					res.end(Buffer.from('%PDF-1.4 ok'));
				}
			});
			const client = new PoliPage({
				apiKey: 'pp_test_x',
				baseUrl,
				maxRetries: 2,
				retryDelay: 10_000, // big — past-dated Retry-After (0ms) should override
			});
			const t0 = Date.now();
			await client.render({ template: '<p>x</p>', data: {} });
			expect(Date.now() - t0).toBeLessThan(500);
			expect(attempts).toBe(2);
		});

		it('retries on 429 with Retry-After delay', async () => {
			let attempts = 0;
			setMockHandler((_req, res) => {
				attempts++;
				if (attempts < 2) {
					res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' });
					res.end(JSON.stringify({ code: 'rate_limited' }));
				} else {
					res.writeHead(200, { 'Content-Type': 'application/pdf' });
					res.end(Buffer.from('%PDF-1.4 ok'));
				}
			});
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 2, retryDelay: 10 });
			const pdf = await client.render({ template: '<p>x</p>', data: {} });
			expect(attempts).toBe(2);
			expect(Buffer.isBuffer(pdf)).toBe(true);
		});

		it('treats past-dated Retry-After as immediate retry', async () => {
			const pastDate = new Date(Date.now() - 60_000).toUTCString();
			let attempts = 0;
			setMockHandler((_req, res) => {
				attempts++;
				if (attempts < 2) {
					res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': pastDate });
					res.end(JSON.stringify({ code: 'unavailable' }));
				} else {
					res.writeHead(200, { 'Content-Type': 'application/pdf' });
					res.end(Buffer.from('%PDF-1.4 ok'));
				}
			});
			const client = new PoliPage({
				apiKey: 'pp_test_x',
				baseUrl,
				maxRetries: 2,
				retryDelay: 10_000, // big — should be skipped because Retry-After is present (even if past-dated)
			});
			const t0 = Date.now();
			await client.render({ template: '<p>x</p>', data: {} });
			const elapsed = Date.now() - t0;
			expect(elapsed).toBeLessThan(500);
		});

		it('applies jitter to exponential backoff (delay falls in [0.5×, 1.5×])', async () => {
			const { vi } = await import('vitest');
			const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

			let attempts = 0;
			setMockHandler((_req, res) => {
				attempts++;
				if (attempts < 2) {
					res.writeHead(503, { 'Content-Type': 'application/json' }); // no Retry-After
					res.end(JSON.stringify({ code: 'unavailable' }));
				} else {
					res.writeHead(200, { 'Content-Type': 'application/pdf' });
					res.end(Buffer.from('%PDF-1.4 ok'));
				}
			});

			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 2, retryDelay: 100 });
			await client.render({ template: '<p>x</p>', data: {} });

			// Find the backoff delay among setTimeout calls (filter to range we expect)
			const delays = setTimeoutSpy.mock.calls
				.map((c) => c[1] as number)
				.filter((d) => d >= 50 && d <= 150);
			expect(delays.length).toBeGreaterThan(0);
			const d = delays[0];
			expect(d).toBeGreaterThanOrEqual(50); // 100 × 0.5
			expect(d).toBeLessThanOrEqual(150); // 100 × 1.5

			setTimeoutSpy.mockRestore();
		});

		it('does not apply jitter when Retry-After is present', async () => {
			const { vi } = await import('vitest');
			const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

			let attempts = 0;
			setMockHandler((_req, res) => {
				attempts++;
				if (attempts < 2) {
					res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '0' });
					res.end(JSON.stringify({ code: 'unavailable' }));
				} else {
					res.writeHead(200, { 'Content-Type': 'application/pdf' });
					res.end(Buffer.from('%PDF-1.4 ok'));
				}
			});

			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 2 });
			await client.render({ template: '<p>x</p>', data: {} });

			// The delay should be exactly 0 (server-explicit Retry-After: 0, no jitter)
			const has0 = setTimeoutSpy.mock.calls.some((c) => c[1] === 0);
			expect(has0).toBe(true);

			setTimeoutSpy.mockRestore();
		});
	});
});
