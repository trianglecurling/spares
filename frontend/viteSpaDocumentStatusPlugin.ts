import fs from 'node:fs/promises';
import path from 'node:path';
import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite';

const ASSET_PATH_PATTERN = /\.[a-zA-Z0-9]+$/;

function shouldCheckDocumentStatus(method: string | undefined, pathname: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (!pathname || pathname.startsWith('/api') || pathname.startsWith('/@')) return false;
  if (pathname.startsWith('/go/') && !/\/info\/?$/.test(pathname)) return false;
  if (ASSET_PATH_PATTERN.test(pathname)) return false;
  return true;
}

async function resolveDocumentStatus(backendTarget: string, pathname: string): Promise<200 | 404 | null> {
  const statusUrl = `${backendTarget}/api/public/document-status?path=${encodeURIComponent(pathname)}`;
  const response = await fetch(statusUrl);
  if (response.status === 404) {
    return 404;
  }
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as { status?: number };
  return payload.status === 404 ? 404 : 200;
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
        const status = await resolveDocumentStatus(backendTarget, url.pathname);
        if (status == null) {
          next();
          return;
        }

        if (req.method === 'HEAD') {
          res.statusCode = status;
          res.end();
          return;
        }

        const indexPath = path.join(root, 'index.html');
        let html = await fs.readFile(indexPath, 'utf-8');
        if (transformIndexHtml) {
          html = await transformIndexHtml(url.pathname, html);
        }

        res.statusCode = status;
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
