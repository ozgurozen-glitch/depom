// "Raijin RS" — hafif Japon tuner kupesi: uzun kaput, geniş perçinli çamurluk kabarmaları, ince LED farlar,
// yüksek dikmeli büyük GT arka kanadı, fastback hatch.
//
// Yerel eksenler: +Z ileri, +Y yukarı, +X arabanın SOLU (sözleşmedeki right = -X).
import * as THREE from 'three';
import {
  smoothstep, bump, prep, merge, box, surfaceHit, surfaceStrip, rangePoints, extrudeProfile, splitCanopy,
  airfoilShape, wheelGeometry, probeMesh, BLACK, CARBON, METAL,
} from './geo.js';

export const DIMS = Object.freeze({
  length: 4.44,
  width: 1.94,
  height: 1.32,
  wheelRadius: 0.335,
  frontAxleZ: 1.32,
  rearAxleZ: -1.28,
  frontTrack: 0.8,
  rearTrack: 0.82,
  pivotY: 0.6,
  exhaustLocal: [[0.36, 0.33, -2.3], [-0.36, 0.33, -2.3]],
  rearContactLocal: [[0.82, 0.0, -1.28], [-0.82, 0.0, -1.28]],
  shadow: [2.8, 5.7],
});

// Kamera bağlantı noktaları (araç yerel koordinatı).
export const ANCHORS = { hood: [0, 1.04, 0.62], bumper: [0, 0.44, 2.3] };

export const WHEEL = {
  R: 0.335, halfW: 0.14, rimR: 0.25, hub: 0.05, disc: 0.2,
  // 10 ince kollu hafif jant (tuner)
  spokes: { n: 10, double: false, w: 0.02, t: 0.034, len: 0.2, center: 0.15, camber: -0.1 },
};

const ARCH_R = 0.43;
const ARCH_CY = 0.335;
const SILL = 0.2;

function bodyShape() {
  const s = new THREE.Shape();
  const a0 = Math.asin((ARCH_CY - SILL) / ARCH_R);
  const dz = Math.cos(a0) * ARCH_R;
  const { rearAxleZ: rearZ, frontAxleZ: frontZ } = DIMS;

  s.moveTo(2.06, 0.2);
  s.bezierCurveTo(2.17, 0.2, 2.22, 0.27, 2.22, 0.36); // ön tampon alt dudak
  s.bezierCurveTo(2.22, 0.45, 2.2, 0.52, 2.12, 0.58); // tampon → burun kenarı
  s.bezierCurveTo(2.0, 0.64, 1.8, 0.7, 1.5, 0.79); // burun kaputa yükselir
  s.bezierCurveTo(1.1, 0.84, 0.8, 0.86, 0.55, 0.88); // uzun kaput, cama doğru hafif yükselir
  s.bezierCurveTo(0.2, 0.9, -0.4, 0.9, -0.8, 0.92); // bel çizgisi
  s.bezierCurveTo(-1.2, 0.94, -1.5, 0.97, -1.8, 0.99); // arka omuz
  s.bezierCurveTo(-2.0, 1.0, -2.14, 1.03, -2.2, 1.05); // ördek kuyruğu
  s.lineTo(-2.24, 0.96);
  s.bezierCurveTo(-2.26, 0.8, -2.25, 0.55, -2.2, 0.42); // arka yüz
  s.lineTo(-2.1, 0.22);
  s.lineTo(rearZ - dz, SILL);
  s.absarc(rearZ, ARCH_CY, ARCH_R, Math.PI + a0, -a0, true);
  s.lineTo(frontZ - dz, SILL);
  s.absarc(frontZ, ARCH_CY, ARCH_R, Math.PI + a0, -a0, true);
  s.lineTo(2.06, 0.2);
  return s;
}

function bodyDeform(z, y, u, out) {
  let w = 1;
  if (z > 1.5) {
    const t = (z - 1.5) / 0.75;
    w *= 1 - 0.15 * t * t; // uzun, dar burun
  }
  if (z < -1.9) w *= 1 - 0.05 * ((-1.9 - z) / 0.35);
  w *= 1 - 0.07 * smoothstep(0.62, 1.0, y); // tumblehome
  w *= 1 - 0.04 * bump(z, -0.3, 0.7) * bump(y, 0.5, 0.17); // kapı oyuğu
  // Geniş çamurluk kabarmaları (overfender): arka daha geniş.
  const band = smoothstep(0.24, 0.46, y) * (1 - smoothstep(0.7, 0.84, y));
  w *= 1 + 0.07 * bump(z, DIMS.frontAxleZ, 0.5) * band + 0.085 * bump(z, DIMS.rearAxleZ, 0.55) * band;
  out.w = w;

  // Kaput: hafif tepe (orta yüksek), ön çamurluk üstü çukur.
  const top = smoothstep(0.62, 0.8, y);
  out.dy = (0.022 * bump(u, 0, 0.42) * smoothstep(0.3, 1.0, z) * (1 - smoothstep(1.7, 2.2, z)) - 0.03 * u * u * smoothstep(0.6, 1.4, z)) * top;
  const u4 = u * u * u * u;
  out.dz = -0.25 * u4 * smoothstep(1.6, 2.25, z) + 0.1 * u4 * smoothstep(-1.9, -2.3, z);
}

function canopyShape() {
  const c = new THREE.Shape();
  c.moveTo(0.8, 0.84);
  c.bezierCurveTo(0.56, 0.96, 0.26, 1.18, 0.0, 1.26); // ön cam
  c.bezierCurveTo(-0.25, 1.33, -0.7, 1.33, -0.95, 1.26); // tavan
  c.bezierCurveTo(-1.2, 1.18, -1.45, 1.03, -1.72, 0.93); // fastback arka cam
  c.lineTo(-1.76, 0.84);
  c.lineTo(0.8, 0.84);
  return c;
}

function canopyDeform(z, y, u, out) {
  let w = 1 - 0.2 * smoothstep(0.9, 1.3, y);
  w *= 1 - 0.16 * smoothstep(-0.8, -1.7, z);
  w *= 1 - 0.05 * smoothstep(0.45, 0.8, z);
  out.w = w;
  out.dy = 0;
  out.dz = 0;
}

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

// Yüzeye oturan küçük silindir (perçin).
function rivet(hit, r, h, color) {
  const g = prep(new THREE.CylinderGeometry(r, r, h, 8), { color });
  _q.setFromUnitVectors(_up, hit.n);
  g.applyMatrix4(new THREE.Matrix4().compose(hit.p.clone().addScaledVector(hit.n, h * 0.35), _q, new THREE.Vector3(1, 1, 1)));
  return g;
}

export function buildRaijin() {
  const D = DIMS;
  const body = extrudeProfile(bodyShape(), 0.9, {
    steps: 12, curveSegments: 10, bevelThickness: 0.07, bevelSize: 0.05, bevelSegments: 4, crease: 0.8,
  }, bodyDeform);
  const canopyRaw = extrudeProfile(canopyShape(), 0.7, {
    steps: 8, curveSegments: 10, bevelThickness: 0.06, bevelSize: 0.045, bevelSegments: 3, crease: 0.9, keepSource: true,
  }, canopyDeform);
  const canopy = splitCanopy(canopyRaw, (z, y, u) => u < 0.8 && y > 1.22 && z < -0.02 && z > -0.98);
  canopyRaw.dispose();

  const upper = [canopy.roof];
  // Tavan arka spoyleri (hatch üstü) ve aynalar
  upper.push(prep(box(1.2, 0.035, 0.22), { pos: [0, 1.0, -1.88], rot: [0.2, 0, 0] }));
  for (const sx of [1, -1]) {
    upper.push(prep(box(0.15, 0.08, 0.12), { pos: [sx * 0.86, 0.98, 0.6], rot: [0, sx * 0.2, 0] }));
    // Kanat yan plakaları
    upper.push(prep(box(0.03, 0.36, 0.66), { pos: [sx * 0.93, 1.5, -2.07], rot: [-0.06, 0, 0] }));
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
  trim.push(prep(box(1.7, 0.06, 4.0), { pos: [0, 0.17, -0.05], color: BLACK }));
  for (const sx of [1, -1]) {
    trim.push(prep(box(0.09, 0.1, 2.05), { pos: [sx * 0.9, 0.2, 0.0], color: CARBON }));
  }
  // Davlumbaz iç duvarları
  for (const z of [D.frontAxleZ, D.rearAxleZ]) {
    for (const sx of [1, -1]) {
      trim.push(prep(box(0.02, 0.45, 0.92), { pos: [sx * 0.58, 0.4, z], color: BLACK }));
    }
  }
  // Ön karbon dudak + kanatçıklar (canard)
  trim.push(prep(box(1.64, 0.035, 0.3), { pos: [0, 0.16, 2.06], color: CARBON }));
  trim.push(prep(box(1.46, 0.03, 0.12), { pos: [0, 0.145, 2.2], color: CARBON }));
  for (const sx of [1, -1]) {
    trim.push(prep(box(0.2, 0.025, 0.2), { pos: [sx * 0.8, 0.34, 2.02], rot: [0, sx * 0.4, sx * 0.35], color: CARBON }));
    // Geniş alt hava girişi (ön tampon yan)
    trim.push(...surfaceStrip(probe, rangePoints(6, (t) => [sx * (0.5 + 0.3 * t), 0.3 + 0.02 * t, 5]), FRONT,
      { height: 0.12, depth: 0.05, lift: -0.012, color: BLACK }));
    // Far yuvası (ince siyah bant)
    trim.push(...surfaceStrip(probe, rangePoints(8, (t) => [sx * (0.26 + 0.6 * t), 0.585 + 0.07 * t, 5]), FRONT,
      { height: 0.06, depth: 0.05, lift: -0.012, color: BLACK }));
    // Yan hava çıkışı (ön çamurluk arkası)
    trim.push(...surfaceStrip(probe, rangePoints(6, (t) => [sx * 5, 0.5 + 0.03 * t, 0.62 - 0.46 * t]), [-sx, 0, 0],
      { height: 0.1, depth: 0.05, lift: -0.012, color: BLACK }));
  }
  // Ön orta ızgara: geniş siyah ağız + yatay çıtalar
  trim.push(...surfaceStrip(probe, rangePoints(10, (t) => [-0.46 + 0.92 * t, 0.355, 5]), FRONT,
    { height: 0.17, depth: 0.05, lift: -0.012, color: BLACK }));
  for (let i = 0; i < 3; i++) {
    trim.push(...surfaceStrip(probe, rangePoints(8, (t) => [-0.42 + 0.84 * t, 0.31 + i * 0.05, 5]), FRONT,
      { height: 0.012, depth: 0.06, lift: 0.002, color: CARBON }));
  }
  // Kaput havalandırmaları (iki panjur seti) ve kaput pimleri
  for (const sx of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      const z = 1.0 + i * 0.1;
      const h = surfaceHit(probe, [sx * 0.34, 5, z], DOWN);
      if (h) trim.push(prep(box(0.3, 0.014, 0.05), { pos: [sx * 0.34, h.p.y + 0.004, z], rot: [-0.12, sx * -0.1, 0], color: BLACK }));
    }
    const hp = surfaceHit(probe, [sx * 0.62, 5, 1.7], DOWN);
    if (hp) trim.push(prep(new THREE.CylinderGeometry(0.02, 0.02, 0.014, 8), { pos: [hp.p.x, hp.p.y + 0.006, hp.p.z], color: METAL }));
  }
  // Çamurluk perçinleri (overfender)
  for (const z of [D.frontAxleZ, D.rearAxleZ]) {
    for (const sx of [1, -1]) {
      for (let k = 0; k < 9; k++) {
        const a = (25 + k * 16.5) * (Math.PI / 180);
        const hit = surfaceHit(probe, [sx * 5, ARCH_CY + 0.54 * Math.sin(a), z + 0.54 * Math.cos(a) * (k % 2 ? 1 : 1)], [-sx, 0, 0]);
        if (hit) trim.push(rivet(hit, 0.012, 0.022, METAL));
      }
    }
  }
  // Kapı alt çıtası, yakıt kapağı gibi küçük detaylar
  for (const sx of [1, -1]) {
    trim.push(...surfaceStrip(probe, rangePoints(6, (t) => [sx * 5, 0.66, 0.35 - 1.3 * t]), [-sx, 0, 0],
      { height: 0.012, depth: 0.04, lift: 0.002, color: CARBON }));
    trim.push(prep(box(0.2, 0.03, 0.06), { pos: [sx * 0.8, 0.94, 0.62], rot: [0, 0, sx * 0.25], color: CARBON }));
  }
  // Arka panel, difüzör, çift egzoz ucu
  trim.push(...surfaceStrip(probe, rangePoints(8, (t) => [-0.8 + 1.6 * t, 0.62, -5]), REAR,
    { height: 0.2, depth: 0.05, lift: -0.012, color: BLACK }));
  trim.push(...surfaceStrip(probe, rangePoints(12, (t) => [-0.86 + 1.72 * t, 0.84, -5]), REAR,
    { height: 0.08, depth: 0.05, lift: -0.012, color: BLACK }));
  trim.push(prep(box(1.5, 0.03, 0.5), { pos: [0, 0.26, -2.04], rot: [-0.3, 0, 0], color: CARBON }));
  for (let i = -2; i <= 2; i++) {
    trim.push(prep(box(0.025, 0.14, 0.46), { pos: [i * 0.3, 0.24, -2.07], rot: [-0.3, 0, 0], color: CARBON }));
  }
  for (const ex of D.exhaustLocal) {
    trim.push(prep(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 18, 1, true), {
      pos: [ex[0], ex[1], ex[2] + 0.1], rot: [Math.PI / 2, 0, 0], color: METAL,
    }));
    trim.push(prep(new THREE.CircleGeometry(0.066, 16), { pos: [ex[0], ex[1], ex[2] + 0.04], rot: [0, Math.PI, 0], color: BLACK }));
  }
  const trimGeo = merge(trim);

  // Büyük GT kanadı: yüksek "kuğu boynu" dikmeler + profil
  const top = [];
  const wingProfile = new THREE.ExtrudeGeometry(airfoilShape(0.5, 0.085), {
    depth: 1.8, steps: 1, curveSegments: 8, bevelEnabled: false,
  });
  wingProfile.translate(0, 0, -0.9);
  top.push(prep(wingProfile, { pos: [0, 1.52, -2.08], rot: [0, -Math.PI / 2, -0.12], color: CARBON }));
  top.push(prep(box(1.7, 0.012, 0.09), { pos: [0, 1.6, -2.28], rot: [0.5, 0, 0], color: CARBON })); // gurney
  for (const sx of [1, -1]) {
    top.push(prep(box(0.045, 0.52, 0.14), { pos: [sx * 0.4, 1.26, -2.06], rot: [-0.18, 0, 0], color: CARBON }));
    top.push(prep(box(0.07, 0.05, 0.3), { pos: [sx * 0.4, 1.02, -1.98], color: CARBON }));
  }
  const trimTop = merge(top);

  // --- Farlar: ince LED şerit + dikey gündüz ışığı ---
  const head = [];
  for (const sx of [1, -1]) {
    head.push(...surfaceStrip(probe, rangePoints(8, (t) => [sx * (0.3 + 0.58 * t), 0.612 + 0.072 * t, 5]), FRONT,
      { height: 0.018, depth: 0.03, lift: 0.004 }));
    head.push(...surfaceStrip(probe, rangePoints(3, (t) => [sx * 0.9, 0.4 + 0.15 * t, 5]), FRONT,
      { height: 0.016, depth: 0.03, lift: 0.004 }));
  }
  const headGeo = merge(head);

  // --- Stoplar: iki ince şerit + dış uçta dikey ---
  const tail = [];
  for (const sx of [1, -1]) {
    tail.push(...surfaceStrip(probe, rangePoints(6, (t) => [sx * (0.3 + 0.58 * t), 0.855, -5]), REAR,
      { height: 0.03, depth: 0.03, lift: 0.004 }));
    tail.push(...surfaceStrip(probe, rangePoints(6, (t) => [sx * (0.3 + 0.58 * t), 0.79, -5]), REAR,
      { height: 0.024, depth: 0.03, lift: 0.004 }));
    tail.push(...surfaceStrip(probe, rangePoints(3, (t) => [sx * 0.87, 0.64 + 0.17 * t, -5]), REAR,
      { height: 0.03, depth: 0.03, lift: 0.004 }));
  }
  const tailGeo = merge(tail);

  const wheelL = wheelGeometry([{ side: 1, x: 0 }], WHEEL);
  const wheelR = wheelGeometry([{ side: -1, x: 0 }], WHEEL);
  const rearAxle = wheelGeometry([{ side: 1, x: D.rearTrack }, { side: -1, x: -D.rearTrack }], WHEEL);

  return { paintBody: body, paintUpper, glass, trim: trimGeo, trimTop, head: headGeo, tail: tailGeo, wheelL, wheelR, rearAxle };
}
