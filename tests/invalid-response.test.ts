import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { PoliPage, PoliPageError } from '../src/index.js';

/**
 * A 2xx answer whose body is not JSON, from a method that expects JSON, is
 * `invalid_response`: the real status, the `x-request-id`, never retried.
 */

let server: Server;
let baseUrl: string;
let requests: string[];
let handler: (req: IncomingMessage, res: ServerResponse) => void;

beforeAll(async () => {
	server = createServer((req, res) => {
		req.resume();
		req.on('end', () => {
			requests.push(`${req.method} ${req.url}`);
			handler(req, res);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const addr = server.address();
	if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
});

beforeEach(() => {
	requests = [];
});

afterAll(async () => {
	server.closeAllConnections();
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Every request gets `status` with an HTML page from a proxy. */
function answerHtml(status = 200) {
	handler = (_req, res) => {
		res.writeHead(status, { 'Content-Type': 'text/html', 'x-request-id': 'req_proxy' });
		res.end('<html><body>Welcome to the hotel network</body></html>');
	};
}

function client(onError?: (err: PoliPageError) => void): PoliPage {
	return new PoliPage({ apiKey: 'pp_sandbox_x', baseUrl, retryDelay: 1, onError });
}

const input = { project: 'p', template: 't', data: {} };

describe('invalid_response', () => {
	const calls: [string, (c: PoliPage) => Promise<unknown>][] = [
		['render.document', (c) => c.render.document(input)],
		['render.pdf', (c) => c.render.pdf(input)],
		['render.pdfStream', (c) => c.render.pdfStream(input)],
		['documents.get', (c) => c.documents.get('doc_1')],
		['documents.thumbnails', (c) => c.documents.thumbnails('doc_1')],
	];

	for (const [name, call] of calls) {
		it(`${name}: a 200 whose body is not JSON is invalid_response, not retried`, async () => {
			answerHtml();
			const errors: PoliPageError[] = [];
			const err: unknown = await call(client((e) => errors.push(e))).catch((e: unknown) => e);
			expect(err).toBeInstanceOf(PoliPageError);
			const error = err as PoliPageError;
			expect(error.code).toBe('invalid_response');
			expect(error.message).toBe('Invalid response: HTTP 200 body is not JSON');
			expect(error.status).toBe(200);
			expect(error.requestId).toBe('req_proxy');
			expect(error.cause).toBeInstanceOf(SyntaxError);
			expect(error.isRetryable()).toBe(false);
			expect(error.toPayload().status).toBe(502);
			// One request: no retry, and no download after a render whose answer is unreadable.
			expect(requests).toHaveLength(1);
			expect(errors).toEqual([error]);
		});
	}

	it('keeps the real 2xx status (201) and has no requestId without the header', async () => {
		handler = (_req, res) => {
			res.writeHead(201, { 'Content-Type': 'application/json' });
			res.end('{"documentId": ');
		};
		const err: unknown = await client()
			.render.document(input)
			.catch((e: unknown) => e);
		expect(err).toMatchObject({
			code: 'invalid_response',
			message: 'Invalid response: HTTP 201 body is not JSON',
			status: 201,
			requestId: undefined,
		});
	});

	it('an empty 200 body is invalid_response', async () => {
		handler = (_req, res) => {
			res.writeHead(200, { 'x-request-id': 'req_empty' });
			res.end();
		};
		await expect(client().documents.get('doc_1')).rejects.toMatchObject({
			code: 'invalid_response',
			message: 'Invalid response: HTTP 200 body is not JSON',
			status: 200,
			requestId: 'req_empty',
		});
	});

	it('documents.preview and documents.delete expect no JSON', async () => {
		answerHtml();
		const preview = await client().documents.preview('doc_1');
		expect(preview.html).toContain('hotel network');
		await expect(client().documents.delete('doc_1')).resolves.toBeUndefined();
	});

	it('a non-2xx body that is not JSON is still INTERNAL_ERROR with the real status', async () => {
		answerHtml(404);
		await expect(client().documents.get('doc_1')).rejects.toMatchObject({
			code: 'INTERNAL_ERROR',
			message: 'HTTP 404',
			status: 404,
			requestId: 'req_proxy',
		});
	});
});
