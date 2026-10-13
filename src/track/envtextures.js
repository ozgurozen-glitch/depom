// Mekân dokuları (prosedürel canvas). Markalar uydurmadır.
import * as THREE from 'three';
import { makeCanvas, toTexture, mulberry32, tileFbm } from './textures.js';

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

function addNoise(ctx, w, h, amount, seed, fbmAmount = 0, period = 32) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const rnd = mulberry32(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      let n = (rnd() - 0.5) * amount;
      if (fbmAmount) n += (tileFbm(x / period, y / period, w / period, h / period, 3, seed) - 0.5) * fbmAmount;
      d[k] = clamp255(d[k] + n);
      d[k + 1] = clamp255(d[k + 1] + n);
      d[k + 2] = clamp255(d[k + 2] + n);
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------------------------
// Cephe atlası: 4 stil (2x2 çeyrek), her çeyrek 4 sütun x 4 kat. Üç doku: renk, ışıklı pencere
// (emissive), ORM (G = pürüzlülük, B = metaliklik).
export const FACADE_STYLES = [
  { name: 'glass', colW: 3.0, floorH: 3.6 },
  { name: 'office', colW: 3.6, floorH: 3.8 },
  { name: 'riviera', colW: 3.3, floorH: 3.4 },
  { name: 'residential', colW: 3.0, floorH: 3.1 },
];

export function facadeTextures() {
  const S = 1024;
  const Q = 512;
  const C = 128; // hücre
  const color = makeCanvas(S, S);
  const emis = makeCanvas(S, S);
  const orm = makeCanvas(S, S);
  const cc = color.ctx;
  const ec = emis.ctx;
  const oc = orm.ctx;
  ec.fillStyle = '#000';
  ec.fillRect(0, 0, S, S);
  const rnd = mulberry32(1234);
  const ormStyle = (rough, metal) => `rgb(0,${Math.round(rough * 255)},${Math.round(metal * 255)})`;

  for (let style = 0; style < 4; style++) {
    const qx = (style % 2) * Q;
    const qy = Math.floor(style / 2) * Q;
    for (let f = 0; f < 4; f++) {
      for (let c = 0; c < 4; c++) {
        const x = qx + c * C;
        const y = qy + Q - (f + 1) * C; // f=0 alt kat (canvas'ta en altta)
        const warm = rnd() < 0.7;
        const lit = warm ? (rnd() < 0.5 ? '#ffd28a' : '#ffc070') : '#d6ecff';
        if (style === 0) {
          // Cam giydirme cephe
          cc.fillStyle = '#2c3540';
          cc.fillRect(x, y, C, C);
          const g = cc.createLinearGradient(0, y, 0, y + C);
          g.addColorStop(0, '#9cc9e2');
          g.addColorStop(1, '#4f7d9c');
          cc.fillStyle = g;
          cc.fillRect(x + 5, y + 4, C - 10, C - 22);
          cc.fillStyle = '#3a4652';
          cc.fillRect(x, y + C - 18, C, 18);
          cc.fillStyle = 'rgba(255,255,255,0.08)';
          cc.fillRect(x + 5, y + 4, (C - 10) * 0.45, C - 22);
          oc.fillStyle = ormStyle(0.55, 0.5);
          oc.fillRect(x, y, C, C);
          oc.fillStyle = ormStyle(0.06, 0.85);
          oc.fillRect(x + 5, y + 4, C - 10, C - 22);
          ec.fillStyle = lit;
          ec.fillRect(x + 5, y + 4, C - 10, C - 22);
        } else if (style === 1) {
          // Ofis: beton bant + şerit pencere
          cc.fillStyle = '#e2ddd3';
          cc.fillRect(x, y, C, C);
          cc.fillStyle = '#3c5468';
          cc.fillRect(x, y + 10, C, C * 0.58);
          cc.fillStyle = '#2a3a48';
          cc.fillRect(x + C - 4, y + 10, 4, C * 0.58);
          cc.fillStyle = 'rgba(255,255,255,0.12)';
          cc.fillRect(x, y + 10, C, 8);
          oc.fillStyle = ormStyle(0.9, 0.0);
          oc.fillRect(x, y, C, C);
          oc.fillStyle = ormStyle(0.1, 0.65);
          oc.fillRect(x, y + 10, C, C * 0.58);
          ec.fillStyle = lit;
          ec.fillRect(x + 2, y + 12, C - 8, C * 0.58 - 4);
        } else if (style === 2) {
          // Riviera: sıva, yeşil panjurlu uzun pencere, balkon
          cc.fillStyle = '#f3ede3';
          cc.fillRect(x, y, C, C);
          cc.fillStyle = '#d9cfc0';
          cc.fillRect(x, y, C, 7);
          const ww = C * 0.36;
          const wx = x + (C - ww) / 2;
          const wy = y + 22;
          const wh = C * 0.62;
          cc.fillStyle = '#2b2b33';
          cc.fillRect(wx, wy, ww, wh);
          cc.fillStyle = '#3e6e52';
          cc.fillRect(wx - ww * 0.42, wy, ww * 0.4, wh);
          cc.fillRect(wx + ww * 1.02, wy, ww * 0.4, wh);
          cc.fillStyle = 'rgba(0,0,0,0.25)';
          for (let k = 0; k < 8; k++) {
            cc.fillRect(wx - ww * 0.42, wy + k * (wh / 8), ww * 0.4, 2);
            cc.fillRect(wx + ww * 1.02, wy + k * (wh / 8), ww * 0.4, 2);
          }
          cc.fillStyle = '#e8e2d8';
          cc.fillRect(wx - 6, wy - 8, ww + 12, 7);
          if (f % 2 === 1) {
            cc.fillStyle = '#d6d0c6';
            cc.fillRect(x + 10, wy + wh, C - 20, 6);
            cc.fillStyle = '#26262a';
            for (let k = 0; k < 12; k++) cc.fillRect(x + 12 + k * 9, wy + wh - 18, 2, 18);
            cc.fillRect(x + 10, wy + wh - 20, C - 20, 3);
          }
          oc.fillStyle = ormStyle(0.92, 0.0);
          oc.fillRect(x, y, C, C);
          oc.fillStyle = ormStyle(0.15, 0.3);
          oc.fillRect(wx, wy, ww, wh);
          ec.fillStyle = lit;
          ec.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
        } else {
          // Konut: geniş pencere + balkon döşemesi
          cc.fillStyle = '#efe9df';
          cc.fillRect(x, y, C, C);
          cc.fillStyle = '#2d3138';
          cc.fillRect(x + 14, y + 20, C - 28, C * 0.5);
          cc.fillStyle = 'rgba(255,255,255,0.15)';
          cc.fillRect(x + 14, y + 20, C - 28, 6);
          cc.fillStyle = '#d8d2c8';
          cc.fillRect(x, y + 20 + C * 0.5, C, 10);
          cc.fillStyle = 'rgba(30,30,34,0.9)';
          cc.fillRect(x + 4, y + 20 + C * 0.5 - 22, C - 8, 3);
          for (let k = 0; k < 14; k++) cc.fillRect(x + 6 + k * 8.6, y + 20 + C * 0.5 - 22, 2, 22);
          oc.fillStyle = ormStyle(0.9, 0.0);
          oc.fillRect(x, y, C, C);
          oc.fillStyle = ormStyle(0.12, 0.4);
          oc.fillRect(x + 14, y + 20, C - 28, C * 0.5);
          ec.fillStyle = lit;
          ec.fillRect(x + 16, y + 22, C - 32, C * 0.5 - 4);
        }
      }
    }
  }
  addNoise(cc, S, S, 14, 3, 18, 64);
  const map = toTexture(color.canvas, { anisotropy: 8 });
  const emissiveMap = toTexture(emis.canvas, { anisotropy: 4 });
  const ormMap = toTexture(orm.canvas, { color: false, anisotropy: 4 });
  return { map, emissiveMap, ormMap };
}

// Tribün seyircileri: 4 sıra x 16 m (u boyunca), renkli kalabalık.
export function crowdTexture() {
  const W = 512;
  const H = 256;
  const { canvas, ctx } = makeCanvas(W, H);
  const rnd = mulberry32(77);
  const rowH = H / 4;
  const shirts = ['#e8202a', '#ffffff', '#1f6fe0', '#ffd21a', '#16a34a', '#ff7a1a', '#d946ef', '#111827', '#22d3ee', '#f43f5e'];
  const skins = ['#f1c7a3', '#d9a27c', '#a86b47', '#6b4228', '#f5d6bd'];
  for (let r = 0; r < 4; r++) {
    const y0 = r * rowH;
    // Koltuk sırası (arka plan)
    ctx.fillStyle = '#2a3a5a';
    ctx.fillRect(0, y0, W, rowH);
    ctx.fillStyle = '#1b2438';
    ctx.fillRect(0, y0 + rowH * 0.78, W, rowH * 0.22);
    for (let x = 4; x < W; x += 10 + rnd() * 3) {
      if (rnd() < 0.08) continue;
      const sh = shirts[Math.floor(rnd() * shirts.length)];
      const sk = skins[Math.floor(rnd() * skins.length)];
      const bw = 8 + rnd() * 2;
      const by = y0 + rowH * 0.42 + rnd() * 4;
      ctx.fillStyle = sh;
      ctx.fillRect(x, by, bw, rowH * 0.42);
      ctx.fillStyle = sk;
      ctx.beginPath();
      ctx.arc(x + bw / 2, by - 4, 4.2, 0, Math.PI * 2);
      ctx.fill();
      if (rnd() < 0.15) {
        // Kaldırılmış kol / bayrak
        ctx.fillStyle = rnd() < 0.5 ? '#ffd21a' : '#e8202a';
        ctx.fillRect(x + bw, by - 16, 2, 16);
        ctx.fillRect(x + bw, by - 18, 9, 6);
      }
    }
  }
  return toTexture(canvas, { anisotropy: 8 });
}

const ADS = [
  { bg: ['#ff3b30', '#ff9500'], fg: '#ffffff', name: 'VELTRA', tag: 'ENERGY DRINK', logo: 'bolt' },
  { bg: ['#0a84ff', '#5ac8fa'], fg: '#ffffff', name: 'AZURINE', tag: 'YACHT CLUB', logo: 'wave' },
  { bg: ['#111111', '#3a3a3c'], fg: '#ffd60a', name: 'KRONEX', tag: 'SWISS-STYLE CHRONO', logo: 'ring' },
  { bg: ['#30d158', '#0f7a3a'], fg: '#ffffff', name: 'NOVAFUEL', tag: 'RACE FORMULA', logo: 'drop' },
  { bg: ['#bf5af2', '#5e2ca5'], fg: '#ffffff', name: 'LUMIRA', tag: 'RESORT & CASINO', logo: 'star' },
  { bg: ['#ffd60a', '#ff9f0a'], fg: '#1c1c1e', name: 'AEROVA', tag: 'PERFORMANCE TYRES', logo: 'tyre' },
  { bg: ['#f2f2f7', '#d1d1d6'], fg: '#d70015', name: 'PULSARA', tag: 'COLA', logo: 'wave' },
  { bg: ['#1c1c1e', '#0a3d62'], fg: '#64d2ff', name: 'SOLENNE', tag: 'RIVIERA SUNGLASSES', logo: 'sun' },
];

function drawLogo(ctx, kind, x, y, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = r * 0.22;
  ctx.beginPath();
  switch (kind) {
    case 'bolt':
      ctx.moveTo(x + r * 0.2, y - r); ctx.lineTo(x - r * 0.5, y + r * 0.1); ctx.lineTo(x, y + r * 0.1);
      ctx.lineTo(x - r * 0.2, y + r); ctx.lineTo(x + r * 0.5, y - r * 0.1); ctx.lineTo(x, y - r * 0.1); ctx.closePath(); ctx.fill();
      break;
    case 'wave':
      ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - r * 0.7, y + r * 0.1);
      ctx.quadraticCurveTo(x - r * 0.35, y - r * 0.4, x, y + r * 0.1); ctx.quadraticCurveTo(x + r * 0.35, y + r * 0.6, x + r * 0.7, y + r * 0.1); ctx.stroke();
      break;
    case 'ring':
      ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - r * 0.7); ctx.moveTo(x, y); ctx.lineTo(x + r * 0.5, y); ctx.stroke();
      break;
    case 'drop':
      ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x + r, y + r * 0.2, x, y + r); ctx.quadraticCurveTo(x - r, y + r * 0.2, x, y - r); ctx.fill();
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? r : r * 0.45;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill();
      break;
    case 'tyre':
      ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill();
      break;
    default:
      ctx.arc(x, y, r * 0.6, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.moveTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8);
        ctx.lineTo(x + Math.cos(a) * r * 1.15, y + Math.sin(a) * r * 1.15);
      }
      ctx.stroke();
  }
  ctx.restore();
}

/** Reklam atlası: 2 sütun x 4 satır, her reklam 512x128 (4:1). */
export function adsTexture() {
  const W = 1024;
  const H = 512;
  const { canvas, ctx } = makeCanvas(W, H);
  ADS.forEach((ad, i) => {
    const x = (i % 2) * 512;
    const y = Math.floor(i / 2) * 128;
    const g = ctx.createLinearGradient(x, y, x + 512, y + 128);
    g.addColorStop(0, ad.bg[0]);
    g.addColorStop(1, ad.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 512, 128);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(x + 300, y); ctx.lineTo(x + 380, y); ctx.lineTo(x + 300, y + 128); ctx.lineTo(x + 220, y + 128); ctx.fill();
    drawLogo(ctx, ad.logo, x + 64, y + 64, 38, ad.fg);
    ctx.fillStyle = ad.fg;
    ctx.font = 'italic 900 64px sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(ad.name, x + 120, y + 78, 370);
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(ad.tag, x + 124, y + 108, 360);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(x + 3, y + 3, 506, 122);
  });
  return toTexture(canvas, { repeat: false, anisotropy: 8 });
}
export const AD_COUNT = ADS.length;

const NEONS = [
  { text: 'CASINO', color: '#ff2bd6' },
  { text: 'HOTEL AZUR', color: '#3cf2ff' },
  { text: 'BAR LUNA', color: '#ffe23c' },
  { text: 'CAFÉ MARINA', color: '#ff8a1c' },
  { text: 'NIGHT CLUB', color: '#b04bff' },
  { text: 'PIZZERIA', color: '#ff3b3b' },
  { text: 'SUSHI • 24H', color: '#3cff8a' },
  { text: 'DISCO', color: '#ff5ab0' },
];
export const NEON_COUNT = NEONS.length;

/** Neon tabela atlası: 2 sütun x 4 satır (512x128), siyah zemin üzerinde parlayan tüp yazı. */
export function neonTexture() {
  const W = 1024;
  const H = 512;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = '#07070c';
  ctx.fillRect(0, 0, W, H);
  NEONS.forEach((n, i) => {
    const x = (i % 2) * 512;
    const y = Math.floor(i / 2) * 128;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, 512, 128);
    ctx.clip();
    ctx.fillStyle = '#0d0b14';
    ctx.fillRect(x + 4, y + 4, 504, 120);
    ctx.font = 'bold 66px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Dış parıltı katmanları
    ctx.shadowColor = n.color;
    for (const [blur, alpha] of [[30, 0.9], [14, 1]]) {
      ctx.shadowBlur = blur;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = n.color;
      ctx.lineWidth = 7;
      ctx.strokeText(n.text, x + 256, y + 66, 470);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 6;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(n.text, x + 256, y + 66, 470);
    // Çerçeve tüpü
    ctx.shadowBlur = 16;
    ctx.strokeStyle = n.color;
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 14, y + 12, 484, 104);
    ctx.restore();
  });
  return toTexture(canvas, { repeat: false, anisotropy: 4 });
}

/** Kaldırım taşları: 2 m x 2 m döşeme (4x4 taş). */
export function paverTexture() {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const rnd = mulberry32(5);
  const n = 4;
  const c = S / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = 196 + Math.floor((rnd() - 0.5) * 26);
      ctx.fillStyle = `rgb(${v},${v - 8},${v - 22})`;
      ctx.fillRect(x * c, y * c, c, c);
    }
  }
  ctx.strokeStyle = 'rgba(70,60,50,0.55)';
  ctx.lineWidth = 3;
  for (let k = 0; k <= n; k++) {
    ctx.beginPath(); ctx.moveTo(k * c, 0); ctx.lineTo(k * c, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, k * c); ctx.lineTo(S, k * c); ctx.stroke();
  }
  addNoise(ctx, S, S, 18, 9, 22, 32);
  return toTexture(canvas, { anisotropy: 8 });
}

/** Taş blok duvar (rıhtım, tünel ağzı): 4 m x 4 m. */
export function stoneTexture() {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const rnd = mulberry32(8);
  ctx.fillStyle = '#6d5c4c';
  ctx.fillRect(0, 0, S, S);
  const rows = 6;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 === 0 ? 0 : -rh * 0.8;
    while (x < S) {
      const w = rh * (1.4 + rnd() * 0.9);
      const v = 170 + Math.floor((rnd() - 0.5) * 40);
      ctx.fillStyle = `rgb(${v},${v - 18},${v - 42})`;
      ctx.fillRect(x + 2, r * rh + 2, w - 4, rh - 4);
      // Taşın ucu döşemeye sarsın
      if (x + w > S) {
        ctx.fillRect(x + 2 - S, r * rh + 2, w - 4, rh - 4);
      }
      x += w;
    }
  }
  addNoise(ctx, S, S, 20, 4, 30, 32);
  return toTexture(canvas, { anisotropy: 8 });
}

/** Tünel duvar karoları: 4 m x 4 m; alt 1 m koyu bant. */
export function tunnelTileTexture() {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#d9d2c2';
  ctx.fillRect(0, 0, S, S);
  const n = 16;
  const c = S / n;
  const rnd = mulberry32(14);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = 222 + Math.floor((rnd() - 0.5) * 18);
      ctx.fillStyle = `rgb(${v},${v - 6},${v - 18})`;
      ctx.fillRect(x * c + 1, y * c + 1, c - 2, c - 2);
    }
  }
  ctx.fillStyle = '#3b3f46';
  ctx.fillRect(0, S - S / 4, S, S / 4);
  ctx.fillStyle = '#f0c419';
  ctx.fillRect(0, S - S / 4 - 6, S, 6);
  addNoise(ctx, S, S, 10, 6, 26, 32);
  return toTexture(canvas, { anisotropy: 8 });
}

/** Bayrak atlası: 4x2 (128x128). */
export function flagsTexture() {
  const W = 512;
  const H = 256;
  const { canvas, ctx } = makeCanvas(W, H);
  const designs = [
    (x, y) => { stripes(ctx, x, y, ['#e8202a', '#ffffff', '#e8202a'], true); },
    (x, y) => { stripes(ctx, x, y, ['#1f4fd8', '#ffd21a', '#1f4fd8'], false); },
    (x, y) => { checker(ctx, x, y); },
    (x, y) => { stripes(ctx, x, y, ['#16a34a', '#ffffff', '#ff7a1a'], false); },
    (x, y) => { stripes(ctx, x, y, ['#ffffff', '#e8202a'], true); },
    (x, y) => { stripes(ctx, x, y, ['#0a84ff', '#ffffff'], true); ctx.fillStyle = '#ffd21a'; ctx.beginPath(); ctx.arc(x + 64, y + 64, 26, 0, Math.PI * 2); ctx.fill(); },
    (x, y) => { stripes(ctx, x, y, ['#111111', '#ffd21a', '#e8202a'], false); },
    (x, y) => { stripes(ctx, x, y, ['#bf5af2', '#ffffff', '#bf5af2'], true); },
  ];
  designs.forEach((fn, i) => fn((i % 4) * 128, Math.floor(i / 4) * 128));
  return toTexture(canvas, { repeat: false, anisotropy: 4 });
}

function stripes(ctx, x, y, cols, horizontal) {
  const n = cols.length;
  cols.forEach((c, i) => {
    ctx.fillStyle = c;
    if (horizontal) ctx.fillRect(x, y + (i * 128) / n, 128, 128 / n + 1);
    else ctx.fillRect(x + (i * 128) / n, y, 128 / n + 1, 128);
  });
}

function checker(ctx, x, y) {
  const c = 16;
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? '#111111' : '#f5f5f5';
      ctx.fillRect(x + i * c, y + j * c, c, c);
    }
  }
}

/** Start kapısı ekranı. */
export function gantryScreenTexture() {
  const W = 1024;
  const H = 128;
  const { canvas, ctx } = makeCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#0b1230');
  g.addColorStop(0.5, '#1a0b30');
  g.addColorStop(1, '#0b1230');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Dama uçlar
  for (const x0 of [0, W - 96]) {
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = (i + j) % 2 === 0 ? '#f5f5f5' : '#111';
        ctx.fillRect(x0 + i * 16, j * 16, 16, 16);
      }
    }
  }
  ctx.font = 'italic 900 78px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ff7a1a';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('RIVIERA SUNSET', W / 2, H / 2 + 4, 760);
  return toTexture(canvas, { repeat: false, anisotropy: 8 });
}

export { THREE };
