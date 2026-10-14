// Yükleyici kancaları:
//  - 'three' → vendor/three/three.module.js
//  - src/car.js?tune=<json> → CAR_TUNING üzerine tune yazılmış ayrı modül örneği (her araç modeli ayrı sınıf).
//    Car'da henüz `draft` yoksa, simülasyon için azami hız/ivmeye en fazla %8 ekleyen yama da uygulanır
//    (araç ajanının gerçek uygulaması gelince bu yama kendiliğinden devre dışı kalır).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const THREE = pathToFileURL(path.join(ROOT, 'vendor/three/three.module.js')).href;
const ADDONS = pathToFileURL(path.join(ROOT, 'vendor/three/addons/')).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: THREE, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) {
    return { url: ADDONS + specifier.slice('three/addons/'.length), shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  const m = /\/src\/car\.js\?(?:r=\d+&)?tune=(.*)$/.exec(url);
  if (!m) return next(url, context);
  const tune = decodeURIComponent(m[1]);
  let src = fs.readFileSync(fileURLToPath(url.split('?')[0]), 'utf8');
  src = src.replace('const T = CAR_TUNING;', `const T = Object.assign({}, CAR_TUNING, ${tune});`);
  if (!/\.draft\b/.test(src)) {
    src = src
      .replace(
        /return this\.nitroActive \? T\.maxSpeed \* NITRO_LEVELS\[this\.nitroLevel\]\.speedMul : T\.maxSpeed;/,
        'return (this.nitroActive ? T.maxSpeed * NITRO_LEVELS[this.nitroLevel].speedMul : T.maxSpeed) * (1 + 0.08 * (this.draft || 0));',
      )
      .replace(
        'const thrust = (T.accel + (nitro ? nitro.thrust : 0)) * thr;',
        'const thrust = (T.accel + (nitro ? nitro.thrust : 0)) * thr * (1 + 0.08 * (this.draft || 0));',
      );
  }
  return { format: 'module', source: src, shortCircuit: true };
}
