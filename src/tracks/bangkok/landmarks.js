// Simge yapılar: BTS skytrain viyadüğü + istasyon + hareketli trenler, yükseltilmiş otoyolun tabliyesi ve
// ayakları, altın kuleli tapınak (Wat Arun'u andıran, birebir kopya değil) ve start kapısı.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colorize, clean } from '../../track/models.js';
import { GROUND_Y } from './context.js';
import { BTS_LINE, RIVER } from './layout.js';
import { trainTextures, stationTexture, bkkGantryTexture, softGlowTexture } from './textures.js';

const Y = new THREE.Vector3(0, 1, 0);

function box(w, h, d, color, x, y, z) {
  const g = colorize(new THREE.BoxGeometry(w, h, d), color);
  g.translate(x, y, z);
  return clean(g);
}

// ---------------------------------------------------------------------------------------------
// BTS viyadüğü (z = BTS_LINE.z boyunca doğu-batı)

export function buildBts(ctx) {
  const { track, group } = ctx;
  const z0 = BTS_LINE.z;
  const roadY = track.centerHeight(0);
  const deckBottom = roadY + BTS_LINE.deckBottom; // yoldan ≥ 9 m yukarıda
  const DECK_T = 1.7;
  const deckTop = deckBottom + DECK_T;
  const parts = [];
  const concrete = 0x8c8a88;
  const dark = 0x4a4a50;
  // Tabliye: 10 m genişlik, iki yanda korkuluk
  const len = BTS_LINE.x1 - BTS_LINE.x0;
  const cx = (BTS_LINE.x0 + BTS_LINE.x1) / 2;
  parts.push(box(len, DECK_T, 10, concrete, cx, deckBottom + DECK_T / 2, z0));
  for (const side of [-1, 1]) parts.push(box(len, 1.1, 0.3, 0xa8a6a2, cx, deckTop + 0.55, z0 + side * 4.85));
  // Raylar (koyu)
  for (const zz of [-2.6, -1.1, 1.1, 2.6]) parts.push(box(len, 0.2, 0.25, 0x303034, cx, deckTop + 0.1, z0 + zz));
  // Ayaklar: yol altındaysa kapı (portal) çerçeve, değilse tek kolon + T başlık
  for (let x = BTS_LINE.x0 + 10; x < BTS_LINE.x1 - 5; x += 36) {
    const dRoad = ctx.dist(x, z0);
    if (ctx.isWater(x, z0, 10)) continue;
    if (dRoad > 13) {
      parts.push(box(2.0, deckBottom - GROUND_Y, 2.0, concrete, x, (deckBottom + GROUND_Y) / 2, z0));
      parts.push(box(2.4, 1.4, 9.0, concrete, x, deckBottom - 0.7, z0));
      ctx.reserve(x, z0, 2);
    } else {
      // Yolun iki yanında (bariyerin dışında) bacaklar, üstte kiriş
      const pr = track.project(new THREE.Vector3(x, roadY, z0));
      if (Math.abs(pr.lateral) > 3) continue; // köşe bölgesi: atla
      for (const side of [-1, 1]) {
        parts.push(box(1.6, deckBottom - GROUND_Y, 1.6, concrete, x, (deckBottom + GROUND_Y) / 2, z0 + side * 14.2));
      }
      parts.push(box(1.8, 1.5, 30.0, concrete, x, deckBottom - 0.75, z0));
    }
  }
  const deckGeo = mergeGeometries(parts, false);
  const deck = new THREE.Mesh(deckGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  deck.castShadow = true;
  deck.receiveShadow = true;
  deck.name = 'bts-viaduct';
  group.add(deck);

  // Alt yüzde lamba şeridi (yolu hafif aydınlatan görüntü + yansıma)
  const lampParts = [];
  for (let x = BTS_LINE.x0 + 6; x < BTS_LINE.x1; x += 12) {
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(1.4, 0.06, 0.2);
      g.translate(x, deckBottom - 0.04, z0 + side * 3.6);
      lampParts.push(g);
    }
  }
  const lamps = new THREE.Mesh(mergeGeometries(lampParts, false), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 1.05, 0.95) }));
  lamps.name = 'bts-underlights';
  group.add(lamps);

  // İstasyon (yolun üstünde, x 40..160)
  const st = { x0: 40, x1: 160 };
  const stLen = st.x1 - st.x0;
  const scx = (st.x0 + st.x1) / 2;
  const stY0 = deckBottom - 0.2;
  const stH = 7.2;
  const facade = new THREE.BoxGeometry(stLen, stH, 26);
  facade.translate(scx, stY0 + stH / 2, z0);
  // Yalnız yan yüzlerde doku; uv'leri metreye ölçekle
  const uv = facade.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (stLen / 16), uv.getY(i));
  const roof = new THREE.CylinderGeometry(15, 15, stLen + 4, 24, 1, false, -Math.PI / 2 + 0.75, Math.PI - 1.5);
  roof.rotateZ(Math.PI / 2);
  roof.scale(1, 0.35, 1);
  roof.translate(scx, stY0 + stH - 2.2, z0);
  const stMat = new THREE.MeshLambertMaterial({ map: stationTexture() });
  const stMesh = new THREE.Mesh(facade, stMat);
  stMesh.castShadow = true;
  stMesh.name = 'bts-station';
  group.add(stMesh);
  // İstasyonun ışıklı cam bandı (emissive şerit iki yüzde)
  const glow = [];
  for (const side of [-1, 1]) {
    const g = new THREE.PlaneGeometry(stLen - 2, 1.4);
    if (side < 0) g.rotateY(Math.PI);
    g.translate(scx, stY0 + stH - 2.6, z0 + side * 13.05);
    glow.push(g);
  }
  const glowMesh = new THREE.Mesh(mergeGeometries(glow, false), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.85, 0.95) }));
  glowMesh.name = 'bts-station-glass';
  group.add(glowMesh);
  const roofMesh = new THREE.Mesh(roof, new THREE.MeshLambertMaterial({ color: 0x5a6068, side: THREE.DoubleSide }));
  roofMesh.castShadow = true;
  roofMesh.name = 'bts-station-roof';
  group.add(roofMesh);
  for (let x = st.x0; x <= st.x1; x += 30) ctx.addLightSpot(x, deckBottom - 1, z0, 0xdfe8ff, 0.7);

  // Trenler: 2 dizi x 4 vagon (tek InstancedMesh)
  const tex = trainTextures();
  const carGeo = new THREE.BoxGeometry(3.1, 3.6, 21.5);
  // Yan yüzlere doku (0..1); ön/arka/üst yüzleri koyu bölgeye yaklaştır
  const cuv = carGeo.attributes.uv;
  const cn = carGeo.attributes.normal;
  for (let i = 0; i < cuv.count; i++) {
    if (Math.abs(cn.getX(i)) < 0.5) cuv.setXY(i, 0.02, 0.5);
  }
  carGeo.translate(0, 1.8 + 0.45, 0);
  const carMat = new THREE.MeshLambertMaterial({ map: tex.map, emissiveMap: tex.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.6 });
  const CARS = 4;
  const trains = [
    { lane: -1.85, dir: 1, speed: 19, pos: -300 },
    { lane: 1.85, dir: -1, speed: 21, pos: 600 },
  ];
  const trainMesh = new THREE.InstancedMesh(carGeo, carMat, trains.length * CARS);
  trainMesh.castShadow = true;
  trainMesh.name = 'bts-trains';
  trainMesh.frustumCulled = false;
  group.add(trainMesh);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const span = len - 60;
  const update = (dt) => {
    let i = 0;
    for (const t of trains) {
      t.pos += t.dir * t.speed * dt;
      if (t.pos > BTS_LINE.x1 - 30) t.dir = -1;
      if (t.pos < BTS_LINE.x0 + 30) t.dir = 1;
      // İstasyonda yavaşla
      const nearSt = t.pos > st.x0 - 80 && t.pos < st.x1 + 80;
      t.speed = nearSt ? 9 : 21;
      q.setFromAxisAngle(Y, Math.PI / 2);
      for (let k = 0; k < CARS; k++) {
        const x = t.pos - t.dir * k * 22;
        m4.compose(p.set(x, deckTop, z0 + t.lane), q, sc);
        trainMesh.setMatrixAt(i++, m4);
      }
    }
    trainMesh.instanceMatrix.needsUpdate = true;
  };
  void span;
  update(0);
  return { update, deckBottom };
}

// ---------------------------------------------------------------------------------------------
// Otoyol tabliyesi: yol yerden yüksekte olduğu yerde kutu kiriş + yan cephe LED şeridi + ayaklar

export function buildExpressway(ctx) {
  const { track, group } = ctx;
  const W = 12.6; // tabliye yarı genişliği (bariyer dışı + lamba direkleri)
  const ds = 4;
  const sec = ctx.sec.expressway;
  const pos = [];
  const idx = [];
  const ledPos = [];
  const ledIdx = [];
  const f = {};
  let prevRow = null;
  let prevLed = null;
  const pierParts = [];
  const lampSpots = [];
  for (let s = sec.s0; s <= sec.s1 + 60; s += ds) {
    ctx.frame(s, f);
    const y = f.y;
    if (y < GROUND_Y + 1.6) { prevRow = null; prevLed = null; continue; }
    const bottom = Math.max(GROUND_Y - 0.2, y - 2.6);
    // Profil: sol üst → sol alt → sağ alt → sağ üst (kenarlar: bariyer altından başlar)
    const prof = [[-W, y - 0.35], [-W, y - 1.1], [-W + 2.2, bottom], [W - 2.2, bottom], [W, y - 1.1], [W, y - 0.35]];
    const row = [];
    for (const [lat, hy] of prof) {
      row.push(pos.length / 3);
      pos.push(f.x + f.rx * lat, hy, f.z + f.rz * lat);
    }
    // Üst kenar dolgu (bariyer dışından tabliye kenarına): yatay şerit
    const tl = [[-W, y - 0.35], [-10.6, y - 0.35]];
    const tr = [[10.6, y - 0.35], [W, y - 0.35]];
    for (const [lat, hy] of [...tl, ...tr]) {
      row.push(pos.length / 3);
      pos.push(f.x + f.rx * lat, hy, f.z + f.rz * lat);
    }
    if (prevRow) {
      for (let c = 0; c < 5; c++) {
        const a = prevRow[c]; const b = prevRow[c + 1]; const a2 = row[c]; const b2 = row[c + 1];
        idx.push(a, a2, b, b, a2, b2);
      }
      for (const off of [6, 8]) {
        const a = prevRow[off]; const b = prevRow[off + 1]; const a2 = row[off]; const b2 = row[off + 1];
        idx.push(a, b, a2, b, b2, a2);
      }
    }
    prevRow = row;
    // LED şeridi (iki yan cephe, kenarın biraz altında)
    const led = [];
    for (const side of [-1, 1]) {
      for (const dy of [-0.55, -0.8]) {
        led.push(ledPos.length / 3);
        const lat = side * (W + 0.02);
        ledPos.push(f.x + f.rx * lat, y + dy, f.z + f.rz * lat);
      }
    }
    if (prevLed) {
      for (const k of [0, 2]) {
        const a = prevLed[k]; const b = prevLed[k + 1]; const a2 = led[k]; const b2 = led[k + 1];
        if (k === 0) ledIdx.push(a, b, a2, b, b2, a2); else ledIdx.push(a, a2, b, b, a2, b2);
      }
    }
    prevLed = led;
    // Ayaklar (her 32 m) — yol yerden yeterince yüksekse
    const sMod = Math.round(s) % 32;
    if (sMod < ds && y - GROUND_Y > 4) {
      const h = bottom - GROUND_Y;
      const col = colorize(new THREE.BoxGeometry(3.2, h, 2.4), 0x86847f);
      const yaw = Math.atan2(f.tx, f.tz);
      col.rotateY(yaw);
      col.translate(f.x, GROUND_Y + h / 2, f.z);
      pierParts.push(clean(col));
      const cap = colorize(new THREE.BoxGeometry(17, 1.2, 3.0), 0x7e7c78);
      cap.rotateY(yaw + Math.PI / 2);
      cap.translate(f.x, bottom - 0.6 + 0.2, f.z);
      pierParts.push(clean(cap));
      ctx.reserve(f.x, f.z, 3);
    }
    // Lamba direkleri (sağ ve sol kenar, 40 m)
    if (Math.round(s) % 40 < ds) lampSpots.push({ s, side: (Math.round(s / 40) % 2) ? 1 : -1, y });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const deck = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x8a8884, side: THREE.DoubleSide }));
  deck.receiveShadow = true;
  deck.castShadow = true;
  deck.name = 'expressway-deck';
  group.add(deck);
  if (pierParts.length) {
    const piers = new THREE.Mesh(mergeGeometries(pierParts, false), new THREE.MeshLambertMaterial({ vertexColors: true }));
    piers.castShadow = true;
    piers.receiveShadow = true;
    piers.name = 'expressway-piers';
    group.add(piers);
  }
  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute('position', new THREE.Float32BufferAttribute(ledPos, 3));
  lgeo.setIndex(ledIdx);
  const led = new THREE.Mesh(lgeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.35, 2.8), side: THREE.DoubleSide }));
  led.name = 'expressway-led';
  group.add(led);
  return { lampSpots, deckHalf: W };
}

// ---------------------------------------------------------------------------------------------
// Tapınak: merkezde basamaklı kaide + mısır koçanı biçimli altın kule (prang), köşelerde 4 küçük kule.
// Projektörle aydınlatılmış görünüm köşe renklerine pişirilir (ışıksız MeshBasic, HDR renkler).

function prangProfile(H, R) {
  // [yarıçap, yükseklik] — tabandan tepeye; kademeli şişkinlikler
  const pts = [[R * 1.0, 0], [R * 1.0, H * 0.06], [R * 0.86, H * 0.07], [R * 0.86, H * 0.12]];
  const tiers = 7;
  let y = H * 0.12;
  let r = R * 0.84;
  const tierH = (H * 0.66) / tiers;
  for (let t = 0; t < tiers; t++) {
    pts.push([r * 1.06, y + tierH * 0.25]);
    pts.push([r * 1.02, y + tierH * 0.6]);
    pts.push([r * 0.88, y + tierH * 0.95]);
    y += tierH;
    r *= 0.84;
    pts.push([r, y]);
  }
  pts.push([r * 0.55, y + H * 0.04]);
  pts.push([r * 0.25, y + H * 0.12]);
  pts.push([R * 0.02, H]);
  return pts.map(([x, yy]) => new THREE.Vector2(Math.max(0.05, x), yy));
}

function bakeFloodlight(geo, baseCol, topCol, H, y0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const lights = [new THREE.Vector3(0.8, 0.25, 0.55).normalize(), new THREE.Vector3(0.6, 0.3, -0.75).normalize(), new THREE.Vector3(-0.3, 0.5, 0.1).normalize()];
  for (let i = 0; i < pos.count; i++) {
    const hy = THREE.MathUtils.clamp((pos.getY(i) - y0) / H, 0, 1);
    c.copy(baseCol).lerp(topCol, hy);
    let lit = 0.28;
    for (let k = 0; k < lights.length; k++) {
      lit += Math.max(0, nor.getX(i) * lights[k].x + nor.getY(i) * lights[k].y + nor.getZ(i) * lights[k].z) * (k === 0 ? 0.9 : 0.45);
    }
    // Projektörler tabandan vurur: aşağısı daha parlak
    const flood = 0.38 + 0.55 * (1 - hy) ** 1.6;
    c.multiplyScalar(lit * flood);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  return g;
}

export function buildTemple(ctx) {
  const { group } = ctx;
  const z = 120;
  const x = ctx.bankX(z) - RIVER.width - 72;
  ctx.temple = { x, z };
  ctx.reserve(x, z, 120);
  const gold = new THREE.Color(0.72, 0.4, 0.12);
  const goldTop = new THREE.Color(0.95, 0.62, 0.24);
  const white = new THREE.Color(0.55, 0.47, 0.38);
  const parts = [];
  const add = (g, base, top, H, y0) => parts.push(bakeFloodlight(g, base, top, H, y0));
  // Kaide terasları
  const terr = [[96, 6], [76, 6], [58, 6], [42, 5]];
  let y = GROUND_Y;
  for (const [w, h] of terr) {
    const g = new THREE.BoxGeometry(w, h, w);
    g.translate(x, y + h / 2, z);
    add(g, white, white, 30, GROUND_Y);
    // Altın korniş
    const t = new THREE.BoxGeometry(w + 0.8, 0.6, w + 0.8);
    t.translate(x, y + h - 0.3, z);
    add(t, gold, gold, 30, GROUND_Y);
    y += h;
  }
  // Merkez kule
  const H = 82;
  const main = new THREE.LatheGeometry(prangProfile(H, 17), 12);
  main.translate(x, y, z);
  add(main, gold, goldTop, H + y, GROUND_Y);
  const spire = new THREE.CylinderGeometry(0.2, 0.7, 12, 6);
  spire.translate(x, y + H + 4, z);
  add(spire, goldTop, goldTop, H + y, GROUND_Y);
  // Köşe kuleleri (ilk teras üstünde)
  const y1 = GROUND_Y + 6;
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const hh = 36;
    const g = new THREE.LatheGeometry(prangProfile(hh, 7), 10);
    g.translate(x + dx * 39, y1, z + dz * 39);
    add(g, gold, goldTop, hh + 6, GROUND_Y);
  }
  // Orta yanlarda küçük köşkler (mondop): kutu + piramit çatı
  for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const b = new THREE.BoxGeometry(9, 8, 9);
    b.translate(x + dx * 43, y1 + 4, z + dz * 43);
    add(b, white, white, 30, GROUND_Y);
    const r = new THREE.ConeGeometry(7.2, 12, 4);
    r.rotateY(Math.PI / 4);
    r.translate(x + dx * 43, y1 + 8 + 6, z + dz * 43);
    add(r, gold, goldTop, 30, GROUND_Y);
  }
  const geo = mergeGeometries(parts, false);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
  mesh.name = 'temple';
  group.add(mesh);
  // Altın hare (additive sprite)
  const glowMat = new THREE.SpriteMaterial({
    map: softGlowTexture(), color: new THREE.Color(1.0, 0.62, 0.25), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0.16,
  });
  const halo = new THREE.Sprite(glowMat);
  halo.position.set(x, y + 34, z);
  halo.scale.set(120, 120, 1);
  halo.name = 'temple-halo';
  group.add(halo);
  return { x, z, height: y + H };
}

// ---------------------------------------------------------------------------------------------
// Start kapısı: iki ayak + LED ekranlı kiriş (s = 0)

export function buildGantry(ctx) {
  const { track, group } = ctx;
  const f = ctx.frame(0);
  const parts = [];
  const metal = 0x26282e;
  const add = (geo, color, lat, h, along = 0) => {
    colorize(geo, color);
    geo.translate(lat, h, along);
    parts.push(clean(geo));
  };
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(1.4, 11.2, 1.6), metal, side * 14.6, 5.0);
    add(new THREE.BoxGeometry(1.7, 0.5, 1.9), 0xd8b040, side * 14.6, 10.7);
  }
  add(new THREE.BoxGeometry(31, 2.6, 1.5), metal, 0, 9.6);
  const geo = mergeGeometries(parts, false);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(f.rx, 0, f.rz), Y, new THREE.Vector3(-f.tx, 0, -f.tz));
  m.setPosition(f.x, f.y, f.z);
  geo.applyMatrix4(m);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 }));
  mesh.castShadow = true;
  mesh.name = 'gantry';
  group.add(mesh);
  const tex = bkkGantryTexture();
  const sgs = [];
  for (const face of [1, -1]) {
    const g = new THREE.PlaneGeometry(22, 2.2);
    if (face < 0) g.rotateY(Math.PI);
    g.translate(0, 9.6, face * 0.77);
    sgs.push(g);
  }
  const sg = mergeGeometries(sgs, false);
  sg.applyMatrix4(m);
  const screen = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.8, 1.8, 1.8) }));
  screen.name = 'gantry-screen';
  group.add(screen);
  // Ayaklarda dikey LED şeritleri
  const strips = [];
  for (const side of [-1, 1]) {
    for (const face of [1, -1]) {
      const g = new THREE.PlaneGeometry(0.3, 8.4);
      if (face < 0) g.rotateY(Math.PI);
      g.translate(side * 14.6 - side * 0.71, 4.6, face * 0.81);
      strips.push(g);
    }
  }
  const stg = mergeGeometries(strips, false);
  stg.applyMatrix4(m);
  const stripMesh = new THREE.Mesh(stg, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.25, 1.2), side: THREE.DoubleSide }));
  stripMesh.name = 'gantry-led';
  group.add(stripMesh);
  ctx.addLightSpot(f.x, f.y + 9, f.z, 0xff60d0, 0.8);
  void track;
}
