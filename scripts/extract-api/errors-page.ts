// All known error codes raised by the SDK or returned by the API, as defined
// in src/error.ts. The reference page lists every code; the production/errors
// narrative explains the common ones.
const SDK_INTERNAL = [
  { code: 'invalid_options', when: 'Constructor options are missing or malformed. Thrown before any HTTP call. Not retryable.' },
  { code: 'network_error',   when: 'TCP/TLS-level failure reaching the API (`Network request failed`; the `fetch` error is the `cause`). Retryable.' },
  { code: 'timeout',         when: 'The request did not complete within `timeout`. Retryable.' },
  { code: 'aborted',         when: 'Caller-supplied `signal` aborted the request. Not retryable.' },
  { code: 'DOWNLOAD_FAILED', when: 'Fetching the PDF bytes from the presigned URL failed (`downloadPdf()`, `render.pdf`, `render.pdfStream`). Not retried; refresh with `documents.get(id)`.' },
];

const API_AUTH = [
  { code: 'MISSING_API_KEY',  when: '401: no API key in the request. Not retryable.' },
  { code: 'INVALID_API_KEY',  when: '401: the API key is malformed or revoked. Not retryable.' },
];

const API_ORGANIZATION = [
  { code: 'ORGANIZATION_PAYMENT_GRACE', when: '403: the organization is in payment grace: read-only, writes are refused. Not retryable.' },
  { code: 'ORGANIZATION_CANCELLED',     when: '403: the organization has been cancelled: read-only until purge. Not retryable.' },
  { code: 'ORGANIZATION_PURGED',        when: '410: the organization has been purged. Not retryable.' },
  { code: 'ORGANIZATION_MIGRATING',     when: '503: the organization`s storage is being migrated. Retryable.' },
  { code: 'FORBIDDEN',                  when: '403: a document of another organization, or of another environment than the key`s. Not retryable.' },
  { code: 'ENVIRONMENT_PROTECTED',      when: '403: `documents.delete` in a protected environment without the owner or admin role. Not retryable.' },
  { code: 'THUMBNAILS_NOT_AVAILABLE',   when: '403: `documents.thumbnails` on the Free tier. Not retryable.' },
];

const API_NOT_FOUND = [
  { code: 'NOT_FOUND',                  when: '404: generic not found, e.g. a removed route. Not retryable.' },
  { code: 'PROJECT_NOT_FOUND',          when: '404: no project with this slug in the organization. Not retryable.' },
  { code: 'PROJECT_NOT_IN_ENVIRONMENT', when: '404: the project was never published in the key`s environment, or was removed from it. Not retryable.' },
  { code: 'TEMPLATE_NOT_FOUND',         when: '404: the template is absent from the environment`s published copy of the project. Not retryable.' },
  { code: 'DOCUMENT_NOT_FOUND',         when: '404: no stored document matches the supplied id. Not retryable.' },
  { code: 'DOCUMENT_GONE',              when: '410: the document was deleted, or is a sandbox document older than 30 days. Not retryable.' },
];

const API_VALIDATION = [
  { code: 'VALIDATION_ERROR',              when: '400: the body failed validation, e.g. an unknown field or thumbnail options out of bounds. Not retryable.' },
  { code: 'MISSING_DATA',                  when: '400: the request body lacks the required `data` field. Not retryable.' },
  { code: 'MISSING_TEMPLATE_SLUG',         when: '400: the template slug is missing. Not retryable.' },
  { code: 'PROJECT_REQUIRED_FOR_DOCUMENT', when: '400: a render without `project`. Not retryable.' },
  { code: 'ENVIRONMENT_MISMATCH',          when: '400: the request named another environment than the key`s. The SDK never sends one. Not retryable.' },
  { code: 'TEMPLATE_ERROR',                when: '400: the engine rejected the template or its data. Not retryable.' },
  { code: 'EMPTY_DOCUMENT',                when: '400: the render produced zero pages. Not retryable.' },
  { code: 'RENDER_BODY_TOO_LARGE',         when: '413: the request body is too large. Not retryable.' },
  { code: 'DOCUMENT_TOO_LARGE',            when: '413: the document exceeds an engine cap. Not retryable.' },
];

const API_RATE = [
  { code: 'RATE_LIMIT_EXCEEDED',  when: '429: too many requests for this key. Retryable.' },
  { code: 'QUOTA_EXCEEDED',       when: '429: monthly quota reached. Not retryable: it lasts until the monthly reset.' },
  { code: 'OVERAGE_CAP_EXCEEDED', when: '429: overage cap reached (paid tiers). Not retryable: it lasts until the monthly reset.' },
];

const API_SERVER = [
  { code: 'INTERNAL_ERROR',        when: '500: unexpected server error, or a response body that is not JSON. Retryable.' },
  { code: 'STORAGE_ACCESS_DENIED', when: '502: the organization`s own storage bucket refuses access. Not retryable: restore the bucket role, then call again.' },
  { code: 'PUBLISH_IN_PROGRESS',   when: '503: the project is being published into this environment; honours `Retry-After`. Retryable.' },
  { code: 'RENDER_TIMEOUT',        when: '504: the engine`s time budget expired. Retryable.' },
];

export function buildErrorsPage(): string {
  return `---
title: Errors
description: All error codes raised by PoliPageError, grouped by source.
---

import ErrorTable from '@preset/components/ErrorTable.astro';

Every failure thrown by the SDK is an instance of \`PoliPageError\` with a \`code\`. SDK-internal codes are lowercase, except \`DOWNLOAD_FAILED\`; codes from the API are uppercase. Each API code is listed with its HTTP status and whether the SDK retries it. The API may add codes: the SDK passes an unknown code through verbatim.

## SDK-internal

<ErrorTable errors={${JSON.stringify(SDK_INTERNAL)}} />

## Authentication

<ErrorTable errors={${JSON.stringify(API_AUTH)}} />

## Organization and access

<ErrorTable errors={${JSON.stringify(API_ORGANIZATION)}} />

## Not found

<ErrorTable errors={${JSON.stringify(API_NOT_FOUND)}} />

## Validation

<ErrorTable errors={${JSON.stringify(API_VALIDATION)}} />

## Rate and quota

<ErrorTable errors={${JSON.stringify(API_RATE)}} />

## Server

<ErrorTable errors={${JSON.stringify(API_SERVER)}} />
`;
}
