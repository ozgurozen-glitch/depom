// Arazi (yükseklik alanı) ve deniz. Arazi yol çevresinde yol seviyesine düzlenir (yol hiçbir zaman
// arazinin içinde kalmaz), uzakta doğal yer şekline (kuzey dağları, burun tepesi, batı tepeleri)
// karışır. Deniz güneyde ve doğuda.
import * as THREE from 'three';
import { makeCanvas, paintPixels, toTexture, tileFbm, tileNoise, mulberry32 } from './textures.js';

export const SEA_LEVEL = -1.3;

// Basit, hızlı 2B değer gürültüsü (dünya koordinatları için)
function hashN(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hashN(xi, yi);
  const b = hashN(xi + 1, yi);
  const c = hashN(xi, yi + 1);
  const d = hashN(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm2(x, y, oct = 4) {
  let s = 0;
  let a = 0.5;
  let n = 0;
  for (let o = 0; o < oct; o++) {
    s += vnoise(x, y) * a;
    n += a;
    a *= 0.5;
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 3.7;
  }
  return s / n;
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// Güney kıyı çizgisi z(x): parçalı doğrusal (x, z) düğümleri
const COAST_S = [
  [-2400, 900], [-900, 520], [-620, 360], [-500, 262], [-470, 240], [-120, 240], [-60, 262],
  [60, 330], [190, 420], [260, 432], [700, 434], [790, 440], [2400, 440],
];
function coastZ(x) {
  const P = COAST_S;
  if (x <= P[0][0]) return P[0][1];
  for (let i = 0; i < P.length - 1; i++) {
    const [x0, z0] = P[i];
    const [x1, z1] = P[i + 1];
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return z0 + (z1 - z0) * (t * t * (3 - 2 * t));
    }
  }
  return P[P.length - 1][1];
}

/** > 0 deniz, < 0 kara (yaklaşık metre). */
export function seaSignedDistance(x, z) {
  const wob = (fbm2(x * 0.012, z * 0.012, 3) - 0.5) * 26;
  const south = z - coastZ(x);
  const east = x - 985;
  const corner = (x + z - 1250) * 0.7071;
  let d = Math.max(south, east, corner);
  // Kıyı rıhtımlarında (marina ve liman) düzgün kenar, diğer yerlerde girintili çıkıntılı
  const quay = (x > -480 && x < 760 && z > 200 && z < 450) ? 1 : 0;
  d += wob * (1 - quay * 0.85);
  return d;
}

/** Şehir dokusu bölgesi (0..1) — zemin rengi ve düzlük için. */
export function cityMask(x, z) {
  return smooth(40, -60, x) * smooth(-1000, -820, x) * smooth(-150, -110, z) * smooth(320, 270, z);
}

/** Doğal yer şekli (yol etkisi olmadan). */
export function naturalHeight(x, z) {
  // Ova
  let h = 1.2 + (fbm2(x * 0.004, z * 0.004, 3) - 0.5) * 3;
  // Kuzey dağları: tırmanış yolu ve iniş düzlüğünün kuzeyinden başlar
  const ridge = Math.min(42, Math.max(0, (x + 160) * 0.052));
  const foot = -70 + (fbm2(x * 0.003, 9.1, 2) - 0.5) * 40;
  const north = Math.max(0, foot - z);
  const mtn = 380 * Math.pow(smooth(0, 1100, north), 0.75) * (0.75 + 0.5 * fbm2(x * 0.0025, z * 0.0025, 4));
  const shoulder = ridge * smooth(foot + 150, foot - 10, z);
  h = Math.max(h, shoulder + mtn + (fbm2(x * 0.02, z * 0.02, 3) - 0.5) * 6 * smooth(0, 60, north));
  // Burun tepesi (liman ile iniş arasında)
  const dx = (x - 640) / 190;
  const dz = (z - 140) / 140;
  const hill = 64 * Math.exp(-(dx * dx + dz * dz) * 0.5) * (0.85 + 0.3 * fbm2(x * 0.01, z * 0.01, 3));
  h = Math.max(h, hill);
  // Doğu burnu (tırmanış yolunun batısı, tünelin üstü)
  const ex = (x - 820) / 90;
  const ez = (z - 170) / 150;
  h = Math.max(h, 48 * Math.exp(-(ex * ex + ez * ez) * 0.5));
  // Batı tepeleri
  const west = Math.max(0, -640 - x);
  h = Math.max(h, 260 * Math.pow(smooth(0, 1200, west), 0.8) * (0.7 + 0.6 * fbm2(x * 0.003, z * 0.003, 3)));
  // Şehir düzlüğü
  const cm = cityMask(x, z);
  h = lerp(h, 1.2, cm);
  // Deniz
  const sd = seaSignedDistance(x, z);
  const sea = smooth(-30, 10, sd);
  h = lerp(h, SEA_LEVEL - 12 - Math.min(40, Math.max(0, sd) * 0.03), sea);
  return h;
}

// Yol çevresindeki düz bölge (merkez çizgisine yatay mesafe, m) — bölüm ve tarafa göre.
export function flatZone(section, side) {
  switch (section) {
    case 'start': return side > 0 ? 34 : 24;
    case 'harbor': return side > 0 ? 24.5 : 22;
    case 'city': return 26;
    case 'tunnel': return 22;
    default: return 21;
  }
}

function axisCoords(min, coreMin, coreMax, max, coarse, fine) {
  const out = [];
  for (let v = min; v < coreMin; v += coarse) out.push(v);
  for (let v = coreMin; v < coreMax; v += fine) out.push(v);
  for (let v = coreMax; v <= max; v += coarse) out.push(v);
  if (out[out.length - 1] < max) out.push(max);
  return out;
}

export class Terrain {
  constructor(track) {
    this.track = track;
    const b = track.bounds;
    // Çekirdek (ince) ızgara pist çevresinde; dışarıda kaba
    this.xs = axisCoords(-2600, b.minX - 260, b.maxX + 200, 2400, 40, 8);
    this.zs = axisCoords(-2200, b.minZ - 260, b.maxZ + 140, 1500, 40, 8);
    this.nx = this.xs.length;
    this.nz = this.zs.length;
    this.heights = new Float32Array(this.nx * this.nz);
    this.flatInfo = new Float32Array(this.nx * this.nz); // 1 = yol düzlüğü içinde
    this.computeHeights();
  }

  /** Yol etkili arazi yüksekliği (ızgara düğümleri için). */
  computeHeights() {
    const tr = this.track;
    const sections = new Array(tr.N);
    for (let i = 0; i < tr.N; i++) sections[i] = tr.sectionAt(i * tr.ds);
    this.sampleSection = sections;
    const RADIUS = 90;
    for (let iz = 0; iz < this.nz; iz++) {
      const z = this.zs[iz];
      for (let ix = 0; ix < this.nx; ix++) {
        const x = this.xs[ix];
        const k = iz * this.nx + ix;
        const nat = naturalHeight(x, z);
        let dMin2 = Infinity;
        let iMin = -1;
        let wSum = 0;
        let ySum = 0;
        tr.forEachSampleNear(x, z, RADIUS, (i, d2) => {
          if (d2 < dMin2) { dMin2 = d2; iMin = i; }
          if ((i & 1) === 0) {
            const w = Math.exp(-d2 / (2 * 30 * 30));
            wSum += w;
            ySum += w * tr.py[i];
          }
        });
        if (iMin < 0) {
          this.heights[k] = nat;
          continue;
        }
        const d = Math.sqrt(dMin2);
        const side = (x - tr.px[iMin]) * tr.rx[iMin] + (z - tr.pz[iMin]) * tr.rz[iMin] >= 0 ? 1 : -1;
        const sec = sections[iMin];
        const F = flatZone(sec, side);
        const yExact = tr.py[iMin];
        const yAvg = wSum > 1e-6 ? ySum / wSum : yExact;
        const roadY = lerp(yExact, yAvg, smooth(F, F + 25, d)) - 0.3;
        let B = nat > roadY ? (sec === 'climb' ? 16 : 30) : 34;
        B = lerp(7, B, smooth(SEA_LEVEL - 3, SEA_LEVEL + 1, nat));
        if (d <= F) {
          this.heights[k] = roadY;
          this.flatInfo[k] = 1;
        } else {
          const t = smooth(F, F + B, d);
          this.heights[k] = lerp(roadY, nat, t);
          this.flatInfo[k] = 1 - t;
        }
      }
    }
  }

  cellX(x) {
    const xs = this.xs;
    let lo = 0;
    let hi = xs.length - 1;
    if (x <= xs[0]) return 0;
    if (x >= xs[hi]) return hi - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (xs[m] <= x) lo = m; else hi = m;
    }
    return lo;
  }

  cellZ(z) {
    const zs = this.zs;
    let lo = 0;
    let hi = zs.length - 1;
    if (z <= zs[0]) return 0;
    if (z >= zs[hi]) return hi - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (zs[m] <= z) lo = m; else hi = m;
    }
    return lo;
  }

  /** Mesh ile birebir aynı (üçgen içi doğrusal) yükseklik. */
  heightAt(x, z) {
    const ix = this.cellX(x);
    const iz = this.cellZ(z);
    const x0 = this.xs[ix];
    const z0 = this.zs[iz];
    const fx = Math.min(1, Math.max(0, (x - x0) / (this.xs[ix + 1] - x0)));
    const fz = Math.min(1, Math.max(0, (z - z0) / (this.zs[iz + 1] - z0)));
    const nx = this.nx;
    const ha = this.heights[iz * nx + ix];
    const hb = this.heights[iz * nx + ix + 1];
    const hd = this.heights[(iz + 1) * nx + ix];
    const he = this.heights[(iz + 1) * nx + ix + 1];
    if (fx + fz <= 1) return ha + (hb - ha) * fx + (hd - ha) * fz;
    return he + (hd - he) * (1 - fx) + (hb - he) * (1 - fz);
  }

  /** Arazi normalinin y bileşeni (eğim için). */
  slopeAt(x, z) {
    const e = 4;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return 1 / Math.sqrt(1 + (hx * hx + hz * hz) / (4 * e * e));
  }

  buildMesh() {
    const { nx, nz, xs, zs, heights } = this;
    const count = nx * nz;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    const rock = new THREE.Color(0x9a8068);
    const rockDark = new THREE.Color(0x6e5a4c);
    const scrub = new THREE.Color(0x5f7034);
    const scrubDark = new THREE.Color(0x3f5228);
    const dry = new THREE.Color(0xa69157);
    const sand = new THREE.Color(0xd9c194);
    const urban = new THREE.Color(0x9c958b);
    const roadside = new THREE.Color(0x8a8160);
    const seabed = new THREE.Color(0x2f5a5c);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const k = iz * nx + ix;
        const x = xs[ix];
        const z = zs[iz];
        const h = heights[k];
        pos[k * 3] = x;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = z;
        const ixa = Math.max(0, ix - 1);
        const ixb = Math.min(nx - 1, ix + 1);
        const iza = Math.max(0, iz - 1);
        const izb = Math.min(nz - 1, iz + 1);
        const dhx = (heights[iz * nx + ixb] - heights[iz * nx + ixa]) / (xs[ixb] - xs[ixa]);
        const dhz = (heights[izb * nx + ix] - heights[iza * nx + ix]) / (zs[izb] - zs[iza]);
        const inv = 1 / Math.sqrt(dhx * dhx + 1 + dhz * dhz);
        const ny = inv;
        nor[k * 3] = -dhx * inv;
        nor[k * 3 + 1] = ny;
        nor[k * 3 + 2] = -dhz * inv;

        // Renk
        const n1 = fbm2(x * 0.013, z * 0.013, 3);
        const n2 = vnoise(x * 0.07, z * 0.07);
        c.copy(scrub).lerp(scrubDark, n2 * 0.6).lerp(dry, smooth(0.45, 0.75, n1) * 0.8);
        // Yükseklikle kuru/kayalık
        c.lerp(dry, smooth(120, 300, h) * 0.5);
        const steep = smooth(0.86, 0.6, ny);
        c.lerp(n2 > 0.5 ? rock : rockDark, steep);
        const cm = cityMask(x, z);
        c.lerp(urban, cm * 0.9);
        // Kumsal / deniz tabanı
        const beach = smooth(SEA_LEVEL + 3.2, SEA_LEVEL + 0.4, h) * (1 - cm);
        c.lerp(sand, beach);
        c.lerp(seabed, smooth(SEA_LEVEL - 0.5, SEA_LEVEL - 4, h));
        // Yol kenarı düzlüğü
        const f = this.flatInfo[k];
        if (f > 0) c.lerp(cm > 0.5 ? urban : roadside, f * 0.75);
        col[k * 3] = c.r;
        col[k * 3 + 1] = c.g;
        col[k * 3 + 2] = c.b;
      }
    }
    // İndeksler: tamamen deniz altındaki üçgenleri atla
    const idx = [];
    const under = SEA_LEVEL - 1.5;
    for (let iz = 0; iz < nz - 1; iz++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const a = iz * nx + ix;
        const b = a + 1;
        const d = a + nx;
        const e = d + 1;
        if (heights[a] < under && heights[b] < under && heights[d] < under) {
          // tri 1 atlandı
        } else idx.push(a, d, b);
        if (heights[b] < under && heights[d] < under && heights[e] < under) {
          // tri 2 atlandı
        } else idx.push(b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    geo.computeBoundingSphere();

    const detail = terrainDetailTexture();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detail });
    // Dünya koordinatlı UV (geometride uv yok): map örneklemesini xz'den yap
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vTerrUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTerrUv = (modelMatrix * vec4(position, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vTerrUv;')
        .replace('#include <map_fragment>', `
          vec4 dA = texture2D(map, vTerrUv * 0.045);
          vec4 dB = texture2D(map, vTerrUv * 0.0071);
          diffuseColor.rgb *= (0.55 + dA.rgb * 0.75) * (0.7 + dB.rgb * 0.55);
        `);
    };
    mat.customProgramCacheKey = () => 'terrain-v1';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }
}

function terrainDetailTexture() {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const rnd = mulberry32(42);
  paintPixels(ctx, S, S, (x, y, out) => {
    const n = tileFbm(x / 16, y / 16, S / 16, S / 16, 4, 77);
    const g = tileNoise(x / 3, y / 3, S / 3, S / 3, 13);
    const v = 150 + (n - 0.5) * 120 + (g - 0.5) * 40 + (rnd() - 0.5) * 30;
    out[0] = v;
    out[1] = v;
    out[2] = v;
  });
  const tex = toTexture(canvas, { color: false, anisotropy: 8 });
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Deniz: PBR (düşük pürüzlülük → gökyüzü yansıması ve güneş parıltısı) + iki katmanlı kayan dalga normali.

function waveNormalTexture() {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const hgt = new Float32Array(S * S);
  const waves = [];
  const rnd = mulberry32(99);
  for (let i = 0; i < 9; i++) {
    // Döşenebilir olması için tamsayı frekanslar
    const fx = Math.round((rnd() - 0.5) * 10);
    const fy = Math.round(1 + rnd() * 6);
    waves.push({ fx, fy, a: 1 / Math.hypot(fx, fy), p: rnd() * Math.PI * 2 });
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let h = 0;
      for (const w of waves) h += Math.sin(((x * w.fx + y * w.fy) / S) * Math.PI * 2 + w.p) * w.a;
      h += (tileFbm(x / 16, y / 16, S / 16, S / 16, 4, 31) - 0.5) * 1.6;
      hgt[y * S + x] = h;
    }
  }
  paintPixels(ctx, S, S, (x, y, out) => {
    const l = hgt[y * S + ((x - 1 + S) % S)];
    const r = hgt[y * S + ((x + 1) % S)];
    const u = hgt[((y - 1 + S) % S) * S + x];
    const d = hgt[((y + 1) % S) * S + x];
    let nx = (l - r) * 1.4;
    let ny = (u - d) * 1.4;
    let nz = 1;
    const len = Math.hypot(nx, ny, nz);
    nx /= len; ny /= len; nz /= len;
    out[0] = (nx * 0.5 + 0.5) * 255;
    out[1] = (ny * 0.5 + 0.5) * 255;
    out[2] = (nz * 0.5 + 0.5) * 255;
  });
  return toTexture(canvas, { color: false, anisotropy: 8 });
}

/**
 * Deniz: hafif özel shader. Yansıma, pişirilmiş gökyüzü küp dokusundan (güneş diski dahil → parıltı yolu)
 * tek örnekle okunur; Fresnel + derin su rengi + iki/üç katmanlı kayan dalga normali + sis.
 */
export function createSea(skyCube, sunDir) {
  const geo = new THREE.CircleGeometry(5200, 64);
  geo.rotateX(-Math.PI / 2);
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    uWave: { value: null },
    uSky: { value: null },
    uSunDir: { value: new THREE.Vector3() },
    uDeep: { value: new THREE.Color(0x06263f) },
    uShallow: { value: new THREE.Color(0x0e5a6e) },
    uSunColor: { value: new THREE.Color(1.0, 0.62, 0.32) },
  }]);
  uniforms.uWave.value = waveNormalTexture();
  uniforms.uSky.value = skyCube;
  uniforms.uSunDir.value.copy(sunDir).normalize();
  const mat = new THREE.ShaderMaterial({
    name: 'Sea',
    uniforms,
    fog: true,
    vertexShader: /* glsl */`
      varying vec3 vSeaW;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vSeaW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform sampler2D uWave;
      uniform samplerCube uSky;
      uniform vec3 uSunDir;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uSunColor;
      varying vec3 vSeaW;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec3 toCam = cameraPosition - vSeaW;
        float dist = length(toCam.xz);
        vec3 V = normalize(toCam);
        vec2 sp = vSeaW.xz;
        vec2 w1 = texture2D(uWave, sp * 0.021 + uTime * vec2(0.011, 0.007)).xy * 2.0 - 1.0;
        vec2 w2 = texture2D(uWave, sp * 0.047 + uTime * vec2(-0.017, 0.012)).xy * 2.0 - 1.0;
        vec2 w3 = texture2D(uWave, sp * 0.0053 + uTime * vec2(0.003, -0.004)).xy * 2.0 - 1.0;
        float atten = 1.0 - smoothstep(250.0, 3200.0, dist) * 0.75;
        vec2 wv = (w1 * 0.55 + w2 * 0.45 + w3 * 0.9) * 0.5 * atten;
        vec3 N = normalize(vec3(wv.x, 1.0, wv.y));
        vec3 R = reflect(-V, N);
        R.y = abs(R.y) + 0.01;
        vec3 refl = textureCube(uSky, R).rgb;
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        vec3 water = mix(uShallow, uDeep, smoothstep(30.0, 600.0, dist)) * (0.55 + 0.45 * ndv);
        // Güneşe bakan sıcak saçılma
        float back = pow(max(dot(-V.xz, uSunDir.xz) * 0.5 + 0.5, 0.0), 3.0);
        water += uSunColor * 0.05 * back;
        vec3 col = mix(water, refl, fres);
        // Keskin güneş parıltısı
        col += uSunColor * pow(max(dot(R, uSunDir), 0.0), 900.0) * 9.0;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = SEA_LEVEL;
  mesh.name = 'sea';
  mesh.userData.uniforms = uniforms;
  return mesh;
}
