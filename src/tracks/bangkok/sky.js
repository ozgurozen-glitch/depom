// Gece gökyüzü: lacivert zenit, şehir ışığıyla turuncu-pembe parlayan ufuk, alttan aydınlanan alçak bulutlar,
// yıldızlar ve ay. envMode = true: PMREM için ufka neon/pencere ışıklı silüet bandı ve koyu zemin eklenir
// (ıslak yol ve araba boyası bu renkleri yansıtır).
import * as THREE from 'three';

const vertexShader = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * vec4(mat3(modelViewMatrix) * position, 1.0);
    gl_Position = p.xyww;
  }
`;

const fragmentShader = /* glsl */`
  uniform vec3 uMoonDir;
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uGlowA;
  uniform vec3 uGlowB;
  uniform vec3 uFog;
  uniform vec3 uGround;
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
    float az = atan(d.z, d.x);
    float moonDot = dot(d, uMoonDir);

    // Ufuk parıltısı yön boyunca değişir (şehir merkezi tarafı daha sıcak/pembe)
    float side = 0.5 + 0.5 * sin(az * 1.0 + 0.6);
    vec3 glow = mix(uGlowA, uGlowB, side);
    vec3 col = mix(uHorizon + glow * 0.6, uMid, smoothstep(0.0, 0.22, h));
    col = mix(col, uZenith, smoothstep(0.18, 0.75, h));
    col += glow * 0.35 * exp(-h * 9.0);

    // Bulutlar: alttan şehir ışığıyla aydınlanan katman
    float cloud = 0.0;
    if (y > 0.0) {
      vec2 uv = d.xz / (y + 0.12);
      vec2 q = vec2(uv.x * 0.5 + uv.y * 0.2, uv.y * 0.9 - uv.x * 0.25) * 1.3;
      float n = fbm(q + vec2(5.1, 2.7));
      float n2 = fbm(q * 2.6 + vec2(n * 1.7, 3.3));
      cloud = smoothstep(0.42, 0.8, n * 0.7 + n2 * 0.4) * smoothstep(0.0, 0.05, y);
      float lit = exp(-h * 3.2);
      vec3 under = glow * (0.55 + 0.9 * lit) + vec3(0.02, 0.02, 0.04);
      vec3 cc = mix(under, vec3(0.05, 0.05, 0.09), smoothstep(0.35, 0.9, n2) * (1.0 - lit * 0.6));
      // Ayın etrafında bulut kenarları gümüşlenir
      float moonLit = pow(max(moonDot, 0.0), 24.0);
      cc += vec3(0.5, 0.55, 0.7) * moonLit * 0.8;
      col = mix(col, cc, cloud * 0.9);
    }

    // Yıldızlar (bulutların ve ufuk parıltısının arkasında sönük)
    if (y > 0.12) {
      vec2 sp = vec2(az * 140.0, asin(clamp(y, -1.0, 1.0)) * 140.0);
      vec2 cell = floor(sp);
      float r = hash(cell);
      vec2 f = fract(sp) - 0.5;
      float star = step(0.985, r) * smoothstep(0.18, 0.0, length(f));
      col += vec3(0.9, 0.95, 1.1) * star * (1.0 - cloud) * smoothstep(0.12, 0.4, y) * (0.6 + r * 0.8);
    }

    // Ay: disk + hare
    float disk = smoothstep(0.99935, 0.9996, moonDot);
    float halo = pow(max(moonDot, 0.0), 180.0) * 0.6 + pow(max(moonDot, 0.0), 12.0) * 0.06;
    col += vec3(2.6, 2.7, 3.0) * disk * (1.0 - cloud * 0.7) + vec3(0.45, 0.5, 0.65) * halo;

    // Ufukta sis rengine karışım
    float fogBlend = 1.0 - smoothstep(-0.01, 0.06, y);
    col = mix(col, uFog + glow * 0.2, fogBlend);

    if (uEnvMode > 0.5) {
      // Ufuk silüeti: azimuta göre basamaklı bina yükseklikleri, pencere ışıkları ve neon lekeleri
      float a = az * 18.0;
      float bi = floor(a);
      float bh = 0.03 + hash(vec2(bi, 3.1)) * 0.11 + step(0.85, hash(vec2(bi, 7.7))) * 0.12;
      if (y < bh && y > -0.02) {
        float wx = fract(a * 7.0);
        float wy = fract(y * 160.0);
        float lit = step(0.55, hash(vec2(floor(a * 7.0), floor(y * 160.0))));
        float win = step(0.25, wx) * step(wx, 0.8) * step(0.3, wy) * step(wy, 0.8) * lit;
        vec3 b = vec3(0.025, 0.022, 0.035) + vec3(1.2, 0.85, 0.5) * win * 0.55;
        float nk = hash(vec2(bi, 11.0));
        vec3 neon = nk < 0.33 ? vec3(2.4, 0.3, 1.9) : nk < 0.66 ? vec3(0.3, 2.0, 2.6) : vec3(2.6, 1.1, 0.25);
        float blob = smoothstep(0.35, 0.0, abs(fract(a) - 0.5) - 0.1) * smoothstep(0.02, 0.0, abs(y - bh * 0.55) - 0.012);
        b += neon * blob * step(0.4, hash(vec2(bi, 5.0)));
        col = b;
      }
      float g = smoothstep(-0.02, -0.2, y);
      col = mix(col, uGround, g);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const NIGHT_SKY = {
  zenith: new THREE.Color(0.004, 0.006, 0.022),
  mid: new THREE.Color(0.018, 0.016, 0.05),
  horizon: new THREE.Color(0.06, 0.035, 0.07),
  glowA: new THREE.Color(0.32, 0.12, 0.2), // pembe-mor
  glowB: new THREE.Color(0.36, 0.17, 0.06), // sodyum turuncusu
  ground: new THREE.Color(0.012, 0.011, 0.016),
};

export function createNightSkyMaterial({ moonDir, fogColor, envMode = false }) {
  return new THREE.ShaderMaterial({
    name: envMode ? 'NightSkyEnv' : 'NightSky',
    uniforms: {
      uMoonDir: { value: moonDir.clone().normalize() },
      uZenith: { value: NIGHT_SKY.zenith.clone() },
      uMid: { value: NIGHT_SKY.mid.clone() },
      uHorizon: { value: NIGHT_SKY.horizon.clone() },
      uGlowA: { value: NIGHT_SKY.glowA.clone() },
      uGlowB: { value: NIGHT_SKY.glowB.clone() },
      uFog: { value: fogColor.clone() },
      uGround: { value: NIGHT_SKY.ground.clone() },
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
