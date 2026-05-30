// All known error codes raised by the SDK or returned by the API, as defined
// in src/error.ts. The reference page lists every code; the production/errors
// narrative explains the common ones.
const SDK_INTERNAL = [
  { code: 'invalid_options', when: 'Constructor options are missing or malformed.' },
  { code: 'network_error',   when: 'TCP/TLS-level failure reaching the API. Retryable.' },
  { code: 'timeout',         when: 'The request did not complete within `timeout`. Retryable.' },
  { code: 'aborted',         when: 'Caller-supplied `signal` aborted the request. Not retryable.' },
];

const API_AUTH = [
  { code: 'MISSING_API_KEY',  when: 'No API key in the request.' },
  { code: 'INVALID_API_KEY',  when: 'The API key is malformed or revoked.' },
];

const API_BILLING = [
  { code: 'PAYMENT_REQUIRED',       when: 'Organization billing is past due.' },
  { code: 'FORBIDDEN',              when: 'The key does not have access to the requested resource.' },
  { code: 'ORGANIZATION_CANCELLED', when: 'The organization has been cancelled.' },
  { code: 'ORGANIZATION_PURGED',    when: 'The organization has been purged.' },
];

const API_NOT_FOUND = [
  { code: 'NOT_FOUND',          when: 'The project/template slug does not exist or is not published.' },
  { code: 'VERSION_NOT_FOUND',  when: 'The pinned version does not exist for this template.' },
  { code: 'DOCUMENT_NOT_FOUND', when: 'No stored document matches the supplied id.' },
  { code: 'GONE',               when: 'The resource existed but has been deleted.' },
];

const API_VALIDATION = [
  { code: 'VALIDATION_ERROR',             when: '`data` does not satisfy the template schema.' },
  { code: 'MISSING_DATA',                 when: 'Request body lacks the required `data` field.' },
  { code: 'MISSING_PROJECT_OR_TEMPLATE',  when: 'Project mode call without both `project` and `template`.' },
  { code: 'MISSING_TEMPLATE_SLUG',        when: 'Template slug is missing.' },
  { code: 'INVALID_VERSION_FORMAT',       when: 'The `version` string is not a valid semver.' },
  { code: 'VERSION_REQUIRED',             when: 'Live keys require a pinned `version`.' },
  { code: 'INVALID_VERSION_FOR_KEY_ENV',  when: 'Sandbox key targeting a live-only version, or vice versa.' },
];

const API_RATE = [
  { code: 'QUOTA_EXCEEDED',      when: 'Per-key rate limit or monthly quota reached. Retryable.' },
  { code: 'OVERAGE_CAP_EXCEEDED', when: 'Hard overage cap reached. Not retryable.' },
];

const API_SERVER = [
  { code: 'INTERNAL_ERROR', when: 'The API returned 5xx. Retryable.' },
];

export function buildErrorsPage(): string {
  return `---
title: Errors
description: All error codes raised by PoliPageError, grouped by source.
---

import ErrorTable from '@poli-page/starlight-preset/components/ErrorTable.astro';

Every failure thrown by the SDK is an instance of \`PoliPageError\` with a \`code\`. SDK-internal codes are lowercase; codes from the API are uppercase.

## SDK-internal

<ErrorTable errors={${JSON.stringify(SDK_INTERNAL)}} />

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
