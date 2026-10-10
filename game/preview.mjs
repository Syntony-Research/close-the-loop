import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('./dist/', import.meta.url));
const port = Number(process.env.PORT || 4189);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
const mime = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.mp4':'video/mp4'};

const server = http.createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, {Allow:'GET, HEAD'}); response.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
  catch { response.writeHead(400); response.end('Invalid path'); return; }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const filename = path.resolve(root, '.' + pathname);
  if (!filename.startsWith(root)) { response.writeHead(403); response.end('Forbidden'); return; }
  try {
    const contents = await readFile(filename);
    response.writeHead(200, {'Content-Type':mime[path.extname(filename)] || 'application/octet-stream','Content-Length':contents.byteLength,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    response.end(request.method === 'HEAD' ? undefined : contents);
  } catch { response.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); response.end('Not found'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`BLACKLINE local practice: http://127.0.0.1:${port}`));
