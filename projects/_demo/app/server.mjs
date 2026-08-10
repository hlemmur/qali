import console from 'node:console';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';

const indexPath = fileURLToPath(new URL('./public/index.html', import.meta.url));

export function createDemoServer() {
  return createServer(async (request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, mode: 'mock' }));
      return;
    }
    if (request.url !== '/' && request.url !== '/index.html') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    });
    response.end(await readFile(indexPath));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = '127.0.0.1';
  const port = Number(process.env.PORT ?? 4173);
  createDemoServer().listen(port, host, () => {
    console.log(`Qali demo (MOCK MODE) listening at http://${host}:${port}`);
  });
}
