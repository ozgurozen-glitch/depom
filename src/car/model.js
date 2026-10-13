// "Vortex GT" — prosedürel, orijinal orta motorlu hiper otomobil modeli.
//
// Yerel eksenler: +Z ileri, +Y yukarı, +X arabanın SOLU (sözleşmedeki right = -X).
// Zemin y = 0; arabanın merkezi (x = 0, z = 0) yol temas noktasıdır.
//
// Geometriler ve materyaller modül düzeyinde bir kez üretilir ve tüm arabalar arasında paylaşılır;
// araba başına yalnızca boya materyali klonlanır. Araba başına çizim çağrısı ~12.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

// Boyutlar (metre). Fizik ve efektler de bunları kullanır.
export const CAR_DIMENSIONS = Object.freeze({
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

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const bump = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));

let shared = null;

function getShared() {
  if (!shared) shared = buildShared();
  return shared;
}

// ---------------------------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------------------------

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

// Geometriyi indekssiz yapar, uv'yi atar, dönüşüm uygular, istenirse vertex rengi ekler.
function prep(geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = null, color = null } = {}) {
  // Çağıranlar her zaman taze geometri verir; indeksliyse kaynak serbest bırakılır.
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('uv');
  if (g.getAttribute('uv1')) g.deleteAttribute('uv1');
  _e.set(rot[0], rot[1], rot[2], 'YXZ');
  _q.setFromEuler(_e);
  _p.set(pos[0], pos[1], pos[2]);
  if (scale) _s.set(scale[0], scale[1], scale[2]);
  else _s.set(1, 1, 1);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  if (color !== null) {
    const c = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  return g;
}

function merge(list) {
  const g = mergeGeometries(list, false);
  for (const item of list) item.dispose();
  g.computeBoundingSphere();
  return g;
}

function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

// Gövde yüzeyine ışın atarak parça yerleştirme (farlar, stoplar, hava girişleri yüzeye oturur).
const _ray = new THREE.Raycaster();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

function surfaceHit(target, origin, dir) {
  _ray.set(_o.set(origin[0], origin[1], origin[2]), _d.set(dir[0], dir[1], dir[2]).normalize());
  const h = _ray.intersectObject(target, false)[0];
  if (!h) return null;
  const n = h.face.normal.clone();
  if (n.dot(_d) > 0) n.negate();
  return { p: h.point.clone(), n };
}

// origins: ışın başlangıçları (yol boyunca sıralı); her ardışık isabet çifti arasına yüzeye
// dik yönlendirilmiş ince bir kutu koyar. lift: yüzeyden dışarı kaydırma.
function surfaceStrip(target, origins, dir, { height, depth = 0.04, lift = 0.0, color = null }) {
  const hits = origins.map((o) => surfaceHit(target, o, dir)).filter(Boolean);
  const out = [];
  const xAxis = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();
  const m = new THREE.Matrix4();
  for (let i = 0; i < hits.length - 1; i++) {
    const a = hits[i];
    const b = hits[i + 1];
    xAxis.subVectors(b.p, a.p);
    const len = xAxis.length();
    if (len < 1e-4) continue;
    xAxis.divideScalar(len);
    zAxis.addVectors(a.n, b.n).normalize();
    yAxis.crossVectors(zAxis, xAxis).normalize();
    zAxis.crossVectors(xAxis, yAxis).normalize();
    m.makeBasis(xAxis, yAxis, zAxis);
    const c = a.p.clone().add(b.p).multiplyScalar(0.5).addScaledVector(zAxis, lift);
    m.setPosition(c);
    const g = prep(box(len + 0.012, height, depth), { color });
    g.applyMatrix4(m);
    out.push(g);
  }
  return out;
}

function rangePoints(n, f) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(f(i / n));
  return pts;
}

// Yan profilden (shape: x = boyuna z, y = yükseklik) genişlik boyunca ekstrüzyon ve köşe deformasyonu.
// deform(z, y, u) → { w: genişlik çarpanı, dy: yükseklik farkı }; u = -1..1 yanal konum.
function extrudeProfile(shape, halfWidth, opts, deform) {
  const bevelThickness = opts.bevelThickness;
  const depth = (halfWidth - bevelThickness) * 2;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: opts.steps,
    curveSegments: opts.curveSegments,
    bevelEnabled: true,
    bevelThickness,
    bevelSize: opts.bevelSize,
    bevelSegments: opts.bevelSegments,
  });
  geo.translate(0, 0, -depth / 2);
  const pos = geo.getAttribute('position');
  const out = { w: 1, dy: 0, dz: 0 };
  // Deformasyon öncesi (z, y, u) — üçgenleri ekstrüzyon ızgarasına göre ayırmak için.
  const src = opts.keepSource ? new Float32Array(pos.count * 3) : null;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getX(i);
    const y = pos.getY(i);
    const lat = pos.getZ(i);
    if (src) {
      src[i * 3] = z;
      src[i * 3 + 1] = y;
      src[i * 3 + 2] = lat / halfWidth;
    }
    out.w = 1;
    out.dy = 0;
    out.dz = 0;
    deform(z, y, lat / halfWidth, out);
    // Ekstrüzyon ekseni (shape z) → araba x; shape x → araba z.
    pos.setXYZ(i, -lat * out.w, y + out.dy, z + out.dz);
  }
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  if (src) geo.setAttribute('src', new THREE.BufferAttribute(src, 3));
  return toCreasedNormals(geo, opts.crease ?? 0.75); // indekssiz girdide aynı geometriyi döndürür

}

// ---------------------------------------------------------------------------------------------
// Gövde
// ---------------------------------------------------------------------------------------------

function bodyShape() {
  const s = new THREE.Shape();
  const archR = 0.45;
  const archCY = 0.35;
  const sill = 0.2;
  const a0 = Math.asin((archCY - sill) / archR);
  const dz = Math.cos(a0) * archR;
  const rearZ = CAR_DIMENSIONS.rearAxleZ;
  const frontZ = CAR_DIMENSIONS.frontAxleZ;

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

// Kabini cam ve boyalı tavan olarak ikiye böler. Ölçüt deformasyon öncesi ekstrüzyon ızgarasında
// değerlendirilir; böylece sınır satır/sütun çizgilerine denk gelir (dişsiz kenar).
function splitCanopy(geo) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const src = geo.getAttribute('src');
  const parts = { glass: [[], []], roof: [[], []] };
  for (let i = 0; i < pos.count; i += 3) {
    let z = 0;
    let y = 0;
    let u = 0;
    for (let k = 0; k < 3; k++) {
      z += src.getX(i + k) / 3;
      y += src.getY(i + k) / 3;
      u = Math.max(u, Math.abs(src.getZ(i + k)));
    }
    const isRoof = u < 0.8 && y > 0.95 && z < 0.02 && z > -0.74;
    const [tp, tn] = isRoof ? parts.roof : parts.glass;
    for (let k = 0; k < 3; k++) {
      tp.push(pos.getX(i + k), pos.getY(i + k) + (isRoof ? 0.004 : 0), pos.getZ(i + k));
      tn.push(nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k));
    }
  }
  const make = ([p, n]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    return g;
  };
  return { glass: make(parts.glass), roof: make(parts.roof) };
}

function airfoilShape(chord, thickness) {
  // Ters (bastırma kuvveti üreten) profil; x = boyuna (ileri +), y = yükseklik.
  const s = new THREE.Shape();
  const h = chord / 2;
  s.moveTo(h, 0);
  s.bezierCurveTo(h * 0.6, thickness * 0.2, -h * 0.4, thickness * 0.55, -h, thickness * 0.15);
  s.lineTo(-h, -thickness * 0.05);
  s.bezierCurveTo(-h * 0.3, -thickness * 0.45, h * 0.5, -thickness * 0.75, h, 0);
  return s;
}

// ---------------------------------------------------------------------------------------------
// Tekerlek
// ---------------------------------------------------------------------------------------------

function buildWheelParts(side) {
  // side = +1: dış yüz +X (sol tekerlek), -1: dış yüz -X (sağ tekerlek)
  const R = CAR_DIMENSIONS.wheelRadius;
  const halfW = 0.15;
  const rimR = 0.255;
  const toX = [0, 0, -Math.PI / 2]; // Y eksenli geometriyi X eksenine çevir

  const profile = [
    new THREE.Vector2(rimR - 0.005, -halfW),
    new THREE.Vector2(0.3, -halfW - 0.004),
    new THREE.Vector2(0.333, -halfW + 0.008),
    new THREE.Vector2(R - 0.002, -halfW + 0.035),
    new THREE.Vector2(R, 0),
    new THREE.Vector2(R - 0.002, halfW - 0.035),
    new THREE.Vector2(0.333, halfW - 0.008),
    new THREE.Vector2(0.3, halfW + 0.004),
    new THREE.Vector2(rimR - 0.005, halfW),
  ];
  const tire = [
    prep(new THREE.LatheGeometry(profile, 28), { rot: toX }),
    // Fren diski (jant kollarının arkasında koyu yüzey).
    prep(new THREE.CylinderGeometry(0.21, 0.21, 0.03, 20), { rot: toX, pos: [-0.01, 0, 0] }),
  ];

  const outer = halfW - 0.012;
  const rim = [
    prep(new THREE.CylinderGeometry(rimR, rimR, halfW * 2 - 0.02, 28, 1, true), { rot: toX }),
    prep(new THREE.RingGeometry(rimR - 0.03, rimR + 0.004, 28), { rot: [0, Math.PI / 2, 0], pos: [outer + 0.004, 0, 0] }),
    prep(new THREE.CylinderGeometry(0.06, 0.075, 0.05, 12), { rot: toX, pos: [outer - 0.025, 0, 0] }),
  ];
  // 5 çift kollu jant: her kol hafif içbükey (dış ucu daha dışarıda).
  for (let k = 0; k < 5; k++) {
    const base = (k / 5) * Math.PI * 2;
    for (const off of [-0.11, 0.11]) {
      const a = base + off;
      rim.push(prep(box(0.028, 0.19, 0.036), {
        rot: [a, 0, -0.12],
        pos: [outer - 0.03, Math.cos(a) * 0.145, Math.sin(a) * 0.145],
      }));
    }
  }
  // Bijon/merkez kapak
  rim.push(prep(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), { rot: toX, pos: [outer + 0.003, 0, 0] }));

  if (side < 0) {
    const flip = new THREE.Matrix4().makeRotationY(Math.PI);
    for (const g of tire) g.applyMatrix4(flip);
    for (const g of rim) g.applyMatrix4(flip);
  }
  return { tire, rim };
}

function wheelGeometry(sides) {
  // sides: [{ side, x }] — aynı aksı paylaşan tekerlekler tek geometride birleşir.
  const tireParts = [];
  const rimParts = [];
  for (const { side, x } of sides) {
    const { tire, rim } = buildWheelParts(side);
    for (const g of tire) { g.translate(x, 0, 0); tireParts.push(g); }
    for (const g of rim) { g.translate(x, 0, 0); rimParts.push(g); }
  }
  const tire = merge(tireParts);
  const rim = merge(rimParts);
  const g = mergeGeometries([tire, rim], true);
  tire.dispose();
  rim.dispose();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Paylaşılan kaynaklar
// ---------------------------------------------------------------------------------------------

function buildShared() {
  const D = CAR_DIMENSIONS;

  // --- Gövde (boya) ---
  const body = extrudeProfile(bodyShape(), 1.0, {
    steps: 12, curveSegments: 10, bevelThickness: 0.07, bevelSize: 0.05, bevelSegments: 4, crease: 0.8,
  }, bodyDeform);
  const canopyRaw = extrudeProfile(canopyShape(), 0.76, {
    steps: 8, curveSegments: 10, bevelThickness: 0.06, bevelSize: 0.045, bevelSegments: 3, crease: 0.9, keepSource: true,
  }, canopyDeform);
  const canopy = splitCanopy(canopyRaw);
  canopyRaw.dispose();

  const paintParts = [body, canopy.roof];
  // Tavan hava alığı (orta motorlu yarış arabası imzası).
  paintParts.push(prep(box(0.34, 0.1, 0.6), { pos: [0, 1.12, -0.38], rot: [0.05, 0, 0] }));
  paintParts.push(prep(box(0.26, 0.06, 0.45), { pos: [0, 1.1, -0.86], rot: [0.28, 0, 0] }));
  // Aynalar
  for (const sx of [1, -1]) {
    paintParts.push(prep(box(0.17, 0.085, 0.13), { pos: [sx * 0.95, 0.9, 0.64], rot: [0, sx * 0.15, 0] }));
  }
  // Kanat yan plakaları
  for (const sx of [1, -1]) {
    paintParts.push(prep(box(0.03, 0.3, 0.52), { pos: [sx * 0.94, 1.14, -2.06], rot: [-0.08, 0, 0] }));
  }
  const paintGeo = merge(paintParts);

  // --- Cam ---
  const glassGeo = canopy.glass;
  glassGeo.computeBoundingSphere();

  // Yüzey yerleşimi için geçici gövde (yalnızca boya kabuğu).
  const probe = new THREE.Mesh(body);
  probe.updateMatrixWorld(true);
  const FRONT = [0, 0, -1];
  const REAR = [0, 0, 1];

  // --- Siyah aksamlar (vertex renkli tek materyal) ---
  const BLACK = 0x060607;
  const CARBON = 0x1a1c20;
  const METAL = 0x8c9097;
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
  // Büyük arka kanat: profil + dikmeler
  const wingProfile = new THREE.ExtrudeGeometry(airfoilShape(0.46, 0.07), {
    depth: 1.84, steps: 1, curveSegments: 8, bevelEnabled: false,
  });
  wingProfile.translate(0, 0, -0.92);
  trim.push(prep(wingProfile, { pos: [0, 1.22, -2.08], rot: [0, -Math.PI / 2, -0.14], color: CARBON }));
  for (const sx of [1, -1]) {
    trim.push(prep(box(0.04, 0.34, 0.16), { pos: [sx * 0.42, 1.06, -2.04], rot: [-0.25, 0, 0], color: CARBON }));
  }
  const trimGeo = merge(trim);

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

  // --- Materyaller ---
  const materials = {
    paint: new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0.6, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.06,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x06090f, metalness: 0.85, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02,
    }),
    trim: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.42 }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f2ff, emissiveIntensity: 3.2 }),
    taillight: new THREE.MeshStandardMaterial({ color: 0x400004, emissive: 0xff1424, emissiveIntensity: 1.6 }),
    taillightBrake: new THREE.MeshStandardMaterial({ color: 0x600008, emissive: 0xff1a2c, emissiveIntensity: 5.5 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.92, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xa3a8b0, metalness: 0.9, roughness: 0.28, side: THREE.DoubleSide }),
    shadow: null,
  };

  // Temas gölgesi (blob) — yalnızca tarayıcıda (CanvasTexture).
  let shadowGeo = null;
  if (typeof document !== 'undefined') {
    // Bulanık yuvarlatılmış dikdörtgen (araba ayak izi) — canvas filtresi yoksa radyal gradyan.
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 128;
    const ctx = cv.getContext('2d');
    if ('filter' in ctx) {
      ctx.filter = 'blur(5px)';
      ctx.fillStyle = 'rgba(0,0,0,0.9)';
      const x = 9;
      const y = 11;
      const w = 64 - 2 * x;
      const h = 128 - 2 * y;
      const r = 14;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.fill();
    } else {
      ctx.translate(32, 64);
      ctx.scale(1, 2);
      const gr = ctx.createRadialGradient(0, 0, 4, 0, 0, 32);
      gr.addColorStop(0, 'rgba(0,0,0,0.9)');
      gr.addColorStop(0.65, 'rgba(0,0,0,0.6)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(-32, -32, 64, 64);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    materials.shadow = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, opacity: 0.75, color: 0x000000,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    shadowGeo = new THREE.PlaneGeometry(3.0, 6.0).rotateX(-Math.PI / 2);
  }

  return {
    geometries: { paint: paintGeo, glass: glassGeo, trim: trimGeo, head: headGeo, tail: tailGeo, wheelL, wheelR, rearAxle, shadow: shadowGeo },
    materials,
  };
}

// ---------------------------------------------------------------------------------------------
// Araba başına sahne grafiği
// ---------------------------------------------------------------------------------------------

/**
 * Hiyerarşi:
 *   root (zemin çerçevesi: konum, yaw, yol eğimi)
 *     └ visual (pivotY'de; takla / spin / wreck dönüşleri)
 *         └ model (-pivotY)
 *             ├ chassis (süspansiyon, yatış, dalış) → boya, cam, aksam, farlar, stoplar
 *             ├ frontLeft / frontRight pivot (direksiyon) → tekerlek (dönüş)
 *             └ rearAxle (dönüş)
 *   shadow: sahneye ayrı eklenir (havada yolda kalır)
 */
export function createCarModel(color) {
  const { geometries: G, materials: M } = getShared();
  const D = CAR_DIMENSIONS;

  const paint = M.paint.clone();
  paint.color.set(color);

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const visual = new THREE.Group();
  visual.rotation.order = 'YXZ';
  visual.position.y = D.pivotY;
  root.add(visual);
  const model = new THREE.Group();
  model.position.y = -D.pivotY;
  visual.add(model);

  const chassis = new THREE.Group();
  model.add(chassis);

  const bodyMesh = new THREE.Mesh(G.paint, paint);
  bodyMesh.castShadow = true;
  chassis.add(bodyMesh);
  chassis.add(new THREE.Mesh(G.glass, M.glass));
  chassis.add(new THREE.Mesh(G.trim, M.trim));
  chassis.add(new THREE.Mesh(G.head, M.headlight));
  const tail = new THREE.Mesh(G.tail, M.taillight);
  chassis.add(tail);

  const wheelMats = [M.tire, M.rim];
  const makeFront = (x, geo) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, D.wheelRadius, D.frontAxleZ);
    const wheel = new THREE.Mesh(geo, wheelMats);
    pivot.add(wheel);
    model.add(pivot);
    return { pivot, wheel };
  };
  const fl = makeFront(D.frontTrack, G.wheelL);
  const fr = makeFront(-D.frontTrack, G.wheelR);
  const rear = new THREE.Mesh(G.rearAxle, wheelMats);
  rear.position.set(0, D.wheelRadius, D.rearAxleZ);
  model.add(rear);

  let shadow = null;
  if (G.shadow) {
    shadow = new THREE.Mesh(G.shadow, M.shadow);
    shadow.rotation.order = 'YXZ';
    shadow.renderOrder = 1;
  }

  return {
    root,
    visual,
    model,
    chassis,
    body: bodyMesh,
    paint,
    tail,
    frontPivots: [fl.pivot, fr.pivot],
    frontWheels: [fl.wheel, fr.wheel],
    rearAxle: rear,
    shadow,
    setBraking(on) {
      tail.material = on ? M.taillightBrake : M.taillight;
    },
  };
}
