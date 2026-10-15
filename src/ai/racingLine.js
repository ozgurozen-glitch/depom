// Yarış çizgisi: pist başına bir kez hesaplanır ve tüm BotDriver'lar tarafından paylaşılır.
//
// Pist merkez çizgisi `track.sample` ile ~2 m aralıkla örneklenir. Her örnek için yanal ofset, yol sınırları
// (±(genişlik/2 - EDGE_MARGIN)) içinde kalarak toplam eğrilik karesini (ikinci farkların karesi) en aza
// indirecek şekilde çözülür. Bu, virajlarda doğal olarak dış-iç-dış (outside-inside-outside) çizgiyi verir.
// Ardından çizginin işaretli eğriliği (+ sağa dönüş, sözleşmedeki `steer > 0` ile aynı yön) ve ileriye
// bakan en büyük eğrilik (nitro kararı için) ön hesaplanır. Sıcak yoldaki tüm sorgular tipli diziler
// üzerinden yapılır; nesne üretilmez.

const SPACING = 2; // m, örnek aralığı
const EDGE_MARGIN = 3.0; // m, çizginin araç merkezi için kenar payı (viraj çıkışında dışa savrulma payı dahil)
const CURV_HALF_SPAN = 3; // örnek; eğrilik ±6 m'lik üç nokta çemberinden
const CURV_SMOOTH = 3; // örnek; eğrilik kutu filtresi yarı genişliği
const SWING_WINDOW = 70; // m
const SWING_MAX = 0.02; // 1/m: daha sıkı (R < ~100 m) ters virajlarda normal viraj hızı sınırı zaten belirleyici
const AHEAD_WINDOW = 200; // m, ileriye bakan en büyük eğrilik penceresi

const cache = new WeakMap();

/** Pist için paylaşılan yarış çizgisini döndürür (pist başına bir kez hesaplanır). */
export function getRacingLine(track) {
  let line = cache.get(track);
  if (!line || line.trackLength !== track.length) {
    line = new RacingLine(track);
    cache.set(track, line);
  }
  return line;
}

export class RacingLine {
  constructor(track) {
    const L = track.length;
    const n = Math.max(32, Math.round(L / SPACING));
    this.trackLength = L;
    this.n = n;
    this.ds = L / n;

    this.cx = new Float64Array(n); // merkez çizgisi
    this.cy = new Float64Array(n);
    this.cz = new Float64Array(n);
    this.rx = new Float64Array(n); // sağ vektör (XZ, birim)
    this.rz = new Float64Array(n);
    this.tx = new Float64Array(n); // teğet (XZ, birim)
    this.tz = new Float64Array(n);
    this.halfW = new Float64Array(n); // yol yarı genişliği
    this.off = new Float64Array(n); // yarış çizgisinin yanal ofseti
    this.kappa = new Float64Array(n); // çizginin işaretli eğriliği (1/m), + sağa dönüş
    this.kAhead = new Float64Array(n);
    this.kSwing = new Float64Array(n); // yön değiştiren (S) virajlarda ±SWING_WINDOW içindeki eğrilik farkı (1/m), aksi halde 0 // önümüzdeki AHEAD_WINDOW metrede en büyük |eğrilik|

    const defaultWidth = Number.isFinite(track.width) ? track.width : 20;
    for (let i = 0; i < n; i++) {
      const smp = track.sample(i * this.ds);
      this.cx[i] = smp.pos.x;
      this.cy[i] = smp.pos.y;
      this.cz[i] = smp.pos.z;
      let tx = smp.tangent ? smp.tangent.x : 0;
      let tz = smp.tangent ? smp.tangent.z : 0;
      let tl = Math.hypot(tx, tz);
      let rx = smp.right ? smp.right.x : 0;
      let rz = smp.right ? smp.right.z : 0;
      let rl = Math.hypot(rx, rz);
      if (tl < 1e-6 && rl > 1e-6) { tx = rz; tz = -rx; tl = rl; } // right = tangent × up = (-tz, 0, tx)
      if (rl < 1e-6 && tl > 1e-6) { rx = -tz; rz = tx; rl = tl; }
      if (tl < 1e-6) { tx = 0; tz = 1; tl = 1; rx = -1; rz = 0; rl = 1; }
      this.tx[i] = tx / tl;
      this.tz[i] = tz / tl;
      this.rx[i] = rx / rl;
      this.rz[i] = rz / rl;
      const w = Number.isFinite(smp.width) && smp.width > 0 ? smp.width : defaultWidth;
      this.halfW[i] = w / 2;
    }

    this.solveOffsets();
    this.computeCurvature();
    this.computeAheadMax();
    this.computeSwing();

    this.ramps = Array.isArray(track.ramps)
      ? track.ramps.filter((r) => r && Number.isFinite(r.s0) && Number.isFinite(r.s1)).slice().sort((a, b) => a.s0 - b.s0)
      : [];
  }

  // En küçük eğrilik çizgisi: sınırlı (projected) Gauss-Seidel, kaba-ince adımlarla.
  // Enerji Σ|P(i-k) - 2P(i) + P(i+k)|²; P(i) için kesin en küçük nokta (-P(i-2k) + 4P(i-k) + 4P(i+k) - P(i+2k)) / 6,
  // P yalnızca sağ vektör boyunca hareket edebildiğinden bu noktanın izdüşümü alınır ve sınırlara kırpılır.
  solveOffsets() {
    const { n, cx, cz, rx, rz, halfW, off } = this;
    const lim = new Float64Array(n);
    const px = new Float64Array(n);
    const pz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      lim[i] = Math.max(0, halfW[i] - EDGE_MARGIN);
      off[i] = 0;
      px[i] = cx[i];
      pz[i] = cz[i];
    }
    const levels = [32, 16, 8, 4, 2, 1];
    for (const k of levels) {
      if (k * 4 >= n) continue;
      const iters = k >= 8 ? 40 : 80;
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < n; i++) {
          const a = (i - 2 * k + 2 * n) % n;
          const b = (i - k + n) % n;
          const c = (i + k) % n;
          const d = (i + 2 * k) % n;
          const gx = (-px[a] + 4 * px[b] + 4 * px[c] - px[d]) / 6;
          const gz = (-pz[a] + 4 * pz[b] + 4 * pz[c] - pz[d]) / 6;
          let o = (gx - cx[i]) * rx[i] + (gz - cz[i]) * rz[i];
          if (o > lim[i]) o = lim[i];
          else if (o < -lim[i]) o = -lim[i];
          off[i] = o;
          px[i] = cx[i] + o * rx[i];
          pz[i] = cz[i] + o * rz[i];
        }
      }
    }
  }

  computeCurvature() {
    const { n, cx, cz, rx, rz, off, kappa } = this;
    const raw = new Float64Array(n);
    const K = Math.min(CURV_HALF_SPAN, Math.floor(n / 4));
    for (let i = 0; i < n; i++) {
      const a = (i - K + n) % n;
      const c = (i + K) % n;
      const ax = cx[a] + off[a] * rx[a];
      const az = cz[a] + off[a] * rz[a];
      const bx = cx[i] + off[i] * rx[i];
      const bz = cz[i] + off[i] * rz[i];
      const qx = cx[c] + off[c] * rx[c];
      const qz = cz[c] + off[c] * rz[c];
      const ux = bx - ax;
      const uz = bz - az;
      const wx = qx - bx;
      const wz = qz - bz;
      // (ux,uz)×(wx,wz) > 0 ⇔ sağa dönüş (yaw azalır)
      const cross = ux * wz - uz * wx;
      const denom = Math.hypot(ux, uz) * Math.hypot(wx, wz) * Math.hypot(qx - ax, qz - az);
      raw[i] = denom > 1e-9 ? (2 * cross) / denom : 0;
    }
    const S = CURV_SMOOTH;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = -S; j <= S; j++) sum += raw[(i + j + n) % n];
      kappa[i] = sum / (2 * S + 1);
    }
  }

  // S virajlar: pencerede hem sağa hem sola dönüş varsa (maks κ - min κ). Yaw oranının ters dönmesi gerektiğinden
  // salt |κ|'dan çok daha zordur; hız planı bunu ayrıca sınırlar.
  computeSwing() {
    const { n, kappa, kSwing, ds } = this;
    const w = Math.max(1, Math.round(SWING_WINDOW / ds));
    for (let i = 0; i < n; i++) {
      let mx = -1e9;
      let mn = 1e9;
      for (let j = -w; j <= w; j++) {
        const k = kappa[(i + j + n) % n];
        if (k > mx) mx = k;
        if (k < mn) mn = k;
      }
      kSwing[i] = mx > 4e-4 && mn < -4e-4 ? mx - mn : 0;
    }
  }

  computeAheadMax() {
    const { n, kappa, kAhead } = this;
    const win = Math.min(n, Math.max(1, Math.round(AHEAD_WINDOW / this.ds)));
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let j = 0; j < win; j++) {
        const k = Math.abs(kappa[(i + j) % n]);
        if (k > m) m = k;
      }
      kAhead[i] = m;
    }
  }

  swingAtIndex(i) {
    let k = i % this.n;
    if (k < 0) k += this.n;
    return this.kSwing[k];
  }

  /** s'yi [0, n) kesirli örnek indeksine çevirir. */
  indexOf(s) {
    let x = (s / this.ds) % this.n;
    if (x < 0) x += this.n;
    return x;
  }

  interp(arr, s) {
    const x = this.indexOf(s);
    const i = Math.floor(x);
    const f = x - i;
    const i0 = i >= this.n ? 0 : i;
    const i1 = i0 + 1 >= this.n ? 0 : i0 + 1;
    return arr[i0] + (arr[i1] - arr[i0]) * f;
  }

  lateralAt(s) { return this.interp(this.off, s); }
  curvatureAt(s) { return this.interp(this.kappa, s); }
  halfWidthAt(s) { return this.interp(this.halfW, s); }
  maxCurvatureAhead(s) { return this.kAhead[Math.floor(this.indexOf(s)) % this.n]; }

  /** |eğrilik| tamsayı örnek indeksinde (sarar). */
  absCurvatureAtIndex(i) {
    let k = i % this.n;
    if (k < 0) k += this.n;
    return Math.abs(this.kappa[k]);
  }

  /** s'deki teğeti (XZ) out.x/out.z'ye yazar. */
  tangentAt(s, out) {
    const x = this.indexOf(s);
    const i = Math.floor(x) % this.n;
    out.x = this.tx[i];
    out.z = this.tz[i];
    return out;
  }

  /** s'ye en yakın (alttaki) örneğin tamsayı indeksi; rx/rz/halfW gibi dizilere doğrudan erişim için. */
  sampleIndex(s) {
    return Math.floor(this.indexOf(s)) % this.n;
  }

  /** (s, lateral) noktasının dünya koordinatını out.x/y/z'ye yazar (nesne üretmez). */
  pointAt(s, lateral, out) {
    const x = this.indexOf(s);
    const i = Math.floor(x);
    const f = x - i;
    const i0 = i >= this.n ? 0 : i;
    const i1 = i0 + 1 >= this.n ? 0 : i0 + 1;
    const g = 1 - f;
    const rx = this.rx[i0] * g + this.rx[i1] * f;
    const rz = this.rz[i0] * g + this.rz[i1] * f;
    out.x = this.cx[i0] * g + this.cx[i1] * f + rx * lateral;
    out.y = this.cy[i0] * g + this.cy[i1] * f;
    out.z = this.cz[i0] * g + this.cz[i1] * f + rz * lateral;
    return out;
  }

  /** s'den itibaren `range` metre içinde başlayan ilk rampa (yoksa null) ve ona uzaklık. */
  nextRamp(s, range, out) {
    out.ramp = null;
    out.dist = Infinity;
    const L = this.trackLength;
    const ramps = this.ramps;
    for (let k = 0; k < ramps.length; k++) {
      const r = ramps[k];
      let d = r.s0 - s;
      d -= Math.floor(d / L) * L; // [0, L)
      // rampanın üzerindeysek de (s0 geride, s1 ileride) say
      let inside = s - r.s0;
      inside -= Math.floor(inside / L) * L;
      if (inside <= r.s1 - r.s0) d = 0;
      if (d <= range && d < out.dist) {
        out.ramp = r;
        out.dist = d;
      }
    }
    return out;
  }
}
