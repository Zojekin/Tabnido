import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';

const root = resolve('.');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ttf': 'font/ttf',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:5180');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '/preview') {
      pathname = '/preview.html';
    }
    const filePath = join(root, pathname);
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
});

const PORT = 5180;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Tabnido preview running at: http://127.0.0.1:${PORT}/`);
});
