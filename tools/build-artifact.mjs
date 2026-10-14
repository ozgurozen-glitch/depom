#!/usr/bin/env node
// Oyunu tek bir HTML dosyasına paketler (yayın ortamı için). Harici ağ yok: three.js vendor/ altından gelir.
//
// Kullanım:
//   node tools/build-artifact.mjs [çıktı yolu]            varsayılan: dist/nitro-rush.html
//   node tools/build-artifact.mjs --check [çıktı yolu]    derle, sonra Playwright ile file:// üzerinde doğrula
//
// esbuild 0.24.0, node_modules/.build-artifact altına (proje bağımlılıklarını değiştirmeden) kurulur.
// Çıktı, yayın ortamının kendi <!doctype>/<head>/<body> iskeletine sarılacak parçadır; bu yüzden o etiketler yazılmaz.
// Doğrulama için dosya CSP meta etiketiyle sarılarak dist/ altına geçici olarak yazılır.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor');
const DEFAULT_OUT = path.join(ROOT, 'dist', 'nitro-rush.html');
const ESBUILD_VERSION = '0.24.0';

const STYLE_BLOCK = `<style>
  :root { --bg: #05070d; --fg: #ffffff; --err: #ff6b6b; color-scheme: dark; }
  html, body { height: 100%; margin: 0; overflow: hidden; background: var(--bg); color: var(--fg);
    touch-action: none; user-select: none; -webkit-user-select: none; }
  #game { position: fixed; inset: 0; }
  #game canvas { display: block; width: 100%; height: 100%; }
  #hud { position: fixed; inset: 0; pointer-events: none; }
  #hud .interactive { pointer-events: auto; }
  #boot-error { position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
    padding: 24px max(16px, env(safe-area-inset-right, 0px)) 24px max(16px, env(safe-area-inset-left, 0px));
    text-align: center; background: var(--bg); color: var(--err); font: 16px/1.5 system-ui, sans-serif; }
</style>`;

const GUARD_SCRIPT = `<script>
  (function () {
    function show(msg) {
      var el = document.getElementById('boot-error');
      if (!el || window.__game) return;
      el.textContent = msg;
      el.style.display = 'flex';
    }
    window.addEventListener('error', function (e) { show('Oyun yüklenemedi: ' + (e.message || 'bilinmeyen hata')); });
    window.addEventListener('unhandledrejection', function (e) { show('Oyun yüklenemedi: ' + ((e.reason && e.reason.message) || e.reason)); });
    setTimeout(function () { show('Oyun 15 saniyede başlamadı. Sayfayı yenilemeyi dene; tarayıcın WebGL desteklemiyor olabilir.'); }, 15000);
  })();
</script>`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

// esbuild'i sabit sürümle yükler (ilk çalıştırmada npm ile kurulur, node_modules gitignore'da).
function loadEsbuild() {
  const prefix = path.join(ROOT, 'node_modules', '.build-artifact');
  const dir = path.join(prefix, 'node_modules', 'esbuild');
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    console.log(`esbuild@${ESBUILD_VERSION} kuruluyor (${path.relative(ROOT, prefix)})...`);
    fs.mkdirSync(prefix, { recursive: true });
    execSync(`npm install --no-save --no-audit --no-fund --prefix "${prefix}" esbuild@${ESBUILD_VERSION}`, {
      stdio: 'inherit',
    });
  }
  return createRequire(import.meta.url)(dir);
}

// 'three' ve 'three/addons/*' importlarını vendor/three altındaki yerel dosyalara çözer.
const threeVendorPlugin = {
  name: 'three-vendor',
  setup(build) {
    build.onResolve({ filter: /^three(\/|$)/ }, (args) => {
      const sub = args.path.slice('three'.length); // '' veya '/addons/...'
      if (sub === '') return { path: path.join(VENDOR, 'three', 'three.module.js') };
      if (sub.startsWith('/addons/')) return { path: path.join(VENDOR, 'three', sub.slice(1)) };
      return null;
    });
  },
};

async function bundle(esbuild) {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'main.js')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    platform: 'browser',
    legalComments: 'none',
    write: false,
    logLevel: 'warning',
    plugins: [threeVendorPlugin],
  });
  // Satır içi betikte </script> kapanış etiketi olmasın.
  return result.outputFiles[0].text.replace(/<\/(script)/gi, (_, s) => `<\\/${s}`);
}

function assemble(js) {
  const hudCss = fs.readFileSync(path.join(ROOT, 'src', 'hud.css'), 'utf8');
  if (/<\/style/i.test(hudCss)) throw new Error('src/hud.css içinde </style dizisi var');
  return [
    '<title>Nitro Rush</title>',
    '<meta name="claude:viewport-fit-sides" content="cover">',
    STYLE_BLOCK,
    `<style id="nr-hud-css">\n${hudCss}\n</style>`,
    '<div id="game"></div><div id="hud"></div><div id="boot-error"></div>',
    GUARD_SCRIPT,
    `<script type="module">\n${js}\n</script>`,
    '',
  ].join('\n');
}

async function loadPlaywright() {
  const globalRoot = execSync('npm root -g').toString().trim();
  return import(pathToFileURL(path.join(globalRoot, 'playwright/index.mjs')).href);
}

// Çıktıyı yayın ortamına benzer bir CSP ile file:// üzerinde açar; oyun başladı mı, hata var mı bakar.
async function check(outFile) {
  const body = fs.readFileSync(outFile, 'utf8');
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:";
  const probe = path.join(path.dirname(outFile), `${path.basename(outFile, '.html')}.check.html`);
  fs.writeFileSync(
    probe,
    `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${body}</body></html>`,
  );

  const errors = [];
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    await page.goto(pathToFileURL(probe).href, { waitUntil: 'load' });
    await sleep(12000);
    const info = await page.evaluate(() => {
      const boot = document.getElementById('boot-error');
      return {
        hasGame: Boolean(window.__game),
        hasCanvas: Boolean(document.querySelector('#game canvas')),
        bootVisible: boot ? getComputedStyle(boot).display !== 'none' : null,
        bootText: boot ? boot.textContent : '',
      };
    });
    const shot = path.join(path.dirname(outFile), `${path.basename(outFile, '.html')}-check.png`);
    // Headless yazılımsal çizimde kare çok yavaş olabilir; ekran görüntüsü için uzun zaman aşımı.
    await page.screenshot({ path: shot, timeout: 120000 });
    console.log(`Ekran görüntüsü: ${shot}`);
    console.log(`window.__game: ${info.hasGame ? 'var' : 'YOK'}, canvas: ${info.hasCanvas ? 'var' : 'YOK'}, boot-error görünür: ${info.bootVisible}`);
    if (info.bootVisible) errors.push(`boot-error: ${info.bootText}`);
    if (!info.hasGame) errors.push('window.__game tanımlı değil');
    if (!info.hasCanvas) errors.push('#game içinde canvas yok');
  } finally {
    await browser.close();
    fs.rmSync(probe, { force: true });
  }

  if (errors.length) {
    console.log(`\nDOĞRULAMA BAŞARISIZ (${errors.length}):\n${errors.join('\n')}`);
    process.exit(1);
  }
  console.log('Doğrulama başarılı: oyun başladı, sayfa/konsol hatası yok.');
}

async function main() {
  const args = process.argv.slice(2);
  const doCheck = args.includes('--check');
  const positional = args.filter((a) => !a.startsWith('--'));
  const outFile = positional[0] ? path.resolve(positional[0]) : DEFAULT_OUT;

  const esbuild = loadEsbuild();
  const js = await bundle(esbuild);
  const html = assemble(js);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html);

  const gz = zlib.gzipSync(html, { level: 9 }).length;
  console.log(`Yazıldı: ${path.relative(ROOT, outFile) || outFile}`);
  console.log(`Boyut: ${kb(Buffer.byteLength(html))} (gzip ${kb(gz)}), paket JS: ${kb(Buffer.byteLength(js))}`);

  if (doCheck) await check(outFile);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
