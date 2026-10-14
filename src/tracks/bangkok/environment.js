// BangkokEnvironment: gece gökyüzü (küp dokuya pişirilir), neon silüetli PMREM ortam haritası (ıslak yol ve
// araba boyası yansımaları), mor-lacivert pus, ay ışığı (gölgesi oyuncuyu izler), oyuncunun çevresindeki
// neon/lamba noktalarına taşınan 3 PointLight ve tüm mekân.
import * as THREE from 'three';
import { createNightSkyMaterial, createSkyMesh } from './sky.js';
import { createContext, LOW_SPEC } from './context.js';
import { buildRiver } from './river.js';
import { buildCity } from './city.js';
import { buildBts, buildExpressway, buildTemple, buildGantry } from './landmarks.js';
import { buildStreet } from './street.js';
import { createDrizzle } from './rain.js';

const MOON_DIR = new THREE.Vector3(0.45, 0.62, -0.64).normalize(); // kuzeydoğu, ~38°
const FOG_COLOR = new THREE.Color(0.075, 0.055, 0.11);
const FOG_DENSITY = 0.00125;
const SHADOW_HALF = LOW_SPEC ? 80 : 95;
const SHADOW_MAP = LOW_SPEC ? 1024 : 2048;
const POINT_LIGHTS = 3;
const LIGHT_REACH = 70; // m (s boyunca)

/** Işık noktalarını s boyunca en az `gap` m aralıkla seyrelt (aynı ışığın sıradaki noktası uzakta kalsın). */
function thinSpots(spots, L, gap) {
  const sorted = spots.slice().sort((a, b) => a.s - b.s);
  const out = [];
  for (const sp of sorted) {
    const last = out[out.length - 1];
    if (last && sp.s - last.s < gap) {
      if (sp.strength > last.strength) out[out.length - 1] = sp;
      continue;
    }
    out.push(sp);
  }
  while (out.length > 1 && out[0].s + L - out[out.length - 1].s < gap) out.pop();
  // Işık sayısının katı olsun ki ışık i'nin noktaları tur boyunca eşit aralıklı kalsın
  while (out.length % POINT_LIGHTS !== 0) out.pop();
  return out;
}

export class BangkokEnvironment {
  constructor(scene, renderer, track) {
    this.scene = scene;
    this.renderer = renderer;
    this.track = track;
    this.time = 0;
    scene.fog = new THREE.FogExp2(FOG_COLOR.clone(), FOG_DENSITY);

    const t0 = performance.now();
    this.bakeSky();
    this.buildEnvironmentMap();
    const skyMs = Math.round(performance.now() - t0);

    // Işıklar: gece yarıküresi + ay (gölgeli) + 3 hareketli nokta ışığı
    this.hemi = new THREE.HemisphereLight(0x4a54a0, 0x2a1a24, 0.9);
    scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0xa8bcff, 0.9);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const sc = this.moon.shadow.camera;
    sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF;
    sc.near = 20; sc.far = 1400;
    sc.updateProjectionMatrix();
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.08;
    scene.add(this.moon);
    scene.add(this.moon.target);
    this.lightDir = MOON_DIR.clone();
    this.lsRight = new THREE.Vector3().crossVectors(this.lightDir, new THREE.Vector3(0, 1, 0)).normalize();
    this.lsUp = new THREE.Vector3().crossVectors(this.lsRight, this.lightDir).normalize();
    this.shadowCenter = new THREE.Vector3();
    this.prevFocus = null;
    this.lead = new THREE.Vector3();
    this.focusS = null;

    this.points = [];
    for (let i = 0; i < POINT_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 46, 2);
      l.name = `neon-light-${i}`;
      scene.add(l);
      this.points.push({ light: l, cur: -1 });
    }

    // Mekân
    const group = new THREE.Group();
    group.name = 'bangkok-scenery';
    scene.add(group);
    this.group = group;
    // Kurulum süreleri (ms) — this.stats.timing'de (test/ayar için)
    const timing = { sky: skyMs };
    let tPrev = performance.now();
    const lap = (name) => {
      const t = performance.now();
      timing[name] = Math.round(t - tPrev);
      tPrev = t;
    };
    const ctx = createContext(track, group);
    lap('context');
    this.temple = buildTemple(ctx);
    this.bts = buildBts(ctx);
    const xw = buildExpressway(ctx);
    ctx.expresswayLamps = xw.lampSpots;
    buildGantry(ctx);
    lap('landmarks');
    const city = buildCity(ctx);
    lap('city');
    this.river = buildRiver(ctx);
    lap('river');
    buildStreet(ctx);
    lap('street');
    this.city = city.finalize();
    lap('cityMeshes');
    this.lightSpots = thinSpots(ctx.lightSpots, track.length, 48);
    this.stats = {
      buildings: city.buildings.length, signs: city.signs.length, lightSpots: this.lightSpots.length, streaks: ctx.streaks.length, timing,
    };

    this.drizzle = createDrizzle(LOW_SPEC ? 700 : 1600);
    scene.add(this.drizzle.mesh);
  }

  bakeSky() {
    const skyScene = new THREE.Scene();
    const mat = createNightSkyMaterial({ moonDir: MOON_DIR, fogColor: FOG_COLOR });
    skyScene.add(createSkyMesh(mat));
    const rt = new THREE.WebGLCubeRenderTarget(512, {
      type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
    });
    const cubeCam = new THREE.CubeCamera(0.1, 100, rt);
    cubeCam.update(this.renderer, skyScene);
    skyScene.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    mat.dispose();
    this.skyTarget = rt;
    this.scene.background = rt.texture;
  }

  buildEnvironmentMap() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envMat = createNightSkyMaterial({ moonDir: MOON_DIR, fogColor: FOG_COLOR, envMode: true });
    envScene.add(createSkyMesh(envMat));
    // Birkaç parlak neon panel (yakın yansımalar için belirgin renk lekeleri)
    const panelGeo = new THREE.PlaneGeometry(1, 1);
    const panels = [
      [new THREE.Color(2, 0.25, 1.5), 0.3, 0.12, 0.9, 0.35],
      [new THREE.Color(0.2, 1.5, 2), 1.9, 0.08, 1.1, 0.25],
      [new THREE.Color(2, 1.1, 0.25), 2.6, 0.1, 0.8, 0.3],
      [new THREE.Color(1.8, 0.2, 0.4), 4.6, 0.15, 0.7, 0.4],
      [new THREE.Color(0.8, 0.4, 2), 5.6, 0.06, 1.0, 0.22],
    ];
    const mats = [];
    for (const [c, az, el, w, h] of panels) {
      const m = new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide });
      mats.push(m);
      const p = new THREE.Mesh(panelGeo, m);
      const r = 8;
      p.position.set(Math.cos(az) * r, Math.sin(el) * r, Math.sin(az) * r);
      p.scale.set(w * r * 0.4, h * r * 0.4, 1);
      p.lookAt(0, p.position.y, 0);
      envScene.add(p);
    }
    const rt = pmrem.fromScene(envScene, 0, 0.1, 100);
    this.scene.environment = rt.texture;
    this.envTarget = rt;
    envScene.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    envMat.dispose();
    for (const m of mats) m.dispose();
    pmrem.dispose();
  }

  /** Sahneye eklenmemiş GPU kaynakları: gökyüzü küp hedefi, PMREM hedefi ve ayın gölge haritası. */
  dispose() {
    this.moon.dispose();
    for (const p of this.points) p.light.dispose();
    if (this.skyTarget) this.skyTarget.dispose();
    if (this.envTarget) this.envTarget.dispose();
    this.skyTarget = null;
    this.envTarget = null;
  }

  update(dt, focusPos) {
    this.time += dt;
    const t = this.time;
    this.city.update(dt, t);
    this.river.update(dt, t);
    this.bts.update(dt);
    if (!focusPos) return;
    this.drizzle.update(dt, focusPos);

    // Gölge kutusu: oyuncunun biraz önüne kaydır, texel'e yasla (Riviera ile aynı yöntem)
    if (this.prevFocus && dt > 0) {
      const vx = (focusPos.x - this.prevFocus.x) / dt;
      const vz = (focusPos.z - this.prevFocus.z) / dt;
      const sp = Math.hypot(vx, vz);
      if (sp < 150) {
        const leadLen = Math.min(40, sp * 0.8);
        const tx = sp > 0.5 ? (vx / sp) * leadLen : 0;
        const tz = sp > 0.5 ? (vz / sp) * leadLen : 0;
        const k = 1 - Math.exp(-dt * 2.5);
        this.lead.x += (tx - this.lead.x) * k;
        this.lead.z += (tz - this.lead.z) * k;
      }
    }
    if (!this.prevFocus) this.prevFocus = new THREE.Vector3();
    this.prevFocus.copy(focusPos);
    const c = this.shadowCenter.set(focusPos.x + this.lead.x, focusPos.y, focusPos.z + this.lead.z);
    const texel = (2 * SHADOW_HALF) / SHADOW_MAP;
    const a = c.dot(this.lsRight);
    const b = c.dot(this.lsUp);
    c.addScaledVector(this.lsRight, Math.round(a / texel) * texel - a);
    c.addScaledVector(this.lsUp, Math.round(b / texel) * texel - b);
    this.moon.target.position.copy(c);
    this.moon.position.copy(c).addScaledVector(this.lightDir, 700);
    this.moon.target.updateMatrixWorld();

    this.updatePointLights(dt, focusPos);
  }

  /**
   * Nokta ışıkları: ışık noktaları s'e göre sıralı; ışık i, (k mod 3 = i) noktalarından oyuncunun biraz önüne
   * en yakın olanı alır. Yoğunluk uzaklıkla sıfıra iner → nokta değişimi karanlıkta olur (atlama görünmez).
   */
  updatePointLights(dt, focusPos) {
    const spots = this.lightSpots;
    const n = spots.length;
    const pr = this.track.project(focusPos, this.focusS ?? undefined);
    this.focusS = pr.s;
    const L = this.track.length;
    const target = pr.s + 18;
    for (let i = 0; i < this.points.length; i++) {
      const pl = this.points[i];
      let best = -1;
      let bestD = Infinity;
      for (let k = i; k < n; k += POINT_LIGHTS) {
        let d = spots[k].s - target;
        d -= Math.round(d / L) * L;
        const ad = Math.abs(d);
        if (ad < bestD) { bestD = ad; best = k; }
      }
      const l = pl.light;
      if (best < 0 || bestD > LIGHT_REACH) {
        l.intensity = 0;
        l.visible = true;
        continue;
      }
      const sp = spots[best];
      const fade = 1 - THREE.MathUtils.smoothstep(bestD, LIGHT_REACH * 0.45, LIGHT_REACH);
      l.position.set(sp.x, sp.y, sp.z);
      l.color.copy(sp.color);
      l.intensity = 320 * sp.strength * fade;
      pl.cur = best;
    }
  }
}
