// Hafif çiseleme: oyuncunun çevresinde dönen bir kutu içinde düşen kısa çizgiler (tek LineSegments, konum
// tamamen vertex shader'da hesaplanır — CPU'da her kare güncelleme yok).
import * as THREE from 'three';
import { mulberry32 } from '../../track/textures.js';

const BOX = new THREE.Vector3(90, 36, 90);

export function createDrizzle(count) {
  const rnd = mulberry32(555);
  const pos = new Float32Array(count * 2 * 3);
  const end = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = rnd() * BOX.x;
    const y = rnd() * BOX.y;
    const z = rnd() * BOX.z;
    pos.set([x, y, z, x, y, z], i * 6);
    end[i * 2] = 0;
    end[i * 2 + 1] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const uniforms = {
    uOffset: { value: new THREE.Vector3() }, // düşüş ötelemesi (CPU'da kutu boyuna göre sarılır)
    uCenter: { value: new THREE.Vector3() },
    uBox: { value: BOX.clone() },
    uColor: { value: new THREE.Color(0.55, 0.62, 0.8) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      attribute float aEnd;
      uniform vec3 uOffset;
      uniform vec3 uCenter;
      uniform vec3 uBox;
      varying float vA;
      void main() {
        vec3 p = position + uOffset;
        // Kutu içinde sar, oyuncuyu merkeze al
        vec3 rel = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
        vec3 w = uCenter + rel;
        w += vec3(-0.12, 0.85, 0.0) * aEnd; // kısa, hafif eğik çizgi
        vec4 mv = modelViewMatrix * vec4(w, 1.0);
        float d = length(rel.xz);
        vA = (1.0 - smoothstep(25.0, 45.0, d)) * (0.5 + 0.5 * aEnd);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying float vA;
      void main() {
        gl_FragColor = vec4(uColor * vA * 0.35, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.name = 'drizzle';
  return {
    mesh: lines,
    update(dt, center) {
      const o = uniforms.uOffset.value;
      o.x = (o.x + dt * 1.4) % BOX.x;
      o.y = (o.y - dt * 11.0) % BOX.y;
      uniforms.uCenter.value.copy(center);
    },
  };
}
