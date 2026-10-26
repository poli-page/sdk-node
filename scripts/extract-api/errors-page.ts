// All known error codes raised by the SDK or returned by the API, as defined
// in src/error.ts. The reference page lists every code; the production/errors
// narrative explains the common ones.
const SDK_INTERNAL = [
  { code: 'invalid_options', when: 'Constructor options are missing or malformed.' },
  { code: 'network_error',   when: 'TCP/TLS-level failure reaching the API. Retryable.' },
  { code: 'timeout',         when: 'The request did not complete within `timeout`. Retryable.' },
  { code: 'aborted',         when: 'Caller-supplied `signal` aborted the request. Not retryable.' },
];

const SDK_DOWNLOAD = [
  { code: 'DOWNLOAD_FAILED', when: 'Fetching the PDF from `presignedPdfUrl` failed (expired URL or network error).' },
];

const API_AUTH = [
  { code: 'MISSING_API_KEY',  when: 'No API key in the request.' },
  { code: 'INVALID_API_KEY',  when: 'The API key is malformed or revoked.' },
];

const API_BILLING = [
  { code: 'FORBIDDEN',                  when: 'The key does not have access to the requested resource.' },
  { code: 'ORGANIZATION_CANCELLED',     when: 'The organization has been cancelled.' },
  { code: 'ORGANIZATION_PURGED',        when: 'The organization has been purged.' },
  { code: 'ORGANIZATION_PAYMENT_GRACE', when: 'The organization is in its payment grace period (403).' },
  { code: 'ORGANIZATION_MIGRATING',     when: 'The organization is being migrated (503). Retryable.' },
  { code: 'ENVIRONMENT_PROTECTED',      when: 'The key\'s environment is protected against this operation (403).' },
  { code: 'THUMBNAILS_NOT_AVAILABLE',   when: 'Thumbnails are not included in the organization\'s plan (403).' },
];

const API_NOT_FOUND = [
  { code: 'NOT_FOUND',                  when: 'The requested resource does not exist.' },
  { code: 'PROJECT_NOT_FOUND',          when: 'No project matches the `project` slug.' },
  { code: 'PROJECT_NOT_IN_ENVIRONMENT', when: 'The project is not published in the key\'s environment.' },
  { code: 'TEMPLATE_NOT_FOUND',         when: 'No template matches the `template` slug in that project.' },
  { code: 'DOCUMENT_NOT_FOUND',         when: 'No stored document matches the supplied id.' },
  { code: 'DOCUMENT_GONE',              when: 'The stored document existed but has been deleted (410).' },
];

const API_VALIDATION = [
  { code: 'VALIDATION_ERROR',              when: 'The request body is invalid (unknown field, out-of-range option, bad `data`).' },
  { code: 'MISSING_DATA',                  when: 'Request body lacks the required `data` field.' },
  { code: 'MISSING_TEMPLATE_SLUG',         when: 'Template slug is missing.' },
  { code: 'PROJECT_REQUIRED_FOR_DOCUMENT', when: 'A render was requested without a `project`.' },
  { code: 'ENVIRONMENT_MISMATCH',          when: 'The request does not match the key\'s environment (400).' },
  { code: 'EMPTY_DOCUMENT',                when: 'The render produced an empty document (400).' },
  { code: 'TEMPLATE_ERROR',                when: 'The template failed to render with the supplied `data`.' },
  { code: 'RENDER_BODY_TOO_LARGE',         when: 'The render request body is too large (413).' },
  { code: 'DOCUMENT_TOO_LARGE',            when: 'The rendered document is too large (413).' },
];

const API_RATE = [
  { code: 'QUOTA_EXCEEDED',       when: 'Monthly quota reached (429).' },
  { code: 'OVERAGE_CAP_EXCEEDED', when: 'Hard overage cap reached (429).' },
  { code: 'RATE_LIMIT_EXCEEDED',  when: 'Too many requests (429). Retryable; honours `Retry-After`.' },
];

const API_SERVER = [
  { code: 'INTERNAL_ERROR',        when: 'The API returned 5xx, or a non-JSON error body. Retryable on 5xx.' },
  { code: 'STORAGE_ACCESS_DENIED', when: 'The API could not reach document storage (502). Retryable.' },
  { code: 'PUBLISH_IN_PROGRESS',   when: 'A publish holds this project in this environment (503). Retried after `Retry-After`.' },
  { code: 'RENDER_TIMEOUT',        when: 'The render did not finish in time (504). Retryable.' },
];

export function buildErrorsPage(): string {
  return `---
title: Errors
description: All error codes raised by PoliPageError, grouped by source.
---

import ErrorTable from '@preset/components/ErrorTable.astro';

Every failure thrown by the SDK is an instance of \`PoliPageError\` with a \`code\`. SDK-internal codes are lowercase; codes from the API are uppercase. \`DOWNLOAD_FAILED\` is raised by the SDK, not the API, when the PDF download from the presigned URL fails.

## SDK-internal

<ErrorTable errors={${JSON.stringify(SDK_INTERNAL)}} />

## PDF download

<ErrorTable errors={${JSON.stringify(SDK_DOWNLOAD)}} />

## Authentication

<ErrorTable errors={${JSON.stringify(API_AUTH)}} />

## Billing and lifecycle

<ErrorTable errors={${JSON.stringify(API_BILLING)}} />

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
