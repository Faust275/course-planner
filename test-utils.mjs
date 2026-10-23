// e2e 共用工具：把 verify_*.mjs 里重复的「起一个静态 http 服务器 + 抓页面错误」抽出来，
// 避免几十个脚本各抄一遍。Playwright 脚本统一从这里拿服务器与错误收集器。
import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.xml': 'application/xml',
};

/** 起一个把当前目录当根、随机端口的静态服务器，返回 { server, port, base, close } */
export function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = server.address().port;
      resolve({ server, port, base: `http://localhost:${port}`, close: () => server.close() });
    });
  });
}

/** 把页面的 pageerror / console.error 收集进 errors 数组（用于失败断言） */
export function attachErrorCapture(page, errors) {
  page.on('pageerror', (e) => errors.push(String(e) + '\n' + (e.stack || '')));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
}

/** 打开一个页面并挂上错误收集，返回 { page, errors } */
export async function openPage(browser, viewport) {
  const page = await browser.newPage({ viewport: viewport || { width: 480, height: 1400 } });
  const errors = [];
  attachErrorCapture(page, errors);
  return { page, errors };
}

export { chromium };
