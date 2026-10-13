// BotDriver: Asphalt tarzı bot sürücü. Car'a yalnızca sözleşmedeki Input nesnesini üretir.
//
// Katmanlar (her adımda, sıcak yolda nesne üretmeden):
//   1. Öğrenme   — arabanın direksiyon kazancı / dönüş kapasitesi / azami hız / fren gözlemi (ai/vehicleModel.js)
//   2. Yanal plan — paylaşılan yarış çizgisi (ai/racingLine.js) + tercih edilen şerit + yetenek gürültüsü,
//                  üzerine öncelik sırasıyla: takedown saldırısı > sollama/kaçınma > rampa hedefi
//   3. Direksiyon — hıza bağlı ileri bakış noktasına pure-pursuit (araç yerel koordinatı, steer > 0 = sağ)
//   4. Hız        — çizgi eğriliğinden viraj hızı v = sqrt(aLat/κ), ileriye bakan fren mesafesi taraması,
//                  yeteneğe bağlı azami hız oranı, lastik bant (rubber banding)
//   5. Nitro / drift / takılma kurtarma
import { getRacingLine } from './ai/racingLine.js';
import { getVehicleModel } from './ai/vehicleModel.js';

const TUNING = {
  edge: 2, // m: hedef yanal konum en fazla ±(genişlik/2 - edge)
  lookaheadBase: 7, // m
  lookaheadTime: 0.5, // s (hızla çarpılır)
  lookaheadMin: 10,
  lookaheadMax: 55,
  steerSlew: 8, // 1/s, direksiyon çıkışının en hızlı değişimi
  steerFilterTau: 0.1, // s, arabaya uygulanan direksiyonun tahmini (öğrenme için)
  latAccelBase: 24, // m/s², en düşük yetenekte viraj ivmesi
  latAccelSkill: 12, // m/s², yetenekle eklenen
  capMarginBase: 0.78, // öğrenilen dönüş kapasitesinin kullanılan oranı
  capMarginSkill: 0.14,
  brakeMargin: 0.75, // öğrenilen fren yavaşlamasının planlamada kullanılan oranı
  speedRatioMin: 0.88, // yetenek 0 → azami hızın %88'i, yetenek 1 → %100
  laneBias: 3, // m, preferredLane = ±1 düzlükte bu kadar yana kayar
  avoidRange: 25, // m, öndeki arabaya bakış mesafesi (hızla biraz artar)
  avoidMargin: 0.9, // m, iki araç arasındaki yanal boşluk payı
  nitroMin: 0.3, // nitro barı bunun üstündeyse kullan
  driftMinSkill: 0.7,
  rubberBehind: 150, // m, oyuncunun bu kadar gerisindeyse hızlan
  rubberAhead: 250, // m, oyuncunun bu kadar önündeyse yavaşla
};

const TWO_PI = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrapAngle = (a) => a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI);
const smooth01 = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

// Aynı kurbana aynı anda tek bir bot saldırsın.
const attackClaims = new WeakMap();

let seedCounter = 0;
function makeRng(seed) {
  // mulberry32: sürücü başına tekrarlanabilir rastgelelik
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_BANDS = 16;

export class BotDriver {
  constructor(car, track, { skill = 0.8, aggression = 0.5, preferredLane = 0 } = {}) {
    this.car = car;
    this.track = track;
    this.skill = clamp(Number.isFinite(skill) ? skill : 0.8, 0, 1);
    this.aggression = clamp(Number.isFinite(aggression) ? aggression : 0.5, 0, 1);
    this.preferredLane = clamp(Number.isFinite(preferredLane) ? preferredLane : 0, -1, 1);
    this.line = getRacingLine(track);
    this.model = getVehicleModel(car);
    seedCounter++;
    this.rng = makeRng(Math.imul(seedCounter, 0x9e3779b1) ^ Math.round(this.skill * 7919));

    const k = this.skill;
    // Oyuncunun otopilotu iyi bir insan gibi gazı sonuna kadar kullanır; botlar yeteneğe göre.
    this.speedRatio = car.isPlayer ? 1 : TUNING.speedRatioMin + (1 - TUNING.speedRatioMin) * k;
    this.latAccel = TUNING.latAccelBase + TUNING.latAccelSkill * k;
    this.capMargin = TUNING.capMarginBase + TUNING.capMarginSkill * k;
    this.lineFollow = 0.55 + 0.45 * k; // düşük yetenek çizgiyi daha az keser
    this.reaction = 0.15 + 0.3 * (1 - k); // s, fren tepki gecikmesi
    this.wanderSigma = 0.2 + 1.3 * (1 - k); // m, yanal sapma
    this.steerNoiseSigma = 0.005 + 0.05 * (1 - k);

    this.input = { throttle: 0, brake: 0, steer: 0, nitro: false, drift: false };
    this.tmpPoint = { x: 0, y: 0, z: 0 };
    this.tmpTan = { x: 0, z: 0 };
    this.rampInfo = { ramp: null, dist: Infinity };
    this.bandLo = new Float64Array(MAX_BANDS);
    this.bandHi = new Float64Array(MAX_BANDS);
    this.bandSpeed = new Float64Array(MAX_BANDS);
    this.bandDs = new Float64Array(MAX_BANDS);
    this.bandCount = 0;

    this.racing = false;
    this.attackTarget = null;
    this.attackCooldown = 0;
    this.resetState();
  }

  resetState() {
    this.raceClock = 0;
    this.steerOut = 0;
    this.steerApplied = 0;
    this.prevValid = false;
    this.prevHeading = 0;
    this.prevYaw = 0;
    this.prevVx = 0;
    this.prevVz = 0;
    this.prevSpeedF = 0;
    this.lastThrottle = 0;
    this.lastBrake = 0;
    this.sinceRespawn = 0;
    this.wasWrecked = false;

    this.wander = 0;
    this.steerNoise = 0;

    this.overrideLat = 0;
    this.overrideW = 0;
    this.avoidActive = false;
    this.avoidLat = 0;
    this.avoidSide = 0;
    this.avoidHold = 0;
    this.followSpeed = Infinity;

    this.releaseAttack();
    this.attackCooldown = 3 + this.rng() * 4;
    this.attackCheck = 0;

    this.rampKey = null;
    this.rampLap = -1;
    this.rampTake = false;

    this.nitroHold = false;
    this.nitroHeldT = 0;
    this.prevBurst = -1;
    this.chainPressAt = 0.8;

    this.driftOn = false;
    this.driftT = 0;
    this.driftMaxErr = 0;

    this.stuckT = 0;
    this.recoverT = 0;
    this.stuckGrace = 0;
    this.wallT = 0;
  }

  getInput(dt, ctx) {
    const input = this.input;
    const car = this.car;
    if (!ctx || !ctx.raceStarted || !(dt > 0)) {
      this.zeroInput();
      this.prevValid = false;
      this.racing = false;
      return input;
    }
    if (!this.racing) {
      // yeni yarış (ya da yeniden başlatma): yarışa özgü durumu sıfırla; öğrenilen araç modeli kalır
      this.racing = true;
      this.resetState();
    }
    if (car.wrecked) {
      // devrilme sırasında girdi yok; respawn sonrası temiz başla
      this.zeroInput();
      if (!this.wasWrecked) this.onWrecked();
      this.wasWrecked = true;
      return input;
    }
    if (this.wasWrecked) {
      this.wasWrecked = false;
      this.sinceRespawn = 0;
      this.stuckT = 0;
      this.recoverT = 0;
      this.overrideW = 0;
    }
    this.raceClock += dt;
    this.sinceRespawn += dt;

    const line = this.line;
    const model = this.model;
    const vel = car.velocity;
    const vx = vel.x;
    const vz = vel.z;
    const vH = Math.hypot(vx, vz);
    const yaw = car.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const vF = Number.isFinite(car.speed) ? car.speed : vx * fx + vz * fz;
    const s = car.trackS;
    const lat = car.lateral;
    const halfW = line.halfWidthAt(s);
    const lim = Math.max(0, halfW - TUNING.edge);

    this.learn(dt, vx, vz, vH, vF, yaw, lat, halfW);
    model.observeFleet(ctx, dt, line);

    // --- Lastik bant -------------------------------------------------------------------------------
    let boost = 0;
    let slow = 0;
    const player = ctx.player;
    if (player && player !== car && !player.finished && !car.finished
      && Number.isFinite(player.raceDistance) && Number.isFinite(car.raceDistance)) {
      const gap = car.raceDistance - player.raceDistance; // + bot önde
      boost = smooth01((-gap - TUNING.rubberBehind) / 150);
      slow = smooth01((gap - TUNING.rubberAhead) / 200);
    }

    // --- Gürültü (yetenek) ---------------------------------------------------------------------------
    this.updateNoise(dt);

    const aLat = this.latAccel * (1 + 0.08 * boost - 0.14 * slow);
    const capMargin = Math.min(0.95, this.capMargin + 0.04 * boost - 0.08 * slow);

    // --- Yanal plan ---------------------------------------------------------------------------------
    const kNear = this.maxCurvature(s, 90);
    const plannedLat = this.baseLatAt(s + 15);
    this.followSpeed = Infinity;
    this.updateAttack(dt, ctx, s, lat, vF, lim, kNear);
    this.updateAvoidance(dt, ctx, s, lat, vF, lim, plannedLat);
    if (this.avoidActive && this.attackTarget && this.attackPhase !== 'ram') this.endAttack(2);

    let overrideTarget = NaN;
    if (this.attackTarget) overrideTarget = this.attackLat;
    else if (this.avoidActive) overrideTarget = this.avoidLat;
    else {
      const rampLat = this.updateRamp(s, lim);
      if (!Number.isNaN(rampLat)) overrideTarget = rampLat;
    }
    if (!Number.isNaN(overrideTarget)) {
      this.overrideLat = clamp(overrideTarget, -lim, lim);
      this.overrideW = Math.min(1, this.overrideW + dt * 5);
    } else {
      this.overrideW = Math.max(0, this.overrideW - dt * 1.2);
    }

    // --- Direksiyon: pure pursuit -------------------------------------------------------------------
    let ld = clamp(TUNING.lookaheadBase + TUNING.lookaheadTime * Math.max(vF, 0), TUNING.lookaheadMin, TUNING.lookaheadMax);
    if (this.attackPhase === 'strike') ld *= 0.65;
    const sT = s + ld;
    let latT = this.baseLatAt(sT);
    if (this.overrideW > 0) latT += (this.overrideLat - latT) * this.overrideW;
    const limT = Math.max(0, line.halfWidthAt(sT) - TUNING.edge);
    latT = clamp(latT, -limT, limT);
    const pt = line.pointAt(sT, latT, this.tmpPoint);
    const dx = pt.x - car.position.x;
    const dz = pt.z - car.position.z;
    const localF = dx * fx + dz * fz; // ileri
    const localR = -dx * fz + dz * fx; // sağ: right = (-cos yaw, 0, sin yaw)
    const dist2 = localF * localF + localR * localR;
    let steer;
    let facingAway = false;
    if (localF < 0.25 * Math.sqrt(dist2)) {
      // hedef yanda/arkada (ters yön, savrulma): tam kır, merkezden uzaklaşma
      facingAway = true;
      steer = localR >= 0 ? 1 : -1;
    } else {
      const kappaCmd = (2 * localR) / Math.max(dist2, 1); // + sağa
      steer = kappaCmd / model.steerGain(Math.max(vH, 4));
    }
    steer = clamp(steer + this.steerNoise, -1, 1);

    // --- Hız planı -------------------------------------------------------------------------------------
    let vTarget = this.plannedSpeed(s, vF, aLat, capMargin);
    if (facingAway) vTarget = Math.min(vTarget, 8); // geri dönüş: küçük yarıçap için yavaş
    // duvara sürtünürken içeri dönmek istiyorsak gaz kes: düşük hızda araba daha kolay döner
    const myHalf = Number.isFinite(car.halfWidth) ? car.halfWidth : 1;
    if (Math.abs(lat) > halfW - myHalf - 0.5 && (latT - lat) * Math.sign(lat) < -2) {
      this.wallT += dt;
      if (this.wallT > 0.25) vTarget = Math.min(vTarget, Math.max(vF - 1, 12));
    } else {
      this.wallT = 0;
    }
    if (this.followSpeed < vTarget) vTarget = this.followSpeed;
    if (this.attackTarget) vTarget = Math.min(vTarget, this.attackSpeed);
    let vCap = Infinity;
    if (model.topSpeed > 20) {
      const ratio = this.speedRatio + 0.1 * boost - 0.1 * slow;
      if (ratio < 1) vCap = model.topSpeed * ratio;
    }

    let throttle = 1;
    let brake = 0;
    if (vF > vTarget) {
      throttle = 0;
      const over = vF - vTarget;
      if (over > 1.5 && vF > 3) brake = clamp((over - 1.5) / 5, 0, 1);
    } else if (vF > vCap - 2) {
      throttle = clamp((vCap - vF) * 0.5, 0, 1);
    }

    // --- Drift (yetenekli botlar, keskin virajda) ------------------------------------------------------
    const kHere = Math.abs(line.curvatureAt(s + Math.max(vF, 0) * 0.3));
    const lineErr = Math.abs(lat - this.baseLatAt(s));
    let drift = false;
    if (this.driftOn) {
      this.driftT += dt;
      if (lineErr > this.driftMaxErr) this.driftMaxErr = lineErr;
      if (kHere < 1 / 110 || vF < 18 || this.driftT > 3.5 || lineErr > 4.5 || car.airborne) {
        if (this.driftT > 0.4) model.observeDrift(this.driftMaxErr < 4);
        this.driftOn = false;
      }
    } else if (this.skill >= TUNING.driftMinSkill && model.driftTrust > 0.4 && vF > 25 && !car.airborne
      && kHere > 1 / 75 && vF - vTarget > 3 && lineErr < 2.5 && !this.attackTarget) {
      this.driftOn = true;
      this.driftT = 0;
      this.driftMaxErr = 0;
    }
    if (this.driftOn) {
      drift = true;
      brake = Math.min(brake, 0.5);
    }

    // --- Nitro -----------------------------------------------------------------------------------------
    const nitro = this.updateNitro(dt, s, vF, aLat, capMargin, boost, slow);

    // --- Takılma kurtarma ------------------------------------------------------------------------------
    if (this.recoverT > 0) {
      this.recoverT -= dt;
      throttle = 0;
      brake = 1;
      steer = 0;
      if (this.recoverT <= 0) this.stuckGrace = 2.5;
    } else {
      if (this.stuckGrace > 0) this.stuckGrace -= dt;
      if (this.raceClock > 3 && this.stuckGrace <= 0 && !car.airborne && Math.abs(vF) < 2) {
        this.stuckT += dt;
        if (this.stuckT > 1.2) {
          this.stuckT = 0;
          this.recoverT = 1.1;
        }
      } else {
        this.stuckT = 0;
      }
    }

    // direksiyon çıkışını yumuşat (salınım ve titremeye karşı)
    const slew = TUNING.steerSlew * dt;
    this.steerOut += clamp(steer - this.steerOut, -slew, slew);

    input.throttle = throttle;
    input.brake = brake;
    input.steer = this.steerOut;
    input.nitro = nitro;
    input.drift = drift;
    this.lastThrottle = throttle;
    this.lastBrake = brake;
    return input;
  }

  zeroInput() {
    const input = this.input;
    input.throttle = 0;
    input.brake = 0;
    input.steer = 0;
    input.nitro = false;
    input.drift = false;
    this.steerOut = 0;
    this.nitroHold = false;
    this.driftOn = false;
    this.lastThrottle = 0;
    this.lastBrake = 0;
  }

  onWrecked() {
    this.prevValid = false;
    this.endAttack(4);
    this.avoidActive = false;
    this.driftOn = false;
    this.nitroHold = false;
    this.prevBurst = -1;
  }

  // ---------------------------------------------------------------------------------------------------
  // Öğrenme: son adımda uygulanan girdinin arabadaki etkisini gözle.
  learn(dt, vx, vz, vH, vF, yaw, lat, halfW) {
    const car = this.car;
    const model = this.model;
    const heading = Math.atan2(vx, vz);
    const a = 1 - Math.exp(-dt / TUNING.steerFilterTau);
    this.steerApplied += (this.steerOut - this.steerApplied) * a;

    if (this.prevValid && !car.airborne && this.sinceRespawn > 0.6) {
      const dHead = wrapAngle(heading - this.prevHeading);
      const dYaw = wrapAngle(yaw - this.prevYaw);
      const omegaRight = -dHead / dt;
      const omegaYawRight = -dYaw / dt;
      const dv = Math.hypot(vx - this.prevVx, vz - this.prevVz);
      const vy = car.velocity.y || 0;
      const clean = !car.drifting && vH > 6 && dv < 60 * dt && Math.abs(omegaRight - omegaYawRight) < 0.5
        && Math.abs(lat) < halfW - 2.2 && Math.abs(vy) < 3;
      if (clean) model.observeSteer(this.steerApplied, vH, omegaRight);

      if (this.lastBrake >= 0.9 && this.prevSpeedF > 15 && !car.nitroActive && dv < 60 * dt) {
        model.observeBrake((this.prevSpeedF - vF) / dt);
      }
    }
    this.prevValid = true;
    this.prevHeading = heading;
    this.prevYaw = yaw;
    this.prevVx = vx;
    this.prevVz = vz;
    this.prevSpeedF = vF;
  }

  gauss() {
    const rng = this.rng;
    return (rng() + rng() + rng() - 1.5) * 2; // ~N(0,1)
  }

  updateNoise(dt) {
    // Ornstein-Uhlenbeck: yavaş yanal gezinme ve hızlı küçük direksiyon gürültüsü
    const kw = dt / 3;
    this.wander += -this.wander * kw + this.gauss() * Math.sqrt(2 * kw) * this.wanderSigma;
    const ks = dt / 0.35;
    this.steerNoise += -this.steerNoise * ks + this.gauss() * Math.sqrt(2 * ks) * this.steerNoiseSigma;
  }

  /** Bu botun s'deki temel yanal hedefi: yarış çizgisi + şerit tercihi + gezinme. */
  baseLatAt(s) {
    const line = this.line;
    const kap = Math.abs(line.curvatureAt(s));
    const straight = clamp(1 - kap * 150, 0, 1); // R ≥ 150 m'den itibaren şerit tercihi devreye girer
    const l = line.lateralAt(s) * this.lineFollow + this.preferredLane * TUNING.laneBias * straight + this.wander;
    const lim = Math.max(0, line.halfWidthAt(s) - TUNING.edge);
    return clamp(l, -lim, lim);
  }

  maxCurvature(s, range) {
    const line = this.line;
    const i0 = Math.floor(line.indexOf(s));
    const steps = Math.ceil(range / line.ds);
    let m = 0;
    for (let j = 0; j <= steps; j += 2) {
      const k = line.absCurvatureAtIndex(i0 + j);
      if (k > m) m = k;
    }
    return m;
  }

  /** |κ| eğriliğinde güvenli viraj hızı: yetenek ivmesi ve öğrenilen kapasite sınırı. */
  cornerSpeed(k, aLat, capMargin) {
    if (k < 1e-5) return 1e3;
    let v = Math.sqrt(aLat / k);
    for (let it = 0; it < 3; it++) {
      const vc = Math.sqrt((capMargin * this.model.lateralCapacity(v)) / k);
      if (vc >= v) break;
      v = vc;
    }
    return v;
  }

  /** Şu an olunabilecek en yüksek hız: önümüzdeki virajlara fren mesafesiyle bakarak. */
  plannedSpeed(s, vF, aLat, capMargin) {
    const line = this.line;
    const aBrake = Math.max(8, this.model.brakeDecel * TUNING.brakeMargin);
    const v0 = Math.max(vF, 0);
    const lead = v0 * this.reaction;
    const horizon = (v0 * v0) / (2 * aBrake) + lead + 12;
    const steps = Math.min(line.n, Math.ceil(horizon / line.ds) + 1);
    const i0 = Math.floor(line.indexOf(s));
    let vT = 1e3;
    let lastK = -1;
    let lastVc = 1e3;
    for (let j = 0; j <= steps; j++) {
      const k = line.absCurvatureAtIndex(i0 + j);
      if (k < 2e-4) continue;
      // aynı eğrilik için tekrar hesaplama
      const vc = Math.abs(k - lastK) < 1e-5 ? lastVc : this.cornerSpeed(k, aLat, capMargin);
      lastK = k;
      lastVc = vc;
      const d = Math.max(0, j * line.ds - lead);
      const vAllowed = Math.sqrt(vc * vc + 2 * aBrake * d);
      if (vAllowed < vT) vT = vAllowed;
    }
    return vT;
  }

  // ---------------------------------------------------------------------------------------------------
  // Takedown saldırısı: yakındaki rakibe (öncelikle oyuncuya) yandan yanaşıp duvara doğru vur.
  updateAttack(dt, ctx, s, lat, vF, lim, kNear) {
    const car = this.car;
    const L = this.line.trackLength;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    if (this.attackTarget) {
      const v = this.attackTarget;
      this.attackT += dt;
      if (v.wrecked) {
        // başarı (ya da başkası devirdi)
        this.endAttack(7 + 9 * (1 - this.aggression));
        return;
      }
      let ds = v.trackS - s;
      ds -= Math.round(ds / L) * L;
      if (v.ghost || v.finished || car.finished || ds > 45 || ds < -20 || this.attackT > 8 || kNear > 1 / 90) {
        this.endAttack(3);
        return;
      }
      const dLat = v.lateral - lat;
      const closing = vF - v.speed;
      const vSpeed = Math.max(0, v.speed);
      if (this.attackPhase === 'approach') {
        if (ds > 6 && Math.abs(dLat) < 2.4 && closing > 6) {
          this.attackPhase = 'ram'; // arkadan, nitroyla vur
          this.strikeT = 0;
        } else if (Math.abs(ds) < 2.8 && Math.abs(dLat) < 6) {
          this.attackPhase = 'strike';
          this.strikeT = 0;
        }
      }
      const side = this.attackSide;
      if (this.attackPhase === 'approach') {
        let target = v.lateral + side * 3.6;
        if (Math.abs(target) > lim) {
          // bu tarafta yer yok: diğer taraftan yanaş
          this.attackSide = -side;
          target = v.lateral - side * 3.6;
        }
        this.attackLat = target;
        this.attackSpeed = vSpeed + clamp(ds * 0.9 + 1, -8, 16);
      } else if (this.attackPhase === 'strike') {
        this.strikeT += dt;
        this.attackLat = v.lateral - side * 1.8; // içinden geçecekmiş gibi yüklen
        this.attackSpeed = vSpeed + 1.5 + ds * 0.5;
        if (this.strikeT > 1.1) this.endAttack(4 + 6 * (1 - this.aggression));
      } else {
        // ram: arkadan aynı şeritte
        this.strikeT += dt;
        this.attackLat = v.lateral;
        this.attackSpeed = 1e3;
        if (this.strikeT > 3 || closing < 1) this.endAttack(4 + 6 * (1 - this.aggression));
      }
      return;
    }

    this.attackCheck -= dt;
    if (this.attackCooldown > 0 || this.attackCheck > 0) return;
    this.attackCheck = 0.5;
    if (car.finished || vF < 25 || kNear > 1 / 160 || this.aggression <= 0) return;

    let best = null;
    let bestScore = 0;
    const cars = ctx.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c === car || c.wrecked || c.ghost || c.finished || c.airborne) continue;
      let ds = c.trackS - s;
      ds -= Math.round(ds / L) * L;
      if (ds < -12 || ds > 30) continue;
      const dLat = c.lateral - lat;
      if (Math.abs(dLat) > 10) continue;
      const owner = attackClaims.get(c);
      if (owner && owner !== this && owner.attackTarget === c) continue;
      const weight = c === ctx.player ? 1 : car.isPlayer ? 0.7 : 0.35;
      const score = weight * (1 - Math.abs(ds) / 40);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best) return;
    if (this.rng() > this.aggression * 0.3 * bestScore) return;

    this.attackTarget = best;
    attackClaims.set(best, this);
    this.attackPhase = 'approach';
    this.attackT = 0;
    this.strikeT = 0;
    const dLat = lat - best.lateral;
    // bulunduğumuz taraftan yanaş; hizadaysak kurbanı yakın duvarına it
    this.attackSide = Math.abs(dLat) > 0.5 ? Math.sign(dLat) : (best.lateral >= 0 ? -1 : 1);
    this.attackLat = best.lateral + this.attackSide * 3.6;
    this.attackSpeed = 1e3;
  }

  endAttack(cooldown) {
    this.releaseAttack();
    this.attackCooldown = Math.max(this.attackCooldown || 0, cooldown);
  }

  releaseAttack() {
    if (this.attackTarget && attackClaims.get(this.attackTarget) === this) attackClaims.delete(this.attackTarget);
    this.attackTarget = null;
    this.attackPhase = null;
    this.attackT = 0;
    this.strikeT = 0;
    this.attackSide = 0;
    this.attackLat = 0;
    this.attackSpeed = 1e3;
  }

  // ---------------------------------------------------------------------------------------------------
  // Sollama/kaçınma: önümüzdeki ~25 m'de yolumuzu kesen arabalar için yanal "yasak bantlar" çıkar,
  // planlanan çizgi bir banda düşüyorsa en ucuz boş yanal konumu seç; hiç yer yoksa takip et.
  updateAvoidance(dt, ctx, s, lat, vF, lim, plannedLat) {
    const car = this.car;
    const L = this.line.trackLength;
    const myHalf = Number.isFinite(car.halfWidth) ? car.halfWidth : 1;
    const lo = this.bandLo;
    const hi = this.bandHi;
    let count = 0;
    let followSpeed = Infinity;
    const cars = ctx.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c === car || c === this.attackTarget) continue;
      let ds = c.trackS - s;
      ds -= Math.round(ds / L) * L;
      if (!(ds >= -4.5)) continue; // arka tamponu hâlâ yanımızdaysa say
      const wrecked = c.wrecked;
      const cSpeed = wrecked ? 0 : c.speed;
      const closing = vF - cSpeed;
      // ~25 m; hızla yaklaşılan (ör. devrilmiş) araçlar için kapanma hızıyla uzar
      const range = Math.max(TUNING.avoidRange + Math.max(0, vF) * 0.12, closing * 1.8 + 6);
      if (ds > range) continue;
      if (ds > 5 && !wrecked && closing < 0.5) continue; // bizden hızlı, uzaklaşıyor
      if (ds > 5 && (ds - 5) / Math.max(closing, 0.1) > 2.2) continue; // daha vakit var
      if (count >= MAX_BANDS) break;
      const half = myHalf + (Number.isFinite(c.halfWidth) ? c.halfWidth : 1) + TUNING.avoidMargin;
      lo[count] = c.lateral - half;
      hi[count] = c.lateral + half;
      this.bandSpeed[count] = wrecked ? -1 : cSpeed;
      this.bandDs[count] = ds;
      count++;
    }
    this.bandCount = count;
    if (this.avoidHold > 0) this.avoidHold -= dt;

    // planlanan çizgi (ve oraya giden yol) bir bandı kesiyor mu? En yakın engel "birincil" bant.
    let primary = -1;
    for (let b = 0; b < count; b++) {
      const alongside = this.bandDs[b] < 5;
      const a0 = alongside ? Math.min(lat, plannedLat) : plannedLat;
      const a1 = alongside ? Math.max(lat, plannedLat) : plannedLat;
      if (a1 > lo[b] && a0 < hi[b] && (primary < 0 || this.bandDs[b] < this.bandDs[primary])) primary = b;
    }
    const blocked = primary >= 0;
    if (!blocked) {
      if (this.avoidActive && this.avoidHold <= 0) {
        this.avoidActive = false;
        this.avoidSide = 0;
      }
      if (!this.avoidActive) return;
      // tutma süresi bitene dek önceki seçim geçerli; ancak artık serbest olan çizgiye dönmek de serbest
      return;
    }

    let bestLat = NaN;
    let bestCost = Infinity;
    let bestSide = 0;
    const primaryMid = (lo[primary] + hi[primary]) / 2;
    for (let b = 0; b <= count; b++) {
      for (let e = 0; e < 2; e++) {
        let cand;
        if (b === count) cand = e === 0 ? -lim : lim; // yol kenarına yakın adaylar
        else cand = e === 0 ? lo[b] - 0.2 : hi[b] + 0.2;
        if (cand < -lim || cand > lim) continue;
        let ok = true;
        for (let q = 0; q < count && ok; q++) {
          if (cand > lo[q] && cand < hi[q]) ok = false;
          // yanımızdaki araba: oraya giderken içinden geçme
          if (ok && this.bandDs[q] < 5) {
            const p0 = Math.min(lat, cand);
            const p1 = Math.max(lat, cand);
            if (p1 > lo[q] && p0 < hi[q] && !(lat > lo[q] && lat < hi[q])) ok = false;
          }
        }
        if (!ok) continue;
        let cost = Math.abs(cand - plannedLat) + 0.7 * Math.abs(cand - lat);
        // birincil engelin hangi tarafından geçiyoruz? Seçilen taraftan vazgeçmek pahalı (kararsızlığa karşı).
        const side = cand < primaryMid ? -1 : 1;
        if (this.avoidSide !== 0 && side !== this.avoidSide) cost += 6;
        if (cost < bestCost) {
          bestCost = cost;
          bestLat = cand;
          bestSide = side;
        }
      }
    }

    if (!Number.isNaN(bestLat)) {
      this.avoidActive = true;
      this.avoidLat = bestLat;
      this.avoidSide = bestSide;
      this.avoidHold = 0.6;
    } else {
      // geçecek yer yok: öndekini takip et (devrilmiş arabalar fiziksel engel değil, onları yok say)
      for (let b = 0; b < count; b++) {
        if (this.bandSpeed[b] >= 0 && this.bandDs[b] > 3) {
          const fs = this.bandSpeed[b] - 1 + (this.bandDs[b] - 8) * 0.5;
          if (fs < followSpeed) followSpeed = Math.max(0, fs);
        }
      }
      this.avoidActive = true;
      this.avoidLat = lat;
      this.avoidHold = 0.3;
    }
    this.followSpeed = followSpeed;
  }

  // ---------------------------------------------------------------------------------------------------
  // Rampalar: 'jump' rampalarından bazen, 'roll' rampalarına yalnızca yetenekli botlar bazen girer.
  updateRamp(s, lim) {
    const info = this.line.nextRamp(s, 160, this.rampInfo);
    const ramp = info.ramp;
    if (!ramp) return NaN;
    const lap = this.car.lap | 0;
    if (this.rampKey !== ramp || this.rampLap !== lap) {
      this.rampKey = ramp;
      this.rampLap = lap;
      const r = this.rng();
      if (ramp.type === 'roll') this.rampTake = this.skill >= 0.7 && r < 0.2 + 0.6 * (this.skill - 0.7);
      else this.rampTake = r < 0.3 + 0.35 * this.skill;
      const latMin = Number.isFinite(ramp.latMin) ? ramp.latMin : -lim;
      const latMax = Number.isFinite(ramp.latMax) ? ramp.latMax : lim;
      this.rampLat = clamp((latMin + latMax) / 2, -lim, lim);
      if (this.rampLat < latMin + 0.3 || this.rampLat > latMax - 0.3) this.rampTake = false; // erişilemez
    }
    return this.rampTake ? this.rampLat : NaN;
  }

  // ---------------------------------------------------------------------------------------------------
  // Nitro: önde ~200 m düz yol varsa bas; patlama ilerlemesi biliniyorsa perfect nitro için zincirle.
  updateNitro(dt, s, vF, aLat, capMargin, boost, slow) {
    const car = this.car;
    let want = false;
    let chain = false; // perfect nitro zinciri (eşik yok: patlama zaten sürüyor)
    if (!car.finished && slow < 0.3 && vF > 12 && this.recoverT <= 0) {
      const threshold = TUNING.nitroMin - 0.18 * boost + 0.1 * (1 - this.skill);
      const kA = this.line.maxCurvatureAhead(s);
      const vNeed = vF + 18 - 8 * boost;
      const straight = kA < 2e-4 || this.cornerSpeed(kA, aLat, capMargin) > vNeed;
      if (straight && car.nitro > threshold) want = true;
      if (straight) chain = true;
      // takedown: arkadan nitroyla vur ya da kurbana yetiş
      if (this.attackTarget && car.nitro > 0.2 && this.maxCurvature(s, 120) < 1 / 200) {
        if (this.attackPhase === 'ram') want = true;
        else if (this.attackPhase === 'approach') {
          let ds = this.attackTarget.trackS - s;
          const L = this.line.trackLength;
          ds -= Math.round(ds / L) * L;
          if (ds > 10) want = true;
        }
      }
      if (want) chain = true;
    }

    const prog = car.nitroBurstProgress;
    const hasProg = typeof prog === 'number' && Number.isFinite(prog);
    let hold;
    if (car.nitroActive) {
      if (hasProg) {
        if (prog + 0.2 < this.prevBurst) this.rollChain(); // yeni patlama başladı
        if (this.prevBurst < 0) this.rollChain();
        this.prevBurst = prog;
        if (prog < 0.55) hold = this.nitroHold && chain;
        else if (prog < this.chainPressAt) hold = false; // pencereden önce bırak
        else hold = chain && car.nitro > 0.04; // perfect nitro penceresinde tekrar bas
      } else {
        hold = chain;
      }
    } else {
      this.prevBurst = -1;
      hold = want;
      // basılı tuttuğumuz halde başlamadıysa yükselen kenar için bir kare bırak
      if (hold && this.nitroHold && this.nitroHeldT > 0.3) hold = false;
    }
    this.nitroHeldT = hold && this.nitroHold ? this.nitroHeldT + dt : 0;
    this.nitroHold = hold;
    return hold;
  }

  rollChain() {
    // yetenekli botlar pencereyi (> 0.75) tutturur, yeteneksizler bazen erken/geç basar
    const r = this.rng();
    const sloppy = (1 - this.skill) * (this.rng() - 0.4) * 0.5;
    this.chainPressAt = clamp(0.77 + r * 0.09 + sloppy, 0.6, 1.05);
  }
}
