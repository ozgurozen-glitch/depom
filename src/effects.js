// Effects: son-işleme (bloom + hız/nitro gölgelendiricisi), havuzlanmış parçacıklar, lastik izleri,
// shockwave halkaları. Yalnızca sözleşmedeki Car alanlarını okur:
//   position, yaw, speedKmh, drifting, nitroActive, nitroLevel, airborne, wrecked,
//   getRearWheelPositions(), getExhaustPositions()
// Test için: ?fxq=low|medium|high kaliteyi kilitler (otomatik düşürme kapanır).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  ParticlePool, ADD, ALPHA, ADDITIVE_KINDS, ALPHA_KINDS, createAdditiveMaterial, createAlphaMaterial, syncFog,
} from './fx/particles.js';
import { TireMarks } from './fx/tiremarks.js';
import { ShockRings } from './fx/rings.js';
import { createPostMaterial } from './fx/post.js';

// Kalite seviyeleri. bloomScale = 1 → UnrealBloomPass kendi içinde yarım çözünürlükte çalışır.
const QUALITY = [
  { name: 'low', msaa: 0, bloomScale: 0.5, samples: 4, particles: 0.4, maxPixelRatio: 0.85 },
  { name: 'medium', msaa: 0, bloomScale: 0.5, samples: 6, particles: 0.7, maxPixelRatio: 1.25 },
  // MSAA 4 yarım float hedeflerde yüksek çözünürlükte ~200 MB VRAM tutup bağlam kaybına yol açabiliyor.
  { name: 'high', msaa: 2, bloomScale: 1, samples: 8, particles: 1, maxPixelRatio: 4 },
];
const FPS_WARMUP = 2.5;     // s: shader derleme vb. ilk takılmaları ölçme
const FPS_WINDOW = 3;       // s: ortalama penceresi
const FPS_MIN = 40;

const BLOOM = { strength: 0.6, radius: 0.5, threshold: 0.85 };

const SANITIZE_SHADER = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // NaN != NaN; sonsuz değerler de üst sınırı aşar.
      bvec4 bad = bvec4(c.r != c.r || c.r > 65000.0, c.g != c.g || c.g > 65000.0,
        c.b != c.b || c.b > 65000.0, c.a != c.a || c.a > 65000.0);
      if (any(bad)) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 256.0), clamp(c.a, 0.0, 1.0));
    }`,
};

// Doğrusal HDR renkler
const COL_SHOCK = [0.45, 1.1, 2.4];
const COL_SHOCK2 = [0.9, 0.35, 2.2];
const COL_PICKUP = [0.25, 1.0, 2.0];
const COL_FIRE_RING = [2.0, 0.8, 0.2];

const _v = new THREE.Vector3();
const _camVel = new THREE.Vector3();

function rnd(a, b) {
  return a + Math.random() * (b - a);
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Üstel yaklaşım; hedef yükselirken ve düşerken farklı hız.
function approach(cur, target, upRate, downRate, dt) {
  const rate = target > cur ? upRate : downRate;
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

// Birim küre içinde rastgele yön (out'a yazar).
function randomDir(out) {
  const u = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(a), u, s * Math.sin(a));
}

export class Effects {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.time = 0;
    this.lastDt = 1 / 60;

    const params = new URLSearchParams(window.location.search);
    const forced = QUALITY.findIndex((q) => q.name === params.get('fxq'));
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    this.qualityLocked = forced >= 0;
    this.quality = forced >= 0 ? forced : (coarse ? 1 : 2);
    this.fpsWarm = FPS_WARMUP;
    this.fpsTime = 0;
    this.fpsFrames = 0;
    this.measuredFps = 0;
    this.fpsLastNow = undefined;

    const size = renderer.getSize(new THREE.Vector2());
    this.width = Math.max(1, size.x);
    this.height = Math.max(1, size.y);

    this.buildComposer();

    this.additive = new ParticlePool(scene, 1800, createAdditiveMaterial(), ADDITIVE_KINDS, 20);
    this.smoke = new ParticlePool(scene, 900, createAlphaMaterial(), ALPHA_KINDS, 10);
    this.tireMarks = new TireMarks(scene, 3000, 14);
    this.rings = new ShockRings(scene, 6);
    this.applyParticleBudget();

    this.carStates = new Map();
    this.camPrev = camera.position.clone();
    this.camVel = new THREE.Vector3();

    // Yumuşatılmış son-işleme durumu
    this.speedK = 0;
    this.nitroK = 0;
    this.wreckK = 0;
    this.kick = 0;
    this.flash = 0;
    this.flashColor = new THREE.Vector3(1, 1, 1);
  }

  // ---------------------------------------------------------------- composer / kalite

  buildComposer() {
    const q = QUALITY[this.quality];
    const rt = new THREE.WebGLRenderTarget(this.width, this.height, { type: THREE.HalfFloatType, samples: q.msaa });
    rt.texture.name = 'Effects.rt';
    this.composer = new EffectComposer(this.renderer, rt);

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloomScale = q.bloomScale;
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    const baseSetSize = this.bloomPass.setSize.bind(this.bloomPass);
    this.bloomPass.setSize = (w, h) => baseSetSize(
      Math.max(4, Math.round(w * this.bloomScale)),
      Math.max(4, Math.round(h * this.bloomScale)),
    );
    this.postMaterial = createPostMaterial(q.samples);
    this.postPass = new ShaderPass(this.postMaterial);
    this.outputPass = new OutputPass();

    // NaN/sonsuz piksel temizliği: tek bir hatalı piksel bloom'un küçük mip seviyeleri üzerinden tüm ekrana
    // yayılıp görüntüyü karartabilir (bazı GPU'larda). Bloom'dan önce temizlenir.
    this.sanitizePass = new ShaderPass(SANITIZE_SHADER);

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.sanitizePass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.postPass);
    this.composer.addPass(this.outputPass);
    this.applySize();
  }

  applySize() {
    const q = QUALITY[this.quality];
    const pr = Math.min(this.renderer.getPixelRatio(), q.maxPixelRatio);
    this.composer.setPixelRatio(pr); // setSize'ı da çağırır
    this.composer.setSize(this.width, this.height);
    this.postMaterial.uniforms.uAspect.value = this.width / this.height;
  }

  applyParticleBudget() {
    const k = QUALITY[this.quality].particles;
    this.budget = k;
    this.additive.limit = Math.floor(this.additive.max * k);
    this.smoke.limit = Math.floor(this.smoke.max * k);
  }

  setQuality(level) {
    level = Math.max(0, Math.min(QUALITY.length - 1, level));
    if (level === this.quality) return;
    this.quality = level;
    const q = QUALITY[level];
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== q.msaa) {
        rt.samples = q.msaa;
        rt.dispose(); // bir sonraki kullanımda yeni örnek sayısıyla yeniden oluşturulur
      }
    }
    this.bloomScale = q.bloomScale;
    this.postMaterial.defines.SAMPLES = q.samples;
    this.postMaterial.needsUpdate = true;
    this.applySize();
    this.applyParticleBudget();
  }

  get qualityName() {
    return QUALITY[this.quality].name;
  }

  // Ortalama FPS'i gerçek duvar saatiyle ölçer (oyunun dt'si 0.1 s'ye kırpıldığından ona güvenilmez).
  measureFps(dt) {
    const now = performance.now();
    const last = this.fpsLastNow;
    this.fpsLastNow = now;
    if (this.qualityLocked || this.quality === 0 || dt <= 0 || last === undefined) return;
    const real = (now - last) / 1000;
    if (real > 2) return; // sekme değişimi / uzun takılma: yok say
    if (this.fpsWarm > 0) {
      this.fpsWarm -= real;
      return;
    }
    this.fpsTime += real;
    this.fpsFrames++;
    if (this.fpsTime >= FPS_WINDOW) {
      this.measuredFps = this.fpsFrames / this.fpsTime;
      this.fpsTime = 0;
      this.fpsFrames = 0;
      if (this.measuredFps < FPS_MIN) {
        this.setQuality(this.quality - 1);
        this.fpsWarm = 1.5;
      }
    }
  }

  // ---------------------------------------------------------------- sözleşme API'si

  resize(w, h) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.applySize();
  }

  render() {
    if (this.direct) this.renderer.render(this.scene, this.camera);
    else this.composer.render(this.lastDt);
    this.checkBlackFrame();
  }

  // Bazı GPU/sürücülerde efekt zinciri (yarım float hedefler vb.) tamamen siyah çıkabilir. İlk saniyelerde
  // ekrandan birkaç piksel okunur; üst üste hepsi siyahsa son-işleme kapatılıp sahne doğrudan çizilir.
  // Gökyüzü hiçbir zaman tam siyah olmadığından bu durum ancak bozuk bir çizim hattında oluşur.
  checkBlackFrame() {
    if (this.blackChecksLeft === undefined) {
      this.blackChecksLeft = 12;
      this.blackFrame = 0;
      this.blackStreak = 0;
      this.probe = new Uint8Array(4);
    }
    if (this.blackChecksLeft <= 0) return;
    this.blackFrame++;
    if (this.blackFrame < 20 || this.blackFrame % 20 !== 0) return;
    this.blackChecksLeft--;
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    let lit = 0;
    for (const [fx, fy] of [[0.5, 0.75], [0.2, 0.6], [0.8, 0.6], [0.5, 0.4], [0.3, 0.9]]) {
      gl.readPixels(Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.probe);
      if (this.probe[0] + this.probe[1] + this.probe[2] > 6) lit++;
    }
    this.blackStreak = lit === 0 ? this.blackStreak + 1 : 0;
    if (this.blackStreak < 3) return;
    this.blackStreak = 0;
    if (!this.direct) {
      // İlk çare: son-işlemeyi kapatıp doğrudan çiz, sonra yeniden kontrol et.
      this.direct = true;
      this.blackChecksLeft = 12;
      console.warn('Efekt zinciri siyah görüntü üretiyor; son-işleme kapatıldı, doğrudan çizime geçildi.');
      if (this.onFallback) this.onFallback();
    } else {
      this.blackChecksLeft = 0;
      if (this.onStillBlack) this.onStillBlack();
    }
  }

  update(dt, cars, player, events) {
    this.lastDt = dt > 0 ? dt : this.lastDt;
    this.time += dt;
    this.measureFps(dt);

    // Kamera hızı (kıvılcım çizgileri kameraya göre bağıl hızla uzatılır).
    const cam = this.camera.position;
    if (dt > 0) {
      _camVel.subVectors(cam, this.camPrev).divideScalar(dt);
      if (_camVel.lengthSq() > 200 * 200) _camVel.set(0, 0, 0);
      this.camVel.lerp(_camVel, 0.5);
    }
    this.camPrev.copy(cam);

    if (events && events.length) {
      for (const evt of events) this.handleEvent(evt, player);
    }

    if (cars) {
      for (const car of cars) this.updateCar(car, dt);
    }

    const fog = this.scene.fog;
    syncFog(this.additive.material.uniforms, fog);
    syncFog(this.smoke.material.uniforms, fog);
    this.additive.update(dt, this.camVel);
    this.smoke.update(dt, this.camVel);
    this.tireMarks.update(dt, fog);
    this.rings.update(dt);

    if (player) this.updatePost(dt, player);
  }

  // ---------------------------------------------------------------- araba başına sürekli efektler

  carState(car) {
    let st = this.carStates.get(car);
    if (!st) {
      st = {
        prev: car.position.clone(),
        vel: new THREE.Vector3(),
        sinceMove: 0,
        wheels: [TireMarks.createTrack(), TireMarks.createTrack()],
        flameAcc: 0,
        emberAcc: 0,
        smokeAcc: 0,
        wreckAcc: 0,
        fireAcc: 0,
        wreckTime: 0,
        lastWallHit: -1,
      };
      this.carStates.set(car, st);
    }
    return st;
  }

  updateCar(car, dt) {
    const st = this.carState(car);
    const p = car.position;

    // Hız tahmini: fizik sabit adımda ilerlediği için konum her karede değişmeyebilir; son değişimden
    // bu yana geçen süreye bölerek tutarlı bir hız elde ederiz.
    if (dt > 0) {
      st.sinceMove += dt;
      const dx = p.x - st.prev.x;
      const dy = p.y - st.prev.y;
      const dz = p.z - st.prev.z;
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        const inv = 1 / st.sinceMove;
        _v.set(dx * inv, dy * inv, dz * inv);
        if (_v.lengthSq() > 150 * 150) st.vel.set(0, 0, 0); // ışınlanma (respawn/yeniden başlatma)
        else st.vel.lerp(_v, 0.6);
        st.prev.copy(p);
        st.sinceMove = 0;
      } else if (st.sinceMove > 0.25) {
        st.vel.set(0, 0, 0);
      }
    }
    if (dt <= 0) return;

    const d2 = p.distanceToSquared(this.camera.position);
    const lod = d2 < 70 * 70 ? 1 : d2 < 160 * 160 ? 0.5 : d2 < 320 * 320 ? 0.18 : 0;

    if (car.nitroActive && !car.wrecked && lod > 0) this.emitNitro(car, st, dt, lod);
    else { st.flameAcc = 0; st.emberAcc = 0; }

    const drifting = car.drifting && !car.airborne && !car.wrecked && lod > 0;
    if (drifting) {
      this.emitDrift(car, st, dt, lod);
    } else {
      this.tireMarks.end(st.wheels[0]);
      this.tireMarks.end(st.wheels[1]);
    }

    if (car.wrecked) {
      st.wreckTime += dt;
      if (lod > 0) this.emitWreckSmoke(car, st, dt, lod);
    } else {
      st.wreckTime = 0;
    }
  }

  emitNitro(car, st, dt, lod) {
    const level = car.nitroLevel;
    const hot = level === 'perfect' || level === 'shockwave';
    const scale = level === 'shockwave' ? 1.3 : level === 'perfect' ? 1.15 : 1;
    const kind = hot ? ADD.FLAME_HOT : ADD.FLAME;
    const rate = 60 * lod * this.budget * (hot ? 1.3 : 1);
    st.flameAcc += rate * dt;
    const n = Math.min(10, Math.floor(st.flameAcc));
    st.flameAcc -= n;
    st.emberAcc += 16 * lod * this.budget * dt;
    const ne = Math.min(3, Math.floor(st.emberAcc));
    st.emberAcc -= ne;

    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);
    const v = st.vel;
    const exhausts = car.getExhaustPositions();
    for (let e = 0; e < exhausts.length; e++) {
      const ex = exhausts[e];
      // Sabit parlak çekirdek: her karede egzozda kısa ömürlü bir parıltı.
      const core = this.additive.spawn(kind, ex.x, ex.y, ex.z, v.x, v.y, v.z, 0.05, 0.13 * scale, 0.18 * scale, 1.2);
      if (core >= 0) this.additive.setAge(core, 0);
      for (let k = 0; k < n; k++) {
        const tau = ((k + Math.random()) / n) * dt;
        const back = rnd(10, 16) * scale;
        const rx = -fx * back + rnd(-1.2, 1.2);
        const ry = rnd(-0.2, 0.9);
        const rz = -fz * back + rnd(-1.2, 1.2);
        const i = this.additive.spawn(
          kind, ex.x + rx * tau, ex.y + ry * tau, ex.z + rz * tau,
          v.x + rx, v.y + ry, v.z + rz,
          rnd(0.12, 0.22) * (hot ? 1.25 : 1), 0.09 * scale, rnd(0.22, 0.32) * scale, 1,
        );
        this.additive.setAge(i, tau);
      }
      for (let k = 0; k < ne; k++) {
        const back = rnd(4, 9);
        this.additive.spawn(
          ADD.EMBER, ex.x, ex.y, ex.z,
          v.x - fx * back + rnd(-1.5, 1.5), v.y + rnd(0, 1.2), v.z - fz * back + rnd(-1.5, 1.5),
          rnd(0.35, 0.6), 0.05 * scale, 0.02, hot ? 1.5 : 1,
        );
      }
    }
  }

  emitDrift(car, st, dt, lod) {
    const wheels = car.getRearWheelPositions();
    const speedK = Math.min(1, Math.max(0.25, car.speedKmh / 140));
    const v = st.vel;

    if (lod >= 0.5) {
      const intensity = 0.45 + 0.35 * speedK;
      this.tireMarks.add(st.wheels[0], wheels[0], intensity);
      if (wheels[1]) this.tireMarks.add(st.wheels[1], wheels[1], intensity);
    }

    st.smokeAcc += 24 * speedK * lod * this.budget * dt;
    const n = Math.min(6, Math.floor(st.smokeAcc));
    st.smokeAcc -= n;
    for (let w = 0; w < wheels.length; w++) {
      const p = wheels[w];
      for (let k = 0; k < n; k++) {
        this.smoke.spawn(
          ALPHA.SMOKE,
          p.x + rnd(-0.3, 0.3), p.y + 0.3, p.z + rnd(-0.3, 0.3),
          v.x * 0.22 + rnd(-1.6, 1.6), rnd(0.4, 1.6), v.z * 0.22 + rnd(-1.6, 1.6),
          rnd(1.0, 1.8), rnd(0.35, 0.5), rnd(1.8, 2.8), rnd(0.9, 1.05),
        );
      }
    }
  }

  emitWreckSmoke(car, st, dt, lod) {
    const p = car.position;
    const v = st.vel;
    st.wreckAcc += 12 * lod * this.budget * dt;
    let n = Math.min(4, Math.floor(st.wreckAcc));
    st.wreckAcc -= n;
    while (n-- > 0) {
      this.smoke.spawn(
        ALPHA.DARK_SMOKE,
        p.x + rnd(-0.6, 0.6), p.y + rnd(0.6, 1.2), p.z + rnd(-0.6, 0.6),
        v.x * 0.3 + rnd(-0.8, 0.8), rnd(1, 2.5), v.z * 0.3 + rnd(-0.8, 0.8),
        rnd(1.4, 2.2), rnd(0.7, 1.0), rnd(2.8, 4.2), 1,
      );
    }
    if (st.wreckTime < 1.4) {
      st.fireAcc += 18 * lod * this.budget * dt;
      let f = Math.min(4, Math.floor(st.fireAcc));
      st.fireAcc -= f;
      while (f-- > 0) {
        this.additive.spawn(
          ADD.FIRE,
          p.x + rnd(-0.7, 0.7), p.y + rnd(0.4, 1.0), p.z + rnd(-0.7, 0.7),
          v.x * 0.5 + rnd(-1, 1), rnd(1, 3), v.z * 0.5 + rnd(-1, 1),
          rnd(0.3, 0.55), rnd(0.4, 0.7), rnd(0.9, 1.4), 1 - st.wreckTime / 1.6,
        );
      }
    }
  }

  // ---------------------------------------------------------------- olay efektleri

  handleEvent(e, player) {
    const car = e.car;
    if (!car || !car.position) return;
    // Uzak olaylar için efekt üretme (oyuncunun olayları her zaman işlenir).
    const involvesPlayer = car === player || e.victim === player || e.other === player;
    if (!involvesPlayer && car.position.distanceToSquared(this.camera.position) > 320 * 320) return;

    switch (e.type) {
      case 'wall_hit':
        this.wallSparks(car, e.point || car.position, e.strength ?? 0.4, e.side || 0);
        break;
      case 'bump':
        this.bumpSparks(car, e.point || car.position, e.strength ?? 0.4);
        break;
      case 'wreck':
        this.explosion(car);
        if (car === player) this.setFlash(0.28, 1.4, 0.55, 0.25);
        break;
      case 'takedown':
        this.takedownBurst(car, e.victim);
        if (car === player) {
          this.setFlash(0.14, 1.2, 0.8, 0.4);
          this.kick = Math.max(this.kick, 0.6);
        }
        break;
      case 'land':
        if (e.hard || (e.airTime ?? 0) > 0.9) this.landingDust(car, e);
        break;
      case 'nitro_start':
        this.nitroBurst(car, e.level, car === player);
        break;
      case 'pickup':
        this.pickupBurst(car);
        if (car === player) this.setFlash(0.18, 0.3, 0.8, 1.4);
        break;
      case 'respawn':
        this.respawnSparkle(car);
        break;
      default:
        break;
    }
  }

  setFlash(amount, r, g, b) {
    if (amount >= this.flash) {
      this.flash = amount;
      this.flashColor.set(r, g, b);
    }
  }

  wallSparks(car, point, strength, side) {
    const st = this.carState(car);
    let count = Math.round((5 + 32 * strength) * this.budget);
    // Duvara sürtünme her karede olay üretebilir: sürekli akışta daha az kıvılcım.
    if (this.time - st.lastWallHit < 0.12) count = Math.ceil(count * 0.25);
    st.lastWallHit = this.time;
    const v = st.vel;
    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);
    // Duvar normali yola doğru: sağ duvar (side 1) için -right.
    const rx = -Math.cos(car.yaw);
    const rz = Math.sin(car.yaw);
    const nx = -side * rx;
    const nz = -side * rz;
    for (let i = 0; i < count; i++) {
      const out = rnd(1, 6);
      const fwd = rnd(-3, 3);
      this.additive.spawn(
        ADD.SPARK, point.x, point.y + rnd(0.2, 0.7), point.z,
        v.x * rnd(0.35, 0.8) + nx * out + fx * fwd + rnd(-1.5, 1.5),
        rnd(1.5, 7),
        v.z * rnd(0.35, 0.8) + nz * out + fz * fwd + rnd(-1.5, 1.5),
        rnd(0.25, 0.6), rnd(0.035, 0.06), 0.02, rnd(0.8, 1.3),
      );
    }
    if (count > 3) {
      this.additive.spawn(ADD.FLASH, point.x, point.y + 0.5, point.z, v.x * 0.8, 0, v.z * 0.8, 0.12, 0.3, 0.9 + strength, 0.5 + strength * 0.5);
    }
  }

  bumpSparks(car, point, strength) {
    const v = this.carState(car).vel;
    const count = Math.round((6 + 22 * strength) * this.budget);
    for (let i = 0; i < count; i++) {
      randomDir(_v);
      const sp = rnd(2, 8);
      this.additive.spawn(
        ADD.SPARK, point.x, point.y + rnd(0.3, 0.8), point.z,
        v.x * 0.7 + _v.x * sp, Math.abs(_v.y) * sp + 1.5, v.z * 0.7 + _v.z * sp,
        rnd(0.2, 0.5), rnd(0.03, 0.05), 0.02, 1,
      );
    }
    this.additive.spawn(ADD.FLASH, point.x, point.y + 0.6, point.z, v.x * 0.8, 0, v.z * 0.8, 0.1, 0.3, 0.8 + strength, 0.6);
  }

  explosion(car) {
    const p = car.position;
    const v = this.carState(car).vel;
    const b = this.budget;
    const cy = p.y + 0.8;
    this.additive.spawn(ADD.FLASH, p.x, cy, p.z, v.x * 0.5, 0, v.z * 0.5, 0.34, 1.0, 3.4, 1);
    this.additive.spawn(ADD.FLASH, p.x, cy, p.z, v.x * 0.5, 0, v.z * 0.5, 0.14, 0.6, 1.8, 1.2);
    for (let i = Math.round(16 * b); i > 0; i--) {
      randomDir(_v);
      const sp = rnd(2, 7);
      this.additive.spawn(
        ADD.FIRE, p.x + _v.x, cy + Math.abs(_v.y) * 0.5, p.z + _v.z,
        v.x * 0.4 + _v.x * sp, Math.abs(_v.y) * sp + rnd(1, 4), v.z * 0.4 + _v.z * sp,
        rnd(0.5, 0.95), rnd(0.5, 0.8), rnd(1.4, 2.2), 0.8,
      );
    }
    for (let i = Math.round(40 * b); i > 0; i--) {
      randomDir(_v);
      const sp = rnd(6, 20);
      this.additive.spawn(
        ADD.SPARK, p.x, cy, p.z,
        v.x * 0.5 + _v.x * sp, Math.abs(_v.y) * sp + 3, v.z * 0.5 + _v.z * sp,
        rnd(0.5, 1.1), rnd(0.04, 0.07), 0.02, 1.2,
      );
    }
    for (let i = Math.round(18 * b); i > 0; i--) {
      randomDir(_v);
      const sp = rnd(4, 11);
      this.smoke.spawn(
        ALPHA.DEBRIS, p.x, cy, p.z,
        v.x * 0.55 + _v.x * sp, rnd(4, 11), v.z * 0.55 + _v.z * sp,
        rnd(0.9, 1.6), rnd(0.07, 0.16), rnd(0.06, 0.12), 1,
      );
    }
    for (let i = Math.round(9 * b); i > 0; i--) {
      randomDir(_v);
      this.smoke.spawn(
        ALPHA.DARK_SMOKE, p.x + _v.x * 1.2, cy + rnd(0, 0.8), p.z + _v.z * 1.2,
        v.x * 0.35 + _v.x * 3, rnd(1.5, 3.5), v.z * 0.35 + _v.z * 3,
        rnd(1.6, 2.6), rnd(1.0, 1.5), rnd(4.0, 5.5), 1,
      );
    }
    this.rings.spawn(car, COL_FIRE_RING, { r0: 1, r1: 7, duration: 0.4, thickness: 0.07, alpha: 0.5 });
  }

  takedownBurst(attacker, victim) {
    if (!victim || !victim.position) return;
    const a = attacker.position;
    const b = victim.position;
    _v.set((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.7, (a.z + b.z) / 2);
    const px = _v.x;
    const py = _v.y;
    const pz = _v.z;
    const v = this.carState(attacker).vel;
    for (let i = Math.round(26 * this.budget); i > 0; i--) {
      randomDir(_v);
      const sp = rnd(4, 14);
      this.additive.spawn(
        ADD.SPARK, px, py, pz,
        v.x * 0.6 + _v.x * sp, Math.abs(_v.y) * sp + 2, v.z * 0.6 + _v.z * sp,
        rnd(0.35, 0.8), rnd(0.04, 0.065), 0.02, 1.3,
      );
    }
    this.additive.spawn(ADD.FLASH, px, py, pz, v.x * 0.7, 0, v.z * 0.7, 0.18, 0.6, 2.6, 1);
  }

  landingDust(car, e) {
    const st = this.carState(car);
    const v = st.vel;
    const p = car.position;
    const strength = Math.min(1, 0.4 + (e.airTime ?? 0.5) * 0.4);
    for (let i = Math.round(14 * this.budget * strength); i > 0; i--) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(2.5, 6);
      this.smoke.spawn(
        ALPHA.DUST, p.x + Math.cos(a) * 1.2, p.y + 0.25, p.z + Math.sin(a) * 1.2,
        v.x * 0.3 + Math.cos(a) * sp, rnd(0.3, 1.4), v.z * 0.3 + Math.sin(a) * sp,
        rnd(0.7, 1.2), rnd(0.5, 0.8), rnd(2.2, 3.2), 1,
      );
    }
    const wheels = car.getRearWheelPositions();
    for (let w = 0; w < wheels.length; w++) {
      const q = wheels[w];
      for (let i = Math.round(7 * this.budget); i > 0; i--) {
        this.additive.spawn(
          ADD.SPARK, q.x, q.y + 0.1, q.z,
          v.x * rnd(0.4, 0.8) + rnd(-2, 2), rnd(1, 4), v.z * rnd(0.4, 0.8) + rnd(-2, 2),
          rnd(0.2, 0.45), rnd(0.03, 0.05), 0.02, 1,
        );
      }
    }
  }

  nitroBurst(car, level, isPlayer) {
    const v = this.carState(car).vel;
    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);
    const hot = level === 'perfect' || level === 'shockwave';
    const exhausts = car.getExhaustPositions();
    const n = Math.round((hot ? 12 : 6) * this.budget);
    for (let e = 0; e < exhausts.length; e++) {
      const ex = exhausts[e];
      for (let i = 0; i < n; i++) {
        const back = rnd(12, 24);
        this.additive.spawn(
          hot ? ADD.FLAME_HOT : ADD.FLAME, ex.x, ex.y, ex.z,
          v.x - fx * back + rnd(-3, 3), v.y + rnd(-0.5, 2), v.z - fz * back + rnd(-3, 3),
          rnd(0.2, 0.35), 0.15, hot ? 0.55 : 0.4, 1,
        );
      }
    }
    if (level === 'shockwave') {
      this.rings.spawn(car, COL_SHOCK, { r0: 1.5, r1: 20, duration: 0.7, thickness: 0.04, alpha: 0.75 });
      this.rings.spawn(car, COL_SHOCK2, { r0: 1, r1: 12, duration: 0.8, thickness: 0.07, alpha: 0.45, delay: 0.08 });
      const p = car.position;
      for (let i = Math.round(48 * this.budget); i > 0; i--) {
        const a = Math.random() * Math.PI * 2;
        const sp = rnd(18, 34);
        this.additive.spawn(
          ADD.SHOCK, p.x + Math.cos(a) * 1.5, p.y + rnd(0.2, 1.2), p.z + Math.sin(a) * 1.5,
          v.x + Math.cos(a) * sp, rnd(-0.5, 1.5), v.z + Math.sin(a) * sp,
          rnd(0.3, 0.55), rnd(0.06, 0.1), 0.03, 1,
        );
      }
      if (isPlayer) {
        this.setFlash(0.22, 0.45, 0.8, 1.4);
        this.kick = 1;
      }
    } else if (level === 'perfect') {
      if (isPlayer) {
        this.setFlash(0.16, 0.5, 0.9, 1.5);
        this.kick = Math.max(this.kick, 0.7);
      }
    } else if (isPlayer) {
      this.kick = Math.max(this.kick, 0.35);
    }
  }

  pickupBurst(car) {
    const p = car.position;
    const v = this.carState(car).vel;
    for (let i = Math.round(28 * this.budget); i > 0; i--) {
      randomDir(_v);
      const sp = rnd(3, 9);
      this.additive.spawn(
        ADD.GLOW, p.x + _v.x * 0.5, p.y + 1 + _v.y * 0.5, p.z + _v.z * 0.5,
        v.x * 0.85 + _v.x * sp, _v.y * sp + 2, v.z * 0.85 + _v.z * sp,
        rnd(0.35, 0.7), rnd(0.07, 0.13), 0.03, 1,
      );
    }
    this.additive.spawn(ADD.GLOW, p.x, p.y + 1, p.z, v.x, v.y, v.z, 0.25, 0.8, 3.2, 1.2);
    this.rings.spawn(car, COL_PICKUP, { r0: 0.8, r1: 7, duration: 0.45, thickness: 0.08, alpha: 0.9 });
  }

  respawnSparkle(car) {
    const p = car.position;
    for (let i = Math.round(16 * this.budget); i > 0; i--) {
      randomDir(_v);
      this.additive.spawn(
        ADD.GLOW, p.x + _v.x * 1.6, p.y + 0.6 + Math.abs(_v.y), p.z + _v.z * 1.6,
        _v.x, rnd(1, 3), _v.z,
        rnd(0.4, 0.8), 0.08, 0.02, 0.8,
      );
    }
    this.rings.spawn(car, COL_PICKUP, { r0: 3.5, r1: 1, duration: 0.5, thickness: 0.1, alpha: 0.6 });
  }

  // ---------------------------------------------------------------- son-işleme parametreleri

  updatePost(dt, player) {
    const u = this.postMaterial.uniforms;
    const sp = player.speedKmh || 0;

    const level = player.nitroLevel;
    const nitroTarget = player.nitroActive ? (level === 'shockwave' ? 1.35 : level === 'perfect' ? 1.15 : 1) : 0;
    this.nitroK = approach(this.nitroK, nitroTarget, 7, 2.2, dt);
    this.speedK = approach(this.speedK, smoothstep(130, 330, sp), 3, 3, dt);
    this.wreckK = approach(this.wreckK, player.wrecked ? 1 : 0, 6, 1.6, dt);
    this.kick *= Math.exp(-dt * 3);
    this.flash *= Math.exp(-dt * 5.5);

    const calm = 1 - this.wreckK * 0.75;
    const nk = this.nitroK;
    u.uTime.value = this.time;
    u.uBlur.value = Math.min(1.4, this.speedK * 0.28 + nk * 0.55 + this.kick * 0.55) * calm;
    u.uAberration.value = Math.min(1.2, nk * 0.5 + this.speedK * 0.12 + this.kick * 0.5 + this.wreckK * 0.45);
    const lines = Math.max(smoothstep(215, 300, sp) * 0.55, Math.min(1, nk) * 0.85) * (1 - this.wreckK);
    u.uLines.value = lines;
    const lc = u.uLineColor.value;
    const lk = Math.min(1, nk);
    lc.set(0.42 - 0.17 * lk, 0.46 + 0.1 * lk, 0.52 + 0.68 * lk);
    u.uVignette.value = 0.22 + this.speedK * 0.16 + Math.min(1, nk) * 0.12 + this.wreckK * 0.35;
    u.uEdgeTint.value.set(
      0.03 * nk + 0.32 * this.wreckK,
      0.03 * nk + 0.01 * this.wreckK,
      0.16 * nk + 0.01 * this.wreckK,
    );
    u.uDesat.value = this.wreckK * 0.5;
    u.uTint.value.set(1.15, 0.82, 0.8);
    u.uFlash.value = this.flash;
    u.uFlashColor.value.copy(this.flashColor);

    this.bloomPass.strength = BLOOM.strength + Math.min(1, nk) * 0.15 + this.flash * 0.25;
  }
}
