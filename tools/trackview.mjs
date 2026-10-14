#!/usr/bin/env node
// Pist/mekân incelemesi için sabit kamera görüntüleri (geliştirme aracı).
// Oyunu açar, takip kamerasını devre dışı bırakır ve istenen noktalardan görüntü alır.
//
// Kullanım:
//   node tools/trackview.mjs --s "0,400,1100" [--h 5] [--back 14] [--ahead 40] [--side 0]
//   node tools/trackview.mjs --top                 kuşbakışı (tüm pist)
//   node tools/trackview.mjs --free "x,y,z,tx,ty,tz[,fov]"; ...
//   --prefix view --size 1280x720 --wait 4 --out tools/out --hud (HUD'u gizleme)
//   --pre "<js>"                       görüntülerden önce sayfada çalıştırılır
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { s: '', h: 5, back: 14, ahead: 40, side: 0, top: false, free: '', prefix: 'view', size: '1280x720', wait: 4, out: path.join(ROOT, 'tools/out'), hud: false, query: 'skipmenu=1&autopilot=1', settle: 1.2, topSize: 1800, topCenter: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key === 'top' || key === 'hud') { out[key] = true; continue; }
    out[key] = argv[++i];
  }
  return out;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  fs.mkdirSync(opt.out, { recursive: true });
  const server = await startServer();
  const globalRoot = execSync('npm root -g').toString().trim();
  const { chromium } = await import(pathToFileURL(path.join(globalRoot, 'playwright/index.mjs')).href);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const [w, h] = opt.size.split('x').map(Number);
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack || ''}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); else if (m.type() === 'log' || m.type() === 'warning') console.log(`[page] ${m.text()}`); });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?${opt.query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.track, null, { timeout: 60000 });
  console.log(`load: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await sleep(opt.wait * 1000);

  await page.evaluate((hud) => {
    const g = window.__game;
    g.chaseCam.update = () => {};
    g.paused = true; // simülasyonu dondur (duraklat menüsü açmadan)
    if (!hud) document.getElementById('hud').style.display = 'none';
  }, opt.hud);

  if (opt.pre) await page.evaluate((code) => (0, eval)(code), opt.pre);

  const views = [];
  if (opt.top) views.push({ name: 'top', top: true });
  for (const s of opt.s.split(',').filter(Boolean)) views.push({ name: `s${s}`, s: Number(s) });
  for (const f of opt.free.split(';').filter(Boolean)) views.push({ name: `free${views.length}`, free: f.split(',').map(Number) });

  for (const v of views) {
    const info = await page.evaluate(({ v, opt }) => {
      const g = window.__game;
      const cam = g.camera;
      const tr = g.track;
      cam.fov = 65;
      if (window.__savedFog === undefined) window.__savedFog = g.scene.fog;
      g.scene.fog = v.top ? null : window.__savedFog;
      cam.near = v.top ? 20 : 0.1;
      if (v.top) {
        const b = tr.bounds;
        const cx = opt.topCenter ? Number(opt.topCenter.split(',')[0]) : (b.minX + b.maxX) / 2;
        const cz = opt.topCenter ? Number(opt.topCenter.split(',')[1]) : (b.minZ + b.maxZ) / 2;
        cam.fov = 30;
        const size = Number(opt.topSize);
        const hgt = size / 2 / Math.tan((cam.fov / 2) * Math.PI / 180) / cam.aspect * 1.0;
        cam.position.set(cx, hgt, cz + 0.01);
        cam.up.set(0, 0, -1);
        cam.lookAt(cx, 0, cz);
        cam.up.set(0, 1, 0);
        g.player.position.set(cx, 0, cz);
      } else if (v.free) {
        const [x, y, z, tx, ty, tz, fov] = v.free;
        cam.position.set(x, y, z);
        cam.lookAt(tx, ty, tz);
        if (fov) cam.fov = fov;
        g.player.position.set(tx, ty, tz);
      } else {
        const a = tr.sample(v.s - Number(opt.back));
        const b = tr.sample(v.s + Number(opt.ahead));
        const side = Number(opt.side);
        cam.position.copy(a.pos).addScaledVector(a.right, side);
        cam.position.y += Number(opt.h);
        cam.lookAt(b.pos.x + b.right.x * side * 0.3, b.pos.y + 1.5, b.pos.z + b.right.z * side * 0.3);
        const p = tr.sample(v.s);
        g.player.position.copy(p.pos);
      }
      cam.updateProjectionMatrix();
      // Duraklatılmış simülasyonda ortamın (gölge kutusu, tünel ambiyansı) yeni konuma oturması için
      for (let i = 0; i < 6; i++) g.environment.update(0.5, g.player.position);
      return { pos: cam.position.toArray().map((n) => Math.round(n)), section: tr.sectionAt ? tr.sectionAt(v.s || 0) : '' };
    }, { v, opt });
    await sleep(Number(opt.settle) * 1000);
    const file = path.join(opt.out, `${opt.prefix}-${v.name}.png`);
    await page.screenshot({ path: file });
    const stats = await page.evaluate(() => {
      const g = window.__game;
      // Bir karenin tüm geçişlerini (gölge + sahne + efektler) say
      const info = g.renderer.info;
      info.autoReset = false;
      info.reset();
      const t = performance.now();
      g.effects.render();
      const ms = performance.now() - t;
      const r = { calls: info.render.calls, triangles: info.render.triangles };
      info.autoReset = true;
      return { calls: r.calls, triangles: r.triangles, fps: Math.round(g.fps), ms: Math.round(ms) };
    });
    console.log(`${file}  cam=${info.pos} ${info.section}  calls=${stats.calls} tris=${stats.triangles} fps=${stats.fps} renderMs=${stats.ms}`);
  }

  await browser.close();
  server.close();
  if (errors.length) {
    console.log(`\nHATALAR (${errors.length}):\n${errors.join('\n')}`);
    process.exit(1);
  }
  console.log('Hata yok.');
}

main().catch((e) => { console.error(e); process.exit(1); });
