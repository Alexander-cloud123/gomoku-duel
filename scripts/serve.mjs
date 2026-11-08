// scripts/serve.mjs - 本地静态服务器
// ES module 与 Worker 在 file:// 协议下会被浏览器 CORS 拦截，开发时必须走 HTTP。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.wasm': 'application/wasm'
};

function isInsideRoot(filePath) {
    const normalizedRoot = resolve(ROOT);
    const normalizedFile = resolve(filePath);
    return normalizedFile === normalizedRoot || normalizedFile.startsWith(normalizedRoot + '\\') ||
        normalizedFile.startsWith(normalizedRoot + '/');
}

const server = createServer(async (req, res) => {
    const startedAt = Date.now();
    // urlPath 只在 try 内赋值；失败时直接返回，因此不设初值
    let urlPath;
    try {
        urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
        res.writeHead(400).end('Bad Request');
        return;
    }

    if (urlPath === '/') urlPath = '/index.html';

    if (urlPath.includes('\0')) {
        res.writeHead(400).end('Bad Request');
        return;
    }

    const filePath = join(ROOT, urlPath);
    if (!isInsideRoot(filePath)) {
        res.writeHead(403).end('Forbidden');
        return;
    }

    try {
        const info = await stat(filePath);
        if (!info.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });

        const body = await readFile(filePath);
        const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, {
            'Content-Type': type,
            'Content-Length': body.length,
            'Cache-Control': 'no-store'
        });
        res.end(body);
        if (urlPath.endsWith('.js') || urlPath.endsWith('.mjs')) {
            console.log(`${req.method} ${urlPath} ${body.length}B ${Date.now() - startedAt}ms`);
        }
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`404 Not Found: ${urlPath}`);
    }
});

server.listen(PORT, HOST, () => {
    console.log(`gomoku-duel dev server: http://${HOST}:${PORT}/`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        server.close(() => process.exit(0));
    });
}
