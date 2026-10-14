// BotDriver: Asphalt tarzı bot sürücü. Car'a yalnızca sözleşmedeki Input nesnesini üretir.
//
// Katmanlar (her adımda, sıcak yolda nesne üretmeden):
//   1. Öğrenme   — arabanın direksiyon kazancı / dönüş kapasitesi / azami hız / fren gözlemi (ai/vehicleModel.js)
//   2. Yanal plan — paylaşılan yarış çizgisi (ai/racingLine.js) + tercih edilen şerit + yetenek gürültüsü,
//                  üzerine öncelik sırasıyla: takedown saldırısı > kaçınma > slipstream/sollama > savunma > rampa
//   3. Direksiyon — hıza ve eğriliğe bağlı ileri bakış noktasına pure-pursuit + bariyer koruması
//   4. Hız        — çizgi eğriliğinden viraj hızı, ileriye bakan fren mesafesi taraması, aracın azami hızı,
//                  zorluğa göre lastik bant (rubber banding) ve hata (lapse) modeli
//   5. Nitro (perfect zinciri, shockwave) / drift / takılma kurtarma
// Zorluk farkları ai/profile.js içindeki profillerde toplanır.
import { getRacingLine } from './ai/racingLine.js';
import { getVehicleModel } from './ai/vehicleModel.js';
import { getProfile, PROFILES } from './ai/profile.js';

export const TUNING = {
  edge: 2.8, // m: hedef yanal konum en fazla ±(genişlik/2 - edge)
  lookaheadBase: 7, // m
  lookaheadTime: 0.5, // s (hızla çarpılır)
  lookaheadMin: 9,
  lookaheadMax: 55,
  lookaheadCurve: 8, // ileri bakış 1/(1 + curve·|κ|) ile kısalır (sıkı virajda keskin takip)
  slopeK: 4, // hedef yanal eğim sınırı = slopeK / hız (m/s) → yüksek hızda yola göre en çok ~5° sapma
  slopeMin: 0.07,
  slopeMax: 0.3,
  swingOmega: 0.6, // rad/s: S virajda (ters yönlü eğrilik) hız · eğrilik farkı üst sınırı
  capUnknown: 0.88, // gözlem yokken kapasite payı çarpanı (gözlem arttıkça 1'e yaklaşır)
  steerSlew: 8, // 1/s, direksiyon çıkışının en hızlı değişimi
  steerFilterTau: 0.1, // s, arabaya uygulanan direksiyonun tahmini (öğrenme için)
  latAccelBase: 24, // m/s², en düşük yetenekte viraj ivmesi
  latAccelSkill: 12, // m/s², yetenekle eklenen
  cornerLane: 0, // viraj içinde şerit tercihinin payı (0 = yalnızca düzlükte)
  laneBias: 3, // m, preferredLane = ±1 düzlükte bu kadar yana kayar
  avoidBehind: 4.5, // m, arkada kalmış ama yanımızdaki arabayı da say
  cornerGap: 20, // m: sıkı viraj girişinde öndekiyle hedef mesafe
  tightCorner: 0.004, // 90 m içinde bu eğrilikten sıkı viraj varsa öndekiyle mesafe koru
  alongside: 5, // m: bundan az önde (ya da arkada) olan araba 'yanımızda' sayılır
  avoidLatRate: 3.2, // m/s, kaçış sırasında varsayılan yanal hız (temas zamanı tahmini için)
  avoidLatLead: 0.5, // s, komşu arabanın yanal hızı bu süre kadar öne taşınır
  avoidRange: 25, // m, öndeki arabaya bakış mesafesi (hızla biraz artar)
  brakeGain: 3, // m/s: hız planını bu kadar aşınca tam fren (aşım / brakeGain ile orantılı)
  brakeSlack: 0.8, // m/s: bu kadar aşıma kadar fren yok
  wallMargin: 0.5, // m, bariyer koruması: araç yan yüzü ile bariyer arası hedef boşluk
};

const TWO_PI = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const wrapAngle = (a) => a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI);
const smooth01 = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

// Rampa başına öğrenilen uçuş mesafesi katsayısı (mesafe = k·hız²); tüm botlar paylaşır.
const rampFlightK = new WeakMap();
const GRAVITY_GUESS = 17; // m/s², ön kabul

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
const OT_NONE = 0;
const OT_FOLLOW = 1;
const OT_SWING = 2;

export class BotDriver {
  constructor(car, track, { skill = 0.8, aggression = 0.5, preferredLane = 0, difficulty = 'normal' } = {}) {
    this.car = car;
    this.track = track;
    this.difficulty = car.isPlayer ? 'player' : PROFILES[difficulty] ? difficulty : 'normal';
    const P = getProfile(this.difficulty);
    this.profile = P;
    this.skill = clamp(Number.isFinite(skill) ? skill : 0.8, 0, 1);
    this.aggression = clamp(Number.isFinite(aggression) ? aggression : 0.5, 0, 1);
    this.preferredLane = clamp(Number.isFinite(preferredLane) ? preferredLane : 0, -1, 1);
    this.line = getRacingLine(track);
    this.model = getVehicleModel(car);
    seedCounter++;
    this.rng = makeRng(Math.imul(seedCounter, 0x9e3779b1) ^ Math.round(this.skill * 7919));

    const k = lerp(this.skill, 1, P.skillPull); // zorluğa göre etkin yetenek
    this.k = k;
    // Oyuncunun otopilotu iyi bir insan gibi gazı sonuna kadar kullanır; botlar yeteneğe göre.
    this.speedRatio = car.isPlayer ? 1 : lerp(P.speedRatio[0], P.speedRatio[1], k);
    this.latAccel = (TUNING.latAccelBase + TUNING.latAccelSkill * k) * P.latAccelMul;
    this.capMargin = lerp(P.capacityUse[0], P.capacityUse[1], k);
    this.lineFollow = lerp(P.lineFollow[0], P.lineFollow[1], k); // düşük yetenek çizgiyi daha az keser
    this.reaction = Math.max(0.04, 0.15 + 0.3 * (1 - k) + P.brakeReaction); // s, fren tepki gecikmesi
    this.wanderSigma = (0.2 + 1.3 * (1 - k)) * P.wanderMul; // m, yanal sapma
    this.steerNoiseSigma = (0.005 + 0.05 * (1 - k)) * P.steerNoiseMul;
    this.brakeMargin = P.brakeMargin;

    this.input = { throttle: 0, brake: 0, steer: 0, nitro: false, drift: false };
    this.tmpPoint = { x: 0, y: 0, z: 0 };
    this.tmpTan = { x: 0, z: 0 };
    this.rampInfo = { ramp: null, dist: Infinity };
    this.bandLo = new Float64Array(MAX_BANDS);
    this.bandHi = new Float64Array(MAX_BANDS);
    this.bandSpeed = new Float64Array(MAX_BANDS);
    this.bandDs = new Float64Array(MAX_BANDS);
    this.bandCount = 0;

    this.stats = {
      attack: 0, defend: 0, follow: 0, swing: 0, overtake: 0, shock: 0, lapse: 0, recover: 0, drift: 0, slipTime: 0,
    };
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
    this.sinceRespawn = 99;
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
    this.laneMin = -1e9;
    this.laneMax = 1e9;
    this.squeezeSpeed = Infinity;

    this.releaseAttack();
    this.attackCooldown = 3 + this.rng() * 4;
    this.attackCheck = 0;

    // slipstream / sollama
    this.otState = OT_NONE;
    this.otTarget = null;
    this.otSide = 0;
    this.otT = 0;
    this.otLat = 0;
    this.otCooldown = 1 + this.rng() * 2;
    this.otFollowSpeed = Infinity;
    this.otSeen = null;
    this.otAccept = false;
    this.otCheck = 0;

    // savunma
    this.defendActive = false;
    this.defendFollower = null;
    this.defendT = 0;
    this.defendLat = 0;
    this.defendCur = 0;
    this.defendCooldown = 4 + this.rng() * 4;
    this.defendCheck = 0;
    this.defSeen = null;
    this.defAccept = false;

    // hatalar (kolay zorluk)
    this.lapseT = 0;
    this.lapseKind = 0;
    this.lapseSide = 1;
    this.lapseCheck = 0;

    this.pickTarget = null;
    this.pickSeen = null;
    this.pickAccept = false;
    this.pickCheck = 0;

    this.rampKey = null;
    this.rampLap = -1;
    this.rampTake = false;
    this.rampLat = NaN;
    this.rampHold = false;
    this.rampHoldS = 0;
    this.avoidRampLat = NaN;
    this.wasAir = false;
    this.flightS0 = 0;
    this.flightV0 = 0;
    this.flightRamp = null;

    this.nitroHold = false;
    this.nitroHeldT = 0;
    this.prevBurst = -1;
    this.chainPressAt = 0.8;
    this.chainOn = true;
    this.nitroPlanT = 0;
    this.freeD = 0;
    this.rivalAhead = 1e9;
    this.shockPhase = 0;
    this.shockCooldown = 0;
    this.wasteT = 0;
    this.saveT = 0;


    this.stuckT = 0;
    this.recoverT = 0;
    this.recoverMax = 0;
    this.recoverElapsed = 0;
    this.stuckGrace = 0;
    this.wallT = 0;
    this.vTarget = 0;
    this.aLatNow = this.latAccel;
    this.capNow = this.capMargin;
    this.wasteNow = 0;
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
      this.stats.recover++;
    }
    this.raceClock += dt;
    this.sinceRespawn += dt;

    const P = this.profile;
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
    const myHalf = Number.isFinite(car.halfWidth) ? car.halfWidth : 1;

    this.learn(dt, vx, vz, vH, vF, yaw, lat, halfW);
    this.trackFlight(s, vF);
    model.observeFleet(ctx, dt, line);
    if (Number.isFinite(car.maxSpeed) && car.maxSpeed > 20) model.setTopSpeed(car.maxSpeed);

    // --- Lastik bant -------------------------------------------------------------------------------
    let boost = 0;
    let slow = 0;
    let slowRaw = 0;
    const player = ctx.player;
    if (player && player !== car && !player.finished && !car.finished
      && Number.isFinite(player.raceDistance) && Number.isFinite(car.raceDistance)) {
      const gap = car.raceDistance - player.raceDistance; // + bot önde
      boost = Math.min(1, smooth01((-gap - P.rubberBehind[0]) / P.rubberBehind[1]) * P.rubberBoostMul);
      slowRaw = smooth01((gap - P.rubberAhead[0]) / P.rubberAhead[1]);
      slow = Math.min(1, slowRaw * P.rubberSlowMul);
    }

    // --- Gürültü (yetenek) ve hatalar ----------------------------------------------------------------
    this.updateNoise(dt);
    const kNear = this.maxCurvature(s, 90);
    this.updateLapse(dt, kNear);

    const amp = P.rubberAmp || 1;
    const aLat = this.latAccel * (1 + 0.08 * amp * boost - 0.14 * slow);
    const capMargin = Math.min(0.99, this.capMargin + 0.04 * amp * boost - 0.08 * slow);
    this.aLatNow = aLat;
    this.capNow = capMargin;

    // --- Yanal plan ---------------------------------------------------------------------------------
    const plannedLat = this.baseLatAt(s + 15);
    this.followSpeed = Infinity;
    this.updateAttack(dt, ctx, s, lat, vF, lim, kNear);
    this.updateOvertake(dt, ctx, s, lat, vF, lim, kNear);
    this.updateAvoidance(dt, ctx, s, lat, vF, lim, plannedLat, kNear);
    this.updateDefend(dt, ctx, s, lat, vF, lim, kNear);
    if (this.avoidActive && this.attackTarget && this.attackPhase !== 'ram') this.endAttack(2);

    let overrideTarget = NaN;
    if (this.attackTarget) overrideTarget = this.attackLat;
    else if (this.avoidActive) overrideTarget = this.avoidLat;
    else if (this.otState !== OT_NONE) overrideTarget = this.otLat;
    else if (this.defendActive) overrideTarget = this.defendCur;
    else {
      const rampLat = this.updateRamp(s, vF, lim);
      if (!Number.isNaN(rampLat)) overrideTarget = rampLat;
      else {
        const pickLat = this.updatePickup(dt, s, lat, vF, lim, kNear);
        if (!Number.isNaN(pickLat)) overrideTarget = pickLat;
      }
    }
    if (this.lapseT > 0 && this.lapseKind === 2 && Number.isNaN(overrideTarget)) {
      overrideTarget = clamp(this.baseLatAt(s + 15) + this.lapseSide * 3, -lim, lim); // geniş gitme hatası
    }
    if (!Number.isNaN(overrideTarget)) {
      this.overrideLat = clamp(overrideTarget, -lim, lim);
      this.overrideW = Math.min(1, this.overrideW + dt * 5);
    } else {
      this.overrideW = Math.max(0, this.overrideW - dt * 1.2);
    }

    // --- Bariyer koruması: yanal hızla 0.5 s sonrası duvara varacaksak içeri dön ----------------------
    const si = line.sampleIndex(s);
    const vLatV = vx * line.rx[si] + vz * line.rz[si]; // + sağa doğru
    const latPred = lat + vLatV * 0.5;
    const wallLim = halfW - myHalf - TUNING.wallMargin;
    let guard = 0;
    if (lat * vLatV > 0 || Math.abs(lat) > wallLim - 0.3) {
      const side = lat >= 0 ? 1 : -1;
      guard = clamp((Math.abs(latPred) * (latPred * side > 0 ? 1 : 0) - (wallLim - 0.8)) / 1.4, 0, 1);
    }

    // --- Direksiyon: pure pursuit -------------------------------------------------------------------
    const kHere0 = Math.abs(line.curvatureAt(s + Math.max(vF, 0) * 0.25));
    let ld = clamp(TUNING.lookaheadBase + TUNING.lookaheadTime * Math.max(vF, 0), TUNING.lookaheadMin, TUNING.lookaheadMax);
    ld = Math.max(TUNING.lookaheadMin, ld / (1 + TUNING.lookaheadCurve * kHere0));
    if (this.attackPhase === 'strike') ld *= 0.65;
    ld *= 1 - 0.3 * guard;
    const sT = s + ld;
    let latT = this.baseLatAt(sT);
    // yarış çizgisini kovalarken yoldan sapma açısını hıza göre sınırla (yüksek hızda çapraz kesme → S virajda dışa savrulma)
    const slope = clamp(TUNING.slopeK / Math.max(vF, 10), TUNING.slopeMin, TUNING.slopeMax);
    latT = clamp(latT, lat - slope * ld, lat + slope * ld);
    if (this.overrideW > 0) latT += (this.overrideLat - latT) * this.overrideW;
    const limT = Math.max(0, line.halfWidthAt(sT) - TUNING.edge);
    if (!this.attackTarget && (this.laneMin > -1e8 || this.laneMax < 1e8)) {
      // yanımızdaki arabanın tarafında kal (yanal mesafeyi azaltma)
      if (this.laneMin > this.laneMax) latT = clamp(lat, this.laneMax, this.laneMin);
      else latT = clamp(latT, this.laneMin, this.laneMax);
    }
    latT = clamp(latT, -limT, limT);
    if (guard > 0) latT += ((lat >= 0 ? -1 : 1) * Math.max(0, halfW - 4.5) - latT) * guard;
    const pt = line.pointAt(sT, latT, this.tmpPoint);
    const dx = pt.x - car.position.x;
    const dz = pt.z - car.position.z;
    // sürüş (drift) sırasında gövde hız vektöründen 25-45° sapar; yönelimi yol (hız) yönünden al
    let hx = fx;
    let hz = fz;
    if (car.drifting && vH > 5) {
      hx = vx / vH;
      hz = vz / vH;
    }
    const localF = dx * hx + dz * hz; // ileri
    const localR = -dx * hz + dz * hx; // sağ: right = (-cos yaw, 0, sin yaw)
    const dist2 = localF * localF + localR * localR;
    let steer;
    let facingAway = false;
    let kappaCmd = 0;
    if (localF < 0.25 * Math.sqrt(dist2)) {
      // hedef yanda/arkada (ters yön, savrulma): tam kır, merkezden uzaklaşma
      facingAway = true;
      steer = localR >= 0 ? 1 : -1;
    } else {
      kappaCmd = (2 * localR) / Math.max(dist2, 1); // + sağa
      steer = kappaCmd / model.steerGain(Math.max(vH, 4));
    }
    steer = clamp(steer + this.steerNoise, -1, 1);
    if (car.airborne) {
      // havada burnu yola paralel tut (inişte hız vektörü gövdeye hizalanır; yan inersek duvara gideriz)
      const e = wrapAngle(yaw - Math.atan2(line.tx[si], line.tz[si]));
      steer = clamp(2.5 * e, -1, 1);
    }

    // --- Hız planı -------------------------------------------------------------------------------------
    let vTarget = this.plannedSpeed(s, vF, aLat, capMargin);
    if (this.lapseT > 0 && this.lapseKind === 1) vTarget *= 1.12; // geç fren hatası
    if (facingAway) vTarget = Math.min(vTarget, 8); // geri dönüş: küçük yarıçap için yavaş
    // duvara sürtünürken içeri dönmek istiyorsak gaz kes: düşük hızda araba daha kolay döner
    if (Math.abs(lat) > halfW - myHalf - 0.5 && (latT - lat) * Math.sign(lat) < -2) {
      this.wallT += dt;
      if (this.wallT > 0.25) vTarget = Math.min(vTarget, Math.max(vF - 1, 12));
    } else {
      this.wallT = 0;
    }
    if (guard > 0.5) vTarget = Math.min(vTarget, Math.max(vF - 2 * guard, 14));
    if (this.followSpeed < vTarget) vTarget = this.followSpeed;
    if (this.squeezeSpeed < vTarget) vTarget = Math.max(this.squeezeSpeed, 0);
    if (this.otState !== OT_NONE && this.otFollowSpeed < vTarget) vTarget = this.otFollowSpeed;
    if (this.attackTarget) vTarget = Math.min(vTarget, this.attackSpeed);
    this.vTarget = vTarget;
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
      if (over > TUNING.brakeSlack && vF > 3) brake = clamp((over - TUNING.brakeSlack) / TUNING.brakeGain, 0, 1);
    } else if (vF > vCap - 2) {
      throttle = clamp((vCap - vF) * 0.5, 0, 1);
    }
    if (this.lapseT > 0 && this.lapseKind === 3) throttle *= 0.35; // gaz kesme hatası

    // --- Drift: botlar sürüş (drift) yapmaz. Car'ın drift modeli gövdeyi hız vektöründen 25-45° saptırır ve çıkışta
    // yol aniden o kadar kırılır (yüksek hızda duvar); simülasyonda drift duvar teması/wreck'i belirgin artırıyordu.
    // Hız kazancı da yok (drift'te yol dönüş hızı normal direksiyondan düşük). Bkz. profile.drift.
    const drift = false;

    // --- Nitro -----------------------------------------------------------------------------------------
    const nitro = this.updateNitro(dt, ctx, s, vF, aLat, capMargin, boost, slowRaw, kNear, kHere0);

    // --- Takılma kurtarma ------------------------------------------------------------------------------
    if (this.recoverT > 0) {
      this.recoverT -= dt;
      this.recoverElapsed += dt;
      // burnu pist yönüne çevirecek şekilde geri git; yönelme düzelince ya da süre dolunca bırak
      const tIdx = si;
      const tyaw = Math.atan2(line.tx[tIdx], line.tz[tIdx]);
      const dYaw = wrapAngle(tyaw - yaw);
      throttle = 0;
      brake = 1;
      steer = Math.abs(dYaw) > 0.3 ? (dYaw > 0 ? 1 : -1) : 0; // geri vitesteyken + direksiyon yaw'u artırır
      if (vF > 1.5) steer = 0;
      if ((Math.abs(dYaw) < 0.55 && this.recoverElapsed > 0.5) || this.recoverT <= 0) {
        this.recoverT = 0;
        this.stuckGrace = 2.5;
      }
    } else {
      if (this.stuckGrace > 0) this.stuckGrace -= dt;
      if (this.raceClock > 3 && this.stuckGrace <= 0 && !car.airborne && Math.abs(vF) < 2) {
        this.stuckT += dt;
        if (this.stuckT > 1.0) {
          this.stuckT = 0;
          this.recoverT = 1.8;
          this.recoverElapsed = 0;
          this.stats.recover++;
        }
      } else {
        this.stuckT = 0;
      }
    }

    // direksiyon çıkışını yumuşat (salınım ve titremeye karşı)
    const slew = TUNING.steerSlew * dt;
    if (drift) this.steerOut = steer; // sürüşte direksiyon doğrudan açıyı belirler
    else this.steerOut += clamp(steer - this.steerOut, -slew, slew);

    input.throttle = throttle;
    input.brake = brake;
    input.steer = this.steerOut;
    input.nitro = this.recoverT > 0 ? false : nitro;
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
    this.lastThrottle = 0;
    this.lastBrake = 0;
  }

  onWrecked() {
    this.prevValid = false;
    this.endAttack(4);
    this.avoidActive = false;
    this.endOvertake(2);
    this.defendActive = false;
    this.defendCooldown = 3;
    this.lapseT = 0;
    this.nitroHold = false;
    this.prevBurst = -1;
    this.shockPhase = 0;
    this.recoverT = 0;
    this.wander = 0;
    this.steerNoise = 0;
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

      if (this.lastBrake >= 0.9 && this.prevSpeedF > 15 && !car.nitroActive && !car.drifting && dv < 60 * dt) {
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

  // Kolay zorluk: ara sıra kısa süreli hatalar (geç fren, geniş gitme, gaz kesme).
  updateLapse(dt, kNear) {
    const P = this.profile;
    if (P.lapseRate <= 0) return;
    if (this.lapseT > 0) {
      this.lapseT -= dt;
      if (this.lapseT <= 0) this.lapseKind = 0;
      return;
    }
    this.lapseCheck -= dt;
    if (this.lapseCheck > 0 || this.raceClock < 6 || this.sinceRespawn < 4) return;
    this.lapseCheck = 0.25;
    if (this.rng() >= P.lapseRate * 0.25) return;
    const r = this.rng();
    // geç fren yalnızca virajın yakınında anlamlı
    this.lapseKind = kNear > 1 / 150 && r < 0.4 ? 1 : r < 0.75 ? 2 : 3;
    this.lapseSide = this.rng() < 0.5 ? -1 : 1;
    this.lapseT = lerp(P.lapseDur[0], P.lapseDur[1], this.rng());
    this.stats.lapse++;
  }

  /** Bu botun s'deki temel yanal hedefi: yarış çizgisi + şerit tercihi + gezinme. */
  baseLatAt(s) {
    const line = this.line;
    const kap = Math.abs(line.curvatureAt(s));
    const straight = clamp(1 - kap * 150, 0, 1); // R ≥ 150 m'den itibaren şerit tercihi devreye girer
    const laneW = TUNING.cornerLane + (1 - TUNING.cornerLane) * straight; // virajda da biraz şerit tercihi (dağılma)
    const l = line.lateralAt(s) * this.lineFollow + this.preferredLane * TUNING.laneBias * laneW + this.wander;
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
    const model = this.model;
    for (let it = 0; it < 3; it++) {
      // bu hızda araba henüz az gözlendiyse (ilk tur, yeni hız aralığı) kapasite tahminine daha az güven
      const m = capMargin * (TUNING.capUnknown + (1 - TUNING.capUnknown) * model.confidence(v));
      const vc = Math.sqrt((m * model.lateralCapacity(v)) / k);
      if (vc >= v) break;
      v = vc;
    }
    return v;
  }

  /** Şu an olunabilecek en yüksek hız: önümüzdeki virajlara fren mesafesiyle bakarak. */
  plannedSpeed(s, vF, aLat, capMargin) {
    const line = this.line;
    const aBrake = Math.max(8, this.model.brakeDecel * this.brakeMargin);
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
      let vc = Math.abs(k - lastK) < 1e-5 ? lastVc : this.cornerSpeed(k, aLat, capMargin);
      lastK = k;
      lastVc = vc;
      const d = Math.max(0, j * line.ds - lead);
      const sw = line.swingAtIndex(i0 + j);
      if (sw > 0) {
        const vs = TUNING.swingOmega / sw; // S viraj: yaw oranı ters dönecek
        if (vs < vc) vc = vs;
      }
      const vAllowed = Math.sqrt(vc * vc + 2 * aBrake * d);
      if (vAllowed < vT) vT = vAllowed;
    }
    return vT;
  }

  /**
   * vNeed hızıyla girilirse fren yapmak zorunda kalacağımız noktaya kadar kalan mesafe (en çok 300 m).
   * Nitro kararı: patlamanın bitmesine yetecek serbest yol var mı?
   */
  brakeFreeDistance(s, vNeed, aLat, capMargin) {
    const line = this.line;
    const aBrake = Math.max(8, this.model.brakeDecel * this.brakeMargin);
    const steps = Math.min(line.n, Math.ceil(300 / line.ds));
    const i0 = Math.floor(line.indexOf(s));
    let best = 300;
    for (let j = 0; j <= steps; j += 2) {
      const k = line.absCurvatureAtIndex(i0 + j);
      if (k < 2e-4) continue;
      const vc = this.cornerSpeed(k, aLat, capMargin);
      if (vc >= vNeed) continue;
      const d = j * line.ds - (vNeed * vNeed - vc * vc) / (2 * aBrake);
      if (d < best) best = d;
    }
    return best > 0 ? best : 0;
  }

  // ---------------------------------------------------------------------------------------------------
  // Takedown saldırısı: yakındaki rakibe (öncelikle oyuncuya) yandan yanaşıp duvara doğru vur.
  updateAttack(dt, ctx, s, lat, vF, lim, kNear) {
    const car = this.car;
    const P = this.profile;
    const L = this.line.trackLength;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    if (this.attackTarget) {
      const v = this.attackTarget;
      this.attackT += dt;
      if (v.wrecked) {
        // başarı (ya da başkası devirdi)
        this.endAttack((7 + 9 * (1 - this.aggression)) / Math.max(0.5, P.attackMul));
        return;
      }
      let ds = v.trackS - s;
      ds -= Math.round(ds / L) * L;
      if (v.ghost || v.finished || car.finished || ds > 45 || ds < -20 || this.attackT > 8 || kNear > 1 / 90
        || this.otState === OT_SWING) {
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
        if (this.strikeT > 1.1) this.endAttack((4 + 6 * (1 - this.aggression)) / Math.max(0.5, P.attackMul));
      } else {
        // ram: arkadan aynı şeritte
        this.strikeT += dt;
        this.attackLat = v.lateral;
        this.attackSpeed = 1e3;
        if (this.strikeT > 3 || closing < 1) this.endAttack((4 + 6 * (1 - this.aggression)) / Math.max(0.5, P.attackMul));
      }
      return;
    }

    this.attackCheck -= dt;
    if (this.attackCooldown > 0 || this.attackCheck > 0 || this.raceClock < P.startCalm) return;
    this.attackCheck = 0.5;
    if (car.finished || vF < 25 || kNear > 1 / 160 || this.aggression <= 0 || P.attackMul <= 0) return;
    if (this.otState === OT_SWING) return;

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
      const weight = c === ctx.player ? 1 : car.isPlayer ? 0.7 : P.botTarget;
      let score = weight * (1 - Math.abs(ds) / 40);
      if (P.attackNeedsPin) {
        // akıllı saldırı: duvara yakın (sıkıştırılabilir) kurbanlara öncelik ver
        const wallGap = this.line.halfWidthAt(c.trackS) - Math.abs(c.lateral);
        score *= wallGap < 4.5 ? 1.5 : 0.8;
      }
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best) return;
    if (this.rng() > this.aggression * 0.3 * P.attackMul * bestScore) return;

    this.attackTarget = best;
    attackClaims.set(best, this);
    this.attackPhase = 'approach';
    this.attackT = 0;
    this.strikeT = 0;
    this.stats.attack++;
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
  // Slipstream ve sollama: öndeki arabanın arkasına bilinçli gir (draft), yaklaşınca bir taraf seç ve
  // sollama bitene dek o tarafa bağlı kal.
  updateOvertake(dt, ctx, s, lat, vF, lim, kNear) {
    const car = this.car;
    const P = this.profile;
    const L = this.line.trackLength;
    if (this.otCooldown > 0) this.otCooldown -= dt;
    if (car.draft > 0.3) this.stats.slipTime += dt;

    if (this.otState !== OT_NONE) {
      const v = this.otTarget;
      this.otT += dt;
      let ds = v.trackS - s;
      ds -= Math.round(ds / L) * L;
      const closing = vF - v.speed;
      if (v.wrecked || v.ghost || v.airborne || v.finished || car.finished || this.attackTarget || ds > 60 || ds < -25
        || vF < 18 || this.otT > 16) {
        this.endOvertake(1.5, 'invalid');
        return;
      }
      if (this.otState === OT_FOLLOW) {
        if (ds < -3 || kNear > 1 / 60) {
          this.endOvertake(1.5, ds < -3 ? 'passedByFollow' : 'cornerFollow');
          return;
        }
        this.otLat = clamp(v.lateral, -lim, lim);
        this.otFollowSpeed = v.speed + clamp((ds - 7) * 0.9, -4, 14) + 2;
        const straight = kNear < 1 / 110;
        const swingDist = clamp(9 + closing * 1.0, 11, 26);
        if (straight && ((ds <= swingDist && closing > 0.8) || ds <= 11 || (closing > 7 && ds < 26))
          && this.passRoom(s, vF, ds, closing)) this.startSwing(v, ctx, s, lat, lim, ds);
        else if (this.otT > 9 && closing < 0.5) this.endOvertake(4, 'noResult'); // sonuç yok: vazgeç
        return;
      }
      // SWING: seçilen tarafa bağlı kal
      this.otLat = clamp(v.lateral + this.otSide * 3.6, -lim, lim);
      // henüz onun şeridindeyken tamponuna binmeyelim: yanal açıklık oluşana dek hızını aşma
      this.otFollowSpeed = Math.abs(lat - v.lateral) < 2.6 && ds > 2.5 ? v.speed + Math.max(0, ds - 6.5) * 0.8 : Infinity;
      if (Math.abs(this.otLat - v.lateral) < 2.5 && ds > 3) {
        // seçilen tarafta yer kalmadı: takibe dön (taraf değiştirmeden)
        this.otState = OT_FOLLOW;
        this.otT = 0;
        this.otCooldown = 0;
        return;
      }
      if (ds < -6.5) {
        this.stats.overtake++;
        this.endOvertake(1.2, 'done');
        return;
      }
      if (this.otT > 8 || kNear > 1 / 45) this.endOvertake(2.5, this.otT > 8 ? 'swingTimeout' : 'swingCorner');
      return;
    }

    if (this.otCooldown > 0 || P.slip <= 0 || this.attackTarget || car.finished || vF < 30 || kNear > 1 / 130
      || this.raceClock < P.startCalm) return;
    this.otCheck -= dt;
    if (this.otCheck > 0) return;
    this.otCheck = 0.1;

    let best = null;
    let bestDs = 1e9;
    const cars = ctx.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c === car || c.wrecked || c.ghost || c.finished || c.airborne) continue;
      let ds = c.trackS - s;
      ds -= Math.round(ds / L) * L;
      if (ds < 6 || ds > 36 || ds >= bestDs) continue;
      if (Math.abs(c.lateral - lat) > 4) continue;
      if (c.speed < 12 || vF + 8 < c.speed) continue; // yetişilemez
      best = c;
      bestDs = ds;
    }
    if (!best) return;
    if (this.otSeen !== best) {
      this.otSeen = best;
      this.otAccept = this.rng() < P.slip;
    }
    if (!this.otAccept) return;
    this.otState = OT_FOLLOW;
    this.otTarget = best;
    this.otT = 0;
    this.otSide = 0;
    this.otLat = best.lateral;
    this.otFollowSpeed = best.speed + 6;
    this.stats.follow++;
  }

  /** Sollamayı bitirecek kadar serbest yol (fren noktasına kadar) var mı? */
  passRoom(s, vF, ds, closing) {
    const passTime = Math.min(6, (ds + 11) / Math.max(closing, 1.5));
    const need = Math.max(90, passTime * vF);
    return this.brakeFreeDistance(s, vF + 6, this.aLatNow, this.capNow) >= need;
  }

  startSwing(v, ctx, s, lat, lim, ds) {
    const L = this.line.trackLength;
    // her iki taraftaki boşluk: yol kenarına kalan mesafe ve komşu arabalar
    const roomR = lim - v.lateral;
    const roomL = v.lateral + lim;
    // bulunduğumuz taraftan geç: öndekinin arkasından karşı tarafa çapraz geçmek tampona çarpma riski taşır
    const off = lat - v.lateral;
    const cross = Math.abs(off) > 0.7 ? (ds < 14 ? 12 : 5) : 0;
    let costR = -roomR + (off > 0.7 ? -1.2 : off < -0.7 ? cross : 0);
    let costL = -roomL + (off < -0.7 ? -1.2 : off > 0.7 ? cross : 0);
    // yaklaşan virajın içinden sollamak daha avantajlı
    const kSigned = this.line.curvatureAt(s + 90);
    if (kSigned > 5e-4) costR -= 1.5;
    else if (kSigned < -5e-4) costL -= 1.5;
    // komşu arabalar (yanımızdaki şeridi tutan)
    const cars = ctx.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c === this.car || c === v || c.wrecked || c.ghost) continue;
      let d2 = c.trackS - s;
      d2 -= Math.round(d2 / L) * L;
      if (d2 < -6 || d2 > ds + 12) continue;
      const rel = c.lateral - v.lateral;
      if (rel > 1.5 && rel < 6) costR += 6;
      else if (rel < -1.5 && rel > -6) costL += 6;
    }
    this.otSide = costR <= costL ? 1 : -1;
    // seçilen taraf için yeterli yer yoksa takipte kal
    const room = this.otSide > 0 ? roomR : roomL;
    if (room < 2.6) {
      this.otSide = -this.otSide;
      if ((this.otSide > 0 ? roomR : roomL) < 2.6) return;
    }
    this.otState = OT_SWING;
    this.otT = 0;
    this.stats.swing++;
  }

  endOvertake(cooldown, why) {
    if (why && this.otState !== OT_NONE) this.stats['ot_' + why] = (this.stats['ot_' + why] || 0) + 1;
    this.otState = OT_NONE;
    this.otTarget = null;
    this.otSide = 0;
    this.otT = 0;
    this.otFollowSpeed = Infinity;
    this.otCooldown = Math.max(this.otCooldown || 0, cooldown);
  }

  // ---------------------------------------------------------------------------------------------------
  // Savunma: yakından arkadaki rakip çizgimizi tehdit ederken, onun hattını kapatacak şekilde TEK bir hareketle
  // yana kay (sınırlı süre, sınırlı yanal hız, duvardan uzak); sonra pozisyonu koru, zikzak yapma.
  updateDefend(dt, ctx, s, lat, vF, lim, kNear) {
    const car = this.car;
    const P = this.profile;
    const L = this.line.trackLength;
    if (this.defendCooldown > 0) this.defendCooldown -= dt;

    if (this.defendActive) {
      this.defendT += dt;
      const f = this.defendFollower;
      let ds = f.trackS - s;
      ds -= Math.round(ds / L) * L;
      if (f.wrecked || f.ghost || f.airborne || ds > -1 || ds < -34 || this.defendT > 3.4 || kNear > 1 / 110
        || this.otState === OT_SWING || this.attackTarget || car.finished) {
        this.defendActive = false;
        this.defendFollower = null;
        this.defendCooldown = 4 + this.rng() * 5;
        return;
      }
      const step = 2.4 * dt; // m/s yanal hız sınırı
      this.defendCur += clamp(this.defendLat - this.defendCur, -step, step);
      return;
    }

    if (P.defend <= 0 || this.defendCooldown > 0 || this.otState === OT_SWING || this.attackTarget || car.finished
      || vF < 28 || kNear > 1 / 140 || this.raceClock < P.startCalm) return;
    this.defendCheck -= dt;
    if (this.defendCheck > 0) return;
    this.defendCheck = 0.3;

    let best = null;
    let bestDs = -1e9;
    const cars = ctx.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c === car || c.wrecked || c.ghost || c.finished || c.airborne) continue;
      let ds = c.trackS - s;
      ds -= Math.round(ds / L) * L;
      if (ds > -4.5 || ds < -24 || ds <= bestDs) continue;
      if (Math.abs(c.lateral - lat) > 6) continue;
      if (c.speed < 20 || c.speed < vF - 3) continue; // geride kalıyor: tehdit değil
      if (ds < -14 && c.speed - vF < 1) continue;
      best = c;
      bestDs = ds;
    }
    if (!best) return;
    if (this.defSeen !== best) {
      this.defSeen = best;
      const w = best === ctx.player ? 1 : P.defend >= 1 ? 1 : 0.6;
      this.defAccept = this.rng() < P.defend * w;
    }
    if (!this.defAccept) return;
    const delta = best.lateral - lat;
    const maxLat = Math.max(0, lim - 1.0);
    this.defendLat = clamp(Math.abs(delta) < 0.7 ? lat : lat + clamp(delta, -3.2, 3.2), -maxLat, maxLat);
    this.defendCur = lat;
    this.defendActive = true;
    this.defendFollower = best;
    this.defendT = 0;
    this.stats.defend++;
  }

  // ---------------------------------------------------------------------------------------------------
  // Sollama/kaçınma: önümüzdeki ~25 m'de yolumuzu kesen arabalar için yanal "yasak bantlar" çıkar,
  // planlanan çizgi bir banda düşüyorsa en ucuz boş yanal konumu seç; hiç yer yoksa takip et.
  updateAvoidance(dt, ctx, s, lat, vF, lim, plannedLat, kNear) {
    const car = this.car;
    const L = this.line.trackLength;
    const myHalf = Number.isFinite(car.halfWidth) ? car.halfWidth : 1;
    const margin = this.profile.avoidMargin;
    const lo = this.bandLo;
    const hi = this.bandHi;
    let count = 0;
    let followSpeed = Infinity;
    let laneMin = -1e9;
    let laneMax = 1e9;
    let squeeze = Infinity;
    let cornerFollow = Infinity;
    const tight = kNear > TUNING.tightCorner;
    const cars = ctx.cars;
    const handled = this.otState !== OT_NONE ? this.otTarget : null;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c === car || c === this.attackTarget || c === handled) continue;
      let ds = c.trackS - s;
      ds -= Math.round(ds / L) * L;
      if (!(ds >= -TUNING.avoidBehind)) continue; // arka tamponu hâlâ yanımızdaysa say
      const wrecked = c.wrecked;
      // sıkı viraj girişinde öndekiyle mesafeyi koru (yan yana sıkışıp dönüşte çarpışmayı azaltır)
      if (tight && ds >= 5 && ds <= TUNING.cornerGap + 17 && !wrecked && c.ghost !== true && Math.abs(c.lateral - lat) < 4.5) {
        const cs = c.speed - 0.5 + (ds - TUNING.cornerGap) * 0.5;
        if (cs < cornerFollow) cornerFollow = cs;
      }
      if (ds < TUNING.alongside) {
        // yanımızda (ya da tamponu yanımızda): şerit koruma. Hangi tarafındaysak orada kal; kenara sıkışırsak
        // arkadaki olan (bu arabanın önünde olan biz değilsek) yavaşlayıp geride kalır.
        if (wrecked || c.ghost === true) continue;
        const halfA = myHalf + (Number.isFinite(c.halfWidth) ? c.halfWidth : 1) + margin;
        let shiftA = 0;
        if (c.velocity) {
          const ci = this.line.sampleIndex(c.trackS);
          shiftA = clamp((c.velocity.x * this.line.rx[ci] + c.velocity.z * this.line.rz[ci]) * TUNING.avoidLatLead, -3, 3);
        }
        const loA = c.lateral - halfA + Math.min(0, shiftA);
        const hiA = c.lateral + halfA + Math.max(0, shiftA);
        if (lat >= c.lateral) {
          if (hiA > laneMin) laneMin = hiA;
        } else if (loA < laneMax) laneMax = loA;
        if (ds > 0.5 && (laneMin > lim || laneMax < -lim)) squeeze = Math.min(squeeze, c.speed - 3);
        continue;
      }

      const cSpeed = wrecked ? 0 : c.speed;
      const closing = vF - cSpeed;
      // ~25 m; hızla yaklaşılan (ör. devrilmiş) araçlar için kapanma hızıyla uzar
      const range = Math.max(TUNING.avoidRange + Math.max(0, vF) * 0.12, closing * 1.8 + 6);
      if (ds > range) continue;
      if (ds > 5 && !wrecked && closing < 0.5) continue; // bizden hızlı, uzaklaşıyor
      if (ds > 5 && (ds - 5) / Math.max(closing, 0.1) > 2.2) continue; // daha vakit var
      if (count >= MAX_BANDS) break;
      const half = myHalf + (Number.isFinite(c.halfWidth) ? c.halfWidth : 1) + margin;
      // yanal hareketi öngör: virajda çizgi değiştiren arabanın birkaç yüz ms sonraki konumunu da kapsa
      let shift = 0;
      if (!wrecked && c.velocity) {
        const ci = this.line.sampleIndex(c.trackS);
        shift = clamp((c.velocity.x * this.line.rx[ci] + c.velocity.z * this.line.rz[ci]) * TUNING.avoidLatLead, -3, 3);
      }
      lo[count] = c.lateral - half + Math.min(0, shift);
      hi[count] = c.lateral + half + Math.max(0, shift);
      this.bandSpeed[count] = wrecked ? -1 : cSpeed;
      this.bandDs[count] = ds;
      count++;
    }
    this.bandCount = count;
    this.laneMin = laneMin;
    this.laneMax = laneMax;
    this.squeezeSpeed = Math.min(squeeze, cornerFollow);
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
      // yanal kaçış temastan önce yetişmeyecekse (yakın ve hızlı yaklaşıyoruz) aynı anda hızı da düşür
      const pb = primary;
      if (this.bandSpeed[pb] >= 0 && this.bandDs[pb] > 4) {
        const cl = Math.max(vF - this.bandSpeed[pb], 0.1);
        const tHit = (this.bandDs[pb] - 5) / cl;
        const tMove = Math.abs(bestLat - lat) / TUNING.avoidLatRate + 0.25;
        if (tHit < tMove * 1.3) {
          followSpeed = Math.max(0, this.bandSpeed[pb] + Math.max(0, this.bandDs[pb] - 7) * 0.6);
        }
      }
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
  // Nitro pickup'ları: çizgiye yakın (en çok ~5 m yanal sapma) ve düz yoldaki aktif pickup'a yönel.
  updatePickup(dt, s, lat, vF, lim, kNear) {
    const pickups = this.track.pickups;
    if (!pickups || pickups.length === 0) return NaN;
    const P = this.profile;
    const L = this.line.trackLength;
    const car = this.car;
    if (this.pickTarget) {
      const p = this.pickTarget;
      let ds = p.s - s;
      ds -= Math.round(ds / L) * L;
      if (!p.active || ds < -1.5 || ds > 130 || kNear > 1 / 70 || car.finished || car.nitro > 0.97) {
        this.pickTarget = null;
        return NaN;
      }
      return ds < 75 ? p.lateral : NaN;
    }
    if (P.pickup <= 0 || car.nitro > 0.9 || kNear > 1 / 110 || vF < 25 || car.finished) return NaN;
    this.pickCheck -= dt;
    if (this.pickCheck > 0) return NaN;
    this.pickCheck = 0.25;
    let best = null;
    let bestDs = 1e9;
    for (let i = 0; i < pickups.length; i++) {
      const p = pickups[i];
      if (!p || !p.active || !Number.isFinite(p.s)) continue;
      let ds = p.s - s;
      ds -= Math.round(ds / L) * L;
      if (ds < 25 || ds > 110 || ds >= bestDs) continue;
      const lim2 = Math.max(0, this.line.halfWidthAt(p.s) - TUNING.edge);
      if (Math.abs(p.lateral) > lim2 + 0.5) continue;
      if (Math.abs(p.lateral - this.baseLatAt(p.s)) > 5.5) continue; // çizgiden çok uzak
      // yüksek hızda yola göre sapma açısı sınırlı: yanal olarak erişilemeyecek pickup'a gitme (S virajda savrulma)
      const maxSlope = clamp(TUNING.slopeK / Math.max(vF, 10), TUNING.slopeMin, TUNING.slopeMax);
      if (Math.abs(p.lateral - lat) > maxSlope * Math.min(ds, 75)) continue;
      best = p;
      bestDs = ds;
    }
    if (!best) return NaN;
    if (this.pickSeen !== best) {
      this.pickSeen = best;
      this.pickAccept = this.rng() < P.pickup;
    }
    if (this.pickAccept) this.pickTarget = best;
    return NaN;
  }

  // ---------------------------------------------------------------------------------------------------
  // Rampalar: 'jump' rampalarından bazen, 'roll' rampalarına yalnızca yetenekli botlar bazen girer.
  updateRamp(s, vF, lim) {
    const L = this.line.trackLength;
    const car = this.car;
    const info = this.line.nextRamp(s, 140, this.rampInfo);
    const ramp = info.ramp;
    if (!ramp) {
      // rampadan sonra (havadayken ve inişten sonra bir süre) yola paralel sür
      if (this.rampHold) {
        if (car.airborne) return this.rampLat;
        let d = this.rampHoldS - s;
        d -= Math.round(d / L) * L;
        if (d > 0 && d < 200) return this.rampLat;
        this.rampHold = false;
      }
      return NaN;
    }
    const line = this.line;
    const v = Math.max(vF, 20);
    const kf = rampFlightK.get(ramp);
    // tahmini uçuş mesafesi: öğrenilmediyse rampa geometrisinden (çıkış dikey hızı ≈ 2·h/l·v, uçuş süresi ≈ 2·vy/g)
    const k0 = (4 * (ramp.height || 2)) / (Math.max(5, ramp.s1 - ramp.s0) * GRAVITY_GUESS);
    const dist = (kf === undefined ? k0 : kf) * v * v;
    // düz uçuşta yola göre yanal sapma: sağa dönen yolda (κ > 0) araba sola kayar
    const drift = -line.curvatureAt(ramp.s1 + dist * 0.5) * dist * dist * 0.5;
    const latMin = Number.isFinite(ramp.latMin) ? ramp.latMin : -lim;
    const latMax = Number.isFinite(ramp.latMax) ? ramp.latMax : lim;
    const landWant = clamp(this.baseLatAt(ramp.s1 + dist), -lim + 0.3, lim - 0.3);
    const lo = latMin + 0.6;
    const hi = latMax - 0.6;
    const takeLat = lo <= hi ? clamp(landWant - drift, lo, hi) : (latMin + latMax) / 2;
    const lap = car.lap | 0;
    if (this.rampKey !== ramp || this.rampLap !== lap) {
      this.rampKey = ramp;
      this.rampLap = lap;
      const P = this.profile;
      const k = this.k;
      const r = this.rng();
      let take;
      if (ramp.type === 'roll') take = k >= 0.7 && r < (0.2 + 0.6 * (k - 0.7)) * P.rampMul;
      else take = r < (0.3 + 0.35 * k) * P.rampMul;
      // rampadan kaçınmak için serbest bölgeler (rampanın iki yanı)
      const freeL = latMin - 1.8;
      const freeR = latMax + 1.8;
      const okL = freeL > -lim + 0.4;
      const okR = freeR < lim - 0.4;
      // inişte duvara ya da yol dışına düşecekse girme
      const landing = takeLat + drift;
      if (take && (lo > hi || Math.abs(landing) > lim + 0.2) && (okL || okR)) take = false;
      // havada fren yapılamaz: iniş sonrası fren noktası uçuşun bitiminden önce gelmesin (ör. inişte sıkı viraj)
      if (take && (okL || okR)
        && this.brakeFreeDistance(ramp.s0, v * 1.05, this.aLatNow, this.capNow) < ramp.s1 - ramp.s0 + dist + 30) take = false;
      if (!take && !okL && !okR) take = true; // kaçınacak yer yok
      this.rampTake = take;
      if (!take) {
        const base = this.baseLatAt(ramp.s0);
        const cL = okL ? Math.min(base, freeL) : NaN;
        const cR = okR ? Math.max(base, freeR) : NaN;
        if (okL && okR) this.avoidRampLat = Math.abs(cL - base) <= Math.abs(cR - base) ? cL : cR;
        else this.avoidRampLat = okL ? cL : cR;
      }
    }
    this.rampLat = this.rampTake ? takeLat : this.avoidRampLat;
    this.rampHold = true;
    this.rampHoldS = ramp.s1 + 40;
    return this.rampLat;
  }

  /** Uçuş mesafesini öğren (rampa başına, tüm botlar paylaşır): mesafe ≈ k·v². */
  trackFlight(s, vF) {
    const car = this.car;
    const air = car.airborne === true;
    if (air && !this.wasAir) {
      this.flightS0 = s;
      this.flightV0 = vF;
      this.flightRamp = this.rampHold ? this.rampKey : null;
    } else if (!air && this.wasAir) {
      const L = this.line.trackLength;
      if (this.rampHold) this.rampHoldS = s + 25;
      if (this.flightRamp && this.flightV0 > 20) {
        let d = s - this.flightS0;
        d -= Math.round(d / L) * L;
        d += this.flightV0 * 0.1; // 'havada' bayrağı ~0.1 s gecikmeli
        if (d > 5 && d < 500) {
          const k = d / (this.flightV0 * this.flightV0);
          const old = rampFlightK.get(this.flightRamp);
          rampFlightK.set(this.flightRamp, old === undefined ? k : old * 0.5 + k * 0.5);
        }
      }
      this.flightRamp = null;
    }
    this.wasAir = air;
  }

  // ---------------------------------------------------------------------------------------------------
  // Nitro:
  //   normal → önde ~200 m düz yol varsa bas; patlama ilerlemesi biliniyorsa perfect nitro için zincirle.
  //   zor    → fren noktasına kadar serbest mesafeye bakar (viraj çıkışlarında da yakar, virajdan hemen önce yakmaz),
  //            perfect zincirini pencereye tam oturtur, bar doluyken yakında rakip varsa shockwave (çift basış) atar.
  //   kolay  → yüksek eşik, çoğu zaman zinciri kaçırır, ara sıra yanlış yerde yakar.
  updateNitro(dt, ctx, s, vF, aLat, capMargin, boost, slowRaw, kNear, kHere) {
    const car = this.car;
    const P = this.profile;
    let want = false;
    let chain = false; // perfect nitro zinciri (eşik yok: patlama zaten sürüyor)
    let shock = false;
    if (this.shockCooldown > 0) this.shockCooldown -= dt;
    const burstOn = car.nitroActive;
    if (!car.finished && slowRaw < P.nitroRubber && vF > 12 && this.recoverT <= 0) {
      const threshold = P.nitroThreshold - 0.18 * boost + 0.1 * (1 - this.k);
      if (P.nitroSmart) {
        this.nitroPlanT -= dt;
        if (this.nitroPlanT <= 0) {
          this.nitroPlanT = 0.1;
          this.freeD = this.brakeFreeDistance(s, vF + 18, aLat, capMargin);
          this.rivalAhead = this.nearestAhead(ctx, s, 170);
        }
        const needD = P.nitroNeed[0] * vF + P.nitroNeed[1];
        const gentle = kHere < 1 / 140;
        const straight = gentle && this.freeD >= needD;
        if (straight && car.nitro > threshold) want = true;
        if (gentle && this.freeD >= needD * 0.6) chain = true;
        // devrilme sonrası hızlı toparlanma: bar varsa hemen yak
        if (this.sinceRespawn < 5 && gentle && car.nitro > 0.04 && this.freeD > 40) {
          want = true;
          chain = true;
        }
        if (P.shock > 0 && !this.attackTarget) shock = this.shockWanted(ctx, s, vF, kHere);
        // shockwave için bar doldurmaya çalış: yakında rakip varken, bar yarıdan fazlaysa normal patlamaları ertele
        if (P.shock > 0 && !burstOn && car.nitro >= 0.55 && car.nitro < 0.995 && this.rivalAhead < 170 && this.saveT < 25) {
          this.saveT += dt;
          want = false;
        } else if (car.nitro < 0.5 || car.nitro >= 0.995) this.saveT = 0;
      } else {
        const kA = this.line.maxCurvatureAhead(s);
        const vNeed = vF + 18 - 8 * boost;
        const straight = kA < 2e-4 || this.cornerSpeed(kA, aLat, capMargin) > vNeed;
        if (straight && car.nitro > threshold) want = true;
        if (straight) chain = true;
        if (P.nitroChain < 1 && this.chainOn === false) chain = false;
        if (this.sinceRespawn < 5 && straight && car.nitro > 0.04) want = true;
        // kolay: ara sıra yanlış yerde yak (verimsiz)
        if (P.nitroThreshold > 0.5 && !want && car.nitro > 0.45 && !burstOn) {
          this.wasteT -= dt;
          if (this.wasteT <= 0) {
            this.wasteT = 2 + this.rng() * 6;
            if (this.rng() < 0.3) this.wasteNow = 0.4;
          }
          if (this.wasteNow > 0) {
            this.wasteNow -= dt;
            want = true;
          }
        }
      }
      // takedown / sollama: arkadan nitroyla vur ya da kurbana yetiş
      if (this.attackTarget && car.nitro > 0.2 && this.maxCurvature(s, 120) < 1 / 200) {
        if (this.attackPhase === 'ram') want = true;
        else if (this.attackPhase === 'approach') {
          let ds = this.attackTarget.trackS - s;
          const L = this.line.trackLength;
          ds -= Math.round(ds / L) * L;
          if (ds > 10) want = true;
        }
      }
      if (this.otState === OT_SWING && car.nitro > 0.15 && kNear < 1 / 160 && P.nitroSmart) want = true;
      if (want) chain = true;
    }

    // --- shockwave: tam bar, çift basış (bas, bırak, 0.35 s içinde tekrar bas) ---------------------------
    if (this.shockPhase > 0) {
      let hold = false;
      if (this.shockPhase === 1) {
        if (!car.nitroActive) {
          this.shockPhase = 0;
          return false;
        }
        this.shockPhase = 2; // bırak
      } else if (this.shockPhase === 2) {
        hold = true;
        this.shockPhase = 3;
      } else if (this.shockPhase === 3) {
        if (car.nitroLevel === 'shockwave') this.stats.shock++;
        this.shockPhase = 4;
        this.shockCooldown = 6;
      } else if (this.shockPhase === 4) {
        if (!car.nitroActive) this.shockPhase = 0;
      }
      this.nitroHold = hold;
      this.nitroHeldT = 0;
      this.prevBurst = -1;
      return hold;
    }
    if (shock && car.nitro >= 0.995 && !car.nitroActive && this.shockCooldown <= 0) {
      this.shockPhase = 1;
      this.nitroHold = true;
      this.nitroHeldT = 0;
      return true;
    }

    const prog = car.nitroBurstProgress;
    const hasProg = typeof prog === 'number' && Number.isFinite(prog);
    let hold;
    if (car.nitroActive) {
      if (car.nitroLevel === 'shockwave') {
        hold = false;
        this.prevBurst = prog;
      } else if (hasProg) {
        if (prog + 0.2 < this.prevBurst) this.rollChain(); // yeni patlama başladı
        if (this.prevBurst < 0) this.rollChain();
        this.prevBurst = prog;
        if (prog < 0.55) hold = this.nitroHold && chain;
        else if (prog < this.chainPressAt) hold = false; // pencereden önce bırak
        else hold = chain && this.chainOn && car.nitro > 0.04; // perfect nitro penceresinde tekrar bas
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

  /** Önümüzdeki en yakın (devrilmemiş) arabaya olan mesafe (m), yoksa 1e9. */
  nearestAhead(ctx, s, range) {
    const car = this.car;
    const L = this.line.trackLength;
    const cars = ctx.cars;
    let best = 1e9;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c === car || c.wrecked || c.ghost || c.finished || c.airborne) continue;
      let ds = c.trackS - s;
      ds -= Math.round(ds / L) * L;
      if (ds > 6 && ds < range && ds < best) best = ds;
    }
    return best;
  }

  /** Zor zorluk: shockwave için uygun an mı? (düzlük + yakında rakip) */
  shockWanted(ctx, s, vF, kHere) {
    const car = this.car;
    if (car.nitro < 0.995 || car.nitroActive || this.shockCooldown > 0 || vF < 35) return false;
    if (kHere > 1 / 200 || this.freeD < 140) return false;
    return this.rivalAhead < 100;
  }

  rollChain() {
    const P = this.profile;
    // zorluğa göre basış zamanı: yetenekli botlar pencereyi (> 0.75) tutturur, kolay botlar sık kaçırır
    const aim = P.nitroChainAim;
    const r = this.rng();
    const sloppy = (1 - this.k) * (this.rng() - 0.4) * 0.5;
    if (P.nitroChain < 1) {
      this.chainOn = this.rng() < P.nitroChain;
      this.chainPressAt = clamp(lerp(aim[0], aim[1], r) + sloppy, 0.5, 1.05);
    } else {
      this.chainOn = true;
      this.chainPressAt = clamp(lerp(aim[0], aim[1], r) + sloppy * (this.difficulty === 'hard' ? 0.2 : 1), 0.6, 1.05);
    }
  }
}
