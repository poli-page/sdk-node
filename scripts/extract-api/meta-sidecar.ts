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
      { slug: 'render-preview',       name: 'render.preview' },
      { slug: 'render-document',      name: 'render.document' },
      { slug: 'documents-get',        name: 'documents.get' },
      { slug: 'documents-preview',    name: 'documents.preview' },
      { slug: 'documents-thumbnails', name: 'documents.thumbnails' },
      { slug: 'documents-delete',     name: 'documents.delete' },
      { slug: 'render-to-file',       name: 'renderToFile' },
    ],
    errors: [
      'invalid_options', 'network_error', 'timeout', 'aborted',
      'MISSING_API_KEY', 'INVALID_API_KEY',
      'PAYMENT_REQUIRED', 'FORBIDDEN', 'ORGANIZATION_CANCELLED', 'ORGANIZATION_PURGED',
      'NOT_FOUND', 'VERSION_NOT_FOUND', 'DOCUMENT_NOT_FOUND', 'GONE',
      'VALIDATION_ERROR', 'MISSING_DATA', 'MISSING_PROJECT_OR_TEMPLATE',
      'MISSING_TEMPLATE_SLUG', 'INVALID_VERSION_FORMAT', 'VERSION_REQUIRED',
      'INVALID_VERSION_FOR_KEY_ENV',
      'QUOTA_EXCEEDED', 'OVERAGE_CAP_EXCEEDED',
      'INTERNAL_ERROR',
    ].map((code) => ({ code })),
  };
}
