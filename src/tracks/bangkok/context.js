// Mekân yerleşimi için ortak bağlam: tohumlu rastgele, ayak izi çakışması, yola uzaklık, nehir kıyısı.
import * as THREE from 'three';
import { mulberry32 } from '../../track/textures.js';
import { frameAt } from '../../track/structures.js';
import { RIVER, BTS_LINE } from './layout.js';

export const GROUND_Y = 0.2;
export const LOW_SPEC = typeof navigator !== 'undefined'
  && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1);

export function createContext(track, group) {
  const rnd = mulberry32(8086);
  const rr = (a, b) => a + (b - a) * rnd();
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const footprints = [];
  const sec = Object.fromEntries(track.sections.map((s) => [s.id, s]));

  // Doğu kıyısı (bank[]): kıyı yolunun (kuzeye giden düz kesimler) nehir tarafı kenarından bankOffset dışarıda
  // (RIVER.side: nehir yolun sağında = 1 → yol batı yakada, doğu kıyısı bir nehir genişliği ötede); uçlarda düz uzar.
  const bank = [];
  const f = {};
  const side = RIVER.side || -1;
  for (let s = sec.river.s0; s < sec.river.s1; s += 10) {
    frameAt(track, s, f);
    if (f.tz > -0.97) continue; // köşe yayları değil, kuzeye giden kesim
    const off = side * RIVER.bankOffset;
    const extra = side > 0 ? RIVER.width : 0;
    bank.push([f.x + f.rx * off + extra, f.z + f.rz * off]);
  }
  bank.sort((a, b) => a[1] - b[1]);
  bank.unshift([bank[0][0], -4000]);
  bank.push([bank[bank.length - 1][0], 4000]);
  const bankX = (z) => {
    for (let i = 0; i < bank.length - 1; i++) {
      const [x0, z0] = bank[i];
      const [x1, z1] = bank[i + 1];
      if (z >= z0 && z <= z1) return x0 + ((x1 - x0) * (z - z0)) / Math.max(1e-6, z1 - z0);
    }
    return bank[0][0];
  };
  const isWater = (x, z, margin = 0) => {
    const b = bankX(z);
    return x < b + margin && x > b - RIVER.width - margin;
  };

  const ctx = {
    track,
    group,
    rnd,
    rr,
    pick,
    sec,
    footprints,
    bank,
    bankX,
    isWater,
    W2: track.width / 2,
    density: LOW_SPEC ? 0.55 : 1,
    lightSpots: [], // { x, y, z, s, color: Color } — gerçek nokta ışıklarının dolaştığı yerler
    streaks: [], // { s, lateral, len, width, color: Color } — ıslak yoldaki ışık yansımaları
    glows: [], // { x, y, z, color } — küçük ışıkların additive hâleleri
    dist(x, z) {
      return track.distanceToCenterline(x, z) - 1;
    },
    overlaps(x, z, r) {
      for (const fp of footprints) if ((fp.x - x) ** 2 + (fp.z - z) ** 2 < (fp.r + r) ** 2) return true;
      return false;
    },
    reserve(x, z, r) {
      footprints.push({ x, z, r });
    },
    frame(s, out) {
      return frameAt(track, s, out || {});
    },
    /** BTS viyadüğünün altında mı (bina konamaz)? */
    underBts(x, z, pad = 0) {
      return Math.abs(z - BTS_LINE.z) < 8 + pad && x > BTS_LINE.x0 - 20 && x < BTS_LINE.x1 + 20;
    },
    addLightSpot(x, y, z, color, strength = 1) {
      const pr = track.project(new THREE.Vector3(x, y, z));
      if (Math.abs(pr.lateral) > 34) return null;
      const spot = { x, y, z, s: pr.s, color: new THREE.Color(color), strength };
      ctx.lightSpots.push(spot);
      return spot;
    },
  };
  return ctx;
}

export { frameAt };
