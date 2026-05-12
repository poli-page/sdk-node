import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { PoliPageError } from '../src/error.js';
import { renderPdf, renderPdfStream, renderPreview, type RenderContext } from '../src/render.js';

let server: Server;
let baseUrl: string;
let lastRequest: { method: string; path: string; headers: Record<string, string>; body: string };
let mockHandler: (req: IncomingMessage, res: ServerResponse) => void;

function setMockHandler(handler: typeof mockHandler) {
	mockHandler = handler;
}

function defaultPdfHandler(_req: IncomingMessage, res: ServerResponse) {
	res.writeHead(200, { 'Content-Type': 'application/pdf' });
	res.end(Buffer.from('%PDF-1.4 test'));
}

beforeAll(async () => {
	mockHandler = defaultPdfHandler;
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
	await new Promise<void>((resolve) => server.listen(0, () => resolve()));
	const addr = server.address();
	if (typeof addr === 'object' && addr) baseUrl = `http://localhost:${addr.port}`;
});

afterEach(() => {
	mockHandler = defaultPdfHandler;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

/**
 * Build a real `RenderContext` whose `request` performs an actual HTTP call
 * against the mock server above. Bypasses the PoliPage class so render
 * functions can be tested in isolation from retry/hooks/etc.
 */
function buildCtx(): RenderContext {
	return {
		async request(path, body, signal, idempotencyKey) {
			return fetch(`${baseUrl}${path}`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: path.endsWith('/preview') ? 'application/json' : 'application/pdf',
					'idempotency-key': idempotencyKey ?? 'test-key',
				},
				body: JSON.stringify(body),
				signal,
			});
		},
	};
}

describe('renderPdf', () => {
	it('POSTs to /v1/render/pdf and returns a Uint8Array', async () => {
		const pdf = await renderPdf(buildCtx(), { template: '<p>x</p>', data: {} });
		expect(pdf).toBeInstanceOf(Uint8Array);
		expect(new TextDecoder().decode(pdf.subarray(0, 4))).toBe('%PDF');
		expect(lastRequest.path).toBe('/v1/render/pdf');
		expect(lastRequest.method).toBe('POST');
	});

	it('forwards metadata in the request body when provided', async () => {
		await renderPdf(buildCtx(), {
			template: '<p>x</p>',
			data: {},
			metadata: { customerId: 'cust_1', invoiceNumber: 42, paid: true },
		});
		const body = JSON.parse(lastRequest.body);
		expect(body.metadata).toEqual({ customerId: 'cust_1', invoiceNumber: 42, paid: true });
	});

	it('omits metadata from the request body when not provided', async () => {
		await renderPdf(buildCtx(), { template: '<p>x</p>', data: {} });
		const body = JSON.parse(lastRequest.body);
		expect('metadata' in body).toBe(false);
	});

	it('does not forward signal or idempotencyKey in the request body', async () => {
		const controller = new AbortController();
		await renderPdf(buildCtx(), {
			template: '<p>x</p>',
			data: {},
			signal: controller.signal,
			idempotencyKey: 'custom-key',
		});
		const body = JSON.parse(lastRequest.body);
		expect('signal' in body).toBe(false);
		expect('idempotencyKey' in body).toBe(false);
		// idempotencyKey is forwarded as a transport argument, not in the body —
		// the test fake exposes it as the 'idempotency-key' header.
		expect(lastRequest.headers['idempotency-key']).toBe('custom-key');
	});

	it('supports project + template slug mode', async () => {
		await renderPdf(buildCtx(), {
			project: 'billing',
			template: 'invoice',
			version: '1.0.0',
			data: { amount: 100 },
		});
		const body = JSON.parse(lastRequest.body);
		expect(body.project).toBe('billing');
		expect(body.template).toBe('invoice');
		expect(body.version).toBe('1.0.0');
	});

	it('throws PoliPageError when response content-type is not application/pdf', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'text/html', 'x-request-id': 'req_test_42' });
			res.end('<html>not a pdf</html>');
		});
		await expect(renderPdf(buildCtx(), { template: '<p>x</p>', data: {} })).rejects.toMatchObject({
			name: 'PoliPageError',
			code: 'INTERNAL_ERROR',
			status: 200,
			requestId: 'req_test_42',
		});
	});
});

describe('renderPdfStream', () => {
	it('returns a ReadableStream of PDF bytes', async () => {
		const stream = await renderPdfStream(buildCtx(), { template: '<p>x</p>', data: {} });
		expect(stream).toBeInstanceOf(ReadableStream);
		const reader = stream.getReader();
		const { value } = await reader.read();
		expect(value).toBeInstanceOf(Uint8Array);
		expect(new TextDecoder().decode(value!.subarray(0, 4))).toBe('%PDF');
		reader.releaseLock();
	});

	it('throws PoliPageError when content-type is not application/pdf', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'text/html' });
			res.end('<html>x</html>');
		});
		await expect(
			renderPdfStream(buildCtx(), { template: '<p>x</p>', data: {} }),
		).rejects.toMatchObject({ name: 'PoliPageError', status: 200 });
	});

	it('forwards metadata in the request body', async () => {
		const stream = await renderPdfStream(buildCtx(), {
			template: '<p>x</p>',
			data: {},
			metadata: { trace: 'abc' },
		});
		// Drain so the server records the request:
		const reader = stream.getReader();
		while (!(await reader.read()).done) { /* drain */ }
		expect(JSON.parse(lastRequest.body).metadata).toEqual({ trace: 'abc' });
	});
});

describe('renderPreview', () => {
	it('POSTs to /v1/render/preview and returns html + totalPages', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ html: '<p>preview</p>', totalPages: 3 }));
		});
		const result = await renderPreview(buildCtx(), { template: '<p>x</p>', data: {} });
		expect(result.html).toBe('<p>preview</p>');
		expect(result.totalPages).toBe(3);
		expect(lastRequest.path).toBe('/v1/render/preview');
	});

	it('echoes metadata from the server response when present', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					html: '<p>x</p>',
					totalPages: 1,
					metadata: { trace: 'abc-123' },
				}),
			);
		});
		const result = await renderPreview(buildCtx(), {
			template: '<p>x</p>',
			data: {},
			metadata: { trace: 'abc-123' },
		});
		expect(result.metadata).toEqual({ trace: 'abc-123' });
	});

	it('omits metadata from result when server does not return it', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ html: '<p>x</p>', totalPages: 1 }));
		});
		const result = await renderPreview(buildCtx(), { template: '<p>x</p>', data: {} });
		expect(result.metadata).toBeUndefined();
	});

	it('forwards metadata in the request body', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ html: '<p>x</p>', totalPages: 1 }));
		});
		await renderPreview(buildCtx(), {
			template: '<p>x</p>',
			data: {},
			metadata: { customerId: 'cust_1' },
		});
		expect(JSON.parse(lastRequest.body).metadata).toEqual({ customerId: 'cust_1' });
	});
});
