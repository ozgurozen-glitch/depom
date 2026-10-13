#!/usr/bin/env node
// YALNIZCA TEST: tools/shot.mjs'in test sahnesi (tools/cartest/index.html) için uyarlaması.
//   node tools/cartest/run.mjs --query "scenario=jump&pauseAt=3" --wait 6 --shots 1 --prefix jump
//   seçenekler: --page tools/cartest/index.html --query --wait --shots --interval --prefix --size --keys --eval --touch
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const opt = {
  page: 'tools/cartest/index.html', query: '', wait: 5, shots: 1, interval: 2, out: path.join(ROOT, 'tools/out'),
  prefix: 'cartest', size: '1280x720', keys: '', eval: 'window.__test && window.__test.state()', touch: false,
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const k = argv[i].replace(/^--/, '');
  if (k === 'touch') opt.touch = true;
  else opt[k] = argv[++i];
}
opt.wait = Number(opt.wait);
opt.shots = Number(opt.shots);
opt.interval = Number(opt.interval);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { chromium } = await import(pathToFileURL(path.join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs')).href);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const [w, h] = opt.size.split('x').map(Number);
const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: opt.touch, isMobile: opt.touch });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack || ''}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
fs.mkdirSync(opt.out, { recursive: true });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${server.address().port}/${opt.page}${opt.query ? `?${opt.query}` : ''}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sched = [];
for (const spec of opt.keys.split(',').filter(Boolean)) {
  const [key, range] = spec.split(':');
  const [s, e] = range.split('-').map(Number);
  sched.push({ at: s, fn: () => page.keyboard.down(key) }, { at: e, fn: () => page.keyboard.up(key) });
}
for (let i = 0; i < opt.shots; i++) {
  const at = opt.wait + i * opt.interval;
  sched.push({
    at,
    fn: async () => {
      const file = path.join(opt.out, `${opt.prefix}-${i + 1}.png`);
      await page.screenshot({ path: file });
      console.log(`[${at}s] ${file}\n  ${await page.evaluate(() => JSON.stringify(window.__test && window.__test.state()))}`);
    },
  });
}
sched.sort((a, b) => a.at - b.at);
for (const it of sched) {
  const d = it.at * 1000 - (Date.now() - t0);
  if (d > 0) await sleep(d);
  await it.fn();
}
if (opt.eval) {
  try {
    const r = await page.evaluate((c) => { const v = (0, eval)(c); return typeof v === 'string' ? v : JSON.stringify(v); }, opt.eval);
    console.log(`eval: ${r}`);
  } catch (e) {
    errors.push(`eval: ${e.message}`);
  }
}
await browser.close();
server.close();
if (errors.length) {
  console.log(`HATALAR:\n${errors.join('\n')}`);
  process.exit(1);
}
console.log('Hata yok.');
