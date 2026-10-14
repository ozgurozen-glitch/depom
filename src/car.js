// Car: arcade araba fiziği (Asphalt hissi) + prosedürel "Vortex GT" modeli.
//
// Durum: dünya koordinatında hız vektörü (velocity) + gövde yönü (yaw). Yerdeyken hız her adımda
// gövde çerçevesine (ileri F / yanal L) ayrıştırılır; yanal kayma tutuşla söner, kaybolan yanal hızın
// büyük kısmı ileri hıza aktarılır (virajda hız korunur). Drift modunda hız yönü ve gövde açısı ayrı
// yönetilir. Havada yalnızca yerçekimi ve sınırlı yaw.
//
// Yön kuralları (docs/ARCHITECTURE.md): forward = (sin yaw, 0, cos yaw), right = (-cos yaw, 0, sin yaw),
// steer > 0 sağa (yaw azalır), lateral > 0 merkez çizgisinin sağı.
import * as THREE from 'three';
import { createCarModel, CAR_DIMENSIONS } from './car/model.js';

const KMH = 1 / 3.6;
const DEG = Math.PI / 180;

// Ayar tablosu — tüm sürüş hissi buradan ayarlanır.
export const CAR_TUNING = Object.freeze({
  maxSpeed: 290 * KMH, // taban azami hız (80.6 m/s)
  accel: 12.2, // m/s², düşük hızdaki itiş (0-200 km/s ≈ 5 s)
  accelExponent: 3.5, // a = accel · (1 - (v/vmax)^n)
  reverseMax: 12,
  reverseAccel: 7,
  coastDecel: 3,
  brakeDecel: 26,
  overSpeedDecel: 0.35, // azami hızın üstünde: a = -(1 + (v - vmax)·k)
  slopeGravity: 3.4, // eğimin ileri hıza etkisi (m/s² / eğim)

  nitro: {
    normal: { speedMul: 1.18, thrust: 10 },
    perfect: { speedMul: 1.28, thrust: 13.5 },
    shockwave: { speedMul: 1.38, thrust: 17 },
  },
  nitroBurstAmount: 1 / 3, // normal/perfect patlamanın yaktığı bar
  nitroBurstDuration: 2.2,
  shockwaveDuration: 4,
  nitroMinToFire: 0.04,
  perfectWindow: 0.75, // patlamanın son %25'i
  doubleTapWindow: 0.35,
  shockwaveMinBar: 0.99,

  // Direksiyon ve tutuş
  minTurnRadius: 6.5, // düşük hızda yaw oranı = v / R
  yawRateLow: 2.1, // rad/s üst sınır (düşük hız)
  yawRateHigh: 1.08, // rad/s üst sınır (taban azami hızda) → hafif understeer
  yawRateNitro: 0.92, // nitro hızlarında
  yawResponse: 13,
  gripLow: 15, // yanal kayma sönüm oranı (1/s)
  gripHigh: 8.5,
  cornerTransfer: 0.92, // sönen yanal hız enerjisinin ileri hıza aktarılan oranı (virajda hız korunur)
  airSteer: 0.28,

  // Drift
  driftMinSpeed: 80 * KMH,
  driftExitSpeed: 50 * KMH,
  driftSteerThreshold: 0.25,
  driftAngleMin: 25 * DEG, // karşı direksiyon
  driftAngleMid: 34 * DEG,
  driftAngleMax: 45 * DEG, // direksiyon drift yönüne tam
  driftPathRate: [0.45, 1.0, 1.5], // hız vektörünün dönüş oranı (karşı / nötr / tam), rad/s
  driftMinRadius: 13,
  driftSwing: 6.5, // gövdenin hedef açıya yaylanma oranı
  driftDecelBase: 1.0,
  driftDecelAngle: 2.0,
  driftNitroRate: 0.12,
  driftReleaseGrace: 0.1,
  driftFlipTime: 0.22,
  gripRecoverTime: 0.45,

  // Hava
  gravity: 17,
  airNitroRate: 0.1,
  jumpEventMinAir: 0.1,
  hardLandingSpeed: 8.5,
  liftEpsilon: 0.004,

  // Bariyer
  wallWreckAngle: 45 * DEG,
  wallWreckSpeed: 130 * KMH,
  wallEventInterval: 0.1,
  wallFriction: 0.12, // duvara giren hızın bu oranı kadar teğetsel kayıp
  wallImpactLoss: 0.25, // sert darbelerde (vn > 3 m/s) ek kayıp
  wallScrapeDecel: 2.5, // temas sürdükçe sabit yavaşlama (m/s²)

  // Wreck / respawn
  wreckDuration: 2.5,
  respawnAhead: 8,
  respawnSpeedFactor: 0.35,
  ghostDuration: 1.5,
});

const T = CAR_TUNING;
const D = CAR_DIMENSIONS;
const NITRO_LEVELS = T.nitro;

// Sıcak yol için modül düzeyinde geçici nesneler.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const wrapAngle = (a) => {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrapS = (track, s) => {
  const L = track.length;
  return L > 0 ? ((s % L) + L) % L : s;
};
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

export class Car {
  constructor({ scene, color, name, isPlayer, spec = null }) {
    this.spec = spec;
    this.name = name;
    this.color = color;
    this.isPlayer = Boolean(isPlayer);

    this.radius = 2.2;
    this.halfLength = D.length / 2;
    this.halfWidth = D.width / 2;
    this.maxSpeed = T.maxSpeed; // taban azami hız (m/s) — AI için bilgi

    this.parts = createCarModel(color);
    this.mesh = this.parts.root;
    this.mesh.name = `car:${name}`;
    scene.add(this.mesh);
    if (this.parts.shadow) scene.add(this.parts.shadow);

    this.position = this.mesh.position;
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.yawRate = 0; // rad/s (kamera / efektler için)
    this.speed = 0;

    this.nitro = 0;
    this.nitroActive = false;
    this.nitroLevel = null;
    this.nitroBurstProgress = null;

    this.drifting = false;
    this.driftDir = 0; // +1 sağa, -1 sola
    this.driftAngle = 0; // gövde ile hız vektörü arasındaki açı (rad, mutlak)
    this.airborne = false;
    this.airTime = 0;
    this.wrecked = false;
    this.ghost = false;

    this.trackS = 0;
    this.lateral = 0;

    // Game'in yönettiği alanlar
    this.raceDistance = 0;
    this.lap = 0;
    this.place = 1;
    this.finished = false;
    this.finishTime = null;

    this.events = [];

    this._resetState();
  }

  get speedKmh() {
    return Math.hypot(this.velocity.x, this.velocity.z) * 3.6;
  }

  // -------------------------------------------------------------------------------------------
  // Genel API
  // -------------------------------------------------------------------------------------------

  placeAt(pos, yaw) {
    this.position.copy(pos);
    this.yaw = yaw;
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.yawRate = 0;
    this.nitroActive = false;
    this.nitroLevel = null;
    this.nitroBurstProgress = null;
    this.drifting = false;
    this.driftDir = 0;
    this.driftAngle = 0;
    this.airborne = false;
    this.airTime = 0;
    this.wrecked = false;
    this.ghost = false;
    this._resetState();
    this._resetVisual();
    this._snapGround = true;
    this.mesh.rotation.set(0, yaw, 0);
    this.mesh.updateMatrixWorld(true);
    if (this.parts.shadow) {
      this.parts.shadow.visible = true;
      this.parts.shadow.position.set(pos.x, pos.y + 0.03, pos.z);
      this.parts.shadow.rotation.set(0, yaw, 0);
      this.parts.shadow.scale.setScalar(1);
    }
  }

  addNitro(amount) {
    this.nitro = clamp(this.nitro + amount, 0, 1);
  }

  applyImpulse(vec) {
    this.velocity.x += vec.x;
    this.velocity.z += vec.z;
    if (this._inAir || this.wrecked) this.velocity.y += vec.y;
    this.speed = this.velocity.x * Math.sin(this.yaw) + this.velocity.z * Math.cos(this.yaw);
    this._speedOut = this.speed;
  }

  wreck(cause) {
    if (this.wrecked || this.ghost) return;
    this.wrecked = true;
    this._wreckTimer = T.wreckDuration;
    if (this.drifting) this._endDrift();
    if (this.nitroActive) this._endNitro();

    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    // Momentumla havaya kalkıp takla atar.
    this.velocity.y = Math.max(this.velocity.y, 0) + 4 + hs * 0.06;
    this._inAir = true;
    this.airborne = false;
    const lat = this.velocity.x * -Math.cos(this.yaw) + this.velocity.z * Math.sin(this.yaw);
    const side = Math.abs(lat) > 1 ? Math.sign(lat) : (Math.random() < 0.5 ? -1 : 1);
    const w = this._wreckSpin;
    w.x = (Math.random() * 2 - 1) * 2.5 - Math.min(hs, 60) * 0.03;
    w.y = (Math.random() * 2 - 1) * 3;
    w.z = -side * (6 + Math.random() * 4);
    this.events.push({ type: 'wreck', car: this, cause });
  }

  getRearWheelPositions(out) {
    const res = out || [new THREE.Vector3(), new THREE.Vector3()];
    const c = D.rearContactLocal;
    for (let i = 0; i < 2; i++) {
      res[i].set(c[i][0], c[i][1], c[i][2]);
      this.parts.model.localToWorld(res[i]);
    }
    return res;
  }

  getExhaustPositions(out) {
    const res = out || [new THREE.Vector3(), new THREE.Vector3()];
    const e = D.exhaustLocal;
    for (let i = 0; i < 2; i++) {
      res[i].set(e[i][0], e[i][1], e[i][2]);
      this.parts.chassis.localToWorld(res[i]);
    }
    return res;
  }

  // -------------------------------------------------------------------------------------------
  // Fizik adımı
  // -------------------------------------------------------------------------------------------

  update(dt, input, track) {
    if (!(dt > 0)) return;
    this._time += dt;

    // Dışarıdan `speed` yazılmışsa (ör. eski tip itme) farkı ileri yönde uygula.
    if (this.speed !== this._speedOut) {
      const d = this.speed - this._speedOut;
      this.velocity.x += Math.sin(this.yaw) * d;
      this.velocity.z += Math.cos(this.yaw) * d;
    }

    if (this._wallCooldown > 0) this._wallCooldown -= dt;

    if (this.wrecked) {
      this._updateWreck(dt, track);
    } else {
      if (this.ghost) {
        this._ghostTimer -= dt;
        if (this._ghostTimer <= 0) this.ghost = false;
      }
      const inp = this._readInput(input);
      this._updateNitro(dt, inp.nitro);
      const grip = !this._inAir || this.airTime < T.jumpEventMinAir;
      if (grip) this._stepGround(dt, inp);
      else this._stepAir(dt, inp);

      this.position.x += this.velocity.x * dt;
      this.position.z += this.velocity.z * dt;
      const pr = this._project(track);
      this._collideWalls(dt, track, pr);
      this._followSurface(dt, track, inp);

      if (this.drifting) this.addNitro(T.driftNitroRate * dt);
      if (this.airborne) this.addNitro(T.airNitroRate * dt);
    }

    this.speed = this.velocity.x * Math.sin(this.yaw) + this.velocity.z * Math.cos(this.yaw);
    this._speedOut = this.speed;
    this._updateVisual(dt, track);
  }

  _readInput(input) {
    const s = this._inp;
    if (!input) {
      s.throttle = 0; s.brake = 0; s.steer = 0; s.nitro = false; s.drift = false;
      return s;
    }
    s.throttle = clamp(Number(input.throttle) || 0, 0, 1);
    s.brake = clamp(Number(input.brake) || 0, 0, 1);
    s.steer = clamp(Number(input.steer) || 0, -1, 1);
    s.nitro = Boolean(input.nitro);
    s.drift = Boolean(input.drift);
    return s;
  }

  _project(track) {
    let pr = track.project(this.position, this.trackS);
    const w = track.width || 20;
    if (!pr || !Number.isFinite(pr.s) || Math.abs(pr.lateral) > w * 1.5) pr = track.project(this.position);
    this.trackS = pr.s;
    this.lateral = pr.lateral;
    return pr;
  }

  // --- Nitro ---------------------------------------------------------------------------------

  _updateNitro(dt, pressed) {
    const edge = pressed && !this._prevNitroIn;
    this._prevNitroIn = pressed;
    if (edge) {
      if (this.nitroActive) {
        if (this.nitroLevel === 'normal' && this._burstFull && this._burstTime <= T.doubleTapWindow) {
          this._startNitro('shockwave');
        } else if (this.nitroLevel !== 'shockwave' && this.nitroBurstProgress >= T.perfectWindow
          && this.nitro >= T.nitroMinToFire) {
          this._startNitro('perfect');
        }
      } else if (this.nitro >= T.nitroMinToFire) {
        this._startNitro('normal');
      }
    }
    if (this.nitroActive) {
      this._burstTime += dt;
      this.nitro = Math.max(0, this.nitro - this._burstDrain * dt);
      this.nitroBurstProgress = Math.min(1, this._burstTime / this._burstDuration);
      if (this._burstTime >= this._burstDuration || this.nitro <= 0) this._endNitro();
    }
  }

  _startNitro(level) {
    let amount;
    let duration;
    if (level === 'shockwave') {
      amount = this.nitro;
      duration = T.shockwaveDuration;
    } else {
      amount = Math.min(T.nitroBurstAmount, this.nitro);
      duration = Math.max(0.6, T.nitroBurstDuration * (amount / T.nitroBurstAmount));
    }
    this._burstFull = level === 'normal' && this.nitro >= T.shockwaveMinBar;
    this._burstTime = 0;
    this._burstDuration = duration;
    this._burstDrain = amount / duration;
    this.nitroActive = true;
    this.nitroLevel = level;
    this.nitroBurstProgress = 0;
    this.events.push({ type: 'nitro_start', car: this, level });
  }

  _endNitro() {
    this.nitroActive = false;
    this.nitroLevel = null;
    this.nitroBurstProgress = null;
    this._burstFull = false;
    this.events.push({ type: 'nitro_end', car: this });
  }

  _currentMaxSpeed() {
    return this.nitroActive ? T.maxSpeed * NITRO_LEVELS[this.nitroLevel].speedMul : T.maxSpeed;
  }

  // --- Yer sürüşü ----------------------------------------------------------------------------

  _stepGround(dt, inp) {
    const v = this.velocity;
    const hs = Math.hypot(v.x, v.z);
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const F0 = v.x * sinY + v.z * cosY;

    this._updateDriftState(dt, inp, hs, F0);
    if (this.drifting) {
      this._stepDrift(dt, inp, hs);
      return;
    }
    this.driftAngle = 0;

    // Boyuna ivme
    let F = F0;
    let L = v.x * -cosY + v.z * sinY;
    const a = this._longitudinalAccel(F, inp);
    const Fn = F + a * dt;
    // Frenleme sıfırı geçmesin (geri vitese ayrıca geçilir); geri vites sınırı aşılmasın.
    if (inp.brake > 0 && F > 0 && Fn < 0) F = 0;
    else if (Fn < -T.reverseMax && a < 0) F = Math.min(F, -T.reverseMax);
    else F = Fn;
    this._accelLong = lerp(this._accelLong, (F - F0) / dt, damp(8, dt));

    // Direksiyon: hıza duyarlı yaw oranı, yüksek hızda sınırlı (understeer).
    const absF = Math.abs(F);
    const cap = absF > T.maxSpeed
      ? lerp(T.yawRateHigh, T.yawRateNitro, clamp((absF - T.maxSpeed) / (T.maxSpeed * 0.38), 0, 1))
      : lerp(T.yawRateLow, T.yawRateHigh, (absF / T.maxSpeed) ** 1.3);
    const maxRate = Math.min(absF / T.minTurnRadius, cap);
    const target = -inp.steer * maxRate * (F >= 0 ? 1 : -1);
    this.yawRate += (target - this.yawRate) * damp(T.yawResponse, dt);
    this.yaw = wrapAngle(this.yaw + this.yawRate * dt);

    // Hız vektörünü yeni gövde çerçevesine taşı, yanal kaymayı söndür.
    const wx = F * sinY + L * -cosY;
    const wz = F * cosY + L * sinY;
    const s2 = Math.sin(this.yaw);
    const c2 = Math.cos(this.yaw);
    F = wx * s2 + wz * c2;
    L = wx * -c2 + wz * s2;
    const sf = clamp(absF / T.maxSpeed, 0, 1);
    let grip = lerp(T.gripLow, T.gripHigh, sf);
    if (this._gripRecover > 0) {
      this._gripRecover = Math.max(0, this._gripRecover - dt);
      grip *= lerp(1, 0.3, this._gripRecover / T.gripRecoverTime);
    }
    const L2 = L * Math.exp(-grip * dt);
    // Kaybolan yanal enerji ileri hıza aktarılır — yalnızca araba ileri yönde hareket ederken
    // (düşük hızda yandan itilen araba ileri fırlamasın).
    const sp = Math.sqrt(F * F + L * L);
    const align = sp > 0.01 ? Math.abs(F) / sp : 0;
    const w = T.cornerTransfer * smoothstep(0.35, 0.75, align);
    const F2 = Math.sqrt(F * F + (L * L - L2 * L2) * w) * (F >= 0 ? 1 : -1);
    v.x = F2 * s2 + L2 * -c2;
    v.z = F2 * c2 + L2 * s2;
  }

  _longitudinalAccel(F, inp) {
    const nitro = this.nitroActive ? NITRO_LEVELS[this.nitroLevel] : null;
    let a;
    if (inp.brake > 0) {
      if (F > 0.5) a = -T.brakeDecel * inp.brake;
      else a = F > -T.reverseMax ? -T.reverseAccel * inp.brake : 0;
    } else if (inp.throttle > 0 || nitro) {
      const thr = nitro ? 1 : inp.throttle;
      if (F < -0.5) {
        a = T.brakeDecel * 0.7;
      } else {
        const vmax = this._currentMaxSpeed() * (0.4 + 0.6 * thr);
        if (F <= vmax) {
          const thrust = (T.accel + (nitro ? nitro.thrust : 0)) * thr;
          a = thrust * (1 - (Math.max(0, F) / vmax) ** T.accelExponent);
        } else {
          a = -(1 + (F - vmax) * T.overSpeedDecel);
          if (thr < 1) a = Math.min(a, -T.coastDecel * (1 - thr));
        }
      }
    } else {
      a = Math.abs(F) > 0.2 ? -Math.sign(F) * T.coastDecel : -F * 4;
    }
    // Yokuş: hafif yerçekimi etkisi (arcade).
    a -= T.slopeGravity * this._slope;
    return a;
  }

  // --- Drift ---------------------------------------------------------------------------------

  _updateDriftState(dt, inp, hs, F) {
    if (!this.drifting) {
      if (inp.drift && Math.abs(inp.steer) > T.driftSteerThreshold && hs > T.driftMinSpeed && F > 0 && !this._inAir) {
        this.drifting = true;
        this.driftDir = Math.sign(inp.steer);
        this._driftTime = 0;
        this._driftRelease = 0;
        this._driftSteerRelease = 0;
        this._driftFlip = 0;
        this.events.push({ type: 'drift_start', car: this });
      }
      return;
    }
    this._driftTime += dt;
    this._driftRelease = inp.drift ? 0 : this._driftRelease + dt;
    this._driftSteerRelease = Math.abs(inp.steer) > 0.1 ? 0 : this._driftSteerRelease + dt;
    if (inp.steer * this.driftDir < -0.5) {
      this._driftFlip += dt;
      if (this._driftFlip > T.driftFlipTime) {
        this.driftDir = -this.driftDir;
        this._driftFlip = 0;
      }
    } else {
      this._driftFlip = 0;
    }
    if (this._driftRelease > T.driftReleaseGrace || this._driftSteerRelease > T.driftReleaseGrace + 0.05
      || hs < T.driftExitSpeed) {
      this._endDrift();
    }
  }

  _endDrift() {
    if (!this.drifting) return;
    this.drifting = false;
    this.events.push({ type: 'drift_end', car: this, duration: this._driftTime });
    this._gripRecover = T.gripRecoverTime;
    this.driftDir = 0;
  }

  _stepDrift(dt, inp, hs) {
    const v = this.velocity;
    const dir = this.driftDir;
    const k = clamp(inp.steer * dir, -1, 1); // +1: drift yönüne tam, -1: karşı direksiyon
    const angleTarget = k >= 0
      ? lerp(T.driftAngleMid, T.driftAngleMax, k)
      : lerp(T.driftAngleMid, T.driftAngleMin, -k);
    const pr = T.driftPathRate;
    let pathRate = k >= 0 ? lerp(pr[1], pr[2], k) : lerp(pr[1], pr[0], -k);
    pathRate = Math.min(pathRate, hs / T.driftMinRadius);

    let th = Math.atan2(v.x, v.z);
    th = wrapAngle(th - dir * pathRate * dt);

    // Hız: drift hafif yavaşlatır; nitro drift sırasında da iter.
    const ang = Math.abs(wrapAngle(th - this.yaw));
    let a = -(T.driftDecelBase + T.driftDecelAngle * (ang / T.driftAngleMax));
    if (this.nitroActive) {
      const n = NITRO_LEVELS[this.nitroLevel];
      const vmax = this._currentMaxSpeed();
      if (hs < vmax) a += (T.accel + n.thrust) * 0.8 * (1 - (hs / vmax) ** T.accelExponent);
    }
    a -= T.slopeGravity * this._slope * 0.5;
    const sp = Math.max(0, hs + a * dt);
    this._accelLong = lerp(this._accelLong, a, damp(8, dt));

    // Gövde hedef açıya yaylanır (arka savrulur).
    const yawPrev = this.yaw;
    const targetYaw = th - dir * angleTarget;
    this.yaw = wrapAngle(this.yaw + wrapAngle(targetYaw - this.yaw) * damp(T.driftSwing, dt));
    this.yawRate = wrapAngle(this.yaw - yawPrev) / dt;
    this.driftAngle = Math.abs(wrapAngle(th - this.yaw));

    v.x = Math.sin(th) * sp;
    v.z = Math.cos(th) * sp;
  }

  // --- Hava ----------------------------------------------------------------------------------

  _stepAir(dt, inp) {
    const v = this.velocity;
    const hs = Math.hypot(v.x, v.z);
    // Havada sınırlı yaw; hız vektörü değişmez → inişte tutuş hizalar.
    const maxRate = Math.min(hs / T.minTurnRadius, T.yawRateHigh) * T.airSteer;
    const target = -inp.steer * maxRate;
    this.yawRate += (target - this.yawRate) * damp(6, dt);
    this.yaw = wrapAngle(this.yaw + this.yawRate * dt);

    let a = -0.6; // hava sürüklemesi
    if (this.nitroActive) {
      const n = NITRO_LEVELS[this.nitroLevel];
      const vmax = this._currentMaxSpeed();
      if (hs < vmax) a += (T.accel + n.thrust) * 0.5 * (1 - (hs / vmax) ** T.accelExponent);
    }
    if (hs > 0.1) {
      const k = Math.max(0, hs + a * dt) / hs;
      v.x *= k;
      v.z *= k;
    }
    this._accelLong = lerp(this._accelLong, a, damp(4, dt));
  }

  // --- Yol yüzeyi, kalkış, iniş --------------------------------------------------------------

  _followSurface(dt, track, inp) {
    const g = T.gravity;
    const v = this.velocity;
    const h = track.heightAt(this.trackS, this.lateral);
    this._groundY = h;
    const y = this.position.y;

    if (this._snapGround) {
      this._snapGround = false;
      this.position.y = h;
      v.y = 0;
      return;
    }

    if (!this._inAir) {
      const yFree = y + v.y * dt - 0.5 * g * dt * dt;
      if (yFree > h + T.liftEpsilon) {
        this._takeoff(track, inp);
        v.y -= g * dt;
        this.position.y = yFree;
        return;
      }
      // Yolu takip et; ani basamaklar (rampa yanı) dikey hız üretmez.
      const run = Math.hypot(v.x, v.z) * dt;
      const rise = h - y;
      if (run > 1e-4 && rise / run > 0.7) v.y = 0;
      else v.y = clamp(rise / dt, -40, 40);
      this.position.y = h;
      return;
    }

    // Havada
    this.airTime += dt;
    v.y -= g * dt;
    this.position.y = y + v.y * dt;
    if (!this._jumpEmitted && this.airTime >= T.jumpEventMinAir) {
      this._jumpEmitted = true;
      this.airborne = true;
      if (this.drifting) this._endDrift();
      this.events.push({ type: 'jump', car: this });
    }
    this._updateTrick(dt);
    if (this.position.y <= h) this._land(track, h);
  }

  _takeoff(track, inp) {
    this._inAir = true;
    this.airTime = 0;
    this._jumpEmitted = false;
    const ramp = this._launchRamp(track);
    if (!ramp) return; // küçük tümsek: drift ve tutuş kısa süre devam eder (coyote time)
    const wasDrifting = this.drifting;
    if (this.drifting) this._endDrift();

    this._jumpEmitted = true;
    this.airborne = true;
    this.events.push({ type: 'jump', car: this });
    const flight = this._estimateFlightTime(track);
    if (flight < 0.45) return;
    const dur = Math.max(0.42, flight * 0.82);
    if (wasDrifting) {
      this._trick = 'spin';
      this._trickDir = this._lastDriftDir || 1;
      this.events.push({ type: 'flat_spin', car: this });
    } else if (ramp.type === 'roll') {
      this._trick = 'roll';
      const center = (ramp.latMin + ramp.latMax) / 2;
      this._trickDir = Math.abs(inp.steer) > 0.2 ? Math.sign(inp.steer) : (center >= 0 ? -1 : 1);
      this.events.push({ type: 'barrel_roll', car: this });
    } else {
      return;
    }
    this._trickTime = 0;
    this._trickDuration = dur;
  }

  // Kalkış anında altındaki rampa: rampanın ikinci yarısı ile dudağın birkaç metre ötesi arası.
  _launchRamp(track) {
    return this._rampNear(track, this.trackS, this.lateral, 0.5, 4, 0.6);
  }

  // s, rampanın [s0 + len·fromFrac - 0, s1 + after] aralığında mı? fromFrac negatifse s0'dan önce
  // |fromFrac| metre de kabul edilir.
  _rampNear(track, s, lat, fromFrac, after, latPad) {
    const ramps = track.ramps;
    if (!ramps || !ramps.length) return null;
    const L = track.length || 0;
    for (const r of ramps) {
      if (lat < r.latMin - latPad || lat > r.latMax + latPad) continue;
      const len = r.s1 - r.s0;
      const from = fromFrac >= 0 ? len * fromFrac : fromFrac;
      let d = s - r.s0;
      if (L > 0) {
        d = ((d % L) + L) % L;
        if (d > L / 2) d -= L;
      }
      if (d >= from && d <= len + after) return r;
    }
    return null;
  }

  _estimateFlightTime(track) {
    const v = this.velocity;
    const g = T.gravity;
    const hs = Math.hypot(v.x, v.z);
    let t = 0.8;
    for (let i = 0; i < 4; i++) {
      const land = track.heightAt(wrapS(track, this.trackS + hs * t), this.lateral);
      const dy = this.position.y - land;
      const disc = v.y * v.y + 2 * g * dy;
      if (disc <= 0) return 0;
      t = (v.y + Math.sqrt(disc)) / g;
    }
    return t;
  }

  _land(track, h) {
    const v = this.velocity;
    const hs = Math.hypot(v.x, v.z);
    // İniş noktasındaki yol eğimi (hız yönünde).
    let roadVy = 0;
    if (hs > 1) {
      const sinH = v.x / hs;
      const cosH = v.z / hs;
      const smp = this._sample;
      const ds = sinH * smp.tx + cosH * smp.tz;
      const dl = sinH * smp.rx + cosH * smp.rz;
      const ahead = track.heightAt(wrapS(track, this.trackS + ds * 1.5), this.lateral + dl * 1.5);
      roadVy = clamp((ahead - h) / 1.5, -0.8, 0.8) * hs;
    }
    const impact = Math.max(0, roadVy - v.y);
    const hard = impact > T.hardLandingSpeed;
    if (this._jumpEmitted) {
      this.events.push({ type: 'land', car: this, airTime: this.airTime, hard });
    }
    if (hard) {
      v.x *= 0.97;
      v.z *= 0.97;
    }
    this._suspVel -= Math.min(impact, 20) * 0.09;
    v.y = roadVy;
    this.position.y = h;
    this._inAir = false;
    this.airborne = false;
    this._jumpEmitted = false;
    this.airTime = 0;
    this._trick = null;
    this._trickTime = 0;
  }

  _updateTrick(dt) {
    if (!this._trick) return;
    this._trickTime += dt;
    if (this._trickTime >= this._trickDuration) {
      this._trick = null;
    }
  }

  // --- Bariyer -------------------------------------------------------------------------------

  _collideWalls(dt, track, pr) {
    const smp = this._readSample(track, pr.s);
    const halfRoad = smp.width / 2;
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    // Araba açılıysa köşesi duvara daha erken değer.
    const across = Math.abs(sinY * smp.rx + cosY * smp.rz);
    const ext = this.halfWidth + this.halfLength * across * 0.55;
    const limit = halfRoad - ext;
    const lat = pr.lateral;
    if (Math.abs(lat) <= limit) return;

    const side = lat > 0 ? 1 : -1;
    const pen = Math.abs(lat) - limit;
    this.position.x -= smp.rx * side * pen;
    this.position.z -= smp.rz * side * pen;
    this.lateral = side * limit;

    const v = this.velocity;
    const hs = Math.hypot(v.x, v.z);
    const vn = (v.x * smp.rx + v.z * smp.rz) * side; // duvara doğru hız
    const vt = v.x * smp.tx + v.z * smp.tz;
    let strength = 0.06 + clamp(hs / 90, 0, 1) * 0.08; // sürtünme
    if (vn > 0) {
      const angle = Math.atan2(vn, Math.abs(vt));
      strength = Math.max(strength, clamp(vn / 22, 0, 1));
      if (!this.wrecked && !this.ghost && angle > T.wallWreckAngle && hs > T.wallWreckSpeed) {
        this._emitWallHit(1, side, smp);
        this.wreck('wall');
        v.x -= smp.rx * side * vn * 1.3;
        v.z -= smp.rz * side * vn * 1.3;
        return;
      }
      // Duvara giren bileşeni sil, hafif sek.
      const bounce = this.wrecked ? 1.4 : 1.12;
      v.x -= smp.rx * side * vn * bounce;
      v.z -= smp.rz * side * vn * bounce;
      // Darbeye orantılı hız kaybı (Coulomb sürtünmesi gibi): sıyırmada küçük, sert darbede belirgin.
      const hs2 = Math.hypot(v.x, v.z);
      if (hs2 > 0.01) {
        const dv = Math.min(hs2 * 0.4, vn * T.wallFriction + Math.max(0, vn - 3) * T.wallImpactLoss);
        const k = (hs2 - dv) / hs2;
        v.x *= k;
        v.z *= k;
      }
      if (this.drifting && strength > 0.35) this._endDrift();
    }
    // Sürtünme kaybı (sabit) ve burnu duvara paralel hizalama (affedici).
    const hs3 = Math.hypot(v.x, v.z);
    if (hs3 > 0.01) {
      const k = Math.max(0, hs3 - T.wallScrapeDecel * dt) / hs3;
      v.x *= k;
      v.z *= k;
    }
    if (!this.wrecked && !this.drifting && !this._inAir) {
      const into = (sinY * smp.rx + cosY * smp.rz) * side;
      if (into > 0) {
        const forwardSign = sinY * smp.tx + cosY * smp.tz >= 0 ? 1 : -1;
        const tangentYaw = Math.atan2(smp.tx * forwardSign, smp.tz * forwardSign);
        this.yaw = wrapAngle(this.yaw + wrapAngle(tangentYaw - this.yaw) * damp(5, dt));
      }
    }
    this._emitWallHit(strength, side, smp);
  }

  _emitWallHit(strength, side, smp) {
    if (this._wallCooldown > 0) return;
    this._wallCooldown = T.wallEventInterval;
    const point = new THREE.Vector3(
      this.position.x + smp.rx * side * this.halfWidth,
      this.position.y + 0.5,
      this.position.z + smp.rz * side * this.halfWidth,
    );
    this.events.push({ type: 'wall_hit', car: this, strength: clamp(strength, 0, 1), point, side });
  }

  // Track.sample sonucunu yatay birim vektörler olarak önbelleğe alır (tahsis yok).
  _readSample(track, s) {
    const smp = track.sample(s);
    const c = this._sample;
    let tx = smp.tangent.x;
    let tz = smp.tangent.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    c.tx = tx;
    c.tz = tz;
    c.rx = -tz; // right = tangent × up
    c.rz = tx;
    c.width = smp.width || track.width || 20;
    c.px = smp.pos.x;
    c.py = smp.pos.y;
    c.pz = smp.pos.z;
    return c;
  }

  // --- Wreck / respawn -----------------------------------------------------------------------

  _updateWreck(dt, track) {
    this._wreckTimer -= dt;
    const v = this.velocity;
    const g = T.gravity;
    v.y -= g * dt;
    this.position.x += v.x * dt;
    this.position.z += v.z * dt;
    this.position.y += v.y * dt;
    const pr = this._project(track);
    this._collideWalls(dt, track, pr);
    const h = track.heightAt(this.trackS, this.lateral);
    this._groundY = h;
    const w = this._wreckSpin;
    if (this.position.y <= h) {
      this.position.y = h;
      if (v.y < -2.5) {
        v.y = -v.y * 0.35;
        w.x *= 0.7;
        w.y *= 0.75;
        w.z *= 0.7;
        this._suspVel -= 0.3;
      } else {
        v.y = 0;
      }
      const hs = Math.hypot(v.x, v.z);
      if (hs > 0.01) {
        const k = Math.max(0, hs - 9 * dt) / hs;
        v.x *= k;
        v.z *= k;
      }
      const kd = Math.exp(-2.2 * dt);
      w.x *= kd;
      w.y *= kd;
      w.z *= kd;
    }
    const r = this._wreckRot;
    r.x += w.x * dt;
    r.y += w.y * dt;
    r.z += w.z * dt;
    this.yawRate = 0;
    if (this._wreckTimer <= 0) this._respawn(track);
  }

  _respawn(track) {
    const L = track.length || 1;
    let s = this.trackS + T.respawnAhead;
    // Rampaların üstüne / hemen önüne bırakma.
    for (let i = 0; i < 4; i++) {
      const r = this._rampNear(track, ((s % L) + L) % L, this.lateral, -8, 12, 50);
      if (!r) break;
      s = r.s1 + 14;
    }
    s = ((s % L) + L) % L;
    const smp = this._readSample(track, s);
    const lat = clamp(this.lateral, -smp.width / 4, smp.width / 4);
    this.position.set(smp.px + smp.rx * lat, 0, smp.pz + smp.rz * lat);
    this.position.y = track.heightAt(s, lat);
    this.yaw = Math.atan2(smp.tx, smp.tz);
    const sp = T.maxSpeed * T.respawnSpeedFactor;
    this.velocity.set(Math.sin(this.yaw) * sp, 0, Math.cos(this.yaw) * sp);
    this.trackS = s;
    this.lateral = lat;
    this.wrecked = false;
    this._inAir = false;
    this.airborne = false;
    this.airTime = 0;
    this.yawRate = 0;
    this.ghost = true;
    this._ghostTimer = T.ghostDuration;
    this._prevNitroIn = true; // basılı tutulan nitro hemen ateşlenmesin
    this._resetVisual();
    this.events.push({ type: 'respawn', car: this });
  }

  // -------------------------------------------------------------------------------------------
  // Görsel güncelleme
  // -------------------------------------------------------------------------------------------

  _updateVisual(dt, track) {
    const P = this.parts;
    const v = this.velocity;
    const hs = Math.hypot(v.x, v.z);
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const smp = this._sample;

    // Zemin çerçevesi: yol eğimi (aks noktalarından örnekle).
    let pitchT;
    let rollT;
    let rate;
    if (!this._inAir && !this.wrecked) {
      const a = (D.frontAxleZ - D.rearAxleZ) / 2;
      const fs = sinY * smp.tx + cosY * smp.tz; // ileri vektörün pist bileşenleri
      const fl = sinY * smp.rx + cosY * smp.rz;
      const s = this.trackS;
      const l = this.lateral;
      const hF = track.heightAt(wrapS(track, s + fs * a), l + fl * a);
      const hB = track.heightAt(wrapS(track, s - fs * a), l - fl * a);
      const w = 0.85;
      // Arabanın sağı: (-cos, sin) → pist bileşenleri
      const rs = -cosY * smp.tx + sinY * smp.tz;
      const rl = -cosY * smp.rx + sinY * smp.rz;
      const hR = track.heightAt(wrapS(track, s + rs * w), l + rl * w);
      const hL = track.heightAt(wrapS(track, s - rs * w), l - rl * w);
      pitchT = Math.atan2(hF - hB, 2 * a);
      rollT = Math.atan2(hL - hR, 2 * w);
      this._slope = clamp((hF - hB) / (2 * a), -1, 1);
      rate = 20;
    } else if (this.wrecked) {
      pitchT = 0;
      rollT = 0;
      rate = 3;
    } else {
      // Havada burun yörüngeyi hafifçe izler.
      pitchT = Math.atan2(v.y, Math.max(hs, 5)) * 0.55;
      rollT = 0;
      rate = 2.6;
    }
    this._pitch += (pitchT - this._pitch) * damp(rate, dt);
    this._roll += (rollT - this._roll) * damp(rate, dt);
    this.mesh.rotation.set(-this._pitch, this.yaw, this._roll);

    // Süspansiyon (yay-sönümleyici): iniş darbesi, yol titreşimi.
    const k = 160;
    const c = 13;
    this._suspVel += (-k * this._suspY - c * this._suspVel) * dt;
    this._suspY += this._suspVel * dt;
    this._suspY = clamp(this._suspY, -0.12, 0.1);
    const vib = this._inAir ? 0 : Math.sin(this._time * 37) * Math.min(hs, 90) * 0.00005;
    const droop = this._inAir && !this.wrecked ? 0.05 : 0;
    this._droop += (droop - this._droop) * damp(8, dt);
    P.chassis.position.y = this._suspY + vib + this._droop;

    // Gövde yatışı (merkezkaç) ve dalış/kalkış (boyuna ivme).
    const latAcc = this.yawRate * hs;
    const leanT = this._inAir ? 0 : clamp(latAcc * (this.drifting ? 0.0028 : 0.0021), -0.075, 0.075);
    this._lean += (leanT - this._lean) * damp(7, dt);
    const diveT = this._inAir ? 0 : clamp(-this._accelLong * 0.0032, -0.04, 0.055);
    this._dive += (diveT - this._dive) * damp(7, dt);
    P.chassis.rotation.set(this._dive, 0, this._lean);

    // Tekerlekler: dönüş + ön direksiyon (drift'te karşı direksiyon görünümü).
    const fwdSpeed = v.x * sinY + v.z * cosY;
    const spin = (fwdSpeed / D.wheelRadius) * dt;
    this._wheelSpin = (this._wheelSpin + spin) % (Math.PI * 2);
    const rearSpin = this.drifting ? spin * 1.25 : spin;
    this._rearSpin = (this._rearSpin + rearSpin) % (Math.PI * 2);
    P.frontWheels[0].rotation.x = this._wheelSpin;
    P.frontWheels[1].rotation.x = this._wheelSpin;
    P.rearAxle.rotation.x = this._rearSpin;
    let steerVis;
    if (this.drifting) {
      const velYaw = Math.atan2(v.x, v.z);
      steerVis = clamp(wrapAngle(velYaw - this.yaw), -0.55, 0.55);
    } else {
      const maxA = lerp(0.55, 0.12, clamp(hs / T.maxSpeed, 0, 1));
      steerVis = -this._inp.steer * maxA;
    }
    if (this.wrecked) steerVis = this._steerVis;
    this._steerVis += (steerVis - this._steerVis) * damp(14, dt);
    P.frontPivots[0].rotation.y = this._steerVis;
    P.frontPivots[1].rotation.y = this._steerVis;

    // Görsel numaralar: takla (ileri eksen), flat spin (Y), wreck takla.
    const vis = P.visual;
    if (this.wrecked) {
      const r = this._wreckRot;
      vis.rotation.set(r.x, r.y, r.z);
      vis.position.y = D.pivotY + 0.35 * Math.abs(Math.sin(r.z)) + 0.25 * Math.abs(Math.sin(r.x));
    } else if (this._trick) {
      const p = easeInOut(clamp(this._trickTime / this._trickDuration, 0, 1));
      const ang = p * Math.PI * 2 * this._trickDir;
      if (this._trick === 'roll') vis.rotation.set(0, 0, -ang);
      else vis.rotation.set(0, -ang, 0);
      vis.position.y = D.pivotY + (this._trick === 'roll' ? 0.25 * Math.sin(p * Math.PI) : 0);
    } else {
      vis.rotation.set(0, 0, 0);
      vis.position.y = D.pivotY;
    }
    if (this.drifting) this._lastDriftDir = this.driftDir;

    // Ghost: yanıp sönme.
    vis.visible = !this.ghost || Math.floor(this._ghostTimer * 12) % 3 !== 0;

    // Stop lambaları
    const braking = !this.wrecked && (this.drifting || (this._inp.brake > 0.1 && fwdSpeed > 1));
    if (braking !== this._braking) {
      this._braking = braking;
      P.setBraking(braking);
    }

    // Temas gölgesi yolda kalır.
    if (P.shadow) {
      const sh = P.shadow;
      const hAbove = this.position.y - this._groundY;
      sh.visible = hAbove < 14;
      sh.position.set(this.position.x, this._groundY + 0.03, this.position.z);
      const groundPitch = this._inAir ? 0 : this._pitch;
      const groundRoll = this._inAir ? 0 : this._roll;
      sh.rotation.set(-groundPitch, this.yaw, groundRoll);
      sh.scale.setScalar(1 / (1 + Math.max(0, hAbove) * 0.12));
    }

    this.mesh.updateMatrixWorld(true);
  }

  // -------------------------------------------------------------------------------------------
  // İç durum
  // -------------------------------------------------------------------------------------------

  _resetState() {
    this._time = this._time || 0;
    this._speedOut = 0;
    this._inp = this._inp || { throttle: 0, brake: 0, steer: 0, nitro: false, drift: false };
    this._prevNitroIn = false;
    this._burstTime = 0;
    this._burstDuration = 1;
    this._burstDrain = 0;
    this._burstFull = false;
    this._driftTime = 0;
    this._driftRelease = 0;
    this._driftSteerRelease = 0;
    this._driftFlip = 0;
    this._lastDriftDir = 1;
    this._gripRecover = 0;
    this._inAir = false;
    this._jumpEmitted = false;
    this._trick = null;
    this._trickTime = 0;
    this._trickDuration = 1;
    this._trickDir = 1;
    this._wallCooldown = 0;
    this._wreckTimer = 0;
    this._ghostTimer = 0;
    this._wreckSpin = this._wreckSpin || new THREE.Vector3();
    this._wreckSpin.set(0, 0, 0);
    this._wreckRot = this._wreckRot || new THREE.Vector3();
    this._wreckRot.set(0, 0, 0);
    this._slope = 0;
    this._accelLong = 0;
    this._groundY = this.position ? this.position.y : 0;
    this._sample = this._sample || { tx: 0, tz: 1, rx: -1, rz: 0, width: 20, px: 0, py: 0, pz: 0 };
  }

  _resetVisual() {
    this._pitch = 0;
    this._roll = 0;
    this._suspY = 0;
    this._suspVel = 0;
    this._droop = 0;
    this._lean = 0;
    this._dive = 0;
    this._wheelSpin = this._wheelSpin || 0;
    this._rearSpin = this._rearSpin || 0;
    this._steerVis = 0;
    this._braking = false;
    this._trick = null;
    this._wreckRot.set(0, 0, 0);
    this._wreckSpin.set(0, 0, 0);
    const P = this.parts;
    P.visual.rotation.set(0, 0, 0);
    P.visual.position.y = D.pivotY;
    P.visual.visible = true;
    P.chassis.position.y = 0;
    P.chassis.rotation.set(0, 0, 0);
    P.setBraking(false);
  }
}
