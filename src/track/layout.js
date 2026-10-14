// "Riviera Sunset" pist yerleşimi: merkez çizgisi kontrol noktaları, yükselti profili, bölümler,
// rampalar ve nitro konumları. Saf matematik (DOM / three bağımlılığı yok) — node'da da test edilebilir.
//
// Koordinatlar: x doğu, z güney (metre). Deniz güneyde ve doğuda, dağlar kuzeyde, şehir batıda.
// Yön: start düzlüğünde doğuya gidilir; sahile kıvrılıp limandan geçilir, tünelle burun dönülür,
// kuzeye tepe tırmanılır (firkete), batıya uzun iniş, şehir merkezi ve bulvarla starta dönülür.

export const ROAD_WIDTH = 20;

// Kapalı merkez çizgisi (centripetal Catmull-Rom ile yumuşatılır).
export const CONTROL_POINTS = [
  // Start / finish düzlüğü (doğuya)
  [-440, 200], [-300, 200], [-160, 200], [-40, 204],
  // Sahile inen sağ viraj
  [70, 228], [170, 290], [270, 366],
  // Liman yolu (deniz sağda)
  [385, 407], [525, 420], [662, 410],
  // Tünel: burnun altından sola kavis
  [768, 380], [846, 318], [893, 226],
  // Tepe tırmanışı (kuzeye, deniz sağda, S virajlar)
  [916, 128], [899, 40], [914, -46], [892, -112],
  // Firkete (sola ~180°)
  [874, -170], [824, -206], [776, -184],
  // Geri dönüş ve batıya sağ viraj (tepe noktası)
  [757, -130], [740, -78], [684, -48],
  // Uzun iniş düzlüğü (batıya)
  [480, -46], [280, -54], [80, -60],
  // Şehir merkezi bulvarı (S şikanı)
  [-110, -58], [-205, -50], [-262, -24], [-332, -10], [-420, -14],
  // Güneye kıvrılan bulvar ve son viraj
  [-496, 30], [-522, 104], [-502, 168],
];

// s = 0 (start/finish çizgisi) bu noktaya en yakın merkez noktasıdır.
export const START_MARKER = [-300, 200];

// Yükselti anahtarları: [x, z, y]. Yatay yay uzunluğuna göre periyodik monoton kübik ile ara değerlenir.
export const ELEVATION_KEYS = [
  [-300, 200, 0.6],
  [-40, 204, 0.6],
  [270, 366, 0.6],
  [662, 410, 0.8],
  [846, 318, 1.8],
  [893, 226, 3.4],
  [899, 40, 11],
  [892, -112, 20],
  [823, -204, 25.5],
  [762, -114, 32],
  [700, -48, 37],
  [480, -46, 28],
  [280, -54, 18],
  [80, -60, 8.5],
  [-110, -58, 2.4],
  [-420, -14, 1.0],
  [-522, 104, 0.6],
];

// Bölüm sınırları (bölüm, işaretçinin s'inden başlar). Sıra s'e göre artan olmalı.
export const SECTION_MARKERS = [
  { id: 'start', at: [-470, 192] },
  { id: 'harbor', at: [110, 250] },
  { id: 'tunnel', at: [705, 401] },
  { id: 'climb', at: [893, 222] },
  { id: 'descent', at: [700, -48] },
  { id: 'city', at: [-60, -59] },
];

// Rampalar: işaretçi noktasından itibaren s0 = at, s1 = s0 + length.
export const RAMP_DEFS = [
  { at: [452, 412], length: 20, height: 1.7, latMin: 1.0, latMax: 9.0, type: 'jump' },
  { at: [520, -46], length: 26, height: 2.6, latMin: -6.5, latMax: 6.5, type: 'jump' },
  { at: [175, -57], length: 20, height: 1.9, latMin: -9.4, latMax: -0.6, type: 'roll' },
  { at: [70, -60], length: 20, height: 1.9, latMin: 0.6, latMax: 9.4, type: 'roll' },
];

// Nitro tüpleri: [x, z, lateral]
export const PICKUP_DEFS = [
  [-120, 201, -5],
  [330, 390, -4],
  [600, 418, 5],
  [800, 360, 0],
  [907, 60, 4],
  [770, -150, -3],
  [600, -45, 0],
  [120, -59, 4],
  [-250, -50, -5],
  [-520, 60, 5],
];

// Riviera yerleşimi tek nesne olarak (Track'e verilen `layout` parametresinin varsayılanı).
// Başka pistler aynı alanlarla kendi yerleşimlerini tanımlar (bkz. src/tracks/bangkok/layout.js).
//   controlPoints, startMarker, elevationKeys: merkez çizgisi (buildCenterline)
//   sections: [{ id, at }], ramps: RAMP_DEFS biçimi, pickups: [x, z, lateral]
//   tunnel: tünel bölümünün id'si (yoksa null), subdiv: kontrol parçası başına yoğun örnek
export const RIVIERA_LAYOUT = {
  name: 'Riviera Sunset',
  width: ROAD_WIDTH,
  controlPoints: CONTROL_POINTS,
  startMarker: START_MARKER,
  elevationKeys: ELEVATION_KEYS,
  sections: SECTION_MARKERS,
  ramps: RAMP_DEFS,
  pickups: PICKUP_DEFS,
  tunnel: 'tunnel',
  subdiv: 120,
};

// ---------------------------------------------------------------------------------------------

function centripetalCR(p0, p1, p2, p3, t) {
  // Barry-Goldman piramidal formülasyonu, alpha = 0.5
  const d01 = Math.max(1e-4, Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])));
  const d12 = Math.max(1e-4, Math.sqrt(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])));
  const d23 = Math.max(1e-4, Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1])));
  const t0 = 0;
  const t1 = t0 + d01;
  const t2 = t1 + d12;
  const t3 = t2 + d23;
  const tt = t1 + (t2 - t1) * t;
  const out = [0, 0];
  for (let k = 0; k < 2; k++) {
    const a1 = ((t1 - tt) * p0[k] + (tt - t0) * p1[k]) / (t1 - t0);
    const a2 = ((t2 - tt) * p1[k] + (tt - t1) * p2[k]) / (t2 - t1);
    const a3 = ((t3 - tt) * p2[k] + (tt - t2) * p3[k]) / (t3 - t2);
    const b1 = ((t2 - tt) * a1 + (tt - t0) * a2) / (t2 - t0);
    const b2 = ((t3 - tt) * a2 + (tt - t1) * a3) / (t3 - t1);
    out[k] = ((t2 - tt) * b1 + (tt - t1) * b2) / (t2 - t1);
  }
  return out;
}

// Periyodik monoton kübik Hermite (Fritsch-Carlson). keys: [{u, y}] u'ya göre sıralı, periyot P.
function makePeriodicMonotone(keys, P) {
  const n = keys.length;
  const u = keys.map((k) => k.u);
  const y = keys.map((k) => k.y);
  const h = [];
  const d = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const du = (u[j] - u[i] + P) % P || P;
    h.push(du);
    d.push((y[j] - y[i]) / du);
  }
  const m = new Array(n);
  for (let i = 0; i < n; i++) {
    const dPrev = d[(i - 1 + n) % n];
    const dNext = d[i];
    if (dPrev * dNext <= 0) m[i] = 0;
    else {
      const hPrev = h[(i - 1 + n) % n];
      const hNext = h[i];
      const w1 = 2 * hNext + hPrev;
      const w2 = hNext + 2 * hPrev;
      m[i] = (w1 + w2) / (w1 / dPrev + w2 / dNext);
    }
  }
  return (q) => {
    q = ((q % P) + P) % P;
    // segment bul
    let i = n - 1;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const a = u[k];
      const b = j === 0 ? u[0] + P : u[j];
      let qq = q;
      if (qq < a) qq += P;
      if (qq >= a && qq < b) { i = k; q = qq; break; }
    }
    const j = (i + 1) % n;
    const t = (q - u[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * h[i] * m[i]
      + (-2 * t3 + 3 * t2) * y[j] + (t3 - t2) * h[i] * m[j];
  };
}

/**
 * Merkez çizgisini kurar ve sabit aralıklı (spacing, 3B yay uzunluğu) tablolar döndürür.
 * Dizin 0 = s 0 (layout.startMarker'a en yakın nokta).
 */
export function buildCenterline({ spacing = 2, subdiv, layout = RIVIERA_LAYOUT } = {}) {
  const P = layout.controlPoints;
  if (subdiv === undefined) subdiv = layout.subdiv || 120;
  const n = P.length;

  // 1) Yoğun 2B örnekleme
  const dense = [];
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n];
    const p1 = P[i];
    const p2 = P[(i + 1) % n];
    const p3 = P[(i + 2) % n];
    for (let k = 0; k < subdiv; k++) dense.push(centripetalCR(p0, p1, p2, p3, k / subdiv));
  }
  const M = dense.length;
  const uArr = new Float64Array(M + 1);
  for (let i = 1; i <= M; i++) {
    const a = dense[i - 1];
    const b = dense[i % M];
    uArr[i] = uArr[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const L2 = uArr[M];

  const nearestDense = (x, z) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < M; i++) {
      const d = (dense[i][0] - x) ** 2 + (dense[i][1] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  // 2) Yükselti (yatay yay uzunluğuna göre)
  const keys = layout.elevationKeys.map(([x, z, y]) => ({ u: uArr[nearestDense(x, z)], y }));
  keys.sort((a, b) => a.u - b.u);
  const elev = makePeriodicMonotone(keys, L2);

  // 3) 3B yay uzunluğu
  const ys = new Float64Array(M + 1);
  for (let i = 0; i <= M; i++) ys[i] = elev(uArr[i]);
  const L3arr = new Float64Array(M + 1);
  for (let i = 1; i <= M; i++) {
    const a = dense[i - 1];
    const b = dense[i % M];
    L3arr[i] = L3arr[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], ys[i] - ys[i - 1]);
  }
  const L3 = L3arr[M];

  // 4) Başlangıç: START_MARKER'a en yakın yoğun nokta, 3B uzunluk ofseti
  const startIdx = nearestDense(layout.startMarker[0], layout.startMarker[1]);
  const s0off = L3arr[startIdx];

  const N = Math.round(L3 / spacing);
  const ds = L3 / N;
  const px = new Float64Array(N);
  const py = new Float64Array(N);
  const pz = new Float64Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    let target = s0off + i * ds;
    if (target >= L3) target -= L3;
    // L3arr monoton artan; ikili arama
    let lo = 0;
    let hi = M;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (L3arr[mid] <= target) lo = mid; else hi = mid;
    }
    j = lo;
    const seg = L3arr[j + 1] - L3arr[j];
    const f = seg > 0 ? (target - L3arr[j]) / seg : 0;
    const a = dense[j];
    const b = dense[(j + 1) % M];
    px[i] = a[0] + (b[0] - a[0]) * f;
    pz[i] = a[1] + (b[1] - a[1]) * f;
    py[i] = ys[j] + (ys[j + 1] - ys[j]) * f;
  }

  // 5) Teğet / sağ / yukarı / eğrilik
  const tx = new Float64Array(N);
  const ty = new Float64Array(N);
  const tz = new Float64Array(N);
  const rx = new Float64Array(N);
  const rz = new Float64Array(N);
  const ux = new Float64Array(N);
  const uy = new Float64Array(N);
  const uz = new Float64Array(N);
  const heading = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N;
    const b = (i + 1) % N;
    let dx = px[b] - px[a];
    let dy = py[b] - py[a];
    let dz = pz[b] - pz[a];
    const l = Math.hypot(dx, dy, dz);
    dx /= l; dy /= l; dz /= l;
    tx[i] = dx; ty[i] = dy; tz[i] = dz;
    const h = Math.hypot(dx, dz);
    rx[i] = -dz / h;
    rz[i] = dx / h;
    // up = right × tangent
    ux[i] = 0 * dz - rz[i] * dy;
    uy[i] = rz[i] * dx - rx[i] * dz;
    uz[i] = rx[i] * dy - 0 * dx;
    heading[i] = Math.atan2(dx, dz);
  }
  // Eğrilik (1/m, işaretli: > 0 sola dönüş)
  const curvature = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = heading[(i - 2 + N) % N];
    const b = heading[(i + 2) % N];
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    curvature[i] = d / (4 * ds);
  }

  return { N, ds, length: L3, px, py, pz, tx, ty, tz, rx, rz, ux, uy, uz, heading, curvature };
}
