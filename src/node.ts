import { randomUUID } from 'node:crypto';
import {
	lstat,
	mkdir,
	open,
	readlink,
	rename,
	rm,
	stat,
	type FileHandle,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { PoliPageError } from './error.js';
import type { PoliPage } from './index.js';
import type { RenderInput } from './types.js';

/** `io_error`: the file could not be written. `reason` is the runtime's own error text. */
function ioError(err: unknown): PoliPageError {
	const reason = err instanceof Error ? err.message : String(err);
	return new PoliPageError(`Failed to write PDF: ${reason}`, 'io_error', undefined, undefined, {
		cause: err,
	});
}

/** Runs one file system step, turning its failure into `io_error`. */
async function io<T>(step: () => Promise<T>): Promise<T> {
	try {
		return await step();
	} catch (err) {
		throw ioError(err);
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
 * symbolic link, the file the link points to (followed link by link, even
 * when that file does not exist yet), so the link stays a link.
 */
async function resolveTarget(path: string): Promise<string> {
	let current = resolve(path);
	for (let hops = 0; hops < MAX_SYMLINK_HOPS; hops++) {
		try {
			if (!(await lstat(current)).isSymbolicLink()) return current;
		} catch (err) {
			if (hasCode(err, 'ENOENT')) return current;
			throw err;
		}
		current = resolve(dirname(current), await readlink(current));
	}
	throw Object.assign(new Error(`ELOOP: too many symbolic links encountered, '${path}'`), {
		code: 'ELOOP',
	});
}

/** The permission bits of the file at `path`, or `undefined` when it is not a file. */
async function fileMode(path: string): Promise<number | undefined> {
	try {
		const stats = await stat(path);
		return stats.isFile() ? stats.mode & 0o7777 : undefined;
	} catch (err) {
		if (hasCode(err, 'ENOENT')) return undefined;
		throw err;
	}
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
 * missing one is not created. The directory and the temporary file are
 * prepared before the render, so a path that cannot be written costs no
 * render. When `outputPath` is a symbolic link, the target is the file it
 * points to and the link stays as it is. An existing target keeps its
 * permission bits; since it is replaced by a new file, its owner is the
 * caller's and hard links to the old file keep the old content.
 *
 * A file that cannot be written (creating a parent directory, opening,
 * writing or moving it into place) raises a `PoliPageError` with code
 * `io_error`, no `status`, the message `Failed to write PDF: ` followed by the
 * runtime's own error text, and the file system error as `cause`. It is never
 * retryable. Errors of the render and of the download are thrown unchanged.
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
	await io(() => mkdir(dirname(outputPath), { recursive: true }));
	const target = await io(() => resolveTarget(outputPath));
	const directory = dirname(target);
	await io(() => mkdir(directory, { recursive: true }));
	const mode = await io(() => fileMode(target));
	const tempPath = join(directory, `.${basename(target)}.${randomUUID()}.tmp`);
	const file = await io(() => open(tempPath, 'wx'));
	let fileOpen = true;
	let renamed = false;
	try {
		if (mode !== undefined) await io(() => file.chmod(mode));
		const reader = (await client.render.pdfStream(input)).getReader();
		for (;;) {
			// A read failure is the download's own error (`DOWNLOAD_FAILED`, `aborted`).
			const { done, value } = await reader.read();
			if (done) break;
			try {
				await writeAll(file, value);
			} catch (err) {
				await reader.cancel().catch(() => {});
				throw ioError(err);
			}
		}
		fileOpen = false;
		await io(() => file.close());
		await io(() => rename(tempPath, target));
		renamed = true;
	} finally {
		if (!renamed) {
			if (fileOpen) await file.close().catch(() => {});
			await rm(tempPath, { force: true }).catch(() => {});
		}
	}
}
