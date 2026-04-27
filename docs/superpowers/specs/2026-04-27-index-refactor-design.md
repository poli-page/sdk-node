# `src/index.ts` — `#request` Decomposition Design

**Status**: Pending user review (2026-04-27)
**Audience**: Mickael (implementer); future contributors of the Node SDK
**Companion docs**:
- `docs/superpowers/specs/2026-04-27-sdk-node-v1-design.md` — v1.0 design (locks public API + behavior)
- Platform repo: `docs/onboarding/micka/agent-guide.md` — TDD, robustness, conventions
- Platform repo: `docs/onboarding/micka/sdk-specification.md` — multi-language SDK contract

---

## 1. Goal

Decompose the ~110-line `#request` method in `src/index.ts` into named, single-purpose units so the file reads as "the SDK surface" rather than "the SDK + a fetch wrapper". The current method interleaves timeout composition, abort handling, fetch, error parsing, retry-after parsing, backoff math, hook firing, and the retry loop — eight concerns in one block.

This is a **structural refactor**. Public API, behavior, error codes, retry rules, headers, and hook semantics stay byte-identical. The existing `tests/index.test.ts` suite is the safety net: it must remain green at every commit.

---

## 2. Non-goals

- No public-API changes. `index.ts` exports stay identical.
- No new options, methods, or configuration knobs.
- No extraction of a separate `Transport` class or module — YAGNI for current size (option (c) explicitly rejected).
- No changes to `error.ts`, `types.ts`, `node.ts`, or `global.d.ts`.
- No changes to existing tests. If a test breaks, the refactor is wrong, not the test.
- No README/CHANGELOG updates (no behavior change visible to users from commits 1, 2, 4; commit 3 is a runtime-correctness fix worth a CHANGELOG line — see §7).

---

## 3. Constraints (frozen by v1.0 design + agent-guide)

| Source | Constraint |
|---|---|
| v1 design §2 | Main entry (`@poli-page/sdk`) is **isomorphic**. Node-only helpers under `@poli-page/sdk/node`. |
| v1 design §3 | All 8 spec-compliance gaps stay closed: User-Agent, Accept, PDF Content-Type validation, error-body fallback, `Retry-After` cap at 30s, 429 retry, jitter `[0.5, 1.5]` only when `Retry-After` is absent, `'invalid_options'` constructor code. |
| v1 design §4.2.7 | `PoliPageError.code` typed union with `(string & {})`; predicate semantics frozen. |
| v1 design §4.3 | Hooks fire synchronously; hook errors are caught and silently swallowed. |
| agent-guide §2 | TDD. Pure refactor commits change no tests; new helper tests come after the refactor lands. |
| agent-guide §3 | No hacks. No swallowed errors, no test-only branches, no fallbacks for impossible cases. |
| agent-guide §5 | Conventional Commits. `refactor:` for no-behavior-change. `fix:` when behavior changes. |

---

## 4. Architecture — three units inside `PoliPage`

### 4.1 Pure helpers — `src/internal/http.ts` (new file)

Module-level, no class state, no `this`, no fetch, no timers. **Not exported** from the package (`internal/` is not in `package.json` exports).

| Helper | Signature | Lifted from |
|---|---|---|
| `parseRetryAfter` | `(headerValue: string \| null) => number \| undefined` | `src/index.ts:37–51` (already pure, just moves) |
| `computeBackoff` | `(attempt: number, baseDelay: number, retryAfterMs: number \| undefined) => number` | `src/index.ts:179–186` (the inline `if/else` block) |
| `parseErrorBody` | `(body: string, status: number) => { code: string; message: string }` | `src/index.ts:248–258` (the JSON-parse-or-fallback block) |
| `buildHeaders` | `(path: string, apiKey: string, idempotencyKey: string, userAgent: string) => Record<string,string>` | the `#headers` private method |

**Behavior preservation rules**:
- `parseRetryAfter`: identical output for all current inputs (seconds, HTTP-date, past-date, malformed, missing). Cap at 30s preserved.
- `computeBackoff`: when `retryAfterMs !== undefined`, return it as-is (no jitter). Otherwise return `Math.round(baseDelay * 2^(attempt-1) * jitterFactor)` where `jitterFactor = 0.5 + Math.random()`. **Calls `Math.random()` exactly once per call** — same as today.
- `parseErrorBody`: try `JSON.parse(body)`. On success, return `{ code: json.code ?? json.message ?? json.error ?? 'unknown_error', message: json.message ?? \`API error (${status}): ${code}\` }`. On parse failure, return `{ code: 'INTERNAL_ERROR', message: \`API error ${status}: response body was not valid JSON\` }`.
- `buildHeaders`: `Accept: application/pdf` when `path === '/v1/render/pdf'`, else `application/json`. All other headers unchanged.

**Isomorphism**: helpers use only `Math.random()`, `Date.parse()`, `Number()`, `JSON.parse()`, `Math.{min,max,round,pow}`, `Number.isFinite`. No `node:*` imports.

### 4.2 `#sendOnce` — one HTTP attempt, no retry awareness

```ts
type SendOnceResult =
  | { ok: true; response: Response }
  | { ok: false; error: PoliPageError; retryAfterMs: number | undefined; retryable: boolean };

#sendOnce(
  path: string,
  body: object,
  idempotencyKey: string,
  attempt: number,
  signal: AbortSignal | undefined,
): Promise<SendOnceResult>
```

Responsibilities, in order:
1. Build timeout `AbortController`; compose with caller `signal` via `AbortSignal.any` (only when `signal` is set, else use timeout signal alone — preserves current branching).
2. Fire `onRequest({ method: 'POST', url: \`${baseUrl}${path}\`, attempt })`.
3. `t0 = Date.now()`.
4. `await fetch(...)` with composed signal. Wrapped in try/catch:
   - On thrown error, `clearTimeout(timeoutId)`.
   - If `signal?.aborted`: fire `onError`, **throw** `PoliPageError('Request was aborted', 'aborted')` directly (short-circuits the loop — same as today).
   - Else if `err.name === 'AbortError'`: return `{ ok: false, error: PoliPageError('Request timed out after ${timeout}ms', 'timeout'), retryAfterMs: undefined, retryable: true }`.
   - Else: return `{ ok: false, error: PoliPageError(err.message, 'network_error'), retryAfterMs: undefined, retryable: true }`.
5. `clearTimeout(timeoutId)`.
6. If `response.ok`: fire `onResponse({ status, requestId, durationMs: Date.now() - t0 })`, return `{ ok: true, response }`.
7. Non-2xx path: read `response.text()`, call `parseErrorBody(body, status)`, build `PoliPageError`. Compute `retryable = status >= 500 || status === 429`. If `retryable`, `retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))`. Return `{ ok: false, error, retryAfterMs, retryable }`.

**Why caller-aborts throw instead of returning**: an aborted call must terminate the loop immediately and is never retried. Returning would force the loop to special-case it; throwing models the "this is over" semantic at exactly the right boundary. This matches the current code's behavior precisely.

### 4.3 `#runWithRetry` — the loop

```ts
#runWithRetry(
  path: string,
  body: object,
  idempotencyKey: string,
  signal: AbortSignal | undefined,
): Promise<Response>
```

Responsibilities:
1. Pre-flight: if `signal?.aborted`, fire `onError`, **throw** `PoliPageError('Request was aborted', 'aborted')`. (Moved here from `#request` — keeps `#request` honest as a thin wrapper.)
2. `let lastError: PoliPageError | undefined; let nextRetryAfterMs: number | undefined;`
3. Loop `for (let attempt = 0; attempt <= this.#maxRetries; attempt++)`:
   - If `attempt > 0`: `delay = computeBackoff(attempt, this.#retryDelay, nextRetryAfterMs)`. Fire `onRetry({ attempt: attempt + 1, delayMs: delay, reason: lastError! })`. `await this.#sleep(delay, signal)`. `nextRetryAfterMs = undefined`.
   - `result = await this.#sendOnce(path, body, idempotencyKey, attempt + 1, signal)`.
   - If `result.ok`: return `result.response`.
   - Else: `lastError = result.error; nextRetryAfterMs = result.retryAfterMs`.
   - If `!result.retryable`: fire `onError(lastError)`, throw `lastError`.
   - If `attempt === this.#maxRetries`: fall through to terminal throw below.
4. Terminal: fire `onError(lastError!)`, throw `lastError!`.

### 4.4 `#request` — thin orchestrator

```ts
async #request(
  path: string,
  body: object,
  signal?: AbortSignal,
  callerIdempotencyKey?: string,
): Promise<Response> {
  const idempotencyKey = callerIdempotencyKey ?? randomUUID();
  return this.#runWithRetry(path, body, idempotencyKey, signal);
}
```

Reduces from ~110 lines to ~4. Sole responsibility: idempotency-key generation.

### 4.5 Hook firing — split between `#sendOnce` and `#runWithRetry`

| Hook | Fires from | Why |
|---|---|---|
| `onRequest` | `#sendOnce` | Per-attempt event. Belongs with the attempt. |
| `onResponse` | `#sendOnce` | Per-attempt event. Fires only on `response.ok`. |
| `onRetry` | `#runWithRetry` | Loop-level event. Reports the *next* attempt's delay + the previous attempt's error. |
| `onError` | `#runWithRetry` (and the pre-flight + caller-abort path in `#sendOnce`) | Terminal event. Fires once when the call is giving up. |

This split exactly preserves current firing order and arguments — verified against `tests/index.test.ts` "observability hooks" describe block.

---

## 5. File layout (after refactor)

```
src/
  index.ts              ~140 lines — PoliPage class
  internal/
    http.ts             ~70 lines  — pure helpers
  error.ts              unchanged
  types.ts              unchanged
  node.ts               unchanged
  global.d.ts           unchanged
tests/
  index.test.ts         unchanged through commits 1–3; possibly 1 new test in commit 3 (no-`node:*`-imports assertion)
  internal/
    http.test.ts        new in commit 4 — pure-function unit tests
```

`src/internal/` is **not** added to `package.json` `exports`. Internal-only.

---

## 6. The isomorphism fix (commit 3)

The v1 design (§2) claims main entry is isomorphic. Current `src/index.ts:8` violates that: `import { randomUUID } from 'node:crypto'` breaks on Cloudflare Workers, Vercel Edge, and any non-Node runtime.

**Fix**: replace with `globalThis.crypto.randomUUID()`. Available since Node 19; engine floor is `>=20.18.0` (v1 design §2), so this is safe across the entire supported matrix.

**Why fold this into the refactor PR rather than defer**:
- v1.0 is unpublished. Pre-publish is the cheap window.
- Shipping `1.0.0` while silently broken on edge contradicts the design's own claim and the `Uint8Array`-over-`Buffer` choice that justified isomorphism.
- The fix is ~2 lines in the same file we're already restructuring.
- "Open a follow-up issue" is procrastination — pre-1.0 is when these things get fixed cheaply.

**Commit prefix is `fix:`, not `refactor:`** — this is an additive behavior change (works in more runtimes). Conventional Commits §5 requires honesty about that.

**Belt-and-suspenders test (added in commit 3)**: a vitest case that reads `src/index.ts` and `src/internal/http.ts` from disk and asserts they contain no `import ... from 'node:` substrings. Prevents regression. ~10 lines.

---

## 7. Rollout — four commits

Each step: extract → run `pnpm lint && pnpm typecheck && pnpm test` → commit. Integration tests run via pre-push hook (or manually with `POLI_PAGE_API_KEY` set).

| # | Commit | Behavior change? | Risk |
|---|---|---|---|
| 1 | `refactor: extract pure http helpers to src/internal/http.ts` | No | Low — pure functions, no `this`. |
| 2 | `refactor: split #request into #sendOnce + #runWithRetry` | No | Medium — touches the most complex method. Existing tests verify hook order, abort short-circuit, retry-after, jitter ranges. |
| 3 | `fix: use globalThis.crypto.randomUUID for isomorphic main entry` | Yes (additive) | Low — `globalThis.crypto.randomUUID()` available since Node 19; engine floor is 20.18+. Includes 1 new test asserting no `node:*` imports in `src/index.ts` / `src/internal/`. CHANGELOG entry added. |
| 4 | `test: add unit tests for src/internal/http.ts helpers` | No | None — pure tests on pure functions. |

**Why this order**: commits 1 and 2 are pure refactors with the existing suite as safety net. Commit 3 is isolated (one fix, one new test). Commit 4 adds belt-and-suspenders coverage at the bottom of the dependency graph. `git bisect` lands cleanly on the right commit if anything breaks.

---

## 8. Verification gates

Per commit (1, 2, 3):
- `pnpm lint` — clean
- `pnpm typecheck` — clean
- `pnpm test` — all existing tests pass
- `pnpm test:integration` (if `POLI_PAGE_API_KEY` set) — passes

After commit 4:
- All of the above
- New helper tests pass

---

## 9. Open questions

None. The one decision point flagged earlier (`#sendOnce` tagged-union return vs throwing) was resolved in favor of the tagged union — exceptions-as-control-flow on the retry hot path is exactly the readability problem this refactor is solving. Caller-aborts remain the one exception (literal): they throw, because they short-circuit the loop and are never retried.

---

## 10. What this design intentionally does NOT include

- A separate `Transport` module / class (option (c) — YAGNI for current 288-line file)
- Public API changes — frozen by v1.0 design
- New options, hooks, or configuration
- Changes to `error.ts`, `types.ts`, `node.ts`, `global.d.ts`
- Restructuring of `tests/index.test.ts` — it stays as-is
- README / docs site updates (commit 3's CHANGELOG line is the only doc change)
