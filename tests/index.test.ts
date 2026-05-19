import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { PoliPage, PoliPageError } from '../src/index.js';

let server: Server;
let baseUrl: string;
let lastRequest: { method: string; path: string; headers: Record<string, string>; body: string };
/**
 * The most recent `/v1/render` POST captured by the mock server, broken out
 * separately from `lastRequest` because `render.pdf` makes a second HTTP call
 * (the presigned-URL PDF fetch) that would otherwise overwrite `lastRequest`
 * before assertions run.
 */
let renderRequest:
	| { headers: Record<string, string>; body: string }
	| undefined;
let renderRequestBody: string | undefined;
let mockHandler: (req: IncomingMessage, res: ServerResponse) => void;

function setMockHandler(handler: typeof mockHandler) {
	mockHandler = handler;
}

/**
 * Stub descriptor used by the default handler. Fields match the wire shape
 * required by `RawDocumentDescriptor` in src/types.ts.
 */
const sampleDescriptor = {
	documentId: 'doc_default',
	organizationId: 'org_x',
	projectId: 'proj_p',
	projectSlug: 'p',
	templateId: 'tpl_t',
	templateSlug: 't',
	version: '1.0.0',
	environment: 'sandbox',
	apiKeyId: 'key_x',
	format: 'A4',
	orientation: 'portrait',
	locale: 'en-US',
	pageCount: 1,
	sizeBytes: 100,
	createdAt: '2026-01-01T00:00:00Z',
	metadata: {},
	expiresAt: '2026-01-01T00:15:00Z',
};

/**
 * Routing default handler for the two-call render flow. POST /v1/render
 * returns a JSON descriptor pointing at /presigned/default.pdf; the
 * presigned URL returns PDF bytes. Preview, documents.get, and documents.delete
 * are also routed here so tests that don't override the handler still work.
 */
function defaultHandler(req: IncomingMessage, res: ServerResponse) {
	if (req.url === '/v1/render') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({
				...sampleDescriptor,
				presignedPdfUrl: `${baseUrl}/presigned/default.pdf`,
			}),
		);
		return;
	}
	if (req.url?.startsWith('/presigned/')) {
		res.writeHead(200, { 'Content-Type': 'application/pdf' });
		res.end(Buffer.from('%PDF-1.4 test'));
		return;
	}
	if (req.url === '/v1/render/preview') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ html: '', totalPages: 1, environment: 'sandbox' }));
		return;
	}
	if (req.url?.startsWith('/v1/documents/')) {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({
				...sampleDescriptor,
				presignedPdfUrl: `${baseUrl}/presigned/default.pdf`,
			}),
		);
		return;
	}
	res.writeHead(404);
	res.end();
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
			if (req.url === '/v1/render' && req.method === 'POST') {
				renderRequest = {
					headers: req.headers as Record<string, string>,
					body,
				};
				renderRequestBody = body;
			}
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
	renderRequest = undefined;
	renderRequestBody = undefined;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

/**
 * Write a 200 descriptor JSON response on the given ServerResponse, pointing
 * at the test server's `/presigned/ok.pdf` URL. Used by retry-success tests
 * once their fail-counter has been exhausted.
 */
function respondDescriptor(res: ServerResponse) {
	res.writeHead(200, { 'Content-Type': 'application/json' });
	res.end(
		JSON.stringify({
			...sampleDescriptor,
			presignedPdfUrl: `${baseUrl}/presigned/ok.pdf`,
		}),
	);
}

/**
 * Write a 200 PDF response on the given ServerResponse. Used by retry-success
 * tests to serve the presigned-URL fetch leg of the two-call render flow.
 */
function respondPdf(res: ServerResponse) {
	res.writeHead(200, { 'Content-Type': 'application/pdf' });
	res.end(Buffer.from('%PDF-1.4 ok'));
}

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

<<<<<<< HEAD
	describe('render.pdf()', () => {
=======
	describe('render()', () => {
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
		it('returns a PDF Uint8Array', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			const pdf = await client.render.pdf({
				project: 'p',
				template: 't',
				version: '1.0.0',
				data: { name: 'Test' },
			});
			expect(pdf).toBeInstanceOf(Uint8Array);
			expect(new TextDecoder().decode(pdf.subarray(0, 4))).toBe('%PDF');
		});

		it('sends Authorization header with Bearer token', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_xyz', baseUrl });
			await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
			expect(renderRequest!.headers.authorization).toBe('Bearer pp_test_xyz');
		});

		it('sends template, data, format, and orientation', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			await client.render.pdf({
				project: 'p',
				template: 't',
				version: '1.0.0',
				data: { x: 1 },
				format: 'A5',
				orientation: 'landscape',
			});
			const body = JSON.parse(renderRequestBody!);
			expect(body.template).toBe('t');
			expect(body.data).toEqual({ x: 1 });
			expect(body.format).toBe('A5');
			expect(body.orientation).toBe('landscape');
		});

		it('supports project + template slug mode', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			await client.render.pdf({
				project: 'billing',
				template: 'invoice',
				version: '1.0.0',
				data: { amount: 100 },
			});
			const body = JSON.parse(renderRequestBody!);
			expect(body.project).toBe('billing');
			expect(body.template).toBe('invoice');
		});

		it('throws PoliPageError on API errors', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ message: 'MISSING_DATA' }));
			});

			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			await expect(client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} })).rejects.toBeInstanceOf(
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
				await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
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
				await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
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
<<<<<<< HEAD
			await expect(client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} })).rejects.toMatchObject({
=======
			await expect(client.render({ template: '<p>x</p>', data: {} })).rejects.toMatchObject({
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
				name: 'PoliPageError',
				code: 'INTERNAL_ERROR',
				status: 502,
			});
<<<<<<< HEAD
=======
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
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
		});

	});

	describe('render.preview()', () => {
		it('returns html and totalPages', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ html: '<div>page 1</div>', totalPages: 2 }));
			});

			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			const result = await client.render.preview({ template: '<p>hi</p>', data: {} });
			expect(result.html).toContain('page 1');
			expect(result.totalPages).toBe(2);
		});

		it('POSTs to /v1/render/preview', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ html: '', totalPages: 1 }));
			});

			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			await client.render.preview({ project: 'p', template: 't', version: '1.0.0', data: {} });
			expect(lastRequest.path).toBe('/v1/render/preview');
		});
	});

	describe('HTTP transport headers', () => {
		it('sends User-Agent header in the form poli-page-sdk-node/<version>', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
			await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
			const ua = renderRequest!.headers['user-agent'];
			expect(ua).toMatch(/^poli-page-sdk-node\/\d+\.\d+\.\d+/);
		});

		it('sends Accept: application/json for render (descriptor endpoint returns JSON)', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
			await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
			expect(renderRequest!.headers.accept).toBe('application/json');
		});

		it('sends Accept: application/json for preview', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ html: '', totalPages: 1, environment: 'sandbox' }));
			});
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
			await client.render.preview({ project: 'p', template: 't', version: '1.0.0', data: {} });
			expect(lastRequest.headers.accept).toBe('application/json');
		});

		it('sends Content-Type: application/json on every POST', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
			await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
			expect(renderRequest!.headers['content-type']).toBe('application/json');
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
			setMockHandler((req, res) => {
				if (req.url?.startsWith('/presigned/')) {
					res.writeHead(200, { 'Content-Type': 'application/pdf' });
					res.end(Buffer.from('%PDF-1.4 ok'));
					return;
				}
				attempts++;
				if (attempts < 3) {
					res.writeHead(500, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ code: 'internal_error' }));
				} else {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({
							...sampleDescriptor,
							presignedPdfUrl: `${baseUrl}/presigned/ok.pdf`,
						}),
					);
				}
			});

			const client = new PoliPage({
				apiKey: 'pp_test_abc',
				baseUrl,
				maxRetries: 3,
				retryDelay: 10,
			});
			const pdf = await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
			expect(attempts).toBe(3);
			expect(pdf).toBeInstanceOf(Uint8Array);
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
			await expect(client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} })).rejects.toThrow();
			expect(attempts).toBe(1);
		});

		it('honors Retry-After header in seconds (uses it instead of exponential backoff)', async () => {
			let attempts = 0;
			const startTimes: number[] = [];
<<<<<<< HEAD
			setMockHandler((req, res) => {
				if (req.url?.startsWith('/presigned/')) {
					respondPdf(res);
					return;
				}
=======
			setMockHandler((_req, res) => {
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
				startTimes.push(Date.now());
				attempts++;
				if (attempts < 2) {
					res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '0' });
					res.end(JSON.stringify({ code: 'unavailable' }));
				} else {
<<<<<<< HEAD
					respondDescriptor(res);
=======
					res.writeHead(200, { 'Content-Type': 'application/pdf' });
					res.end(Buffer.from('%PDF-1.4 ok'));
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
				}
			});
			const client = new PoliPage({
				apiKey: 'pp_test_x',
				baseUrl,
				maxRetries: 2,
				retryDelay: 10_000, // would make exponential backoff at least 10s — but Retry-After: 0 should override
			});
			const t0 = Date.now();
<<<<<<< HEAD
			await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
=======
			await client.render({ template: '<p>x</p>', data: {} });
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
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
<<<<<<< HEAD
			const promise = client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
=======
			const promise = client.render({ template: '<p>x</p>', data: {} });
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
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
<<<<<<< HEAD
			setMockHandler((req, res) => {
				if (req.url?.startsWith('/presigned/')) {
					respondPdf(res);
					return;
				}
=======
			setMockHandler((_req, res) => {
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
				attempts++;
				if (attempts < 2) {
					const immediateDate = new Date(Date.now() - 1_000).toUTCString();
					res.writeHead(503, {
						'Content-Type': 'application/json',
						'Retry-After': immediateDate,
					});
					res.end(JSON.stringify({ code: 'unavailable' }));
				} else {
<<<<<<< HEAD
					respondDescriptor(res);
=======
					res.writeHead(200, { 'Content-Type': 'application/pdf' });
					res.end(Buffer.from('%PDF-1.4 ok'));
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
				}
			});
			const client = new PoliPage({
				apiKey: 'pp_test_x',
				baseUrl,
				maxRetries: 2,
				retryDelay: 10_000, // big — past-dated Retry-After (0ms) should override
			});
			const t0 = Date.now();
<<<<<<< HEAD
			await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
=======
			await client.render({ template: '<p>x</p>', data: {} });
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			expect(Date.now() - t0).toBeLessThan(500);
			expect(attempts).toBe(2);
		});

		it('retries on 429 with Retry-After delay', async () => {
			let attempts = 0;
<<<<<<< HEAD
			setMockHandler((req, res) => {
				if (req.url?.startsWith('/presigned/')) {
					respondPdf(res);
					return;
				}
=======
			setMockHandler((_req, res) => {
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
				attempts++;
				if (attempts < 2) {
					res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' });
					res.end(JSON.stringify({ code: 'rate_limited' }));
				} else {
<<<<<<< HEAD
					respondDescriptor(res);
				}
			});
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 2, retryDelay: 10 });
			const pdf = await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
=======
					res.writeHead(200, { 'Content-Type': 'application/pdf' });
					res.end(Buffer.from('%PDF-1.4 ok'));
				}
			});
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 2, retryDelay: 10 });
			const pdf = await client.render({ template: '<p>x</p>', data: {} });
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			expect(attempts).toBe(2);
			expect(pdf).toBeInstanceOf(Uint8Array);
		});

		it('treats past-dated Retry-After as immediate retry', async () => {
			const pastDate = new Date(Date.now() - 60_000).toUTCString();
			let attempts = 0;
<<<<<<< HEAD
			setMockHandler((req, res) => {
				if (req.url?.startsWith('/presigned/')) {
					respondPdf(res);
					return;
				}
=======
			setMockHandler((_req, res) => {
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
				attempts++;
				if (attempts < 2) {
					res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': pastDate });
					res.end(JSON.stringify({ code: 'unavailable' }));
				} else {
<<<<<<< HEAD
					respondDescriptor(res);
=======
					res.writeHead(200, { 'Content-Type': 'application/pdf' });
					res.end(Buffer.from('%PDF-1.4 ok'));
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
				}
			});
			const client = new PoliPage({
				apiKey: 'pp_test_x',
				baseUrl,
				maxRetries: 2,
				retryDelay: 10_000, // big — should be skipped because Retry-After is present (even if past-dated)
			});
			const t0 = Date.now();
<<<<<<< HEAD
			await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
=======
			await client.render({ template: '<p>x</p>', data: {} });
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			const elapsed = Date.now() - t0;
			expect(elapsed).toBeLessThan(500);
		});

		it('applies jitter to exponential backoff (delay falls in [0.5×, 1.5×])', async () => {
			const { vi } = await import('vitest');
			const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

			let attempts = 0;
<<<<<<< HEAD
			setMockHandler((req, res) => {
				if (req.url?.startsWith('/presigned/')) {
					respondPdf(res);
					return;
				}
=======
			setMockHandler((_req, res) => {
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
				attempts++;
				if (attempts < 2) {
					res.writeHead(503, { 'Content-Type': 'application/json' }); // no Retry-After
					res.end(JSON.stringify({ code: 'unavailable' }));
				} else {
<<<<<<< HEAD
					respondDescriptor(res);
=======
					res.writeHead(200, { 'Content-Type': 'application/pdf' });
					res.end(Buffer.from('%PDF-1.4 ok'));
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
				}
			});

			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 2, retryDelay: 100 });
<<<<<<< HEAD
			await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
=======
			await client.render({ template: '<p>x</p>', data: {} });
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17

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
<<<<<<< HEAD
			setMockHandler((req, res) => {
				if (req.url?.startsWith('/presigned/')) {
					respondPdf(res);
					return;
				}
=======
			setMockHandler((_req, res) => {
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
				attempts++;
				if (attempts < 2) {
					res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '0' });
					res.end(JSON.stringify({ code: 'unavailable' }));
				} else {
<<<<<<< HEAD
					respondDescriptor(res);
=======
					res.writeHead(200, { 'Content-Type': 'application/pdf' });
					res.end(Buffer.from('%PDF-1.4 ok'));
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
				}
			});

			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 2 });
<<<<<<< HEAD
			await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
=======
			await client.render({ template: '<p>x</p>', data: {} });
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17

			// The delay should be exactly 0 (server-explicit Retry-After: 0, no jitter)
			const has0 = setTimeoutSpy.mock.calls.some((c) => c[1] === 0);
			expect(has0).toBe(true);

			setTimeoutSpy.mockRestore();
		});
	});

	describe('Idempotency-Key', () => {
		it('auto-generates an Idempotency-Key header in UUID v4 format', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
<<<<<<< HEAD
			await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
			const key = renderRequest!.headers['idempotency-key'];
=======
			await client.render({ template: '<p>x</p>', data: {} });
			const key = lastRequest.headers['idempotency-key'];
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			expect(key).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
			);
		});

		it('reuses the same Idempotency-Key across retry attempts of one call', async () => {
			const keys: string[] = [];
			let attempts = 0;
			setMockHandler((req, res) => {
<<<<<<< HEAD
				if (req.url?.startsWith('/presigned/')) {
					respondPdf(res);
					return;
				}
=======
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
				keys.push(req.headers['idempotency-key'] as string);
				attempts++;
				if (attempts < 3) {
					res.writeHead(503, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ code: 'unavailable' }));
				} else {
<<<<<<< HEAD
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({
							...sampleDescriptor,
							presignedPdfUrl: `${baseUrl}/presigned/ok.pdf`,
						}),
					);
=======
					res.writeHead(200, { 'Content-Type': 'application/pdf' });
					res.end(Buffer.from('%PDF-1.4 ok'));
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
				}
			});
			const client = new PoliPage({
				apiKey: 'pp_test_x',
				baseUrl,
				maxRetries: 3,
				retryDelay: 10,
			});
<<<<<<< HEAD
			await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
=======
			await client.render({ template: '<p>x</p>', data: {} });
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			expect(keys).toHaveLength(3);
			expect(new Set(keys).size).toBe(1);
		});

		it('uses caller-provided idempotencyKey when set', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
<<<<<<< HEAD
			await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {}, idempotencyKey: 'caller-key-123' });
			expect(renderRequest!.headers['idempotency-key']).toBe('caller-key-123');
=======
			await client.render({ template: '<p>x</p>', data: {}, idempotencyKey: 'caller-key-123' });
			expect(lastRequest.headers['idempotency-key']).toBe('caller-key-123');
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
		});
	});

	describe('cancellation (signal option)', () => {
		it('aborts in-flight request when caller signal is aborted', async () => {
			setMockHandler((_req, res) => {
				// Hang the response so we can abort mid-flight
				setTimeout(() => res.end(Buffer.from('%PDF-1.4 ok')), 5_000);
			});
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 0 });
			const controller = new AbortController();
<<<<<<< HEAD
			const promise = client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {}, signal: controller.signal });
=======
			const promise = client.render({ template: '<p>x</p>', data: {}, signal: controller.signal });
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			setTimeout(() => controller.abort(), 50);
			await expect(promise).rejects.toMatchObject({ name: 'PoliPageError', code: 'aborted' });
		});

		it('rejects immediately if signal is already aborted before call', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 0 });
			const controller = new AbortController();
			controller.abort();
			await expect(
<<<<<<< HEAD
				client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {}, signal: controller.signal }),
=======
				client.render({ template: '<p>x</p>', data: {}, signal: controller.signal }),
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			).rejects.toMatchObject({ name: 'PoliPageError', code: 'aborted' });
		});

		it('aborted error has no status (transport-level)', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 0 });
			const controller = new AbortController();
			controller.abort();
			try {
<<<<<<< HEAD
				await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {}, signal: controller.signal });
=======
				await client.render({ template: '<p>x</p>', data: {}, signal: controller.signal });
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
				expect.fail('Should have thrown');
			} catch (err) {
				expect((err as PoliPageError).status).toBeUndefined();
			}
		});
	});

<<<<<<< HEAD
	describe('render.pdfStream()', () => {
		it('returns a ReadableStream', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
			const stream = await client.render.pdfStream({ project: 'p', template: 't', version: '1.0.0', data: {} });
=======
	describe('renderStream()', () => {
		it('returns a ReadableStream', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
			const stream = await client.renderStream({ template: '<p>x</p>', data: {} });
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			expect(stream).toBeInstanceOf(ReadableStream);
		});

		it('emits the same bytes as render()', async () => {
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
<<<<<<< HEAD
			const bytes = await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });

			const stream = await client.render.pdfStream({ project: 'p', template: 't', version: '1.0.0', data: {} });
=======
			const bytes = await client.render({ template: '<p>x</p>', data: {} });

			const stream = await client.renderStream({ template: '<p>x</p>', data: {} });
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			const chunks: Uint8Array[] = [];
			for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
				chunks.push(chunk);
			}
			const total = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
			let offset = 0;
			for (const c of chunks) {
				total.set(c, offset);
				offset += c.length;
			}
			expect(total).toEqual(bytes);
		});

		it('propagates upstream errors as PoliPageError', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ code: 'VALIDATION_ERROR' }));
			});
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 0 });
			await expect(
<<<<<<< HEAD
				client.render.pdfStream({ project: 'p', template: 't', version: '1.0.0', data: {} }),
			).rejects.toMatchObject({ name: 'PoliPageError', code: 'VALIDATION_ERROR' });
		});

	});

	describe('transport verb dispatch', () => {
		it('sends GET requests with no body and no Content-Type/Idempotency-Key headers', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({
						documentId: 'd', organizationId: 'o', projectId: null, projectSlug: null,
						templateId: null, templateSlug: '<inline>', version: null,
						environment: 'sandbox', apiKeyId: 'k', format: 'A4', orientation: 'portrait',
						locale: 'en-US', pageCount: 1, sizeBytes: 0, createdAt: 'now',
						metadata: {}, presignedPdfUrl: 'http://x', expiresAt: 'later',
					}),
				);
			});
			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			await client.documents.get('d');
			expect(lastRequest.method).toBe('GET');
			expect(lastRequest.body).toBe('');
			expect(lastRequest.headers['content-type']).toBeUndefined();
			expect(lastRequest.headers['idempotency-key']).toBeUndefined();
			expect(lastRequest.headers.authorization).toBe('Bearer pp_test_abc');
		});

		it('sends DELETE requests with no body and no Content-Type/Idempotency-Key headers', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(204);
				res.end();
			});
			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl });
			await client.documents.delete('d');
			expect(lastRequest.method).toBe('DELETE');
			expect(lastRequest.body).toBe('');
			expect(lastRequest.headers['content-type']).toBeUndefined();
			expect(lastRequest.headers['idempotency-key']).toBeUndefined();
		});

		it('retries GET on 5xx like POST does', async () => {
			let attempts = 0;
			setMockHandler((_req, res) => {
				attempts++;
				if (attempts === 1) {
					res.writeHead(503);
					res.end();
					return;
				}
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({
						documentId: 'd', organizationId: 'o', projectId: null, projectSlug: null,
						templateId: null, templateSlug: '<inline>', version: null,
						environment: 'sandbox', apiKeyId: 'k', format: 'A4', orientation: 'portrait',
						locale: 'en-US', pageCount: 1, sizeBytes: 0, createdAt: 'now',
						metadata: {}, presignedPdfUrl: 'http://x', expiresAt: 'later',
					}),
				);
			});
			const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl, retryDelay: 1 });
			await client.documents.get('d');
			expect(attempts).toBe(2);
=======
				client.renderStream({ template: '<p>x</p>', data: {} }),
			).rejects.toMatchObject({ name: 'PoliPageError', code: 'VALIDATION_ERROR' });
		});

		it('rejects 2xx renderStream response if Content-Type is not application/pdf', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'text/html' });
				res.end('<html>oops</html>');
			});
			const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 0 });
			await expect(
				client.renderStream({ template: '<p>x</p>', data: {} }),
			).rejects.toMatchObject({ name: 'PoliPageError', code: 'INTERNAL_ERROR' });
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
		});
	});

	describe('observability hooks', () => {
		it('calls onRequest with method, url, attempt', async () => {
			const events: { method: string; url: string; attempt: number }[] = [];
			const client = new PoliPage({
				apiKey: 'pp_test_x',
				baseUrl,
				onRequest: (e) => events.push(e),
			});
<<<<<<< HEAD
			await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
			// onRequest fires only for SDK-transport calls (here, POST /v1/render).
			// The presigned-URL fetch leg is a plain fetch and is not hooked.
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({ method: 'POST', attempt: 1 });
			expect(events[0].url).toContain('/v1/render');
		});

		it('calls onResponse with status, requestId, durationMs', async () => {
			setMockHandler((req, res) => {
				if (req.url?.startsWith('/presigned/')) {
					respondPdf(res);
					return;
				}
				res.writeHead(200, {
					'Content-Type': 'application/json',
					'x-request-id': 'req_xyz',
				});
				res.end(
					JSON.stringify({
						...sampleDescriptor,
						presignedPdfUrl: `${baseUrl}/presigned/ok.pdf`,
					}),
				);
=======
			await client.render({ template: '<p>x</p>', data: {} });
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({ method: 'POST', attempt: 1 });
			expect(events[0].url).toContain('/v1/render/pdf');
		});

		it('calls onResponse with status, requestId, durationMs', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/pdf', 'x-request-id': 'req_xyz' });
				res.end(Buffer.from('%PDF-1.4 ok'));
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			});
			const events: { status: number; requestId?: string; durationMs: number }[] = [];
			const client = new PoliPage({
				apiKey: 'pp_test_x',
				baseUrl,
				onResponse: (e) => events.push(e),
			});
<<<<<<< HEAD
			await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
			// onResponse fires only for SDK-transport calls (here, POST /v1/render).
=======
			await client.render({ template: '<p>x</p>', data: {} });
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			expect(events).toHaveLength(1);
			expect(events[0].status).toBe(200);
			expect(events[0].requestId).toBe('req_xyz');
			expect(events[0].durationMs).toBeGreaterThanOrEqual(0);
		});

		it('calls onRetry with attempt, delayMs, reason on retried failures', async () => {
			const events: { attempt: number; delayMs: number; reason: PoliPageError }[] = [];
			let attempts = 0;
<<<<<<< HEAD
			setMockHandler((req, res) => {
				if (req.url?.startsWith('/presigned/')) {
					respondPdf(res);
					return;
				}
=======
			setMockHandler((_req, res) => {
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
				attempts++;
				if (attempts < 2) {
					res.writeHead(500, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ code: 'oops' }));
				} else {
<<<<<<< HEAD
					respondDescriptor(res);
=======
					res.writeHead(200, { 'Content-Type': 'application/pdf' });
					res.end(Buffer.from('%PDF-1.4 ok'));
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
				}
			});
			const client = new PoliPage({
				apiKey: 'pp_test_x',
				baseUrl,
				maxRetries: 2,
				retryDelay: 5,
				onRetry: (e) => events.push(e),
			});
<<<<<<< HEAD
			await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
=======
			await client.render({ template: '<p>x</p>', data: {} });
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			expect(events).toHaveLength(1);
			expect(events[0].attempt).toBe(2);
			expect(events[0].reason).toBeInstanceOf(PoliPageError);
		});

		it('calls onError with the thrown PoliPageError when call fails terminally', async () => {
			setMockHandler((_req, res) => {
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ code: 'VALIDATION_ERROR' }));
			});
			const errors: PoliPageError[] = [];
			const client = new PoliPage({
				apiKey: 'pp_test_x',
				baseUrl,
				onError: (err) => errors.push(err),
			});
<<<<<<< HEAD
			await expect(client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} })).rejects.toBeInstanceOf(PoliPageError);
=======
			await expect(client.render({ template: '<p>x</p>', data: {} })).rejects.toBeInstanceOf(PoliPageError);
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			expect(errors).toHaveLength(1);
			expect(errors[0].code).toBe('VALIDATION_ERROR');
		});

		it('hook errors do not break the request', async () => {
			const client = new PoliPage({
				apiKey: 'pp_test_x',
				baseUrl,
				onRequest: () => {
					throw new Error('hook blew up');
				},
				onResponse: () => {
					throw new Error('hook blew up');
				},
			});
<<<<<<< HEAD
			const pdf = await client.render.pdf({ project: 'p', template: 't', version: '1.0.0', data: {} });
=======
			const pdf = await client.render({ template: '<p>x</p>', data: {} });
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			expect(pdf).toBeInstanceOf(Uint8Array);
		});
	});
});
