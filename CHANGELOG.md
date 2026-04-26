# Changelog

All notable changes to `@poli-page/sdk` (Node.js) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial repository scaffolding: `package.json`, TypeScript and Vitest config,
  MIT license, README, contributor-friendly file layout.
- Public type definitions: `PoliPageOptions`, `RenderInput`, `PreviewResult`,
  `Thumbnail`, `ThumbnailOptions`, and the typed `PoliPageError` class.
- `PoliPage` client skeleton with the four contract methods (`render`,
  `renderToFile`, `preview`, `thumbnails`). Methods currently throw
  `not_implemented`; HTTP transport, retries, and error mapping are in
  progress.
