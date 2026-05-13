# Changelog

All notable changes to `@poli-page/sdk` (Node.js) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Breaking changes between major versions are summarized in [MIGRATION.md](MIGRATION.md).

## [Unreleased]

## [1.0.0] - 2026-05-13

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

> **Note**: `0.1.0` was published briefly and unpublished from npm. No live users — treat `1.0.0` as the starting point. The list below is preserved for historical reference.

### Added

- Initial repository scaffolding: `package.json`, TypeScript and Vitest config, MIT license, README, contributor-friendly file layout.
- Public type definitions: `PoliPageOptions`, `RenderInput`, `PreviewResult`, `Thumbnail`, `ThumbnailOptions`, and the typed `PoliPageError` class with `code`, `status`, and `requestId` fields.
- Strongly-typed `PageFormat` union covering all 12 canonical Poli Page formats (`A3`, `A4`, `A5`, `A6`, `B4`, `B5`, `Letter`, `Legal`, `Tabloid`, `Executive`, `Statement`, `Folio`) and `Orientation` union.
- Full HTTP transport for the four `PoliPage` methods (`render`, `renderToFile`, `preview`, `thumbnails`) using the global `fetch` API with Bearer authentication.
- Per-request `timeout` option (default 60s) backed by `AbortController`.
- Retry policy with exponential backoff: retries only on 5xx and network errors, never on 4xx; capped by `maxRetries` (default 2).
- Capture of `x-request-id` response header on errors for support and debugging.
- Test suite mirrors the platform spec: constructor, render, renderToFile, preview, thumbnails, retry logic, and request-id propagation.
