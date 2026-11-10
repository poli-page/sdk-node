/**
 * The longest delay `setTimeout` takes (2^31 − 1 ms, about 24.8 days). Node
 * replaces a longer one with 1 ms and warns `TimeoutOverflowWarning`.
 */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/**
 * A timer that never fires early (SDK specification §9.4, `R-WAIT-FULL`).
 *
 * A `setTimeout` can wake up to about 1 ms before its delay (more on coarse
 * timer ticks). This one checks a monotonic clock when it wakes and waits
 * again for what is left, so `onFire` runs no sooner than `ms` after the
 * call. A delay longer than `setTimeout` takes is waited in chunks of the
 * longest one, so `Infinity` never fires. Returns a function that cancels it.
 */
export function startTimer(ms: number, onFire: () => void): () => void {
	const end = performance.now() + ms;
	let timer: ReturnType<typeof setTimeout>;
	const wait = (delay: number) => {
		timer = setTimeout(wake, Math.min(delay, MAX_TIMER_DELAY_MS));
	};
	const wake = () => {
		const left = end - performance.now();
		if (left > 0) {
			wait(Math.ceil(left));
		} else {
			onFire();
		}
	};
	wait(ms);
	return () => clearTimeout(timer);
}
