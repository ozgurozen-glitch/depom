// Track: "Riviera Sunset" — gün batımında Akdeniz kıyı şehri pisti.
// Merkez çizgisi sabit aralıklı (≈2 m) tablolarda tutulur; sample/project/heightAt bu tablolar üzerinden
// hızlı ve (project/heightAt) nesne üretmeden çalışır. Yol, bordür, bariyer, rampa, start çizgisi ve
// nitro tüplerinin mesh'leri burada; mekân (deniz, tünel, binalar...) Environment'tadır.
import * as THREE from 'three';
import {
  buildCenterline, ROAD_WIDTH, SECTION_MARKERS, RAMP_DEFS, PICKUP_DEFS,
} from './track/layout.js';
import {
  asphaltTexture, barrierTexture, BARRIER_ROWS, curbTexture, rampTexture, startDecalTexture,
  nitroTexture, glowTexture,
} from './track/textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const HINT_WINDOW = 60; // m
const GRID_CELL = 40; // m, global arama için uzamsal ızgara

// Bariyer kesit profili: [yanal ofset (kenardan dışa, m), yükseklik (m), v]
const BARRIER_PROFILE = [
  [0.0, -0.9, 0.0],
  [0.0, 0.0, 0.08],
  [0.06, 0.22, 0.22],
  [0.24, 0.42, 0.38],
  [0.3, 1.05, 0.72],
  [0.56, 1.05, 0.82],
  [0.62, -0.9, 1.0],
];

export class Track {
  constructor(scene) {
    this.name = 'Riviera Sunset';
    this.width = ROAD_WIDTH;

    const c = buildCenterline({ spacing: 2 });
    this.N = c.N;
    this.ds = c.ds;
    this.length = c.length;
    this.px = c.px; this.py = c.py; this.pz = c.pz;
    this.tx = c.tx; this.ty = c.ty; this.tz = c.tz;
    this.rx = c.rx; this.rz = c.rz;
    this.curvature = c.curvature;
    this.buildSpatialGrid();

    // Bölümler (Environment mekânı bunlara göre kurar)
    this.sections = SECTION_MARKERS.map((m) => ({ id: m.id, s0: this.nearestIndex(m.at[0], m.at[1]) * this.ds }));
    this.sections.sort((a, b) => a.s0 - b.s0);
    for (let i = 0; i < this.sections.length; i++) {
      const next = this.sections[(i + 1) % this.sections.length];
      this.sections[i].s1 = next.s0 > this.sections[i].s0 ? next.s0 : next.s0 + this.length;
    }
    const tun = this.sections.find((sec) => sec.id === 'tunnel');
    this.tunnel = { s0: tun.s0, s1: tun.s1 };

    this.ramps = RAMP_DEFS.map((r) => {
      const s0 = this.nearestIndex(r.at[0], r.at[1]) * this.ds;
      return { s0, s1: s0 + r.length, height: r.height, latMin: r.latMin, latMax: r.latMax, type: r.type };
    });

    this.group = new THREE.Group();
    this.group.name = 'track';
    scene.add(this.group);

    this.buildRoad();
    this.buildCurbs();
    this.buildBarriers();
    this.buildRamps();
    this.buildStartDecals();
    this.buildPickups();
  }

  // -------------------------------------------------------------------------------------------
  // Sorgular

  wrap(s) {
    const L = this.length;
    s %= L;
    return s < 0 ? s + L : s;
  }

  /** Tablo indeksine ve kesrine çevirir (this._i, this._j, this._f'ye yazar). */
  _locate(s) {
    const N = this.N;
    let u = s / this.ds;
    u -= Math.floor(u / N) * N;
    let i = Math.floor(u);
    const f = u - i;
    if (i >= N) i -= N;
    this._i = i;
    this._j = i + 1 === N ? 0 : i + 1;
    this._f = f;
  }

  /**
   * Merkez çizgisi örneği. `out` verilirse içine yazar (ek: sıcak döngülerde nesne üretmemek için).
   */
  sample(s, out) {
    this._locate(s);
    const i = this._i;
    const j = this._j;
    const f = this._f;
    const o = out || { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), width: this.width };
    o.pos.set(
      this.px[i] + (this.px[j] - this.px[i]) * f,
      this.py[i] + (this.py[j] - this.py[i]) * f,
      this.pz[i] + (this.pz[j] - this.pz[i]) * f,
    );
    let tx = this.tx[i] + (this.tx[j] - this.tx[i]) * f;
    let ty = this.ty[i] + (this.ty[j] - this.ty[i]) * f;
    let tz = this.tz[i] + (this.tz[j] - this.tz[i]) * f;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    o.tangent.set(tx, ty, tz);
    const h = Math.hypot(tx, tz) || 1;
    const rx = -tz / h;
    const rz = tx / h;
    o.right.set(rx, 0, rz);
    // up = right × tangent
    o.up.set(-rz * ty, rz * tx - rx * tz, rx * ty);
    o.width = this.width;
    return o;
  }

  /** Merkez çizgisi yüksekliği (rampasız). */
  centerHeight(s) {
    this._locate(s);
    return this.py[this._i] + (this.py[this._j] - this.py[this._i]) * this._f;
  }

  heightAt(s, lateral = 0) {
    this._locate(s);
    let y = this.py[this._i] + (this.py[this._j] - this.py[this._i]) * this._f;
    const ramps = this.ramps;
    for (let k = 0; k < ramps.length; k++) {
      const r = ramps[k];
      if (lateral < r.latMin || lateral > r.latMax) continue;
      let d = s - r.s0;
      d -= Math.floor(d / this.length) * this.length;
      const len = r.s1 - r.s0;
      if (d > len) continue;
      y += rampProfile(r, d / len, lateral);
    }
    return y;
  }

  project(pos, hintS) {
    const x = pos.x;
    const z = pos.z;
    let best = -1;
    if (hintS !== undefined && hintS !== null && Number.isFinite(hintS)) {
      const w = Math.ceil(HINT_WINDOW / this.ds);
      this._locate(hintS);
      best = this._scanRange(x, z, this._i - w, 2 * w + 1);
      if (this._bestD2 > 45 * 45) best = -1; // ipucu tutmadı (ışınlanma vb.) → genel arama
    }
    if (best < 0) best = this._globalNearest(x, z);

    // En yakın iki komşu parça üzerinde dik izdüşüm
    const N = this.N;
    let bestS = 0;
    let bestD = Infinity;
    for (let k = -1; k <= 0; k++) {
      const a = (best + k + N) % N;
      const b = (a + 1) % N;
      const ax = this.px[a];
      const az = this.pz[a];
      const ex = this.px[b] - ax;
      const ez = this.pz[b] - az;
      const len2 = ex * ex + ez * ez;
      let t = ((x - ax) * ex + (z - az) * ez) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * t - x;
      const qz = az + ez * t - z;
      const d = qx * qx + qz * qz;
      if (d < bestD) { bestD = d; bestS = (a + t) * this.ds; }
    }
    // İnceltme: sample(s)'in kesit çizgisi (ara değerlenmiş sağ vektör) noktadan geçecek şekilde
    // s'yi düzelt (virajda dış kenarda parça izdüşümü ~0.2 m sapabiliyor). 2 Newton adımı yeter.
    let s = this.wrap(bestS);
    let cx = 0;
    let cz = 0;
    let rx = 0;
    let rz = 0;
    for (let it = 0; it < 3; it++) {
      this._locate(s);
      const i = this._i;
      const j = this._j;
      const f = this._f;
      cx = this.px[i] + (this.px[j] - this.px[i]) * f;
      cz = this.pz[i] + (this.pz[j] - this.pz[i]) * f;
      rx = this.rx[i] + (this.rx[j] - this.rx[i]) * f;
      rz = this.rz[i] + (this.rz[j] - this.rz[i]) * f;
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl; rz /= rl;
      if (it === 2) break;
      // yatay teğet = (rz, -rx) (sağ = (-tz, tx))
      let d = (x - cx) * rz - (z - cz) * rx;
      d = d > 1.5 ? 1.5 : d < -1.5 ? -1.5 : d;
      if (Math.abs(d) < 1e-4) break;
      s = this.wrap(s + d);
    }
    const lateral = (x - cx) * rx + (z - cz) * rz;
    return {
      s,
      lateral,
      height: pos.y - this.heightAt(s, lateral),
      onRoad: Math.abs(lateral) <= this.width / 2,
    };
  }

  /** Verilen indeks aralığında en yakın tablo noktası (this._bestD2'ye mesafe²). */
  _scanRange(x, z, from, count) {
    const N = this.N;
    let best = 0;
    let bd = Infinity;
    let i = ((from % N) + N) % N;
    for (let k = 0; k < count; k++) {
      const dx = this.px[i] - x;
      const dz = this.pz[i] - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
      i++;
      if (i === N) i = 0;
    }
    this._bestD2 = bd;
    return best;
  }

  buildSpatialGrid() {
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (let i = 0; i < this.N; i++) {
      minX = Math.min(minX, this.px[i]); maxX = Math.max(maxX, this.px[i]);
      minZ = Math.min(minZ, this.pz[i]); maxZ = Math.max(maxZ, this.pz[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ };
    const gx0 = minX - GRID_CELL;
    const gz0 = minZ - GRID_CELL;
    const gw = Math.ceil((maxX - gx0 + GRID_CELL) / GRID_CELL) + 1;
    const gh = Math.ceil((maxZ - gz0 + GRID_CELL) / GRID_CELL) + 1;
    const cells = Array.from({ length: gw * gh }, () => []);
    for (let i = 0; i < this.N; i++) {
      const cx = Math.floor((this.px[i] - gx0) / GRID_CELL);
      const cz = Math.floor((this.pz[i] - gz0) / GRID_CELL);
      cells[cz * gw + cx].push(i);
    }
    this._grid = { x0: gx0, z0: gz0, w: gw, h: gh, cells: cells.map((a) => Int32Array.from(a)) };
  }

  /** Uzamsal ızgara ile en yakın tablo indeksi (genel arama). */
  _globalNearest(x, z) {
    const g = this._grid;
    const cx = Math.floor((x - g.x0) / GRID_CELL);
    const cz = Math.floor((z - g.z0) / GRID_CELL);
    let best = -1;
    let bd = Infinity;
    const maxRing = Math.max(g.w, g.h);
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let iz = cz - ring; iz <= cz + ring; iz++) {
        if (iz < 0 || iz >= g.h) continue;
        for (let ix = cx - ring; ix <= cx + ring; ix++) {
          if (ix < 0 || ix >= g.w) continue;
          if (ring > 0 && iz !== cz - ring && iz !== cz + ring && ix !== cx - ring && ix !== cx + ring) continue;
          const cell = g.cells[iz * g.w + ix];
          for (let k = 0; k < cell.length; k++) {
            const i = cell[k];
            const dx = this.px[i] - x;
            const dz = this.pz[i] - z;
            const d = dx * dx + dz * dz;
            if (d < bd) { bd = d; best = i; }
          }
        }
      }
      // Bulunan nokta bu halkanın kesin kapsadığı yarıçap içindeyse dur
      if (best >= 0 && Math.sqrt(bd) <= ring * GRID_CELL) break;
    }
    if (best < 0) best = this._scanRange(x, z, 0, this.N);
    this._bestD2 = bd;
    return best;
  }

  /** Mekân yerleşimi için: (x,z)'ye en yakın merkez noktasının indeksi. */
  nearestIndex(x, z) {
    return this._globalNearest(x, z);
  }

  /** Mekân yerleşimi için: merkez çizgisine yatay uzaklık. */
  distanceToCenterline(x, z) {
    this._globalNearest(x, z);
    return Math.sqrt(this._bestD2);
  }

  /** (x,z) çevresindeki (radius) merkez noktalarını gezer: fn(index, distanceSq). */
  forEachSampleNear(x, z, radius, fn) {
    const g = this._grid;
    const r = Math.ceil(radius / GRID_CELL);
    const cx = Math.floor((x - g.x0) / GRID_CELL);
    const cz = Math.floor((z - g.z0) / GRID_CELL);
    const r2 = radius * radius;
    for (let iz = Math.max(0, cz - r); iz <= Math.min(g.h - 1, cz + r); iz++) {
      for (let ix = Math.max(0, cx - r); ix <= Math.min(g.w - 1, cx + r); ix++) {
        const cell = g.cells[iz * g.w + ix];
        for (let k = 0; k < cell.length; k++) {
          const i = cell[k];
          const dx = this.px[i] - x;
          const dz = this.pz[i] - z;
          const d = dx * dx + dz * dz;
          if (d <= r2) fn(i, d);
        }
      }
    }
  }

  sectionAt(s) {
    s = this.wrap(s);
    for (const sec of this.sections) {
      if ((s >= sec.s0 && s < sec.s1) || (s + this.length >= sec.s0 && s + this.length < sec.s1)) return sec.id;
    }
    return this.sections[0].id;
  }

  inTunnel(s, margin = 0) {
    s = this.wrap(s);
    return s >= this.tunnel.s0 - margin && s <= this.tunnel.s1 + margin;
  }

  getStartGrid(n) {
    const grid = [];
    const smp = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
    for (let i = 0; i < n; i++) {
      // Kademeli iki sütun: aynı sütunda 9 m aralık, sütunlar arası 4.5 m kaydırma.
      const s = -(9 + i * 4.5);
      const lateral = i % 2 === 0 ? -4.5 : 4.5;
      this.sample(s, smp);
      const pos = smp.pos.clone().addScaledVector(smp.right, lateral);
      pos.y = this.heightAt(s, lateral);
      grid.push({ pos, yaw: Math.atan2(smp.tangent.x, smp.tangent.z) });
    }
    return grid;
  }

  update(dt, time) {
    for (let k = 0; k < this.pickups.length; k++) {
      const p = this.pickups[k];
      if (!p.mesh.visible) continue;
      const ph = p.phase;
      p.canister.rotation.y = time * 2.2 + ph;
      p.canister.position.y = 1.35 + Math.sin(time * 2.6 + ph) * 0.22;
      const pulse = 1 + Math.sin(time * 5.2 + ph) * 0.12;
      p.halo.position.y = p.canister.position.y;
      p.halo.scale.set(4.2 * pulse, 4.2 * pulse, 1);
      p.ring.rotation.z = -time * 1.5;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Mesh'ler

  /** Yol kesiti boyunca şerit (strip) geometrisi: lateral listesi, her kesitte tekrar. */
  buildRoad() {
    const N = this.N;
    const half = this.width / 2;
    // Doku boyu: pist uzunluğunu tam bölsün (s=0'da dikiş olmasın)
    const tile = this.length / Math.round(this.length / 24);
    this.roadTile = tile;
    const lats = [-half, 0, half];
    const cols = lats.length;
    const pos = new Float32Array((N + 1) * cols * 3);
    const uv = new Float32Array((N + 1) * cols * 2);
    const col = new Float32Array((N + 1) * cols * 3);
    const tint = new THREE.Color();
    for (let k = 0; k <= N; k++) {
      const i = k % N;
      const s = k * this.ds;
      const t = this.tunnelTint(s, tint);
      for (let c = 0; c < cols; c++) {
        const lat = lats[c];
        const o = (k * cols + c) * 3;
        pos[o] = this.px[i] + this.rx[i] * lat;
        pos[o + 1] = this.py[i];
        pos[o + 2] = this.pz[i] + this.rz[i] * lat;
        uv[(k * cols + c) * 2] = (lat + half) / this.width;
        uv[(k * cols + c) * 2 + 1] = s / tile;
        col[o] = t.r; col[o + 1] = t.g; col[o + 2] = t.b;
      }
    }
    const geo = stripGeometry(pos, uv, col, N + 1, cols);
    const map = asphaltTexture({ widthM: this.width, lengthM: 24 });
    // Phong: güneşe doğru hafif asfalt parlaması, IBL'siz (geniş ekran alanı → ucuz parça shader'ı)
    const mat = new THREE.MeshPhongMaterial({
      map, vertexColors: true, specular: 0x3a3430, shininess: 18,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'road';
    this.group.add(mesh);
    this.roadMesh = mesh;
  }

  /** Tünel içinde sodyum lambası tonu (yol/bariyer köşe renkleri için). */
  tunnelTint(s, out) {
    const a = this.tunnel.s0;
    const b = this.tunnel.s1;
    s = this.wrap(s);
    let k = 0;
    if (s > a - 10 && s < b + 10) {
      k = Math.min(1, (s - (a - 10)) / 30, (b + 10 - s) / 30);
    }
    out.setRGB(1 - k * 0.12, 1 - k * 0.35, 1 - k * 0.55);
    return out;
  }

  buildCurbs() {
    // |eğrilik| > 1/230 m olan bölgelerde iki kenara kırmızı-beyaz bordür
    const N = this.N;
    const on = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (Math.abs(this.curvature[i]) > 1 / 230) on[i] = 1;
    // Genişlet (±8 örnek) ve tünel/rampa bölgelerini çıkar
    const ext = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (!on[i]) continue;
      for (let k = -8; k <= 8; k++) ext[(i + k + N) % N] = 1;
    }
    for (let i = 0; i < N; i++) if (this.inTunnel(i * this.ds, 5)) ext[i] = 0;
    // Kısa parçaları at
    const half = this.width / 2;
    const inner = half - 1.25;
    const positions = [];
    const uvs = [];
    const indices = [];
    let vCount = 0;
    for (const side of [-1, 1]) {
      let i = 0;
      // ext'in başladığı yerden döngüye başlayalım ki parçalar bölünmesin
      let start = 0;
      while (start < N && ext[start]) start++;
      for (let n = 0; n < N; n++) {
        i = (start + n) % N;
        if (!ext[i]) continue;
        // parça başlangıcı
        const seg = [];
        let m = n;
        while (m < N && ext[(start + m) % N]) { seg.push((start + m) % N); m++; }
        n = m;
        if (seg.length < 12) continue;
        seg.push((seg[seg.length - 1] + 1) % N);
        const base = vCount;
        for (let q = 0; q < seg.length; q++) {
          const idx = seg[q];
          const sAlong = q * this.ds;
          // Uçlarda inceltme
          const fade = Math.min(1, q / 4, (seg.length - 1 - q) / 4);
          const latIn = side * (half - (half - inner) * fade);
          const latOut = side * half;
          const y = this.py[idx] + 0.035;
          for (const lat of [latIn, latOut]) {
            positions.push(this.px[idx] + this.rx[idx] * lat, y + (lat === latIn ? 0 : 0.02), this.pz[idx] + this.rz[idx] * lat);
          }
          uvs.push(sAlong / 2, 0, sAlong / 2, 1);
          vCount += 2;
        }
        for (let q = 0; q < seg.length - 1; q++) {
          const a = base + q * 2;
          if (side > 0) indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          else indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({
      map: curbTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'curbs';
    this.group.add(mesh);
  }

  /** Bölüme göre bariyer atlas satırı. */
  barrierRow(s) {
    const id = this.sectionAt(s);
    if (this.inTunnel(s, 2)) return 3;
    if (id === 'start' || id === 'city') return 0;
    if (id === 'harbor' || id === 'descent') return 1;
    return 2;
  }

  buildBarriers() {
    const N = this.N;
    const half = this.width / 2;
    const P = BARRIER_PROFILE;
    const cols = P.length;
    const positions = [];
    const uvs = [];
    const colors = [];
    const indices = [];
    const tint = new THREE.Color();
    const rowH = 1 / BARRIER_ROWS;
    let vCount = 0;
    for (const side of [-1, 1]) {
      // Satır değişimlerinde dikiş için kesiti çoğalt: her kesit kendi satırını kullanır, parça
      // geçişinde iki kesit üst üste gelir.
      let prevRow = -1;
      let prevBase = -1;
      const ks = [];
      for (let k = 0; k < N; k += 2) ks.push(k);
      ks.push(N);
      for (const k of ks) {
        const i = k % N;
        const s = k * this.ds;
        const row = this.barrierRow(s);
        this.tunnelTint(s, tint);
        const emit = (r) => {
          const base = vCount;
          for (let c = 0; c < cols; c++) {
            const [off, h, v] = P[c];
            const lat = side * (half + off);
            positions.push(this.px[i] + this.rx[i] * lat, this.py[i] + h, this.pz[i] + this.rz[i] * lat);
            // Satırın içinde v: kenarlardan biraz içeride (mipmap taşmasına karşı)
            const vv = 1 - (r * rowH + (0.02 + v * 0.96) * rowH);
            uvs.push((side > 0 ? s : -s) / 16, vv); // sol yanda yazı ayna olmasın
            colors.push(tint.r, tint.g, tint.b);
            vCount++;
          }
          return base;
        };
        let base;
        if (row !== prevRow && prevBase >= 0) {
          // Önce eski satırla bir kesit (önceki parçayı kapatır), sonra yenisiyle.
          const closeBase = emit(prevRow);
          pushQuads(indices, prevBase, closeBase, cols, side);
          base = emit(row);
        } else {
          base = emit(row);
          if (prevBase >= 0) pushQuads(indices, prevBase, base, cols, side);
        }
        prevBase = base;
        prevRow = row;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ map: barrierTexture(), vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'barriers';
    this.group.add(mesh);
  }

  buildRamps() {
    const positions = [];
    const uvs = [];
    const colors = [];
    const indices = [];
    const smp = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
    const NS = 18;
    const NL = 8;
    const col = new THREE.Color();
    const addVertex = (s, lat, y, u, v) => {
      this.sample(s, smp);
      positions.push(smp.pos.x + smp.right.x * lat, y, smp.pos.z + smp.right.z * lat);
      uvs.push(u, v);
      colors.push(col.r, col.g, col.b);
      return positions.length / 3 - 1;
    };
    for (const r of this.ramps) {
      col.set(r.type === 'jump' ? 0xffc21a : 0x33c6ff);
      const len = r.s1 - r.s0;
      const lift = 0.025;
      // Üst yüzey
      const top = [];
      for (let a = 0; a <= NS; a++) {
        const t = a / NS;
        const s = r.s0 + t * len;
        const row = [];
        for (let b = 0; b <= NL; b++) {
          const lat = r.latMin + (r.latMax - r.latMin) * (b / NL);
          const y = this.centerHeight(s) + rampProfile(r, t, lat) + lift;
          row.push(addVertex(s, lat, y, b / NL, t));
        }
        top.push(row);
      }
      for (let a = 0; a < NS; a++) {
        for (let b = 0; b < NL; b++) {
          const i0 = top[a][b];
          const i1 = top[a][b + 1];
          const i2 = top[a + 1][b];
          const i3 = top[a + 1][b + 1];
          indices.push(i0, i1, i2, i1, i3, i2);
        }
      }
      // Yan duvarlar (latMin: dışa bakan normal -right, latMax: +right)
      for (const [lat, dir] of [[r.latMin, -1], [r.latMax, 1]]) {
        const bot = [];
        const tp = [];
        for (let a = 0; a <= NS; a++) {
          const t = a / NS;
          const s = r.s0 + t * len;
          const yb = this.centerHeight(s) - 0.05;
          const yt = this.centerHeight(s) + rampProfile(r, t, lat) + lift;
          const u = dir < 0 ? 0.03 : 0.97;
          bot.push(addVertex(s, lat, yb, u, t));
          tp.push(addVertex(s, lat, yt, u, t));
        }
        for (let a = 0; a < NS; a++) {
          if (dir > 0) indices.push(bot[a], bot[a + 1], tp[a], tp[a], bot[a + 1], tp[a + 1]);
          else indices.push(bot[a], tp[a], bot[a + 1], tp[a], tp[a + 1], bot[a + 1]);
        }
      }
      // Arka (fırlatma) yüzü
      const bot = [];
      const tp = [];
      for (let b = 0; b <= NL; b++) {
        const lat = r.latMin + (r.latMax - r.latMin) * (b / NL);
        const yb = this.centerHeight(r.s1) - 0.05;
        const yt = this.centerHeight(r.s1) + rampProfile(r, 1, lat) + lift;
        bot.push(addVertex(r.s1, lat, yb, 0.5, 0.99));
        tp.push(addVertex(r.s1, lat, yt, 0.5, 0.99));
      }
      for (let b = 0; b < NL; b++) indices.push(bot[b], tp[b], bot[b + 1], tp[b], tp[b + 1], bot[b + 1]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const map = rampTexture();
    const mat = new THREE.MeshStandardMaterial({
      map, vertexColors: true, roughness: 0.55, metalness: 0.1,
      emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.08,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'ramps';
    this.group.add(mesh);
  }

  buildStartDecals() {
    const positions = [];
    const uvs = [];
    const indices = [];
    const smp = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
    const half = this.width / 2;
    const quad = (s0, s1, l0, l1, u0, u1, v0, v1) => {
      const base = positions.length / 3;
      for (const [s, v] of [[s0, v0], [s1, v1]]) {
        this.sample(s, smp);
        const y = smp.pos.y + 0.03;
        for (const [l, u] of [[l0, u0], [l1, u1]]) {
          positions.push(smp.pos.x + smp.right.x * l, y, smp.pos.z + smp.right.z * l);
          uvs.push(u, v);
        }
      }
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    };
    // Dama deseni: enine 16 kare (20 m), boyuna 2 sıra (2.5 m) — dokunun sol yarısı (u 0..0.5).
    quad(-1.25, 1.25, -half, half, 0, 0.5, 1, 1 - 2 / 16);
    // Grid kutuları (getStartGrid ile aynı yerleşim)
    for (let i = 0; i < 8; i++) {
      const s = -(9 + i * 4.5) + 3.2;
      const lat = i % 2 === 0 ? -4.5 : 4.5;
      quad(s - 2.6, s, lat - 1.6, lat + 1.6, 0.5, 1, 0.5, 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({
      map: startDecalTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.name = 'start-decals';
    this.group.add(mesh);
  }

  buildPickups() {
    this.pickups = [];
    // Paylaşılan geometri / materyal
    const profile = [];
    const R = 0.36;
    const H = 1.3;
    const pts = [
      [0, -H / 2], [R * 0.55, -H / 2], [R * 0.8, -H / 2 + 0.05], [R, -H / 2 + 0.2],
      [R, H / 2 - 0.2], [R * 0.8, H / 2 - 0.05], [R * 0.5, H / 2], [R * 0.32, H / 2 + 0.06],
      [R * 0.32, H / 2 + 0.16], [0, H / 2 + 0.16],
    ];
    for (const [x, y] of pts) profile.push(new THREE.Vector2(x, y));
    const canGeo = new THREE.LatheGeometry(profile, 20);
    // Lathe uv.y profil boyunca 0..1; dokumuz da v boyunca kapak-gövde-kapak.
    const nitroMap = nitroTexture();
    const canMat = new THREE.MeshStandardMaterial({
      map: nitroMap, emissiveMap: nitroMap, emissive: 0x7fd4ff, emissiveIntensity: 2.4,
      metalness: 0.55, roughness: 0.22,
    });
    const haloMat = new THREE.SpriteMaterial({
      map: glowTexture('rgba(160,225,255,1)', 'rgba(40,140,255,0.45)'),
      color: 0x5cbcff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85,
    });
    const ringGeo = new THREE.RingGeometry(1.25, 1.55, 32, 1);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x3aa8ff, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const smp = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
    PICKUP_DEFS.forEach(([x, z, lateral], idx) => {
      const s = this.nearestIndex(x, z) * this.ds;
      this.sample(s, smp);
      const group = new THREE.Group();
      group.position.copy(smp.pos).addScaledVector(smp.right, lateral);
      group.position.y = this.heightAt(s, lateral);
      group.name = `nitro-${idx}`;
      const canister = new THREE.Mesh(canGeo, canMat);
      canister.position.y = 1.35;
      canister.rotation.z = 0.12;
      group.add(canister);
      const halo = new THREE.Sprite(haloMat);
      halo.position.y = 1.35;
      halo.scale.set(4.2, 4.2, 1);
      group.add(halo);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      group.add(ring);
      this.group.add(group);
      this.pickups.push({
        s, lateral, kind: 'nitro', mesh: group, active: true, respawnAt: 0,
        canister, halo, ring, phase: idx * 1.7,
      });
    });
  }
}

/** Rampa profili: s0'dan s1'e yumuşak (karesel) yükseliş; roll rampası dış kenara doğru yatık. */
export function rampProfile(r, t, lateral) {
  let h = r.height * t * t;
  if (r.type === 'roll') {
    const outerIsMax = Math.abs(r.latMax) >= Math.abs(r.latMin);
    const w = r.latMax - r.latMin;
    const u = outerIsMax ? (lateral - r.latMin) / w : (r.latMax - lateral) / w;
    h *= 0.55 + 0.45 * Math.min(1, Math.max(0, u));
  }
  return h;
}

function pushQuads(indices, a, b, cols, side) {
  for (let c = 0; c < cols - 1; c++) {
    const i0 = a + c;
    const i1 = a + c + 1;
    const i2 = b + c;
    const i3 = b + c + 1;
    // Sağ tarafta profil dışa doğru ilerler; sarım yönü taraf bazında çevrilir
    if (side > 0) indices.push(i0, i1, i2, i1, i3, i2);
    else indices.push(i0, i2, i1, i1, i2, i3);
  }
}

function stripGeometry(pos, uv, col, rows, cols) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const idx = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      // Sol → sağ (lateral artan), ileri (s artan): yukarı bakan yüz için sarım
      idx.push(a, b, d, b, e, d);
    }
  }
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export { UP };
