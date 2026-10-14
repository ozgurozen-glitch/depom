// "Bangkok Nights" pist yerleşimi. Saf matematik (DOM / three bağımlılığı yok) — node'da da test edilebilir.
//
// Koordinatlar: x doğu, z güney (metre). Yön: start düzlüğünde (Sukhumvit, BTS viyadüğünün altı) doğuya
// gidilir; Silom'un dik şehir köşeleriyle güneydoğuya inilir, yükseltilmiş otoyola (expressway) tırmanılıp
// batıya uzun düzlük ve büyük atlama rampası, inişle Chao Phraya kıyı yoluna (kuzeye, nehir solda),
// Chinatown pazar sokağından (doğuya) ve Yaowarat'tan (güneye) geçilerek starta dönülür.
//
// Merkez çizgisi köşeleri yuvarlatılmış (fillet) bir çokgenden üretilir: düz kesimler gerçekten düz,
// köşeler verilen yarıçapta çember yayı. Üretilen sık noktalar Track'in Catmull-Rom'una kontrol noktası olur.

export const ROAD_WIDTH = 20;

// Çokgen köşeleri (sürüş sırasıyla): [x, z, köşe yarıçapı]
export const CORNERS = [
  [300, 0, 36], // Sukhumvit sonu → Silom (sağ, güneye)
  [300, 190, 34], // sol, doğuya
  [520, 190, 34], // sağ, güneye
  [520, 560, 75], // sağ, batıya — otoyola tırmanış
  [-610, 560, 60], // sağ, kuzeye — nehir kıyısı
  [-640, 150, 420], // kıyı yolunun hafif kıvrımı
  [-610, -300, 40], // sağ, doğuya — Chinatown
  [-500, -312, 160], // pazar sokağında hafif kırılma
  [-380, -300, 32], // sağ, güneye — Yaowarat
  [-380, 0, 34], // sol, doğuya — start düzlüğü
];

export const START_MARKER = [-120, 0];

// Yükselti anahtarları: [x, z, y] (periyodik monoton kübik). Şehir 0.6 m, kıyı yolu 1.0 m, otoyol 13 m.
export const ELEVATION_KEYS = [
  [-120, 0, 0.6],
  [250, 0, 0.6],
  [520, 260, 0.6],
  [520, 420, 0.6],
  [300, 560, 13],
  [-120, 560, 13],
  [-185, 560, 13],
  [-470, 560, 1.0],
  [-625, 300, 1.0],
  [-620, -200, 1.0],
  [-500, -312, 0.6],
  [-380, -150, 0.6],
];

export const SECTION_MARKERS = [
  { id: 'sukhumvit', at: [-340, 0] },
  { id: 'silom', at: [300, 40] },
  { id: 'expressway', at: [520, 400] },
  { id: 'river', at: [-600, 480] },
  { id: 'chinatown', at: [-570, -302] },
];

// Rampalar: işaretçi noktasından itibaren s0 = at, s1 = s0 + length.
export const RAMP_DEFS = [
  // Silom: sağ yarıda atlama
  { at: [520, 290], length: 20, height: 1.7, latMin: 1.0, latMax: 9.0, type: 'jump' },
  // Otoyol düzlüğünün sonunda büyük atlama (iniş eğiminin üstünden uçulur)
  { at: [-122, 560], length: 28, height: 2.7, latMin: -7.5, latMax: 7.5, type: 'jump' },
  // Kıyı yolu: kara tarafında takla rampası
  { at: [-624, 120], length: 20, height: 1.9, latMin: 0.6, latMax: 9.4, type: 'roll' },
  // Yaowarat: doğu yarıda küçük atlama
  { at: [-380, -175], length: 18, height: 1.6, latMin: -9.2, latMax: -1.0, type: 'jump' },
];

// Nitro tüpleri: [x, z, lateral]
export const PICKUP_DEFS = [
  [40, 0, -4],
  [300, 110, 4],
  [430, 190, -3],
  [520, 430, -4],
  [150, 560, 4],
  [-50, 560, 0],
  [-617, 330, -4],
  [-628, -80, 4],
  [-470, -309, 3],
  [-380, -60, 5],
];

/**
 * Köşeleri yuvarlatılmış kapalı çokgeni örnekler. Döndürür: { points: [[x,z]], arcs: [{cx,cz,R,...}] }.
 * Düzlüklerde `straightStep`, yaylarda `arcStep` metrede bir nokta.
 */
export function filletPath(corners, { straightStep = 24, arcStep = 5 } = {}) {
  const n = corners.length;
  const segs = [];
  for (let i = 0; i < n; i++) {
    const [px, pz] = corners[(i - 1 + n) % n];
    const [x, z, R] = corners[i];
    const [nx, nz] = corners[(i + 1) % n];
    let ix = x - px; let iz = z - pz;
    const il = Math.hypot(ix, iz); ix /= il; iz /= il;
    let ox = nx - x; let oz = nz - z;
    const ol = Math.hypot(ox, oz); ox /= ol; oz /= ol;
    const cross = ix * oz - iz * ox; // > 0: z güneye bakan sistemde sağa dönüş
    const dot = ix * ox + iz * oz;
    const theta = Math.atan2(Math.abs(cross), dot);
    const t = R * Math.tan(theta / 2);
    const ax = x - ix * t; const az = z - iz * t;
    const bx = x + ox * t; const bz = z + oz * t;
    // Merkez: giriş yönüne dik, dönüş tarafında
    const side = Math.sign(cross) || 1;
    const cx = ax + -iz * side * R;
    const cz = az + ix * side * R;
    segs.push({ ax, az, bx, bz, cx, cz, R, theta, side, t, inLen: il, outLen: ol });
  }
  const points = [];
  for (let i = 0; i < n; i++) {
    const c = segs[i];
    // Yay A → B
    const a0 = Math.atan2(c.az - c.cz, c.ax - c.cx);
    const steps = Math.max(2, Math.ceil((c.R * c.theta) / arcStep));
    for (let k = 0; k < steps; k++) {
      const a = a0 + c.side * c.theta * (k / steps);
      points.push([c.cx + Math.cos(a) * c.R, c.cz + Math.sin(a) * c.R]);
    }
    // Düz B → sonraki A
    const nxt = segs[(i + 1) % n];
    const len = Math.hypot(nxt.ax - c.bx, nxt.az - c.bz);
    const m = Math.max(1, Math.round(len / straightStep));
    for (let k = 0; k < m; k++) {
      const f = k / m;
      points.push([c.bx + (nxt.ax - c.bx) * f, c.bz + (nxt.az - c.bz) * f]);
    }
  }
  return { points, segs };
}

const path = filletPath(CORNERS);

export const BANGKOK_LAYOUT = {
  name: 'Bangkok Nights',
  width: ROAD_WIDTH,
  controlPoints: path.points,
  startMarker: START_MARKER,
  elevationKeys: ELEVATION_KEYS,
  sections: SECTION_MARKERS,
  ramps: RAMP_DEFS,
  pickups: PICKUP_DEFS,
  tunnel: null,
  subdiv: 10,
};

// Mekân için sabitler
export const RIVER = {
  // Doğu kıyısı: kıyı yolunun sol kenarından bu kadar dışarıda (m, merkez çizgisinden)
  bankOffset: 15.5,
  width: 360,
  waterY: -1.3,
};
export const BTS_LINE = { z: 0, x0: -1150, x1: 1250, deckBottom: 9.4 }; // start düzlüğü boyunca, yolun üstünde
