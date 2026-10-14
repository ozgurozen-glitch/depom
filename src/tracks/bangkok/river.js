// Zemin ve Chao Phraya: iki kıyı zemini (ShapeGeometry), ışıkları yansıtan koyu su, rıhtım duvarları, uzun
// kuyruklu tekneler ve ışıklı nehir tekneleri (hareketli), kıyıda palmiyeler, suda ışık yansıma çizgileri.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colorize, clean, palmGeometry } from '../../track/models.js';
import { GROUND_Y } from './context.js';
import { RIVER } from './layout.js';
import { groundTexture, streakTexture } from './textures.js';

function landShape(points) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], -points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], -points[i][1]);
  shape.closePath();
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Uzun kuyruklu tekne: dar gövde, kalkık pruva, kıçta uzun şaftlı motor. Pruva +z. */
function longTailGeometry() {
  const parts = [];
  const hull = new THREE.BoxGeometry(1.7, 0.8, 13, 1, 1, 12);
  const pos = hull.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const t = Math.max(0, (Math.abs(z) - 3.5) / 3.0);
    pos.setX(i, pos.getX(i) * (1 - t * 0.85));
    if (z > 0) pos.setY(i, pos.getY(i) + (Math.max(0, z - 2.5) / 4) ** 2 * 1.2);
    if (pos.getY(i) < 0) pos.setX(i, pos.getX(i) * 0.7);
  }
  hull.computeVertexNormals();
  colorize(hull, 0x8a2a1c);
  hull.translate(0, 0.25, 0);
  parts.push(clean(hull));
  const stripe = colorize(new THREE.BoxGeometry(1.75, 0.12, 9), 0xe8c040);
  stripe.translate(0, 0.55, 0.3);
  parts.push(clean(stripe));
  const canopy = colorize(new THREE.BoxGeometry(1.9, 0.06, 6), 0x1c3c7a);
  canopy.translate(0, 1.9, -0.6);
  parts.push(clean(canopy));
  for (const [x, z] of [[-0.8, -3.4], [0.8, -3.4], [-0.8, 2.2], [0.8, 2.2]]) {
    const p = colorize(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 4), 0x222222);
    p.translate(x, 1.2, z);
    parts.push(clean(p));
  }
  const engine = colorize(new THREE.BoxGeometry(0.6, 0.6, 0.9), 0x303034);
  engine.translate(0, 1.0, -6.0);
  parts.push(clean(engine));
  const shaft = colorize(new THREE.CylinderGeometry(0.06, 0.06, 5.0, 5), 0x505054);
  shaft.rotateX(Math.PI / 2 - 0.25);
  shaft.translate(0, 0.4, -8.4);
  parts.push(clean(shaft));
  return mergeGeometries(parts, false);
}

function longTailLights() {
  const parts = [];
  const bow = colorize(new THREE.SphereGeometry(0.16, 6, 4), new THREE.Color(5, 4, 2.4));
  bow.translate(0, 1.55, 6.0);
  parts.push(clean(bow));
  for (let k = 0; k < 5; k++) {
    const b = colorize(new THREE.SphereGeometry(0.09, 5, 3), new THREE.Color(3.5, 1.2, 2.4));
    b.translate(0, 1.84, -3.3 + k * 1.4);
    parts.push(clean(b));
  }
  return mergeGeometries(parts, false);
}

/** Işıklı nehir teknesi (akşam yemeği teknesi): geniş gövde, iki katlı kabin. Pruva +z. */
function cruiseGeometry() {
  const parts = [];
  const hull = new THREE.BoxGeometry(7, 2.0, 30, 1, 1, 8);
  const pos = hull.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z > 9) pos.setX(i, pos.getX(i) * (1 - ((z - 9) / 6) * 0.75));
  }
  hull.computeVertexNormals();
  colorize(hull, 0xe8e4dc);
  hull.translate(0, 0.4, 0);
  parts.push(clean(hull));
  const band = colorize(new THREE.BoxGeometry(7.05, 0.3, 26), 0x8a1a20);
  band.translate(0, 0.9, -1.5);
  parts.push(clean(band));
  const deck1 = colorize(new THREE.BoxGeometry(6.2, 2.4, 20), 0x2a2420);
  deck1.translate(0, 2.6, -2);
  parts.push(clean(deck1));
  const roof1 = colorize(new THREE.BoxGeometry(6.6, 0.2, 21), 0xd8d0c0);
  roof1.translate(0, 3.9, -2);
  parts.push(clean(roof1));
  const deck2 = colorize(new THREE.BoxGeometry(5.4, 2.0, 12), 0x2a2420);
  deck2.translate(0, 5.0, -4);
  parts.push(clean(deck2));
  const roof2 = colorize(new THREE.BoxGeometry(5.8, 0.2, 13), 0xd8c070);
  roof2.translate(0, 6.1, -4);
  parts.push(clean(roof2));
  return mergeGeometries(parts, false);
}

function cruiseLights() {
  const parts = [];
  const win = new THREE.Color(3.2, 2.0, 0.9);
  for (const side of [-1, 1]) {
    const w1 = colorize(new THREE.PlaneGeometry(19, 1.3), win);
    w1.rotateY(side * Math.PI / 2);
    w1.translate(side * 3.12, 2.7, -2);
    parts.push(clean(w1));
    const w2 = colorize(new THREE.PlaneGeometry(11, 1.1), win);
    w2.rotateY(side * Math.PI / 2);
    w2.translate(side * 2.72, 5.0, -4);
    parts.push(clean(w2));
  }
  // Çatı kenarında renkli ampul dizisi
  const cols = [new THREE.Color(5, 1, 3), new THREE.Color(1, 4, 5), new THREE.Color(5, 4, 1)];
  let k = 0;
  for (const side of [-1, 1]) {
    for (let z = -12; z <= 8; z += 1.3) {
      const b = colorize(new THREE.SphereGeometry(0.12, 5, 3), cols[k++ % 3]);
      b.translate(side * 3.3, 4.05, z);
      parts.push(clean(b));
    }
  }
  return mergeGeometries(parts, false);
}

export function buildRiver(ctx) {
  const { group, rnd, rr } = ctx;
  const bank = ctx.bank;
  const BIG = 4200;

  // ---------------- Zemin (iki kıyı) ve su
  const east = [...bank.map(([x, z]) => [x, z]), [BIG, bank[bank.length - 1][1]], [BIG, bank[0][1]]];
  const westBank = bank.map(([x, z]) => [x - RIVER.width, z]);
  const west = [[-BIG, bank[0][1]], [-BIG, bank[bank.length - 1][1]], ...westBank.slice().reverse()];
  const gEast = landShape(east);
  const gWest = landShape(west);
  const ground = mergeGeometries([gEast, gWest], false);
  ground.translate(0, GROUND_Y, 0);
  const gTex = groundTexture();
  gTex.repeat.set(1 / 32, 1 / 32);
  const groundMesh = new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ map: gTex, roughness: 0.75, metalness: 0, envMapIntensity: 0.35 }));
  groundMesh.receiveShadow = true;
  groundMesh.name = 'ground';
  group.add(groundMesh);

  let minX = Infinity;
  let maxX = -Infinity;
  for (const [x] of bank) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  const waterGeo = new THREE.PlaneGeometry(maxX - minX + RIVER.width + 40, 8000, 1, 1);
  waterGeo.rotateX(-Math.PI / 2);
  waterGeo.translate((minX + maxX - RIVER.width) / 2, RIVER.waterY, 0);
  const waterUniforms = { uTime: { value: 0 } };
  const waterMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.012, 0.016, 0.024), roughness: 0.06, metalness: 0.0, envMapIntensity: 1.6 });
  waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWPos;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 p = vWPos.xz;
          float t = uTime;
          vec2 g = vec2(
            sin(p.x * 0.21 + t * 1.3) * 0.5 + sin(p.y * 0.37 + p.x * 0.11 - t * 1.7) * 0.35 + sin(p.x * 0.9 - p.y * 0.6 + t * 2.3) * 0.15,
            cos(p.y * 0.18 - t * 1.1) * 0.5 + cos(p.x * 0.33 - p.y * 0.21 + t * 1.5) * 0.35 + cos(p.y * 1.1 + p.x * 0.5 - t * 2.1) * 0.15
          ) * 0.06;
          normal = normalize(normal + (viewMatrix * vec4(g.x, 0.0, g.y, 0.0)).xyz);
        }`);
  };
  waterMat.customProgramCacheKey = () => 'bkk-water-v1';
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.receiveShadow = true;
  water.name = 'river';
  group.add(water);

  // Rıhtım duvarları (iki kıyı)
  const wallParts = [];
  for (const [line, dir] of [[bank, 1], [westBank, -1]]) {
    const pos = [];
    const idx = [];
    for (let i = 0; i < line.length; i++) {
      const [x, z] = line[i];
      pos.push(x, GROUND_Y, z, x, RIVER.waterY - 1.5, z);
      if (i > 0) {
        const a = (i - 1) * 2;
        if (dir > 0) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    wallParts.push(clean(colorize(g, 0x6a645c)));
  }
  const walls = new THREE.Mesh(mergeGeometries(wallParts, false), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  walls.name = 'river-walls';
  group.add(walls);

  // ---------------- Su üstünde ışık yansıma çizgileri (karşı kıyı ışıkları, tapınak)
  const sPos = [];
  const sUv = [];
  const sCol = [];
  const sIdx = [];
  const addWaterStreak = (x, z, len, w, color) => {
    // Doğuya (kıyı yoluna, izleyiciye) doğru uzanır
    const base = sPos.length / 3;
    const y = RIVER.waterY + 0.03;
    for (const [t, v] of [[0, 0], [1, 1]]) {
      for (const [dz, u] of [[-w / 2, 0], [w / 2, 1]]) {
        sPos.push(x + t * len, y, z + dz);
        sUv.push(u, v);
        sCol.push(color.r, color.g, color.b);
      }
    }
    sIdx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  };
  if (ctx.temple && ctx.isWater(ctx.temple.x + 80, ctx.temple.z)) {
    addWaterStreak(ctx.temple.x + 72, ctx.temple.z, 250, 40, new THREE.Color(0.22, 0.12, 0.04));
    addWaterStreak(ctx.temple.x + 72, ctx.temple.z, 200, 10, new THREE.Color(0.4, 0.24, 0.08));
  }
  const streakCols = [[0.8, 0.5, 0.25], [0.25, 0.6, 0.9], [0.9, 0.2, 0.6], [0.7, 0.7, 0.75]];
  for (let k = 0; k < 70; k++) {
    const z = rr(-1400, 1600);
    const wx = ctx.bankX(z) - RIVER.width + 4;
    if (ctx.temple && Math.abs(z - ctx.temple.z) < 70) continue;
    const c = streakCols[Math.floor(rnd() * streakCols.length)];
    addWaterStreak(wx, z, rr(60, 160), rr(3, 9), new THREE.Color(c[0], c[1], c[2]).multiplyScalar(rr(0.3, 0.7)));
  }
  // Doğu kıyısı (kıyı yolu tarafı) — batıya doğru uzanan
  for (let k = 0; k < 40; k++) {
    const z = rr(-1400, 1600);
    const ex = ctx.bankX(z) - 2;
    const c = streakCols[Math.floor(rnd() * streakCols.length)];
    const len = rr(40, 100);
    addWaterStreak(ex - len, z, len, rr(2, 6), new THREE.Color(c[0], c[1], c[2]).multiplyScalar(rr(0.2, 0.45)));
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute(sUv, 2));
  sg.setAttribute('color', new THREE.Float32BufferAttribute(sCol, 3));
  sg.setIndex(sIdx);
  const sMesh = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({
    map: streakTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  sMesh.renderOrder = 2;
  sMesh.name = 'river-reflections';
  group.add(sMesh);

  // ---------------- Tekneler
  const boats = [];
  for (let k = 0; k < 9; k++) boats.push({ kind: 0, z: rr(-1300, 1300), lane: rr(40, RIVER.width - 40), dir: rnd() < 0.5 ? 1 : -1, speed: rr(9, 15), ph: rnd() * 6 });
  for (let k = 0; k < 4; k++) boats.push({ kind: 1, z: -900 + k * 600 + rr(-100, 100), lane: rr(90, RIVER.width - 90), dir: k % 2 ? 1 : -1, speed: rr(3, 4.5), ph: rnd() * 6 });
  const sets = [
    { body: longTailGeometry(), lights: longTailLights(), list: boats.filter((b) => b.kind === 0) },
    { body: cruiseGeometry(), lights: cruiseLights(), list: boats.filter((b) => b.kind === 1) },
  ];
  const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  for (const set of sets) {
    set.bodyMesh = new THREE.InstancedMesh(set.body, bodyMat, set.list.length);
    set.lightMesh = new THREE.InstancedMesh(set.lights, lightMat, set.list.length);
    set.bodyMesh.frustumCulled = false;
    set.lightMesh.frustumCulled = false;
    set.bodyMesh.name = 'boats';
    set.lightMesh.name = 'boat-lights';
    group.add(set.bodyMesh, set.lightMesh);
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const updateBoats = (dt, time) => {
    for (const set of sets) {
      set.list.forEach((b, i) => {
        b.z += b.dir * b.speed * dt;
        if (b.z > 1700) b.z -= 3400;
        if (b.z < -1700) b.z += 3400;
        const x = ctx.bankX(b.z) - b.lane;
        e.set(Math.sin(time * 0.9 + b.ph) * 0.02 - (b.kind === 0 ? 0.04 : 0), b.dir > 0 ? 0 : Math.PI, Math.sin(time * 1.3 + b.ph) * 0.03);
        q.setFromEuler(e);
        m4.compose(p.set(x, RIVER.waterY + 0.05 + Math.sin(time * 1.1 + b.ph) * 0.08, b.z), q, one);
        set.bodyMesh.setMatrixAt(i, m4);
        set.lightMesh.setMatrixAt(i, m4);
      });
      set.bodyMesh.instanceMatrix.needsUpdate = true;
      set.lightMesh.instanceMatrix.needsUpdate = true;
    }
  };
  updateBoats(0, 0);

  // ---------------- Palmiyeler (kıyı yolunun kara tarafı + batı yakası)
  const palms = [];
  const f = {};
  for (let s = ctx.sec.river.s0 + 20; s < ctx.sec.river.s1 - 20; s += 26) {
    ctx.frame(s, f);
    const l = -(RIVER.side || -1) * (18.5 + rnd() * 2); // kara tarafı
    const x = f.x + f.rx * l;
    const z = f.z + f.rz * l;
    if (ctx.overlaps(x, z, 1)) continue;
    palms.push({ x, z, s: rr(0.9, 1.25), yaw: rnd() * 6.28 });
  }
  // Lumpini parkı: kıvrımların iki yanında sık ağaçlar (alan city.js'te bina için kapatıldı)
  if (ctx.sec.lumpini) {
    for (let s = ctx.sec.lumpini.s0 + 25; s < ctx.sec.expressway.s0 + 40; s += 9) {
      ctx.frame(s, f);
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const l = side * rr(19, 140);
          const x = f.x + f.rx * l + rr(-4, 4);
          const z = f.z + f.rz * l + rr(-4, 4);
          if (ctx.dist(x, z) < 17 || rnd() > 0.7 * ctx.density + 0.15) continue;
          palms.push({ x, z, s: rr(0.8, 1.4), yaw: rnd() * 6.28 });
        }
      }
    }
  }
  for (let k = 0; k < 90 * ctx.density; k++) {
    const z = rr(-900, 1200);
    const x = ctx.bankX(z) - RIVER.width - rr(8, 260);
    if (ctx.overlaps(x, z, 1.5) || ctx.dist(x, z) < 18) continue;
    palms.push({ x, z, s: rr(0.9, 1.4), yaw: rnd() * 6.28 });
  }
  const palmMesh = new THREE.InstancedMesh(palmGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, color: 0x6a7a70 }), Math.max(1, palms.length));
  palms.forEach((pl, i) => {
    e.set(0, pl.yaw, 0);
    q.setFromEuler(e);
    m4.compose(p.set(pl.x, GROUND_Y - 0.2, pl.z), q, new THREE.Vector3(pl.s, pl.s, pl.s));
    palmMesh.setMatrixAt(i, m4);
  });
  palmMesh.count = palms.length;
  palmMesh.computeBoundingSphere();
  palmMesh.castShadow = true;
  palmMesh.name = 'palms';
  group.add(palmMesh);

  return {
    update(dt, time) {
      waterUniforms.uTime.value = time;
      if (dt > 0) updateBoats(dt, time);
    },
  };
}
