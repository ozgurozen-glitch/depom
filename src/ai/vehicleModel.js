// Araç davranış modeli: botların arabanın gerçek tepkisini çalışma anında öğrendiği paylaşılan tahminci.
//
// BotDriver, Car'ın iç fiziğini bilmez (sözleşme yalnızca girdi/çıktıyı tanımlar). Direksiyon kazancı,
// tam direksiyondaki dönüş kapasitesi, azami hız ve fren yavaşlaması gözlemlerden öğrenilir; böylece
// aynı yapay zekâ farklı araba fiziklerinde (kinematik, yanal kaymalı, düşük/yüksek tutuş) doğru çalışır.
// Aynı sınıftan tüm arabalar tek bir modeli paylaşır (daha çok örnek → daha hızlı öğrenme).
//
// Hız kutuları (BIN m/s) boyunca saklanan büyüklük "birim direksiyon başına yol yönü dönüş hızı"dır
// (rad/s); eğrilik kazancı = bu / hız.

const BIN = 10; // m/s
const NB = 12; // 0..120 m/s
const PRIOR_RATE_LOW = 2.1; // rad/s, düşük hızda tam direksiyon (ön kabul)
const PRIOR_RATE_HIGH = 1.08; // rad/s, azami hızda tam direksiyon (ön kabul)
const PRIOR_TURN_RADIUS = 6.5; // m, en küçük dönüş yarıçapı (ön kabul)
const PRIOR_SAFETY = 0.85; // ön kabulün muhafazakâr çarpanı (gözlem geldikçe ölçek öğrenilir)
const DEFAULT_VMAX = 80; // m/s, bilinmiyorsa
const MIN_LAT_ACCEL = 10; // m/s², kapasite tahmininin alt sınırı
const LEARN_RATE = 0.04;
const TRUST_SAMPLES = 40; // kutunun kendi tahminine tam güven için örnek sayısı

const models = new WeakMap();

/** Araç modeli (spec) ya da — spec yoksa — Car sınıfı başına paylaşılan model. */
export function modelKey(car) {
  if (car && car.spec && typeof car.spec === 'object') return car.spec;
  return car && car.constructor ? car.constructor : VehicleModel;
}

export function getVehicleModel(car) {
  const key = modelKey(car);
  let m = models.get(key);
  if (!m) {
    m = new VehicleModel(key);
    models.set(key, m);
  }
  return m;
}

const binSpeed = (b) => (b + 0.5) * BIN;
// Hıza göre ön kabul: düşük hızda v/R ile, yüksek hızda azami hızla doğrusal azalan yaw oranıyla sınırlı.
// vmax (Car.maxSpeed) biliniyorsa eğri ona göre ölçeklenir; yoksa varsayılan. Gerçek değerler gözlemle öğrenilir.
const priorRate = (v, vmax = DEFAULT_VMAX) => PRIOR_SAFETY * Math.min(
  Math.max(v, 1) / PRIOR_TURN_RADIUS,
  PRIOR_RATE_LOW + (PRIOR_RATE_HIGH - PRIOR_RATE_LOW) * Math.min(1, Math.max(v, 0) / vmax) ** 1.3,
);

export class VehicleModel {
  constructor(key = null) {
    this.key = key;
    this.vmax = DEFAULT_VMAX;
    this.rate = new Float64Array(NB); // doğrusal bölge: dönüş hızı / direksiyon
    this.rateN = new Float64Array(NB);
    this.cap = new Float64Array(NB); // tam direksiyonda dönüş hızı
    this.capN = new Float64Array(NB);
    for (let b = 0; b < NB; b++) {
      this.rate[b] = priorRate(binSpeed(b), this.vmax);
      this.cap[b] = this.rate[b];
    }
    // Gözlenmemiş kutular için ön kabulün genel ölçeği.
    this.rateScale = 1;
    this.capScale = 1;
    this.capSeen = false;

    this.topSpeed = 0; // nitrosuz, düz yolda gözlenen azami hız (0 = bilinmiyor)
    this.topFixed = false; // Car.maxSpeed biliniyorsa gözlem yerine o kullanılır
    this.fleet = new WeakMap(); // araba → önceki adım (hız, yaw)
    this.lastCtx = null;
    this.brakeDecel = 24; // m/s², fren yavaşlaması
    this.driftTrust = 0.8; // driftin bu arabada çizgiyi bozmadan işe yarayıp yaramadığı (0..1)
  }

  /** Car.maxSpeed (aracın taban azami hızı) biliniyorsa gözlemin yerine geçer. */
  setTopSpeed(v) {
    this.topSpeed = v;
    this.topFixed = true;
    this.vmax = v;
  }

  sampleBins(arr, cnt, scale, v) {
    const u = Math.min(NB - 1, Math.max(0, v / BIN - 0.5));
    const i = Math.floor(u);
    const j = i + 1 < NB ? i + 1 : i;
    const f = u - i;
    const vi = this.blend(arr, cnt, scale, i);
    const vj = this.blend(arr, cnt, scale, j);
    return vi + (vj - vi) * f;
  }

  blend(arr, cnt, scale, b) {
    const w = Math.min(1, cnt[b] / TRUST_SAMPLES);
    return arr[b] * w + priorRate(binSpeed(b), this.vmax) * scale * (1 - w);
  }

  /** Birim direksiyon başına yol eğriliği (1/m). */
  steerGain(v) {
    const sp = Math.max(v, 4);
    return this.sampleBins(this.rate, this.rateN, this.rateScale, sp) / sp;
  }

  /** Bu hızdaki (komşu kutular dahil) direksiyon gözlemi sayısına göre güven: 0 (hiç gözlem yok) .. 1. */
  confidence(v) {
    const u = Math.min(NB - 1, Math.max(0, v / BIN - 0.5));
    const i = Math.floor(u);
    const j = i + 1 < NB ? i + 1 : i;
    const f = u - i;
    const c = this.rateN[i] + (this.rateN[j] - this.rateN[i]) * f;
    return c >= TRUST_SAMPLES ? 1 : c / TRUST_SAMPLES;
  }

  /** Tam direksiyonda elde edilebilir yanal ivme (m/s²). */
  lateralCapacity(v) {
    const sp = Math.max(v, 4);
    const r = this.capSeen
      ? this.sampleBins(this.cap, this.capN, this.capScale, sp)
      : this.sampleBins(this.rate, this.rateN, this.rateScale, sp);
    return Math.max(MIN_LAT_ACCEL, r * sp);
  }

  /**
   * Direksiyon gözlemi. steer: uygulanan (filtrelenmiş) direksiyon, v: yatay hız,
   * omegaRight: yol yönünün sağa dönüş hızı (rad/s, + sağ).
   */
  observeSteer(steer, v, omegaRight) {
    const a = Math.abs(steer);
    if (v < 6 || a < 0.12) return;
    let meas = omegaRight / steer;
    if (!(meas > 0)) return; // karşı yönde: çarpışma/kayma, yok say
    const u = Math.min(NB - 1, Math.max(0, v / BIN - 0.5));
    const i = Math.floor(u);
    const j = i + 1 < NB ? i + 1 : i;
    const f = u - i;
    const prior = priorRate(v, this.vmax);
    if (a < 0.85) {
      this.learnBin(this.rate, this.rateN, this.rateScale, i, meas, LEARN_RATE * a * (1 - f));
      this.learnBin(this.rate, this.rateN, this.rateScale, j, meas, LEARN_RATE * a * f);
      this.rateScale = clampRatio(this.rateScale + 0.01 * (meas / prior - this.rateScale));
    } else {
      if (!this.capSeen) {
        this.capSeen = true;
        this.capScale = this.rateScale;
        for (let b = 0; b < NB; b++) this.cap[b] = this.blend(this.rate, this.rateN, this.rateScale, b);
      }
      meas = (meas * a); // tam direksiyona (a ≈ 1) göre
      this.learnBin(this.cap, this.capN, this.capScale, i, meas, LEARN_RATE * (1 - f));
      this.learnBin(this.cap, this.capN, this.capScale, j, meas, LEARN_RATE * f);
      this.capScale = clampRatio(this.capScale + 0.01 * (meas / prior - this.capScale));
    }
  }

  learnBin(arr, cnt, scale, b, meas, k) {
    if (k <= 0) return;
    const cur = this.blend(arr, cnt, scale, b);
    // tek örnekte en çok ×2 değişim (sıçramalara karşı), ama sürekli kanıtla her değere ulaşabilir
    const m = Math.min(cur * 2, Math.max(cur * 0.5, meas));
    arr[b] = cur + (m - cur) * Math.min(1, k * 2);
    cnt[b] = Math.min(TRUST_SAMPLES * 4, cnt[b] + k / LEARN_RATE);
  }

  /**
   * Azami hız: tüm arabaların (insan oyuncu dahil) düz yolda, nitrosuz, yavaşlamadan ulaştığı en yüksek hız.
   * Aynı adımda birden çok sürücü çağırsa da bir kez işlenir (Game her adımda yeni bir ctx üretir).
   */
  observeFleet(ctx, dt, line) {
    if (ctx === this.lastCtx || !ctx || !ctx.cars) return;
    this.lastCtx = ctx;
    // drift güveni zamanla yavaşça geri gelir (ara sıra yeniden denensin)
    if (this.driftTrust < 0.5) this.driftTrust = Math.min(0.5, this.driftTrust + dt * 0.004);
    const cars = ctx.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || !c.velocity || !c.position) continue;
      if (modelKey(c) !== this.key) continue; // yalnızca aynı araç modeli
      let st = this.fleet.get(c);
      if (!st) {
        st = { speed: 0, yaw: 0, x: NaN, z: NaN, valid: false };
        this.fleet.set(c, st);
      }
      // aynı adım iki kez gözlenmesin (ctx yeniden kullanılsa bile)
      if (c.position.x === st.x && c.position.z === st.z) continue;
      st.x = c.position.x;
      st.z = c.position.z;
      const v = Number.isFinite(c.speed) ? c.speed : 0;
      if (st.valid && !c.wrecked && !c.airborne && !c.nitroActive && !c.drifting && c.ghost !== true && v > 20) {
        const acc = (v - st.speed) / dt;
        let dYaw = c.yaw - st.yaw;
        dYaw -= Math.round(dYaw / (2 * Math.PI)) * 2 * Math.PI;
        const vy = c.velocity.y || 0;
        if (acc > -0.6 && acc < 12 && Math.abs(dYaw / dt) < 0.05 && Math.abs(vy) < 1
          && Math.abs(line.curvatureAt(c.trackS)) < 1 / 500 && v > this.topSpeed && !this.topFixed) {
          this.topSpeed = v;
        }
      }
      st.speed = v;
      st.yaw = c.yaw;
      st.valid = !c.wrecked;
    }
  }

  observeBrake(decel) {
    if (!(decel > 4 && decel < 80)) return;
    this.brakeDecel += (decel - this.brakeDecel) * 0.03;
  }

  observeDrift(success) {
    this.driftTrust = Math.min(1, Math.max(0, this.driftTrust + (success ? 0.03 : -0.2)));
  }
}

function clampRatio(x) {
  return Math.min(8, Math.max(0.125, x));
}
