# `@poli-page/sdk` — v1.0.0 Design

**Status**: Approved (2026-04-27)
**Audience**: Mickael (implementer); future contributors of the Node SDK
**Companion docs** (platform repo, `docs/onboarding/micka/`):
- `agent-guide.md` — methodology, conventions, CI rules
- `sdk-specification.md` — multi-language SDK contract
- `sdk-roadmap.md` — what to build, in which order
**Public SDK docs**: https://docs-develop.poli.page/reference/sdk

---

## 1. Goal

Take `@poli-page/sdk` from **0.1.0 (unpublished scaffold)** to **1.0.0 (published, production-ready, contract-stable)** so it can serve as the reference implementation for the other 9 SDK repos and as the dependency for the Node framework integrations (`@poli-page/nextjs`, `@poli-page/nestjs`).

**Out of scope** (deferred to subsequent phases per `sdk-roadmap.md`):
- Recipes / examples (P0 0.1)
- Framework integrations (P0 0.2 / 0.3)
- Browser / edge-runtime first-class support
- Telemetry middleware / OpenTelemetry / interceptor pipelines
- Release automation beyond manual tag-driven publishing

---

## 2. Locked decisions

These were validated during brainstorming and are now frozen for v1.0.0.

| Topic | Decision |
|---|---|
| **Scope** | SDK core only (P0 0.0). Recipes deferred. |
| **Runtime support** | `engines.node: ">=20.18.0"`. CI matrix: Node 20, 22, 24. |
| **Module format** | Dual ESM + CJS via `exports` map. Built with **tsup**. |
| **Binary type** | `Uint8Array` everywhere in the public API (replaces `Buffer`). |
| **Public API split** | Main entry (`@poli-page/sdk`) is isomorphic. Node-only helpers under `@poli-page/sdk/node`. |
| **Render input typing** | Discriminated union: `RenderInput = ProjectModeInput \| InlineModeInput`. |
| **Cancellation** | Per-call `signal?: AbortSignal`, composed with internal timeout via `AbortSignal.any`. New error code: `'aborted'`. |
| **Retry policy** | Honor `Retry-After` (cap 30s); full jitter on exponential backoff (`× [0.5, 1.5]`); retry on 429 in addition to 5xx, network, timeout. |
| **Errors** | Single `PoliPageError` class (spec-compliant). Typed `code` union with `(string & {})` for forward-compat. Helper predicates: `isAuthError`, `isRateLimitError`, `isRetryable`, `isNetworkError`, `isValidationError`. |
| **Streaming** | New `renderStream(input) → ReadableStream<Uint8Array>`. `renderToFile` rebuilt on top of it for bounded memory. |
| **Observability** | Optional hooks in `PoliPageOptions`: `onRequest`, `onResponse`, `onRetry`, `onError`. |
| **Idempotency** | Auto-generated UUID v4 `Idempotency-Key` per call. Reused across retries of the same call. User-overridable via `RenderInput.idempotencyKey`. |
| **Release** | Tag-driven `pnpm publish` GitHub Actions workflow. Manual version bump and CHANGELOG edit. |
| **Documentation** | README-only in the repo (~150–200 lines). Deep content lives at https://docs-develop.poli.page/reference/sdk. No `docs/` folder for end-users. |
| **Integration tests** | `tests/integration/`, env-gated via `POLI_PAGE_API_KEY`. Pre-push hook (`simple-git-hooks`) runs unit + integration. `SKIP_INTEGRATION=1 git push` bypass. No nightly. |
| **Lint / format** | ESLint flat config (`@eslint/js` + `typescript-eslint` recommended-type-checked) + Prettier. |

---

## 3. Spec compliance gaps (current 0.1.0 violates these)

These are correctness bugs against `sdk-specification.md` (and `agent-guide.md`). Non-negotiable for v1.0.0.

| # | Gap | Reference | Required fix |
|---|---|---|---|
| 1.1 | `User-Agent` header missing | spec §8.1 | Send `poli-page-sdk-node/<version>`. Version pulled from `package.json` at build time (e.g. injected as a `const` via tsup `define`, or read at module init). |
| 1.2 | `Accept` header missing | spec §8.1 | `application/pdf` for `render`/`renderStream`; `application/json` for `preview`/`thumbnails`. |
| 1.3 | PDF response Content-Type not validated | spec §8.3 | If a 2xx `/render/pdf` response Content-Type ≠ `application/pdf`, throw `PoliPageError` with `code: 'INTERNAL_ERROR'`. |
| 1.4 | Non-2xx without parseable JSON falls back wrong | spec §8.3 | When JSON parsing fails on an error body, set `code: 'INTERNAL_ERROR'` (not the raw body string), include HTTP status. |
| 1.5 | `Retry-After` not honored | agent-guide §2 | Parse header in seconds or HTTP-date format. Use as next delay, capped at 30s. If HTTP-date is already in the past, treat as `0` (retry immediately). Falls back to exponential backoff when absent. **When `Retry-After` is present, use it as-is — no jitter is applied** (the server is being explicit). |
| 1.6 | 429 not retried | (spec deviation we are fixing) | Retry 429 like 5xx. **Update `sdk-specification.md` §7.1.** |
| 1.7 | No jitter on backoff | (spec addition we are making) | Multiply the exponential-backoff delay (`retryDelay × 2^N`) by a random factor in `[0.5, 1.5]`. Jitter applies **only when `Retry-After` is absent**. **Update `sdk-specification.md` §7.2.** |
| 1.8 | Constructor error code conflicts with API code | spec §6.4 | Throw `'invalid_options'` when `apiKey` is missing/empty (not `'invalid_api_key'`, which is a 401 API code). **Reserve `'aborted'`, `'invalid_options'` in spec §6.4.** |

**Spec doc updates required** (in the platform repo, `docs/onboarding/micka/sdk-specification.md`):
- §6.4 — add `aborted` and `invalid_options` to reserved SDK-internal codes
- §7.1 — add 429 to retryable statuses; clarify "and `Retry-After` is honored when present"
- §7.2 — note jitter (multiply delay by random factor in `[0.5, 1.5]`)

---

## 4. Public API additions (the breaking-change window)

Pre-1.0 is the only window for breaking changes. The 9 items below define the v1.0.0 public surface.

| # | Change | Rationale |
|---|---|---|
| 2.1 | `render()` returns `Promise<Uint8Array>` (was `Promise<Buffer>`) | Isomorphic primitive. Node consumers can still do `Buffer.from(uint8)`. |
| 2.2 | `RenderInput = ProjectModeInput \| InlineModeInput` (discriminated union) | Compile-time validation of project-vs-inline mode. |
| 2.3 | `renderToFile` moves to sub-export `@poli-page/sdk/node` | Keep main entry isomorphic; isolate Node-only filesystem dependency. |
| 2.4 | New method `renderStream(input) → Promise<ReadableStream<Uint8Array>>` | Bounded memory for large PDFs; powers `renderToFile`. |
| 2.5 | New per-call option `signal?: AbortSignal` | Caller cancellation. Composed with internal timeout via `AbortSignal.any`. |
| 2.6 | New per-call option `idempotencyKey?: string` (auto-generated UUID v4 if omitted) | Forward-compat with API-side dedup; safe under retries. |
| 2.7 | `PoliPageError.code: KnownCode \| (string & {})` + helper predicates | Autocomplete on known codes, forward-compat for new ones, ergonomic checks. |
| 2.8 | New `PoliPageOptions` hooks: `onRequest`, `onResponse`, `onRetry`, `onError` | Observability without locking to a vendor. All optional, all sync. Hook errors must not break the request. |
| 2.9 | Constructor missing-key error code: `'invalid_options'` (was `'invalid_api_key'`) | See §3.1.8. |

### 4.1 `PoliPageError.code` known-code union

```ts
type KnownCode =
  // SDK-internal (lowercase reserved):
  | 'invalid_options'
  | 'network_error'
  | 'timeout'
  | 'aborted'
  // API-originated (passed through verbatim, conventionally uppercase):
  | 'INVALID_API_KEY'
  | 'MISSING_API_KEY'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'MISSING_DATA'
  | 'MISSING_PROJECT_OR_TEMPLATE'
  | 'MISSING_TEMPLATE_SLUG'
  | 'INTERNAL_ERROR';

export type PoliPageErrorCode = KnownCode | (string & {});
```

### 4.2 Helper predicate semantics

| Predicate | Returns true when |
|---|---|
| `isAuthError()` | `status === 401 \|\| status === 403` |
| `isRateLimitError()` | `status === 429` |
| `isValidationError()` | `status === 400` |
| `isNetworkError()` | `code === 'network_error' \|\| code === 'timeout'` |
| `isRetryable()` | 5xx status, 429 status, `network_error`, or `timeout`. **Does not include `aborted`** — caller cancellation is intentional. |

### 4.3 Hook signatures

```ts
interface RequestEvent  { method: string; url: string; attempt: number; }
interface ResponseEvent { status: number; requestId?: string; durationMs: number; }
interface RetryEvent    { attempt: number; delayMs: number; reason: PoliPageError; }

interface PoliPageOptions {
  // ... existing options ...
  onRequest?:  (e: RequestEvent)  => void;
  onResponse?: (e: ResponseEvent) => void;
  onRetry?:    (e: RetryEvent)    => void;
  onError?:    (err: PoliPageError) => void;
}
```

Hooks fire synchronously. Errors thrown from hooks are caught and silently swallowed (the SDK MUST NOT let observability break the call).

---

## 5. Tooling, build & repo hygiene (Section 3 from brainstorm)

| # | Item | Concrete deliverable |
|---|---|---|
| 3.1 | CI workflow | `.github/workflows/ci.yml`: matrix Node 20/22/24 on `ubuntu-latest`. Steps: install (pnpm) → lint → typecheck → test → build → pack-smoke. Auto-skip pattern (no manifest → friendly skip). |
| 3.2 | Publish workflow | `.github/workflows/publish.yml`: triggers on `v*.*.*` tag. Runs full CI then `pnpm publish --access public` with `NODE_AUTH_TOKEN` secret. |
| 3.3 | Dual ESM+CJS build | Replace `tsc` with `tsup`. Outputs: `dist/index.js` (ESM), `dist/index.cjs` (CJS), `dist/index.d.ts`, `dist/index.d.cts`, plus `dist/node.*` for the sub-export. Sourcemaps on. |
| 3.4 | `package.json` `sideEffects` | `"sideEffects": false` for tree-shaking. |
| 3.5 | ESLint flat config | `eslint.config.js`: `@eslint/js` recommended + `typescript-eslint` recommended-type-checked. `pnpm lint` script. |
| 3.6 | Pre-push hook | `simple-git-hooks` dev dep. `"simple-git-hooks": { "pre-push": "pnpm test && [ -n \"$SKIP_INTEGRATION\" ] || pnpm test:integration" }`. `prepare` script auto-installs hook on `pnpm install`. |
| 3.7 | `npm pack` smoke | CI step: `pnpm pack && tar -tf *.tgz` and assert `dist/`, `README.md`, `LICENSE`, `package.json` are present. |
| 3.8 | Bundle-size budget | `pkg-size` check in CI: warn if package > 50KB minified+gzipped. |
| 3.9 | Engines floor | `engines.node: ">=20.18.0"`. Drop `@types/node` to `^20.x`. Add `.nvmrc` with `20.18.0`. |
| 3.10 | Repo files | Add `SECURITY.md` (vuln reporting → security@poli.page) and `CONTRIBUTING.md` (5-line: TDD, conventional commits, `pnpm test`). No `CODE_OF_CONDUCT.md`, no issue/PR templates. |

---

## 6. Test plan

Target ~54 tests for v1.0.0 (existing 11 + ~43 new).

### 6.1 Unit-test additions (`tests/index.test.ts`)

**Constructor & options**
- `'throws PoliPageError with code "invalid_options" when apiKey is missing'`
- `'uses DEFAULT_BASE_URL when baseUrl is omitted'`
- `'uses DEFAULT_TIMEOUT when timeout is omitted'`

**HTTP transport (spec §8.1)**
- `'sends User-Agent header in the form poli-page-sdk-node/<version>'`
- `'sends Accept: application/pdf for render'`
- `'sends Accept: application/json for preview'`
- `'sends Accept: application/json for thumbnails'`
- `'sends Content-Type: application/json on every POST'`

**Idempotency**
- `'auto-generates an Idempotency-Key header (UUID v4 format)'`
- `'reuses the same Idempotency-Key across retry attempts of one call'`
- `'uses caller-provided idempotencyKey when set'`

**Retry policy**
- `'retries on 429 with Retry-After delay'`
- `'caps Retry-After at 30 seconds'`
- `'parses Retry-After in HTTP-date format, not just seconds'`
- `'treats past-dated Retry-After as immediate retry'`
- `'does not apply jitter when Retry-After is present (server-explicit)'`
- `'applies jitter to exponential backoff when Retry-After is absent (delay falls in [0.5×, 1.5×] range)'`
- `'retries on network errors (ECONNRESET, ENOTFOUND)'`
- `'retries on timeout (AbortError from internal controller)'`
- `'maxRetries: 0 disables retries entirely'`
- `'computes exponential backoff: 500ms, 1000ms, 2000ms (without jitter component)'`

**Error mapping**
- `'maps non-2xx JSON body to PoliPageError with code from response'`
- `'maps non-2xx HTML body to PoliPageError with code "INTERNAL_ERROR" and the HTTP status'`
- `'rejects 2xx render response if Content-Type is not application/pdf'`
- `'PoliPageError.isAuthError() returns true for status 401 and 403'`
- `'PoliPageError.isRateLimitError() returns true for status 429'`
- `'PoliPageError.isRetryable() returns true for 5xx, 429, network_error, timeout'`
- `'PoliPageError.isNetworkError() returns true for code "network_error" and "timeout"'`
- `'PoliPageError.isValidationError() returns true for status 400'`

**Cancellation**
- `'aborts in-flight request when caller signal is aborted'`
- `'throws PoliPageError with code "aborted" on caller cancellation'`
- `'caller signal already aborted before call → rejects immediately without HTTP request'`

**Hooks**
- `'calls onRequest with method, url, attempt'`
- `'calls onResponse with status, requestId, durationMs'`
- `'calls onRetry with attempt, delayMs, reason on retried failures'`
- `'calls onError with the thrown PoliPageError when call fails terminally'`
- `'hook errors do not break the request'`

**Streaming**
- `'renderStream returns a ReadableStream'`
- `'renderStream emits the same bytes as render()'`
- `'renderStream is consumable with for-await-of'`
- `'renderStream propagates upstream errors as PoliPageError'`

**`renderToFile` (now built on `renderStream`)**
- `'creates parent directories that do not exist'`
- `'overwrites existing files'`

### 6.2 Type tests (`tests/types.test-d.ts`)

Use Vitest's built-in `expectTypeOf` (`pnpm vitest --typecheck`).

```ts
import { expectTypeOf, test } from 'vitest';
import { PoliPage, PoliPageError, type RenderInput } from '../src/index.js';

test('render returns Promise<Uint8Array>', () => {
  const c = new PoliPage({ apiKey: 'pp_test_x' });
  expectTypeOf(c.render).returns.resolves.toEqualTypeOf<Uint8Array>();
});

test('discriminated RenderInput rejects invalid combos', () => {
  const c = new PoliPage({ apiKey: 'pp_test_x' });
  // @ts-expect-error — project mode requires template
  c.render({ project: 'billing', data: {} });
  // @ts-expect-error — at least one of project/template required
  c.render({ data: {} });
});

test('PoliPageError.code accepts known codes and any string', () => {
  expectTypeOf<PoliPageError['code']>().toMatchTypeOf<string>();
});
```

### 6.3 Integration tests (`tests/integration/render.integration.test.ts`)

```ts
const apiKey = process.env.POLI_PAGE_API_KEY;
const describeIfKey = apiKey ? describe : describe.skip;

describeIfKey('integration: develop API', () => {
  it('renders a real PDF (Inline mode, valid %PDF magic bytes, > 1KB)', async () => { /* ... */ });
  it('preview returns html and totalPages > 0', async () => { /* ... */ });
  it('bad API key produces PoliPageError with status 401', async () => { /* ... */ });
  it('renderToFile writes a non-empty PDF to disk', async () => { /* ... */ });
});
```

Base URL: `https://api-develop.poli.page`. All tests idempotent — no resource creation.

---

## 7. README rewrite (Section 5 from brainstorm)

Target ~180 lines. Single source of truth for the common path; deep links to https://docs-develop.poli.page/reference/sdk for everything else.

### 7.1 Table of contents

```
# Poli Page SDK for Node.js
[badges: npm version, license, Node version, CI status]
[1-paragraph pitch]

## Install
## Quick start (Project mode + Inline mode)
## Authentication & environments (sandbox vs live, env var)
## Rendering (render, renderStream, renderToFile)
## Preview
## Thumbnails
## Error handling (PoliPageError shape, predicates, common codes)
## Configuration (single options table including hooks)
## Cancellation (AbortSignal)
## Observability hooks
## Retries & idempotency (1 paragraph each, link out)
## TypeScript
## Requirements
## Documentation & support
## License
```

### 7.2 Explicitly NOT in README

- Full API error code reference (all 30+ codes) — lives on docs site
- All 12 page-format dimensions in mm — lives on docs site
- Migration guide (will exist post-1.0)
- Performance tuning advice (Lambda cold-starts, connection pooling)
- "Why Poli Page" pitch — npm landing isn't a sales page
- Roadmap section — lives in platform repo
- Verbose CONTRIBUTING content — covered separately in `CONTRIBUTING.md`

---

## 8. Implementation phases

Sequenced so CI is always green and decisions surface early. Each phase is independently shippable.

### Phase 0 — Foundation (no behavior change)

1. Update `engines.node` to `>=20.18.0`, `@types/node` to `^20.x`, add `.nvmrc`
2. Add `eslint.config.js` + `pnpm lint` script
3. Switch build from `tsc` to `tsup`. Update `package.json` `exports`, add `sideEffects: false`
4. Add `.github/workflows/ci.yml` (matrix Node 20/22/24)
5. Add `.github/workflows/publish.yml` (tag-driven)
6. Add `simple-git-hooks` + `pre-push` hook + `prepare` script
7. Add `SECURITY.md`, `CONTRIBUTING.md`
8. Verify: CI green, `pnpm pack` produces clean tarball

**Exit criterion**: CI green, no behavior change shipped.

### Phase 1 — Spec compliance fixes

TDD cycle (RED → GREEN → refactor) for each:
1. User-Agent + Accept headers (1.1, 1.2)
2. PDF Content-Type validation (1.3)
3. Non-JSON error body fallback to `INTERNAL_ERROR` (1.4)
4. Honor `Retry-After`, cap at 30s (1.5)
5. Retry on 429 (1.6)
6. Jitter on backoff (1.7)
7. Constructor error code → `'invalid_options'` (1.8)
8. Update `sdk-specification.md` in platform repo (§6.4, §7.1, §7.2) — separate commit

**Exit criterion**: all 8 spec gaps closed, ~10 new unit tests, CI green.

### Phase 2 — Public API additions (breaking-change phase)

Order matters — types first, transport refactor second, new methods third:
1. `render()` returns `Uint8Array` (2.1)
2. Discriminated `RenderInput` union (2.2)
3. Typed `PoliPageError.code` + predicates (2.7)
4. `signal?: AbortSignal` per call, composed with internal timeout (2.5)
5. Auto-generated `Idempotency-Key`, override-able (2.6)
6. Hooks: `onRequest`, `onResponse`, `onRetry`, `onError` (2.8)
7. `renderStream()` method (2.4)
8. `@poli-page/sdk/node` sub-export with `renderToFile` rebuilt on `renderStream` (2.3)
9. Constructor code change folded in from Phase 1 (2.9)

**Exit criterion**: new public surface complete, ~25 new tests, type tests pass.

### Phase 3 — Integration tests + pre-push hook

1. Create `tests/integration/render.integration.test.ts` with 4 tests
2. Add `test:integration` script (env-gated via `describeIfKey`)
3. Configure pre-push hook in `package.json` (with `SKIP_INTEGRATION=1` bypass)
4. Document bypass in `CONTRIBUTING.md`
5. Run all 4 integration tests against develop API with a `pp_test_*` key

**Exit criterion**: integration suite green; pre-push hook fires correctly.

### Phase 4 — Documentation

1. Rewrite README to ~180 lines per §7.1 TOC
2. Add badges
3. Update CHANGELOG `[Unreleased]` with all changes
4. Local visual sanity check via `pnpm pack` + `tar -xf` + Markdown preview

**Exit criterion**: README is self-sufficient for the common path.

### Phase 5 — Release

1. Final `pnpm test && pnpm test:integration && pnpm build && pnpm pack` smoke run
2. Bump `package.json` to `1.0.0`
3. Move CHANGELOG `[Unreleased]` → `[1.0.0] - YYYY-MM-DD`
4. Commit `chore(release): 1.0.0`, tag `v1.0.0`, push tag
5. CI publish workflow auto-runs; package goes live on npm
6. Verify: `pnpm view @poli-page/sdk`; install in a fresh sandbox; run quick-start

**Exit criterion**: `npm install @poli-page/sdk@1.0.0` works; quick-start renders a real PDF against develop.

---

## 9. Effort estimate (solo)

| Phase | Estimate |
|---|---|
| 0 — Foundation | 0.5 day |
| 1 — Spec compliance | 1 day |
| 2 — Public API | 2 days |
| 3 — Integration tests | 0.5 day |
| 4 — Docs | 0.5 day |
| 5 — Release | 0.5 day |
| **Total** | **~5 working days** |

---

## 10. Open questions (must be resolved before / during Phase 2)

1. **`Idempotency-Key` server behavior** — does the develop API currently accept the header? If not, sending it is harmless but the auto-generation feature should be marked as "forward-compat" in the README until the API ships dedup. Action: confirm with Xavier before shipping README copy.
2. **Spec doc updates** — the 3 changes in `sdk-specification.md` (§6.4, §7.1, §7.2) need to be made before Phase 1 closes, so the SDK ships against the updated contract. Action: update spec doc as part of Phase 1's "separate commit" step.

---

## 11. What this design intentionally does NOT include

- Recipes (Express, Fastify, Koa, Lambda) — separate effort, P0 0.1
- Changesets / `release-please` — manual release is sufficient for solo dev
- Browser/edge runtime first-class support — `Uint8Array` return is the only concession; revisit if a real user appears
- OpenTelemetry / interceptor pipeline — `onRequest`/`onResponse` hooks cover the realistic use case
- `CODE_OF_CONDUCT.md`, issue/PR templates, Dependabot config — yagni for solo, push-to-main, pre-1.0
- Migration guide from 0.1.0 — 0.1.0 is unpublished; no users to migrate
