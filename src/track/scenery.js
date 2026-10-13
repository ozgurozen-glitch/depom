// Mekân: binalar (tek InstancedMesh + cephe shader'ı), villalar, palmiyeler, sokak lambaları, yatlar,
// ağaçlar, kayalar, neon tabelalar, adalar, deniz feneri ve pist yapıları (structures.js).
// Tüm nesneler merkez çizgisinden en az width/2 + 3 m uzakta tutulur.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './textures.js';
import { SEA_LEVEL, cityMask, seaSignedDistance, flatZone } from './terrain.js';
import { facadeTextures, neonTexture, NEON_COUNT } from './envtextures.js';
import {
  palmGeometry, lampPoleGeometry, lampBulbGeometry, motorYachtGeometry, sailboatGeometry, cypressGeometry,
  pineGeometry, bushGeometry, rockGeometry, lighthouseGeometry, colorize, clean,
} from './models.js';
import {
  buildTunnel, buildQuaysAndSidewalks, buildGrandstands, buildGantry, buildFlags, buildBillboards, buildPiers,
  frameAt, AD_COUNT,
} from './structures.js';

const lerp = (a, b, t) => a + (b - a) * t;

const RIVIERA_TINTS = [0xf6d7b0, 0xf2c4a0, 0xf7e6c4, 0xeeb59a, 0xf4dcc8, 0xe9c78f, 0xf5efe0, 0xf1b9a6, 0xe8d3b9];
const GLASS_TINTS = [0xdfefff, 0xcfe3f2, 0xe8f2f8, 0xd2e6e0, 0xf2e8e0];
const OFFICE_TINTS = [0xffffff, 0xf2efe8, 0xe8e4dc, 0xf4eadc];

// ---------------------------------------------------------------------------------------------
// Bina materyali: kutu örneklerinin boyutundan (instanceMatrix ölçeği) pencere UV'si üretir.

function createBuildingMaterial() {
  const tex = facadeTextures();
  // textureGrad + anizotropik süzme bazı sürücülerde (SwiftShader) gürültü üretiyor → kapalı
  for (const t of [tex.map, tex.emissiveMap, tex.ormMap]) t.anisotropy = 1;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, metalness: 1, emissive: 0xffe2b8, emissiveIntensity: 1.7, envMapIntensity: 1.0,
  });
  const uniforms = {
    uFacMap: { value: tex.map }, uFacEmis: { value: tex.emissiveMap }, uFacOrm: { value: tex.ormMap },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aFacade;
        varying vec3 vFac;
        varying vec4 vFacInfo;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          float st = aFacade.x;
          vec2 cell = st < 0.5 ? vec2(3.0, 3.6) : (st < 1.5 ? vec2(3.6, 3.8) : (st < 2.5 ? vec2(3.3, 3.4) : vec2(3.0, 3.1)));
          float isX = step(0.5, abs(normal.x));
          float faceW = mix(sc.x, sc.z, isX);
          float hz = mix(position.x * sign(normal.z + 1e-4), -position.z * sign(normal.x + 1e-4), isX);
          float ncol = max(1.0, floor(faceW / cell.x + 0.5));
          float nfl = max(1.0, floor(sc.y / cell.y + 0.5));
          vFac = vec3((hz + 0.5) * ncol, position.y * nfl, step(0.5, abs(normal.y)));
          vFacInfo = aFacade;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uFacMap;
        uniform sampler2D uFacEmis;
        uniform sampler2D uFacOrm;
        varying vec3 vFac;
        varying vec4 vFacInfo;
        float facHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <map_fragment>', `
        // Not: türevler (dFdx/dFdy) ve textureGrad dallanma dışında hesaplanır (dal içinde tanımsız).
        vec3 facEm;
        float facRough;
        float facMetal;
        {
          // Örnek başına sabit değerler ara değerlemede piksel piksel titreyebilir → tamsayıya yuvarla
          float st = floor(vFacInfo.x + 0.5);
          float seed = floor(vFacInfo.y + 0.5);
          vec2 seedOff = floor(vec2(facHash(vec2(seed, 1.3)), facHash(vec2(seed, 7.1))) * 4.0);
          vec2 cont = vFac.xy + seedOff;
          vec2 tc = cont * 0.25;
          vec2 gx = dFdx(tc) * 0.496;
          vec2 gy = dFdy(tc) * 0.496;
          vec2 local = fract(tc);
          float sti = clamp(st, 0.0, 3.0);
          vec2 off = vec2(mod(sti, 2.0) * 0.5, 0.5 - floor(sti * 0.5) * 0.5);
          vec2 auv = off + 0.002 + local * 0.496;
          vec3 fMap = textureGrad(uFacMap, auv, gx, gy).rgb;
          vec3 orm = textureGrad(uFacOrm, auv, gx, gy).rgb;
          vec3 em = textureGrad(uFacEmis, auv, gx, gy).rgb;
          // Uzakta pencereler pikselden küçülünce ışıklı/sönük seçimini ortalamaya yaklaştır (titreşim yok)
          float cellPx = max(length(dFdx(cont)), length(dFdy(cont)));
          vec2 cid = floor(cont);
          float litStep = step(1.0 - vFacInfo.z, facHash(cid + seed * 3.17));
          float lit = mix(litStep, vFacInfo.z, smoothstep(0.25, 0.6, cellPx));
          float plain = max(step(0.5, vFac.z), step(3.5, st));
          vec3 plainCol = vFac.z > 0.5 ? vec3(0.55, 0.53, 0.5) : vec3(0.9);
          diffuseColor.rgb *= mix(fMap, plainCol, plain);
          facRough = mix(max(0.04, orm.g), 0.9, plain);
          facMetal = mix(orm.b, 0.0, plain);
          facEm = em * lit * (vFac.y < 1.0 ? 1.6 : 1.0) * (1.0 - plain);
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * facRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * facMetal;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= facEm;');
  };
  mat.customProgramCacheKey = () => 'facade-v1';
  return mat;
}

// ---------------------------------------------------------------------------------------------

export function buildScenery({ scene, track, terrain, density = 1 }) {
  const group = new THREE.Group();
  group.name = 'scenery';
  scene.add(group);
  const rnd = mulberry32(2024);
  const rr = (a, b) => a + (b - a) * rnd();
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const W2 = track.width / 2;
  const MIN_CLEAR = W2 + 3;
  const L = track.length;
  const sec = Object.fromEntries(track.sections.map((s) => [s.id, s]));
  const ground = (x, z) => terrain.heightAt(x, z);
  const dist = (x, z) => track.distanceToCenterline(x, z) - 1; // en yakın örnek → ≤1 m hata payı

  const footprints = [];
  const overlaps = (x, z, r) => {
    for (const f of footprints) if ((f.x - x) ** 2 + (f.z - z) ** 2 < (f.r + r) ** 2) return true;
    return false;
  };

  // ---------------- Pist yapıları
  const buildings = [];
  const neons = [];
  const addBuildingRaw = (b) => {
    buildings.push(b);
    footprints.push({ x: b.x, z: b.z, r: Math.hypot(b.w, b.d) * 0.5 });
  };
  buildTunnel(track, group, (b) => {
    addBuildingRaw({ ...b, tint: new THREE.Color(b.tint), seed: Math.floor(rnd() * 997), groundY: b.y });
  });
  buildQuaysAndSidewalks(track, group, flatZone);
  const standBlocks = [[-182, -92], [-72, 38], [58, 160]];
  buildGrandstands(track, group, standBlocks);
  for (const [a, b] of standBlocks) {
    for (let s = a; s <= b; s += 12) {
      const f = frameAt(track, s);
      footprints.push({ x: f.x - f.rx * 26, z: f.z - f.rz * 26, r: 10 });
    }
  }
  buildGantry(track, group, 0);

  // ---------------- Binalar
  /** Ayak izi köşelerinin yola uzaklığı ve zemin. */
  const tryBuilding = (b, minClear) => {
    const cy = Math.cos(b.yaw);
    const sy = Math.sin(b.yaw);
    let gMin = Infinity;
    let gMax = -Infinity;
    for (const [lx, lz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) {
      const x = b.x + lx * b.d * cy + lz * b.w * sy;
      const z = b.z - lx * b.d * sy + lz * b.w * cy;
      if (dist(x, z) < minClear) return false;
      const g = ground(x, z);
      if (g < SEA_LEVEL + 0.6) return false;
      gMin = Math.min(gMin, g);
      gMax = Math.max(gMax, g);
    }
    if (gMax - gMin > Math.max(10, b.h * 0.6)) return false;
    const r = Math.hypot(b.w, b.d) * 0.45;
    if (overlaps(b.x, b.z, r)) return false;
    b.y = gMin - 0.8;
    b.h += gMax - gMin + 0.8;
    b.seed = Math.floor(rnd() * 997);
    buildings.push(b);
    footprints.push({ x: b.x, z: b.z, r });
    return true;
  };

  const styleTint = (style) => new THREE.Color(
    style === 0 ? pick(GLASS_TINTS) : style === 1 ? pick(OFFICE_TINTS) : pick(RIVIERA_TINTS),
  );

  const rowAlong = (s0, s1, side, o) => {
    let s = s0;
    while (s < s1) {
      const w = rr(o.w[0], o.w[1]);
      const d = rr(o.d[0], o.d[1]);
      const f = frameAt(track, s + w / 2);
      const setback = o.setback + rnd() * (o.jitter ?? 3);
      const lat = side * (setback + d / 2);
      const h = o.height();
      const style = o.style(h);
      const b = {
        x: f.x + f.rx * lat, z: f.z + f.rz * lat, yaw: f.yaw, w, d, h, style,
        tint: styleTint(style), lit: o.lit ?? rr(0.25, 0.55),
      };
      if (rnd() > (o.skip ?? 0) && tryBuilding(b, o.minClear ?? setback - 1)) {
        if (o.neon && rnd() < o.neon && b.h > 10) {
          const yawFace = f.yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
          // Yola bakan yüz: yerel x yönü = -sağ; sağdaki bina için +x yüzü yola bakar
          const lx = side > 0 ? 1 : -1;
          const cx = b.x + Math.cos(b.yaw) * lx * (b.d / 2 + 0.25);
          const cz = b.z - Math.sin(b.yaw) * lx * (b.d / 2 + 0.25);
          const sw = Math.min(b.w * 0.85, rr(10, 15));
          neons.push({ x: cx, z: cz, y: b.y + Math.min(b.h - 3, rr(6, 10)), yaw: yawFace, w: sw, h: sw / 4, i: Math.floor(rnd() * NEON_COUNT) });
        }
      }
      s += w + rr(1, o.gap ?? 6);
    }
  };

  const cityTall = () => (rnd() < 0.35 ? rr(55, 120) : rr(18, 48));
  const cityStyle = (h) => (h > 50 ? (rnd() < 0.6 ? 0 : 1) : (rnd() < 0.55 ? 2 : (rnd() < 0.5 ? 3 : 1)));
  // Şehir merkezi bulvarı (iki yan)
  for (const side of [-1, 1]) {
    rowAlong(sec.city.s0 - 30, sec.start.s0 + 40, side, {
      setback: 26.5, w: [16, 30], d: [16, 30], height: cityTall, style: cityStyle, neon: 0.45, gap: 5,
    });
  }
  // Start düzlüğü: sol (tribünlerin arkası) yüksek şehir, sağ (marina) boş
  rowAlong(sec.start.s0 + 30, L + 330, -1, {
    setback: 46, w: [18, 32], d: [16, 26], height: () => rr(20, 70), style: cityStyle, neon: 0.25, gap: 6,
  });
  // Liman: sol yanda Riviera tarzı 4-8 katlı binalar
  rowAlong(sec.harbor.s0 + 10, sec.tunnel.s0 - 30, -1, {
    setback: 23.5, w: [14, 24], d: [12, 18], height: () => rr(13, 27), style: () => (rnd() < 0.75 ? 2 : 3), neon: 0.3, gap: 4,
  });
  // İkinci sıra limanda (tepe yamacında)
  rowAlong(sec.harbor.s0 + 30, sec.tunnel.s0 - 40, -1, {
    setback: 48, w: [14, 22], d: [12, 16], height: () => rr(12, 22), style: () => (rnd() < 0.7 ? 2 : 3), gap: 10, skip: 0.2,
  });
  // Şehir iç blokları (bulvar ile start düzlüğü arası, kuzey yamacı, batı)
  const fillRegion = (x0, x1, z0, z1, step, o) => {
    for (let z = z0; z <= z1; z += step) {
      for (let x = x0; x <= x1; x += step) {
        const px = x + rr(-step * 0.25, step * 0.25);
        const pz = z + rr(-step * 0.25, step * 0.25);
        if (dist(px, pz) < o.minClear + 12) continue;
        const nearest = frameAt(track, track.nearestIndex(px, pz) * track.ds);
        const h = o.height(px, pz);
        const style = o.style(h);
        tryBuilding({
          x: px, z: pz, yaw: nearest.yaw + (rnd() < 0.2 ? Math.PI / 2 : 0), w: rr(o.w[0], o.w[1]), d: rr(o.d[0], o.d[1]),
          h, style, tint: styleTint(style), lit: rr(0.25, 0.55),
        }, o.minClear);
      }
    }
  };
  fillRegion(-520, -70, -25, 160, 34, { minClear: 27, w: [16, 28], d: [16, 28], height: () => (rnd() < 0.3 ? rr(50, 105) : rr(16, 42)), style: cityStyle });
  fillRegion(-760, 60, -330, -95, 36, { minClear: 27, w: [16, 28], d: [14, 24], height: () => rr(14, 48), style: cityStyle });
  fillRegion(-900, -560, -90, 300, 38, { minClear: 27, w: [16, 28], d: [14, 26], height: () => rr(14, 55), style: cityStyle });
  fillRegion(-1150, -560, -560, -330, 46, { minClear: 27, w: [14, 24], d: [12, 20], height: () => rr(10, 30), style: () => (rnd() < 0.7 ? 2 : 3) });

  // ---------------- Villalar (tepelerde) + kiremit çatılar
  const villas = [];
  const villaRegions = [[260, 860, -40, 380], [0, 720, -300, -90], [880, 980, -260, 120]];
  for (let k = 0; k < 900 && villas.length < 70; k++) {
    const reg = villaRegions[k % villaRegions.length];
    const x = rr(reg[0], reg[1]);
    const z = rr(reg[2], reg[3]);
    const g = ground(x, z);
    if (g < 6 || cityMask(x, z) > 0.2) continue;
    if (dist(x, z) < 32) continue;
    if (terrain.slopeAt(x, z) < 0.8) continue;
    const nearest = frameAt(track, track.nearestIndex(x, z) * track.ds);
    const w = rr(12, 20);
    const d = rr(10, 15);
    const h = rr(6.5, 10.5);
    const style = rnd() < 0.7 ? 2 : 3;
    const b = { x, z, yaw: nearest.yaw + (rnd() - 0.5) * 0.4, w, d, h, style, tint: styleTint(style), lit: rr(0.3, 0.6) };
    if (tryBuilding(b, 30)) villas.push(b);
  }

  // Bina örnekleri
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const bMat = createBuildingMaterial();
  const bMesh = new THREE.InstancedMesh(boxGeo, bMat, buildings.length);
  const facade = new Float32Array(buildings.length * 4);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  buildings.forEach((b, i) => {
    e.set(0, b.yaw, 0);
    q.setFromEuler(e);
    m4.compose(p.set(b.x, b.y, b.z), q, sc.set(b.d, b.h, b.w));
    bMesh.setMatrixAt(i, m4);
    bMesh.setColorAt(i, b.tint);
    facade[i * 4] = b.style;
    facade[i * 4 + 1] = b.seed;
    facade[i * 4 + 2] = b.lit;
  });
  boxGeo.setAttribute('aFacade', new THREE.InstancedBufferAttribute(facade, 4));
  bMesh.instanceMatrix.needsUpdate = true;
  if (bMesh.instanceColor) bMesh.instanceColor.needsUpdate = true;
  bMesh.computeBoundingSphere();
  bMesh.castShadow = true;
  bMesh.receiveShadow = true;
  bMesh.name = 'buildings';
  group.add(bMesh);

  // Çatılar: villalar (kiremit) ve alçak Riviera binaları
  const roofList = buildings.filter((b) => (b.style === 2 || b.style === 3) && b.h < 30);
  const roofGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  roofGeo.rotateY(Math.PI / 4);
  roofGeo.translate(0, 0.5, 0);
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const roofMesh = new THREE.InstancedMesh(roofGeo, roofMat, roofList.length);
  const terra = [0xb9573a, 0xc4683f, 0xa84c34, 0xcf7a4a];
  roofList.forEach((b, i) => {
    e.set(0, b.yaw, 0);
    q.setFromEuler(e);
    m4.compose(p.set(b.x, b.y + b.h, b.z), q, sc.set(b.d * 1.08, Math.min(b.d, b.w) * 0.32, b.w * 1.08));
    roofMesh.setMatrixAt(i, m4);
    roofMesh.setColorAt(i, new THREE.Color(pick(terra)));
  });
  roofMesh.computeBoundingSphere();
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  roofMesh.name = 'roofs';
  group.add(roofMesh);

  // Neon tabelalar
  if (neons.length) {
    const ng = [];
    for (const n of neons) {
      const g = new THREE.PlaneGeometry(n.w, n.h);
      const uv = g.attributes.uv;
      const du = (n.i % 2) * 0.5;
      const dv = 0.75 - Math.floor(n.i / 2) * 0.25;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, du + 0.004 + uv.getX(i) * 0.492, dv + 0.004 + uv.getY(i) * 0.242);
      g.rotateY(n.yaw);
      g.translate(n.x, n.y, n.z);
      ng.push(g);
    }
    const neonMat = new THREE.MeshBasicMaterial({ map: neonTexture(), color: new THREE.Color(3.2, 3.2, 3.2) });
    const neonMesh = new THREE.Mesh(mergeGeometries(ng, false), neonMat);
    neonMesh.name = 'neon-signs';
    group.add(neonMesh);
  }

  // ---------------- Palmiyeler ve sokak lambaları
  const palms = [];
  const lamps = [];
  const placeAlong = (s0, s1, step, side, lat, kind, offset = 0) => {
    for (let s = s0 + offset; s < s1; s += step) {
      const f = frameAt(track, s);
      const l = side * (lat + rnd() * 0.6);
      const x = f.x + f.rx * l;
      const z = f.z + f.rz * l;
      if (dist(x, z) < MIN_CLEAR + 0.5) continue;
      if (Math.abs(track.wrap(s) < L / 2 ? track.wrap(s) : track.wrap(s) - L) < 14) continue; // gantry
      const g = ground(x, z);
      if (g < SEA_LEVEL + 0.5) continue;
      if (overlaps(x, z, kind === 'palm' ? 0.8 : 0.4)) continue;
      const y = Math.max(g, f.y + 0.1);
      if (kind === 'palm') palms.push({ x, y, z, yaw: rnd() * Math.PI * 2, s: rr(0.85, 1.2) });
      else lamps.push({ x, y, z, yaw: side > 0 ? f.yaw : f.yaw + Math.PI });
    }
  };
  // Liman kordonu (deniz tarafı palmiye + lamba, kara tarafı seyrek palmiye)
  placeAlong(sec.harbor.s0 + 30, sec.tunnel.s0 - 25, 17, 1, 17.5, 'palm');
  placeAlong(sec.harbor.s0 + 30, sec.tunnel.s0 - 25, 34, 1, 14.2, 'lamp', 8);
  placeAlong(sec.harbor.s0 + 30, sec.tunnel.s0 - 25, 30, -1, 15.5, 'palm', 12);
  // Start düzlüğü (sağ: marina tarafı)
  placeAlong(sec.start.s0 + 20, L + sec.harbor.s0, 22, 1, 19, 'palm');
  placeAlong(sec.start.s0 + 20, L + sec.harbor.s0, 30, 1, 14.2, 'lamp', 15);
  placeAlong(sec.start.s0 + 10, sec.start.s0 + 60, 22, -1, 15.5, 'palm');
  // Şehir bulvarı (iki yan)
  for (const side of [-1, 1]) {
    placeAlong(sec.city.s0 - 20, sec.start.s0 + 10, 28, side, 16.5, 'palm', side > 0 ? 0 : 14);
    placeAlong(sec.city.s0 - 20, sec.start.s0 + 10, 28, side, 14.2, 'lamp', side > 0 ? 14 : 0);
  }
  // İniş düzlüğünün şehre yakın kısmı
  placeAlong(sec.city.s0 - 260, sec.city.s0 - 20, 40, -1, 18, 'palm');

  const palmMesh = makeInstanced(palmGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), palms, (it, mm) => {
    e.set((rnd() - 0.5) * 0.08, it.yaw, (rnd() - 0.5) * 0.08);
    q.setFromEuler(e);
    mm.compose(p.set(it.x, it.y - 0.2, it.z), q, sc.setScalar(it.s));
  });
  palmMesh.castShadow = true;
  palmMesh.name = 'palms';
  group.add(palmMesh);

  const lampSet = (geo, mat) => makeInstanced(geo, mat, lamps, (it, mm) => {
    e.set(0, it.yaw, 0);
    q.setFromEuler(e);
    mm.compose(p.set(it.x, it.y, it.z), q, sc.setScalar(1));
  });
  const lampMesh = lampSet(lampPoleGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  lampMesh.castShadow = true;
  lampMesh.name = 'lamp-poles';
  group.add(lampMesh);
  const bulbMesh = lampSet(lampBulbGeometry(), new THREE.MeshBasicMaterial({ color: new THREE.Color(4.0, 2.9, 1.7) }));
  bulbMesh.name = 'lamp-bulbs';
  group.add(bulbMesh);

  // ---------------- Bayraklar ve reklam panoları
  const flagPl = [];
  let fi = 0;
  for (let s = -170; s <= 175; s += 15) {
    if (Math.abs(s) < 14) continue;
    const f = frameAt(track, s);
    const x = f.x + f.rx * 14.8;
    const z = f.z + f.rz * 14.8;
    if (dist(x, z) < MIN_CLEAR) continue;
    flagPl.push({ x, y: f.y + 0.1, z, yaw: f.yaw + Math.PI / 2, design: fi++ % 8 });
  }
  // Tribün çatılarında bayraklar
  for (const [a, b] of standBlocks) {
    for (let s = a + 6; s < b; s += 18) {
      const f = frameAt(track, s);
      flagPl.push({ x: f.x - f.rx * 34.5, y: f.y + 15.5, z: f.z - f.rz * 34.5, yaw: f.yaw + Math.PI / 2, design: fi++ % 8 });
    }
  }
  const flagUniforms = buildFlags(group, flagPl);

  const boards = [];
  const addBoard = (s, side, lat, o = {}) => {
    const f = frameAt(track, s);
    const l = side * lat;
    const x = f.x + f.rx * l;
    const z = f.z + f.rz * l;
    const w = o.w || 16;
    // Gelen sürücüye dönük, yola doğru hafif açılı
    const yaw = f.yaw + Math.PI - side * (o.angle ?? 0.35);
    const ex = Math.cos(yaw) * w / 2;
    const ez = -Math.sin(yaw) * w / 2;
    if (dist(x + ex, z + ez) < MIN_CLEAR + 1 || dist(x - ex, z - ez) < MIN_CLEAR + 1) return;
    if (overlaps(x, z, w / 2)) return;
    const g = Math.min(ground(x + ex, z + ez), ground(x - ex, z - ez), ground(x, z));
    if (g < SEA_LEVEL + 0.5) return;
    boards.push({ x, y: g, z, yaw, w, h: w / 4, lift: o.lift ?? 4.5, ad: boards.length % AD_COUNT });
    footprints.push({ x, z, r: w / 2 });
  };
  addBoard(sec.descent.s0 + 95, -1, 30);
  addBoard(sec.descent.s0 + 330, 1, 30);
  addBoard(sec.descent.s0 + 610, -1, 30);
  addBoard(1795, 1, 34, { w: 20, angle: 0.1 });
  addBoard(sec.climb.s0 + 120, -1, 26);
  addBoard(sec.harbor.s0 + 160, -1, 26);
  addBoard(sec.harbor.s0 + 470, -1, 26);
  for (let s = 60; s < 200; s += 34) addBoard(s, 1, 16, { w: 8, lift: 0.2, angle: Math.PI / 2 });
  for (let s = -90; s > -200; s -= 34) addBoard(s, 1, 16, { w: 8, lift: 0.2, angle: Math.PI / 2 });
  if (boards.length) buildBillboards(group, boards);

  // ---------------- Yatlar ve iskeleler
  const yachts = [];
  const sails = [];
  const isSea = (x, z, depth = 0.8) => ground(x, z) < SEA_LEVEL - depth && seaSignedDistance(x, z) > -40;
  const piers = [];
  for (const px of [-445, -375, -305, -235, -165]) {
    const z0 = 232;
    const z1 = 352;
    piers.push({ x0: px, z0, x1: px, z1, w: 3 });
    for (let z = z0 + 10; z < z1 - 4; z += 8.5) {
      for (const side of [-1, 1]) {
        if (rnd() < 0.15) continue;
        const sc2 = rr(0.85, 1.45);
        const x = px + side * (2.2 + 10 * sc2);
        if (!isSea(x, z) || !isSea(x + side * 9 * sc2, z)) continue;
        const list = rnd() < 0.3 ? sails : yachts;
        list.push({ x, z, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2, s: list === sails ? sc2 * 1.3 : sc2, ph: rnd() * 6.28 });
      }
    }
  }
  buildPiers(group, piers);
  // Liman rıhtımı önünde demirli yatlar
  for (let s = sec.harbor.s0 + 60; s < sec.tunnel.s0 - 30; s += 24) {
    if (rnd() < 0.3) continue;
    const f = frameAt(track, s);
    const l = rr(36, 44);
    const x = f.x + f.rx * l;
    const z = f.z + f.rz * l;
    if (!isSea(x, z)) continue;
    const list = rnd() < 0.35 ? sails : yachts;
    list.push({ x, z, yaw: f.yaw + (rnd() < 0.5 ? 0 : Math.PI), s: rr(0.9, 1.6), ph: rnd() * 6.28 });
  }
  // Açıkta
  for (let k = 0; k < 400 && yachts.length + sails.length < 90; k++) {
    const x = rr(-500, 1300);
    const z = rr(430, 1150);
    if (!isSea(x, z, 3) || seaSignedDistance(x, z) < 40) continue;
    if (overlaps(x, z, 18)) continue;
    footprints.push({ x, z, r: 18 });
    const list = rnd() < 0.45 ? sails : yachts;
    list.push({ x, z, yaw: rnd() * Math.PI * 2, s: rr(0.9, 2.2), ph: rnd() * 6.28 });
  }
  const yachtMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const yachtMesh = makeInstanced(motorYachtGeometry(), yachtMat, yachts, () => {});
  const sailMesh = makeInstanced(sailboatGeometry(), yachtMat, sails, () => {});
  yachtMesh.name = 'yachts';
  sailMesh.name = 'sailboats';
  group.add(yachtMesh, sailMesh);
  const boatSets = [[yachtMesh, yachts], [sailMesh, sails]];
  const updateBoats = (t) => {
    for (const [mesh, list] of boatSets) {
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        e.set(Math.sin(t * 0.6 + b.ph * 1.3) * 0.015, b.yaw, Math.sin(t * 0.8 + b.ph) * 0.03);
        q.setFromEuler(e);
        m4.compose(p.set(b.x, SEA_LEVEL + Math.sin(t * 0.9 + b.ph) * 0.12, b.z), q, sc.setScalar(b.s));
        mesh.setMatrixAt(i, m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  updateBoats(0);
  yachtMesh.computeBoundingSphere();
  sailMesh.computeBoundingSphere();

  // ---------------- Ağaçlar, çalılar, kayalar
  const cypress = [];
  const pines = [];
  const bushes = [];
  const rocks = [];
  const near = { x: 0, z: 0 };
  for (let k = 0; k < 11000; k++) {
    let x;
    let z;
    if (k % 2 === 0) {
      // Pist yakını (kameranın gördüğü yer)
      const f = frameAt(track, rnd() * L, near);
      const l = (rnd() < 0.5 ? -1 : 1) * rr(20, 130);
      x = f.x + f.rx * l;
      z = f.z + f.rz * l;
    } else {
      x = rr(-1100, 1150);
      z = rr(-750, 520);
    }
    const g = ground(x, z);
    if (g < SEA_LEVEL + 1.2) continue;
    const cm = cityMask(x, z);
    const d = dist(x, z);
    const slope = terrain.slopeAt(x, z);
    const sd = seaSignedDistance(x, z);
    // Kayalar: dik yamaçlar ve kıyı
    if ((slope < 0.72 || (sd > -35 && sd < 5)) && d > 16 && rocks.length < 460 * density && rnd() < 0.6) {
      const rs = rr(1.5, 4.5);
      // Dik yamaçta kaya havada kalmasın: eğime göre göm
      const sink = rs * Math.min(1.1, 0.25 + (1 - slope) * 2.2);
      rocks.push({ x, y: g - sink, z, yaw: rnd() * 6.28, sx: rs * rr(0.8, 1.3), sy: rs * rr(0.7, 1.1), sz: rs * rr(0.8, 1.3) });
      continue;
    }
    if (cm > 0.35 || slope < 0.72 || d < 17) continue;
    if (overlaps(x, z, 2.5)) continue;
    const r = rnd();
    if (r < 0.12 && cypress.length < 300 * density) cypress.push({ x, y: g - 0.2, z, yaw: rnd() * 6.28, sx: rr(7, 10), sy: rr(11, 17), sz: rr(7, 10) });
    else if (r < 0.24 && pines.length < 260 * density) pines.push({ x, y: g - 0.3, z, yaw: rnd() * 6.28, sx: rr(10, 15), sy: rr(10, 15), sz: rr(10, 15) });
    else if (bushes.length < 900 * density) bushes.push({ x, y: g - 0.2, z, yaw: rnd() * 6.28, sx: rr(2, 5), sy: rr(1.5, 3), sz: rr(2, 5) });
  }
  // Villaların yanına selviler
  for (const v of villas) {
    for (let k = 0; k < 2; k++) {
      const a = rnd() * 6.28;
      const x = v.x + Math.cos(a) * (Math.max(v.w, v.d) * 0.6 + 3);
      const z = v.z + Math.sin(a) * (Math.max(v.w, v.d) * 0.6 + 3);
      if (dist(x, z) < 17 || ground(x, z) < 1) continue;
      cypress.push({ x, y: ground(x, z) - 0.2, z, yaw: 0, sx: rr(7, 9), sy: rr(12, 16), sz: rr(7, 9) });
    }
  }
  // Tırmanışın iç (sol) yanındaki yarma: kaya blokları
  for (let s = sec.climb.s0 + 10; s < sec.descent.s0; s += 7) {
    const f = frameAt(track, s);
    for (const side of [-1, 1]) {
      const l = side * rr(19, 23);
      const x = f.x + f.rx * l;
      const z = f.z + f.rz * l;
      const g = ground(x, z);
      if (g - f.y < 2.5 || dist(x, z) < 16.5) continue;
      const rs = rr(3, 6.5);
      const sl = terrain.slopeAt(x, z);
      rocks.push({ x, y: g - rs * Math.min(1.1, 0.3 + (1 - sl) * 2.2), z, yaw: rnd() * 6.28, sx: rs * rr(0.8, 1.3), sy: rs * rr(0.8, 1.2), sz: rs * rr(0.8, 1.3) });
    }
  }
  const generic = (it, mm) => {
    e.set(0, it.yaw, 0);
    q.setFromEuler(e);
    mm.compose(p.set(it.x, it.y, it.z), q, sc.set(it.sx, it.sy, it.sz));
  };
  const foliage = new THREE.MeshLambertMaterial({ vertexColors: true });
  const cypMesh = makeInstanced(cypressGeometry(), foliage, cypress, generic);
  const pineMesh = makeInstanced(pineGeometry(), foliage, pines, generic);
  const bushMesh = makeInstanced(bushGeometry(), foliage, bushes, generic);
  const rockMesh = makeInstanced(rockGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), rocks, generic);
  // Ağaçlar yoldan uzakta: gölge geçişine girmesinler (tüm örnekler gölge haritasına çizilirdi)
  cypMesh.receiveShadow = true;
  pineMesh.receiveShadow = true;
  cypMesh.name = 'cypress';
  pineMesh.name = 'pines';
  bushMesh.name = 'bushes';
  rockMesh.name = 'rocks';
  group.add(cypMesh, pineMesh, bushMesh, rockMesh);

  // ---------------- Deniz feneri ve uzak adalar
  let lh = null;
  for (let k = 0; k < 400 && !lh; k++) {
    const x = 905 + rr(-60, 40);
    const z = 330 + rr(-60, 60);
    if (ground(x, z) > 1.5 && dist(x, z) > 30 && seaSignedDistance(x, z) > -40 && !overlaps(x, z, 5)) lh = { x, z };
  }
  if (lh) {
    const lg = lighthouseGeometry();
    lg.translate(lh.x, ground(lh.x, lh.z) - 0.5, lh.z);
    const lMesh = new THREE.Mesh(lg, new THREE.MeshLambertMaterial({ vertexColors: true }));
    lMesh.castShadow = true;
    lMesh.name = 'lighthouse';
    group.add(lMesh);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4, 2.4) }));
    lamp.position.set(lh.x, ground(lh.x, lh.z) - 0.5 + 19.6, lh.z);
    lamp.name = 'lighthouse-lamp';
    group.add(lamp);
  }
  const islandParts = [];
  for (const [x, z, r, h] of [[-2700, 1700, 520, 190], [-1500, 2700, 380, 120], [-3600, 900, 700, 260], [1900, 2600, 600, 150]]) {
    const g = new THREE.ConeGeometry(r, h, 18, 3);
    const pos = g.attributes.position;
    const rn = mulberry32(Math.abs(x));
    for (let i = 0; i < pos.count; i++) {
      const k = 1 + (rn() - 0.5) * 0.25;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * (0.8 + rn() * 0.3), pos.getZ(i) * k * 0.6);
    }
    g.computeVertexNormals();
    g.translate(x, SEA_LEVEL + h / 2 - 8, z);
    islandParts.push(clean(colorize(g, 0x4a4a5a)));
  }
  const islands = new THREE.Mesh(mergeGeometries(islandParts, false), new THREE.MeshLambertMaterial({ vertexColors: true }));
  islands.name = 'islands';
  group.add(islands);

  return {
    group,
    buildings,
    update(dt, time) {
      flagUniforms.uTime.value = time;
      if (dt > 0) updateBoats(time);
    },
  };
}

function makeInstanced(geo, mat, list, setMatrix) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4();
  list.forEach((it, i) => {
    setMatrix(it, m);
    mesh.setMatrixAt(i, m);
  });
  mesh.count = list.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
