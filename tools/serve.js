/**
 * 静态服务器。这个原型必须通过 http 访问：
 *   - fetch() 读取 .gif 需要同源请求（file:// 会失败）
 *   - Web Audio 的 AudioContext 需要在安全上下文/正常 origin 下工作
 *
 * 运行：node tools/serve.js [port]
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.gif': 'image/gif',
  '.wav': 'audio/wav',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let rel = url === '/' ? '/web/index.html' : url;
  const file = path.join(ROOT, rel);

  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + rel);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*',
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`serving ${ROOT}`);
  console.log(`  demo : http://localhost:${PORT}/`);
  console.log(`  lab  : http://localhost:${PORT}/web/lab.html`);
});
