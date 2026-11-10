import { describe, it, expect, vi, afterEach } from 'vitest';
import { startTimer } from '../../src/internal/timer.js';
import { PoliPage } from '../../src/index.js';

/** Makes every timer wake `earlyMs` before its delay, like a coarse clock tick. */
function fireEarly(earlyMs: number): void {
	const real = globalThis.setTimeout;
	vi.stubGlobal('setTimeout', (fn: () => void, ms?: number) =>
		real(fn, Math.max(0, (ms ?? 0) - earlyMs))
	);
}

/** Makes every timer wake at half its delay. */
function wakeAtHalf(): void {
	const real = globalThis.setTimeout;
	vi.stubGlobal('setTimeout', (fn: () => void, ms?: number) => real(fn, (ms ?? 0) / 2));
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/**
 * Replaces `setTimeout` with one that only records each delay and keeps the
 * last callback, and `performance.now` with a clock the test sets: the test
 * wakes the timer itself, at the time it chooses.
 */
function manualTimers() {
	const clock = { now: 0 };
	const delays: number[] = [];
	let callback: (() => void) | undefined;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	vi.stubGlobal('setTimeout', (fn: () => void, ms?: number) => {
		delays.push(ms ?? 0);
		callback = fn;
		return delays.length;
	});
	return {
		clock,
		delays,
		wake: () => callback?.(),
	};
}

const client = (timeout: number) =>
	new PoliPage({
		apiKey: 'pp_sandbox_00000000000000000000000000000000',
		maxRetries: 0,
		timeout,
	});

/** A `fetch` that never answers until its signal aborts. */
function hangUntilAbort(init: RequestInit | undefined): Promise<never> {
	return new Promise((_resolve, reject) => {
		init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
	});
}

const PRESIGNED_URL = 'https://storage.test/doc_1.pdf';

/** The `POST /v1/render` answer: a descriptor whose PDF is at `PRESIGNED_URL`. */
function renderAnswer(): Response {
	return new Response(
		JSON.stringify({
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
			presignedPdfUrl: PRESIGNED_URL,
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	);
}

const input = { project: 'p', template: 't', data: {} };

describe('startTimer (R-WAIT-FULL)', () => {
	it('fires no sooner than the delay when the underlying timer wakes early', async () => {
		fireEarly(5);
		const t0 = performance.now();
		const fired = await new Promise<number>((resolve) => {
			startTimer(40, () => resolve(performance.now() - t0));
		});
		expect(fired).toBeGreaterThanOrEqual(40);
	});

	it('does not fire once cancelled', async () => {
		fireEarly(5);
		const onFire = vi.fn();
		const cancel = startTimer(20, onFire);
		cancel();
		await new Promise((r) => setTimeout(r, 60));
		expect(onFire).not.toHaveBeenCalled();
	});

	it('does not fire once cancelled after it re-armed', async () => {
		// Wake 5 ms early, and tell the test when the timer re-arms for the rest.
		const real = globalThis.setTimeout;
		let calls = 0;
		let reArmed!: () => void;
		const reArm = new Promise<void>((resolve) => (reArmed = resolve));
		vi.stubGlobal('setTimeout', (fn: () => void, ms?: number) => {
			calls += 1;
			if (calls === 2) reArmed();
			return real(fn, Math.max(0, (ms ?? 0) - 5));
		});
		const onFire = vi.fn();
		const cancel = startTimer(40, onFire);
		await reArm;
		cancel();
		await new Promise((r) => real(r, 60));
		expect(onFire).not.toHaveBeenCalled();
	});

	it('waits a delay above the setTimeout maximum in chunks of the maximum', () => {
		const timers = manualTimers();
		const onFire = vi.fn();
		startTimer(3e9, onFire);
		expect(timers.delays).toEqual([MAX_TIMER_DELAY_MS]);
		timers.clock.now = MAX_TIMER_DELAY_MS;
		timers.wake();
		expect(timers.delays).toEqual([MAX_TIMER_DELAY_MS, 3e9 - MAX_TIMER_DELAY_MS]);
		expect(onFire).not.toHaveBeenCalled();
		timers.clock.now = 3e9;
		timers.wake();
		expect(onFire).toHaveBeenCalledOnce();
	});

	it('re-arms an infinite delay with the maximum, never fires it', () => {
		const timers = manualTimers();
		const onFire = vi.fn();
		startTimer(Infinity, onFire);
		for (let i = 1; i <= 3; i++) {
			timers.clock.now = i * MAX_TIMER_DELAY_MS;
			timers.wake();
		}
		expect(timers.delays).toEqual(Array(4).fill(MAX_TIMER_DELAY_MS));
		expect(onFire).not.toHaveBeenCalled();
	});
});

describe('the attempt timeout (R-WAIT-FULL)', () => {
	it('ends an attempt no sooner than the timeout when timers wake early', async () => {
		fireEarly(5);
		vi.stubGlobal(
			'fetch',
			(_url: string, init: RequestInit) =>
				new Promise((_resolve, reject) => {
					init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
				})
		);
		const t0 = performance.now();
		await expect(client(60).documents.get('doc_1')).rejects.toMatchObject({ code: 'timeout' });
		expect(performance.now() - t0).toBeGreaterThanOrEqual(60);
	});
});

describe('the download timeout (R-WAIT-FULL)', () => {
	// Timers wake at half their delay: a plain `setTimeout` would end the
	// download after 100 ms, far short of the timeout even with the time from
	// `t0` to the start of the download timer added.
	const TIMEOUT_MS = 200;
	const downloadFailed = { code: 'DOWNLOAD_FAILED', message: 'Failed to download PDF: timeout' };

	it('ends a render.pdf download no sooner than the timeout when timers wake early', async () => {
		wakeAtHalf();
		// Taken when the render is sent, so before the download timer starts.
		let t0 = 0;
		vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
			if (url === PRESIGNED_URL) return hangUntilAbort(init);
			t0 = performance.now();
			return Promise.resolve(renderAnswer());
		});
		await expect(client(TIMEOUT_MS).render.pdf(input)).rejects.toMatchObject(downloadFailed);
		expect(performance.now() - t0).toBeGreaterThanOrEqual(TIMEOUT_MS);
	});

	it('ends a render.pdfStream idle wait no sooner than the timeout when timers wake early', async () => {
		wakeAtHalf();
		// The first chunk arrives at once, then the body stalls until the
		// download is aborted.
		vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
			if (url !== PRESIGNED_URL) return Promise.resolve(renderAnswer());
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array([0x25]));
					init?.signal?.addEventListener('abort', () =>
						controller.error(new Error('aborted'))
					);
				},
			});
			return Promise.resolve(new Response(body, { status: 200 }));
		});
		const reader = (await client(TIMEOUT_MS).render.pdfStream(input)).getReader();
		// Taken before the first read, which asks the stream for the next chunk
		// and so starts the idle wait.
		const t0 = performance.now();
		expect((await reader.read()).value).toEqual(new Uint8Array([0x25]));
		await expect(reader.read()).rejects.toMatchObject(downloadFailed);
		expect(performance.now() - t0).toBeGreaterThanOrEqual(TIMEOUT_MS);
	});
});
