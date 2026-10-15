#!/usr/bin/env node
// Sayfa içi tam yarış (g.step ile hızlandırarak): botların toplam drift sayısını sayar, yarış sonunda durumu yazar ve
// bir bot drift ederken kamerayı o bota çevirip ekran görüntüsü alır.
//   node tools/aisim/pagedrift.mjs --track bangkok --difficulty hard [--shot out.png]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const opt = { track: 'bangkok', difficulty: 'hard', shot: '' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = argv[i + 1];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { chromium } = await import(pathToFileURL(path.join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs')).href);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?skipmenu=1&autopilot=1&speed=1&fxq=low&track=${opt.track}&difficulty=${opt.difficulty}`);
await page.waitForTimeout(2500);

const result = await page.evaluate((wantShot) => {
  const g = window.__game;
  const bots = g.cars.filter((c) => c !== g.player);
  const was = new Map(bots.map((b) => [b, false]));
  let drifts = 0;
  let driftSteps = 0;
  let n = 0;
  let shotBot = null;
  while (g.state !== 'finished' && n < 120000) {
    g.step(1 / 60);
    n++;
    for (const b of bots) {
      const d = b.drifting === true;
      if (d && !was.get(b)) drifts++;
      if (d) driftSteps++;
      was.set(b, d);
      // ekran görüntüsü için: bot kayma açısı oturmuşken dur
      if (wantShot && !shotBot && d && b.getDriftState && b.getDriftState().angle > 0.5 && b.speed > 25) shotBot = b;
    }
    if (shotBot) break;
  }
  if (shotBot) {
    g.paused = true;
    Object.defineProperty(g, 'player', { get: () => shotBot, configurable: true });
    return { shot: true, drifts, steps: n, who: shotBot.name };
  }
  const d = g.debugState();
  return {
    steps: n, state: d.state, raceTime: d.raceTime, player: d.player.place, drifts, driftSeconds: +(driftSteps / 60).toFixed(1),
    finished: d.bots.filter((b) => b.finished).length + (d.player.finished ? 1 : 0), wrecked: d.bots.filter((b) => b.wrecked).length,
  };
}, Boolean(opt.shot));
console.log(JSON.stringify(result));
if (opt.shot && result.shot) {
  await page.waitForTimeout(2500);
  await page.screenshot({ path: opt.shot });
  console.log('ekran görüntüsü:', opt.shot);
}
console.log(errors.length ? `HATA: ${errors.slice(0, 3).join(' | ')}` : 'Hata yok.');
await browser.close();
server.close();
