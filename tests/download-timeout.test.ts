import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { PoliPage, PoliPageError } from '../src/index.js';

/**
 * The client's `timeout` bounds the presigned-URL download: the whole download
 * for `render.pdf` and `downloadPdf()`, an idle timeout (first byte, then each
 * gap between chunks) for `render.pdfStream`. Past it: `DOWNLOAD_FAILED`,
 * `Failed to download PDF: timeout`, no status, never retryable.
 *
 * Margins are wide on purpose (a gap of a third of the timeout, a stall of
 * many timeouts) so slow CI runners do not flip the outcome.
 */

const TIMEOUT_MS = 300;
const CHUNK = 'x'.repeat(1024);

let server: Server;
let baseUrl: string;
let downloads: number;
let download: (res: ServerResponse) => void;

const descriptor = {
	documentId: 'doc_1',
	organizationId: 'org_1',
	projectId: 'proj_1',
	projectSlug: 'p',
	templateId: 'tpl_1',
	templateSlug: 't',
	environment: 'sandbox',
	apiKeyId: 'key_1',
	format: 'A4',
	orientation: 'portrait',
	locale: 'en-US',
	pageCount: 1,
	sizeBytes: 100,
	createdAt: '2026-01-01T00:00:00Z',
	metadata: {},
	expiresAt: '2026-01-01T00:15:00Z',
};

beforeAll(async () => {
	server = createServer((req: IncomingMessage, res: ServerResponse) => {
		req.resume();
		req.on('end', () => {
			if (req.url === '/v1/render' || req.url === '/v1/documents/doc_1') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ ...descriptor, presignedPdfUrl: `${baseUrl}/storage/doc_1.pdf` }));
				return;
			}
			downloads += 1;
			download(res);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const addr = server.address();
	if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
});

beforeEach(() => {
	downloads = 0;
});

afterAll(async () => {
	server.closeAllConnections();
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

function client(timeout = TIMEOUT_MS): PoliPage {
	return new PoliPage({ apiKey: 'pp_sandbox_x', baseUrl, timeout, retryDelay: 1 });
}

const input = { project: 'p', template: 't', data: {} };

/** Headers, then `count` chunks `gapMs` apart, then the end of the body. */
function trickle(count: number, gapMs: number) {
	return (res: ServerResponse) => {
		res.writeHead(200, { 'Content-Type': 'application/pdf' });
		let sent = 0;
		const next = () => {
			if (res.destroyed) return;
			if (sent === count) {
				res.end();
				return;
			}
			res.write(CHUNK);
			sent += 1;
			setTimeout(next, gapMs);
		};
		next();
	};
}

/** Never answers. */
function hang() {
	return () => {};
}

/** Headers and a first chunk, then nothing. */
function stallAfterFirstChunk() {
	return (res: ServerResponse) => {
		res.writeHead(200, { 'Content-Type': 'application/pdf' });
		res.write(CHUNK);
	};
}

/** Reads the stream to its end, pausing `pauseMs` after each of the first `pauses` chunks. */
async function drain(
	stream: ReadableStream<Uint8Array>,
	pauseMs = 0,
	pauses = 0,
): Promise<number> {
	const reader = stream.getReader();
	let length = 0;
	let reads = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return length;
		length += value.byteLength;
		reads += 1;
		if (reads <= pauses) await new Promise((resolve) => setTimeout(resolve, pauseMs));
	}
}

function expectDownloadTimeout(err: unknown): void {
	expect(err).toBeInstanceOf(PoliPageError);
	const error = err as PoliPageError;
	expect(error.code).toBe('DOWNLOAD_FAILED');
	expect(error.message).toBe('Failed to download PDF: timeout');
	expect(error.status).toBeUndefined();
	expect(error.isRetryable()).toBe(false);
	expect(error.isNetworkError()).toBe(false);
	expect(error.cause).toBeDefined();
}

describe('render.pdf and downloadPdf(): timeout bounds the whole download', () => {
	it('render.pdf times out when storage never answers, without retrying', async () => {
		download = hang();
		const err: unknown = await client()
			.render.pdf(input)
			.catch((e: unknown) => e);
		expectDownloadTimeout(err);
		expect(downloads).toBe(1);
	});

	it('render.pdf times out when the body stalls after the first bytes', async () => {
		download = stallAfterFirstChunk();
		expectDownloadTimeout(await client().render.pdf(input).catch((e: unknown) => e));
	});

	it('render.pdf times out on a body that keeps coming but outlasts the timeout', async () => {
		// Each gap is well under the timeout; the total (8 × 100 ms) is well over it.
		download = trickle(8, TIMEOUT_MS / 3);
		expectDownloadTimeout(await client().render.pdf(input).catch((e: unknown) => e));
	});

	it('downloadPdf() times out with the client timeout', async () => {
		download = hang();
		const doc = await client().documents.get('doc_1');
		expectDownloadTimeout(await doc.downloadPdf().catch((e: unknown) => e));
	});

	it('a download inside the timeout succeeds', async () => {
		download = trickle(3, 10);
		const pdf = await client(5_000).render.pdf(input);
		expect(pdf.byteLength).toBe(3 * CHUNK.length);
	});

	it('a dropped connection before the timeout is a network error, not a timeout', async () => {
		download = (res) => {
			res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': '100000' });
			res.write(CHUNK);
			setTimeout(() => res.destroy(), 20);
		};
		await expect(client(5_000).render.pdf(input)).rejects.toMatchObject({
			code: 'DOWNLOAD_FAILED',
			message: 'Failed to download PDF: network error',
			status: undefined,
		});
	});

	it('a caller abort during the download is aborted, not a timeout', async () => {
		const controller = new AbortController();
		download = (res) => {
			res.writeHead(200, { 'Content-Type': 'application/pdf' });
			res.write(CHUNK);
			setTimeout(() => controller.abort(), 20);
		};
		await expect(
			client(5_000).render.pdf({ ...input, signal: controller.signal }),
		).rejects.toMatchObject({ code: 'aborted', message: 'Request was aborted' });
	});
});

describe('render.pdfStream: timeout is an idle timeout', () => {
	it('the call raises when storage sends no first byte in time', async () => {
		download = hang();
		expectDownloadTimeout(await client().render.pdfStream(input).catch((e: unknown) => e));
		expect(downloads).toBe(1);
	});

	it('the call raises when the headers come but the first byte does not', async () => {
		download = (res) => {
			res.writeHead(200, { 'Content-Type': 'application/pdf' });
			res.flushHeaders();
		};
		expectDownloadTimeout(await client().render.pdfStream(input).catch((e: unknown) => e));
	});

	it('the stream errors when a gap between chunks outlasts the timeout', async () => {
		download = stallAfterFirstChunk();
		const stream = await client().render.pdfStream(input);
		expectDownloadTimeout(await drain(stream).catch((e: unknown) => e));
	});

	it('a body that outlasts the timeout in total, with short gaps, streams in full', async () => {
		download = trickle(8, TIMEOUT_MS / 3);
		const stream = await client().render.pdfStream(input);
		expect(await drain(stream)).toBe(8 * CHUNK.length);
	});

	it('time the caller spends between reads is not counted', async () => {
		// The whole body is sent at once; the caller waits longer than the timeout between reads.
		download = (res) => {
			res.writeHead(200, { 'Content-Type': 'application/pdf' });
			res.end(Buffer.alloc(256 * 1024, 1));
		};
		const stream = await client().render.pdfStream(input);
		expect(await drain(stream, TIMEOUT_MS * 1.5, 2)).toBe(256 * 1024);
	});

	it('cancelling the stream ends the download and its timer', async () => {
		download = stallAfterFirstChunk();
		const stream = await client().render.pdfStream(input);
		const reader = stream.getReader();
		expect((await reader.read()).value?.byteLength).toBe(CHUNK.length);
		await reader.cancel();
		// Past the timeout: a timer left armed would error a cancelled stream.
		await new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS * 2));
		expect(await reader.read()).toEqual({ done: true, value: undefined });
	});
});
