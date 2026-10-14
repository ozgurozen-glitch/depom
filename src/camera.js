// ChaseCamera: Asphalt tarzı takip kamerası ve görünümler.
//
// Dış görünümler (chase, far) kamerayı arabaya göre bir ofset olarak hesaplar; ofsetin yönü, mesafesi
// ve yüksekliği yaylı/sönümlü izlenir. İç görünümler (hood, bumper) kamerayı aracın yerel çapasına
// bağlar (gövdenin konumu, yaw'ı ve eğimi dahil). Görünüm değişimleri ofsetler arasında yumuşak
// karışımla yapılır. Menu, countdown, finish modlarında ve wreck sırasında her zaman dış kamera
// davranışı kullanılır; seçilen görünüm korunur ve yarışa dönünce geri gelir.
// Kamera hiçbir zaman yol yüzeyinin altına inmez (constrainToTrack).
import * as THREE from 'three';

const BASE_FOV = 62;
const SPEED_FOV = 18; // taban azami hızda +18 → ~80
const NITRO_FOV = { normal: 8, perfect: 9, shockwave: 11 };
const REF_SPEED = 290 / 3.6;

const RACE = {
  distance: 6.0,
  distanceSpeed: 0.7, // azami hızda ek geri mesafe
  nitroPull: 0.9, // nitroda araba kameradan "kaçar"
  height: 1.95,
  lookAhead: 3.2,
  lookHeight: 0.95,
  yawRate: 5.5,
  yawRateDrift: 3.2,
  yawRateAir: 2.4,
  heightRate: 7,
  heightRateAir: 3,
  maxAboveRoad: 2.9, // tünel tavanına girmemek için
  minAboveRoad: 0.75,
};

// Görünüm sırası (cycleView bu sırayla döner).
const VIEWS = ['chase', 'far', 'hood', 'bumper'];
const VIEW_BLEND = 0.45; // görünüm değişiminde yumuşak geçiş süresi (s)

// Dış görünüm çarpanları: far, chase'den ~1.5 kat uzak ve ~1.4 kat yüksek.
const CHASE_CFG = { dist: 1, height: 1 };
const FAR_CFG = { dist: 1.5, height: 1.4 };

// İç görünüm çapaları araç yerel koordinatındadır (+Z ileri, Y yukarı); Car.viewAnchors varsa onlar kullanılır.
const DEFAULT_ANCHORS = {
  hood: new THREE.Vector3(0, 1.12, 0.35),
  bumper: new THREE.Vector3(0, 0.55, 2.35),
};
const POV = {
  hood: { fov: 75, fovSpeed: 20 }, // hızla ~95
  bumper: { fov: 80, fovSpeed: 20 }, // hızla ~100
};
const POV_NITRO_FOV = 6;
const POV_LOOK_DIST = 30; // bakış hedefi: araç ileri yönünde (m)
const POV_SMOOTH = 30; // konum/bakış yumuşatma oranı (1/s); yalnızca titreşimi keser
const POV_SHAKE = 0.4; // iç görünümde sarsıntı çarpanı
const POV_MIN_ABOVE_ROAD = 0.3; // bumper çapası origin'in ~0.55 m üstünde; 0.75'e zorlanmasın

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _desiredOff = new THREE.Vector3();
const _desiredLook = new THREE.Vector3();
const _carPos = new THREE.Vector3();
const _anchorW = new THREE.Vector3();
const _lookW = new THREE.Vector3();
const _fwdW = new THREE.Vector3();
const _anchorOff = new THREE.Vector3();
const _lookOff = new THREE.Vector3();

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const wrapAngle = (a) => {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'race';
    this.modeTime = 0;
    this.initialized = false;

    // Arabaya göre ofsetler (dünya eksenleri)
    this.offset = new THREE.Vector3(0, RACE.height, -RACE.distance);
    this.lookOffset = new THREE.Vector3(0, RACE.lookHeight, RACE.lookAhead);
    this.lastCarPos = new THREE.Vector3();

    // Mod geçişi karışımı
    this.blendFrom = new THREE.Vector3();
    this.blendLookFrom = new THREE.Vector3();
    this.blendT = 1;
    this.blendDur = 0;

    // Yarış kamerası iç durumu
    this.camYaw = 0;
    this.dist = RACE.distance;
    this.camY = 0; // mutlak yükseklik (yumuşak)
    this.lookY = 0;
    this.roll = 0;
    this.fov = camera.fov;
    this.orbitStart = 0;

    // Wreck
    this.wreckActive = false;
    this.wreckPos = new THREE.Vector3();
    this.wreckVel = new THREE.Vector3();
    this.wreckLook = new THREE.Vector3();

    this.posValid = false;

    // Görünüm (chase | far | hood | bumper)
    this.view = 'chase';
    this.lastCar = null;
    this.carViewCar = null; // Car.setViewMode'a en son hangi araç/görünüm için bildirildi
    this.carViewApplied = null;
    this.povOff = new THREE.Vector3(); // iç görünüm: yumuşatılmış ofset (arabaya göre konum)
    this.povLookOff = new THREE.Vector3();
    this.povValid = false;
    this.extOffset = new THREE.Vector3(); // iç görünümdeyken dış (chase) kameranın son ofseti
    this.extValid = false;

    // Sarsıntı
    this.trauma = 0;
    this.time = 0;
  }

  setMode(mode) {
    if (this.initialized) {
      // Mevcut kamera pozundan yeni moda yumuşak geçiş.
      this.blendFrom.copy(this.offset);
      this.blendLookFrom.copy(this.lookOffset);
      this.blendT = 0;
      this.blendDur = mode === 'race' && this.mode === 'countdown' ? 0.35 : 0.9;
    }
    if (mode === 'finish' || mode === 'menu') this.orbitStart = this.mode === 'race' ? Math.PI * 0.05 : 0.6;
    this.mode = mode;
    this.modeTime = 0;
  }

  // --- Görünüm ---------------------------------------------------------------------------------

  setView(view) {
    if (!VIEWS.includes(view) || view === this.view) return;
    this.view = view;
    this.povValid = false;
    if (this.initialized && this.mode === 'race') {
      this.blendFrom.copy(this.offset);
      this.blendLookFrom.copy(this.lookOffset);
      this.blendT = 0;
      this.blendDur = VIEW_BLEND;
    }
    this.syncCarView(this.lastCar);
  }

  // Sıra: chase → far → hood → bumper → chase. Yeni görünümü döndürür.
  cycleView() {
    const i = VIEWS.indexOf(this.view);
    this.setView(VIEWS[(i + 1) % VIEWS.length]);
    return this.view;
  }

  isPovView() {
    return this.view === 'hood' || this.view === 'bumper';
  }

  // İç görünüm yalnızca yarışta ve araba sağlamken etkindir; diğer durumlarda dış kamera kullanılır.
  povActive(car) {
    return this.isPovView() && this.mode === 'race' && !!car && !car.wrecked;
  }

  // Gövdenin kameraya giren parçalarını yalnızca iç görünüm gerçekten etkinken gizletir.
  syncCarView(car) {
    if (!car) return;
    const eff = this.povActive(car) ? this.view : 'chase';
    if (car === this.carViewCar && eff === this.carViewApplied) return;
    this.carViewCar = car;
    this.carViewApplied = eff;
    if (typeof car.setViewMode === 'function') car.setViewMode(eff);
  }

  shake(intensity) {
    this.trauma = clamp(Math.max(this.trauma, intensity || 0), 0, 1);
  }

  update(dt, car, track) {
    if (!car) return;
    dt = Math.max(0, Math.min(dt || 0, 0.1));
    this.time += dt;
    this.modeTime += dt;
    _carPos.copy(car.position);
    this.lastCar = car;
    this.syncCarView(car);
    if (!this.povActive(car)) this.povValid = false;

    if (!this.initialized) {
      this.camYaw = car.yaw;
      this.camY = _carPos.y + RACE.height;
      this.lookY = _carPos.y + RACE.lookHeight;
      this.initialized = true;
      this.blendT = 1;
    }

    // Wreck: takibi bırak, takla atan arabayı izle.
    if (this.mode === 'race' && car.wrecked) {
      this.updateWreck(dt, car, track);
      this.lastCarPos.copy(_carPos);
      return;
    }
    if (this.wreckActive) {
      // Respawn: mevcut konumdan takip pozuna süzül.
      this.wreckActive = false;
      this.offset.copy(this.wreckPos).sub(_carPos);
      this.lookOffset.copy(this.wreckLook).sub(_carPos);
      this.blendFrom.copy(this.offset);
      this.blendLookFrom.copy(this.lookOffset);
      this.blendT = 0;
      this.blendDur = 0.8;
      this.camYaw = car.yaw;
      this.camY = _carPos.y + RACE.height;
      this.lookY = _carPos.y + RACE.lookHeight;
    }

    let fovTarget;
    switch (this.mode) {
      case 'menu':
        fovTarget = this.computeOrbit(dt, car, { radius: 5.8, height: 1.0, look: 0.55, speed: 0.16, start: this.orbitStart });
        break;
      case 'countdown':
        fovTarget = this.computeCountdown(dt, car);
        break;
      case 'finish':
        fovTarget = this.computeOrbit(dt, car, { radius: 7.2, height: 1.5, look: 0.6, speed: 0.22, start: this.orbitStart });
        break;
      default:
        fovTarget = this.isPovView() ? this.computePov(dt, car) : this.computeRace(dt, car, track);
        break;
    }

    // Mod geçişi karışımı
    if (this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + (this.blendDur > 0 ? dt / this.blendDur : 1));
      const k = easeInOutCubic(this.blendT);
      _desiredOff.lerpVectors(this.blendFrom, _desiredOff, k);
      _desiredLook.lerpVectors(this.blendLookFrom, _desiredLook, k);
    }
    this.offset.copy(_desiredOff);
    this.lookOffset.copy(_desiredLook);

    const pos = _v1.copy(_carPos).add(this.offset);
    this.constrainToTrack(pos, car, track, this.povActive(car) ? POV_MIN_ABOVE_ROAD : RACE.minAboveRoad);
    const look = _v2.copy(_carPos).add(this.lookOffset);

    // FOV
    this.fov += (fovTarget - this.fov) * damp(2.6, dt);
    this.applyPose(pos, look, dt, car);
    this.lastCarPos.copy(_carPos);
  }

  // --- Modlar --------------------------------------------------------------------------------

  // Dış yarış kamerası (chase veya far). cfg: mesafe ve yükseklik çarpanları.
  computeRace(dt, car, track, cfg = this.view === 'far' ? FAR_CFG : CHASE_CFG) {
    const v = car.velocity;
    const hs = Math.hypot(v.x, v.z);
    const sf = clamp(hs / REF_SPEED, 0, 1.4);

    // Kamera yönü: normalde gövdeyi, drift'te hız vektörünü izler (arabanın yan açısı görünsün).
    let heading = car.yaw;
    if (hs > 4 && car.speed > -1) {
      const velYaw = Math.atan2(v.x, v.z);
      const w = car.drifting ? 0.62 : 0.25;
      heading = car.yaw + wrapAngle(velYaw - car.yaw) * w;
    }
    const rate = car.airborne ? RACE.yawRateAir : car.drifting ? RACE.yawRateDrift : RACE.yawRate;
    this.camYaw = wrapAngle(this.camYaw + wrapAngle(heading - this.camYaw) * damp(rate, dt));

    const nitroPull = car.nitroActive ? RACE.nitroPull * cfg.dist * (car.nitroLevel === 'shockwave' ? 1.4 : 1) : 0;
    const distTarget = (RACE.distance + RACE.distanceSpeed * Math.min(sf, 1)) * cfg.dist + nitroPull;
    this.dist += (distTarget - this.dist) * damp(car.nitroActive ? 2.2 : 3, dt);

    // Yükseklik: havada yumuşak (süzülme hissi), yerde daha sıkı.
    const hRate = car.airborne ? RACE.heightRateAir : RACE.heightRate;
    this.camY += (_carPos.y + RACE.height * cfg.height - this.camY) * damp(hRate, dt);
    this.lookY += (_carPos.y + RACE.lookHeight - this.lookY) * damp(car.airborne ? 6 : 12, dt);
    // Araba kameradan çok uzaklaşmasın (uzun düşüşler).
    this.camY = clamp(this.camY, _carPos.y + 0.6, _carPos.y + 5);

    const sy = Math.sin(this.camYaw);
    const cy = Math.cos(this.camYaw);
    _desiredOff.set(-sy * this.dist, this.camY - _carPos.y, -cy * this.dist);
    _desiredLook.set(sy * RACE.lookAhead, this.lookY - _carPos.y, cy * RACE.lookAhead);

    // Virajda hafif yatış.
    const rollT = clamp(-(car.yawRate || 0) * (car.drifting ? 0.045 : 0.03), -0.06, 0.06);
    this.roll += (rollT - this.roll) * damp(4, dt);

    let fov = BASE_FOV + SPEED_FOV * Math.min(1.25, sf) ** 1.3;
    if (car.nitroActive) fov += NITRO_FOV[car.nitroLevel] || 8;
    return fov;
  }

  // İç görünüm (hood, bumper): kamera araç çapasına bağlıdır, bakış hedefi araç ileri yönündedir.
  computePov(dt, car) {
    const view = this.view;
    const spec = POV[view];

    // Dış (chase) kameranın iç durumu (yön, mesafe, yükseklik) güncel kalsın; dışa dönünce sıçrama olmasın.
    this.computeRace(dt, car, null, CHASE_CFG);
    this.extOffset.copy(_desiredOff);
    this.extValid = true;

    // Çapa → dünya: gövdenin konumu, yaw'ı ve eğimi dahil. Ofsetler arabaya göre tutulur; böylece
    // öteleme gecikmesiz izlenir (dünya konumunu yumuşatmak yüksek hızda kamerayı arkaya bırakırdı),
    // yumuşatma yalnızca dönüş/eğim titreşimini keser.
    const mw = car.mesh.matrixWorld;
    const anchor = (car.viewAnchors && car.viewAnchors[view]) || DEFAULT_ANCHORS[view];
    _anchorW.copy(anchor).applyMatrix4(mw);
    _fwdW.set(0, 0, 1).transformDirection(mw);
    _lookW.copy(_fwdW).multiplyScalar(POV_LOOK_DIST).add(_anchorW);
    _anchorOff.copy(_anchorW).sub(_carPos);
    _lookOff.copy(_lookW).sub(_carPos);

    if (this.povValid) {
      const k = damp(POV_SMOOTH, dt);
      this.povOff.lerp(_anchorOff, k);
      this.povLookOff.lerp(_lookOff, k);
    } else {
      this.povOff.copy(_anchorOff);
      this.povLookOff.copy(_lookOff);
      this.povValid = true;
    }
    _desiredOff.copy(this.povOff);
    _desiredLook.copy(this.povLookOff);

    const hs = Math.hypot(car.velocity.x, car.velocity.z);
    const sf = Math.min(1, hs / REF_SPEED);
    let fov = spec.fov + spec.fovSpeed * sf ** 0.7;
    if (car.nitroActive) fov += POV_NITRO_FOV;
    return fov;
  }

  computeCountdown(dt, car) {
    // 3 sn: önden-yandan arkaya süzülme.
    const t = clamp(this.modeTime / 2.9, 0, 1);
    const k = easeInOutCubic(t);
    const ang = (1 - k) * 2.55; // 0 = tam arkada; + arabanın soluna doğru
    const radius = 7.2 + (RACE.distance - 7.2) * k;
    const height = 0.9 + (RACE.height - 0.9) * k;
    const back = car.yaw + Math.PI + ang;
    _desiredOff.set(Math.sin(back) * radius, height, Math.cos(back) * radius);
    const la = RACE.lookAhead * k;
    _desiredLook.set(Math.sin(car.yaw) * la, 0.6 + (RACE.lookHeight - 0.6) * k, Math.cos(car.yaw) * la);
    // Yarış moduna kesintisiz devir için iç durumu güncel tut.
    this.camYaw = car.yaw;
    this.dist = RACE.distance;
    this.camY = _carPos.y + height;
    this.lookY = _carPos.y + _desiredLook.y;
    this.roll += (0 - this.roll) * damp(4, dt);
    return 56 + (BASE_FOV - 56) * k;
  }

  computeOrbit(dt, car, o) {
    const ang = car.yaw + Math.PI + o.start + this.modeTime * o.speed;
    _desiredOff.set(Math.sin(ang) * o.radius, o.height, Math.cos(ang) * o.radius);
    _desiredLook.set(0, o.look, 0);
    this.camYaw = car.yaw;
    this.camY = _carPos.y + RACE.height;
    this.lookY = _carPos.y + RACE.lookHeight;
    this.roll += (0 - this.roll) * damp(3, dt);
    return this.mode === 'menu' ? 50 : 56;
  }

  updateWreck(dt, car, track) {
    if (!this.wreckActive) {
      this.wreckActive = true;
      if (this.isPovView() && this.extValid) {
        // İç görünümden wreck: dış kamera konumundan başla (iç kamera araba içinde kalır).
        this.wreckPos.copy(_carPos).add(this.extOffset);
      } else if (!this.isPovView() && this.posValid) {
        this.wreckPos.copy(this.camera.position);
      } else {
        // Kamera henüz yerleşmemişse arabanın arkasından başla.
        this.wreckPos.set(-Math.sin(car.yaw) * RACE.distance, RACE.height, -Math.cos(car.yaw) * RACE.distance).add(_carPos);
      }
      // Kamera bir süre arabanın momentumuyla kayar, sonra durur.
      this.wreckVel.copy(car.velocity).multiplyScalar(0.55);
      this.wreckVel.y = 0;
      this.wreckLook.copy(_carPos);
      this.wreckLook.y += 0.6;
    }
    this.wreckVel.multiplyScalar(Math.exp(-2.2 * dt));
    this.wreckPos.addScaledVector(this.wreckVel, dt);
    // Araba çok uzaklaşırsa gevşekçe takip et.
    const dx = _carPos.x - this.wreckPos.x;
    const dz = _carPos.z - this.wreckPos.z;
    const d = Math.hypot(dx, dz);
    if (d > 13) {
      const k = (d - 13) * damp(3, dt) / d;
      this.wreckPos.x += dx * k;
      this.wreckPos.z += dz * k;
    }
    const yT = _carPos.y + 2.6;
    this.wreckPos.y += (yT - this.wreckPos.y) * damp(1.5, dt);
    this.constrainToTrack(this.wreckPos, car, track);
    this.wreckLook.x += (_carPos.x - this.wreckLook.x) * damp(9, dt);
    this.wreckLook.y += (_carPos.y + 0.6 - this.wreckLook.y) * damp(9, dt);
    this.wreckLook.z += (_carPos.z - this.wreckLook.z) * damp(9, dt);
    this.offset.copy(this.wreckPos).sub(_carPos);
    this.lookOffset.copy(this.wreckLook).sub(_carPos);
    this.roll += (0 - this.roll) * damp(3, dt);
    this.fov += (BASE_FOV + 4 - this.fov) * damp(2, dt);
    this.applyPose(_v1.copy(this.wreckPos), _v2.copy(this.wreckLook), dt, car);
  }

  // --- Yardımcılar ---------------------------------------------------------------------------

  // Kamerayı yolun üstünde, bariyerlerin içinde ve tünel tavanının altında tutar.
  constrainToTrack(pos, car, track, minAbove = RACE.minAboveRoad) {
    if (!track || typeof track.project !== 'function') return;
    let pr;
    try {
      pr = track.project(pos, car.trackS);
    } catch {
      return;
    }
    if (!pr || !Number.isFinite(pr.height)) return;
    const roadY = pos.y - pr.height;
    const width = track.width || 20;
    const onTrackArea = Math.abs(pr.lateral) < width / 2 + 6;
    if (onTrackArea) {
      if (pos.y < roadY + minAbove) pos.y = roadY + minAbove;
      if (this.mode === 'race' && !car.wrecked && !car.airborne && pos.y > roadY + RACE.maxAboveRoad) {
        pos.y = roadY + RACE.maxAboveRoad;
      }
    }
    if (this.mode === 'race') {
      const lim = width / 2 - 0.4;
      if (Math.abs(pr.lateral) > lim && Math.abs(pr.lateral) < width / 2 + 8) {
        const smp = track.sample(pr.s);
        const push = (Math.abs(pr.lateral) - lim) * Math.sign(pr.lateral);
        pos.x -= smp.right.x * push;
        pos.z -= smp.right.z * push;
      }
    }
  }

  applyPose(pos, look, dt, car) {
    const cam = this.camera;
    // Sarsıntı: travma² ile ölçeklenen yumuşak gürültü + yüksek hız/nitro titreşimi.
    this.trauma = Math.max(0, this.trauma - 1.5 * dt);
    const t = this.time;
    const tr = this.trauma * this.trauma;
    const hs = Math.hypot(car.velocity.x, car.velocity.z);
    let buzz = 0;
    if (this.mode === 'race' && !car.wrecked) {
      buzz = Math.max(0, (hs - 60) / 40) * 0.012 + (car.nitroActive ? 0.02 : 0);
    }
    const shakeK = this.povActive(car) ? POV_SHAKE : 1;
    const amp = (tr * 0.45 + buzz) * shakeK;
    if (amp > 0) {
      pos.x += (Math.sin(t * 31.7) + Math.sin(t * 17.3 + 1.3) * 0.6) * amp * 0.6;
      pos.y += (Math.sin(t * 27.1 + 2.1) + Math.sin(t * 13.9) * 0.5) * amp * 0.5;
      pos.z += Math.sin(t * 23.3 + 0.7) * amp * 0.4;
    }
    cam.position.copy(pos);
    this.posValid = true;
    cam.up.set(0, 1, 0);
    cam.lookAt(look);
    const shakeRoll = tr * Math.sin(t * 19.7 + 0.4) * 0.035 * shakeK;
    cam.rotateZ(this.roll + shakeRoll);

    const fov = clamp(this.fov, 35, 110);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
