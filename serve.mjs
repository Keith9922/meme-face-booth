// 本地静态服务器。必须正确吐 application/wasm，否则 MediaPipe 的
// instantiateStreaming 会失败。localhost 是 secure context，摄像头可用。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT) || 5173;
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json', '.wasm':'application/wasm',
  '.task':'application/octet-stream', '.png':'image/png', '.jpg':'image/jpeg',
  '.svg':'image/svg+xml', '.map':'application/json',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('nope'); return; }
    const s = await stat(file);
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Content-Length': s.size,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }).end('404');
  }
}).listen(PORT, () => console.log(`serving ${ROOT} → http://localhost:${PORT}`));
