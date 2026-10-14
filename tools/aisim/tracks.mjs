// Simülasyon pistleri: sözleşmeye (docs/ARCHITECTURE.md → Track) uyan düzlemsel, rampasız kapalı devreler.
// Köşeli çokgen + köşe başına yarıçaplı yay (fillet) ile tanımlanır; merkez çizgisi ~1 m aralıkla yeniden örneklenir.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export class PolyTrack {
  /** verts: [[x,z],...] kapalı çokgen; radii: köşe başına merkez çizgisi yarıçapı (sayı ya da dizi) */
  constructor(name, verts, radii, width = 20, nPickups = 0) {
    this.name = name;
    this.width = width;
    this.ramps = [];
    this.pickups = [];
    const n = verts.length;
    const R = (i) => (Array.isArray(radii) ? radii[i] : radii);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const P = verts[i];
      const A = verts[(i - 1 + n) % n];
      const B = verts[(i + 1) % n];
      let d1x = P[0] - A[0];
      let d1z = P[1] - A[1];
      const l1 = Math.hypot(d1x, d1z);
      d1x /= l1;
      d1z /= l1;
      let d2x = B[0] - P[0];
      let d2z = B[1] - P[1];
      const l2 = Math.hypot(d2x, d2z);
      d2x /= l2;
      d2z /= l2;
      const cross = d1x * d2z - d1z * d2x;
      const dot = d1x * d2x + d1z * d2z;
      const theta = Math.atan2(cross, dot); // işaretli dönüş (rad)
      const r = R(i);
      const t = r * Math.tan(Math.abs(theta) / 2);
      if (t > l1 / 2 + 1e-6 && t > l2 / 2 + 1e-6) throw new Error(`${name}: köşe ${i} için kenar çok kısa`);
      const ax = P[0] - d1x * t;
      const az = P[1] - d1z * t;
      const bx = P[0] + d2x * t;
      const bz = P[1] + d2z * t;
      const sgn = Math.sign(cross) || 1;
      const cx = ax + -d1z * sgn * r;
      const cz = az + d1x * sgn * r;
      const steps = Math.max(4, Math.ceil((Math.abs(theta) * r) / 0.25));
      const u0x = ax - cx;
      const u0z = az - cz;
      pts.push([ax, az]);
      for (let k = 1; k < steps; k++) {
        const phi = (theta * k) / steps;
        pts.push([cx + u0x * Math.cos(phi) - u0z * Math.sin(phi), cz + u0x * Math.sin(phi) + u0z * Math.cos(phi)]);
      }
      pts.push([bx, bz]);
    }
    const m = pts.length;
    const cum = new Float64Array(m + 1);
    for (let i = 0; i < m; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % m];
      cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const total = cum[m];
    this.N = Math.round(total);
    this.length = total;
    this.seg = total / this.N;
    this.px = new Float64Array(this.N);
    this.pz = new Float64Array(this.N);
    this.tx = new Float64Array(this.N);
    this.tz = new Float64Array(this.N);
    let j = 0;
    for (let i = 0; i < this.N; i++) {
      const s = i * this.seg;
      while (cum[j + 1] < s) j++;
      const a = pts[j];
      const b = pts[(j + 1) % m];
      const f = (s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
      this.px[i] = a[0] + (b[0] - a[0]) * f;
      this.pz[i] = a[1] + (b[1] - a[1]) * f;
    }
    for (let i = 0; i < this.N; i++) {
      const a = (i - 1 + this.N) % this.N;
      const b = (i + 1) % this.N;
      const dx = this.px[b] - this.px[a];
      const dz = this.pz[b] - this.pz[a];
      const l = Math.hypot(dx, dz);
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
    }
    for (let k = 0; k < nPickups; k++) {
      this.pickups.push({ s: ((k + 0.5) / nPickups) * total, lateral: ((k % 3) - 1) * 4, kind: 'nitro', active: true, respawnAt: 0 });
    }
  }

  wrap(s) { return ((s % this.length) + this.length) % this.length; }

  planar(s, out) {
    const x = this.wrap(s) / this.seg;
    const i = Math.floor(x) % this.N;
    const j = (i + 1) % this.N;
    const f = x - Math.floor(x);
    out.x = this.px[i] + (this.px[j] - this.px[i]) * f;
    out.z = this.pz[i] + (this.pz[j] - this.pz[i]) * f;
    const tx = this.tx[i] + (this.tx[j] - this.tx[i]) * f;
    const tz = this.tz[i] + (this.tz[j] - this.tz[i]) * f;
    const l = Math.hypot(tx, tz) || 1;
    out.tx = tx / l;
    out.tz = tz / l;
    return out;
  }

  heightAt() { return 0; }

  sample(s) {
    const p = this.planar(s, {});
    return {
      pos: new THREE.Vector3(p.x, 0, p.z),
      tangent: new THREE.Vector3(p.tx, 0, p.tz),
      right: new THREE.Vector3(-p.tz, 0, p.tx),
      up: UP.clone(),
      width: this.width,
    };
  }

  project(pos, hintS) {
    let from = 0;
    let count = this.N;
    if (hintS !== undefined && hintS !== null && Number.isFinite(hintS)) {
      const w = Math.ceil(60 / this.seg);
      from = Math.floor(this.wrap(hintS) / this.seg) - w;
      count = w * 2;
    }
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < count; k++) {
      const i = (((from + k) % this.N) + this.N) % this.N;
      const dx = this.px[i] - pos.x;
      const dz = this.pz[i] - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const dx = pos.x - this.px[best];
    const dz = pos.z - this.pz[best];
    const along = dx * this.tx[best] + dz * this.tz[best];
    const s = this.wrap(best * this.seg + along);
    const p = this.planar(s, {});
    const lateral = (pos.x - p.x) * -p.tz + (pos.z - p.z) * p.tx;
    return { s, lateral, height: pos.y, onRoad: Math.abs(lateral) <= this.width / 2 };
  }

  getStartGrid(n) {
    const grid = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 2);
      const s = this.length - 10 - row * 9;
      const smp = this.sample(s);
      const lat = i % 2 === 0 ? -4 : 4;
      const pos = smp.pos.clone().addScaledVector(smp.right, lat);
      grid.push({ pos, yaw: Math.atan2(smp.tangent.x, smp.tangent.z) });
    }
    return grid;
  }

  update() {}
}

export const TRACK_IDS = ['oval', 'hard', 'hard2', 'mixed'];

export function makeTrack(id, { radius } = {}) {
  switch (id) {
    case 'oval': {
      // stadyum: iki 700 m düzlük + iki R=140 yarım daire
      const R = 140;
      return new PolyTrack('oval', [[0, 0], [700, 0], [700, 2 * R], [0, 2 * R]], R, 20, 8);
    }
    case 'hard': {
      // yalnızca sıkı 90° köşeler (varsayılan R=12 m merkez çizgisi) ve zikzak
      const r = radius || 12;
      return new PolyTrack(`hard-R${r}`, [[0, 0], [600, 0], [600, 300], [450, 300], [450, 120], [300, 120], [300, 300], [0, 300]], r, 20, 8);
    }
    case 'hard2': {
      // 90° köşeler, R-R "U" dönüşü ve kısa kenarlar
      const r = radius || 12;
      return new PolyTrack(`hard2-R${r}`, [
        [0, 0], [500, 0], [500, 100], [380, 100], [380, 200], [620, 200], [620, 520], [100, 520], [100, 400], [0, 400],
      ], r, 20, 8);
    }
    case 'mixed': {
      // akıcı virajlar, saç tokası ve iki uzun düzlük
      return new PolyTrack('mixed', [
        [0, 0], [900, 0], [1100, 150], [1000, 450], [700, 450], [600, 250], [400, 250], [350, 500], [-100, 550], [-250, 300],
      ], [60, 90, 70, 18, 35, 35, 22, 60, 80, 70], 20, 8);
    }
    default:
      throw new Error(`bilinmeyen pist: ${id}`);
  }
}
