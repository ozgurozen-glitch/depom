// Prosedürel CanvasTexture üreticileri (harici görsel yok). Hepsi deterministik (tohumlu rastgele).
import * as THREE from 'three';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Döşenebilir (periyodik) değer gürültüsü — canvas dokuları için.
function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function tileNoise(x, y, px, py, seed = 1) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % px) + px) % px;
  const y0 = ((yi % py) + py) % py;
  const x1 = (x0 + 1) % px;
  const y1 = (y0 + 1) % py;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function tileFbm(x, y, px, py, octaves = 4, seed = 1) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += tileNoise(x, y, px, py, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2; y *= 2; px *= 2; py *= 2;
  }
  return sum / norm;
}

export function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

export function toTexture(canvas, { color = true, repeat = true, anisotropy = 8, mipmaps = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = mipmaps;
  if (!mipmaps) tex.minFilter = THREE.LinearFilter;
  return tex;
}

// Piksel düzeyinde boyama: fn(x, y) → [r, g, b, a?] (0..255)
export function paintPixels(ctx, w, h, fn) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const out = [0, 0, 0, 255];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[3] = 255;
      fn(x, y, out, d, (y * w + x) * 4);
      const k = (y * w + x) * 4;
      d[k] = out[0];
      d[k + 1] = out[1];
      d[k + 2] = out[2];
      d[k + 3] = out[3];
    }
  }
  ctx.putImageData(img, 0, 0);
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// ---------------------------------------------------------------------------------------------
// Asfalt: u = yol genişliği (20 m), v = tileLength (24 m). Şerit çizgileri ve lastik izleri dokuda.
export function asphaltTexture({ widthM = 20, lengthM = 24 } = {}) {
  const W = 512;
  const H = 1024;
  const { canvas, ctx } = makeCanvas(W, H);
  const rnd = mulberry32(7);
  const pxPerMx = W / widthM;
  const pxPerMy = H / lengthM;
  const lanes = [-7.5, -2.5, 2.5, 7.5];
  paintPixels(ctx, W, H, (x, y, out) => {
    const lat = x / pxPerMx - widthM / 2;
    const n1 = tileFbm(x / 64, y / 64, W / 64, H / 64, 4, 3);
    const n2 = tileNoise(x / 6, y / 6, W / 6, H / 6, 9);
    let base = 52 + (n1 - 0.5) * 26 + (n2 - 0.5) * 10 + (rnd() - 0.5) * 22;
    // Agrega parıltıları
    if (rnd() < 0.012) base += 40 * rnd();
    // Lastik izleri (şerit merkezinin ±0.85 m'si)
    let wear = 0;
    for (const c of lanes) {
      for (const o of [-0.85, 0.85]) {
        const d = (lat - c - o) / 0.32;
        wear += Math.exp(-d * d);
      }
    }
    base *= 1 - 0.13 * Math.min(1, wear) * (0.7 + 0.3 * n1);
    let r = base * 0.93;
    let g = base * 0.95;
    let b = base * 1.04;
    // Şerit çizgileri
    const along = y / pxPerMy;
    const dashOn = (along % 12) < 6;
    let paint = 0;
    for (const c of [-5, 0, 5]) if (Math.abs(lat - c) < 0.08 && dashOn) paint = 1;
    for (const c of [-9.15, 9.15]) if (Math.abs(lat - c) < 0.11) paint = 1;
    if (paint) {
      const worn = 0.82 + 0.18 * tileNoise(x / 3, y / 3, W / 3, H / 3, 21) - (rnd() < 0.08 ? 0.3 : 0);
      r = 236 * worn; g = 236 * worn; b = 228 * worn;
    }
    out[0] = clamp255(r);
    out[1] = clamp255(g);
    out[2] = clamp255(b);
  });
  // Birkaç yama
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#16171b' : '#5a5c62';
    const w = 30 + rnd() * 80;
    const h = 40 + rnd() * 160;
    ctx.fillRect(40 + rnd() * (W - 120), rnd() * (H - h), w, h);
  }
  ctx.globalAlpha = 1;
  return toTexture(canvas, { anisotropy: 16 });
}

// Bariyer atlası: 4 satır (her biri 128 px), u boyunca 16 m. v profil boyunca (0 alt → 1 dış üst).
// Satırlar: 0 kırmızı-beyaz, 1 beyaz + mavi sponsor bandı, 2 gri beton, 3 tünel (beyaz-sarı).
export const BARRIER_ROWS = 4;
export function barrierTexture() {
  const W = 1024;
  const H = 512;
  const RH = H / BARRIER_ROWS;
  const { canvas, ctx } = makeCanvas(W, H);
  const pxPerM = W / 16;
  // Önce satır tabanları
  for (let row = 0; row < BARRIER_ROWS; row++) {
    const y0 = row * RH;
    for (let k = 0; k < 4; k++) {
      let col;
      if (row === 0) col = k % 2 === 0 ? '#d8202a' : '#f2f2ee';
      else if (row === 1) col = '#f4f4f0';
      else if (row === 2) col = '#a7a39b';
      else col = '#e6e2d6';
      ctx.fillStyle = col;
      ctx.fillRect(k * 4 * pxPerM, y0, 4 * pxPerM, RH);
    }
    if (row === 1) {
      ctx.fillStyle = '#1550c8';
      ctx.fillRect(0, y0 + RH * 0.18, W, RH * 0.42);
      ctx.fillStyle = '#ffffff';
      ctx.font = `italic bold ${Math.round(RH * 0.3)}px sans-serif`;
      ctx.textBaseline = 'middle';
      const names = ['VOLTA', 'NAUTICA', 'SOLARIS', 'KRONOS'];
      for (let k = 0; k < 4; k++) ctx.fillText(names[k], k * 4 * pxPerM + 22, y0 + RH * 0.4);
    }
    if (row === 2) {
      ctx.fillStyle = '#f0c419';
      for (let k = 0; k < 4; k++) ctx.fillRect(k * 4 * pxPerM + 2 * pxPerM - 14, y0 + RH * 0.5, 28, RH * 0.16);
    }
    if (row === 3) {
      ctx.fillStyle = '#222';
      for (let k = 0; k < 16; k++) {
        ctx.beginPath();
        const x = k * pxPerM;
        ctx.moveTo(x, y0 + RH * 0.12);
        ctx.lineTo(x + 26, y0 + RH * 0.12);
        ctx.lineTo(x + 60, y0 + RH * 0.42);
        ctx.lineTo(x + 34, y0 + RH * 0.42);
        ctx.fill();
      }
    }
    // Derz çizgileri (her 4 m)
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let k = 0; k <= 4; k++) ctx.fillRect(k * 4 * pxPerM - 2, y0, 4, RH * 0.72);
    // Üst kenar (v 0.72-0.82) açık, dış yüz biraz koyu
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, y0 + RH * 0.72, W, RH * 0.1);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, y0 + RH * 0.82, W, RH * 0.18);
    // Alt kir şeridi
    const grd = ctx.createLinearGradient(0, y0, 0, y0 + RH * 0.25);
    grd.addColorStop(0, 'rgba(40,30,25,0.55)');
    grd.addColorStop(1, 'rgba(40,30,25,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, y0, W, RH * 0.25);
  }
  // Beton gürültüsü
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const rnd = mulberry32(11);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      const n = (tileFbm(x / 24, y / 24, W / 24, H / 24, 3, 5) - 0.5) * 34 + (rnd() - 0.5) * 14;
      d[k] = clamp255(d[k] + n);
      d[k + 1] = clamp255(d[k + 1] + n);
      d[k + 2] = clamp255(d[k + 2] + n);
    }
  }
  ctx.putImageData(img, 0, 0);
  // Satır dikişlerinde mipmap taşmasını azaltmak için dokuyu V'de kenetle
  const tex = toTexture(canvas, { anisotropy: 8 });
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// Kırmızı-beyaz bordür: u boyunca 2 m (bir kırmızı + bir beyaz blok), v enine.
export function curbTexture() {
  const { canvas, ctx } = makeCanvas(256, 64);
  ctx.fillStyle = '#d41a22';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(128, 0, 128, 64);
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.25)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.12)');
  g.addColorStop(0.7, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 64);
  return toTexture(canvas, { anisotropy: 8 });
}

// Rampa: beyaz şeritli ok desenleri (köşe rengiyle boyanır). u enine (0..1), v boyuna (0..1).
// u 0..0.06 ve 0.94..1: tehlike şeridi (yan yüzler de bu bölgeyi kullanır).
export function rampTexture() {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#1d1f24';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#ffffff';
  // Oklar ileri (+v = y aşağı)
  for (let k = 0; k < 4; k++) {
    const y = k * 128 + 30;
    ctx.beginPath();
    ctx.moveTo(S * 0.12, y);
    ctx.lineTo(S * 0.5, y + 60);
    ctx.lineTo(S * 0.88, y);
    ctx.lineTo(S * 0.88, y + 34);
    ctx.lineTo(S * 0.5, y + 94);
    ctx.lineTo(S * 0.12, y + 34);
    ctx.closePath();
    ctx.fill();
  }
  // Kenar tehlike şeritleri
  for (const x0 of [0, S * 0.94]) {
    for (let k = -2; k < 20; k++) {
      ctx.fillStyle = k % 2 === 0 ? '#ffffff' : '#111111';
      ctx.beginPath();
      ctx.moveTo(x0, k * 32);
      ctx.lineTo(x0 + S * 0.06, k * 32 + 20);
      ctx.lineTo(x0 + S * 0.06, k * 32 + 52);
      ctx.lineTo(x0, k * 32 + 32);
      ctx.fill();
    }
  }
  // Uçta (v≈1) kalın beyaz şerit — fırlatma kenarı
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, S - 18, S, 18);
  // Aşınma
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  const rnd = mulberry32(5);
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 30;
    d[i] = clamp255(d[i] + n);
    d[i + 1] = clamp255(d[i + 1] + n);
    d[i + 2] = clamp255(d[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(canvas, { anisotropy: 8 });
}

// Start çizgisi ve grid kutuları atlası: sol yarı dama deseni, sağ yarı grid işareti (alfa).
export function startDecalTexture() {
  const { canvas, ctx } = makeCanvas(512, 256);
  ctx.clearRect(0, 0, 512, 256);
  // Dama: 16 x 4 kare (256 x 256 alanında 2 satır yeterli: enine 16 kare)
  const cs = 16;
  for (let y = 0; y < 256 / cs; y++) {
    for (let x = 0; x < 256 / cs; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f6f6f2' : '#151515';
      ctx.fillRect(x * cs, y * cs, cs, cs);
    }
  }
  // Grid işareti: üstte kalın yatay çizgi + iki kısa yan çizgi (U şeklinde)
  ctx.fillStyle = '#f2f2ee';
  ctx.fillRect(256 + 8, 8, 240, 26);
  ctx.fillRect(256 + 8, 8, 22, 120);
  ctx.fillRect(256 + 226, 8, 22, 120);
  return toTexture(canvas, { repeat: false, anisotropy: 8 });
}

// Nitro tüpü: v boyunca kapak (koyu metal) – gövde (parlak mavi) – kapak.
export function nitroTexture() {
  const { canvas, ctx } = makeCanvas(64, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#30343c');
  g.addColorStop(0.17, '#5a606a');
  g.addColorStop(0.2, '#1e9bff');
  g.addColorStop(0.5, '#9ae6ff');
  g.addColorStop(0.8, '#1e9bff');
  g.addColorStop(0.83, '#5a606a');
  g.addColorStop(1, '#30343c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 256);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(0, 118, 64, 8);
  ctx.fillStyle = 'rgba(0,40,120,0.6)';
  ctx.fillRect(0, 84, 64, 6);
  ctx.fillRect(0, 166, 64, 6);
  return toTexture(canvas, { repeat: false, anisotropy: 4 });
}

// Radyal parıltı (additive sprite'lar için).
export function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)') {
  const { canvas, ctx } = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.25, mid);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return toTexture(canvas, { repeat: false, anisotropy: 1 });
}
