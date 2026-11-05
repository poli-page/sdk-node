/**
 * A timer that never fires early (SDK specification §9.4, `R-WAIT-FULL`).
 *
 * A `setTimeout` can wake up to about 1 ms before its delay (more on coarse
 * timer ticks). This one checks a monotonic clock when it wakes and waits
 * again for what is left, so `onFire` runs no sooner than `ms` after the
 * call. Returns a function that cancels it.
 */
export function startTimer(ms: number, onFire: () => void): () => void {
	const end = performance.now() + ms;
	let timer: ReturnType<typeof setTimeout>;
	const wake = () => {
		const left = end - performance.now();
		if (left > 0) {
			timer = setTimeout(wake, Math.ceil(left));
		} else {
			onFire();
		}
	};
	timer = setTimeout(wake, ms);
	return () => clearTimeout(timer);
}
