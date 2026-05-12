# Changelog

All notable changes to `@poli-page/sdk` (Node.js) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Breaking changes between major versions are summarized in [MIGRATION.md](MIGRATION.md).

## [Unreleased]

## [1.0.0] - 2026-05-12

### BREAKING

- **Namespaced surface** per spec v1.3 §2.1. Top-level flat methods are removed:
  - `client.render(input)` → `client.render.pdf(input)`
  - `client.renderStream(input)` → `client.render.pdfStream(input)`
  - `client.preview(input)` → `client.render.preview(input)`
  - `client.thumbnails(input, options)` is **retired entirely**; the equivalent against stored documents is `client.documents.thumbnails(id, options)`.
- `render` methods return `Uint8Array` instead of `Buffer`. Use `Buffer.from(uint8)` if a Node `Buffer` is specifically needed.

### Added

- **Storage namespace** `client.documents.*` per spec §6: `get(id)`, `preview(id)`, `thumbnails(id, options)`, `delete(id)`.
- **`client.render.document(input)`** per spec §5.3 — renders, stores server-side, returns a `DocumentDescriptor` with system fields + caller-supplied `metadata` + presigned PDF URL.
- **`DocumentDescriptor.downloadPdf(options?)`** fluent helper to fetch the PDF bytes from the presigned URL on demand.
- **`metadata: RenderMetadata`** pass-through field on all render inputs (spec §4.4); echoed back on `preview` and `document` responses.
- **`renderToFile`** sub-export at `@poli-page/sdk/node` (Node-only) streams a PDF directly to disk.
- **`AbortSignal` cancellation** via per-call `signal?` option. Aborted requests throw `PoliPageError` with `code: 'aborted'`.
- **Idempotency-Key** auto-generation (UUID v4, reused across retries on POST); per-call override via `idempotencyKey`.
- **Observability hooks**: `onRequest`, `onResponse`, `onRetry`, `onError`.
- **Predicate helpers** on `PoliPageError`: `isAuthError`, `isRateLimitError`, `isValidationError`, `isNetworkError`, `isRetryable`.
- **Retry policy** retries on 5xx, 429, network errors, and timeouts. Exponential backoff with jitter; honors `Retry-After`, capped at 30 s.
- **TSDoc `@example`** blocks on every public method.
- **Public type re-exports**: `RenderNamespace`, `DocumentsNamespace`, `DocumentDescriptor`, `Thumbnail`, `ThumbnailOptions`, `RenderMetadata`, `PreviewResult`, `PageFormat`, `Orientation`, `ProjectModeInput`, `InlineModeInput`, `RenderInput`, `PoliPageOptions`, `RequestEvent`, `ResponseEvent`, `RetryEvent`.

### Changed

- Internal transport seam supports POST, GET, and DELETE verbs. Previously POST-only.
- Constructor throws `PoliPageError` with `code: 'invalid_options'` when `apiKey` is missing.
- Minimum supported Node.js version is now 20.18.
- Dual ESM + CJS build via `tsup`. `package.json` declares `sideEffects: false`.

### Removed

- Top-level flat methods: `client.render`, `client.renderStream`, `client.preview`, `client.thumbnails`.
- Inline-input thumbnails. `Thumbnail` / `ThumbnailOptions` types are reintroduced bound to `client.documents.thumbnails(id, options)` against stored documents.

### Fixed

- Non-JSON non-2xx response bodies produce `PoliPageError` with `code: 'INTERNAL_ERROR'` and the HTTP status. Previously the raw body was stuffed into the `code` field.
- 2xx responses with non-`application/pdf` Content-Type on PDF endpoints now throw `PoliPageError` instead of returning whatever bytes the server sent.
- Main entry no longer imports from `node:crypto`. Idempotency-key generation uses `globalThis.crypto.randomUUID()`, keeping the main entry isomorphic (Cloudflare Workers, Vercel Edge, Deno, Bun).

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
