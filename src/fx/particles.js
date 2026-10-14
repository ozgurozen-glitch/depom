// Havuzlanmış GPU parçacıkları: tek bir InstancedBufferGeometry (dörtgen) + örnek başına öznitelikler.
// Karede tahsis yok: simülasyon dizileri sabit boyutlu, ölen parçacık son parçacıkla yer değiştirir
// (swap-remove), böylece canlı parçacıklar her zaman [0, count) aralığındadır ve instanceCount = count.
import * as THREE from 'three';

// Ortak köşe gölgelendiricisi: yuvarlak billboard (dönüşlü) veya hıza göre uzatılmış çizgi (streak).
const VERT = /* glsl */ `
attribute vec4 iPosSize;   // xyz dünya konumu, w yarı-boyut (m)
attribute vec4 iColor;     // doğrusal (HDR) renk + alfa
attribute vec4 iStretch;   // xyz kuyruk vektörü (dünya), w dönüş (rad)
uniform vec4 uFog;         // x near, y far, z density, w mod (0 yok, 1 doğrusal, 2 exp2)
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
varying float vStreak;

void main() {
  vec4 mv = viewMatrix * vec4(iPosSize.xyz, 1.0);
  float size = iPosSize.w;
  vec2 c = position.xy;
  vStreak = 0.0;
  if (dot(iStretch.xyz, iStretch.xyz) > 1e-6) {
    vec4 tail = viewMatrix * vec4(iPosSize.xyz - iStretch.xyz, 1.0);
    vec2 d = mv.xy - tail.xy;
    float len = length(d);
    vec2 dir = len > 1e-5 ? d / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    mv.xyz = mix(tail.xyz, mv.xyz, c.x * 0.5 + 0.5);
    mv.xy += dir * (c.x * size) + nrm * (c.y * size);
    vStreak = 1.0;
  } else {
    float s = sin(iStretch.w);
    float co = cos(iStretch.w);
    mv.xy += vec2(c.x * co - c.y * s, c.x * s + c.y * co) * size;
  }
  vUv = c;
  vColor = iColor;
  float depth = -mv.z;
  vFog = 0.0;
  if (uFog.w > 1.5) {
    float fd = uFog.z * depth;
    vFog = 1.0 - exp(-fd * fd);
  } else if (uFog.w > 0.5) {
    vFog = smoothstep(uFog.x, uFog.y, depth);
  }
  gl_Position = projectionMatrix * mv;
}
`;

// Eklemeli (additive) parlak parçacıklar: alevler, kıvılcımlar, flaşlar.
const FRAG_ADD = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
varying float vStreak;

void main() {
  float a;
  if (vStreak > 0.5) {
    float across = 1.0 - smoothstep(0.0, 1.0, abs(vUv.y));
    float along = smoothstep(1.0, 0.55, abs(vUv.x)) * (0.3 + 0.7 * (vUv.x * 0.5 + 0.5));
    a = across * across * along;
  } else {
    float r = length(vUv);
    a = 1.0 - smoothstep(0.0, 1.0, r);
    a *= a;
  }
  a *= vColor.a * (1.0 - vFog);
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}
`;

// Alfa karışımlı parçacıklar: duman, toz, enkaz parçaları.
const FRAG_ALPHA = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uFogColor;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
varying float vStreak;

void main() {
  float a;
  if (vStreak > 0.5) {
    // Enkaz: sert kenarlı küçük parça.
    a = (1.0 - smoothstep(0.55, 0.8, abs(vUv.y))) * (1.0 - smoothstep(0.7, 0.95, abs(vUv.x)));
  } else {
    a = texture2D(uMap, vUv * 0.5 + 0.5).a;
  }
  a *= vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(vColor.rgb, uFogColor, vFog), a);
}
`;

// Parçacık türleri. Renkler doğrusal uzayda ve HDR (bloom eşiği ~0.85 olduğundan > 1 değerler parlar).
// stops: [t, r, g, b, a]; drag: 1/s; gravity: m/s² (+ yukarı); stretch: hız × saniye (0 = yuvarlak).
export const ADD = { FLAME: 0, FLAME_HOT: 1, GLOW: 2, SPARK: 3, FLASH: 4, FIRE: 5, SHOCK: 6, EMBER: 7 };
export const ALPHA = { SMOKE: 0, DARK_SMOKE: 1, DUST: 2, DEBRIS: 3 };

export const ADDITIVE_KINDS = [
  { // FLAME — beyaz-camgöbeği çekirdek → mavi → mor
    stops: [[0, 1.5, 2.7, 4.2, 0.9], [0.3, 0.22, 1.0, 3.8, 0.75], [0.7, 0.4, 0.32, 2.8, 0.4], [1, 0.22, 0.08, 1.2, 0]],
    drag: 0, gravity: 0.6, stretch: 0.045, spin: 4,
  },
  { // FLAME_HOT — perfect/shockwave: daha parlak, pembe-mor kuyruk
    stops: [[0, 2.4, 3.0, 4.8, 0.95], [0.25, 0.7, 1.2, 4.6, 0.8], [0.6, 1.5, 0.4, 3.8, 0.45], [1, 0.7, 0.08, 1.5, 0]],
    drag: 0, gravity: 0.6, stretch: 0.045, spin: 5,
  },
  { // GLOW — mavi parıltı (pickup)
    stops: [[0, 2.0, 4.5, 6.0, 1], [0.5, 0.4, 1.8, 4.5, 0.8], [1, 0.1, 0.5, 2.0, 0]],
    drag: 2.6, gravity: -1.5, stretch: 0.05, spin: 0,
  },
  { // SPARK — turuncu kıvılcım çizgisi
    stops: [[0, 6.0, 4.2, 1.8, 1], [0.45, 4.0, 1.5, 0.35, 1], [1, 1.4, 0.25, 0.04, 0]],
    drag: 0.7, gravity: -15, stretch: 0.035, spin: 0,
  },
  { // FLASH — kısa, büyük patlama flaşı
    stops: [[0, 2.2, 1.7, 1.1, 0.9], [0.25, 1.7, 0.75, 0.22, 0.7], [1, 0.3, 0.06, 0.02, 0]],
    drag: 0, gravity: 0, stretch: 0, spin: 0,
  },
  { // FIRE — ateş topu
    stops: [[0, 5.0, 2.8, 0.9, 0.9], [0.35, 2.6, 0.7, 0.12, 0.65], [1, 0.25, 0.06, 0.02, 0]],
    drag: 2.2, gravity: 3.5, stretch: 0, spin: 2,
  },
  { // SHOCK — shockwave radyal çizgileri (camgöbeği-beyaz)
    stops: [[0, 3.0, 5.0, 7.0, 1], [0.5, 0.8, 2.4, 6.0, 0.8], [1, 0.3, 0.4, 3.0, 0]],
    drag: 3.2, gravity: 0, stretch: 0.06, spin: 0,
  },
  { // EMBER — nitro kuyruğunda geride kalan parlak zerreler
    stops: [[0, 1.6, 2.6, 6.0, 0.9], [0.5, 1.2, 0.6, 4.5, 0.6], [1, 0.5, 0.1, 1.5, 0]],
    drag: 4.5, gravity: 0.5, stretch: 0.03, spin: 0,
  },
];

export const ALPHA_KINDS = [
  { // SMOKE — açık gri lastik dumanı
    stops: [[0, 0.9, 0.9, 0.93, 0], [0.1, 0.86, 0.86, 0.88, 0.32], [0.5, 0.8, 0.8, 0.82, 0.16], [1, 0.76, 0.76, 0.78, 0]],
    drag: 2.0, gravity: 0.9, stretch: 0, spin: 0.9,
  },
  { // DARK_SMOKE — enkaz dumanı
    stops: [[0, 0.1, 0.09, 0.08, 0], [0.1, 0.07, 0.065, 0.06, 0.78], [0.6, 0.16, 0.15, 0.15, 0.4], [1, 0.3, 0.29, 0.28, 0]],
    drag: 1.3, gravity: 2.8, stretch: 0, spin: 0.6,
  },
  { // DUST — sert inişte toz
    stops: [[0, 0.6, 0.53, 0.43, 0], [0.1, 0.56, 0.5, 0.41, 0.5], [1, 0.5, 0.46, 0.4, 0]],
    drag: 3.2, gravity: 0.4, stretch: 0, spin: 0.7,
  },
  { // DEBRIS — koyu enkaz parçaları
    stops: [[0, 0.06, 0.06, 0.07, 1], [0.8, 0.05, 0.05, 0.06, 1], [1, 0.05, 0.05, 0.06, 0]],
    drag: 0.35, gravity: -16, stretch: 0.03, spin: 0,
  },
];

let puffTexture = null;
// Yumuşak, hafif düzensiz duman bulutu dokusu (CanvasTexture, ağ yok).
function getPuffTexture() {
  if (puffTexture) return puffTexture;
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const g = cv.getContext('2d');
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  // Merkezde yoğun, kenarlara doğru seyrelen çok sayıda küçük top → karnabahar gibi düzensiz bulut.
  for (let i = 0; i < 34; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * size * 0.3;
    const r = size * (0.07 + rnd() * 0.12) * (1 - d / (size * 0.55));
    const x = size / 2 + Math.cos(a) * d;
    const y = size / 2 + Math.sin(a) * d;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const alpha = 0.18 + rnd() * 0.25;
    grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
    grad.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.45})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  // Kenarları kesin sıfıra indir (dörtgen kenarı görünmesin).
  g.globalCompositeOperation = 'destination-in';
  const mask = g.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size / 2);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = mask;
  g.fillRect(0, 0, size, size);
  puffTexture = new THREE.CanvasTexture(cv);
  puffTexture.generateMipmaps = true;
  puffTexture.minFilter = THREE.LinearMipmapLinearFilter;
  return puffTexture;
}

function makeFogUniforms() {
  return {
    uFog: { value: new THREE.Vector4(0, 1, 0, 0) },
    uFogColor: { value: new THREE.Color(0, 0, 0) },
  };
}

export function createAdditiveMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: makeFogUniforms(),
    vertexShader: VERT,
    fragmentShader: FRAG_ADD,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function createAlphaMaterial() {
  const uniforms = makeFogUniforms();
  uniforms.uMap = { value: getPuffTexture() };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG_ALPHA,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
}

// Sahne sisini parçacık/iz gölgelendiricilerine aktarır.
export function syncFog(uniforms, fog) {
  const f = uniforms.uFog.value;
  if (!fog) {
    f.w = 0;
    return;
  }
  if (fog.isFogExp2) {
    f.set(0, 1, fog.density, 2);
  } else {
    f.set(fog.near, fog.far, 0, 1);
  }
  if (uniforms.uFogColor) uniforms.uFogColor.value.copy(fog.color);
}

export class ParticlePool {
  constructor(scene, max, material, kinds, renderOrder) {
    this.max = max;
    this.limit = max; // kalite seviyesine göre etkin üst sınır
    this.count = 0;
    this.kinds = kinds;
    this.material = material;

    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.bright = new Float32Array(max);
    this.kind = new Uint8Array(max);

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPosSize = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aStretch = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPosSize', this.aPosSize);
    geo.setAttribute('iColor', this.aColor);
    geo.setAttribute('iStretch', this.aStretch);
    geo.instanceCount = 0;
    this.geometry = geo;
    this.attrs = [this.aPosSize, this.aColor, this.aStretch];

    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  get free() {
    return this.limit - this.count;
  }

  // Yeni parçacık; havuz doluysa -1 döner (en kötü durumda efekt eksik çizilir, tahsis yapılmaz).
  spawn(kind, x, y, z, vx, vy, vz, life, size0, size1, bright = 1) {
    if (this.count >= this.limit) return -1;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.rot[i] = Math.random() * Math.PI * 2;
    const k = this.kinds[kind];
    this.spin[i] = (Math.random() - 0.5) * 2 * k.spin;
    this.bright[i] = bright;
    this.kind[i] = kind;
    return i;
  }

  // Kare içi ara zamanda doğmuş parçacık için yaşı önceden ayarla (düşük FPS'te boşluksuz alev akışı).
  setAge(i, t) {
    if (i >= 0) this.age[i] = Math.min(t, this.life[i] * 0.9);
  }

  clear() {
    this.count = 0;
    this.geometry.instanceCount = 0;
  }

  // camVel: kamera hızı (çizgi uzatması kameraya göre bağıl hızla yapılır → gerçekçi hareket bulanıklığı).
  update(dt, camVel) {
    const { pos, vel, age, life, kinds } = this;
    const ps = this.aPosSize.array;
    const cl = this.aColor.array;
    const st = this.aStretch.array;
    const cvx = camVel.x;
    const cvy = camVel.y;
    const cvz = camVel.z;

    let n = this.count;
    let i = 0;
    while (i < n) {
      age[i] += dt;
      if (age[i] >= life[i]) {
        n--;
        if (i !== n) this.copy(n, i);
        continue;
      }
      const k = kinds[this.kind[i]];
      const i3 = i * 3;
      if (dt > 0) {
        if (k.drag > 0) {
          const damp = Math.max(0, 1 - k.drag * dt);
          vel[i3] *= damp;
          vel[i3 + 1] *= damp;
          vel[i3 + 2] *= damp;
        }
        vel[i3 + 1] += k.gravity * dt;
        pos[i3] += vel[i3] * dt;
        pos[i3 + 1] += vel[i3 + 1] * dt;
        pos[i3 + 2] += vel[i3 + 2] * dt;
        this.rot[i] += this.spin[i] * dt;
      }

      const t = age[i] / life[i];
      const e = 1 - (1 - t) * (1 - t);
      const i4 = i * 4;
      ps[i4] = pos[i3];
      ps[i4 + 1] = pos[i3 + 1];
      ps[i4 + 2] = pos[i3 + 2];
      ps[i4 + 3] = this.size0[i] + (this.size1[i] - this.size0[i]) * e;

      // Renk gradyanı
      const stops = k.stops;
      let s = 1;
      while (s < stops.length - 1 && stops[s][0] < t) s++;
      const a = stops[s - 1];
      const b = stops[s];
      const f = b[0] > a[0] ? Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))) : 1;
      const fe = f * f * (3 - 2 * f); // yumuşatılmış ara değer: gradyan duraklarında köşe yok
      const br = this.bright[i];
      cl[i4] = (a[1] + (b[1] - a[1]) * fe) * br;
      cl[i4 + 1] = (a[2] + (b[2] - a[2]) * fe) * br;
      cl[i4 + 2] = (a[3] + (b[3] - a[3]) * fe) * br;
      cl[i4 + 3] = a[4] + (b[4] - a[4]) * fe;

      if (k.stretch > 0) {
        st[i4] = (vel[i3] - cvx) * k.stretch;
        st[i4 + 1] = (vel[i3 + 1] - cvy) * k.stretch;
        st[i4 + 2] = (vel[i3 + 2] - cvz) * k.stretch;
      } else {
        st[i4] = 0;
        st[i4 + 1] = 0;
        st[i4 + 2] = 0;
      }
      st[i4 + 3] = this.rot[i];
      i++;
    }
    this.count = n;

    this.geometry.instanceCount = n;
    if (n > 0) {
      for (const attr of this.attrs) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, n * 4);
        attr.needsUpdate = true;
      }
    }
  }

  copy(from, to) {
    const f3 = from * 3;
    const t3 = to * 3;
    this.pos[t3] = this.pos[f3];
    this.pos[t3 + 1] = this.pos[f3 + 1];
    this.pos[t3 + 2] = this.pos[f3 + 2];
    this.vel[t3] = this.vel[f3];
    this.vel[t3 + 1] = this.vel[f3 + 1];
    this.vel[t3 + 2] = this.vel[f3 + 2];
    this.age[to] = this.age[from];
    this.life[to] = this.life[from];
    this.size0[to] = this.size0[from];
    this.size1[to] = this.size1[from];
    this.rot[to] = this.rot[from];
    this.spin[to] = this.spin[from];
    this.bright[to] = this.bright[from];
    this.kind[to] = this.kind[from];
  }
}
