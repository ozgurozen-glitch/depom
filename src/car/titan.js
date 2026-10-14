// "Titan V8" — kaslı GT: uzun burun, kaput kabartması ve hava alığı, siyah çift şerit, kalın lastikler,
// dikey üçlü stop çubukları ve arka köşelerde çift egzoz. Kanat yerine kısa ördek kuyruğu.
//
// Yerel eksenler: +Z ileri, +Y yukarı, +X arabanın SOLU (sözleşmedeki right = -X).
import * as THREE from 'three';
import {
  smoothstep, bump, prep, merge, box, surfaceHit, surfaceStrip, rangePoints, extrudeProfile, splitCanopy,
  wheelGeometry, probeMesh, BLACK, CARBON, METAL,
} from './geo.js';

export const DIMS = Object.freeze({
  length: 5.0,
  width: 2.06,
  height: 1.36,
  wheelRadius: 0.385,
  frontAxleZ: 1.62,
  rearAxleZ: -1.42,
  frontTrack: 0.83,
  rearTrack: 0.85,
  pivotY: 0.66,
  exhaustLocal: [[0.66, 0.4, -2.52], [-0.66, 0.4, -2.52]],
  rearContactLocal: [[0.85, 0.0, -1.42], [-0.85, 0.0, -1.42]],
  shadow: [3.1, 6.4],
});

// Kamera bağlantı noktaları (araç yerel koordinatı).
export const ANCHORS = { hood: [0, 1.12, 0.78], bumper: [0, 0.5, 2.6] };

export const WHEEL = {
  R: 0.385, halfW: 0.18, rimR: 0.27, hub: 0.07, disc: 0.23,
  // 5 kalın kollu derin jant
  spokes: { n: 5, double: false, w: 0.075, t: 0.05, len: 0.2, center: 0.15, camber: -0.14 },
};

const ARCH_R = 0.5;
const ARCH_CY = 0.385;
const SILL = 0.24;

function bodyShape() {
  const s = new THREE.Shape();
  const a0 = Math.asin((ARCH_CY - SILL) / ARCH_R);
  const dz = Math.cos(a0) * ARCH_R;
  const { rearAxleZ: rearZ, frontAxleZ: frontZ } = DIMS;

  s.moveTo(2.36, 0.22);
  s.bezierCurveTo(2.47, 0.22, 2.52, 0.29, 2.52, 0.4); // ön tampon alt
  s.bezierCurveTo(2.52, 0.52, 2.5, 0.62, 2.46, 0.72); // geniş, dik burun yüzü
  s.bezierCurveTo(2.4, 0.8, 2.2, 0.86, 1.9, 0.92); // burun kaputa
  s.bezierCurveTo(1.4, 0.99, 0.95, 1.02, 0.55, 1.03); // uzun kaput, yüksek bel
  s.bezierCurveTo(0.1, 1.04, -0.8, 1.05, -1.2, 1.06); // bel çizgisi
  s.bezierCurveTo(-1.7, 1.07, -2.1, 1.07, -2.32, 1.07); // arka omuz / bagaj
  s.bezierCurveTo(-2.4, 1.07, -2.44, 1.1, -2.46, 1.14); // ördek kuyruğu
  s.lineTo(-2.5, 1.04);
  s.bezierCurveTo(-2.52, 0.85, -2.52, 0.55, -2.46, 0.4); // arka yüz
  s.lineTo(-2.36, 0.26);
  s.lineTo(rearZ - dz, SILL);
  s.absarc(rearZ, ARCH_CY, ARCH_R, Math.PI + a0, -a0, true);
  s.lineTo(frontZ - dz, SILL);
  s.absarc(frontZ, ARCH_CY, ARCH_R, Math.PI + a0, -a0, true);
  s.lineTo(2.36, 0.22);
  return s;
}

function bodyDeform(z, y, u, out) {
  let w = 1;
  if (z > 2.0) {
    const t = (z - 2.0) / 0.52;
    w *= 1 - 0.09 * t * t;
  }
  if (z < -2.1) w *= 1 - 0.05 * ((-2.1 - z) / 0.4);
  w *= 1 - 0.06 * smoothstep(0.78, 1.14, y); // tumblehome
  // Omuz çizgisi: hafif bombe + belirgin kalça.
  w *= 1 + 0.018 * bump(y, 0.8, 0.07);
  w *= 1 + 0.03 * bump(z, DIMS.rearAxleZ, 0.7) * smoothstep(0.3, 0.55, y) * (1 - smoothstep(0.85, 1.05, y));
  w *= 1 + 0.015 * bump(z, DIMS.frontAxleZ, 0.55) * smoothstep(0.3, 0.55, y) * (1 - smoothstep(0.85, 1.05, y));
  // Kapılarda yan oyuk
  w *= 1 - 0.04 * bump(z, -0.2, 0.9) * bump(y, 0.62, 0.16);
  out.w = w;

  // Kaput kabartması (power dome): ortada yükselen, uca doğru sönen şişkinlik.
  const top = smoothstep(0.84, 0.98, y);
  const dome = 0.115 * bump(u, 0, 0.3) * smoothstep(0.35, 1.1, z) * (1 - smoothstep(1.9, 2.4, z));
  out.dy = (dome - 0.03 * u * u * smoothstep(0.8, 1.8, z)) * top;
  const u4 = u * u * u * u;
  out.dz = -0.2 * u4 * smoothstep(2.0, 2.5, z) + 0.12 * u4 * smoothstep(-2.1, -2.5, z);
}

function canopyShape() {
  const c = new THREE.Shape();
  c.moveTo(0.62, 1.0);
  c.bezierCurveTo(0.42, 1.1, 0.22, 1.26, 0.0, 1.31); // ön cam
  c.bezierCurveTo(-0.25, 1.37, -0.75, 1.37, -1.0, 1.32); // tavan
  c.bezierCurveTo(-1.3, 1.25, -1.65, 1.14, -2.0, 1.09); // fastback arka cam
  c.lineTo(-2.04, 1.0);
  c.lineTo(0.62, 1.0);
  return c;
}

function canopyDeform(z, y, u, out) {
  let w = 1 - 0.22 * smoothstep(1.1, 1.38, y);
  w *= 1 - 0.14 * smoothstep(-1.0, -2.0, z);
  w *= 1 - 0.06 * smoothstep(0.3, 0.62, z);
  out.w = w;
  out.dy = 0;
  out.dz = 0;
}

export function buildTitan() {
  const D = DIMS;
  const body = extrudeProfile(bodyShape(), 1.0, {
    steps: 12, curveSegments: 10, bevelThickness: 0.07, bevelSize: 0.05, bevelSegments: 4, crease: 0.8,
  }, bodyDeform);
  const canopyRaw = extrudeProfile(canopyShape(), 0.78, {
    steps: 8, curveSegments: 10, bevelThickness: 0.06, bevelSize: 0.045, bevelSegments: 3, crease: 0.9, keepSource: true,
  }, canopyDeform);
  const canopy = splitCanopy(canopyRaw, (z, y, u) => u < 0.82 && y > 1.28 && z < 0.0 && z > -1.02);
  canopyRaw.dispose();

  const upper = [canopy.roof];
  // Aynalar (kalın, kutu) ve kaput hava alığı gövdesi
  for (const sx of [1, -1]) {
    upper.push(prep(box(0.2, 0.1, 0.15), { pos: [sx * 1.0, 1.1, 0.5], rot: [0, sx * 0.18, 0] }));
  }
  const paintUpper = merge(upper);
  const glass = canopy.glass;
  glass.computeBoundingSphere();

  const probe = probeMesh(body);
  const FRONT = [0, 0, -1];
  const REAR = [0, 0, 1];
  const DOWN = [0, -1, 0];

  const trim = [];
  // Alt taban ve yan marşpiyeller
  trim.push(prep(box(1.9, 0.06, 4.6), { pos: [0, 0.2, -0.05], color: BLACK }));
  for (const sx of [1, -1]) {
    trim.push(prep(box(0.08, 0.1, 2.3), { pos: [sx * 1.0, 0.24, 0.1], color: CARBON }));
  }
  for (const z of [D.frontAxleZ, D.rearAxleZ]) {
    for (const sx of [1, -1]) {
      trim.push(prep(box(0.02, 0.54, 1.05), { pos: [sx * 0.66, 0.46, z], color: BLACK }));
    }
  }
  // Ön dudak
  trim.push(prep(box(1.8, 0.04, 0.3), { pos: [0, 0.19, 2.34], color: CARBON }));
  for (const sx of [1, -1]) {
    // Geniş ızgara (iki yan blok) ve alt hava girişleri
    trim.push(...surfaceStrip(probe, rangePoints(6, (t) => [sx * (0.22 + 0.55 * t), 0.5, 5]), FRONT,
      { height: 0.23, depth: 0.06, lift: -0.014, color: BLACK }));
    trim.push(...surfaceStrip(probe, rangePoints(5, (t) => [sx * (0.62 + 0.32 * t), 0.31, 5]), FRONT,
      { height: 0.14, depth: 0.05, lift: -0.012, color: BLACK }));
    // Far yuvası (kalın siyah çerçeve)
    trim.push(...surfaceStrip(probe, rangePoints(6, (t) => [sx * (0.82 + 0.15 * t), 0.7, 5]), FRONT,
      { height: 0.12, depth: 0.05, lift: -0.014, color: BLACK }));
    // Yan: ön çamurluk arkası hava çıkışı
    trim.push(...surfaceStrip(probe, rangePoints(6, (t) => [sx * 5, 0.56 + 0.04 * t, 0.9 - 0.5 * t]), [-sx, 0, 0],
      { height: 0.07, depth: 0.05, lift: -0.012, color: BLACK }));
  }
  // Orta ızgara: siyah ağız + krom çubuk
  trim.push(...surfaceStrip(probe, rangePoints(8, (t) => [-0.2 + 0.4 * t, 0.5, 5]), FRONT,
    { height: 0.23, depth: 0.06, lift: -0.014, color: BLACK }));
  trim.push(...surfaceStrip(probe, rangePoints(10, (t) => [-0.8 + 1.6 * t, 0.505, 5]), FRONT,
    { height: 0.03, depth: 0.06, lift: 0.004, color: METAL }));
  // Kaput hava alığı: dome üstünde ileri bakan siyah ağız + arkasında rampa
  const hs = surfaceHit(probe, [0, 5, 1.15], DOWN);
  const hy = hs ? hs.p.y : 1.1;
  trim.push(prep(box(0.46, 0.07, 0.34), { pos: [0, hy + 0.03, 1.2], rot: [0.16, 0, 0], color: BLACK }));
  trim.push(prep(box(0.5, 0.025, 0.4), { pos: [0, hy + 0.012, 1.0], rot: [0.1, 0, 0], color: CARBON }));
  // Çift siyah şerit (hood + bagaj)
  for (const sx of [1, -1]) {
    const hood = rangePoints(14, (t) => [sx * 0.2, 5, 0.65 + 1.75 * t]);
    trim.push(...surfaceStrip(probe, hood, DOWN, { height: 0.11, depth: 0.02, lift: 0.0, color: BLACK }));
    const deck = rangePoints(8, (t) => [sx * 0.2, 5, -1.92 - 0.5 * t]);
    trim.push(...surfaceStrip(probe, deck, DOWN, { height: 0.11, depth: 0.02, lift: 0.0, color: BLACK }));
  }
  // Arka panel, siyah bant, difüzör
  trim.push(...surfaceStrip(probe, rangePoints(10, (t) => [-0.95 + 1.9 * t, 0.62, -5]), REAR,
    { height: 0.24, depth: 0.05, lift: -0.012, color: BLACK }));
  trim.push(...surfaceStrip(probe, rangePoints(12, (t) => [-0.96 + 1.92 * t, 0.9, -5]), REAR,
    { height: 0.2, depth: 0.05, lift: -0.012, color: BLACK }));
  trim.push(prep(box(1.6, 0.04, 0.4), { pos: [0, 0.3, -2.4], rot: [-0.25, 0, 0], color: CARBON }));
  // Çift egzoz: arka köşelerde kalın krom uçlar
  for (const ex of D.exhaustLocal) {
    trim.push(prep(new THREE.CylinderGeometry(0.1, 0.1, 0.22, 20, 1, true), {
      pos: [ex[0], ex[1], ex[2] + 0.11], rot: [Math.PI / 2, 0, 0], color: METAL,
    }));
    trim.push(prep(new THREE.CircleGeometry(0.094, 18), { pos: [ex[0], ex[1], ex[2] + 0.05], rot: [0, Math.PI, 0], color: BLACK }));
    trim.push(prep(new THREE.RingGeometry(0.094, 0.115, 18), { pos: [ex[0], ex[1], ex[2] + 0.222], rot: [0, 0, 0], color: METAL }));
  }
  const trimGeo = merge(trim);

  // Kısa karbon ördek kuyruğu (kanat yok)
  const top = [];
  top.push(prep(box(1.5, 0.04, 0.26), { pos: [0, 1.2, -2.38], rot: [0.22, 0, 0], color: CARBON }));
  for (const sx of [1, -1]) top.push(prep(box(0.035, 0.1, 0.26), { pos: [sx * 0.75, 1.16, -2.38], color: CARBON }));
  const trimTop = merge(top);

  // --- Farlar: iki kalın LED bloğu + halka gündüz ışığı ---
  const head = [];
  for (const sx of [1, -1]) {
    head.push(...surfaceStrip(probe, rangePoints(5, (t) => [sx * (0.84 + 0.12 * t), 0.7, 5]), FRONT,
      { height: 0.06, depth: 0.03, lift: 0.004 }));
    head.push(...surfaceStrip(probe, rangePoints(4, (t) => [sx * (0.86 + 0.1 * t), 0.63, 5]), FRONT,
      { height: 0.035, depth: 0.03, lift: 0.004 }));
    head.push(...surfaceStrip(probe, rangePoints(3, (t) => [sx * 0.97, 0.52 + 0.17 * t, 5]), FRONT,
      { height: 0.03, depth: 0.03, lift: 0.004 }));
  }
  const headGeo = merge(head);

  // --- Stoplar: köşelerde dikey üçlü çubuk ---
  const tail = [];
  for (const sx of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      tail.push(...surfaceStrip(probe, rangePoints(4, (t) => [sx * (0.52 + i * 0.17), 0.8 + 0.2 * t, -5]), REAR,
        { height: 0.075, depth: 0.03, lift: 0.004 }));
    }
  }
  const tailGeo = merge(tail);

  const wheelL = wheelGeometry([{ side: 1, x: 0 }], WHEEL);
  const wheelR = wheelGeometry([{ side: -1, x: 0 }], WHEEL);
  const rearAxle = wheelGeometry([{ side: 1, x: D.rearTrack }, { side: -1, x: -D.rearTrack }], WHEEL);

  return { paintBody: body, paintUpper, glass, trim: trimGeo, trimTop, head: headGeo, tail: tailGeo, wheelL, wheelR, rearAxle };
}
