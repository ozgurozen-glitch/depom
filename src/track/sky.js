// Gün batımı gökyüzü: gradyan kubbe + güneş diski/haresi + prosedürel katman bulutları.
// Kamera merkezli çizilir (yalnızca dönüş), derinlik testi yok; ufukta sis rengine karışır.
// envMode = true: PMREM için alt yarıküre koyu zemin rengi olur (araba yansımaları).
import * as THREE from 'three';

const vertexShader = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    // Öteleme yok: gökyüzü sonsuzda
    vec4 p = projectionMatrix * vec4(mat3(modelViewMatrix) * position, 1.0);
    gl_Position = p.xyww;
  }
`;

const fragmentShader = /* glsl */`
  uniform vec3 uSunDir;
  uniform vec3 uZenith;
  uniform vec3 uUpper;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uHorizonFar;
  uniform vec3 uSunGlow;
  uniform vec3 uFog;
  uniform vec3 uGround;
  uniform float uTime;
  uniform float uEnvMode;
  varying vec3 vDir;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      s += a * noise(p);
      p = p * 2.07 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    float h = max(y, 0.0);
    float sunDot = dot(d, uSunDir);
    float sunSide = 0.5 + 0.5 * dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz));

    // Dikey gradyan; ufuk rengi güneş tarafında altın, karşı tarafta pembe-lila
    vec3 horizon = mix(uHorizonFar, uHorizon, pow(sunSide, 1.6));
    vec3 col = mix(horizon, uMid, smoothstep(0.0, 0.16, h));
    col = mix(col, uUpper, smoothstep(0.1, 0.38, h));
    col = mix(col, uZenith, smoothstep(0.32, 0.9, h));

    // Güneşe doğru geniş sıcak parıltı (ufka yakın)
    float glow = pow(max(sunDot, 0.0), 5.0);
    col += uSunGlow * glow * (1.0 - smoothstep(0.0, 0.45, h)) * 0.9;
    col += uSunGlow * pow(max(sunDot, 0.0), 60.0) * 1.6;

    // Bulutlar: ufka yakın uzun katman bulutlar, alttan aydınlatılmış
    float cloud = 0.0;
    vec3 cloudCol = vec3(0.0);
    if (y > 0.0) {
      vec2 uv = d.xz / (y + 0.11);
      vec2 q = vec2(uv.x * 0.55 + uv.y * 0.25, uv.y * 1.8 - uv.x * 0.2) * 1.15;
      q += vec2(uTime * 0.004, 0.0);
      float n = fbm(q + vec2(3.1, 7.7));
      float n2 = fbm(q * 2.3 + vec2(n * 1.5, 1.3));
      float band = smoothstep(0.015, 0.06, y) * (1.0 - smoothstep(0.22, 0.42, y));
      cloud = smoothstep(0.5, 0.78, n * 0.75 + n2 * 0.35) * band;
      float lit = pow(max(sunDot, 0.0), 3.0);
      vec3 under = mix(vec3(0.95, 0.42, 0.42), vec3(1.25, 0.62, 0.25), lit);
      vec3 top = mix(vec3(0.42, 0.3, 0.55), vec3(0.9, 0.5, 0.45), lit);
      cloudCol = mix(under, top, smoothstep(0.45, 0.8, n2)) * (0.85 + lit * 1.4);
      col = mix(col, cloudCol, cloud * 0.85);
    }

    // Güneş diski (HDR, bloom yakalasın) — bulutların arkasında hafif kısılır
    float disk = smoothstep(0.99955, 0.99975, sunDot);
    col += vec3(14.0, 8.5, 3.6) * disk * (1.0 - cloud * 0.6);

    // Ufukta sis rengine karışım (uzak nesnelerle dikişsiz geçiş)
    float fogBlend = 1.0 - smoothstep(-0.005, 0.07, y);
    col = mix(col, uFog + uSunGlow * glow * 0.35, fogBlend);

    // Alt yarıküre: oyunda sis rengi, PMREM'de koyu zemin (yansımalar için)
    if (uEnvMode > 0.5) {
      float g = smoothstep(0.0, -0.25, y);
      col = mix(col, uGround, g);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const SKY_COLORS = {
  zenith: 0x1c2c6e,
  upper: 0x5160a8,
  mid: 0xd77c8e,
  horizon: 0xffa25a,
  horizonFar: 0xe58f86,
  sunGlow: 0xff8a2a,
  ground: 0x2b2a34,
};

export function createSkyMaterial({ sunDir, fogColor, envMode = false }) {
  return new THREE.ShaderMaterial({
    name: envMode ? 'SkyEnv' : 'Sky',
    uniforms: {
      uSunDir: { value: sunDir.clone().normalize() },
      uZenith: { value: new THREE.Color(SKY_COLORS.zenith) },
      uUpper: { value: new THREE.Color(SKY_COLORS.upper) },
      uMid: { value: new THREE.Color(SKY_COLORS.mid) },
      uHorizon: { value: new THREE.Color(SKY_COLORS.horizon) },
      uHorizonFar: { value: new THREE.Color(SKY_COLORS.horizonFar) },
      uSunGlow: { value: new THREE.Color(SKY_COLORS.sunGlow) },
      uFog: { value: fogColor.clone() },
      uGround: { value: new THREE.Color(SKY_COLORS.ground) },
      uTime: { value: 0 },
      uEnvMode: { value: envMode ? 1 : 0 },
    },
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
}

export function createSkyMesh(material) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  return mesh;
}
