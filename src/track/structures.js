// Pist boyunca uzanan yapılar: tünel, rıhtım duvarı, kaldırım, tribünler, start kapısı, bayraklar,
// reklam panoları ve iskeleler. Hepsi birleştirilmiş geometri (az çizim çağrısı).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SEA_LEVEL, seaSignedDistance } from './terrain.js';
import {
  crowdTexture, adsTexture, AD_COUNT, paverTexture, stoneTexture, tunnelTileTexture, flagsTexture,
  gantryScreenTexture,
} from './envtextures.js';
import { colorize, clean } from './models.js';
import { mulberry32 } from './textures.js';

const Y = new THREE.Vector3(0, 1, 0);

/** Basit geometri yazıcısı: konum/uv/renk + üçgen indeksleri. */
class GeoWriter {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }

  v(x, y, z, u = 0, w = 0, c = null) {
    this.pos.push(x, y, z);
    this.uv.push(u, w);
    if (c) this.col.push(c.r, c.g, c.b);
    else this.col.push(1, 1, 1);
    return this.pos.length / 3 - 1;
  }

  tri(a, b, c) { this.idx.push(a, b, c); }

  quad(a, b, c, d) { this.idx.push(a, b, c, c, b, d); }

  build({ colors = false } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx.length > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/** Pist çerçevesi: s → konum (yol yüzeyi), sağ, yatay teğet. */
export function frameAt(track, s, out = {}) {
  const smp = track.sample(s);
  const h = Math.hypot(smp.tangent.x, smp.tangent.z) || 1;
  out.x = smp.pos.x;
  out.y = smp.pos.y;
  out.z = smp.pos.z;
  out.rx = smp.right.x;
  out.rz = smp.right.z;
  out.tx = smp.tangent.x / h;
  out.tz = smp.tangent.z / h;
  out.yaw = Math.atan2(out.tx, out.tz);
  return out;
}

/**
 * Pist boyunca kesit profili süpürür. profile: [[lateral, height, v]], dışa/içe sarım `flip` ile.
 * s0..s1 (s1 > s0 olabilir, length'i aşabilir), adım step metre.
 */
function sweep(writer, track, s0, s1, step, profile, { flip = false, uScale = 0.25, uvMode = 'profile', color = null } = {}) {
  const n = Math.max(1, Math.round((s1 - s0) / step));
  const f = {};
  const rows = [];
  for (let k = 0; k <= n; k++) {
    const s = s0 + ((s1 - s0) * k) / n;
    frameAt(track, s, f);
    const row = [];
    let acc = 0;
    for (let c = 0; c < profile.length; c++) {
      const [lat, h, vv] = profile[c];
      if (c > 0) acc += Math.hypot(lat - profile[c - 1][0], h - profile[c - 1][1]);
      const v = uvMode === 'profile' ? (vv !== undefined ? vv : acc * uScale) : h * uScale;
      row.push(writer.v(f.x + f.rx * lat, f.y + h, f.z + f.rz * lat, s * uScale, v, color));
    }
    rows.push(row);
  }
  for (let k = 0; k < n; k++) {
    for (let c = 0; c < profile.length - 1; c++) {
      const a = rows[k][c];
      const b = rows[k][c + 1];
      const a2 = rows[k + 1][c];
      const b2 = rows[k + 1][c + 1];
      if (!flip) { writer.tri(a, a2, b); writer.tri(b, a2, b2); } else { writer.tri(a, b, a2); writer.tri(b, b2, a2); }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Tünel

export function buildTunnel(track, group, buildingSink) {
  const t0 = track.tunnel.s0;
  const t1 = track.tunnel.s1;
  // İç yüzey (karolar)
  const inner = new GeoWriter();
  const P_IN = [[-13, -0.4], [-13, 6.2], [-11.2, 8.4], [11.2, 8.4], [13, 6.2], [13, -0.4]];
  // v: profil boyunca metre / 4 (4 m doku), alt bant duvar dibinde
  const profIn = [];
  let acc = 0;
  for (let i = 0; i < P_IN.length; i++) {
    if (i > 0) acc += Math.hypot(P_IN[i][0] - P_IN[i - 1][0], P_IN[i][1] - P_IN[i - 1][1]);
    profIn.push([P_IN[i][0], P_IN[i][1], (i < 3 ? acc : 0) / 4]);
  }
  // Duvar karoları her iki tarafta alttan başlasın: profili sol ve sağ duvar için ayrı süpür
  const left = [[-13, -0.4, 0], [-13, 6.2, 6.6 / 4], [-11.2, 8.4, (6.6 + 2.84) / 4], [0, 8.4, (6.6 + 2.84 + 11.2) / 4]];
  const right = [[0, 8.4, (6.6 + 2.84 + 11.2) / 4], [11.2, 8.4, (6.6 + 2.84) / 4], [13, 6.2, 6.6 / 4], [13, -0.4, 0]];
  sweep(inner, track, t0, t1, 4, left, { flip: true, uScale: 0.25 });
  sweep(inner, track, t0, t1, 4, right, { flip: true, uScale: 0.25 });
  const innerMat = new THREE.MeshStandardMaterial({ map: tunnelTileTexture(), roughness: 0.55, color: 0xd8c8b0 });
  // Karo dokusu: v=0 alt (koyu bant dokunun altında)
  innerMat.map.wrapT = THREE.RepeatWrapping;
  const innerMesh = new THREE.Mesh(inner.build(), innerMat);
  innerMesh.receiveShadow = true;
  innerMesh.name = 'tunnel-inner';
  group.add(innerMesh);

  // Dış kabuk (taş) + portallar
  const outer = new GeoWriter();
  const P_OUT = [[-14.6, -1.5], [-14.6, 10.6], [14.6, 10.6], [14.6, -1.5]];
  sweep(outer, track, t0 - 2, t1 + 2, 4, P_OUT, { flip: false, uScale: 0.25 });
  const stoneMap = stoneTexture();
  const outerGeo = outer.build();
  const portals = [];
  for (const [s, dir] of [[t0, -1], [t1 + 2, 1]]) {
    const f = frameAt(track, s);
    const shape = new THREE.Shape();
    const pts = [[-28, -4], [-13.2, -4], [-13.2, 6.3], [-11.3, 8.6], [11.3, 8.6], [13.2, 6.3], [13.2, -4], [28, -4], [28, 13.5], [16, 15.5], [-16, 15.5], [-28, 13.5]];
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 2.4, bevelEnabled: true, bevelThickness: 0.4, bevelSize: 0.4, bevelSegments: 1 });
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.25, uv.getY(i) * 0.25);
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(f.rx, 0, f.rz), Y, new THREE.Vector3(-f.tx, 0, -f.tz),
    );
    m.setPosition(f.x, f.y, f.z);
    g.applyMatrix4(m);
    portals.push(g);
    void dir;
  }
  const outerAll = mergeGeometries([stripTo(outerGeo), ...portals.map(stripTo)], false);
  const outerMesh = new THREE.Mesh(outerAll, new THREE.MeshStandardMaterial({ map: stoneMap, roughness: 0.85, color: 0xe8d8c0 }));
  outerMesh.castShadow = true;
  outerMesh.receiveShadow = true;
  outerMesh.name = 'tunnel-shell';
  group.add(outerMesh);

  // Tavan ışık şeritleri (turuncu, HDR) — 4 m'de bir 2.6 m'lik armatür
  const lights = new GeoWriter();
  const f = {};
  for (let s = t0 + 3; s < t1 - 2; s += 4) {
    for (const lat of [-4.2, 4.2]) {
      frameAt(track, s, f);
      const ya = f.y + 8.32;
      const corners = [];
      for (const [ds, dl] of [[0, -0.32], [0, 0.32], [2.6, -0.32], [2.6, 0.32]]) {
        const fx = f.x + f.tx * ds + f.rx * (lat + dl);
        const fz = f.z + f.tz * ds + f.rz * (lat + dl);
        corners.push(lights.v(fx, ya, fz));
      }
      // Aşağı bakan yüz
      lights.tri(corners[0], corners[2], corners[1]);
      lights.tri(corners[1], corners[2], corners[3]);
    }
  }
  const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.25, 0.38), side: THREE.DoubleSide, fog: false });
  const lightMesh = new THREE.Mesh(lights.build(), lightMat);
  lightMesh.name = 'tunnel-lights';
  group.add(lightMesh);

  // Çıkış parıltısı: tünel içinden çıkışa bakınca parlak ışık (additive, yalnız içeriden görünür)
  const ex = frameAt(track, t1 - 1.0);
  const glowGeo = new THREE.PlaneGeometry(26, 8.6);
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 64; glowCanvas.height = 64;
  const gc = glowCanvas.getContext('2d');
  const grd = gc.createRadialGradient(32, 40, 2, 32, 40, 40);
  grd.addColorStop(0, 'rgba(255,240,220,1)');
  grd.addColorStop(0.5, 'rgba(255,200,150,0.55)');
  grd.addColorStop(1, 'rgba(255,170,120,0.0)');
  gc.fillStyle = grd;
  gc.fillRect(0, 0, 64, 64);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  const glowMat = new THREE.MeshBasicMaterial({
    map: glowTex, color: new THREE.Color(1.6, 1.4, 1.2), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(ex.x, ex.y + 4.3, ex.z);
  glow.rotation.y = ex.yaw + Math.PI; // -teğete bakar (içerideki sürücüye)
  glow.name = 'tunnel-exit-glow';
  group.add(glow);

  // Tünelin üstünde otel blokları (bina örnekleri olarak eklenir)
  if (buildingSink) {
    let i = 0;
    for (let s = t0 + 14; s < t1 - 14; s += 30) {
      const fr = frameAt(track, s + 15);
      buildingSink({
        x: fr.x, z: fr.z, y: fr.y + 10.6, yaw: fr.yaw, w: 26, d: 33, h: 14 + (i % 3) * 4,
        style: i % 2 === 0 ? 2 : 0, tint: i % 2 === 0 ? 0xf6e2c4 : 0xdfe9f2, lit: 0.55, front: true,
      });
      i++;
    }
  }
}

function stripTo(g) {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') out.deleteAttribute(k);
  if (!out.attributes.normal) out.computeVertexNormals();
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rıhtım duvarı ve kaldırımlar

export function buildQuaysAndSidewalks(track, group, flatZoneFn) {
  const quay = new GeoWriter();
  const walk = new GeoWriter();
  const N = track.N;
  const ds = track.ds;
  const sectionOf = (s) => track.sectionAt(s);
  // Rıhtım: sağ tarafta düzlüğün dışı denizse
  const isSeaSide = new Uint8Array(N);
  const f = {};
  for (let i = 0; i < N; i++) {
    const s = i * ds;
    if (track.inTunnel(s, 20)) continue;
    frameAt(track, s, f);
    const F = flatZoneFn(sectionOf(s), 1);
    const px = f.x + f.rx * (F + 8);
    const pz = f.z + f.rz * (F + 8);
    if (seaSignedDistance(px, pz) > -6) isSeaSide[i] = 1;
  }
  // Parçalara böl ve süpür
  const runs = (mask) => {
    const out = [];
    let start = -1;
    for (let i = 0; i <= N; i++) {
      const on = i < N && mask[i];
      if (on && start < 0) start = i;
      if (!on && start >= 0) { if (i - start > 6) out.push([start, i]); start = -1; }
    }
    return out;
  };
  for (const [a, b] of runs(isSeaSide)) {
    const s0 = a * ds;
    const s1 = (b - 1) * ds;
    const F = flatZoneFn(sectionOf((s0 + s1) / 2), 1);
    // Profil (iç kenardan dışa): korkuluk duvarı + dış yüz denize iner
    const prof = [
      [F - 0.7, -0.3, 0], [F - 0.7, 0.55, 0.21], [F, 0.62, 0.4], [F, SEA_LEVEL - 4 - track.centerHeight(s0), 1.6],
    ];
    sweep(quay, track, s0, s1, 4, prof, { flip: true, uScale: 0.25 });
  }

  // Kaldırımlar / kordon: start, liman, şehir bölümlerinde iki yanda
  const color = new THREE.Color();
  for (const side of [-1, 1]) {
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const s = i * ds;
      const sec = sectionOf(s);
      if ((sec === 'start' || sec === 'harbor' || sec === 'city') && !track.inTunnel(s, 25)) mask[i] = 1;
    }
    for (const [a, b] of runs(mask)) {
      const n = b - a;
      const rows = [];
      for (let k = 0; k <= n; k++) {
        const i = (a + Math.min(k, n - 1)) % N;
        const s = (a + k) * ds;
        frameAt(track, s, f);
        let F = flatZoneFn(sectionOf(s), side) - (isSeaSide[i] && side > 0 ? 0.7 : 0.4);
        F = Math.max(12, F);
        const latIn = side * 10.62;
        const latOut = side * F;
        const y = f.y + 0.12;
        color.setRGB(1, 1, 1);
        const p0 = walk.v(f.x + f.rx * latIn, y, f.z + f.rz * latIn, (f.x + f.rx * latIn) / 2, (f.z + f.rz * latIn) / 2);
        const p1 = walk.v(f.x + f.rx * latOut, y, f.z + f.rz * latOut, (f.x + f.rx * latOut) / 2, (f.z + f.rz * latOut) / 2);
        // Bordür yüzü (dış kenarda aşağı)
        const p2 = walk.v(f.x + f.rx * latOut, y - 0.5, f.z + f.rz * latOut, (f.x + f.rx * latOut) / 2, (f.z + f.rz * latOut) / 2 + 0.25);
        rows.push([p0, p1, p2]);
      }
      for (let k = 0; k < n; k++) {
        const [a0, a1, a2] = rows[k];
        const [b0, b1, b2] = rows[k + 1];
        if (side > 0) {
          walk.tri(a0, a1, b0); walk.tri(a1, b1, b0);
          walk.tri(a1, a2, b1); walk.tri(a2, b2, b1);
        } else {
          walk.tri(a0, b0, a1); walk.tri(a1, b0, b1);
          walk.tri(a1, b1, a2); walk.tri(a2, b1, b2);
        }
      }
    }
  }
  const quayMesh = new THREE.Mesh(quay.build(), new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.85, color: 0xf0e2cc }));
  quayMesh.receiveShadow = true;
  quayMesh.name = 'quay';
  group.add(quayMesh);
  const walkMesh = new THREE.Mesh(walk.build(), new THREE.MeshStandardMaterial({ map: paverTexture(), roughness: 0.82 }));
  walkMesh.receiveShadow = true;
  walkMesh.name = 'sidewalks';
  group.add(walkMesh);
  return { isSeaSide };
}

// ---------------------------------------------------------------------------------------------
// Tribünler (start düzlüğünün solu)

export function buildGrandstands(track, group, blocks) {
  const tiers = new GeoWriter();
  const struct = new GeoWriter();
  const roof = new GeoWriter();
  const TIERS = 10;
  const TREAD = 1.55;
  const RISE = 0.78;
  const FRONT = 17.5;
  const BASE_H = 1.6;
  const f = {};
  for (const [s0, s1] of blocks) {
    const n = Math.round((s1 - s0) / 4);
    const rowsT = [];
    const rowsS = [];
    for (let k = 0; k <= n; k++) {
      const s = s0 + ((s1 - s0) * k) / n;
      frameAt(track, s, f);
      const g = f.y - 0.3;
      const P = (lat, h, u, v, w = tiers) => w.v(f.x - f.rx * lat, g + h, f.z - f.rz * lat, u, v);
      const u = s / 16;
      // Basamaklar: her basamak = rıht (dikey) + basamak yüzü (yatay)
      const rowT = [];
      for (let j = 0; j < TIERS; j++) {
        const lat0 = FRONT + j * TREAD;
        const h0 = BASE_H + j * RISE;
        const vb = (j % 4) / 4;
        rowT.push(P(lat0, h0, u, 1 - (vb + 0.0)));
        rowT.push(P(lat0, h0 + RISE, u, 1 - (vb + 0.12)));
        rowT.push(P(lat0 + TREAD, h0 + RISE, u, 1 - (vb + 0.25)));
      }
      rowsT.push(rowT);
      // Yapı: ön duvar (zeminden ilk basamağa), arka duvar, arka çatı direkleri yerine dolu duvar
      const backLat = FRONT + TIERS * TREAD;
      const topH = BASE_H + TIERS * RISE;
      const rowS = [
        P(FRONT - 0.3, -0.6, u, 0, struct), P(FRONT - 0.3, BASE_H + 0.9, u, 0.3, struct), P(FRONT, BASE_H + 0.9, u, 0.35, struct),
        P(backLat, topH + 1.2, u, 0.6, struct), P(backLat + 0.4, topH + 1.2, u, 0.62, struct), P(backLat + 0.4, -0.6, u, 1, struct),
      ];
      rowsS.push(rowS);
      // Çatı: hafif eğimli, öne doğru taşan
      const rh0 = topH + 5.5;
      const rh1 = topH + 4.2;
      roof.v(f.x - f.rx * (FRONT - 3), g + rh1, f.z - f.rz * (FRONT - 3), u, 0);
      roof.v(f.x - f.rx * (backLat + 1), g + rh0, f.z - f.rz * (backLat + 1), u, 1);
    }
    for (let k = 0; k < n; k++) {
      const A = rowsT[k];
      const B = rowsT[k + 1];
      for (let c = 0; c < A.length - 1; c++) {
        // sol tarafta (lateral negatif): yolun tersine doğru ilerleyen profil
        tiers.tri(A[c], A[c + 1], B[c]);
        tiers.tri(A[c + 1], B[c + 1], B[c]);
      }
      const SA = rowsS[k];
      const SB = rowsS[k + 1];
      for (let c = 0; c < SA.length - 1; c++) {
        struct.tri(SA[c], SA[c + 1], SB[c]);
        struct.tri(SA[c + 1], SB[c + 1], SB[c]);
      }
    }
    // Çatı üçgenleri (iki yüzlü malzeme)
    const base = roof.pos.length / 3 - (n + 1) * 2;
    for (let k = 0; k < n; k++) {
      const a = base + k * 2;
      roof.tri(a, a + 2, a + 1);
      roof.tri(a + 1, a + 2, a + 3);
    }
    // Yan kapaklar (uç duvarlar) — basit dörtgen
    for (const s of [s0, s1]) {
      frameAt(track, s, f);
      const g = f.y - 0.3;
      const backLat = FRONT + TIERS * TREAD;
      const topH = BASE_H + TIERS * RISE;
      const pts = [[FRONT, -0.6], [FRONT, BASE_H], [backLat, topH + 1.2], [backLat, -0.6]];
      const ids = pts.map(([lat, h]) => struct.v(f.x - f.rx * lat, g + h, f.z - f.rz * lat, 0, 0));
      if (s === s0) { struct.tri(ids[0], ids[1], ids[2]); struct.tri(ids[0], ids[2], ids[3]); } else { struct.tri(ids[0], ids[2], ids[1]); struct.tri(ids[0], ids[3], ids[2]); }
    }
  }
  const tierMesh = new THREE.Mesh(tiers.build(), new THREE.MeshStandardMaterial({ map: crowdTexture(), roughness: 0.9, side: THREE.DoubleSide }));
  tierMesh.receiveShadow = true;
  tierMesh.castShadow = true;
  tierMesh.name = 'grandstand-crowd';
  group.add(tierMesh);
  const structMesh = new THREE.Mesh(struct.build(), new THREE.MeshStandardMaterial({ color: 0xe9e4dc, roughness: 0.8, side: THREE.DoubleSide }));
  structMesh.receiveShadow = true;
  structMesh.castShadow = true;
  structMesh.name = 'grandstand-structure';
  group.add(structMesh);
  const roofCanvas = document.createElement('canvas');
  roofCanvas.width = 256; roofCanvas.height = 64;
  const rc = roofCanvas.getContext('2d');
  rc.fillStyle = '#f4f4f2'; rc.fillRect(0, 0, 256, 64);
  rc.fillStyle = '#d8202a'; rc.fillRect(0, 0, 256, 10);
  rc.fillStyle = '#1550c8'; rc.fillRect(0, 10, 256, 4);
  const roofTex = new THREE.CanvasTexture(roofCanvas);
  roofTex.colorSpace = THREE.SRGBColorSpace;
  roofTex.wrapS = THREE.RepeatWrapping;
  const roofMesh = new THREE.Mesh(roof.build(), new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide }));
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  roofMesh.name = 'grandstand-roof';
  group.add(roofMesh);
}

// ---------------------------------------------------------------------------------------------
// Start kapısı (gantry), s = 0

export function buildGantry(track, group, s = 0) {
  const f = frameAt(track, s);
  const parts = [];
  const metal = 0x30353d;
  const red = 0xd8202a;
  const add = (geo, color, lat, h, along = 0) => {
    colorize(geo, color);
    geo.translate(lat, h, along);
    parts.push(geo);
  };
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(1.4, 11.2, 1.6), metal, side * 14.6, 5.6 - 0.6);
    add(new THREE.BoxGeometry(1.6, 0.6, 1.8), red, side * 14.6, 10.6);
  }
  add(new THREE.BoxGeometry(31, 2.6, 1.5), metal, 0, 9.6);
  add(new THREE.BoxGeometry(31.2, 0.3, 1.7), red, 0, 8.25);
  add(new THREE.BoxGeometry(31.2, 0.3, 1.7), red, 0, 10.95);
  // Işık kutuları (beş çift)
  for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(1.5, 1.1, 0.7), 0x15171b, -6 + i * 3, 7.5);
  const geo = mergeGeometries(parts.map(clean), false);
  // Yerel: x = sağ, y = yukarı, z = -teğet (sağ elli taban); yüz -z = gelen araçlara bakar
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(f.rx, 0, f.rz), Y, new THREE.Vector3(-f.tx, 0, -f.tz));
  m.setPosition(f.x, f.y, f.z);
  geo.applyMatrix4(m);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.5 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'gantry';
  group.add(mesh);

  // Ekranlar (iki yüz)
  const screenTex = gantryScreenTexture();
  const screenMat = new THREE.MeshStandardMaterial({
    map: screenTex, emissiveMap: screenTex, emissive: 0xffffff, emissiveIntensity: 1.3, roughness: 0.4,
  });
  const sgs = [];
  for (const face of [1, -1]) {
    const g = new THREE.PlaneGeometry(22, 2.2);
    if (face < 0) g.rotateY(Math.PI);
    g.translate(0, 9.6, face * 0.77);
    sgs.push(g);
  }
  const sg = mergeGeometries(sgs, false);
  sg.applyMatrix4(m);
  const screen = new THREE.Mesh(sg, screenMat);
  screen.name = 'gantry-screen';
  group.add(screen);

  // Lambalar (beyaz LED, HDR)
  const bulbs = [];
  for (let i = 0; i < 5; i++) {
    for (const dx of [-0.35, 0.35]) {
      for (const face of [1, -1]) {
        const g = new THREE.CircleGeometry(0.26, 12);
        if (face < 0) g.rotateY(Math.PI);
        g.translate(-6 + i * 3 + dx, 7.5, face * 0.37);
        bulbs.push(g);
      }
    }
  }
  const bg = mergeGeometries(bulbs, false);
  bg.applyMatrix4(m);
  const bulbMesh = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.6, 2.0) }));
  bulbMesh.name = 'gantry-lights';
  group.add(bulbMesh);
}

// ---------------------------------------------------------------------------------------------
// Bayraklar (dalgalanan, vertex shader)

export function buildFlags(group, placements) {
  // placements: [{ x, y, z, yaw, design }]
  const poles = [];
  const cloths = [];
  for (const p of placements) {
    const pole = colorize(new THREE.CylinderGeometry(0.07, 0.09, 9, 6), 0xd9d9d9);
    pole.translate(0, 4.5, 0);
    pole.rotateY(p.yaw);
    pole.translate(p.x, p.y, p.z);
    poles.push(clean(pole));
    const g = new THREE.PlaneGeometry(2.6, 1.7, 10, 3);
    g.translate(1.3, 8.0, 0);
    // uv.x = bayrak boyunca 0..1 (direkten uca) → dalga genliği; atlas hücresine yerleştir
    const uv = g.attributes.uv;
    const du = (p.design % 4) * 0.25;
    const dv = 0.5 - Math.floor(p.design / 4) * 0.5;
    const wave = new Float32Array(uv.count);
    for (let i = 0; i < uv.count; i++) {
      wave[i] = uv.getX(i);
      uv.setXY(i, du + uv.getX(i) * 0.25, dv + uv.getY(i) * 0.5);
    }
    g.setAttribute('aWave', new THREE.BufferAttribute(wave, 1));
    g.rotateY(p.yaw);
    g.translate(p.x, p.y, p.z);
    cloths.push(g);
  }
  const poleMesh = new THREE.Mesh(mergeGeometries(poles, false), new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.35 }));
  poleMesh.name = 'flag-poles';
  group.add(poleMesh);
  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ map: flagsTexture(), side: THREE.DoubleSide, roughness: 0.8 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWave;\nuniform float uTime;')
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        float ph = aWave * 7.0 - uTime * 7.5 + position.x * 0.13 + position.z * 0.11;
        transformed.x += sin(ph) * 0.22 * aWave;
        transformed.z += cos(ph * 0.9) * 0.22 * aWave;
        transformed.y += sin(ph * 1.3) * 0.06 * aWave;
      `);
  };
  mat.customProgramCacheKey = () => 'flags-v1';
  const clothMesh = new THREE.Mesh(mergeGeometries(cloths, false), mat);
  clothMesh.name = 'flags';
  clothMesh.frustumCulled = false;
  group.add(clothMesh);
  return uniforms;
}

// ---------------------------------------------------------------------------------------------
// Reklam panoları

export function buildBillboards(group, placements) {
  // placements: [{ x, y, z, yaw, w, h, lift, ad }] — panonun önü yerel +z (yaw yönüne) bakar
  const faces = [];
  const frames = [];
  for (const p of placements) {
    const w = p.w || 16;
    const h = p.h || 4;
    const lift = p.lift ?? 4;
    const face = new THREE.PlaneGeometry(w, h);
    const uv = face.attributes.uv;
    const du = (p.ad % 2) * 0.5;
    const dv = 0.75 - Math.floor(p.ad / 2) * 0.25;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, du + uv.getX(i) * 0.5, dv + uv.getY(i) * 0.25);
    face.translate(0, lift + h / 2, 0.16);
    face.rotateY(p.yaw);
    face.translate(p.x, p.y, p.z);
    faces.push(face);
    const parts = [];
    const back = colorize(new THREE.BoxGeometry(w + 0.5, h + 0.5, 0.3), 0x24282e);
    back.translate(0, lift + h / 2, 0);
    parts.push(back);
    if (lift > 0.5) {
      for (const dx of [-w * 0.3, w * 0.3]) {
        const post = colorize(new THREE.BoxGeometry(0.45, lift + 0.2, 0.45), 0x30353c);
        post.translate(dx, lift / 2 - 0.2, -0.3);
        parts.push(post);
      }
    }
    for (const g of parts) {
      g.rotateY(p.yaw);
      g.translate(p.x, p.y, p.z);
      frames.push(clean(g));
    }
  }
  const tex = adsTexture();
  const faceMesh = new THREE.Mesh(mergeGeometries(faces, false), new THREE.MeshStandardMaterial({
    map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.45, roughness: 0.45,
  }));
  faceMesh.name = 'billboards';
  faceMesh.receiveShadow = true;
  group.add(faceMesh);
  const frameMesh = new THREE.Mesh(mergeGeometries(frames, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 }));
  frameMesh.castShadow = true;
  frameMesh.receiveShadow = true;
  frameMesh.name = 'billboard-frames';
  group.add(frameMesh);
}
export { AD_COUNT };

// ---------------------------------------------------------------------------------------------
// İskeleler (marina)

export function buildPiers(group, piers) {
  // piers: [{ x0, z0, x1, z1, w }]
  const parts = [];
  for (const p of piers) {
    const len = Math.hypot(p.x1 - p.x0, p.z1 - p.z0);
    const g = colorize(new THREE.BoxGeometry(p.w, 0.5, len), 0x9a7650);
    g.rotateY(Math.atan2(p.x1 - p.x0, p.z1 - p.z0));
    g.translate((p.x0 + p.x1) / 2, SEA_LEVEL + 0.8, (p.z0 + p.z1) / 2);
    parts.push(clean(g));
    // Kazıklar
    const rnd = mulberry32(Math.round(p.x0 * 7 + p.z0));
    for (let t = 0; t <= len; t += 8) {
      for (const side of [-1, 1]) {
        const k = t / len;
        const x = p.x0 + (p.x1 - p.x0) * k + side * (p.w / 2) * Math.cos(Math.atan2(p.x1 - p.x0, p.z1 - p.z0));
        const z = p.z0 + (p.z1 - p.z0) * k - side * (p.w / 2) * Math.sin(Math.atan2(p.x1 - p.x0, p.z1 - p.z0));
        const pile = colorize(new THREE.CylinderGeometry(0.18, 0.18, 3.2 + rnd() * 0.6, 5), 0x5a4632);
        pile.translate(x, SEA_LEVEL + 0.3, z);
        parts.push(clean(pile));
      }
    }
  }
  if (!parts.length) return;
  const mesh = new THREE.Mesh(mergeGeometries(parts, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  mesh.receiveShadow = true;
  mesh.name = 'piers';
  group.add(mesh);
}
