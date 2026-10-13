// YALNIZCA TEST: Car/ChaseCamera'yı eğim, tepe, rampa (jump + roll), eğimli viraj ve tünelle denemek için
// sözleşmeye (docs/ARCHITECTURE.md → Track) uyan basit bir pist. Oyunda kullanılmaz.
//
// Yerleşim: stadyum şekli. Düzlük A (+Z yönü) → sağa 180° viraj → düzlük B (-Z) → sağa 180° viraj (eğimli).
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const STRAIGHT = 700;
const RADIUS = 140;

export class TestTrack {
  constructor(scene, { build = true } = {}) {
    this.name = 'Test Ring';
    this.width = 20;
    this.straight = STRAIGHT;
    this.radius = RADIUS;
    const arc = Math.PI * RADIUS;
    this.length = STRAIGHT * 2 + arc * 2;
    this.segA = [0, STRAIGHT];
    this.turn1 = [STRAIGHT, STRAIGHT + arc];
    this.segB = [STRAIGHT + arc, STRAIGHT * 2 + arc];
    this.turn2 = [STRAIGHT * 2 + arc, this.length];

    const bS = this.segB[0];
    this.hill = { s0: 100, s1: 260, h: 9 };
    this.rise = { s0: bS + 40, s1: bS + 200, h: 7 }; // düzlük B'de yokuş + iniş
    this.ramps = [
      { s0: 430, s1: 455, height: 3.2, latMin: -10, latMax: 10, type: 'jump' },
      { s0: bS + 330, s1: bS + 352, height: 2.8, latMin: 0.5, latMax: 9.5, type: 'roll' },
      { s0: 600, s1: 622, height: 2.6, latMin: -9.5, latMax: -0.5, type: 'roll' },
    ];
    this.tunnel = { s0: bS + 470, s1: bS + 600, ceiling: 6.5 };
    this.pickups = [];

    // 1 m çözünürlükte merkez çizgisi önbelleği.
    this.N = Math.ceil(this.length);
    this.seg = this.length / this.N;
    this.px = new Float32Array(this.N);
    this.pz = new Float32Array(this.N);
    this.tx = new Float32Array(this.N);
    this.tz = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) {
      const r = this.planar(i * this.seg);
      this.px[i] = r.x;
      this.pz[i] = r.z;
      this.tx[i] = r.tx;
      this.tz[i] = r.tz;
    }

    if (scene && build) this.buildMeshes(scene);
  }

  wrap(s) {
    return ((s % this.length) + this.length) % this.length;
  }

  // Düzlemsel merkez çizgisi (x, z, tanjant).
  planar(s) {
    s = this.wrap(s);
    const R = RADIUS;
    if (s < this.segA[1]) return { x: 0, z: s, tx: 0, tz: 1 };
    if (s < this.turn1[1]) {
      const a = (s - this.turn1[0]) / R; // sağa dönüş: +Z'den -X'e
      return { x: -R + R * Math.cos(a), z: STRAIGHT + R * Math.sin(a), tx: -Math.sin(a), tz: Math.cos(a) };
    }
    if (s < this.segB[1]) {
      const d = s - this.segB[0];
      return { x: -2 * R, z: STRAIGHT - d, tx: 0, tz: -1 };
    }
    const a = (s - this.turn2[0]) / R;
    return { x: -R - R * Math.cos(a), z: -R * Math.sin(a), tx: Math.sin(a), tz: -Math.cos(a) };
  }

  elev(s) {
    s = this.wrap(s);
    let y = 0;
    const bumpCos = (b) => {
      if (s <= b.s0 || s >= b.s1) return 0;
      return b.h * 0.5 * (1 - Math.cos((2 * Math.PI * (s - b.s0)) / (b.s1 - b.s0)));
    };
    y += bumpCos(this.hill);
    y += bumpCos(this.rise);
    return y;
  }

  bank(s) {
    s = this.wrap(s);
    const [a, b] = this.turn2;
    if (s <= a || s >= b) return 0;
    const t = (s - a) / (b - a);
    return 0.09 * Math.sin(Math.PI * t); // dış (sol) kenar yüksek
  }

  rampHeight(s, lat) {
    s = this.wrap(s);
    for (const r of this.ramps) {
      if (s < r.s0 || s > r.s1 || lat < r.latMin || lat > r.latMax) continue;
      return r.height * ((s - r.s0) / (r.s1 - r.s0));
    }
    return 0;
  }

  heightAt(s, lateral = 0) {
    return this.elev(s) - this.bank(s) * lateral + this.rampHeight(s, lateral);
  }

  sample(s) {
    s = this.wrap(s);
    const p = this.planar(s);
    const y = this.elev(s);
    const dy = (this.elev(s + 0.5) - this.elev(s - 0.5));
    const tangent = new THREE.Vector3(p.tx, dy, p.tz).normalize();
    const right = new THREE.Vector3(-p.tz, 0, p.tx); // tangent × up
    return { pos: new THREE.Vector3(p.x, y, p.z), tangent, right, up: UP.clone(), width: this.width };
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
    const p = this.planar(s);
    const lateral = (pos.x - p.x) * -p.tz + (pos.z - p.z) * p.tx;
    return { s, lateral, height: pos.y - this.heightAt(s, lateral), onRoad: Math.abs(lateral) <= this.width / 2 };
  }

  getStartGrid(n) {
    const grid = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 2);
      const s = this.length - 10 - row * 9;
      const smp = this.sample(s);
      const lat = i % 2 === 0 ? -4 : 4;
      const pos = smp.pos.clone().addScaledVector(smp.right, lat);
      pos.y = this.heightAt(s, lat);
      grid.push({ pos, yaw: Math.atan2(smp.tangent.x, smp.tangent.z) });
    }
    return grid;
  }

  update() {}

  // --- Görsel (yalnızca test sahnesi) ---------------------------------------------------------

  buildMeshes(scene) {
    const W = this.width;
    const cols = 40;
    const step = 2;
    const rows = Math.ceil(this.length / step);
    const pos = [];
    const col = [];
    const idx = [];
    const c1 = new THREE.Color(0x3a3d44);
    const c2 = new THREE.Color(0x30333a);
    const cLine = new THREE.Color(0xe8e8e8);
    for (let r = 0; r <= rows; r++) {
      const s = r * step;
      const p = this.planar(s);
      const rx = -p.tz;
      const rz = p.tx;
      for (let c = 0; c <= cols; c++) {
        const lat = -W / 2 + (W * c) / cols;
        pos.push(p.x + rx * lat, this.elev(s) - this.bank(s) * lat + 0.01, p.z + rz * lat);
        const dash = Math.floor(s / 6) % 2 === 0 && (c === cols / 2);
        const edge = c === 0 || c === cols;
        const cc = dash || edge ? cLine : (Math.floor(s / 20) % 2 ? c1 : c2);
        col.push(cc.r, cc.g, cc.b);
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * (cols + 1) + c;
        const b = a + cols + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    road.receiveShadow = true;
    scene.add(road);

    // Bariyerler
    const wallGeoPos = [];
    const wallIdx = [];
    for (const side of [-1, 1]) {
      const base = wallGeoPos.length / 3;
      for (let r = 0; r <= rows; r++) {
        const s = r * step;
        const p = this.planar(s);
        const lat = side * (W / 2 + 0.3);
        const x = p.x - p.tz * lat;
        const z = p.z + p.tx * lat;
        const y = this.elev(s) - this.bank(s) * lat;
        wallGeoPos.push(x, y, z, x, y + 1.1, z);
      }
      for (let r = 0; r < rows; r++) {
        const a = base + r * 2;
        wallIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wallGeoPos, 3));
    wg.setIndex(wallIdx);
    wg.computeVertexNormals();
    scene.add(new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.6, side: THREE.DoubleSide })));

    // Rampalar
    const rampMat = new THREE.MeshStandardMaterial({ color: 0xffb020, roughness: 0.5, side: THREE.DoubleSide });
    const rollMat = new THREE.MeshStandardMaterial({ color: 0x20c0ff, roughness: 0.5, side: THREE.DoubleSide });
    for (const rp of this.ramps) {
      const rp2 = [];
      const ri = [];
      const n = 12;
      const m = 4;
      for (let i = 0; i <= n; i++) {
        const s = rp.s0 + ((rp.s1 - rp.s0) * i) / n;
        const p = this.planar(s);
        for (let j = 0; j <= m; j++) {
          const lat = rp.latMin + ((rp.latMax - rp.latMin) * j) / m;
          const h = this.elev(s) - this.bank(s) * lat + rp.height * (i / n) + 0.03;
          rp2.push(p.x - p.tz * lat, h, p.z + p.tx * lat);
        }
      }
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < m; j++) {
          const a = i * (m + 1) + j;
          const b = a + m + 1;
          ri.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      // Arka yüz
      const back = rp2.length / 3;
      const p = this.planar(rp.s1);
      for (const lat of [rp.latMin, rp.latMax]) {
        const y0 = this.elev(rp.s1) - this.bank(rp.s1) * lat;
        rp2.push(p.x - p.tz * lat, y0, p.z + p.tx * lat, p.x - p.tz * lat, y0 + rp.height, p.z + p.tx * lat);
      }
      ri.push(back, back + 1, back + 2, back + 1, back + 3, back + 2);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(rp2, 3));
      g.setIndex(ri);
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, rp.type === 'roll' ? rollMat : rampMat);
      mesh.receiveShadow = true;
      scene.add(mesh);
    }

    // Tünel (tavan + duvarlar)
    const t = this.tunnel;
    const tunMat = new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: 0.9, side: THREE.DoubleSide });
    const segs = Math.ceil((t.s1 - t.s0) / 4);
    const tp = [];
    const ti = [];
    for (let i = 0; i <= segs; i++) {
      const s = t.s0 + ((t.s1 - t.s0) * i) / segs;
      const p = this.planar(s);
      const y = this.elev(s);
      const L = W / 2 + 0.4;
      const pts = [[-L, 0], [-L, t.ceiling], [L, t.ceiling], [L, 0]];
      for (const [lat, h] of pts) tp.push(p.x - p.tz * lat, y + h, p.z + p.tx * lat);
    }
    for (let i = 0; i < segs; i++) {
      for (let k = 0; k < 3; k++) {
        const a = i * 4 + k;
        const b = a + 4;
        ti.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
    tg.setIndex(ti);
    tg.computeVertexNormals();
    scene.add(new THREE.Mesh(tg, tunMat));

    // Zemin
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x5b7f45, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(-140, -0.3, 350);
    ground.receiveShadow = true;
    scene.add(ground);

    // Hız hissi için kenar direkleri
    const poleGeo = new THREE.BoxGeometry(0.3, 4, 0.3);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xff3355 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, Math.ceil(this.length / 25) * 2);
    const m4 = new THREE.Matrix4();
    let k = 0;
    for (let s = 0; s < this.length; s += 25) {
      const p = this.planar(s);
      for (const side of [-1, 1]) {
        const lat = side * (W / 2 + 3);
        m4.makeTranslation(p.x - p.tz * lat, this.elev(s) + 2, p.z + p.tx * lat);
        poles.setMatrixAt(k++, m4);
      }
    }
    poles.count = k;
    scene.add(poles);
  }
}
