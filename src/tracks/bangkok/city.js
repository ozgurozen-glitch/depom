// Şehir: gece cepheli binalar (tek InstancedMesh, pencereler/LED cepheler shader'da prosedürel), neon ve
// ışıklı kutu tabelalar (tek birleşik mesh), çatı ikaz ışıkları, LED taç bantları ve MahaNakhon'u andıran
// "pikselli" kule.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GROUND_Y } from './context.js';
import { signsTexture, SIGNS, towerWindowTextures } from './textures.js';
import { colorize, clean } from '../../track/models.js';

// Stiller: 0 cam kule, 1 ofis, 2 dükkânlı ev (shophouse), 3 LED cephe, 4 konut
export const STYLE = { GLASS: 0, OFFICE: 1, SHOP: 2, LED: 3, CONDO: 4 };

const SHOP_TINTS = [0xd8c9a8, 0xc9b28c, 0xb9c4b0, 0xd0a890, 0xa8b8c8, 0xe0d0b8, 0xc8a070, 0xb0a8c0, 0xd8b8a8];
const CONDO_TINTS = [0xd8d4cc, 0xc8ccd0, 0xe0dcd0, 0xbcc0c8];
const GLASS_TINTS = [0x9ab0d0, 0xa0c0d8, 0x8aa0c0, 0xb0c8e0, 0x90b0c0];

function createFacadeMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, metalness: 1, emissive: 0xffffff, emissiveIntensity: 1, envMapIntensity: 0.9,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aBld;
        varying vec3 vFac;
        varying vec4 vBld;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          float st = floor(aBld.x + 0.5);
          vec2 cell = st < 0.5 ? vec2(3.0, 3.6) : st < 1.5 ? vec2(3.6, 3.8) : st < 2.5 ? vec2(4.2, 3.6)
            : st < 3.5 ? vec2(2.2, 2.2) : vec2(3.2, 3.0);
          float isX = step(0.5, abs(normal.x));
          float faceW = mix(sc.x, sc.z, isX);
          float hz = mix(position.x * sign(normal.z + 1e-4), -position.z * sign(normal.x + 1e-4), isX);
          float ncol = max(1.0, floor(faceW / cell.x + 0.5));
          float nfl = max(1.0, floor(sc.y / cell.y + 0.5));
          vFac = vec3((hz + 0.5) * ncol, position.y * nfl, step(0.5, abs(normal.y)));
          vBld = aBld;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        varying vec3 vFac;
        varying vec4 vBld;
        float bHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        vec3 bHue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }`)
      .replace('#include <map_fragment>', `
        vec3 bEm = vec3(0.0);
        float bRough = 0.9;
        float bMetal = 0.0;
        {
          float st = floor(vBld.x + 0.5);
          float seed = floor(vBld.y + 0.5);
          float litFrac = vBld.z;
          float roof = step(0.5, vFac.z);
          vec2 cont = vFac.xy;
          vec2 cid = floor(cont);
          vec2 f = fract(cont);
          // Uzakta pencere pikselden küçülünce ortalamaya geç (titreşim yok)
          float cellPx = max(length(dFdx(cont)), length(dFdy(cont)));
          float far = smoothstep(0.22, 0.6, cellPx);
          // Hücre iki cama bölünür (kayıt dikmesi); ışık durumu cam başına
          float pane = floor(f.x * 2.0);
          vec2 pid = vec2(cid.x * 2.0 + pane, cid.y);
          float h1 = bHash(pid + seed * 3.17);
          float h2 = bHash(pid.yx * 1.73 + seed * 0.61);
          float h3 = bHash(pid * 0.37 + seed * 1.9);
          float ground = 1.0 - step(1.0, cont.y);
          vec4 wr; // pencere dikdörtgeni (x0, y0, x1, y1)
          vec3 base;
          vec3 winCol = h2 < 0.62 ? vec3(1.0, 0.72, 0.42) : (h2 < 0.86 ? vec3(0.78, 0.88, 1.0) : vec3(0.75, 1.0, 0.8));
          float emK = 0.85;
          if (st < 0.5) {
            wr = vec4(0.06, 0.1, 0.94, 0.86);
            base = vec3(0.035, 0.042, 0.055);
            bRough = 0.14; bMetal = 0.75;
            emK = 0.7;
          } else if (st < 1.5) {
            wr = vec4(0.04, 0.2, 0.96, 0.72);
            base = vec3(0.13, 0.125, 0.12);
            bRough = 0.75;
          } else if (st < 2.5) {
            wr = ground > 0.5 ? vec4(0.05, 0.0, 0.95, 0.78) : vec4(0.2, 0.3, 0.8, 0.82);
            base = vec3(0.24);
            bRough = 0.85;
            if (ground > 0.5) { winCol = h2 < 0.5 ? vec3(1.0, 0.82, 0.55) : vec3(0.85, 1.0, 0.92); emK = 1.5; litFrac = 0.85; }
          } else if (st < 3.5) {
            wr = vec4(0.08, 0.08, 0.92, 0.92);
            base = vec3(0.02, 0.02, 0.025);
            bRough = 0.3; bMetal = 0.4;
          } else {
            wr = vec4(0.12, 0.26, 0.88, 0.84);
            base = vec3(0.2);
            bRough = 0.85;
          }
          float win = step(wr.x, f.x) * step(f.x, wr.z) * step(wr.y, f.y) * step(f.y, wr.w);
          float mull = st > 2.5 && st < 3.5 ? 1.0 : step(0.035, abs(f.x - 0.5));
          win *= mull;
          float area = (wr.z - wr.x) * (wr.w - wr.y) * 0.93;
          win = mix(win, area, far);
          float lit = mix(step(1.0 - litFrac, h1), litFrac, far);
          // Cam başına parlaklık çeşitliliği (perde, farklı lambalar); uzakta ortalama
          float vary = mix(0.3 + 0.7 * h3 * h3, 0.55, far);
          vec3 em = winCol * win * lit * emK * vary;
          if (st > 2.5 && st < 3.5) {
            // LED cephe: kayan renk dalgaları
            float band = 0.5 + 0.5 * sin(cid.y * 0.42 - uTime * 1.6 + cid.x * 0.33 + seed);
            float band2 = 0.5 + 0.5 * sin(cid.x * 0.9 + uTime * 0.7 - cid.y * 0.12);
            vec3 c = bHue(fract(vBld.w + cid.y * 0.012 + uTime * 0.03));
            em = c * win * (0.12 + 1.6 * smoothstep(0.55, 1.0, band) * (0.6 + 0.4 * band2));
          }
          // Lobi katı biraz daha parlak, ayrıca cam kulede kat aralarında ince bant
          if (st < 0.5) base += vec3(0.04, 0.05, 0.07) * (1.0 - step(0.12, f.y)) * (1.0 - far);
          base = mix(base, vec3(0.05, 0.05, 0.055), roof);
          em *= 1.0 - roof;
          diffuseColor.rgb *= base * (1.0 - win * 0.8 * (1.0 - roof));
          bEm = em;
          bRough = mix(bRough, 0.9, roof);
          bMetal = mix(bMetal, 0.0, roof);
          if (win > 0.5 && st < 1.5) { bRough = 0.08; bMetal = 0.6; }
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * bRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * bMetal;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= bEm;');
  };
  mat.customProgramCacheKey = () => 'bkk-facade-v1';
  return mat;
}

/**
 * Binaları, tabelaları ve kuleyi kurar. ctx: context.js. Döndürür { update(dt, time), buildings }.
 */
export function buildCity(ctx) {
  const { group, rnd, rr, pick, sec } = ctx;
  const L = ctx.track.length;
  const buildings = [];
  const signs = []; // { x, y, z, yaw, w, h, sign }
  const tryBuilding = (b, minClear) => {
    const cy = Math.cos(b.yaw);
    const sy = Math.sin(b.yaw);
    for (const [lx, lz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) {
      const x = b.x + lx * b.d * cy + lz * b.w * sy;
      const z = b.z - lx * b.d * sy + lz * b.w * cy;
      if (ctx.dist(x, z) < minClear) return false;
      if (ctx.isWater(x, z, 6)) return false;
      if (ctx.underBts(x, z)) return false;
    }
    const r = Math.hypot(b.w, b.d) * 0.45;
    if (ctx.overlaps(b.x, b.z, r)) return false;
    b.y = GROUND_Y - 0.5;
    b.h += 0.5;
    b.seed = Math.floor(rnd() * 997);
    buildings.push(b);
    ctx.reserve(b.x, b.z, r);
    return true;
  };
  // Pikselli kule (MahaNakhon'u andıran) — önce, ayak izi rezerv edilsin
  const tower = buildPixelTower(ctx, 470, 70);
  if (tower) group.add(...tower.meshes);

  const tint = (style) => new THREE.Color(
    style === STYLE.SHOP ? pick(SHOP_TINTS) : style === STYLE.CONDO ? pick(CONDO_TINTS) : style === STYLE.GLASS ? pick(GLASS_TINTS) : 0xffffff,
  );

  // Yola bakan yüze tabela ekle (yatay: cepheye yapışık; dikey: cepheden dik çıkıntı)
  const addSigns = (b, side, f, o) => {
    const lx = side > 0 ? 1 : -1;
    const faceX = b.x + Math.cos(b.yaw) * lx * (b.d / 2 + 0.2);
    const faceZ = b.z - Math.sin(b.yaw) * lx * (b.d / 2 + 0.2);
    const yawFace = f.yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
    if (rnd() < o.hSign) {
      const k = Math.floor(rnd() * 8);
      const w = Math.min(b.w * 0.85, rr(7, 13));
      const y = GROUND_Y + Math.min(b.h - 2.5, rr(o.signY[0], o.signY[1]));
      signs.push({ x: faceX, y, z: faceZ, yaw: yawFace, w, h: w / 4, sign: SIGNS[k] });
      ctx.addLightSpot(faceX, y, faceZ, SIGNS[k].color);
    }
    if (rnd() < o.vSign) {
      const k = 8 + Math.floor(rnd() * 8);
      const h = rr(7, 11);
      // Çıkıntı: cepheden yola doğru 1.4 m, binanın bir ucuna yakın
      const along = (rnd() - 0.5) * b.w * 0.7;
      const x = faceX - f.rx * side * 1.5 + f.tx * along;
      const z = faceZ - f.rz * side * 1.5 + f.tz * along;
      const y = GROUND_Y + rr(4.5, 7);
      if (y + h / 2 < GROUND_Y + b.h + 3) {
        signs.push({ x, y: y + h / 2, z, yaw: f.yaw + Math.PI / 2, w: h / 4, h, sign: SIGNS[k], vertical: true });
        ctx.addLightSpot(x, y + h / 2, z, SIGNS[k].color, 0.8);
      }
    }
  };

  const rowAlong = (s0, s1, side, o) => {
    let s = s0;
    const f = {};
    while (s < s1) {
      const w = rr(o.w[0], o.w[1]);
      const d = rr(o.d[0], o.d[1]);
      ctx.frame(s + w / 2, f);
      const setback = o.setback + rnd() * (o.jitter ?? 2);
      const lat = side * (setback + d / 2);
      const h = o.height();
      const style = o.style(h);
      const b = {
        x: f.x + f.rx * lat, z: f.z + f.rz * lat, yaw: f.yaw, w, d, h, style,
        tint: tint(style), lit: o.lit ? o.lit() : rr(0.18, 0.42), hue: rnd(),
      };
      if (rnd() > (o.skip ?? 0) && tryBuilding(b, o.minClear ?? setback - 1)) {
        if (o.signs) addSigns(b, side, f, o.signs);
      }
      s += w + rr(0.4, o.gap ?? 4);
    }
  };

  const towerStyle = (h) => (h > 70 ? (rnd() < 0.55 ? STYLE.GLASS : rnd() < 0.5 ? STYLE.LED : STYLE.OFFICE)
    : rnd() < 0.4 ? STYLE.CONDO : rnd() < 0.5 ? STYLE.OFFICE : STYLE.GLASS);
  const tall = (p, a, b, c, d) => () => (rnd() < p ? rr(a, b) : rr(c, d));

  // Sukhumvit (start düzlüğü): iki yanda gökdelenler, alt katlarda tabelalar
  for (const side of [-1, 1]) {
    rowAlong(sec.sukhumvit.s0 - 20, L + sec.silom.s0 + 30, side, {
      setback: 21, w: [18, 34], d: [18, 30], height: tall(0.45, 70, 190, 22, 60), style: towerStyle,
      signs: { hSign: 0.7, vSign: 0.35, signY: [5, 9] }, gap: 3,
    });
  }
  // Silom: dükkânlı evler + orta yükseklikte bloklar, yoğun tabela
  for (const side of [-1, 1]) {
    rowAlong(sec.silom.s0 + 10, sec.expressway.s0 + 60, side, {
      setback: 19.5, w: [9, 16], d: [12, 18], height: tall(0.25, 30, 75, 11, 20),
      style: (h) => (h < 22 ? STYLE.SHOP : towerStyle(h)), signs: { hSign: 0.6, vSign: 0.6, signY: [4.5, 8] }, gap: 1.2,
      lit: () => rr(0.25, 0.5),
    });
  }
  // Otoyol: iki yanda yüksek bloklar (yükseltilmiş yol kulelerin arasından geçer)
  for (const side of [-1, 1]) {
    rowAlong(sec.expressway.s0 + 120, sec.river.s0 - 40, side, {
      setback: 30, w: [20, 34], d: [18, 28], height: tall(0.4, 60, 150, 18, 50), style: towerStyle, gap: 14, skip: 0.35,
      signs: { hSign: 0.25, vSign: 0, signY: [16, 26] },
    });
  }
  // Nehir kıyısı: kara tarafında oteller/kuleler
  rowAlong(sec.river.s0 + 40, sec.chinatown.s0 - 30, 1, {
    setback: 24, w: [22, 36], d: [18, 30], height: tall(0.5, 70, 170, 25, 60), style: towerStyle, gap: 9,
    signs: { hSign: 0.3, vSign: 0.2, signY: [6, 10] },
  });
  // Chinatown: dar sokak, 3-6 katlı dükkânlar, dikey kırmızı tabelalar
  for (const side of [-1, 1]) {
    rowAlong(sec.chinatown.s0 + 6, sec.sukhumvit.s0 - 30, side, {
      setback: 16.6, jitter: 0.4, w: [6, 11], d: [12, 16], height: () => rr(11, 23), style: () => (rnd() < 0.85 ? STYLE.SHOP : STYLE.CONDO),
      signs: { hSign: 0.45, vSign: 0.85, signY: [4.2, 6.5] }, gap: 0.5, minClear: 16, lit: () => rr(0.35, 0.65),
    });
  }

  // İç bloklar ve ufuk: ızgara doldurma (nehrin doğusu); uzaklaştıkça seyrek ama yüksek
  const fill = (x0, x1, z0, z1, step, o) => {
    for (let z = z0; z <= z1; z += step) {
      for (let x = x0; x <= x1; x += step) {
        const px = x + rr(-step * 0.3, step * 0.3);
        const pz = z + rr(-step * 0.3, step * 0.3);
        const dd = ctx.dist(px, pz);
        if (dd < o.minClear + 10) continue;
        if (o.skip && rnd() < o.skip) continue;
        const h = o.height(dd);
        const style = o.style(h);
        tryBuilding({
          x: px, z: pz, yaw: o.yaw ?? 0, w: rr(o.w[0], o.w[1]), d: rr(o.d[0], o.d[1]), h, style,
          tint: tint(style), lit: rr(0.15, 0.4), hue: rnd(),
        }, o.minClear);
      }
    }
  };
  const dens = ctx.density;
  fill(-600, 1000, -700, 900, 34, {
    minClear: 24, w: [16, 30], d: [16, 30], skip: 0.1 + (1 - dens) * 0.4,
    height: () => (rnd() < 0.18 ? rr(70, 170) : rr(14, 50)), style: (h) => (h < 24 ? (rnd() < 0.6 ? STYLE.SHOP : STYLE.CONDO) : towerStyle(h)),
  });
  // Uzak halka (silüet)
  fill(-650, 1900, -1700, 1800, 70, {
    minClear: 24, w: [24, 44], d: [24, 44], skip: 0.35 + (1 - dens) * 0.3,
    height: () => (rnd() < 0.35 ? rr(90, 260) : rr(30, 80)), style: towerStyle,
  });
  // Nehrin batı yakası: alçak yapılar + birkaç kule (tapınak çevresi landmarks.js'te rezerv edilir)
  {
    for (let k = 0; k < 260 * dens; k++) {
      const z = rr(-1600, 1800);
      const x = ctx.bankX(z) - 380 - 30 - rnd() * 700;
      const nearTemple = ctx.temple && (x - ctx.temple.x) ** 2 + (z - ctx.temple.z) ** 2 < 260 ** 2;
      const h = nearTemple ? rr(6, 12) : rnd() < 0.12 ? rr(60, 150) : rr(10, 35);
      const style = h < 20 ? (rnd() < 0.5 ? STYLE.SHOP : STYLE.CONDO) : towerStyle(h);
      tryBuilding({ x, z, yaw: rr(-0.2, 0.2), w: rr(14, 30), d: rr(14, 30), h, style, tint: tint(style), lit: rr(0.2, 0.5), hue: rnd() }, 20);
    }
  };

  return {
    buildings,
    signs,
    finalize() {
      return finalizeCity(ctx, buildings, signs);
    },
  };
}

function finalizeCity(ctx, buildings, signs) {
  const { group, rnd } = ctx;
  const uniforms = { uTime: { value: 0 } };
  const mat = createFacadeMaterial(uniforms);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  // Yola yakın binalar gölge haritasına çizilir; uzaktakiler (silüet) ayrı örnekte, gölgesiz
  const near = [];
  const far = [];
  for (const b of buildings) (ctx.dist(b.x, b.z) < 110 ? near : far).push(b);
  const makeSet = (list, name, shadow) => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    const attr = new Float32Array(Math.max(1, list.length) * 4);
    list.forEach((b, i) => {
      e.set(0, b.yaw, 0);
      q.setFromEuler(e);
      m4.compose(p.set(b.x, b.y, b.z), q, sc.set(b.d, b.h, b.w));
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, b.tint);
      attr[i * 4] = b.style;
      attr[i * 4 + 1] = b.seed;
      attr[i * 4 + 2] = b.lit;
      attr[i * 4 + 3] = b.hue;
    });
    geo.setAttribute('aBld', new THREE.InstancedBufferAttribute(attr, 4));
    mesh.count = list.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    mesh.name = name;
    group.add(mesh);
  };
  makeSet(near, 'buildings', true);
  makeSet(far, 'buildings-far', false);

  // LED taç bantları ve çatı ikaz ışıkları (yüksek binalar)
  const crowns = buildings.filter((b) => b.h > 60 && b.style !== STYLE.LED && rnd() < 0.55);
  const crownGeo = new THREE.BoxGeometry(1, 1, 1);
  const crownMesh = new THREE.InstancedMesh(crownGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, crowns.length));
  const crownCols = [new THREE.Color(0.2, 1.6, 2.4), new THREE.Color(2.4, 0.3, 1.8), new THREE.Color(2.4, 1.6, 0.5), new THREE.Color(1.2, 0.5, 2.6), new THREE.Color(2.0, 2.0, 2.2)];
  crowns.forEach((b, i) => {
    e.set(0, b.yaw, 0);
    q.setFromEuler(e);
    m4.compose(p.set(b.x, b.y + b.h - 2.2, b.z), q, sc.set(b.d + 0.3, 1.1, b.w + 0.3));
    crownMesh.setMatrixAt(i, m4);
    crownMesh.setColorAt(i, crownCols[Math.floor(rnd() * crownCols.length)]);
  });
  crownMesh.count = crowns.length;
  crownMesh.computeBoundingSphere();
  crownMesh.name = 'tower-crowns';
  group.add(crownMesh);

  const tallOnes = buildings.filter((b) => b.h > 80);
  const beaconGeo = new THREE.SphereGeometry(0.7, 8, 6);
  const beaconMesh = new THREE.InstancedMesh(beaconGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.25, 0.15) }), Math.max(1, tallOnes.length));
  tallOnes.forEach((b, i) => {
    m4.makeTranslation(b.x, b.y + b.h + 1.2, b.z);
    beaconMesh.setMatrixAt(i, m4);
  });
  beaconMesh.count = tallOnes.length;
  beaconMesh.computeBoundingSphere();
  beaconMesh.name = 'beacons';
  group.add(beaconMesh);

  // Tabelalar
  let signMesh = null;
  if (signs.length) {
    const geos = [];
    for (const sg of signs) {
      const g = new THREE.PlaneGeometry(sg.w, sg.h);
      const uv = g.attributes.uv;
      const S = sg.sign;
      for (let i = 0; i < uv.count; i++) {
        const u = S.u0 + 0.004 + uv.getX(i) * (S.u1 - S.u0 - 0.008);
        const v = S.v0 + 0.004 + uv.getY(i) * (S.v1 - S.v0 - 0.008);
        uv.setXY(i, u, v);
      }
      g.rotateY(sg.yaw);
      g.translate(sg.x, sg.y, sg.z);
      geos.push(g);
    }
    const signMat = new THREE.MeshBasicMaterial({ map: signsTexture(), color: new THREE.Color(2.0, 2.0, 2.0), side: THREE.DoubleSide });
    signMesh = new THREE.Mesh(mergeGeometries(geos, false), signMat);
    signMesh.name = 'signs';
    group.add(signMesh);
  }

  return {
    update(dt, time) {
      uniforms.uTime.value = time;
      beaconMesh.visible = (time % 1.6) < 0.8;
    },
  };
}

/** Pikselli kule: kat dilimleri halinde çevre küpleri; sarmal bir bantta küpler içe çekilir (sıcak ışıklı). */
function buildPixelTower(ctx, x, z) {
  if (ctx.dist(x, z) < 40) return null;
  const SIZE = 6;
  const N = 6; // kenar başına küp
  const LEVELS = 52; // ~312 m
  const shell = [];
  const core = [];
  const half = (N * SIZE) / 2;
  for (let lv = 0; lv < LEVELS; lv++) {
    const y = GROUND_Y + lv * SIZE;
    // Sarmal "piksel" bandı: yükseldikçe çevre boyunca dolaşan açı aralığı
    const center = (lv / LEVELS) * Math.PI * 2.2 + 0.4;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        if (i > 0 && i < N - 1 && j > 0 && j < N - 1) continue; // yalnız çevre
        const cx = -half + SIZE * (i + 0.5);
        const cz = -half + SIZE * (j + 0.5);
        const ang = Math.atan2(cz, cx);
        const dA = Math.abs(((ang - center + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        const inBand = dA < 0.7 + 0.25 * Math.sin(lv * 1.7 + i * 2.1 + j);
        const hashed = ((i * 73 + j * 151 + lv * 197) % 11) / 11;
        if (inBand && hashed < 0.8) {
          // İçe çekilmiş (çekirdek) küp: dış yüzden 2 m içeride, sıcak ışıklı
          const k = 1 - 2 / half;
          const g = new THREE.BoxGeometry(SIZE * 0.98, SIZE * 0.98, SIZE * 0.98);
          g.translate(x + cx * k, y + SIZE / 2, z + cz * k);
          core.push(g);
          // Dışarı taşan küçük "piksel" çıkıntılar
          if (hashed < 0.25) {
            const g2 = new THREE.BoxGeometry(SIZE * 0.96, SIZE * 0.96, SIZE * 0.96);
            const out = 1 + 1.8 / half;
            g2.translate(x + cx * out, y + SIZE / 2, z + cz * out);
            shell.push(g2);
          }
          continue;
        }
        const g = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
        g.translate(x + cx, y + SIZE / 2, z + cz);
        shell.push(g);
      }
    }
  }
  // İç dolgu (görünen boşluklar arkasında koyu çekirdek)
  const inner = new THREE.BoxGeometry((N - 2) * SIZE, LEVELS * SIZE, (N - 2) * SIZE);
  inner.translate(x, GROUND_Y + (LEVELS * SIZE) / 2, z);
  const shellGeo = mergeGeometries(shell.map((g) => g.toNonIndexed()), false);
  const coreGeo = mergeGeometries([...core.map((g) => g.toNonIndexed()), inner.toNonIndexed()], false);
  const tex = towerWindowTextures();
  const shellMat = new THREE.MeshStandardMaterial({
    map: tex.map, emissiveMap: tex.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.55,
    roughness: 0.2, metalness: 0.6,
  });
  const coreMat = new THREE.MeshStandardMaterial({
    map: tex.map, emissiveMap: tex.emissiveMap, emissive: new THREE.Color(1.0, 0.62, 0.3), emissiveIntensity: 2.1,
    roughness: 0.5, metalness: 0.2,
  });
  const shellMesh = new THREE.Mesh(shellGeo, shellMat);
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  shellMesh.castShadow = true;
  shellMesh.name = 'pixel-tower';
  coreMesh.name = 'pixel-tower-core';
  // Tepe ikaz ışığı
  const tip = clean(colorize(new THREE.CylinderGeometry(0.3, 0.6, 18, 6), 0x404448));
  tip.translate(x, GROUND_Y + LEVELS * SIZE + 9, z);
  const tipMesh = new THREE.Mesh(tip, new THREE.MeshLambertMaterial({ vertexColors: true }));
  tipMesh.name = 'pixel-tower-mast';
  ctx.reserve(x, z, half * 1.6);
  return { meshes: [shellMesh, coreMesh, tipMesh] };
}
