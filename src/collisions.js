// CollisionSystem: araba-araba çarpışması (XZ'de yönlendirilmiş kutu, SAT), takedown ve near miss.
//
// - Nüfuz iki arabaya eşit itilerek çözülür (duvara sıkışmış arabaya daha az pay verilir); normal boyunca
//   göreli hız `applyImpulse` (dünya koordinatında hız değişimi) ile restitüsyon ~0.3 olacak şekilde değiştirilir.
// - `wrecked` / `ghost` arabalar ve dikey farkı > 1.5 m olan çiftler (biri havada) yok sayılır.
// - Takedown (Asphalt 8 kuralları), saldıran = normal yönünde kurbana doğru hız bileşeni büyük olan:
//     (a) arkadan/yandan, göreli normal hız > 7 m/s
//     (b) kurban yan temasta bariyere sıkışmışken içeriden > 4 m/s
//     (c) saldıranın nitroLevel === 'shockwave' iken her temas
//   Botların oyuncuyu devirmesi için (a) ve (b) eşikleri 1.4 kat yüksektir.
// - Çift başına bekleme: bump 0.3 s, near_miss 2 s. Sıcak yolda nesne üretilmez (yalnızca olay anında).
import * as THREE from 'three';
import { getRacingLine } from './ai/racingLine.js';

const RESTITUTION = 0.3;
const BUMP_COOLDOWN = 0.3;
const BUMP_MIN_SPEED = 1; // m/s; bundan yavaş sürtünmeler bump olayı üretmez
const NEAR_MISS_COOLDOWN = 2;
const NEAR_MISS_GAP = 1.2; // m, yanal boşluk (kenardan kenara)
const NEAR_MISS_SPEED = 10; // m/s, göreli hız
const NEAR_MISS_CONTACT_GRACE = 0.5; // s; bu süre içinde temas olduysa near miss sayılmaz
const MAX_DY = 1.5; // m
const TAKEDOWN_HIT_SPEED = 7; // m/s, kural (a)
const TAKEDOWN_PIN_SPEED = 4; // m/s, kural (b)
const BOT_VS_PLAYER_FACTOR = 1.4;
const PIN_WALL_ZONE = 1.2; // m; kurbanın kenarı duvar sınırına bu kadar yakınsa "sıkışmış"
const PIN_DIRECTION = 0.4; // itme yönünün duvara dönük bileşeni (cos)
const ATTACKER_TAKEDOWN_IMPULSE = 0.35; // takedown'da saldıranın aldığı itme oranı (hızını korusun)
const TAKEDOWN_COOLDOWN = 3; // s, aynı çift için

const EMPTY = Object.freeze([]);

export class CollisionSystem {
  constructor() {
    this.ids = new WeakMap();
    this.nextId = 0;
    this.cap = 0;
    this.time = 1; // lastContact varsayılanı 0 → başlangıçta "yakın zamanda temas" sayılmasın
    this.impulse = new THREE.Vector3();
    this.frame = { rx: 0, rz: 0, halfW: 10 };
    // temas sonucu (obb testi)
    this.nx = 0;
    this.nz = 0;
    this.depth = 0;
    this.radA = 0;
    this.ensureCapacity(16);
  }

  ensureCapacity(n) {
    if (n <= this.cap) return;
    const cap = Math.max(16, n * 2);
    const grow = (old, Type) => {
      const arr = new Type(cap * cap);
      if (old) {
        for (let i = 0; i < this.cap; i++) {
          for (let j = 0; j < this.cap; j++) arr[i * cap + j] = old[i * this.cap + j];
        }
      }
      return arr;
    };
    this.bumpUntil = grow(this.bumpUntil, Float64Array);
    this.takedownUntil = grow(this.takedownUntil, Float64Array);
    this.nearUntil = grow(this.nearUntil, Float64Array);
    this.lastContact = grow(this.lastContact, Float64Array);
    this.prevDs = grow(this.prevDs, Float64Array);
    this.prevValid = grow(this.prevValid, Uint8Array);
    this.cap = cap;
  }

  idOf(car) {
    let id = this.ids.get(car);
    if (id === undefined) {
      id = this.nextId++;
      this.ids.set(car, id);
      this.ensureCapacity(id + 1);
    }
    return id;
  }

  update(dt, cars, track) {
    this.time += dt;
    if (!cars || cars.length < 2) return EMPTY;
    const line = track ? getRacingLine(track) : null;
    const L = track && track.length > 0 ? track.length : 0;
    let events = null;
    const n = cars.length;

    for (let a = 0; a < n; a++) {
      const A = cars[a];
      if (!A) continue;
      const ia = this.idOf(A);
      for (let b = a + 1; b < n; b++) {
        const B = cars[b];
        if (!B) continue;
        const ib = this.idOf(B);
        const key = ia < ib ? ia * this.cap + ib : ib * this.cap + ia;

        if (A.wrecked || B.wrecked || A.ghost === true || B.ghost === true) {
          this.prevValid[key] = 0;
          continue;
        }
        const pa = A.position;
        const pb = B.position;
        if (Math.abs(pa.y - pb.y) > MAX_DY) {
          this.prevValid[key] = 0;
          continue;
        }
        const dx = pb.x - pa.x;
        const dz = pb.z - pa.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 400) {
          this.prevValid[key] = 0;
          continue;
        }

        if (this.overlap(A, B, dx, dz, d2)) {
          events = this.resolve(A, B, key, line, events);
          this.lastContact[key] = this.time;
          this.prevValid[key] = 0; // temas sırasında near miss izleme sıfırlanır
        } else if (L > 0) {
          events = this.trackNearMiss(A, B, key, L, events);
        }
      }
    }
    return events || EMPTY;
  }

  // XZ'de iki yönlendirilmiş kutu için ayırma ekseni testi (SAT). Temas varsa en küçük nüfuz ekseni
  // (A'dan B'ye normal) ve derinliği this.nx/nz/depth'e yazılır.
  overlap(A, B, dx, dz, d2) {
    const hlA = A.halfLength;
    const hwA = A.halfWidth;
    const hlB = B.halfLength;
    const hwB = B.halfWidth;
    if (!(hlA > 0 && hwA > 0 && hlB > 0 && hwB > 0)) {
      // kutu boyutları yoksa daire
      const rA = A.radius > 0 ? A.radius : 2.2;
      const rB = B.radius > 0 ? B.radius : 2.2;
      const rr = rA + rB;
      if (d2 >= rr * rr) return false;
      const d = Math.sqrt(d2);
      if (d > 1e-6) {
        this.nx = dx / d;
        this.nz = dz / d;
      } else {
        this.nx = Math.sin(A.yaw) || 1;
        this.nz = Math.cos(A.yaw) || 0;
      }
      this.depth = rr - d;
      this.radA = rA;
      return true;
    }
    const bA = hlA * hlA + hwA * hwA;
    const bB = hlB * hlB + hwB * hwB;
    const br = Math.sqrt(bA) + Math.sqrt(bB);
    if (d2 >= br * br) return false;

    const fax = Math.sin(A.yaw);
    const faz = Math.cos(A.yaw);
    const fbx = Math.sin(B.yaw);
    const fbz = Math.cos(B.yaw);
    // eksenler: A ileri, A sağ, B ileri, B sağ  (sağ = (-cos, sin) = (-fz, fx))
    let best = Infinity;
    let bnx = 0;
    let bnz = 0;
    let bra = 0;
    for (let k = 0; k < 4; k++) {
      let ux;
      let uz;
      if (k === 0) { ux = fax; uz = faz; } else if (k === 1) { ux = -faz; uz = fax; } else if (k === 2) { ux = fbx; uz = fbz; } else { ux = -fbz; uz = fbx; }
      const ra = hlA * Math.abs(fax * ux + faz * uz) + hwA * Math.abs(-faz * ux + fax * uz);
      const rb = hlB * Math.abs(fbx * ux + fbz * uz) + hwB * Math.abs(-fbz * ux + fbx * uz);
      const dist = dx * ux + dz * uz;
      const o = ra + rb - Math.abs(dist);
      if (o <= 0) return false;
      if (o < best) {
        best = o;
        const sg = dist >= 0 ? 1 : -1;
        bnx = ux * sg;
        bnz = uz * sg;
        bra = ra;
      }
    }
    this.nx = bnx;
    this.nz = bnz;
    this.depth = best;
    this.radA = bra;
    return true;
  }

  resolve(A, B, key, line, events) {
    const nx = this.nx;
    const nz = this.nz;
    const depth = this.depth;
    const va = A.velocity;
    const vb = B.velocity;
    const vn = (vb.x - va.x) * nx + (vb.z - va.z) * nz; // < 0: yaklaşıyorlar
    const closing = vn < 0 ? -vn : 0;

    // saldıran: normal boyunca diğerine doğru daha hızlı giden (shockwave'li araba her zaman saldırandır)
    const shockA = A.nitroLevel === 'shockwave' && A.nitroActive !== false;
    const shockB = B.nitroLevel === 'shockwave' && B.nitroActive !== false;
    const aToward = va.x * nx + va.z * nz;
    const bToward = -(vb.x * nx + vb.z * nz);
    let attackerIsA = aToward >= bToward;
    if (shockA !== shockB) attackerIsA = shockA;
    const att = attackerIsA ? A : B;
    const vic = attackerIsA ? B : A;
    const sgn = attackerIsA ? 1 : -1; // saldırandan kurbana normal = sgn * n
    const avx = nx * sgn;
    const avz = nz * sgn;

    // duvara sıkışma bilgisi (kurban ve pozisyon dağıtımı için)
    const vicPinned = this.isPinned(vic, avx, avz, line);
    const attPinned = this.isPinned(att, -avx, -avz, line);

    // --- takedown kararı (çarpışma tepkisinden önceki hızlarla) ---
    let takedown = false;
    if (this.time < this.takedownUntil[key]) {
      // aynı çift için art arda takedown yok (wreck() kurbanı hemen devre dışı bırakmasa bile)
    } else if (att.nitroLevel === 'shockwave' && att.nitroActive !== false) {
      takedown = true;
    } else if (closing > 0) {
      const factor = vic.isPlayer && !att.isPlayer ? BOT_VS_PLAYER_FACTOR : 1;
      // kurbanın önünden (kafa kafaya) gelen darbe kural (a)'ya girmez
      const fromFront = avx * Math.sin(vic.yaw) + avz * Math.cos(vic.yaw) < -0.5;
      if (!fromFront && closing > TAKEDOWN_HIT_SPEED * factor) takedown = true;
      else if (vicPinned && closing > TAKEDOWN_PIN_SPEED * factor) takedown = true;
    }

    // --- nüfuzu çöz: duvara sıkışmış taraf daha az itilir ---
    let shareVic = 0.5;
    if (vicPinned && !attPinned) shareVic = 0.15;
    else if (attPinned && !vicPinned) shareVic = 0.85;
    const pushVic = depth * shareVic;
    const pushAtt = depth - pushVic;
    vic.position.x += avx * pushVic;
    vic.position.z += avz * pushVic;
    att.position.x -= avx * pushAtt;
    att.position.z -= avz * pushAtt;

    // --- hız tepkisi (eşit kütle) ---
    if (closing > 0) {
      const j = ((1 + RESTITUTION) * closing) / 2;
      const jAtt = takedown ? j * ATTACKER_TAKEDOWN_IMPULSE : j;
      const imp = this.impulse;
      imp.set(avx * j, 0, avz * j);
      vic.applyImpulse(imp);
      imp.set(-avx * jAtt, 0, -avz * jAtt);
      att.applyImpulse(imp);
    }

    // --- olaylar ---
    const t = this.time;
    if (takedown) {
      this.takedownUntil[key] = t + TAKEDOWN_COOLDOWN;
      if (!events) events = [];
      vic.wreck('takedown');
      events.push({ type: 'takedown', car: att, victim: vic });
    }
    if ((closing >= BUMP_MIN_SPEED || takedown) && t >= this.bumpUntil[key]) {
      this.bumpUntil[key] = t + BUMP_COOLDOWN;
      if (!events) events = [];
      const owner = B.isPlayer && !A.isPlayer ? B : A.isPlayer ? A : att;
      const other = owner === A ? B : A;
      // temas noktası: A'nın merkezinden normal boyunca kutu kenarına
      const ra = this.radA - depth / 2;
      const point = new THREE.Vector3(
        A.position.x + nx * ra,
        (A.position.y + B.position.y) / 2 + 0.5,
        A.position.z + nz * ra,
      );
      events.push({ type: 'bump', car: owner, other, strength: Math.min(1, closing / 30), point });
    }
    return events;
  }

  // Araba yanal olarak duvar sınırına yakın ve (ux,uz) itme yönü o duvara dönük mü?
  isPinned(car, ux, uz, line) {
    if (!line || !Number.isFinite(car.lateral) || !Number.isFinite(car.trackS)) return false;
    const f = line.frameAt(car.trackS, this.frame);
    const half = car.halfWidth > 0 ? car.halfWidth : 1;
    const side = car.lateral >= 0 ? 1 : -1;
    if (Math.abs(car.lateral) + half < f.halfW - PIN_WALL_ZONE) return false;
    const outward = (ux * f.rx + uz * f.rz) * side;
    return outward > PIN_DIRECTION;
  }

  // Near miss: pist boyunca sıralama değişimi (geçiş) anında yanal boşluk ve göreli hız kontrolü.
  trackNearMiss(A, B, key, L, events) {
    let ds = B.trackS - A.trackS;
    if (!Number.isFinite(ds)) {
      this.prevValid[key] = 0;
      return events;
    }
    ds -= Math.round(ds / L) * L; // (-L/2, L/2]
    if (Math.abs(ds) > 12) {
      this.prevValid[key] = 0;
      return events;
    }
    const prev = this.prevDs[key];
    const valid = this.prevValid[key] === 1;
    this.prevDs[key] = ds;
    this.prevValid[key] = 1;
    if (!valid || (prev < 0) === (ds < 0) || Math.abs(prev) > 6) return events;

    const t = this.time;
    if (t < this.nearUntil[key] || t - this.lastContact[key] < NEAR_MISS_CONTACT_GRACE) return events;
    const hwA = A.halfWidth > 0 ? A.halfWidth : 1;
    const hwB = B.halfWidth > 0 ? B.halfWidth : 1;
    const gap = Math.abs(B.lateral - A.lateral) - hwA - hwB;
    if (!(gap > 0 && gap <= NEAR_MISS_GAP)) return events;
    const rvx = B.velocity.x - A.velocity.x;
    const rvz = B.velocity.z - A.velocity.z;
    if (rvx * rvx + rvz * rvz <= NEAR_MISS_SPEED * NEAR_MISS_SPEED) return events;

    this.nearUntil[key] = t + NEAR_MISS_COOLDOWN;
    const passer = ds > 0 ? B : A; // şimdi önde olan geçti
    if (!events) events = [];
    events.push({ type: 'near_miss', car: passer, other: passer === A ? B : A });
    return events;
  }
}
