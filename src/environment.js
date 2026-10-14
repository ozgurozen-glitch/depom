// Environment: "Riviera Sunset" — gün batımı gökyüzü, ışıklar, sis, PMREM ortam haritası, gölge takibi,
// arazi, deniz ve mekân (binalar, palmiyeler, tünel, tribünler, yatlar...).
import * as THREE from 'three';
import { createSkyMaterial, createSkyMesh } from './track/sky.js';
import { Terrain, createSea } from './track/terrain.js';
import { buildScenery } from './track/scenery.js';

// Görünen güneş (ufka yakın) ve gölge ışığının yönü (aynı azimut, daha yüksek — kısa/okunur gölgeler).
const SUN_AZIMUTH = new THREE.Vector2(-0.79, 0.61).normalize(); // batı-güneybatı (x batı-, z güney+)
const SUN_ELEVATION = THREE.MathUtils.degToRad(4.2);
const LIGHT_ELEVATION = THREE.MathUtils.degToRad(27);
const FOG_COLOR = 0xd9988c;
const FOG_DENSITY = 0.00042;
// Telefon/tablette daha hafif ayarlar (gölge haritası ve bitki yoğunluğu)
const LOW_SPEC = typeof navigator !== 'undefined'
  && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1);
const SHADOW_HALF = LOW_SPEC ? 90 : 105;
const SHADOW_MAP = LOW_SPEC ? 1024 : 2048;

function dirFrom(az, elev) {
  return new THREE.Vector3(az.x * Math.cos(elev), Math.sin(elev), az.y * Math.cos(elev)).normalize();
}

export class Environment {
  constructor(scene, renderer, track) {
    this.scene = scene;
    this.renderer = renderer;
    this.track = track;
    this.time = 0;

    this.sunDir = dirFrom(SUN_AZIMUTH, SUN_ELEVATION);
    this.lightDir = dirFrom(SUN_AZIMUTH, LIGHT_ELEVATION);
    const fogColor = new THREE.Color(FOG_COLOR);
    scene.fog = new THREE.FogExp2(fogColor, FOG_DENSITY);

    // Gökyüzü: shader bir kez HDR küp dokuya pişirilir (arka plan + deniz yansıması), PMREM ayrıca
    this.bakeSky(fogColor);
    this.buildEnvironmentMap();

    // Işıklar
    // Not: r155+ fiziksel ışık ölçeğinde Lambert ortam ışığı ~1/π ile çarpılır → yüksek yoğunluk
    this.hemi = new THREE.HemisphereLight(0xa8b4ff, 0x7a5444, 1.9);
    this.hemiBase = { intensity: this.hemi.intensity, sky: this.hemi.color.clone(), ground: this.hemi.groundColor.clone() };
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffb27a, 3.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const sc = this.sun.shadow.camera;
    sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF;
    sc.near = 20; sc.far = 1400;
    sc.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.08;
    scene.add(this.sun);
    scene.add(this.sun.target);
    // Gölge kamerası ekseni (ışık uzayında kaydırma ve texel'e yaslama için)
    this.lsRight = new THREE.Vector3().crossVectors(this.lightDir, new THREE.Vector3(0, 1, 0)).normalize();
    this.lsUp = new THREE.Vector3().crossVectors(this.lsRight, this.lightDir).normalize();
    this.shadowCenter = new THREE.Vector3();
    this.prevFocus = null;
    this.lead = new THREE.Vector3();
    this.focusS = 0;
    this.tunnelK = 0;

    // Arazi ve deniz
    this.terrain = new Terrain(track);
    this.terrainMesh = this.terrain.buildMesh();
    scene.add(this.terrainMesh);
    this.sea = createSea(this.skyTarget.texture, this.sunDir);
    scene.add(this.sea);

    // Mekân
    this.scenery = buildScenery({ scene, track, terrain: this.terrain, density: LOW_SPEC ? 0.55 : 1 });
  }

  bakeSky(fogColor) {
    const skyScene = new THREE.Scene();
    const mat = createSkyMaterial({ sunDir: this.sunDir, fogColor });
    skyScene.add(createSkyMesh(mat));
    const rt = new THREE.WebGLCubeRenderTarget(512, {
      type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
    });
    const cubeCam = new THREE.CubeCamera(0.1, 100, rt);
    cubeCam.update(this.renderer, skyScene);
    mat.dispose();
    this.skyTarget = rt;
    this.scene.background = rt.texture;
  }

  buildEnvironmentMap() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envMat = createSkyMaterial({ sunDir: this.sunDir, fogColor: new THREE.Color(FOG_COLOR), envMode: true });
    envScene.add(createSkyMesh(envMat));
    const rt = pmrem.fromScene(envScene, 0, 0.1, 100);
    this.scene.environment = rt.texture;
    this.envTarget = rt;
    envMat.dispose();

    // Tünel içi ortam haritası: koyu oda + tavanda turuncu ışık şeritleri (araba boyasında yansıyan
    // şeritler). Oyuncu tüneldeyken scene.environment buna geçer (aynı boyut → yeniden derleme yok).
    const tScene = new THREE.Scene();
    tScene.background = new THREE.Color(0x120c08);
    const room = new THREE.Mesh(new THREE.BoxGeometry(26, 9, 80), new THREE.MeshBasicMaterial({ color: 0x3a2618, side: THREE.BackSide }));
    room.position.y = 3.2;
    tScene.add(room);
    const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.0, 0.45) });
    for (const x of [-4.2, 4.2]) {
      for (let z = -36; z < 36; z += 4) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 2.6), stripMat);
        strip.position.set(x, 7.5, z);
        tScene.add(strip);
      }
    }
    this.tunnelEnvTarget = pmrem.fromScene(tScene, 0, 0.1, 100);
    tScene.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    room.material.dispose();
    stripMat.dispose();
    pmrem.dispose();
  }

  /** Sahneye eklenmemiş GPU kaynakları (gökyüzü küpü, PMREM hedefleri). Game.unloadTrack çağırır. */
  dispose() {
    for (const rt of [this.skyTarget, this.envTarget, this.tunnelEnvTarget]) if (rt) rt.dispose();
    this.skyTarget = null;
    this.envTarget = null;
    this.tunnelEnvTarget = null;
  }

  update(dt, focusPos) {
    this.time += dt;
    this.sea.userData.uniforms.uTime.value = this.time;
    if (!focusPos) return;

    // Deniz düzlemi oyuncuyu izler (dalgalar dünya koordinatında sabit)
    this.sea.position.x = Math.round(focusPos.x / 100) * 100;
    this.sea.position.z = Math.round(focusPos.z / 100) * 100;

    // Gölge kutusu: oyuncunun biraz önüne (hız yönünde) kaydır, texel'e yasla
    if (this.prevFocus && dt > 0) {
      const vx = (focusPos.x - this.prevFocus.x) / dt;
      const vz = (focusPos.z - this.prevFocus.z) / dt;
      const sp = Math.hypot(vx, vz);
      if (sp < 150) {
        const leadLen = Math.min(45, sp * 0.9);
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
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(this.lightDir, 700);
    this.sun.target.updateMatrixWorld();

    // Tünel ambiyansı: içerideyken ortam ışığı kısılır ve turuncuya döner
    const pr = this.track.project(focusPos, this.focusS);
    this.focusS = pr.s;
    const t = this.track.tunnel;
    const inside = pr.s > t.s0 + 8 && pr.s < t.s1 - 8 ? 1 : 0;
    this.tunnelK += (inside - this.tunnelK) * (1 - Math.exp(-dt * 3));
    const k = this.tunnelK;
    this.hemi.intensity = this.hemiBase.intensity * (1 - k * 0.55);
    this.hemi.color.copy(this.hemiBase.sky).lerp(TUNNEL_TINT, k * 0.8);
    this.hemi.groundColor.copy(this.hemiBase.ground).lerp(TUNNEL_TINT, k * 0.6);
    const env = k > 0.5 ? this.tunnelEnvTarget.texture : this.envTarget.texture;
    if (this.scene.environment !== env) this.scene.environment = env;

    if (this.scenery) this.scenery.update(dt, this.time, focusPos);
  }
}

const TUNNEL_TINT = new THREE.Color(0xffb070);
