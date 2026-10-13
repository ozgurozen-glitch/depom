// Prosedürel düşük poligonlu modeller (köşe renkli, tek materyalle çizilir; InstancedMesh için).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './textures.js';

function colorize(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function clean(geo) {
  // mergeGeometries için ortak öznitelikler: position, normal, color
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) {
    if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

function merge(list) {
  return mergeGeometries(list.map(clean), false);
}

/** Palmiye: kavisli gövde + yay çizen yapraklar. Taban (0,0,0), yükseklik ~9 m. */
export function palmGeometry() {
  const rnd = mulberry32(31);
  const H = 9;
  const bend = 1.1;
  const segs = 8;
  const radial = 7;
  const pos = [];
  const col = [];
  const idx = [];
  const bark = new THREE.Color(0x7a5a3e);
  const barkDark = new THREE.Color(0x5a412c);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const cx = bend * t * t;
    const cy = H * t;
    const r = 0.3 - 0.13 * t + (i % 2 === 0 ? 0.02 : 0);
    const c = i % 2 === 0 ? bark : barkDark;
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      pos.push(cx + Math.cos(a) * r, cy, Math.sin(a) * r);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k;
      const b = i * radial + ((k + 1) % radial);
      const c2 = a + radial;
      const d = b + radial;
      idx.push(a, c2, b, b, c2, d);
    }
  }
  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  trunk.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  trunk.setIndex(idx);
  trunk.computeVertexNormals();

  const top = new THREE.Vector3(bend, H, 0);
  const fronds = [];
  const leafA = new THREE.Color(0x3f7a2a);
  const leafB = new THREE.Color(0x6aa83a);
  const leafTip = new THREE.Color(0x9a9a40);
  const N = 12;
  for (let f = 0; f < N; f++) {
    const az = (f / N) * Math.PI * 2 + rnd() * 0.3;
    const len = 4.2 + rnd() * 1.4;
    const lift = 0.9 + rnd() * 0.8;
    const droop = 2.6 + rnd() * 1.2;
    const fp = [];
    const fc = [];
    const fi = [];
    const steps = 7;
    const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const along = len * t;
      const yy = lift * Math.sin(t * Math.PI * 0.6) - droop * t * t;
      const w = 0.95 * Math.sin(Math.min(1, t * 1.15) * Math.PI) + 0.05;
      const center = top.clone().addScaledVector(dir, along).add(new THREE.Vector3(0, yy, 0));
      const l = center.clone().addScaledVector(side, -w).add(new THREE.Vector3(0, -0.22 * w, 0));
      const r = center.clone().addScaledVector(side, w).add(new THREE.Vector3(0, -0.22 * w, 0));
      fp.push(l.x, l.y, l.z, center.x, center.y + 0.06, center.z, r.x, r.y, r.z);
      const cc = leafA.clone().lerp(leafB, 0.3 + 0.4 * rnd()).lerp(leafTip, t * t * 0.6);
      const ce = cc.clone().multiplyScalar(0.75);
      fc.push(ce.r, ce.g, ce.b, cc.r, cc.g, cc.b, ce.r, ce.g, ce.b);
    }
    for (let i = 0; i < steps; i++) {
      const a = i * 3;
      const b = a + 3;
      fi.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
    g.setIndex(fi);
    g.computeVertexNormals();
    fronds.push(g);
  }
  const nuts = colorize(new THREE.IcosahedronGeometry(0.42, 0), 0x4a3a22);
  nuts.translate(bend, H - 0.35, 0);
  return merge([trunk, ...fronds, nuts]);
}

/** Sokak lambası direği (+x yönüne uzanan kol). Ampul ayrı. */
export function lampPoleGeometry() {
  const metal = 0x2a3236;
  const pole = colorize(new THREE.CylinderGeometry(0.1, 0.16, 8, 8), metal);
  pole.translate(0, 4, 0);
  const base = colorize(new THREE.CylinderGeometry(0.22, 0.26, 0.8, 8), metal);
  base.translate(0, 0.4, 0);
  const arm = colorize(new THREE.BoxGeometry(2.0, 0.1, 0.1), metal);
  arm.translate(1.0, 7.85, 0);
  const head = colorize(new THREE.BoxGeometry(0.9, 0.22, 0.42), metal);
  head.translate(1.85, 7.8, 0);
  return merge([pole, base, arm, head]);
}

export function lampBulbGeometry() {
  const g = new THREE.BoxGeometry(0.7, 0.06, 0.32);
  g.translate(1.85, 7.66, 0);
  return g;
}

/** Motor yat (uzunluk ~1 birim = 20 m ölçeklenir). Burun +z. */
export function motorYachtGeometry() {
  const white = 0xf4f4f2;
  const navy = 0x1b2a4a;
  const glass = 0x1a2430;
  const teak = 0xa8784a;
  // Gövde: burnu sivri, kıç düz kesit (ExtrudeGeometry ile yandan profil yerine üstten şekil)
  const shape = new THREE.Shape();
  shape.moveTo(-2.4, -9);
  shape.lineTo(2.4, -9);
  shape.lineTo(2.5, 2);
  shape.quadraticCurveTo(2.2, 7.5, 0, 10.5);
  shape.quadraticCurveTo(-2.2, 7.5, -2.5, 2);
  shape.closePath();
  const hull = new THREE.ExtrudeGeometry(shape, { depth: 2.4, bevelEnabled: false, curveSegments: 6 });
  hull.rotateX(-Math.PI / 2);
  hull.translate(0, -0.9, 0);
  colorize(hull, white);
  const stripe = colorize(new THREE.BoxGeometry(5.02, 0.35, 15), navy);
  stripe.translate(0, 0.25, -1.6);
  const deck = colorize(new THREE.BoxGeometry(4.4, 0.08, 6), teak);
  deck.translate(0, 1.52, -5.8);
  const cabin1 = colorize(new THREE.BoxGeometry(3.8, 1.5, 9), white);
  cabin1.translate(0, 2.2, -1.5);
  const win1 = colorize(new THREE.BoxGeometry(3.86, 0.55, 7.6), glass);
  win1.translate(0, 2.3, -1.3);
  const cabin2 = colorize(new THREE.BoxGeometry(3.0, 1.1, 5.2), white);
  cabin2.translate(0, 3.5, -2.2);
  const win2 = colorize(new THREE.BoxGeometry(3.06, 0.45, 4.2), glass);
  win2.translate(0, 3.55, -2.0);
  const arch = colorize(new THREE.BoxGeometry(2.4, 0.9, 0.5), white);
  arch.translate(0, 4.5, -3.0);
  return merge([hull, stripe, deck, cabin1, win1, cabin2, win2, arch]);
}

/** Yelkenli (direk + sarılı yelken). Burun +z. */
export function sailboatGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-1.5, -6);
  shape.lineTo(1.5, -6);
  shape.lineTo(1.7, 1);
  shape.quadraticCurveTo(1.3, 5, 0, 7);
  shape.quadraticCurveTo(-1.3, 5, -1.7, 1);
  shape.closePath();
  const hull = new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: false, curveSegments: 5 });
  hull.rotateX(-Math.PI / 2);
  hull.translate(0, -0.7, 0);
  colorize(hull, 0xf2f0ea);
  const cabin = colorize(new THREE.BoxGeometry(2.0, 0.7, 4), 0xe8e4da);
  cabin.translate(0, 1.2, -0.5);
  const mast = colorize(new THREE.CylinderGeometry(0.08, 0.1, 14, 6), 0xd8d8d8);
  mast.translate(0, 7.8, 0.6);
  const boom = colorize(new THREE.CylinderGeometry(0.07, 0.07, 5, 6), 0xd8d8d8);
  boom.rotateX(Math.PI / 2);
  boom.translate(0, 2.4, -1.9);
  const sail = colorize(new THREE.CylinderGeometry(0.22, 0.22, 4.6, 6), 0x1d4f8c);
  sail.rotateX(Math.PI / 2);
  sail.translate(0, 2.65, -1.9);
  return merge([hull, cabin, mast, boom, sail]);
}

/** Selvi ağacı (ince uzun). Yükseklik ~1 → ölçeklenir. */
export function cypressGeometry() {
  const g = new THREE.CylinderGeometry(0.0, 0.16, 1, 7, 6);
  const p = g.attributes.position;
  const rnd = mulberry32(3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) + 0.5; // 0..1
    const bulge = Math.sin(Math.min(1, y * 1.15) * Math.PI) * 0.12 + 0.03 * (1 - y);
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const r = (bulge + (rnd() - 0.5) * 0.02) * (y < 0.999 ? 1 : 0);
    p.setXYZ(i, Math.cos(a) * r, y + 0.04, Math.sin(a) * r);
  }
  g.computeVertexNormals();
  colorize(g, 0x2f4a26);
  const trunk = colorize(new THREE.CylinderGeometry(0.015, 0.02, 0.08, 5), 0x4a3828);
  trunk.translate(0, 0.04, 0);
  return merge([g, trunk]);
}

/** Fıstık çamı (şemsiye çamı). Yükseklik ~1. */
export function pineGeometry() {
  const trunk = colorize(new THREE.CylinderGeometry(0.035, 0.05, 0.75, 6), 0x5a4030);
  trunk.translate(0.04, 0.375, 0);
  trunk.rotateZ(-0.06);
  const crown = new THREE.IcosahedronGeometry(0.42, 1);
  const p = crown.attributes.position;
  const rnd = mulberry32(17);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + (rnd() - 0.5) * 0.18;
    p.setXYZ(i, x * k, y * 0.38 * k, z * k);
  }
  crown.computeVertexNormals();
  colorize(crown, 0x3d5a2a);
  crown.translate(0.06, 0.82, 0);
  return merge([trunk, crown]);
}

/** Çalı / maki öbeği. */
export function bushGeometry() {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, Math.max(-0.1, p.getY(i) * 0.6));
  g.translate(0, 0.15, 0);
  g.computeVertexNormals();
  colorize(g, 0x4a5e2c);
  return clean(g);
}

/** Kaya. */
export function rockGeometry() {
  const g = new THREE.DodecahedronGeometry(0.5, 1);
  const p = g.attributes.position;
  const rnd = mulberry32(23);
  for (let i = 0; i < p.count; i++) {
    const k = 0.8 + rnd() * 0.4;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.75, p.getZ(i) * k);
  }
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  colorize(ng, 0x9a8470);
  return clean(ng);
}

/** Deniz feneri (beyaz kule, kırmızı tepe). */
export function lighthouseGeometry() {
  const tower = colorize(new THREE.CylinderGeometry(1.6, 2.4, 18, 12), 0xf2efe8);
  tower.translate(0, 9, 0);
  const band = colorize(new THREE.CylinderGeometry(1.95, 2.05, 2.2, 12), 0xc8202a);
  band.translate(0, 9, 0);
  const gallery = colorize(new THREE.CylinderGeometry(2.3, 2.3, 0.4, 12), 0x30343a);
  gallery.translate(0, 18.2, 0);
  const roof = colorize(new THREE.ConeGeometry(1.6, 2.2, 12), 0xc8202a);
  roof.translate(0, 22.2, 0);
  const base = colorize(new THREE.CylinderGeometry(3.4, 3.8, 1.5, 12), 0xb8a890);
  base.translate(0, 0.75, 0);
  return merge([tower, band, gallery, roof, base]);
}

export { merge, colorize, clean };
