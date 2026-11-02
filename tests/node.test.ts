import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PoliPage, PoliPageError } from '../src/index.js';
import { renderToFile } from '../src/node.js';

/**
 * A write failure the file system cannot be made to produce portably (a full
 * disk): when `failWrites` is set, every `FileHandle.write` rejects with it.
 */
const writeFault = vi.hoisted(() => ({ failWrites: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
	const fs = await importOriginal<typeof FsPromises>();
	return {
		...fs,
		open: async (...args: Parameters<typeof fs.open>) => {
			const file = await fs.open(...args);
			const write = file.write.bind(file);
			Object.defineProperty(file, 'write', {
				value: (...writeArgs: unknown[]) =>
					writeFault.failWrites
						? Promise.reject(new Error('ENOSPC: no space left on device, write'))
						: (write as (...a: unknown[]) => unknown)(...writeArgs),
			});
			return file;
		},
	};
});

let server: Server;
let baseUrl: string;
let tempDir: string;
let handler: (req: IncomingMessage, res: ServerResponse) => void;
let requests: string[] = [];

/**
 * Stub descriptor returned by the mock /v1/render endpoint, matching the
 * wire shape required by `RawDocumentDescriptor` in src/types.ts.
 */
const sampleDescriptor = {
	documentId: 'doc_node_x',
	organizationId: 'org_x',
	projectId: 'proj_p',
	projectSlug: 'p',
	templateId: 'tpl_t',
	templateSlug: 't',
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
 * Routes the two-call render flow. POST /v1/render returns a JSON descriptor
 * pointing at the same server's /presigned/* path, which returns PDF bytes.
 */
function defaultHandler(req: IncomingMessage, res: ServerResponse) {
	if (req.url === '/v1/render') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({
				...sampleDescriptor,
				presignedPdfUrl: `${baseUrl}/presigned/node.pdf`,
			}),
		);
		return;
	}
	if (req.url?.startsWith('/presigned/')) {
		res.writeHead(200, { 'Content-Type': 'application/pdf' });
		res.end(Buffer.from('%PDF-1.4 stream test'));
		return;
	}
	res.writeHead(404);
	res.end();
}

beforeAll(async () => {
	handler = defaultHandler;
	server = createServer((req, res) => {
		req.resume();
		req.on('end', () => {
			requests.push(`${req.method} ${req.url}`);
			handler(req, res);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const addr = server.address();
	if (typeof addr === 'object' && addr) baseUrl = `http://localhost:${addr.port}`;
	tempDir = await mkdtemp(join(tmpdir(), 'poli-sdk-node-'));
});

afterEach(() => {
	handler = defaultHandler;
	requests = [];
	writeFault.failWrites = false;
});

afterAll(async () => {
	server.closeAllConnections();
	await new Promise<void>((resolve) => server.close(() => resolve()));
	await rm(tempDir, { recursive: true, force: true });
});

describe('renderToFile (sub-export)', () => {
	it('writes a non-empty PDF to disk', async () => {
		const client = new PoliPage({ apiKey: 'pp_sandbox_x', baseUrl });
		const out = join(tempDir, 'a.pdf');
		await renderToFile(client, { project: 'p', template: 't', data: {} }, out);
		const content = await readFile(out);
		expect(new TextDecoder().decode(content.subarray(0, 4))).toBe('%PDF');
		expect(content.length).toBeGreaterThan(0);
	});

	it('creates parent directories that do not exist', async () => {
		const client = new PoliPage({ apiKey: 'pp_sandbox_x', baseUrl });
		const out = join(tempDir, 'nested', 'deeply', 'b.pdf');
		await renderToFile(client, { project: 'p', template: 't', data: {} }, out);
		const s = await stat(out);
		expect(s.isFile()).toBe(true);
	});

	it('overwrites existing files', async () => {
		const client = new PoliPage({ apiKey: 'pp_sandbox_x', baseUrl });
		const out = join(tempDir, 'c.pdf');
		await renderToFile(client, { project: 'p', template: 't', data: {} }, out);
		const first = (await stat(out)).size;
		await renderToFile(client, { project: 'p', template: 't', data: {} }, out);
		const second = (await stat(out)).size;
		expect(second).toBe(first);
	});

	it('leaves no temporary file next to the target', async () => {
		const client = new PoliPage({ apiKey: 'pp_sandbox_x', baseUrl });
		const dir = join(tempDir, 'clean');
		await renderToFile(client, { project: 'p', template: 't', data: {} }, join(dir, 'd.pdf'));
		expect(await readdir(dir)).toEqual(['d.pdf']);
	});
});

describe('renderToFile leaves the target untouched on failure', () => {
	const input = { project: 'p', template: 't', data: {} };

	/** A directory holding `existing.pdf` (old content); returns its path. */
	async function dirWithExistingFile(name: string): Promise<string> {
		const dir = join(tempDir, name);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'existing.pdf'), 'old content');
		return dir;
	}

	function client(): PoliPage {
		return new PoliPage({ apiKey: 'pp_sandbox_x', baseUrl, timeout: 2_000, maxRetries: 0 });
	}

	it('a failed download keeps an existing file and creates no missing one', async () => {
		handler = (req, res) => {
			if (req.url?.startsWith('/presigned/')) {
				res.writeHead(403);
				res.end();
				return;
			}
			defaultHandler(req, res);
		};
		const dir = await dirWithExistingFile('download-403');
		await expect(
			renderToFile(client(), input, join(dir, 'existing.pdf')),
		).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED', status: 403 });
		await expect(renderToFile(client(), input, join(dir, 'new.pdf'))).rejects.toMatchObject({
			code: 'DOWNLOAD_FAILED',
		});
		expect(await readFile(join(dir, 'existing.pdf'), 'utf8')).toBe('old content');
		expect(await readdir(dir)).toEqual(['existing.pdf']);
	});

	it('a download cut short of its Content-Length is never written to the target', async () => {
		handler = (req, res) => {
			if (req.url?.startsWith('/presigned/')) {
				res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': '100000' });
				res.write('%PDF-1.4 only the start');
				setTimeout(() => res.destroy(), 20);
				return;
			}
			defaultHandler(req, res);
		};
		const dir = await dirWithExistingFile('short');
		await expect(
			renderToFile(client(), input, join(dir, 'existing.pdf')),
		).rejects.toMatchObject({
			code: 'DOWNLOAD_FAILED',
			message: 'Failed to download PDF: network error',
		});
		expect(await readFile(join(dir, 'existing.pdf'), 'utf8')).toBe('old content');
		expect(await readdir(dir)).toEqual(['existing.pdf']);
	});

	it('a failed render keeps an existing file', async () => {
		handler = (_req, res) => {
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'TEMPLATE_NOT_FOUND', detail: 'no such template' }));
		};
		const dir = await dirWithExistingFile('render-404');
		await expect(
			renderToFile(client(), input, join(dir, 'existing.pdf')),
		).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND', status: 404 });
		expect(await readFile(join(dir, 'existing.pdf'), 'utf8')).toBe('old content');
		expect(await readdir(dir)).toEqual(['existing.pdf']);
	});
});

describe('renderToFile io_error', () => {
	const input = { project: 'p', template: 't', data: {} };

	function client(): PoliPage {
		return new PoliPage({ apiKey: 'pp_sandbox_x', baseUrl, maxRetries: 0 });
	}

	function expectIoError(err: unknown): PoliPageError {
		expect(err).toBeInstanceOf(PoliPageError);
		const error = err as PoliPageError;
		expect(error.code).toBe('io_error');
		expect(error.status).toBeUndefined();
		expect(error.requestId).toBeUndefined();
		expect(error.isRetryable()).toBe(false);
		expect(error.cause).toBeInstanceOf(Error);
		expect(error.message).toBe(`Failed to write PDF: ${(error.cause as Error).message}`);
		expect(error.toPayload()).toEqual({
			code: 'io_error',
			message: error.message,
			status: null,
			requestId: null,
		});
		return error;
	}

	it('a parent directory that cannot be created is io_error, before any render', async () => {
		const blocker = join(tempDir, 'a-file');
		await writeFile(blocker, 'not a directory');
		const err: unknown = await renderToFile(client(), input, join(blocker, 'sub', 'x.pdf')).catch(
			(e: unknown) => e,
		);
		expectIoError(err);
		expect(requests).toEqual([]);
	});

	it('a target that cannot be replaced (a directory) is io_error, and the temporary file is removed', async () => {
		const dir = join(tempDir, 'target-is-dir');
		await mkdir(join(dir, 'out.pdf'), { recursive: true });
		const err: unknown = await renderToFile(client(), input, join(dir, 'out.pdf')).catch(
			(e: unknown) => e,
		);
		expectIoError(err);
		expect(await readdir(dir)).toEqual(['out.pdf']);
		expect((await stat(join(dir, 'out.pdf'))).isDirectory()).toBe(true);
	});

	it('a failed write is io_error with the runtime error chained, and the target is untouched', async () => {
		const dir = join(tempDir, 'write-fails');
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'existing.pdf'), 'old content');
		writeFault.failWrites = true;
		const err: unknown = await renderToFile(client(), input, join(dir, 'existing.pdf')).catch(
			(e: unknown) => e,
		);
		const error = expectIoError(err);
		expect(error.message).toBe('Failed to write PDF: ENOSPC: no space left on device, write');
		expect(await readFile(join(dir, 'existing.pdf'), 'utf8')).toBe('old content');
		expect(await readdir(dir)).toEqual(['existing.pdf']);
	});
});
