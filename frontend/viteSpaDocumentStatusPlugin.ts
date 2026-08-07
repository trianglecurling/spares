import fs from 'node:fs/promises';
import path from 'node:path';
import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite';

const ASSET_PATH_PATTERN = /\.[a-zA-Z0-9]+$/;

type DocumentMeta = {
  status: 200 | 404;
  title: string;
  description: string;
  ogType: 'website' | 'article';
  canonicalPath: string;
  siteName: string;
};

function shouldCheckDocumentStatus(method: string | undefined, pathname: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (!pathname || pathname.startsWith('/api') || pathname.startsWith('/@')) return false;
  if (pathname.startsWith('/go/') && !/\/info\/?$/.test(pathname)) return false;
  if (ASSET_PATH_PATTERN.test(pathname)) return false;
  return true;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function upsertMetaTag(
  html: string,
  attrName: 'name' | 'property',
  attrValue: string,
  content: string,
): string {
  const escapedContent = escapeHtmlAttr(content);
  const tag = `<meta ${attrName}="${attrValue}" content="${escapedContent}" />`;
  const pattern = new RegExp(
    `<meta\\s+[^>]*(?:${attrName}\\s*=\\s*["']${attrValue}["'][^>]*content\\s*=\\s*["'][^"']*["']|content\\s*=\\s*["'][^"']*["'][^>]*${attrName}\\s*=\\s*["']${attrValue}["'])[^>]*>`,
    'i',
  );
  if (pattern.test(html)) {
    return html.replace(pattern, tag);
  }
  return html.replace(/<\/head>/i, `    ${tag}\n  </head>`);
}

function upsertLinkTag(html: string, rel: string, href: string): string {
  const escapedHref = escapeHtmlAttr(href);
  const tag = `<link rel="${rel}" href="${escapedHref}" />`;
  const pattern = new RegExp(`<link\\s+[^>]*rel\\s*=\\s*["']${rel}["'][^>]*>`, 'i');
  if (pattern.test(html)) {
    return html.replace(pattern, tag);
  }
  return html.replace(/<\/head>/i, `    ${tag}\n  </head>`);
}

function upsertTitle(html: string, title: string): string {
  const escaped = escapeHtmlText(title);
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escaped}</title>`);
  }
  return html.replace(/<\/head>/i, `    <title>${escaped}</title>\n  </head>`);
}

function injectDocumentMeta(html: string, meta: DocumentMeta, origin: string): string {
  const base = origin.replace(/\/+$/, '');
  const canonicalUrl = `${base}${meta.canonicalPath === '/' ? '/' : meta.canonicalPath}`;

  let next = upsertTitle(html, meta.title);
  next = upsertMetaTag(next, 'name', 'description', meta.description);
  next = upsertMetaTag(next, 'property', 'og:title', meta.title);
  next = upsertMetaTag(next, 'property', 'og:description', meta.description);
  next = upsertMetaTag(next, 'property', 'og:type', meta.ogType);
  next = upsertMetaTag(next, 'property', 'og:site_name', meta.siteName);
  next = upsertMetaTag(next, 'property', 'og:url', canonicalUrl);
  next = upsertMetaTag(next, 'name', 'twitter:card', 'summary_large_image');
  next = upsertMetaTag(next, 'name', 'twitter:title', meta.title);
  next = upsertMetaTag(next, 'name', 'twitter:description', meta.description);
  next = upsertLinkTag(next, 'canonical', canonicalUrl);
  return next;
}

async function resolveDocumentMeta(
  backendTarget: string,
  pathname: string,
): Promise<DocumentMeta | null> {
  const statusUrl = `${backendTarget}/api/public/document-meta?path=${encodeURIComponent(pathname)}`;
  const response = await fetch(statusUrl);
  if (!response.ok && response.status !== 404) {
    return null;
  }
  const payload = (await response.json()) as Partial<DocumentMeta>;
  if (
    typeof payload.title !== 'string' ||
    typeof payload.description !== 'string' ||
    typeof payload.siteName !== 'string' ||
    typeof payload.canonicalPath !== 'string' ||
    (payload.status !== 200 && payload.status !== 404)
  ) {
    return null;
  }
  return {
    status: payload.status,
    title: payload.title,
    description: payload.description,
    ogType: payload.ogType === 'article' ? 'article' : 'website',
    canonicalPath: payload.canonicalPath,
    siteName: payload.siteName,
  };
}

function createDocumentStatusMiddleware(
  backendTarget: string,
  root: string,
  transformIndexHtml?: (url: string, html: string) => Promise<string>,
): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!shouldCheckDocumentStatus(req.method, url.pathname)) {
      next();
      return;
    }

    void (async () => {
      try {
        const meta = await resolveDocumentMeta(backendTarget, url.pathname);
        if (meta == null) {
          next();
          return;
        }

        if (req.method === 'HEAD') {
          res.statusCode = meta.status;
          res.end();
          return;
        }

        const indexPath = path.join(root, 'index.html');
        let html = await fs.readFile(indexPath, 'utf-8');
        if (transformIndexHtml) {
          html = await transformIndexHtml(url.pathname, html);
        }
        const origin = `http://${req.headers.host || 'localhost'}`;
        html = injectDocumentMeta(html, meta, origin);

        res.statusCode = meta.status;
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
      } catch {
        next();
      }
    })();
  };
}

function attachMiddleware(server: ViteDevServer | PreviewServer, backendTarget: string): void {
  server.middlewares.use(
    createDocumentStatusMiddleware(backendTarget, server.config.root, (url, html) =>
      server.transformIndexHtml(url, html),
    ),
  );
}

export function spaDocumentStatusPlugin(backendTarget: string): Plugin {
  return {
    name: 'spa-document-status',
    configureServer(server) {
      attachMiddleware(server, backendTarget);
    },
    configurePreviewServer(server) {
      attachMiddleware(server, backendTarget);
    },
  };
}
