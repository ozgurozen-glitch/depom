// Drift lastik izleri: sabit boyutlu halka tampon. Her segment 4 köşeli bir dörtgen (köşeler paylaşılmaz,
// böylece en eski segmentin üzerine yazmak basittir). Solma, doğum zamanına göre gölgelendiricide yapılır;
// CPU yalnızca yeni segmentleri yazar ve yalnızca o aralığı GPU'ya yükler.
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec2 aInfo;     // x doğum zamanı (s), y yoğunluk 0..1
attribute float aEdge;    // 0 sol kenar, 1 sağ kenar
uniform vec4 uFog;
varying vec2 vInfo;
varying float vEdge;
varying float vFog;
varying vec2 vWorld;

void main() {
  vInfo = aInfo;
  vEdge = aEdge;
  vWorld = position.xz;
  vec4 mv = viewMatrix * vec4(position, 1.0);
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

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uFade;
varying vec2 vInfo;
varying float vEdge;
varying float vFog;
varying vec2 vWorld;

void main() {
  float age = uTime - vInfo.x;
  float fade = 1.0 - smoothstep(uFade * 0.35, uFade, age);
  float edge = smoothstep(0.0, 0.5, vEdge) * smoothstep(1.0, 0.5, vEdge);
  edge = edge * edge * (1.5 - 0.5 * edge); // yumuşak enine profil: kenarlar kademeli kaybolur
  // Hafif diş deseni: dünya konumuna bağlı ince çizgiler.
  float tread = 0.82 + 0.18 * sin(vEdge * 18.0) * sin((vWorld.x + vWorld.y) * 3.1);
  float a = vInfo.y * fade * edge * tread * (1.0 - vFog);
  if (a < 0.003) discard;
  gl_FragColor = vec4(0.012, 0.012, 0.014, a);
}
`;

const HALF_WIDTH = 0.21;
const MIN_STEP = 0.55;     // m: bu mesafeden kısa hareket yeni segment üretmez
const MAX_JUMP = 8;        // m: daha uzun sıçrama → iz kopar (respawn/ışınlanma)

export class TireMarks {
  constructor(scene, maxSegments = 2400, fadeSeconds = 14) {
    this.max = maxSegments;
    this.head = 0;
    this.time = 0;

    const vCount = maxSegments * 4;
    this.positions = new Float32Array(vCount * 3);
    this.info = new Float32Array(vCount * 2);
    const edge = new Float32Array(vCount);
    const index = new Uint32Array(maxSegments * 6);
    for (let i = 0; i < maxSegments; i++) {
      const v = i * 4;
      edge[v] = 0;
      edge[v + 1] = 1;
      edge[v + 2] = 0;
      edge[v + 3] = 1;
      const k = i * 6;
      index[k] = v;
      index[k + 1] = v + 2;
      index[k + 2] = v + 1;
      index[k + 3] = v + 1;
      index[k + 4] = v + 2;
      index[k + 5] = v + 3;
      this.info[v * 2] = -1e6;
      this.info[(v + 1) * 2] = -1e6;
      this.info[(v + 2) * 2] = -1e6;
      this.info[(v + 3) * 2] = -1e6;
    }

    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.aInfo = new THREE.BufferAttribute(this.info, 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aInfo', this.aInfo);
    geo.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFade: { value: fadeSeconds },
        uFog: { value: new THREE.Vector4(0, 1, 0, 0) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);

    this.dirtyFrom = -1;
    this.dirtyCount = 0;
  }

  // Her tekerlek için iz durumu (Effects araba başına iki tane tutar).
  static createTrack() {
    return { active: false, x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0, intensity: 0, lastSeg: -1 };
  }

  // Tekerlek konumunu ekle; iz kopuksa yeni şerit başlatır.
  add(track, p, intensity) {
    if (!track.active) {
      track.active = true;
      track.x = p.x;
      track.y = p.y;
      track.z = p.z;
      track.lx = NaN;
      return;
    }
    const dx = p.x - track.x;
    const dz = p.z - track.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < MIN_STEP * MIN_STEP) return;
    if (d2 > MAX_JUMP * MAX_JUMP) {
      track.x = p.x;
      track.y = p.y;
      track.z = p.z;
      track.lx = NaN;
      return;
    }
    const d = Math.sqrt(d2);
    // Hareket yönüne dik (XZ düzleminde) genişlik vektörü.
    const nx = (-dz / d) * HALF_WIDTH;
    const nz = (dx / d) * HALF_WIDTH;
    const y0 = track.y + 0.03;
    const y1 = p.y + 0.03;

    // Önceki segmentin uç kenarını yeniden kullan → boşluksuz şerit.
    let lx; let ly; let lz; let rx; let ry; let rz;
    if (Number.isNaN(track.lx)) {
      lx = track.x - nx; ly = y0; lz = track.z - nz;
      rx = track.x + nx; ry = y0; rz = track.z + nz;
    } else {
      lx = track.lx; ly = track.ly; lz = track.lz;
      rx = track.rx; ry = track.ry; rz = track.rz;
    }
    const ex = p.x - nx; const ez = p.z - nz;
    const fx = p.x + nx; const fz = p.z + nz;

    const seg = this.head;
    this.head = (this.head + 1) % this.max;
    const v = seg * 4;
    const P = this.positions;
    let o = v * 3;
    P[o] = lx; P[o + 1] = ly; P[o + 2] = lz;
    P[o + 3] = rx; P[o + 4] = ry; P[o + 5] = rz;
    P[o + 6] = ex; P[o + 7] = y1; P[o + 8] = ez;
    P[o + 9] = fx; P[o + 10] = y1; P[o + 11] = fz;
    const I = this.info;
    o = v * 2;
    const t = this.time;
    const prevIntensity = Number.isNaN(track.lx) ? 0 : track.intensity; // iz sıfırdan yumuşakça belirir
    I[o] = t; I[o + 1] = prevIntensity;
    I[o + 2] = t; I[o + 3] = prevIntensity;
    I[o + 4] = t; I[o + 5] = intensity;
    I[o + 6] = t; I[o + 7] = intensity;
    this.markDirty(seg);
    track.lastSeg = seg;

    track.x = p.x;
    track.y = p.y;
    track.z = p.z;
    track.lx = ex; track.ly = y1; track.lz = ez;
    track.rx = fx; track.ry = y1; track.rz = fz;
    track.intensity = intensity;
  }

  // İz biterken son segmentin uç kenarı sıfır yoğunluğa iner → iz aniden kesilmez, yumuşakça söner.
  end(track) {
    if (track.active && track.lastSeg >= 0 && !Number.isNaN(track.lx)) {
      const o = track.lastSeg * 8;
      this.info[o + 5] = 0;
      this.info[o + 7] = 0;
      this.markDirty(track.lastSeg);
    }
    track.active = false;
    track.lastSeg = -1;
  }

  markDirty(seg) {
    if (this.dirtyFrom < 0) {
      this.dirtyFrom = seg;
      this.dirtyCount = 1;
    } else if (seg === (this.dirtyFrom + this.dirtyCount) % this.max) {
      this.dirtyCount++;
    } else {
      // Beklenmeyen sıra: tüm tamponu yükle.
      this.dirtyFrom = 0;
      this.dirtyCount = this.max;
    }
  }

  update(dt, fog) {
    this.time += dt;
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    const f = u.uFog.value;
    if (!fog) f.w = 0;
    else if (fog.isFogExp2) f.set(0, 1, fog.density, 2);
    else f.set(fog.near, fog.far, 0, 1);

    if (this.dirtyFrom >= 0) {
      const from = this.dirtyFrom;
      const count = Math.min(this.dirtyCount, this.max);
      this.aPos.clearUpdateRanges();
      this.aInfo.clearUpdateRanges();
      if (from + count <= this.max) {
        this.aPos.addUpdateRange(from * 12, count * 12);
        this.aInfo.addUpdateRange(from * 8, count * 8);
      } else {
        // Halka başa sardı: iki aralık.
        const first = this.max - from;
        this.aPos.addUpdateRange(from * 12, first * 12);
        this.aPos.addUpdateRange(0, (count - first) * 12);
        this.aInfo.addUpdateRange(from * 8, first * 8);
        this.aInfo.addUpdateRange(0, (count - first) * 8);
      }
      this.aPos.needsUpdate = true;
      this.aInfo.needsUpdate = true;
      this.dirtyFrom = -1;
      this.dirtyCount = 0;
    }
  }
}
