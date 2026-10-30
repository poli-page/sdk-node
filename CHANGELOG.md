# Changelog

All notable changes to `@poli-page/sdk` (Node.js) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Upgrade steps for breaking changes are on the docs site's [migration page](https://poli-page.github.io/sdk-node/support/migration/).

## [Unreleased]

## [0.11.0] - 2026-10-30

Conformance with the Poli Page API contract v1.3.0 ([poli-page/api-contract](https://github.com/poli-page/api-contract)).

### Changed

- **Breaking:** `DOWNLOAD_FAILED` is never retryable, whatever the storage status (was retryable for a storage 5xx or 429): `isRetryable()` now returns `false` for it. A queue that requeues on `isRetryable()` drops it at once; see the [migration page](https://poli-page.github.io/sdk-node/support/migration/). Contract v1.3.0.
- **Breaking:** `QUOTA_EXCEEDED` and `OVERAGE_CAP_EXCEEDED` (429) and `STORAGE_ACCESS_DENIED` (502) are no longer retried, even with a `Retry-After` header, and `isRetryable()` now returns `false` for them (it returned `true` for any 429 or 5xx). They last until the monthly reset or until the bucket access is restored, so the SDK used to wait up to 30 s per retry for nothing. `RATE_LIMIT_EXCEEDED` and every other 429 and 5xx are still retried. Code that requeues on `isRetryable()` stops requeueing these three; see the [migration page](https://poli-page.github.io/sdk-node/support/migration/).
- SDK error messages are the exact texts of the SDK specification:
  - `network_error`: `Network request failed` (was the `fetch` error text, e.g. `fetch failed`); the `fetch` error is kept as the error's `cause`.
  - `DOWNLOAD_FAILED`: `Failed to download PDF: HTTP <status>` (was `Failed to download PDF: <status> <status text>`), and `Failed to download PDF: network error` when the download gets no answer (was the `fetch` error text).
  - A non-JSON error body: `HTTP <status>` (was `HTTP <status>: response body was not valid JSON`); the code is still `INTERNAL_ERROR` with the real status.
  - `PROJECT_REQUIRED_FOR_DOCUMENT` raised before any request: `project is required`.
- SDK errors with no HTTP status keep the underlying error as `cause`: `network_error` and `timeout` (the `fetch` error, an `AbortError` for a timeout), and the download's `DOWNLOAD_FAILED` network error and `aborted` error. Code that serializes `err.cause` now sees it.
- Cancelling `render.pdf`, `render.pdfStream` or `downloadPdf()` during the download throws `aborted` instead of `DOWNLOAD_FAILED`, whether the signal fires before the storage answers or while the body is read.

### Fixed

- A 2xx API answer is read in full inside its attempt, under the attempt `timeout`. A connection dropped mid-body used to escape as a raw `TypeError` (not a `PoliPageError`, not retried) once `render.document`, `render.pdf`, `render.pdfStream` or a `documents` method parsed the body, and a stalled body was bounded only by the caller's signal. Now a drop mid-body is a `network_error` (`Network request failed`, with `cause`) and a stall a `timeout`, both retried like any failed attempt; a caller abort mid-body is `aborted`, never retried. `onResponse` fires once the body is read, never for a 2xx whose body failed, and its `durationMs` now covers the body. A render whose 2xx answer is cut or stalls was already stored and counted by the API; it is now retried, so it can store (and count) a second document — see [Retries and idempotency](https://poli-page.github.io/sdk-node/production/retries-and-idempotency/).
- An error (non-2xx) answer whose body is cut or stalls keeps its HTTP status, like an error body that is not JSON: `INTERNAL_ERROR`, `HTTP <status>`, the `x-request-id` as `requestId` and the read failure as `cause`, retried according to the status (5xx and 429 yes, other 4xx no). A caller abort while it is read is `aborted`.
- A retry wait that ends normally removes its `abort` listener from the caller's signal; a long-lived signal shared by many calls (a shutdown signal, say) no longer collects one listener per retry.
- A cancellation during the wait before a retry now calls `onError` with the `aborted` error, like every other error the SDK throws.
- A failure while the PDF body is read no longer escapes as a raw `fetch` error: `render.pdf`, `downloadPdf()` and the stream of `render.pdfStream` raise `aborted` when the caller's signal aborts mid-body (was a `DOMException` `AbortError`) and `DOWNLOAD_FAILED` with `Failed to download PDF: network error` when the connection drops mid-body (was a `TypeError: terminated`). Every error the SDK raises is a `PoliPageError`.
- A retry wait is never shorter than asked: a timer firing a fraction of a millisecond early is re-armed for the rest of the delay.
- Docs: the retries page and the README no longer claim the API deduplicates on `Idempotency-Key`. It does not: the key is stable across the retries of one call, and a render retried after a late 5xx can store a second document.

### Added

- Known error code `TEMPLATE_UNSAFE` (400): the template, a partial or an SVG asset holds an injection attempt; `detail` names it. Not retried.
- `documents.get`, `documents.preview` and `documents.delete` take a last `{ signal }` argument, and `documents.thumbnails` a third one, to cancel the call (`code: 'aborted'`, never retried). New type `DocumentsRequestOptions`.
- `PoliPageError` takes an optional fifth constructor argument `{ cause }`.
- `tests/contract.test.ts` runs every SDK case of the API contract against a local mock server; CI pins the contract by commit (`poli-page/api-contract` action) and Dependabot proposes each new version. Run it locally with `POLI_CONTRACT=<path to contract.json> npm test`.

## [0.10.0] - 2026-10-27

Environments contract: a key is `pp_{env}_{32 hex}` and carries its environment (`pp_sandbox_…`, `pp_live_…`, `pp_staging_…`); the API resolves the environment from the key and renders the project's copy published there. There are no versions, no draft rendering and no authenticated preview. Breaking, with no deprecation window.

### Removed

- `render.preview(input)` and its `PreviewResult` type: the API removed `POST /v1/render/preview` (a call now gets `404`). `documents.preview(id)` stays.
- Inline-HTML rendering and the `InlineModeInput` type: the API answers `400 VALIDATION_ERROR` to an inline `template`.
- The `version` render input field and `DocumentDescriptor.version`: a render uses the copy published in the key's environment.
- Known error codes `VERSION_NOT_FOUND`, `INVALID_VERSION_FORMAT`, `VERSION_REQUIRED`, `INVALID_VERSION_FOR_KEY_ENV`, `MISSING_PROJECT_OR_TEMPLATE`, `GONE` (the API answers `410 DOCUMENT_GONE`) and `PAYMENT_REQUIRED` (payment grace is `403 ORGANIZATION_PAYMENT_GRACE`).
- `examples/render-preview.ts`.

### Changed

- `ProjectModeInput` is renamed `RenderInput` and is the only render input type.
- The `POST /v1/render` body is built from `project`, `template`, `data`, `metadata`, `format`, `orientation` and `locale` only; any other key a caller passes (such as `version` from untyped JavaScript) is no longer sent. Unset optional fields are omitted.
- `DocumentDescriptor.environment` is a `string`: any environment name the API returns (e.g. `staging`) is passed through unchanged.
- `documents.thumbnails(id, options?)`: every option is optional and `options` itself can be omitted; with no option set the body is `{}` and the API defaults apply (`width` 400, `format` `jpeg`). `format` accepts `'jpeg' | 'webp' | 'png'`. The SDK does not check bounds; the API answers `400 VALIDATION_ERROR`.
- `documents.delete(id)` is documented as idempotent: it resolves on `204`, including for an already-deleted document.
- Integration tests render `getting-started`/`welcome` with no version (`POLI_PAGE_TEST_VERSION` is gone).

### Added

- Known error codes `PUBLISH_IN_PROGRESS` (503, retried like any 5xx, honouring `Retry-After`), `ENVIRONMENT_MISMATCH`, `PROJECT_NOT_IN_ENVIRONMENT`, `TEMPLATE_NOT_FOUND`, `DOCUMENT_GONE`, `ENVIRONMENT_PROTECTED`, `ORGANIZATION_PAYMENT_GRACE`, `EMPTY_DOCUMENT`, `STORAGE_ACCESS_DENIED`, `ORGANIZATION_MIGRATING`, `PROJECT_NOT_FOUND`, `TEMPLATE_ERROR`, `THUMBNAILS_NOT_AVAILABLE`, `RATE_LIMIT_EXCEEDED`, `RENDER_BODY_TOO_LARGE`, `DOCUMENT_TOO_LARGE`, `RENDER_TIMEOUT`. Unknown codes still pass through verbatim.
- `DOWNLOAD_FAILED` is listed among the known SDK codes of `PoliPageErrorCode` (it was already raised by `downloadPdf()`, `render.pdf` and `render.pdfStream`).
- `.github/workflows/integration.yml` runs `npm run test:integration` nightly and on demand against the real API, with a `sandbox` key from the `POLI_PAGE_API_KEY` secret (and an optional `POLI_PAGE_BASE_URL` secret); without the key it logs a skip.

### Documentation

- README, demos, `.env.example` and the docs site teach the environments contract: `sandbox` keys (`pp_sandbox_…`) and the full-key format, the key table (watermark, quota, 30-day `sandbox` expiry, `poli-watermark`), the `getting-started`/`welcome` quick start with no `version`, and the playground (https://play.poli.page) for previews and inline HTML.
- The demos check a pasted key against the full-key regex only, no longer have a `render.preview` step, and end with the `not-found` step (`404 TEMPLATE_NOT_FOUND`). The Cloudflare Worker demo also answers `GET /errors/not-found` with the error's `toPayload()` body.
- The docs migration page has a "From 0.9.x to 0.10.0" entry; the generated errors reference lists the 31 API codes with their status and retry behaviour.

## [0.9.0] - 2026-06-22

### BREAKING

- **Namespaced surface** per the Poli Page API contract. Top-level flat methods removed:
  - `client.render(input)` → `client.render.pdf(input)`
  - `client.renderStream(input)` → `client.render.pdfStream(input)`
  - `client.preview(input)` → `client.render.preview(input)`
  - `client.thumbnails(input, options)` is **retired entirely**; the equivalent against stored documents is `client.documents.thumbnails(id, options)`.
- **Inline-mode restriction**: `render.pdf`, `render.pdfStream`, and `render.document` require project mode (project + template + version). Inline mode survives only for `render.preview`. The type system enforces this at compile time.
- `render.*` methods return `Uint8Array` (not `Buffer`). Use `Buffer.from(uint8)` if you specifically need a Node `Buffer`.

### Added

- **`getting-started/welcome/1.0.0`** template is auto-provisioned in every Poli Page org, letting the SDK Quick Start work with a fresh API key and no project setup. README, demos, and integration tests use this as the default project for direct API calls.
- **Storage namespace** `client.documents.*`: `get(id)`, `preview(id)`, `thumbnails(id, options)`, `delete(id)`.
- **`client.render.document(input) → DocumentDescriptor`** — render and store; returns a flat descriptor with the presigned PDF URL, page count, file size, environment, and your `metadata`.
- **`DocumentDescriptor.downloadPdf(options?) → Promise<Uint8Array>`** fluent helper to fetch the PDF bytes from the presigned URL on demand.
- **`metadata: RenderMetadata`** pass-through field on all render inputs; echoed back in `DocumentDescriptor.metadata`.
- **`renderToFile`** sub-export at `@poli-page/sdk/node` (Node-only) — streams a PDF directly to disk.
- **`AbortSignal` cancellation** via per-call `signal?` option.
- **Idempotency-Key** auto-generation (UUID v4, reused across retries on POST); per-call override via `idempotencyKey`.
- **Observability hooks**: `onRequest`, `onResponse`, `onRetry`, `onError`.
- **Predicate helpers** on `PoliPageError`: `isAuthError`, `isRateLimitError`, `isValidationError`, `isNetworkError`, `isRetryable`.
- **Retry policy**: 5xx, 429, network errors, and timeouts. Exponential backoff with jitter; honors `Retry-After`, capped at 30 s.
- **TSDoc `@example`** blocks on every public method.
- **Declaration maps** (`.d.ts.map`) shipped alongside `.d.ts` for "Go to Definition" parity in IDEs.
- **Public type re-exports**: `RenderNamespace`, `DocumentsNamespace`, `DocumentDescriptor`, `DocumentPreviewResult`, `Thumbnail`, `ThumbnailOptions`, `RenderMetadata`, `PreviewResult`, `PageFormat`, `Orientation`, `ProjectModeInput`, `InlineModeInput`, `RenderInput`, `PoliPageOptions`, `RequestEvent`, `ResponseEvent`, `RetryEvent`.

### Changed

- **`render.pdf` and `render.pdfStream`** make two HTTP calls: `POST /v1/render` to produce a stored document, then `GET presignedPdfUrl` to fetch the bytes. Same as before from the caller's perspective; the difference is observable only in network logs.
- **`render.preview` response** is `{ html, totalPages, environment }`. The `environment` field is new (`'sandbox' | 'live'`); `metadata` is no longer echoed on preview responses.
- **`documents.preview` returns `DocumentPreviewResult { html, pageCount }`** — `pageCount` (singular), distinct from `render.preview`'s `totalPages` (the deployed API uses different field names for the two endpoints).
- **`documents.thumbnails` wire body** wraps options in `{ thumbnails: {...} }`. SDK abstracts this; callers pass options flat.
- **`DocumentDescriptor` nullability** loosened: `apiKeyId`, `templateSlug`, `orientation`, `locale` are `string | null`.
- **`ThumbnailOptions`** has no singular `page` field; use `pages: [N]` instead.
- Internal transport seam supports POST, GET, and DELETE verbs.
- Constructor throws `PoliPageError` with `code: 'invalid_options'` when `apiKey` is missing.
- Minimum supported Node.js version is 20.18.
- Dual ESM + CJS build via `tsup`. `package.json` declares `sideEffects: false`. CJS preserves the `node:` prefix on Node builtin imports.

### Removed

- Top-level flat methods: `client.render`, `client.renderStream`, `client.preview`, `client.thumbnails`.
- Inline-input thumbnails. `Thumbnail` / `ThumbnailOptions` types reintroduced under `client.documents.thumbnails`.
- `ThumbnailOptions.page` (singular) — use `pages: [N]`.

### Fixed

- Non-JSON non-2xx response bodies produce `PoliPageError` with `code: 'INTERNAL_ERROR'` and the HTTP status. Previously the raw body was stuffed into the `code` field.
- Main entry is fully isomorphic — no `node:*` imports. Idempotency-key generation uses `globalThis.crypto.randomUUID()` (Cloudflare Workers, Vercel Edge, Deno, Bun all supported).

## [0.1.0] - 2026-04-26

> **Note**: `0.1.0` was published to npm as an early placeholder (no live users). `0.9.0` is the first real release of the namespaced surface — treat it as the starting point. The list below is preserved for historical reference.

### Added

- Initial repository scaffolding: `package.json`, TypeScript and Vitest config, MIT license, README, contributor-friendly file layout.
- Public type definitions: `PoliPageOptions`, `RenderInput`, `PreviewResult`, `Thumbnail`, `ThumbnailOptions`, and the typed `PoliPageError` class with `code`, `status`, and `requestId` fields.
- Strongly-typed `PageFormat` union covering all 12 canonical Poli Page formats (`A3`, `A4`, `A5`, `A6`, `B4`, `B5`, `Letter`, `Legal`, `Tabloid`, `Executive`, `Statement`, `Folio`) and `Orientation` union.
- Full HTTP transport for the four `PoliPage` methods (`render`, `renderToFile`, `preview`, `thumbnails`) using the global `fetch` API with Bearer authentication.
- Per-request `timeout` option (default 60s) backed by `AbortController`.
- Retry policy with exponential backoff: retries only on 5xx and network errors, never on 4xx; capped by `maxRetries` (default 2).
- Capture of `x-request-id` response header on errors for support and debugging.
- Test suite mirrors the platform spec: constructor, render, renderToFile, preview, thumbnails, retry logic, and request-id propagation.
