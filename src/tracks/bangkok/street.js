// Sokak düzeyi: kaldırımlar, sokak lambaları, park etmiş tuk-tuk'lar, fenerli sokak yemeği tezgâhları,
// pazar tenteleri, yolun üstünden geçen fener dizileri ve ıslak yoldaki ışık yansıma çizgileri.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  colorize, clean, lampPoleGeometry, lampBulbGeometry,
} from '../../track/models.js';
import { GROUND_Y } from './context.js';
import {
  sidewalkTexture, streakTexture, awningTexture, softGlowTexture,
} from './textures.js';

const LAMP_COLOR = new THREE.Color(1.0, 0.62, 0.3);

function makeInstanced(geo, mat, list, setMatrix) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4();
  list.forEach((it, i) => {
    setMatrix(it, m);
    mesh.setMatrixAt(i, m);
    if (it.color) mesh.setColorAt(i, it.color);
  });
  mesh.count = list.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
function placeYaw(it, m) {
  _e.set(0, it.yaw, 0);
  _q.setFromEuler(_e);
  m.compose(_p.set(it.x, it.y, it.z), _q, _s.setScalar(it.scale || 1));
}

/** Tuk-tuk: arka kabin + kanopi, öne tek tekerlek. Burun +z. Gövde beyaz köşe rengi → örnek rengiyle boyanır. */
function tukTukGeometry() {
  const parts = [];
  const body = 0xffffff;
  const dark = 0x1a1a1e;
  const add = (g, c, x, y, z) => { colorize(g, c); g.translate(x, y, z); parts.push(clean(g)); };
  add(new THREE.BoxGeometry(1.4, 0.55, 1.6), body, 0, 0.62, -0.5); // arka koltuk tabanı
  add(new THREE.BoxGeometry(1.4, 0.7, 0.2), body, 0, 1.15, -1.25); // arka sırt
  add(new THREE.BoxGeometry(0.8, 0.5, 1.1), body, 0, 0.65, 0.75); // ön gövde
  add(new THREE.BoxGeometry(1.52, 0.08, 2.5), body, 0, 2.0, -0.2); // kanopi
  add(new THREE.BoxGeometry(1.5, 0.12, 0.12), 0xd8b040, 0, 1.92, 1.05); // altın kenar
  for (const sx of [-0.7, 0.7]) add(new THREE.BoxGeometry(0.06, 1.3, 0.06), dark, sx, 1.35, 1.0);
  for (const sx of [-0.7, 0.7]) add(new THREE.BoxGeometry(0.06, 1.1, 0.06), dark, sx, 1.45, -1.3);
  add(new THREE.BoxGeometry(0.9, 0.5, 0.06), 0x99b0c0, 0, 1.3, 1.05); // ön cam
  for (const [x, z] of [[-0.7, -0.9], [0.7, -0.9], [0, 1.15]]) {
    const w = new THREE.CylinderGeometry(0.28, 0.28, 0.18, 10);
    w.rotateZ(Math.PI / 2);
    add(w, dark, x, 0.28, z);
  }
  return mergeGeometries(parts, false);
}

/** Sokak yemeği tezgâhı: tezgâh + şemsiye. Burun +z (yola bakar). */
function stallGeometry() {
  const parts = [];
  const add = (g, c, x, y, z) => { colorize(g, c); g.translate(x, y, z); parts.push(clean(g)); };
  add(new THREE.BoxGeometry(2.0, 0.9, 1.0), 0xb0b4b8, 0, 0.45, 0); // paslanmaz gövde
  add(new THREE.BoxGeometry(2.1, 0.08, 1.1), 0xd8d8d8, 0, 0.94, 0);
  add(new THREE.BoxGeometry(0.6, 0.35, 0.5), 0x6a4a30, -0.5, 1.15, 0); // tencere/ızgara
  add(new THREE.BoxGeometry(0.7, 0.45, 0.6), 0xa8d8e8, 0.45, 1.2, -0.1); // cam vitrin
  add(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), 0x303030, 0, 1.1, -0.45); // şemsiye direği
  const u = new THREE.ConeGeometry(1.7, 0.6, 8, 1, true);
  add(u, 0xffffff, 0, 2.3, -0.45);
  // Plastik tabureler
  for (const x of [-0.8, 0.1, 0.9]) add(new THREE.CylinderGeometry(0.17, 0.15, 0.45, 6), 0xd02828, x, 0.22, 1.0);
  return mergeGeometries(parts, false);
}

/** Pazar tentesi: eğimli şeritli bez + iki ön direk. Genişlik 1 (x), derinlik 3 (z, yol tarafı +z). */
function awningGeometry() {
  const g = new THREE.PlaneGeometry(1, 3.2, 1, 1);
  g.rotateX(-Math.PI / 2 + 0.32);
  g.translate(0, 3.0, 1.2);
  return g;
}

export function buildStreet(ctx) {
  const { track, group, rnd, rr, sec } = ctx;
  const W2 = ctx.W2;
  const f = {};
  const L = track.length;
  const inSec = (s, ...ids) => ids.includes(track.sectionAt(s));
  const elevated = (s) => track.centerHeight(s) > GROUND_Y + 1.6;

  // ---------------- Kaldırımlar (her iki yan; nehir tarafında kıyı rıhtımına kadar)
  const walkPos = [];
  const walkUv = [];
  const walkIdx = [];
  for (const side of [-1, 1]) {
    let prev = null;
    for (let s = 0; s <= L; s += 4) {
      ctx.frame(s, f);
      if (elevated(s)) { prev = null; continue; }
      const river = inSec(s, 'river') && side < 0;
      const out = river ? 15.5 : 17;
      const y = f.y + 0.14;
      const lats = [side * (W2 + 0.62), side * out, side * out];
      const ys = [y, y, river ? -1.6 : GROUND_Y - 0.2];
      const row = [];
      for (let k = 0; k < 3; k++) {
        row.push(walkPos.length / 3);
        const x = f.x + f.rx * lats[k];
        const z = f.z + f.rz * lats[k];
        walkPos.push(x, ys[k], z);
        walkUv.push(x / 2, z / 2 + (k === 2 ? 0.2 : 0));
      }
      if (prev) {
        for (let k = 0; k < 2; k++) {
          const a = prev[k]; const b = prev[k + 1]; const a2 = row[k]; const b2 = row[k + 1];
          if (side > 0) walkIdx.push(a, b, a2, b, b2, a2); else walkIdx.push(a, a2, b, b, a2, b2);
        }
      }
      prev = row;
    }
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(walkPos, 3));
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(walkUv, 2));
  wg.setIndex(walkIdx);
  wg.computeVertexNormals();
  const walk = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ map: sidewalkTexture(), roughness: 0.42, metalness: 0 }));
  walk.receiveShadow = true;
  walk.name = 'sidewalks';
  group.add(walk);

  // ---------------- Sokak lambaları (sodyum)
  const lamps = [];
  const addLamp = (s, side, lat = 12.2) => {
    ctx.frame(s, f);
    const l = side * lat;
    const x = f.x + f.rx * l;
    const z = f.z + f.rz * l;
    lamps.push({ x, y: f.y + 0.14, z, yaw: side > 0 ? f.yaw : f.yaw + Math.PI });
    // Ampul konumu (kolun ucu yola doğru ~1.85 m) ve ışık lekesi/yansıma
    const bl = side * (lat - 1.85);
    const spot = ctx.addLightSpot(f.x + f.rx * bl, f.y + 7.7, f.z + f.rz * bl, 0xffa050, 0.9);
    if (spot) spot.fromLamp = true;
    ctx.streaks.push({ s, lateral: THREE.MathUtils.clamp(bl, -8.5, 8.5), len: 22, width: 1.6, color: LAMP_COLOR.clone().multiplyScalar(0.55) });
  };
  for (let s = 6; s < L; s += 34) {
    const id = track.sectionAt(s);
    if (Math.abs(s) < 14 || Math.abs(s - L) < 14) continue;
    if (id === 'chinatown') continue; // fenerler var
    if (elevated(s)) continue; // otoyolda ayrı (aşağıda)
    const side = Math.round(s / 34) % 2 === 0 ? 1 : -1;
    if (id === 'river' && side < 0) { addLamp(s, -1, 13.2); continue; }
    addLamp(s, side);
  }
  for (const sp of ctx.expresswayLamps || []) addLamp(sp.s, sp.side, 11.8);
  const lampMesh = makeInstanced(lampPoleGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), lamps, placeYaw);
  lampMesh.castShadow = true;
  lampMesh.name = 'lamp-poles';
  group.add(lampMesh);
  const bulbMesh = makeInstanced(lampBulbGeometry(), new THREE.MeshBasicMaterial({ color: new THREE.Color(5.0, 3.0, 1.4) }), lamps, placeYaw);
  bulbMesh.name = 'lamp-bulbs';
  group.add(bulbMesh);

  // ---------------- Tuk-tuk'lar (kaldırım kenarında 2-3'lü gruplar)
  const tuks = [];
  const tukCols = [0x1fa84a, 0x2a6ad8, 0xe8c020, 0xd02828, 0xe86a18, 0x1aa8b0, 0xc83aa0];
  for (let s = 40; s < L; s += rr(70, 130)) {
    const id = track.sectionAt(s);
    if (elevated(s) || id === 'river') continue;
    const side = rnd() < 0.5 ? -1 : 1;
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const ss = s + k * 3.6;
      ctx.frame(ss, f);
      const lat = side * 14.0;
      const x = f.x + f.rx * lat;
      const z = f.z + f.rz * lat;
      if (ctx.overlaps(x, z, 1.5)) continue;
      ctx.reserve(x, z, 1.6);
      tuks.push({ x, y: f.y + 0.14, z, yaw: f.yaw + (rnd() < 0.8 ? 0 : Math.PI) + (rnd() - 0.5) * 0.2, color: new THREE.Color(tukCols[Math.floor(rnd() * tukCols.length)]) });
    }
  }
  const tukMesh = makeInstanced(tukTukGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), tuks, placeYaw);
  tukMesh.castShadow = true;
  tukMesh.name = 'tuk-tuks';
  group.add(tukMesh);

  // ---------------- Sokak yemeği tezgâhları + fenerler (ampul + parıltı)
  const stalls = [];
  const bulbs = [];
  const umbrellaCols = [0xd83030, 0x2a7ad8, 0xe8c030, 0x30a050, 0xf08030, 0xe8e8e8];
  const addStall = (s, side, lat) => {
    ctx.frame(s, f);
    const l = side * lat;
    const x = f.x + f.rx * l;
    const z = f.z + f.rz * l;
    if (ctx.overlaps(x, z, 1.4)) return;
    ctx.reserve(x, z, 1.5);
    const yaw = f.yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2); // yerel +z yola bakar
    stalls.push({ x, y: f.y + 0.14, z, yaw, color: new THREE.Color(umbrellaCols[Math.floor(rnd() * umbrellaCols.length)]) });
    // Şemsiye altına asılı ampul (dünya konumu)
    const bx = x + Math.sin(yaw) * -0.45;
    const bz = z + Math.cos(yaw) * -0.45;
    const warm = rnd() < 0.75;
    const bc = warm ? new THREE.Color(2.4, 1.4, 0.55) : new THREE.Color(1.3, 1.9, 1.6);
    bulbs.push({ x: bx, y: f.y + 0.14 + 1.85, z: bz, yaw: 0, color: bc });
    ctx.glows.push({ x: bx, y: f.y + 0.14 + 1.85, z: bz, color: bc.clone().multiplyScalar(0.09) });
    if (rnd() < 0.35) ctx.streaks.push({ s, lateral: side * 8.6, len: 12, width: 1.1, color: new THREE.Color(warm ? 0.6 : 0.4, warm ? 0.38 : 0.55, warm ? 0.18 : 0.5) });
  };
  for (let s = sec.chinatown.s0 + 8; s < sec.sukhumvit.s0 - 20; s += rr(7, 12)) addStall(s, rnd() < 0.5 ? -1 : 1, rr(13.2, 14.6));
  for (let s = sec.silom.s0 + 30; s < sec.expressway.s0 + 40; s += rr(16, 30)) addStall(s, rnd() < 0.5 ? -1 : 1, rr(13.5, 15));
  for (let s = sec.sukhumvit.s0 + 40; s < L + sec.silom.s0 - 30; s += rr(30, 50)) {
    if (Math.abs(track.wrap(s) - 0) < 20) continue;
    addStall(s, rnd() < 0.5 ? -1 : 1, rr(14, 15.5));
  }
  const stallMesh = makeInstanced(stallGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x2a1a0a }), stalls, placeYaw);
  stallMesh.castShadow = true;
  stallMesh.name = 'food-stalls';
  group.add(stallMesh);
  const bulbGeo = new THREE.SphereGeometry(0.13, 8, 6);
  const stallBulbs = makeInstanced(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbs, placeYaw);
  stallBulbs.name = 'stall-bulbs';
  group.add(stallBulbs);

  // ---------------- Pazar tenteleri (Chinatown'da sürekli sıra)
  const awnings = [];
  const awnCols = [[0.85, 0.12, 0.1], [0.12, 0.3, 0.8], [0.9, 0.45, 0.08], [0.1, 0.55, 0.25], [0.85, 0.7, 0.1], [0.55, 0.15, 0.6]];
  for (const side of [-1, 1]) {
    for (let s = sec.chinatown.s0 + 6; s < sec.sukhumvit.s0 - 24; s += 3.4) {
      if (rnd() < 0.18) continue;
      ctx.frame(s, f);
      const lat = side * 16.4;
      const c = awnCols[Math.floor(rnd() * awnCols.length)];
      const k = rr(0.26, 0.46);
      awnings.push({
        x: f.x + f.rx * lat, y: f.y + 0.14, z: f.z + f.rz * lat,
        yaw: f.yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2), w: rr(3.0, 3.6),
        color: new THREE.Color(c[0] * k, c[1] * k, c[2] * k),
      });
    }
  }
  const awnMesh = makeInstanced(awningGeometry(), new THREE.MeshBasicMaterial({ map: awningTexture(), side: THREE.DoubleSide }), awnings, (it, m) => {
    _e.set(0, it.yaw, 0);
    _q.setFromEuler(_e);
    m.compose(_p.set(it.x, it.y, it.z), _q, _s.set(it.w, 1, 1));
  });
  awnMesh.name = 'market-awnings';
  group.add(awnMesh);

  // ---------------- Fener dizileri (yolun üstünden, Chinatown)
  const lanterns = [];
  const wirePos = [];
  for (let s = sec.chinatown.s0 + 10; s < sec.sukhumvit.s0 - 20; s += 13) {
    ctx.frame(s, f);
    const y0 = f.y + 9.6;
    const N = 18;
    let prev = null;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const lat = -16.4 + 32.8 * t;
      const sag = 1.5 * 4 * t * (1 - t);
      const p = [f.x + f.rx * lat, y0 - sag, f.z + f.rz * lat];
      if (prev) wirePos.push(...prev, ...p);
      prev = p;
      if (k % 2 === 1) {
        lanterns.push({ x: p[0], y: p[1] - 0.75, z: p[2], yaw: f.yaw, scale: rr(0.9, 1.1) });
        if (k % 4 === 1) ctx.glows.push({ x: p[0], y: p[1] - 0.75, z: p[2], color: new THREE.Color(0.28, 0.04, 0.015) });
      }
    }
    // Yansıma: fener dizisinin altında kırmızı parıltı
    if (rnd() < 0.5) ctx.streaks.push({ s, lateral: rr(-4, 4), len: 16, width: 3.2, color: new THREE.Color(0.45, 0.05, 0.03) });
  }
  const lanternGeo = new THREE.SphereGeometry(0.32, 10, 8);
  lanternGeo.scale(1, 1.25, 1);
  const lanternMesh = makeInstanced(lanternGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.09, 0.035) }), lanterns, placeYaw);
  lanternMesh.name = 'lanterns';
  group.add(lanternMesh);
  if (wirePos.length) {
    const wg2 = new THREE.BufferGeometry();
    wg2.setAttribute('position', new THREE.Float32BufferAttribute(wirePos, 3));
    const wires = new THREE.LineSegments(wg2, new THREE.LineBasicMaterial({ color: 0x141418 }));
    wires.name = 'lantern-wires';
    group.add(wires);
  }
  // Fener bölgesinde gerçek ışık noktaları (kırmızı)
  for (let s = sec.chinatown.s0 + 30; s < sec.sukhumvit.s0 - 20; s += 45) {
    ctx.frame(s, f);
    const spot = ctx.addLightSpot(f.x, f.y + 7.5, f.z, 0xff5a30, 0.6);
    if (spot) spot.fromLamp = true;
  }

  // ---------------- Nehir kıyısı korkuluğu (sol yan, kaldırımın dış kenarı)
  const railParts = [];
  const railLights = [];
  {
    let s = sec.river.s0 + 10;
    while (s < sec.river.s1 - 10) {
      ctx.frame(s, f);
      const lat = -15.2;
      const x = f.x + f.rx * lat;
      const z = f.z + f.rz * lat;
      const post = colorize(new THREE.BoxGeometry(0.25, 1.1, 0.25), 0xd8d4c8);
      post.translate(x, f.y + 0.14 + 0.55, z);
      railParts.push(clean(post));
      if (Math.round(s) % 24 < 3) {
        railLights.push({ x, y: f.y + 0.14 + 1.3, z, yaw: 0 });
        ctx.glows.push({ x, y: f.y + 0.14 + 1.3, z, color: new THREE.Color(0.35, 0.25, 0.12) });
      }
      s += 3;
    }
    // Üst tırabzan: sürekli şerit
    const pos = [];
    const idx = [];
    for (let s2 = sec.river.s0 + 10; s2 < sec.river.s1 - 10; s2 += 6) {
      ctx.frame(s2, f);
      const base = pos.length / 3;
      for (const [lat, dy] of [[-15.05, 1.12], [-15.35, 1.12], [-15.35, 0.98], [-15.05, 0.98]]) {
        pos.push(f.x + f.rx * lat, f.y + 0.14 + dy, f.z + f.rz * lat);
      }
      if (base > 0) {
        for (let k = 0; k < 4; k++) {
          const a = base - 4 + k; const b = base - 4 + ((k + 1) % 4); const a2 = base + k; const b2 = base + ((k + 1) % 4);
          idx.push(a, a2, b, b, a2, b2);
        }
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rg.setIndex(idx);
    rg.computeVertexNormals();
    const rail = colorize(rg, 0xd8d4c8);
    railParts.push(clean(rail));
  }
  if (railParts.length) {
    const railMesh = new THREE.Mesh(mergeGeometries(railParts, false), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    railMesh.name = 'river-railing';
    group.add(railMesh);
    const rl = makeInstanced(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3, 1.8) }), railLights, placeYaw);
    rl.name = 'river-railing-lights';
    group.add(rl);
  }

  // ---------------- Islak yol yansımaları: ışık noktalarından (tabelalar) yansıma çizgileri + birleşik mesh
  for (const sp of ctx.lightSpots) {
    if (sp.fromLamp) continue;
    const pr = track.project(_p.set(sp.x, sp.y, sp.z));
    if (Math.abs(pr.lateral) > 26) continue;
    ctx.streaks.push({
      s: pr.s, lateral: THREE.MathUtils.clamp(pr.lateral * 0.75, -8.8, 8.8), len: 18 + rnd() * 8, width: 2.2,
      color: sp.color.clone().multiplyScalar(0.55 * sp.strength),
    });
  }
  buildStreaks(ctx);
  buildGlows(ctx);
}

/** Küçük ışıkların hâlesi: tek Points nesnesi (additive yumuşak sprite). */
function buildGlows(ctx) {
  if (!ctx.glows.length) return;
  const pos = new Float32Array(ctx.glows.length * 3);
  const col = new Float32Array(ctx.glows.length * 3);
  ctx.glows.forEach((g, i) => {
    pos.set([g.x, g.y, g.z], i * 3);
    col.set([g.color.r, g.color.g, g.color.b], i * 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    map: softGlowTexture(), size: 2.4, sizeAttenuation: true, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'small-glows';
  ctx.group.add(pts);
}

/** Islak yoldaki uzun ışık yansımaları: yola yatık additive şeritler (gelen sürücü tarafına uzanır). */
function buildStreaks(ctx) {
  const { track, group } = ctx;
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  const smp = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
  for (const st of ctx.streaks) {
    const n = 6;
    const base = pos.length / 3;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      // v=0 ışığın dibi (s'nin biraz ilerisi), v=1 sürücüye yakın uç (s - len)
      const s = st.s + 2 - t * st.len;
      track.sample(s, smp);
      for (const side of [-1, 1]) {
        const lat = st.lateral + side * st.width * 0.5;
        const y = track.heightAt(s, lat) + 0.045;
        pos.push(smp.pos.x + smp.right.x * lat, y, smp.pos.z + smp.right.z * lat);
        uv.push(side < 0 ? 0 : 1, t);
        col.push(st.color.r, st.color.g, st.color.b);
      }
    }
    for (let k = 0; k < n; k++) {
      const a = base + k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  if (!pos.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({
    map: streakTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 2;
  mesh.name = 'wet-reflections';
  group.add(mesh);
}

