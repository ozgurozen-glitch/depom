// "Bangkok Nights" prosedürel dokuları (CanvasTexture, ≤1024 px). Tabelalardaki Tayca/Çince görünümlü yazılar
// uydurma kıvrımlardır (gerçek kelime, marka veya logo yok).
import * as THREE from 'three';
import {
  makeCanvas, toTexture, mulberry32, tileFbm, tileNoise, coarseField, paintPixels,
} from '../../track/textures.js';

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// ---------------------------------------------------------------------------------------------
// Uydurma yazı: Tayca görünümlü (baş halkası + kavisli gövde), Çince görünümlü (kare içinde vuruşlar)

/** Tek bir Tayca-benzeri harf; (x, y) taban çizgisinin solu, h harf yüksekliği. Genişliği döndürür. */
function thaiGlyph(ctx, x, y, h, rnd) {
  const w = h * (0.62 + rnd() * 0.22);
  const r = h * 0.13;
  const top = y - h;
  const kind = Math.floor(rnd() * 6);
  ctx.beginPath();
  if (kind === 0) {
    // ก/ถ benzeri: altta solda halka, sol gövde yukarı, üstten kavis, sağdan aşağı
    ctx.arc(x + r, y - r, r, Math.PI * 0.5, Math.PI * 2.4);
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, top + h * 0.35);
    ctx.quadraticCurveTo(x, top, x + w * 0.5, top);
    ctx.quadraticCurveTo(x + w, top, x + w, top + h * 0.35);
    ctx.lineTo(x + w, y);
  } else if (kind === 1) {
    // บ/ป benzeri: üstte solda halka, sol gövde aşağı, alttan sağa, sağ gövde yukarı
    ctx.arc(x + r, top + r, r, Math.PI, Math.PI * 2.9);
    ctx.moveTo(x, top + r);
    ctx.lineTo(x, y - h * 0.2);
    ctx.quadraticCurveTo(x, y, x + w * 0.5, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y - h * 0.2);
    ctx.lineTo(x + w, top + (rnd() < 0.4 ? -h * 0.25 : 0));
  } else if (kind === 2) {
    // ม/ฆ benzeri: iki tümsek
    ctx.arc(x + r, top + r, r, Math.PI, Math.PI * 2.9);
    ctx.moveTo(x, top + r);
    ctx.lineTo(x, y);
    ctx.lineTo(x + w * 0.5, y - h * 0.45);
    ctx.lineTo(x + w * 0.5, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y - h * 0.3);
    ctx.lineTo(x + w, top);
  } else if (kind === 3) {
    // ร/ว benzeri: S kıvrımı
    ctx.arc(x + w - r, top + r, r, 0, Math.PI * 1.9);
    ctx.moveTo(x + w - r * 2, top + r);
    ctx.quadraticCurveTo(x, top + h * 0.1, x + w * 0.2, top + h * 0.45);
    ctx.quadraticCurveTo(x + w, top + h * 0.6, x + w * 0.7, y);
    ctx.lineTo(x + w * 0.15, y);
  } else if (kind === 4) {
    // ด/ค benzeri: içe kıvrılan halka
    ctx.moveTo(x + w * 0.35, y - h * 0.35);
    ctx.arc(x + w * 0.35 - r, y - h * 0.35, r, 0, Math.PI * 2);
    ctx.moveTo(x + w * 0.35 - r * 2, y - h * 0.35);
    ctx.lineTo(x, y);
    ctx.moveTo(x, top + h * 0.5);
    ctx.quadraticCurveTo(x, top, x + w * 0.5, top);
    ctx.quadraticCurveTo(x + w, top, x + w, top + h * 0.4);
    ctx.lineTo(x + w, y);
  } else {
    // อ/ข benzeri: kapalı oval + gövde
    ctx.ellipse(x + w * 0.5, y - h * 0.45, w * 0.5, h * 0.45, 0, 0, Math.PI * 2);
    ctx.moveTo(x + w * 0.3, top + h * 0.15);
    ctx.arc(x + w * 0.3, top + h * 0.15 + r, r, -Math.PI / 2, Math.PI * 1.5);
  }
  // Üst/alt ünlü işaretleri
  if (rnd() < 0.3) {
    ctx.moveTo(x + w * 0.2, top - h * 0.18);
    ctx.quadraticCurveTo(x + w * 0.6, top - h * 0.42, x + w * 0.9, top - h * 0.2);
  } else if (rnd() < 0.15) {
    ctx.moveTo(x + w * 0.7 + r * 0.6, y + h * 0.22);
    ctx.arc(x + w * 0.7, y + h * 0.22, r * 0.6, 0, Math.PI * 2);
  }
  ctx.stroke();
  return w;
}

/** Tayca-benzeri kelime(ler); genişliği döndürür (draw = false ise yalnızca ölçer). */
function thaiText(ctx, x, y, h, nGlyphs, seed, draw = true) {
  const rnd = mulberry32(seed);
  let cx = x;
  for (let i = 0; i < nGlyphs; i++) {
    if (i > 0 && rnd() < 0.12) cx += h * 0.45; // kelime arası
    cx += thaiGlyph(draw ? ctx : nullCtx, cx, y, h, rnd) + h * 0.16;
  }
  return cx - x;
}

const nullCtx = {
  beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, ellipse() {}, stroke() {},
};

/** Çince-benzeri karakter: s x s karede yatay/dikey vuruşlar ve noktalar. */
function hanziGlyph(ctx, x, y, s, rnd) {
  ctx.beginPath();
  const n = 3 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    if (rnd() < 0.55) {
      const yy = y + s * (0.12 + rnd() * 0.76);
      const x0 = x + s * rnd() * 0.3;
      ctx.moveTo(x0, yy);
      ctx.lineTo(x0 + s * (0.4 + rnd() * 0.5), yy);
    } else {
      const xx = x + s * (0.15 + rnd() * 0.7);
      const y0 = y + s * rnd() * 0.3;
      ctx.moveTo(xx, y0);
      ctx.lineTo(xx + (rnd() - 0.5) * s * 0.25, y0 + s * (0.4 + rnd() * 0.55));
    }
  }
  if (rnd() < 0.5) {
    ctx.moveTo(x + s * 0.5, y + s * 0.45);
    ctx.lineTo(x + s * 0.12, y + s * 0.95);
    ctx.moveTo(x + s * 0.5, y + s * 0.45);
    ctx.lineTo(x + s * 0.9, y + s * 0.95);
  }
  ctx.stroke();
}

// ---------------------------------------------------------------------------------------------
// Islak asfalt: renk (24 m) + pürüzlülük (48 m, su birikintileri)

export function wetAsphaltTextures({ widthM = 20, lengthM = 24 } = {}) {
  const W = 512;
  const H = 1024;
  const { canvas, ctx } = makeCanvas(W, H);
  const rnd = mulberry32(17);
  const pxPerMx = W / widthM;
  const pxPerMy = H / lengthM;
  const wearCol = new Float32Array(W);
  const dashCol = new Uint8Array(W);
  const edgeCol = new Uint8Array(W);
  for (let x = 0; x < W; x++) {
    const lat = x / pxPerMx - widthM / 2;
    let wear = 0;
    for (const c of [-7.5, -2.5, 2.5, 7.5]) {
      for (const o of [-0.85, 0.85]) {
        const d = (lat - c - o) / 0.35;
        wear += Math.exp(-d * d);
      }
    }
    wearCol[x] = Math.min(1, wear);
    for (const c of [-5, 0, 5]) if (Math.abs(lat - c) < 0.08) dashCol[x] = 1;
    for (const c of [-9.15, 9.15]) if (Math.abs(lat - c) < 0.11) edgeCol[x] = 1;
  }
  const low = coarseField(W, H, 8, (x, y) => tileFbm(x / 64, y / 64, W / 64, H / 64, 4, 41));
  paintPixels(ctx, W, H, (x, y, out) => {
    const n1 = low[y * W + x];
    const n2 = tileNoise(x / 5, y / 5, W / 5, H / 5, 43);
    let base = 34 + (n1 - 0.5) * 18 + (n2 - 0.5) * 8 + (rnd() - 0.5) * 16;
    if (rnd() < 0.01) base += 30 * rnd();
    base *= 1 - 0.18 * wearCol[x] * (0.7 + 0.3 * n1);
    let r = base * 0.92;
    let g = base * 0.95;
    let b = base * 1.06;
    const dashOn = ((y / pxPerMy) % 12) < 6;
    if ((dashCol[x] && dashOn) || edgeCol[x]) {
      const worn = 0.78 + 0.22 * tileNoise(x / 3, y / 3, W / 3, H / 3, 21) - (rnd() < 0.1 ? 0.3 : 0);
      if (edgeCol[x]) { r = 222 * worn; g = 196 * worn; b = 92 * worn; } else { r = 214 * worn; g = 214 * worn; b = 208 * worn; }
    }
    out[0] = clamp255(r);
    out[1] = clamp255(g);
    out[2] = clamp255(b);
  });
  const map = toTexture(canvas, { anisotropy: 16 });

  // Pürüzlülük (G kanalı): ıslak asfalt ~0.3, lastik izleri daha pürüzsüz, birikintiler ayna gibi
  const RW = 256;
  const RH = 512;
  const rough = makeCanvas(RW, RH);
  const puddle = coarseField(RW, RH, 4, (x, y) => tileFbm(x / 40, y / 40, RW / 40, RH / 40, 4, 77));
  const rr = mulberry32(3);
  paintPixels(rough.ctx, RW, RH, (x, y, out) => {
    const lat = (x / RW) * widthM - widthM / 2;
    let wear = 0;
    for (const c of [-7.5, -2.5, 2.5, 7.5]) {
      for (const o of [-0.85, 0.85]) {
        const d = (lat - c - o) / 0.45;
        wear += Math.exp(-d * d);
      }
    }
    const p = puddle[y * RW + x];
    let v = 0.36 - Math.min(1, wear) * 0.1 + (rr() - 0.5) * 0.08;
    const edge = Math.abs(lat) > widthM / 2 - 1.6 ? 0.35 : 0; // kenarlarda su birikir
    const pud = THREE.MathUtils.smoothstep(p + edge * 0.5, 0.56, 0.7);
    v = v * (1 - pud) + 0.07 * pud;
    const g = clamp255(v * 255);
    out[0] = g; out[1] = g; out[2] = g;
  });
  const roughnessMap = toTexture(rough.canvas, { color: false, anisotropy: 8 });
  return { map, roughnessMap };
}

// ---------------------------------------------------------------------------------------------
// Bariyer atlası (Riviera ile aynı düzen: 4 satır x 128 px, u boyunca 16 m, v profil boyunca).
// Satırlar: 0 şehir (beyaz-kırmızı bloklar), 1 otoyol (gri beton, mavi bant), 2 nehir (beyaz, lacivert
// şerit), 3 Chinatown (sarı-siyah). Işık yansıtıcıları ayrı emissive dokuda.
export const BKK_BARRIER_ROWS = 4;

export function barrierTextures() {
  const W = 1024;
  const H = 512;
  const RH = H / BKK_BARRIER_ROWS;
  const { canvas, ctx } = makeCanvas(W, H);
  const em = makeCanvas(W, H);
  em.ctx.fillStyle = '#000';
  em.ctx.fillRect(0, 0, W, H);
  const pxPerM = W / 16;
  for (let row = 0; row < BKK_BARRIER_ROWS; row++) {
    const y0 = row * RH;
    for (let k = 0; k < 8; k++) {
      let col;
      if (row === 0) col = k % 2 === 0 ? '#c8202a' : '#e8e6e0';
      else if (row === 1) col = '#8e8c88';
      else if (row === 2) col = '#dcdad4';
      else col = k % 2 === 0 ? '#e8b818' : '#1a1a1a';
      ctx.fillStyle = col;
      ctx.fillRect(k * 2 * pxPerM, y0, 2 * pxPerM, RH);
    }
    if (row === 1) {
      ctx.fillStyle = '#1d4fb8';
      ctx.fillRect(0, y0 + RH * 0.5, W, RH * 0.08);
    }
    if (row === 2) {
      ctx.fillStyle = '#1b2a5c';
      ctx.fillRect(0, y0 + RH * 0.42, W, RH * 0.16);
    }
    if (row === 3) {
      // Çapraz çizgiler (sarı-siyah ikaz)
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y0, W, RH * 0.72);
      ctx.clip();
      for (let k = -4; k < 40; k++) {
        ctx.fillStyle = k % 2 === 0 ? '#e8b818' : '#1a1a1a';
        ctx.beginPath();
        const x = k * 32;
        ctx.moveTo(x, y0 + RH);
        ctx.lineTo(x + 32, y0 + RH);
        ctx.lineTo(x + 32 + RH, y0);
        ctx.lineTo(x + RH, y0);
        ctx.fill();
      }
      ctx.restore();
    }
    // Derzler (her 4 m)
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let k = 0; k <= 4; k++) ctx.fillRect(k * 4 * pxPerM - 2, y0, 4, RH * 0.72);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, y0 + RH * 0.72, W, RH * 0.1);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, y0 + RH * 0.82, W, RH * 0.18);
    const grd = ctx.createLinearGradient(0, y0, 0, y0 + RH * 0.3);
    grd.addColorStop(0, 'rgba(10,10,14,0.6)');
    grd.addColorStop(1, 'rgba(10,10,14,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, y0, W, RH * 0.3);
    // Yansıtıcılar (her 4 m, üst kenarın hemen altında): kehribar / beyaz
    for (let k = 0; k < 4; k++) {
      const x = k * 4 * pxPerM + 2 * pxPerM - 10;
      const y = y0 + RH * 0.6;
      ctx.fillStyle = '#ffb030';
      ctx.fillRect(x, y, 20, 12);
      em.ctx.fillStyle = row === 1 ? '#7fb8ff' : '#ffa424';
      em.ctx.fillRect(x, y, 20, 12);
    }
  }
  // Beton gürültüsü
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const rnd = mulberry32(19);
  const low = coarseField(W, H, 4, (x, y) => tileFbm(x / 24, y / 24, W / 24, H / 24, 3, 23));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      const n = (low[y * W + x] - 0.5) * 40 + (rnd() - 0.5) * 16;
      d[k] = clamp255(d[k] * 0.86 + n);
      d[k + 1] = clamp255(d[k + 1] * 0.86 + n);
      d[k + 2] = clamp255(d[k + 2] * 0.86 + n);
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = toTexture(canvas, { anisotropy: 8 });
  map.wrapT = THREE.ClampToEdgeWrapping;
  const emissiveMap = toTexture(em.canvas, { anisotropy: 4 });
  emissiveMap.wrapT = THREE.ClampToEdgeWrapping;
  return { map, emissiveMap };
}

// ---------------------------------------------------------------------------------------------
// Tabela atlası: üst yarı 8 yatay tabela (512x128, 2 sütun x 4 satır), alt yarı 8 dikey (128x512).

const NEON_COLORS = ['#ff2bd6', '#3cf2ff', '#ffe23c', '#ff6a1c', '#b04bff', '#ff3b5c', '#3cff8a', '#ff9ad6'];

/** Tabela meta verisi: atlas UV dikdörtgeni ve tabelanın baskın rengi (ışık/yansıma için). */
export const SIGNS = [];
for (let i = 0; i < 8; i++) {
  SIGNS.push({ kind: 'h', u0: (i % 2) * 0.5, v0: 1 - (Math.floor(i / 2) + 1) * 0.125, u1: (i % 2) * 0.5 + 0.5, v1: 1 - Math.floor(i / 2) * 0.125, aspect: 4, color: NEON_COLORS[i] });
}
for (let i = 0; i < 8; i++) {
  SIGNS.push({ kind: 'v', u0: i * 0.125, v0: 0, u1: (i + 1) * 0.125, v1: 0.5, aspect: 0.25, color: NEON_COLORS[(i * 3 + 1) % 8] });
}

function neonStroke(ctx, color, draw, widths = [9, 4]) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowBlur = 22;
  ctx.lineWidth = widths[0];
  ctx.globalAlpha = 0.75;
  draw();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 8;
  ctx.lineWidth = widths[1];
  draw();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(1.2, widths[1] * 0.4);
  draw();
  ctx.restore();
}

export function signsTexture() {
  const S = 1024;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#050508';
  ctx.fillRect(0, 0, S, S);
  const latin = ['HOTEL', 'BAR', '24H', 'NOODLE', 'SPA', 'KARAOKE', 'GOLD', 'MASSAGE'];
  // Yatay tabelalar
  for (let i = 0; i < 8; i++) {
    const x = (i % 2) * 512;
    const y = Math.floor(i / 2) * 128;
    const col = NEON_COLORS[i];
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, 512, 128);
    ctx.clip();
    const style = i % 4;
    if (style === 1 || style === 3) {
      // Işıklı kutu: açık zemin, koyu/kırmızı yazı
      const bg = style === 1 ? ['#fff2b0', '#ffd94a'] : ['#e8f6ff', '#9ad8ff'];
      const g = ctx.createLinearGradient(0, y, 0, y + 128);
      g.addColorStop(0, bg[0]);
      g.addColorStop(1, bg[1]);
      ctx.fillStyle = g;
      ctx.fillRect(x + 6, y + 6, 500, 116);
      ctx.strokeStyle = style === 1 ? '#c8141c' : '#123a9c';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      thaiText(ctx, x + 30, y + 86, 46, 9, 100 + i);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = 'bold 30px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(latin[i], x + 490, y + 112);
    } else {
      ctx.fillStyle = '#0b0a12';
      ctx.fillRect(x + 4, y + 4, 504, 120);
      neonStroke(ctx, col, () => {
        ctx.beginPath();
        ctx.rect(x + 14, y + 12, 484, 104);
        ctx.stroke();
      }, [8, 3]);
      const w = thaiText(ctx, 0, 0, 48, 7, 200 + i, false);
      neonStroke(ctx, col, () => thaiText(ctx, x + 256 - Math.min(w, 300) / 2 - 60, y + 84, 48, 7, 200 + i), [10, 4]);
      ctx.save();
      ctx.font = 'bold 34px sans-serif';
      ctx.textAlign = 'right';
      ctx.shadowColor = col;
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(latin[i], x + 484, y + 76);
      ctx.restore();
    }
    ctx.restore();
  }
  // Dikey tabelalar (Chinatown: kırmızı zemin + altın karakterler; diğerleri neon Tayca)
  for (let i = 0; i < 8; i++) {
    const x = i * 128;
    const y = 512;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, 128, 512);
    ctx.clip();
    const rnd = mulberry32(300 + i);
    if (i % 2 === 0) {
      ctx.fillStyle = i % 4 === 0 ? '#b0101a' : '#0f2a7a';
      ctx.fillRect(x + 6, y + 6, 116, 500);
      ctx.strokeStyle = '#f6c84a';
      ctx.lineWidth = 5;
      ctx.strokeRect(x + 12, y + 12, 104, 488);
      ctx.strokeStyle = '#ffe7a0';
      ctx.lineWidth = 7;
      ctx.lineCap = 'square';
      for (let k = 0; k < 5; k++) hanziGlyph(ctx, x + 26, y + 30 + k * 94, 76, rnd);
    } else {
      const col = NEON_COLORS[(i * 3 + 1) % 8];
      ctx.fillStyle = '#0b0a12';
      ctx.fillRect(x + 4, y + 4, 120, 504);
      neonStroke(ctx, col, () => {
        ctx.beginPath();
        ctx.rect(x + 12, y + 12, 104, 488);
        ctx.stroke();
      }, [7, 3]);
      for (let k = 0; k < 6; k++) {
        const seed = 400 + i * 10 + k;
        neonStroke(ctx, col, () => thaiText(ctx, x + 36, y + 84 + k * 78, 52, 1, seed), [9, 4]);
      }
    }
    ctx.restore();
  }
  return toTexture(canvas, { repeat: false, anisotropy: 4 });
}

// ---------------------------------------------------------------------------------------------

/** Kaldırım: koyu ıslak karolar, 2 m x 2 m (4x4 karo). */
export function sidewalkTexture() {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const rnd = mulberry32(61);
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const v = 70 + rnd() * 26;
      ctx.fillStyle = `rgb(${v * 0.95},${v * 0.93},${v})`;
      ctx.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
    }
  }
  ctx.fillStyle = '#1c1c22';
  for (let k = 0; k <= 4; k++) {
    ctx.fillRect(k * 64 - 2, 0, 4, S);
    ctx.fillRect(0, k * 64 - 2, S, 4);
  }
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 18;
    d[i] = clamp255(d[i] + n); d[i + 1] = clamp255(d[i + 1] + n); d[i + 2] = clamp255(d[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(canvas, { anisotropy: 8 });
}

/** Şehir zemini (bina araları, ara sokaklar): koyu ıslak beton, 32 m döşeme. */
export function groundTexture() {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const low = coarseField(S, S, 8, (x, y) => tileFbm(x / 96, y / 96, S / 96, S / 96, 4, 91));
  const rnd = mulberry32(93);
  paintPixels(ctx, S, S, (x, y, out) => {
    const v = 30 + (low[y * S + x] - 0.5) * 22 + (rnd() - 0.5) * 12;
    out[0] = clamp255(v * 0.95); out[1] = clamp255(v * 0.95); out[2] = clamp255(v * 1.05);
  });
  // Seyrek şerit / yaya geçidi izleri
  ctx.fillStyle = 'rgba(200,200,190,0.35)';
  for (let k = 0; k < 6; k++) ctx.fillRect(40 + k * 18, 240, 10, 60);
  return toTexture(canvas, { anisotropy: 8 });
}

/** Islak yol yansıma çizgisi: boyuna yumuşak, kırık (dalgacıklı) parlak şerit. u enine, v boyuna. */
export function streakTexture() {
  const W = 64;
  const H = 256;
  const { canvas, ctx } = makeCanvas(W, H);
  const rnd = mulberry32(71);
  paintPixels(ctx, W, H, (x, y, out) => {
    const u = (x + 0.5) / W - 0.5;
    const v = (y + 0.5) / H; // 0 ışığın dibi (uzak uç) → 1 yakın uç
    const across = Math.exp(-(u * u) / 0.03);
    const along = Math.min(1, v * 6) * (1 - v) ** 1.4;
    const ripple = 0.6 + 0.4 * tileNoise(x / 6, y / 3, W / 6, H / 3, 5) + (rnd() - 0.5) * 0.15;
    const a = Math.max(0, across * along * ripple);
    const c = clamp255(a * 255);
    out[0] = c; out[1] = c; out[2] = c; out[3] = 255;
  });
  return toTexture(canvas, { repeat: false, anisotropy: 4 });
}

/** Yumuşak radyal parıltı (additive). */
export function softGlowTexture() {
  const { canvas, ctx } = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return toTexture(canvas, { repeat: false, anisotropy: 1 });
}

/** Skytrain vagonu yan yüzü: beyaz gövde, renkli şerit, pencere bandı. emissive: yalnız pencereler. */
export function trainTextures() {
  const W = 512;
  const H = 128;
  const { canvas, ctx } = makeCanvas(W, H);
  const em = makeCanvas(W, H);
  ctx.fillStyle = '#e9ecef';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#18a058';
  ctx.fillRect(0, 92, W, 12);
  ctx.fillStyle = '#1b3f9e';
  ctx.fillRect(0, 104, W, 8);
  em.ctx.fillStyle = '#000';
  em.ctx.fillRect(0, 0, W, H);
  for (let k = 0; k < 8; k++) {
    const x = 14 + k * 62;
    const door = k === 2 || k === 5;
    ctx.fillStyle = '#1a2230';
    ctx.fillRect(x, door ? 22 : 28, 46, door ? 76 : 44);
    em.ctx.fillStyle = door ? '#c8d8f0' : '#fff6e0';
    em.ctx.fillRect(x + 2, (door ? 22 : 28) + 2, 42, door ? 30 : 40);
  }
  return {
    map: toTexture(canvas, { repeat: false, anisotropy: 4 }),
    emissiveMap: toTexture(em.canvas, { repeat: false, anisotropy: 4 }),
  };
}

/** Yükseltilmiş istasyon cephesi: alt bant panjur, üst bant aydınlık cam. */
export function stationTexture() {
  const W = 512;
  const H = 128;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = '#c9ccd0';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#20262e';
  ctx.fillRect(0, 18, W, 54);
  for (let x = 0; x < W; x += 32) {
    ctx.fillStyle = '#e8f0ff';
    ctx.fillRect(x + 3, 22, 26, 46);
  }
  ctx.fillStyle = '#8a9098';
  for (let y = 80; y < 124; y += 6) ctx.fillRect(0, y, W, 3);
  ctx.fillStyle = '#18a058';
  ctx.fillRect(0, 72, W, 6);
  return toTexture(canvas, { repeat: true, anisotropy: 4 });
}

/** Gökdelen pencere ızgarası (MahaNakhon benzeri kule): 2 kat x 2 sütun / karo. Renk + emissive. */
export function towerWindowTextures() {
  const S = 128;
  const { canvas, ctx } = makeCanvas(S, S);
  const em = makeCanvas(S, S);
  ctx.fillStyle = '#2a323c';
  ctx.fillRect(0, 0, S, S);
  em.ctx.fillStyle = '#000';
  em.ctx.fillRect(0, 0, S, S);
  const rnd = mulberry32(5);
  // 4 x 4 cam (karo = 6 m küp yüzü: 2 kat x 2 sütun, her biri 2x2 cam)
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = '#3d5466';
      ctx.fillRect(i * 32 + 2, j * 32 + 3, 28, 24);
      const v = rnd();
      em.ctx.fillStyle = v < 0.3 ? '#ffd8a0' : v < 0.45 ? '#bcd8f0' : v < 0.6 ? '#4a3a28' : '#0c0c10';
      em.ctx.fillRect(i * 32 + 3, j * 32 + 4, 26, 22);
    }
  }
  return {
    map: toTexture(canvas, { anisotropy: 4 }),
    emissiveMap: toTexture(em.canvas, { anisotropy: 4 }),
  };
}

/** Start kapısı ekranı: "BANGKOK NIGHTS" + Tayca-benzeri alt yazı. */
export function bkkGantryTexture() {
  const W = 1024;
  const H = 128;
  const { canvas, ctx } = makeCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#22052e');
  g.addColorStop(0.5, '#071a3a');
  g.addColorStop(1, '#22052e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (const x0 of [0, W - 96]) {
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = (i + j) % 2 === 0 ? '#f5f5f5' : '#111';
        ctx.fillRect(x0 + i * 16, j * 16, 16, 16);
      }
    }
  }
  ctx.font = 'italic 900 70px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ff2bd6';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('BANGKOK NIGHTS', W / 2 - 40, H / 2 - 6, 640);
  ctx.strokeStyle = '#3cf2ff';
  ctx.shadowColor = '#3cf2ff';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  thaiText(ctx, W / 2 + 300, H / 2 + 22, 30, 5, 909);
  return toTexture(canvas, { repeat: false, anisotropy: 8 });
}

/** Pazar tentesi: beyaz-açık gri şeritler (örnek rengiyle boyanır). u enine, v eğim boyunca. */
export function awningTexture() {
  const { canvas, ctx } = makeCanvas(128, 64);
  for (let k = 0; k < 8; k++) {
    ctx.fillStyle = k % 2 === 0 ? '#ffffff' : '#9a9a9a';
    ctx.fillRect(k * 16, 0, 16, 64);
  }
  // Saçak (alt kenar)
  ctx.fillStyle = '#ffffff';
  for (let k = 0; k < 16; k++) {
    ctx.beginPath();
    ctx.arc(k * 8 + 4, 58, 4, 0, Math.PI);
    ctx.fill();
  }
  return toTexture(canvas, { repeat: true, anisotropy: 4 });
}

export { THREE };
