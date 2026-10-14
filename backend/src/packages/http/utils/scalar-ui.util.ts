import { DEFAULT_API_DOCS_PATH } from '../contracts/api-docs.contract.js';

export interface ScalarUiOptions {
  readonly title?: string;
  readonly openApiJsonUrl?: string;
  readonly postmanJsonUrl?: string;
  readonly theme?: 'kepler' | 'purple' | 'solarized' | 'bluePlanet' | 'saturn' | 'mars' | 'default';
  readonly darkMode?: boolean;
}

/**
 * Chuẩn hóa đường dẫn gốc của trang tài liệu API (mặc định: `/docs`).
 */
export function normalizeDocsPath(rawPath: string = DEFAULT_API_DOCS_PATH): string {
  const trimmed = rawPath.trim().replace(/^\/+|\/+$/g, '');
  return `/${trimmed.length > 0 ? trimmed : DEFAULT_API_DOCS_PATH}`;
}

/**
 * Sinh trang HTML giao diện **Scalar API Reference** hiện đại (bố cục 3 cột kiểu Scribe/Stripe,
 * hỗ trợ Dark Mode, tìm kiếm nhanh `Ctrl+K`, Try-it-out client và sinh Code Snippets đa ngôn ngữ).
 */
export function renderScalarApiReferenceHtml(options: ScalarUiOptions = {}): string {
  const title = options.title ?? 'Core Framework — API Reference';
  const openApiUrl = options.openApiJsonUrl ?? '/docs/openapi.json';
  const postmanUrl = options.postmanJsonUrl ?? '/docs/postman.json';
  const theme = options.theme ?? 'kepler';
  const darkMode = options.darkMode ?? true;

  const scalarConfig = JSON.stringify({
    theme,
    darkMode,
    layout: 'modern',
    showSidebar: true,
    hideDownloadButton: false,
    searchHotKey: 'k',
    metaData: {
      title,
    },
    authentication: {
      preferredSecurityScheme: 'bearerAuth',
    },
  });

  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .core-docs-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 16px;
        background: #0f172a;
        border-bottom: 1px solid #1e293b;
        color: #e2e8f0;
        font-size: 12px;
      }
      .core-docs-links {
        display: flex;
        gap: 12px;
      }
      .core-docs-links a {
        color: #38bdf8;
        text-decoration: none;
        font-weight: 500;
      }
      .core-docs-links a:hover {
        text-decoration: underline;
      }
    </style>
  </head>
  <body>
    <div class="core-docs-banner">
      <span><strong>${escapeHtml(title)}</strong> — OpenAPI 3.1 &amp; Scalar Interactive Reference</span>
      <div class="core-docs-links">
        <a href="${escapeHtml(openApiUrl)}" target="_blank" rel="noopener noreferrer">OpenAPI 3.1 JSON</a>
        <a href="${escapeHtml(postmanUrl)}" target="_blank" rel="noopener noreferrer">Postman Collection v2.1</a>
      </div>
    </div>
    <script
      id="api-reference"
      data-url="${escapeHtml(openApiUrl)}"
      data-configuration='${escapeHtmlAttribute(scalarConfig)}'
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
}

/** Thoát các ký tự HTML đặc biệt để chống XSS khi render tiêu đề */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Thoát ký tự nháy đơn trong thuộc tính HTML data-configuration */
function escapeHtmlAttribute(text: string): string {
  return text.replace(/'/g, '&#39;');
}
