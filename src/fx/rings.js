// Yere paralel, genişleyen parlak halkalar (shockwave nitro, pickup). Küçük sabit havuz; her halka bir
// arabayı (veya sabit bir noktayı) izler.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uThick;
uniform float uProgress;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float x = (r - 0.9) / uThick;
  float ring = exp(-x * x);
  float inner = smoothstep(0.35, 0.9, r) * 0.06 * (1.0 - uProgress);
  float a = (ring + inner) * uAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export class ShockRings {
  constructor(scene, count = 6) {
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    this.items = [];
    for (let i = 0; i < count; i++) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Vector3(1, 1, 1) },
          uAlpha: { value: 0 },
          uThick: { value: 0.05 },
          uProgress: { value: 0 },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 15;
      scene.add(mesh);
      this.items.push({ mesh, material, active: false, t: 0, duration: 1, r0: 1, r1: 10, alpha: 1, target: null, pos: new THREE.Vector3() });
    }
  }

  // color: doğrusal HDR [r, g, b]
  spawn(target, color, { r0 = 1.5, r1 = 22, duration = 0.7, thickness = 0.06, alpha = 1, delay = 0 } = {}) {
    let item = this.items.find((it) => !it.active);
    if (!item) item = this.items.reduce((a, b) => (a.t / a.duration > b.t / b.duration ? a : b));
    item.active = true;
    item.t = -delay;
    item.duration = duration;
    item.r0 = r0;
    item.r1 = r1;
    item.alpha = alpha;
    item.target = target.isVector3 ? null : target;
    item.pos.copy(target.isVector3 ? target : target.position);
    item.material.uniforms.uColor.value.set(color[0], color[1], color[2]);
    item.material.uniforms.uThick.value = thickness;
    item.mesh.visible = false;
  }

  clear() {
    for (const it of this.items) {
      it.active = false;
      it.mesh.visible = false;
    }
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      if (it.t < 0) continue;
      const p = it.t / it.duration;
      if (p >= 1) {
        it.active = false;
        it.mesh.visible = false;
        continue;
      }
      if (it.target) it.pos.copy(it.target.position);
      const e = 1 - (1 - p) ** 3;
      const r = it.r0 + (it.r1 - it.r0) * e;
      it.mesh.visible = true;
      it.mesh.position.set(it.pos.x, it.pos.y + 0.35, it.pos.z);
      it.mesh.scale.setScalar(r);
      const u = it.material.uniforms;
      u.uAlpha.value = it.alpha * (1 - p) * (1 - p) * Math.min(1, it.t * 30);
      u.uProgress.value = p;
    }
  }
}
