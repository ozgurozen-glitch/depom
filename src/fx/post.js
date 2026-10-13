// Hız/nitro son-işleme gölgelendiricisi (doğrusal HDR uzayında, OutputPass'ten önce çalışır):
// radyal (zoom) bulanıklık + bulanıklık örneklerine yayılmış hafif kromatik sapma + akan hız çizgileri
// + vinyet (wreck'te kırmızımsı) + doygunluk kaybı + ekran flaşı.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uAspect;
uniform vec2 uCenter;
uniform float uBlur;          // 0..1 radyal bulanıklık
uniform float uAberration;    // 0..1 kromatik sapma
uniform float uVignette;      // 0..1 kenar karartma
uniform vec3 uEdgeTint;       // kenara eklenen renk (wreck: kırmızı, nitro: mor-mavi)
uniform float uLines;         // 0..1 hız çizgileri
uniform vec3 uLineColor;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uDesat;
uniform vec3 uTint;
varying vec2 vUv;

float hash(float n) { return fract(sin(n) * 43758.5453123); }

void main() {
  vec2 uv = vUv;
  vec2 d = uv - uCenter;
  vec2 da = vec2(d.x * uAspect, d.y);
  float dist = length(da);
  float edge = smoothstep(0.16, 0.85, dist);

  float span = uBlur * 0.07 * edge + uAberration * 0.014;
  vec3 col;
  if (span * dist < 0.0006) {
    col = texture2D(tDiffuse, uv).rgb;
  } else {
    float ab = clamp(uAberration, 0.0, 1.0);
    vec3 acc = vec3(0.0);
    vec3 wsum = vec3(0.0);
    for (int i = 0; i < SAMPLES; i++) {
      float t = float(i) / float(SAMPLES - 1);
      vec3 s = texture2D(tDiffuse, uv - d * span * t).rgb;
      vec3 w = vec3(mix(1.0, 0.15 + 1.7 * t, ab), 1.0, mix(1.0, 1.85 - 1.7 * t, ab));
      acc += s * w;
      wsum += w;
    }
    col = acc / wsum;
  }

  // Ekran kenarlarında dışa akan hız çizgileri (kutupsal hücreler, zamanla yeniden rastgeleleşir).
  if (uLines > 0.001) {
    float ang = atan(da.y, da.x);
    float a = (ang / 6.2831853 + 0.5) * 120.0;
    float id = floor(a);
    float fa = fract(a);
    float h1 = hash(id * 1.37 + 0.11);
    float seed = floor(uTime * 6.0 + h1 * 13.0);
    float on = step(0.72, hash(id * 3.17 + seed * 0.731));
    float w = 0.04 + 0.06 * h1;
    float line = 1.0 - smoothstep(0.0, w, abs(fa - 0.5));
    float rr = dist * (1.6 + h1 * 2.2) - uTime * (2.6 + 3.5 * h1) + h1 * 7.0;
    float fr = fract(rr);
    float dash = smoothstep(0.0, 0.12, fr) * (1.0 - smoothstep(0.22, 0.55, fr));
    float mask = smoothstep(0.5, 1.05, dist);
    col += uLineColor * (line * dash * on * mask * uLines);
  }

  // Vinyet + kenar rengi
  float vig = smoothstep(0.45, 1.2, dist);
  col *= 1.0 - vig * uVignette;
  col += uEdgeTint * vig * vig;

  // Doygunluk kaybı + ton (wreck)
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(lum) * uTint, uDesat);

  col += uFlashColor * uFlash * (0.55 + 0.45 * edge);
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

export function createPostMaterial(samples) {
  return new THREE.ShaderMaterial({
    name: 'SpeedPostShader',
    defines: { SAMPLES: samples },
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uAspect: { value: 16 / 9 },
      uCenter: { value: new THREE.Vector2(0.5, 0.56) },
      uBlur: { value: 0 },
      uAberration: { value: 0 },
      uVignette: { value: 0.3 },
      uEdgeTint: { value: new THREE.Vector3(0, 0, 0) },
      uLines: { value: 0 },
      uLineColor: { value: new THREE.Vector3(1, 1, 1) },
      uFlash: { value: 0 },
      uFlashColor: { value: new THREE.Vector3(1, 1, 1) },
      uDesat: { value: 0 },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
  });
}
