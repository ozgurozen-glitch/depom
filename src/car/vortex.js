// "Vortex GT" — orta motorlu hiper otomobil: alçak kama gövde, tavan hava alığı, büyük karbon kanat.
//
// Yerel eksenler: +Z ileri, +Y yukarı, +X arabanın SOLU (sözleşmedeki right = -X).
// Zemin y = 0; arabanın merkezi (x = 0, z = 0) yol temas noktasıdır.
import * as THREE from 'three';
import {
  smoothstep, bump, prep, merge, box, surfaceHit, surfaceStrip, rangePoints, extrudeProfile, splitCanopy,
  airfoilShape, wheelGeometry, probeMesh, BLACK, CARBON, METAL,
} from './geo.js';

// Boyutlar (metre). Fizik ve efektler de bunları kullanır.
export const DIMS = Object.freeze({
  length: 4.6,
  width: 2.0,
  height: 1.15,
  wheelRadius: 0.35,
  frontAxleZ: 1.45,
  rearAxleZ: -1.4,
  frontTrack: 0.83, // tekerlek merkezinin |x|'i
  rearTrack: 0.84,
  pivotY: 0.62, // görsel dönüşlerin (takla, spin) ekseni
  exhaustLocal: [[0.21, 0.44, -2.44], [-0.21, 0.44, -2.44]],
  rearContactLocal: [[0.84, 0.0, -1.4], [-0.84, 0.0, -1.4]],
});
function bodyShape() {
  const s = new THREE.Shape();
  const archR = 0.45;
  const archCY = 0.35;
  const sill = 0.2;
  const a0 = Math.asin((archCY - sill) / archR);
  const dz = Math.cos(a0) * archR;
  const rearZ = DIMS.rearAxleZ;
  const frontZ = DIMS.frontAxleZ;

  s.moveTo(2.16, 0.19);
  s.bezierCurveTo(2.27, 0.2, 2.3, 0.28, 2.3, 0.37); // burun alt kavisi
  s.bezierCurveTo(2.3, 0.46, 2.22, 0.53, 2.06, 0.58); // burun ucu
  s.bezierCurveTo(1.86, 0.64, 1.66, 0.8, 1.44, 0.82); // ön çamurluk yükselişi
  s.bezierCurveTo(1.18, 0.84, 0.98, 0.77, 0.74, 0.76); // çamurluktan kaputa
  s.bezierCurveTo(0.3, 0.76, -0.3, 0.79, -0.72, 0.84); // bel çizgisi
  s.bezierCurveTo(-1.0, 0.88, -1.2, 0.95, -1.45, 0.96); // arka çamurluk (haunch)
  s.bezierCurveTo(-1.75, 0.97, -2.0, 0.96, -2.29, 0.94); // motor kapağı → ördek kuyruğu
  s.lineTo(-2.32, 0.86);
  s.bezierCurveTo(-2.35, 0.72, -2.34, 0.52, -2.3, 0.42); // arka yüz
  s.lineTo(-2.18, 0.22);
  // Alt kenar: tekerlek kemerleri.
  s.lineTo(rearZ - dz, sill);
  s.absarc(rearZ, archCY, archR, Math.PI + a0, -a0, true);
  s.lineTo(frontZ - dz, sill);
  s.absarc(frontZ, archCY, archR, Math.PI + a0, -a0, true);
  s.lineTo(2.16, 0.19);
  return s;
}

function bodyDeform(z, y, u, out) {
  let w = 1;
  // Plan görünüşü: burun ve kuyruk daralır.
  if (z > 1.5) {
    const t = (z - 1.5) / 0.85;
    w *= 1 - 0.17 * t * t;
  }
  if (z < -1.95) w *= 1 - 0.07 * ((-1.95 - z) / 0.4);
  // Tumblehome: üst kısım içe yatar.
  w *= 1 - 0.1 * smoothstep(0.55, 0.98, y);
  // Kapılarda yan oyuk (hava girişine akan yüzey).
  w *= 1 - 0.045 * bump(z, -0.25, 0.75) * bump(y, 0.5, 0.17);
  out.w = w;

  // Kaput çukuru: ön çamurluklar yüksek, ortası alçak.
  const top = smoothstep(0.48, 0.66, y);
  const dipFront = 0.15 * smoothstep(0.6, 1.05, z) * (1 - 0.45 * smoothstep(1.85, 2.3, z));
  // Arka güverte: iki çamurluk arasındaki motor kapağı kanalı.
  const dipRear = 0.065 * smoothstep(-0.95, -1.3, z) * (1 - smoothstep(-2.1, -2.3, z));
  out.dy = -(dipFront + dipRear) * top * (1 - u * u);
  // Köşe yuvarlatma: burun ve kuyruk köşeleri geri çekilir (plan görünüşünde mermi burun).
  const u2 = u * u;
  out.dz = -0.3 * u2 * u2 * smoothstep(1.55, 2.35, z) + 0.1 * u2 * u2 * smoothstep(-1.9, -2.4, z);
}

function canopyShape() {
  const c = new THREE.Shape();
  c.moveTo(1.0, 0.68);
  c.lineTo(0.97, 0.75);
  c.bezierCurveTo(0.68, 0.85, 0.36, 1.0, 0.1, 1.065); // ön cam
  c.bezierCurveTo(-0.15, 1.1, -0.45, 1.1, -0.7, 1.06); // tavan
  c.bezierCurveTo(-0.95, 1.0, -1.2, 0.92, -1.5, 0.87); // arka cam / fastback
  c.lineTo(-1.55, 0.8);
  c.lineTo(-1.5, 0.68);
  c.lineTo(1.0, 0.68);
  return c;
}

function canopyDeform(z, y, u, out) {
  let w = 1 - 0.24 * smoothstep(0.76, 1.1, y);
  w *= 1 - 0.2 * smoothstep(-0.85, -1.55, z);
  w *= 1 - 0.06 * smoothstep(0.55, 1.0, z);
  out.w = w;
  out.dy = 0;
  out.dz = 0;
}

export function buildVortex() {
  const D = DIMS;

  // --- Gövde (boya) ---
  const body = extrudeProfile(bodyShape(), 1.0, {
    steps: 12, curveSegments: 10, bevelThickness: 0.07, bevelSize: 0.05, bevelSegments: 4, crease: 0.8,
  }, bodyDeform);
  const canopyRaw = extrudeProfile(canopyShape(), 0.76, {
    steps: 8, curveSegments: 10, bevelThickness: 0.06, bevelSize: 0.045, bevelSegments: 3, crease: 0.9, keepSource: true,
  }, canopyDeform);
  const canopy = splitCanopy(canopyRaw, (z, y, u) => u < 0.8 && y > 0.95 && z < 0.02 && z > -0.74);
  canopyRaw.dispose();

  const upperParts = [canopy.roof];
  // Tavan hava alığı (orta motorlu yarış arabası imzası).
  upperParts.push(prep(box(0.34, 0.1, 0.6), { pos: [0, 1.12, -0.38], rot: [0.05, 0, 0] }));
  upperParts.push(prep(box(0.26, 0.06, 0.45), { pos: [0, 1.1, -0.86], rot: [0.28, 0, 0] }));
  // Aynalar
  for (const sx of [1, -1]) {
    upperParts.push(prep(box(0.17, 0.085, 0.13), { pos: [sx * 0.95, 0.9, 0.64], rot: [0, sx * 0.15, 0] }));
  }
  // Kanat yan plakaları
  for (const sx of [1, -1]) {
    upperParts.push(prep(box(0.03, 0.3, 0.52), { pos: [sx * 0.94, 1.14, -2.06], rot: [-0.08, 0, 0] }));
  }
  const paintUpper = merge(upperParts);

  // --- Cam ---
  const glassGeo = canopy.glass;
  glassGeo.computeBoundingSphere();

  // Yüzey yerleşimi için geçici gövde (yalnızca boya kabuğu).
  const probe = probeMesh(body);
  const FRONT = [0, 0, -1];
  const REAR = [0, 0, 1];

  // --- Siyah aksamlar (vertex renkli tek materyal) ---
  const trim = [];
  // Alt taban ve yan marşpiyeller
  trim.push(prep(box(1.86, 0.06, 4.15), { pos: [0, 0.17, -0.05], color: BLACK }));
  for (const sx of [1, -1]) {
    trim.push(prep(box(0.08, 0.1, 2.1), { pos: [sx * 0.95, 0.2, 0.03], color: CARBON }));
  }
  // Tekerlek davlumbazı iç duvarları (kemerlerden karşı tarafın görünmesini engeller)
  for (const z of [D.frontAxleZ, D.rearAxleZ]) {
    for (const sx of [1, -1]) {
      trim.push(prep(box(0.02, 0.46, 0.96), { pos: [sx * 0.6, 0.4, z], color: BLACK }));
    }
  }
  // Ön splitter
  trim.push(prep(box(1.56, 0.03, 0.26), { pos: [0, 0.155, 2.13], color: CARBON }));
  for (const sx of [1, -1]) {
    // Ön hava girişleri (burun yüzünde)
    trim.push(...surfaceStrip(probe, rangePoints(6, (t) => [sx * (0.46 + 0.36 * t), 0.31 + 0.03 * t, 5]), FRONT,
      { height: 0.13, depth: 0.05, lift: -0.012, color: BLACK }));
    // Far yuvası (siyah bant)
    trim.push(...surfaceStrip(probe, rangePoints(8, (t) => [sx * (0.3 + 0.56 * t), 0.475 + 0.045 * t, 5]), FRONT,
      { height: 0.085, depth: 0.05, lift: -0.014, color: BLACK }));
    // Yan hava girişleri (arka tekerleğin önünde)
    trim.push(...surfaceStrip(probe, rangePoints(6, (t) => [sx * 5, 0.52 + 0.06 * t, -0.3 - 0.68 * t]), [-sx, 0, 0],
      { height: 0.24 - 0.08 * 0, depth: 0.06, lift: -0.016, color: BLACK }));
    trim.push(...surfaceStrip(probe, rangePoints(6, (t) => [sx * 5, 0.67 + 0.06 * t, -0.28 - 0.68 * t]), [-sx, 0, 0],
      { height: 0.03, depth: 0.05, lift: 0.004, color: CARBON }));
  }
  // Ön orta giriş
  trim.push(...surfaceStrip(probe, rangePoints(6, (t) => [-0.36 + 0.72 * t, 0.3, 5]), FRONT,
    { height: 0.11, depth: 0.05, lift: -0.012, color: BLACK }));
  // Aynalar: sap
  for (const sx of [1, -1]) {
    trim.push(prep(box(0.2, 0.03, 0.06), { pos: [sx * 0.84, 0.86, 0.66], rot: [0, 0, sx * 0.25], color: CARBON }));
  }
  // Motor kapağı panjurları
  for (let i = 0; i < 5; i++) {
    const z = -1.45 - i * 0.12;
    const h = surfaceHit(probe, [0, 5, z], [0, -1, 0]);
    trim.push(prep(box(0.6, 0.02, 0.05), { pos: [0, (h ? h.p.y : 0.92) + 0.006, z], color: BLACK }));
  }
  // Arka panel (stoplar arası siyah bant), difüzör ve kanatçıkları
  trim.push(...surfaceStrip(probe, rangePoints(8, (t) => [-0.74 + 1.48 * t, 0.58, -5]), REAR,
    { height: 0.22, depth: 0.05, lift: -0.012, color: BLACK }));
  // Stop yuvası: her boya renginde kırmızı şerit seçilsin.
  trim.push(...surfaceStrip(probe, rangePoints(12, (t) => [-0.86 + 1.72 * t, 0.79, -5]), REAR,
    { height: 0.075, depth: 0.05, lift: -0.012, color: BLACK }));
  trim.push(prep(box(1.7, 0.03, 0.62), { pos: [0, 0.27, -2.02], rot: [-0.32, 0, 0], color: CARBON }));
  for (let i = -2; i <= 2; i++) {
    trim.push(prep(box(0.025, 0.16, 0.55), { pos: [i * 0.32, 0.25, -2.05], rot: [-0.32, 0, 0], color: CARBON }));
  }
  // Egzoz uçları (merkezde çift)
  for (const ex of D.exhaustLocal) {
    trim.push(prep(new THREE.CylinderGeometry(0.075, 0.075, 0.16, 16, 1, true), {
      pos: [ex[0], ex[1], ex[2] + 0.08], rot: [Math.PI / 2, 0, 0], color: METAL,
    }));
    trim.push(prep(new THREE.CircleGeometry(0.07, 16), { pos: [ex[0], ex[1], ex[2] + 0.03], rot: [0, Math.PI, 0], color: BLACK }));
  }
  const top = [];
  // Büyük arka kanat: profil + dikmeler
  const wingProfile = new THREE.ExtrudeGeometry(airfoilShape(0.46, 0.07), {
    depth: 1.84, steps: 1, curveSegments: 8, bevelEnabled: false,
  });
  wingProfile.translate(0, 0, -0.92);
  top.push(prep(wingProfile, { pos: [0, 1.22, -2.08], rot: [0, -Math.PI / 2, -0.14], color: CARBON }));
  for (const sx of [1, -1]) {
    top.push(prep(box(0.04, 0.34, 0.16), { pos: [sx * 0.42, 1.06, -2.04], rot: [-0.25, 0, 0], color: CARBON }));
  }
  const trimGeo = merge(trim);
  const trimTopGeo = merge(top);

  // --- Farlar (emissive beyaz LED şeritler) ---
  const head = [];
  for (const sx of [1, -1]) {
    head.push(...surfaceStrip(probe, rangePoints(8, (t) => [sx * (0.32 + 0.53 * t), 0.505 + 0.045 * t, 5]), FRONT,
      { height: 0.022, depth: 0.03, lift: 0.004 }));
    // Dış uçta dikey gündüz farı
    head.push(...surfaceStrip(probe, rangePoints(3, (t) => [sx * 0.86, 0.36 + 0.13 * t, 5]), FRONT,
      { height: 0.022, depth: 0.03, lift: 0.004 }));
  }
  const headGeo = merge(head);

  // --- Stoplar (kırmızı şerit) ---
  const tail = [];
  tail.push(...surfaceStrip(probe, rangePoints(12, (t) => [-0.84 + 1.68 * t, 0.79, -5]), REAR,
    { height: 0.035, depth: 0.03, lift: 0.004 }));
  for (const sx of [1, -1]) {
    tail.push(...surfaceStrip(probe, rangePoints(3, (t) => [sx * 0.86, 0.62 + 0.17 * t, -5]), REAR,
      { height: 0.035, depth: 0.03, lift: 0.004 }));
  }
  const tailGeo = merge(tail);


  // --- Tekerlekler ---
  const wheelL = wheelGeometry([{ side: 1, x: 0 }]);
  const wheelR = wheelGeometry([{ side: -1, x: 0 }]);
  const rearAxle = wheelGeometry([{ side: 1, x: D.rearTrack }, { side: -1, x: -D.rearTrack }]);

  return { paintBody: body, paintUpper, glass: glassGeo, trim: trimGeo, trimTop: trimTopGeo, head: headGeo, tail: tailGeo, wheelL, wheelR, rearAxle };
}

// Kamera bağlantı noktaları (araç yerel koordinatı).
export const ANCHORS = { hood: [0, 1.0, 0.95], bumper: [0, 0.46, 2.34] };
