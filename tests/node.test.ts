import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	readlink,
	rm,
	stat,
	symlink,
	writeFile,
} from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PoliPage, PoliPageError } from '../src/index.js';
import { renderToFile } from '../src/node.js';

/** A Node system error, with the message format Node gives one. */
function systemError(code: string, description: string, syscall: string, paths = ''): Error {
	return Object.assign(new Error(`${code}: ${description}, ${syscall}${paths}`), {
		code,
		syscall,
	});
}

/**
 * Failures the file system cannot be made to produce portably: when
 * `failWrites` is set, every `FileHandle.write` rejects as on a full disk;
 * when `failRename` is set, `rename` rejects naming both of its paths, as
 * Node's own rename errors do.
 */
const writeFault = vi.hoisted(() => ({ failWrites: false, failRename: false }));
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
						? Promise.reject(systemError('ENOSPC', 'no space left on device', 'write'))
						: (write as (...a: unknown[]) => unknown)(...writeArgs),
			});
			return file;
		},
		rename: (from: string, to: string) =>
			writeFault.failRename
				? Promise.reject(systemError('EBUSY', 'resource busy or locked', 'rename', ` '${from}' -> '${to}'`))
				: fs.rename(from, to),
	};
});

/** `text` with the characters a regular expression gives a meaning escaped. */
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
	writeFault.failRename = false;
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

describe('renderToFile with an existing target', () => {
	const input = { project: 'p', template: 't', data: {} };
	const pdf = '%PDF-1.4 stream test';
	// Symbolic links need privileges on Windows, and its file modes are not POSIX bits.
	const isWindows = process.platform === 'win32';

	function client(): PoliPage {
		return new PoliPage({ apiKey: 'pp_sandbox_x', baseUrl, maxRetries: 0 });
	}

	it.skipIf(isWindows)('writes through a symbolic link, which stays a link', async () => {
		const dir = join(tempDir, 'symlink');
		await mkdir(join(dir, 'archive'), { recursive: true });
		await mkdir(join(dir, 'public'), { recursive: true });
		await writeFile(join(dir, 'archive', 'real.pdf'), 'old content');
		await symlink(join('..', 'archive', 'real.pdf'), join(dir, 'public', 'latest.pdf'));

		await renderToFile(client(), input, join(dir, 'public', 'latest.pdf'));

		expect((await lstat(join(dir, 'public', 'latest.pdf'))).isSymbolicLink()).toBe(true);
		expect(await readlink(join(dir, 'public', 'latest.pdf'))).toBe(join('..', 'archive', 'real.pdf'));
		expect(await readFile(join(dir, 'archive', 'real.pdf'), 'utf8')).toBe(pdf);
		expect(await readdir(join(dir, 'archive'))).toEqual(['real.pdf']);
		expect(await readdir(join(dir, 'public'))).toEqual(['latest.pdf']);
	});

	it.skipIf(isWindows)('creates the missing file a dangling link points to', async () => {
		const dir = join(tempDir, 'dangling');
		await mkdir(dir, { recursive: true });
		await symlink('real.pdf', join(dir, 'link.pdf'));

		await renderToFile(client(), input, join(dir, 'link.pdf'));

		expect((await lstat(join(dir, 'link.pdf'))).isSymbolicLink()).toBe(true);
		expect(await readFile(join(dir, 'real.pdf'), 'utf8')).toBe(pdf);
	});

	it.skipIf(isWindows)('a failure through a link leaves the linked file untouched', async () => {
		handler = (req, res) => {
			if (req.url?.startsWith('/presigned/')) {
				res.writeHead(403);
				res.end();
				return;
			}
			defaultHandler(req, res);
		};
		const dir = join(tempDir, 'symlink-fail');
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'real.pdf'), 'old content');
		await symlink('real.pdf', join(dir, 'link.pdf'));

		await expect(renderToFile(client(), input, join(dir, 'link.pdf'))).rejects.toMatchObject({
			code: 'DOWNLOAD_FAILED',
		});
		expect(await readFile(join(dir, 'real.pdf'), 'utf8')).toBe('old content');
		expect((await readdir(dir)).sort()).toEqual(['link.pdf', 'real.pdf']);
	});

	it.skipIf(isWindows)('a symbolic link loop is io_error', async () => {
		const dir = join(tempDir, 'loop');
		await mkdir(dir, { recursive: true });
		await symlink('b.pdf', join(dir, 'a.pdf'));
		await symlink('a.pdf', join(dir, 'b.pdf'));
		await expect(renderToFile(client(), input, join(dir, 'a.pdf'))).rejects.toMatchObject({
			code: 'io_error',
		});
		expect(requests).toEqual([]);
	});

	it.skipIf(isWindows)(
		'resolves a .. in a link from the real directory of a symlinked parent',
		async () => {
			// sym -> real/dir, and real/dir/link -> ../a.pdf: the OS reads `..` from real/dir.
			const dir = join(tempDir, 'dotdot');
			await mkdir(join(dir, 'real', 'dir'), { recursive: true });
			await writeFile(join(dir, 'real', 'a.pdf'), 'old content');
			await symlink(join('real', 'dir'), join(dir, 'sym'));
			await symlink(join('..', 'a.pdf'), join(dir, 'real', 'dir', 'link'));

			await renderToFile(client(), input, join(dir, 'sym', 'link'));

			expect(await readFile(join(dir, 'real', 'a.pdf'), 'utf8')).toBe(pdf);
			expect(await readFile(join(dir, 'sym', 'link'), 'utf8')).toBe(pdf);
			expect((await lstat(join(dir, 'real', 'dir', 'link'))).isSymbolicLink()).toBe(true);
			expect((await readdir(dir)).sort()).toEqual(['real', 'sym']);
			expect((await readdir(join(dir, 'real'))).sort()).toEqual(['a.pdf', 'dir']);
		},
	);

	it.skipIf(isWindows)(
		'resolves a .. in a dangling link from the real directory of a symlinked parent',
		async () => {
			const dir = join(tempDir, 'dotdot-dangling');
			await mkdir(join(dir, 'real', 'dir'), { recursive: true });
			await symlink(join('real', 'dir'), join(dir, 'sym'));
			await symlink(join('..', 'new.pdf'), join(dir, 'real', 'dir', 'link'));

			await renderToFile(client(), input, join(dir, 'sym', 'link'));

			expect(await readFile(join(dir, 'real', 'new.pdf'), 'utf8')).toBe(pdf);
			expect((await readdir(dir)).sort()).toEqual(['real', 'sym']);
		},
	);

	it('a read-only existing file is io_error before any render, and stays as it was', async () => {
		const dir = join(tempDir, 'read-only');
		await mkdir(dir, { recursive: true });
		const out = join(dir, 'locked.pdf');
		await writeFile(out, 'old content');
		await chmod(out, 0o444);
		try {
			const err: unknown = await renderToFile(client(), input, out).catch((e: unknown) => e);
			expect(err).toBeInstanceOf(PoliPageError);
			const error = err as PoliPageError;
			expect(error.code).toBe('io_error');
			expect(error.status).toBeUndefined();
			expect(error.cause).toBeInstanceOf(Error);
			expect(error.message).toMatch(new RegExp(`^Failed to write PDF: ${escapeRegExp(out)}: E[A-Z]+: `));
			expect((error.cause as NodeJS.ErrnoException).syscall).toBe('access');
			expect(requests).toEqual([]);
			expect(await readFile(out, 'utf8')).toBe('old content');
			expect(await readdir(dir)).toEqual(['locked.pdf']);
		} finally {
			await chmod(out, 0o644);
		}
	});

	it.skipIf(isWindows)('an existing file keeps its permission bits', async () => {
		const dir = join(tempDir, 'mode');
		await mkdir(dir, { recursive: true });
		for (const mode of [0o640, 0o600, 0o664]) {
			const out = join(dir, `mode-${mode.toString(8)}.pdf`);
			await writeFile(out, 'old content');
			await chmod(out, mode);
			await renderToFile(client(), input, out);
			expect(await readFile(out, 'utf8')).toBe(pdf);
			expect((await stat(out)).mode & 0o777).toBe(mode);
		}
	});

	it.skipIf(isWindows)('an existing file does not keep its setuid bit', async () => {
		const dir = join(tempDir, 'setuid');
		await mkdir(dir, { recursive: true });
		const out = join(dir, 'setuid.pdf');
		await writeFile(out, 'old content');
		await chmod(out, 0o4750);
		await renderToFile(client(), input, out);
		expect((await stat(out)).mode & 0o7777).toBe(0o750);
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
	const isWindows = process.platform === 'win32';
	// root can write a directory whatever its mode.
	const isRoot = process.getuid?.() === 0;

	function client(): PoliPage {
		return new PoliPage({ apiKey: 'pp_sandbox_x', baseUrl, maxRetries: 0 });
	}

	/** An `io_error` whose message names `outputPath`, never the temporary file. */
	function expectIoError(err: unknown, outputPath: string): PoliPageError {
		expect(err).toBeInstanceOf(PoliPageError);
		const error = err as PoliPageError;
		expect(error.code).toBe('io_error');
		expect(error.status).toBeUndefined();
		expect(error.requestId).toBeUndefined();
		expect(error.isRetryable()).toBe(false);
		expect(error.cause).toBeInstanceOf(Error);
		expect(error.message.startsWith(`Failed to write PDF: ${outputPath}: `)).toBe(true);
		expect(error.message).not.toContain('.tmp');
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
		const out = join(blocker, 'sub', 'x.pdf');
		const err: unknown = await renderToFile(client(), input, out).catch((e: unknown) => e);
		expectIoError(err, out);
		expect(requests).toEqual([]);
	});

	it.skipIf(isWindows || isRoot)(
		'a parent directory that cannot be written is io_error, before any render',
		async () => {
			const dir = join(tempDir, 'parent-read-only');
			await mkdir(dir, { recursive: true });
			await chmod(dir, 0o555);
			try {
				const out = join(dir, 'x.pdf');
				const err: unknown = await renderToFile(client(), input, out).catch((e: unknown) => e);
				const error = expectIoError(err, out);
				expect(error.message).toBe(`Failed to write PDF: ${out}: EACCES: permission denied`);
				expect(requests).toEqual([]);
				expect(await readdir(dir)).toEqual([]);
			} finally {
				await chmod(dir, 0o755);
			}
		},
	);

	/** Asserts the refusal of a target that is not a regular file, made before any request. */
	async function expectNotRegularFile(out: string): Promise<void> {
		const err: unknown = await renderToFile(client(), input, out).catch((e: unknown) => e);
		const error = expectIoError(err, out);
		expect(error.message).toBe(`Failed to write PDF: ${out}: not a regular file`);
		expect(requests).toEqual([]);
	}

	it('a target that is a directory is io_error, before any render', async () => {
		const dir = join(tempDir, 'target-is-dir');
		await mkdir(join(dir, 'out.pdf'), { recursive: true });
		await expectNotRegularFile(join(dir, 'out.pdf'));
		expect(await readdir(dir)).toEqual(['out.pdf']);
		expect((await stat(join(dir, 'out.pdf'))).isDirectory()).toBe(true);
	});

	it.skipIf(isWindows)('a target that is a FIFO is io_error, before any render, and is not opened', async () => {
		// Opening a FIFO for writing blocks until a reader comes: a check that opened it would hang.
		const dir = join(tempDir, 'target-is-fifo');
		await mkdir(dir, { recursive: true });
		const out = join(dir, 'out.pdf');
		execFileSync('mkfifo', [out]);
		await expectNotRegularFile(out);
		expect((await lstat(out)).isFIFO()).toBe(true);
		expect(await readdir(dir)).toEqual(['out.pdf']);
	});

	it.skipIf(isWindows)('a target that is a socket is io_error, before any render', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'pp-sock-'));
		const out = join(dir, 's.pdf');
		const socketServer = createNetServer();
		await new Promise<void>((resolve) => socketServer.listen(out, resolve));
		try {
			await expectNotRegularFile(out);
			expect((await lstat(out)).isSocket()).toBe(true);
		} finally {
			await new Promise<void>((resolve) => socketServer.close(() => resolve()));
			await rm(dir, { recursive: true, force: true });
		}
	});

	it.skipIf(isWindows)('a target that is a device is io_error, before any render', async () => {
		await expectNotRegularFile('/dev/null');
	});

	it.skipIf(isWindows)('a link to a directory is io_error, before any render', async () => {
		const dir = join(tempDir, 'link-to-dir');
		await mkdir(join(dir, 'real'), { recursive: true });
		await symlink('real', join(dir, 'out.pdf'));
		await expectNotRegularFile(join(dir, 'out.pdf'));
		expect((await lstat(join(dir, 'out.pdf'))).isSymbolicLink()).toBe(true);
	});

	it('a failed rename names the target, not the temporary file, and removes the temporary file', async () => {
		const dir = join(tempDir, 'rename-fails');
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'existing.pdf'), 'old content');
		writeFault.failRename = true;
		const out = join(dir, 'existing.pdf');
		const err: unknown = await renderToFile(client(), input, out).catch((e: unknown) => e);
		const error = expectIoError(err, out);
		expect(error.message).toBe(`Failed to write PDF: ${out}: EBUSY: resource busy or locked`);
		expect((error.cause as Error).message).toContain('.tmp');
		expect(await readFile(out, 'utf8')).toBe('old content');
		expect(await readdir(dir)).toEqual(['existing.pdf']);
	});

	it('a failed write is io_error with the runtime error chained, and the target is untouched', async () => {
		const dir = join(tempDir, 'write-fails');
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'existing.pdf'), 'old content');
		writeFault.failWrites = true;
		const out = join(dir, 'existing.pdf');
		const err: unknown = await renderToFile(client(), input, out).catch((e: unknown) => e);
		const error = expectIoError(err, out);
		expect(error.message).toBe(`Failed to write PDF: ${out}: ENOSPC: no space left on device`);
		expect(await readFile(join(dir, 'existing.pdf'), 'utf8')).toBe('old content');
		expect(await readdir(dir)).toEqual(['existing.pdf']);
	});
});
