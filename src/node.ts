import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
	access,
	lstat,
	mkdir,
	open,
	readlink,
	realpath,
	rename,
	rm,
	stat,
	type FileHandle,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { PoliPageError } from './error.js';
import type { PoliPage } from './index.js';
import type { RenderInput } from './types.js';

/**
 * The runtime's own text for `err`, without the paths Node appends to a
 * system error (`EACCES: permission denied, open '<path>'` gives
 * `EACCES: permission denied`), so the message never names the temporary
 * file. Other errors keep their whole message.
 */
function reasonOf(err: unknown): string {
	if (!(err instanceof Error)) return String(err);
	const { syscall } = err as NodeJS.ErrnoException;
	const end = syscall === undefined ? -1 : err.message.indexOf(`, ${syscall}`);
	return end > 0 ? err.message.slice(0, end) : err.message;
}

/**
 * `io_error`: the file at `outputPath` could not be written. The message names
 * the path the caller passed, never the temporary file:
 * `Failed to write PDF: <outputPath>: <reason>`.
 */
function ioError(outputPath: string, err: unknown): PoliPageError {
	return new PoliPageError(
		`Failed to write PDF: ${outputPath}: ${reasonOf(err)}`,
		'io_error',
		undefined,
		undefined,
		{ cause: err },
	);
}

/** Runs one file system step, turning its failure into `io_error` for `outputPath`. */
async function io<T>(outputPath: string, step: () => Promise<T>): Promise<T> {
	try {
		return await step();
	} catch (err) {
		throw ioError(outputPath, err);
	}
}

/** True when `err` is a Node system error with this `code`. */
function hasCode(err: unknown, code: string): boolean {
	return err instanceof Error && (err as NodeJS.ErrnoException).code === code;
}

/** Symbolic links followed before giving up, like the OS's own loop limit. */
const MAX_SYMLINK_HOPS = 40;

/**
 * The file a write to `path` must replace: `path` itself, or, when it is a
 * symbolic link, the file the link points to (even when that file does not
 * exist yet), so the link stays a link. An existing file is its real path.
 * For a missing one, the links are followed one by one, each resolved from
 * the link's real directory as the OS does, so a `..` in a link reached
 * through a symlinked directory names the right place.
 */
async function resolveTarget(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch (err) {
		if (!hasCode(err, 'ENOENT')) throw err;
	}
	let current = resolve(path);
	for (let hops = 0; hops < MAX_SYMLINK_HOPS; hops++) {
		try {
			if (!(await lstat(current)).isSymbolicLink()) return current;
		} catch (err) {
			if (hasCode(err, 'ENOENT')) return current;
			throw err;
		}
		// The link exists, so its directory does too.
		current = resolve(await realpath(dirname(current)), await readlink(current));
	}
	throw Object.assign(new Error('ELOOP: too many symbolic links encountered'), {
		code: 'ELOOP',
	});
}

/**
 * Checks the existing file at `path` before any render, from its attributes
 * only: it is never opened, since opening a FIFO blocks. A file that is not a
 * regular file (a directory, FIFO, device or socket) fails with
 * `not a regular file`, since the rename would replace it with a regular
 * file; a regular file that cannot be written (read-only) fails as opening it
 * for writing would, since the rename could replace it anyway. `stat` and
 * `access` follow the links the way opening `path` would.
 *
 * Returns the permission bits the new file takes, without setuid, setgid or
 * sticky, or `undefined` when nothing exists at `path`.
 */
async function checkExistingTarget(path: string): Promise<number | undefined> {
	let stats;
	try {
		stats = await stat(path);
	} catch (err) {
		if (hasCode(err, 'ENOENT')) return undefined;
		throw err;
	}
	if (!stats.isFile()) throw new Error('not a regular file');
	await access(path, constants.W_OK);
	return stats.mode & 0o777;
}

/** Fails unless `path` is a directory this process can create files in. */
async function checkParentDirectory(path: string): Promise<void> {
	if (!(await stat(path)).isDirectory()) {
		throw Object.assign(new Error('ENOTDIR: not a directory'), { code: 'ENOTDIR' });
	}
	await access(path, constants.W_OK);
}

/** Writes all of `chunk`, looping over short writes. */
async function writeAll(file: FileHandle, chunk: Uint8Array): Promise<void> {
	let offset = 0;
	while (offset < chunk.byteLength) {
		const { bytesWritten } = await file.write(chunk, offset, chunk.byteLength - offset);
		offset += bytesWritten;
	}
}

/**
 * Render a PDF and write it to disk. Streams response bytes to the file
 * (memory-bounded). Creates parent directories. Overwrites existing files.
 *
 * The PDF is written to a temporary file next to the target and renamed over
 * it only once complete, so a failure (the render, the download or the write)
 * leaves the target untouched: an existing file keeps its content and a
 * missing one is not created. When `outputPath` is a symbolic link, the
 * target is the file it points to and the link stays as it is.
 *
 * Everything that can be checked is checked before the render, so a path that
 * cannot be written costs no render: the parent directories are created and
 * must be a directory this process can write; an existing target must be a
 * regular file (a directory, FIFO, socket or device such as `/dev/stdout` is
 * refused with the reason `not a regular file`) and writable (a read-only
 * file is refused). The target is never opened for these checks. To write a
 * PDF to a pipe or to stdout, read `client.render.pdfStream` into it instead.
 *
 * An existing target keeps its permission bits, without setuid, setgid or
 * sticky. Since it is replaced by a new file, its owner and group are those
 * of the running process, and hard links to the old file keep the old
 * content.
 *
 * A file that cannot be written raises a `PoliPageError` with code
 * `io_error`, no `status`, and a message made of `Failed to write PDF: `,
 * `outputPath` as passed (never the temporary file), `: ` and Node's own
 * error text without its paths, for example
 * `Failed to write PDF: ./out/a.pdf: EACCES: permission denied`. The file
 * system error is the `cause`. It is never retryable. Errors of the render
 * and of the download are thrown unchanged.
 *
 * Node-only — uses `node:fs/promises`. Import from `@poli-page/sdk/node`
 * rather than the main entry.
 *
 * @example
 * ```ts
 * import { PoliPage } from '@poli-page/sdk';
 * import { renderToFile } from '@poli-page/sdk/node';
 *
 * const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });
 * await renderToFile(
 *   client,
 *   { project: 'billing', template: 'invoice', data: { invoiceNumber: 'INV-001' } },
 *   './invoices/INV-001.pdf',
 * );
 * ```
 */
export async function renderToFile(
	client: PoliPage,
	input: RenderInput,
	outputPath: string,
): Promise<void> {
	const fail = <T>(step: () => Promise<T>): Promise<T> => io(outputPath, step);
	await fail(() => mkdir(dirname(outputPath), { recursive: true }));
	const target = await fail(() => resolveTarget(outputPath));
	const mode = await fail(() => checkExistingTarget(outputPath));
	const directory = dirname(target);
	await fail(() => mkdir(directory, { recursive: true }));
	await fail(() => checkParentDirectory(directory));
	const tempPath = join(directory, `.${basename(target)}.${randomUUID()}.tmp`);
	const file = await fail(() => open(tempPath, 'wx'));
	let fileOpen = true;
	let renamed = false;
	try {
		if (mode !== undefined) await fail(() => file.chmod(mode));
		const reader = (await client.render.pdfStream(input)).getReader();
		for (;;) {
			// A read failure is the download's own error (`DOWNLOAD_FAILED`, `aborted`).
			const { done, value } = await reader.read();
			if (done) break;
			try {
				await writeAll(file, value);
			} catch (err) {
				await reader.cancel().catch(() => {});
				throw ioError(outputPath, err);
			}
		}
		fileOpen = false;
		await fail(() => file.close());
		await fail(() => rename(tempPath, target));
		renamed = true;
	} finally {
		if (!renamed) {
			if (fileOpen) await file.close().catch(() => {});
			await rm(tempPath, { force: true }).catch(() => {});
		}
	}
}
