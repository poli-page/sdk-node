export function buildMetaSidecar(packageVersion: string): unknown {
  return {
    language: 'node',
    package: { kind: 'npm', name: '@poli-page/sdk', version: packageVersion },
    extractedAt: new Date().toISOString(),
    extractorVersion: '0.1.0',
    client: { name: 'PoliPage', kind: 'class' },
    methods: [
      { slug: 'render-pdf',           name: 'render.pdf' },
      { slug: 'render-pdf-stream',    name: 'render.pdfStream' },
      { slug: 'render-document',      name: 'render.document' },
      { slug: 'documents-get',        name: 'documents.get' },
      { slug: 'documents-preview',    name: 'documents.preview' },
      { slug: 'documents-thumbnails', name: 'documents.thumbnails' },
      { slug: 'documents-delete',     name: 'documents.delete' },
      { slug: 'render-to-file',       name: 'renderToFile' },
    ],
    errors: [
      'invalid_options', 'network_error', 'timeout', 'aborted', 'DOWNLOAD_FAILED',
      'MISSING_API_KEY', 'INVALID_API_KEY',
      'FORBIDDEN', 'ORGANIZATION_CANCELLED', 'ORGANIZATION_PURGED',
      'ORGANIZATION_PAYMENT_GRACE', 'ORGANIZATION_MIGRATING', 'ENVIRONMENT_PROTECTED',
      'THUMBNAILS_NOT_AVAILABLE',
      'NOT_FOUND', 'PROJECT_NOT_FOUND', 'PROJECT_NOT_IN_ENVIRONMENT', 'TEMPLATE_NOT_FOUND',
      'DOCUMENT_NOT_FOUND', 'DOCUMENT_GONE',
      'VALIDATION_ERROR', 'MISSING_DATA', 'MISSING_TEMPLATE_SLUG', 'PROJECT_REQUIRED_FOR_DOCUMENT',
      'ENVIRONMENT_MISMATCH', 'EMPTY_DOCUMENT', 'TEMPLATE_ERROR',
      'RENDER_BODY_TOO_LARGE', 'DOCUMENT_TOO_LARGE',
      'QUOTA_EXCEEDED', 'OVERAGE_CAP_EXCEEDED', 'RATE_LIMIT_EXCEEDED',
      'INTERNAL_ERROR', 'STORAGE_ACCESS_DENIED', 'PUBLISH_IN_PROGRESS', 'RENDER_TIMEOUT',
    ].map((code) => ({ code })),
  };
}
