// Anteprima locale in "modalità demo": serve docs/ sostituendo Supabase con un finto DB in memoria.
// Avvio: node tests/dev/server.mjs  ->  http://localhost:8080
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..', '..', 'docs');
const port = Number(process.env.PORT) || 8080;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  try {
    if (path === '/mock-supabase.js') {
      res.writeHead(200, { 'Content-Type': types['.js'] });
      return res.end(await readFile(join(here, 'mock-supabase.js')));
    }
    if (path === '/js/config.js') {
      res.writeHead(200, { 'Content-Type': types['.js'] });
      return res.end("export const SUPABASE_URL = 'https://demo.supabase.co';\nexport const SUPABASE_ANON_KEY = 'demo';\n");
    }
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) throw new Error('fuori radice');
    let body = await readFile(file);
    if (path === '/js/common.js') {
      body = body.toString().replace(/from 'https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase[^']+'/, "from '/mock-supabase.js'");
    }
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(port, () => console.log(`Anteprima demo su http://localhost:${port}`));
