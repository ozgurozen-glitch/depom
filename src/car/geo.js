// Araç modelleri için ortak geometri yardımcıları, tekerlek üreticisi ve paylaşılan materyaller.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
export const bump = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));

// ---------------------------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------------------------

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

// Geometriyi indekssiz yapar, uv'yi atar, dönüşüm uygular, istenirse vertex rengi ekler.
export function prep(geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = null, color = null } = {}) {
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

export function merge(list) {
  const g = mergeGeometries(list, false);
  for (const item of list) item.dispose();
  g.computeBoundingSphere();
  return g;
}

export function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

// Gövde yüzeyine ışın atarak parça yerleştirme (farlar, stoplar, hava girişleri yüzeye oturur).
const _ray = new THREE.Raycaster();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

export function surfaceHit(target, origin, dir) {
  _ray.set(_o.set(origin[0], origin[1], origin[2]), _d.set(dir[0], dir[1], dir[2]).normalize());
  const h = _ray.intersectObject(target, false)[0];
  if (!h) return null;
  const n = h.face.normal.clone();
  if (n.dot(_d) > 0) n.negate();
  return { p: h.point.clone(), n };
}

// origins: ışın başlangıçları (yol boyunca sıralı); her ardışık isabet çifti arasına yüzeye
// dik yönlendirilmiş ince bir kutu koyar. lift: yüzeyden dışarı kaydırma.
export function surfaceStrip(target, origins, dir, { height, depth = 0.04, lift = 0.0, color = null }) {
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

export function rangePoints(n, f) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(f(i / n));
  return pts;
}

// Yan profilden (shape: x = boyuna z, y = yükseklik) genişlik boyunca ekstrüzyon ve köşe deformasyonu.
// deform(z, y, u) → { w: genişlik çarpanı, dy: yükseklik farkı }; u = -1..1 yanal konum.
export function extrudeProfile(shape, halfWidth, opts, deform) {
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

// Kabini cam ve boyalı tavan olarak ikiye böler. Ölçüt deformasyon öncesi ekstrüzyon ızgarasında
// değerlendirilir; böylece sınır satır/sütun çizgilerine denk gelir (dişsiz kenar).
export function splitCanopy(geo, roofTest) {
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
    const isRoof = roofTest(z, y, u);
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

export function airfoilShape(chord, thickness) {
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

export const DEFAULT_WHEEL = Object.freeze({
  R: 0.35, halfW: 0.15, rimR: 0.255,
  spokes: { n: 5, double: true, w: 0.028, t: 0.036, len: 0.19, center: 0.145, spread: 0.11, camber: -0.12 },
  hub: 0.06,
  disc: 0.21,
});

function buildWheelParts(side, style) {
  // side = +1: dış yüz +X (sol tekerlek), -1: dış yüz -X (sağ tekerlek)
  const st = { ...DEFAULT_WHEEL, ...style, spokes: { ...DEFAULT_WHEEL.spokes, ...(style && style.spokes) } };
  const { R, halfW, rimR } = st;
  const toX = [0, 0, -Math.PI / 2]; // Y eksenli geometriyi X eksenine çevir
  const r1 = rimR + 0.47 * (R - rimR);
  const r2 = rimR + 0.82 * (R - rimR);

  const profile = [
    new THREE.Vector2(rimR - 0.005, -halfW),
    new THREE.Vector2(r1, -halfW - 0.004),
    new THREE.Vector2(r2, -halfW + 0.008),
    new THREE.Vector2(R - 0.002, -halfW + 0.035),
    new THREE.Vector2(R, 0),
    new THREE.Vector2(R - 0.002, halfW - 0.035),
    new THREE.Vector2(r2, halfW - 0.008),
    new THREE.Vector2(r1, halfW + 0.004),
    new THREE.Vector2(rimR - 0.005, halfW),
  ];
  const tire = [
    prep(new THREE.LatheGeometry(profile, 28), { rot: toX }),
    // Fren diski (jant kollarının arkasında koyu yüzey).
    prep(new THREE.CylinderGeometry(st.disc, st.disc, 0.03, 20), { rot: toX, pos: [-0.01, 0, 0] }),
  ];

  const outer = halfW - 0.012;
  const rim = [
    prep(new THREE.CylinderGeometry(rimR, rimR, halfW * 2 - 0.02, 28, 1, true), { rot: toX }),
    prep(new THREE.RingGeometry(rimR - 0.03, rimR + 0.004, 28), { rot: [0, Math.PI / 2, 0], pos: [outer + 0.004, 0, 0] }),
    prep(new THREE.CylinderGeometry(st.hub, st.hub * 1.25, 0.05, 12), { rot: toX, pos: [outer - 0.025, 0, 0] }),
  ];
  const sp = st.spokes;
  for (let k = 0; k < sp.n; k++) {
    const base = (k / sp.n) * Math.PI * 2;
    for (const off of sp.double ? [-sp.spread, sp.spread] : [0]) {
      const a = base + off;
      rim.push(prep(box(sp.w, sp.len, sp.t), {
        rot: [a, 0, sp.camber],
        pos: [outer - 0.03, Math.cos(a) * sp.center, Math.sin(a) * sp.center],
      }));
    }
  }
  rim.push(prep(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), { rot: toX, pos: [outer + 0.003, 0, 0] }));

  if (side < 0) {
    const flip = new THREE.Matrix4().makeRotationY(Math.PI);
    for (const g of tire) g.applyMatrix4(flip);
    for (const g of rim) g.applyMatrix4(flip);
  }
  return { tire, rim };
}

// sides: [{ side, x }] — aynı aksı paylaşan tekerlekler tek geometride birleşir (grup 0 lastik, 1 jant).
export function wheelGeometry(sides, style) {
  const tireParts = [];
  const rimParts = [];
  for (const { side, x } of sides) {
    const { tire, rim } = buildWheelParts(side, style);
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
// Tüm modellerin paylaştığı materyaller ve gölge dokusu
// ---------------------------------------------------------------------------------------------

export const BLACK = 0x060607;
export const CARBON = 0x1a1c20;
export const METAL = 0x8c9097;

let materials = null;

export function getMaterials() {
  if (materials) return materials;
  const m = {
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
    m.shadow = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, opacity: 0.75, color: 0x000000,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
  }
  materials = m;
  return m;
}

// Modele özel gölge düzlemi (ayak izine göre ölçekli). Node'da (canvas yok) null.
export function shadowGeometry(width, length) {
  if (!getMaterials().shadow) return null;
  return new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2);
}

// Gövde yüzeyi çözümlemesi için çıplak geometriyi Mesh'e sarar (ışın atmak için).
export function probeMesh(geo) {
  const probe = new THREE.Mesh(geo);
  probe.updateMatrixWorld(true);
  return probe;
}
