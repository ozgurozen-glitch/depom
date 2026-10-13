#!/usr/bin/env node
// Oyunu headless Chromium'da açar; ekran görüntüsü alır, konsol hatalarını ve oyun durumunu yazdırır.
//
// Kullanım:
//   node tools/shot.mjs [seçenekler]
//     --query "skipmenu=1&autopilot=1"   URL parametreleri
//     --wait 6                           ilk görüntüden önce bekleme (s)
//     --shots 3 --interval 2             görüntü sayısı ve aralığı (s)
//     --out shots                        çıktı klasörü (varsayılan: tools/out)
//     --prefix run                       dosya adı öneki
//     --size 1280x720                    pencere boyutu
//     --keys "ArrowLeft:2-3,ShiftLeft:4-4.2"   tuşu basılı tut (s cinsinden başlangıç-bitiş)
//     --click "#hud button@1"            seçiciye tıkla (s)
//     --eval "window.__game.debugState()"  sonunda çalıştırılıp çıktısı yazdırılır
//     --touch                            dokunmatik cihaz öykünmesi
// Çıkış kodu: sayfa hatası (pageerror) veya konsol error varsa 1.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = {
    query: '', wait: 6, shots: 1, interval: 2, out: path.join(ROOT, 'tools/out'), prefix: 'shot',
    size: '1280x720', keys: '', click: '', eval: 'window.__game && window.__game.debugState()', touch: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key === 'touch') { out.touch = true; continue; }
    out[key] = argv[++i];
  }
  out.wait = Number(out.wait);
  out.shots = Number(out.shots);
  out.interval = Number(out.interval);
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function loadPlaywright() {
  const globalRoot = execSync('npm root -g').toString().trim();
  return import(pathToFileURL(path.join(globalRoot, 'playwright/index.mjs')).href);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  fs.mkdirSync(opt.out, { recursive: true });
  const server = await startServer();
  const port = server.address().port;
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const [w, h] = opt.size.split('x').map(Number);
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    hasTouch: opt.touch,
    isMobile: opt.touch,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}\n${err.stack || ''}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    else if (msg.type() === 'warning') console.log(`[warn] ${msg.text()}`);
  });
  page.on('requestfailed', (req) => errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`));

  const url = `http://127.0.0.1:${port}/index.html${opt.query ? `?${opt.query}` : ''}`;
  console.log(`URL: ${url}`);
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });

  const schedule = [];
  for (const spec of opt.keys.split(',').filter(Boolean)) {
    const [key, range] = spec.split(':');
    const [s, e] = range.split('-').map(Number);
    schedule.push({ at: s, fn: () => page.keyboard.down(key) });
    schedule.push({ at: e, fn: () => page.keyboard.up(key) });
  }
  for (const spec of opt.click.split(',').filter(Boolean)) {
    const [sel, at] = spec.split('@');
    schedule.push({ at: Number(at || 0), fn: () => page.click(sel, { timeout: 3000 }).catch((e) => errors.push(`click ${sel}: ${e.message}`)) });
  }
  for (let i = 0; i < opt.shots; i++) {
    const at = opt.wait + i * opt.interval;
    schedule.push({
      at,
      fn: async () => {
        const file = path.join(opt.out, `${opt.prefix}-${i + 1}.png`);
        await page.screenshot({ path: file });
        const state = await page.evaluate(() => (window.__game ? JSON.stringify(window.__game.debugState()) : 'no __game'));
        console.log(`[${at}s] ${file}\n  ${state}`);
      },
    });
  }
  schedule.sort((a, b) => a.at - b.at);
  for (const item of schedule) {
    const delay = item.at * 1000 - (Date.now() - t0);
    if (delay > 0) await sleep(delay);
    await item.fn();
  }

  if (opt.eval) {
    try {
      const result = await page.evaluate((code) => {
        // eslint-disable-next-line no-eval
        const v = (0, eval)(code);
        return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
      }, opt.eval);
      console.log(`eval:\n${result}`);
    } catch (e) {
      errors.push(`eval: ${e.message}`);
    }
  }

  await browser.close();
  server.close();
  if (errors.length) {
    console.log(`\nHATALAR (${errors.length}):\n${errors.join('\n')}`);
    process.exit(1);
  }
  console.log('\nHata yok.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
