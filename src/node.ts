import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
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
 * The PDF is written to a temporary file next to `outputPath` and renamed over
 * it only once complete, so a failure (the render, the download or the write)
 * leaves the target untouched: an existing file keeps its content and a
 * missing one is not created. The directory and the temporary file are
 * prepared before the render, so a path that cannot be written costs no
 * render.
 *
 * A file that cannot be written (creating a parent directory, opening,
 * writing or moving it into place) raises a `PoliPageError` with code
 * `io_error`, no `status`, the message `Failed to write PDF: <reason>` (the
 * runtime's own error text) and the file system error as `cause`. It is never
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
	const directory = dirname(outputPath);
	await io(() => mkdir(directory, { recursive: true }));
	const tempPath = join(directory, `.${basename(outputPath)}.${randomUUID()}.tmp`);
	const file = await io(() => open(tempPath, 'wx'));
	let fileOpen = true;
	let renamed = false;
	try {
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
		await io(() => rename(tempPath, outputPath));
		renamed = true;
	} finally {
		if (!renamed) {
			if (fileOpen) await file.close().catch(() => {});
			await rm(tempPath, { force: true }).catch(() => {});
		}
	}
}
