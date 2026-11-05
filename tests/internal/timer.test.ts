import { describe, it, expect, vi, afterEach } from 'vitest';
import { startTimer } from '../../src/internal/timer.js';
import { PoliPage } from '../../src/index.js';

/** Makes every timer wake `earlyMs` before its delay, like a coarse clock tick. */
function fireEarly(earlyMs: number): void {
	const real = globalThis.setTimeout;
	vi.stubGlobal('setTimeout', ((fn: () => void, ms?: number) =>
		real(fn, Math.max(0, (ms ?? 0) - earlyMs))));
}

afterEach(() => vi.unstubAllGlobals());

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
});

describe('the attempt timeout (R-WAIT-FULL)', () => {
	it('ends an attempt no sooner than the timeout when timers wake early', async () => {
		fireEarly(5);
		vi.stubGlobal('fetch', (_url: string, init: RequestInit) =>
			new Promise((_resolve, reject) => {
				init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
			}));
		const client = new PoliPage({
			apiKey: 'pp_sandbox_00000000000000000000000000000000',
			maxRetries: 0,
			timeout: 60,
		});
		const t0 = performance.now();
		await expect(client.documents.get('doc_1')).rejects.toMatchObject({ code: 'timeout' });
		expect(performance.now() - t0).toBeGreaterThanOrEqual(60);
	});
});
