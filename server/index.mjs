import {createServer} from 'node:http';
import {readFile, realpath, stat} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {extname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const DEFAULT_ROOT = fileURLToPath(new URL('../dist/', import.meta.url));
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function textResponse(req, res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(req.method === 'HEAD' ? undefined : text);
}

export function createAppServer({root = DEFAULT_ROOT, chatHandler = null, accountHandler = null} = {}) {
  const staticRoot = realpathSync(root);

  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    let pathname;
    try {
      pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);
    } catch {
      textResponse(req, res, 400, 'Bad request\n');
      return;
    }

    if (!pathname.startsWith('/') || /[\0\\]/.test(pathname)) {
      textResponse(req, res, 400, 'Bad request\n');
      return;
    }
    if (pathname.split('/').some(part => part.startsWith('.'))) {
      textResponse(req, res, 404, 'Not found\n');
      return;
    }

    try {
      if (accountHandler && await accountHandler(req, res, pathname)) return;
      if (chatHandler && await chatHandler(req, res, pathname)) return;
    } catch {
      console.error('{"event":"request_handler_failed"}');
      if (res.headersSent) res.destroy();
      else textResponse(req, res, 500, 'Internal server error\n');
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      textResponse(req, res, 405, 'Method not allowed\n');
      return;
    }

    if (pathname === '/healthz') {
      const body = '{"status":"ok"}\n';
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }

    try {
      const file = await realpath(resolve(staticRoot, `.${pathname === '/' ? '/index.html' : pathname}`));
      const withinRoot = relative(staticRoot, file);
      if (!withinRoot || isAbsolute(withinRoot) || withinRoot.split(sep).some(part => part.startsWith('.'))) {
        textResponse(req, res, 404, 'Not found\n');
        return;
      }

      const metadata = await stat(file);
      if (!metadata.isFile()) {
        textResponse(req, res, 404, 'Not found\n');
        return;
      }

      const extension = extname(file).toLowerCase();
      const body = req.method === 'HEAD' ? undefined : await readFile(file);
      res.writeHead(200, {
        'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
        'Content-Length': metadata.size,
        'Cache-Control': ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.woff2'].includes(extension)
          ? 'public, max-age=86400'
          : 'no-cache',
      });
      res.end(body);
    } catch (error) {
      const status = ['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code) ? 404 : 500;
      textResponse(req, res, status, status === 404 ? 'Not found\n' : 'Internal server error\n');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const {createFirebaseRuntime}=await import('./firebase-runtime.mjs');
  const server = createAppServer({accountHandler:await createFirebaseRuntime()});
  server.listen(port, '0.0.0.0', () => {
    console.log(`こつこつ日和 is listening on port ${port}`);
  });

  process.once('SIGTERM', () => {
    const timer = setTimeout(() => server.closeAllConnections(), 8000);
    timer.unref();
    server.close(() => clearTimeout(timer));
  });
}
