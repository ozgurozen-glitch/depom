// Drift yumuşaklığı ölçümü: giriş → tutma → sol/sağ geçiş (flick) → çıkış senaryosunda gövde açısının
// (yaw) ve gövde/hız açısı farkının (slip) değişim hızı (rad/s) ile açısal ivmesinin (rad/s²) tepe değerleri.
//   node --import ./tools/cartest/register.mjs tools/cartest/drift.mjs [carId ...]
import * as THREE from 'three';
import { Car } from '../../src/car.js';
import { FlatTrack } from './flat-track.js';

const DT = 1 / 60;
const DEG = 180 / Math.PI;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Senaryo girişi (t: saniye). Fren tuşu = drift tuşu (Controls'taki gibi).
export function maneuverInput(t) {
  const base = { throttle: 1, brake: 0, steer: 0, nitro: false, drift: false };
  const dr = (steer) => ({ throttle: 0, brake: 1, steer, nitro: false, drift: true });
  if (t < 0.3) return base;
  if (t < 1.8) return dr(1); // giriş + tutma (sağ)
  if (t < 3.6) return dr(-1); // flick: sola geç ve tut
  return { ...base, steer: 0 }; // çıkış
}

export const PHASES = {
  entry: [0.3, 1.0],
  flick: [1.8, 3.0],
  exit: [3.6, 4.8],
};

export function measureDrift(spec = null, { kmh = 200 } = {}) {
  const tr = new FlatTrack(5000);
  const scene = new THREE.Scene();
  const car = new Car({ scene, color: 0x1677ff, name: 'M', isPlayer: true, spec });
  car.placeAt(new THREE.Vector3(0, 0, 0), 0);
  car.update(DT, { throttle: 0 }, tr);
  car.applyImpulse(new THREE.Vector3(0, 0, kmh / 3.6));
  car.events.length = 0;

  const N = Math.round(6 / DT);
  const rec = [];
  let yawU = car.yaw;
  let prevYaw = car.yaw;
  for (let i = 0; i < N; i++) {
    const t = i * DT;
    car.update(DT, maneuverInput(t), tr);
    yawU += wrap(car.yaw - prevYaw);
    prevYaw = car.yaw;
    const hs = Math.hypot(car.velocity.x, car.velocity.z);
    const slip = hs > 3 ? wrap(Math.atan2(car.velocity.x, car.velocity.z) - car.yaw) : 0;
    rec.push({ t, yaw: yawU, slip, kmh: hs * 3.6, drifting: car.drifting });
  }
  // Sonlu fark türevleri
  for (let i = 1; i < rec.length; i++) {
    rec[i].w = (rec[i].yaw - rec[i - 1].yaw) / DT; // yaw hızı
    rec[i].sr = wrap(rec[i].slip - rec[i - 1].slip) / DT; // slip açısı değişim hızı
  }
  for (let i = 2; i < rec.length; i++) {
    rec[i].a = (rec[i].w - rec[i - 1].w) / DT; // yaw ivmesi
    rec[i].sa = (rec[i].sr - rec[i - 1].sr) / DT; // slip ivmesi
  }
  const peak = (key, [a, b]) => {
    let m = 0;
    for (const r of rec) if (r.t >= a && r.t <= b && r[key] !== undefined) m = Math.max(m, Math.abs(r[key]));
    return m;
  };
  const res = { phases: {}, rec };
  for (const [name, win] of Object.entries(PHASES)) {
    res.phases[name] = { w: peak('w', win), a: peak('a', win), sr: peak('sr', win), sa: peak('sa', win) };
  }
  const all = [0.3, 4.8];
  res.all = { w: peak('w', all), a: peak('a', all), sr: peak('sr', all), sa: peak('sa', all) };

  // Giriş: slip açısının oturma süresi (kararlı değerin %10'una girme) ve aşım.
  const steady = rec.find((r) => r.t >= 1.7).slip;
  const entry = rec.filter((r) => r.t >= 0.3 && r.t < 1.8);
  let settle = null;
  for (const r of entry) {
    if (Math.abs(r.slip - steady) <= Math.abs(steady) * 0.1) { settle = r.t - 0.3; break; }
  }
  const overshoot = Math.max(...entry.map((r) => Math.abs(r.slip))) - Math.abs(steady);
  res.entry = { steadyDeg: Math.abs(steady) * DEG, settle, overshootDeg: Math.max(0, overshoot) * DEG };
  // Flick: slip'in yeni yönde 5°'yi geçme süresi ve yeni kararlı değer.
  const flickRec = rec.filter((r) => r.t >= 1.8 && r.t < 3.6);
  const steady2 = rec.find((r) => r.t >= 3.5).slip;
  let flipT = null;
  for (const r of flickRec) {
    if (Math.sign(r.slip) === Math.sign(steady2) && Math.abs(r.slip) > 0.087) { flipT = r.t - 1.8; break; }
  }
  res.flick = { toDeg: Math.abs(steady2) * DEG, flipTime: flipT };
  // Çıkış: slip'in 3°'nin altına inme süresi.
  let clear = null;
  for (const r of rec) {
    if (r.t >= 3.6 && Math.abs(r.slip) < 3 / DEG) { clear = r.t - 3.6; break; }
  }
  res.exit = { clearTime: clear };
  res.speedLoss = rec.find((r) => r.t >= 0.3).kmh - rec.find((r) => r.t >= 3.55).kmh;
  return res;
}

export function printDrift(label, r) {
  const f = (x, d = 2) => (x === null || x === undefined ? '  -  ' : x.toFixed(d));
  console.log(`  [${label}] yaw hızı ω / ivmesi α | slip hızı β̇ / ivmesi β̈  (tepe; rad/s, rad/s²)`);
  for (const [name, p] of [...Object.entries(r.phases), ['tümü', r.all]]) {
    console.log(`     ${name.padEnd(6)} ω ${f(p.w)} / α ${f(p.a, 1)}  |  β̇ ${f(p.sr)} / β̈ ${f(p.sa, 1)}`);
  }
  console.log(`     giriş: kararlı ${f(r.entry.steadyDeg, 1)}°, oturma ${f(r.entry.settle)} s, aşım ${f(r.entry.overshootDeg, 1)}°;`
    + ` flick: ${f(r.flick.toDeg, 1)}° geçiş ${f(r.flick.flipTime)} s; çıkış: slip<3° ${f(r.exit.clearTime)} s; hız kaybı ${f(r.speedLoss, 0)} km/s`);
}

// Drift çıkışı: sağa drift'te (tam direksiyon, drift açısı ~maks) kararlı hale gelince bırakılır; slip açısının
// 3°'nin altına sönme süresi, bu sürede hız kaybı ve hız vektörünün dönüşü. thr: çıkıştaki gaz, counter: -1..1
// (+1 = kayma yönüne karşı direksiyon, tam).
export function measureExit(spec, kmh, { thr = 0, counter = 0 } = {}) {
  const tr = new FlatTrack(8000);
  const scene = new THREE.Scene();
  const car = new Car({ scene, color: 0x1677ff, name: 'E', isPlayer: true, spec });
  car.placeAt(new THREE.Vector3(0, 0, 0), 0);
  car.update(DT, { throttle: 0 }, tr);
  car.applyImpulse(new THREE.Vector3(0, 0, kmh / 3.6));
  car.events.length = 0;
  const dr = (steer, throttle) => ({ throttle, brake: 0, steer, nitro: false, drift: true });
  for (let i = 0; i < 100; i++) car.update(DT, dr(i < 6 ? 0 : 1, 1), tr);
  for (let i = 0; i < 90; i++) car.update(DT, dr(1, 1), tr);
  const slip0 = wrap(Math.atan2(car.velocity.x, car.velocity.z) - car.yaw);
  const th0 = Math.atan2(car.velocity.x, car.velocity.z);
  const v0 = Math.hypot(car.velocity.x, car.velocity.z) * 3.6;
  // Bırak: drift tuşu + direksiyon (karşı direksiyon: kayma yönüne, yani drift yönünün tersine)
  const steer = -counter;
  let t = 0;
  let clear = null;
  let prevYaw = car.yaw;
  let prevW = 0;
  let peakA = 0;
  for (let i = 0; i < 240; i++) {
    car.update(DT, { throttle: thr, brake: 0, steer, nitro: false, drift: false }, tr);
    t += DT;
    const w = wrap(car.yaw - prevYaw) / DT;
    if (i > 0) peakA = Math.max(peakA, Math.abs((w - prevW) / DT));
    prevYaw = car.yaw;
    prevW = w;
    const slip = wrap(Math.atan2(car.velocity.x, car.velocity.z) - car.yaw);
    if (clear === null && Math.abs(slip) < 3 / DEG) {
      clear = t;
      var vEnd = Math.hypot(car.velocity.x, car.velocity.z) * 3.6;
      var turn = wrap(Math.atan2(car.velocity.x, car.velocity.z) - th0);
    }
  }
  return { slipDeg: Math.abs(slip0) * DEG, clearTime: clear, speedLoss: v0 - (vEnd ?? v0), turnDeg: Math.abs(turn ?? 0) * DEG, peakYawAcc: peakA, v0 };
}

export function printExit(label, r) {
  const f = (x, d = 2) => (x === null || x === undefined ? '  -  ' : x.toFixed(d));
  console.log(`     ${label.padEnd(26)} slip ${f(r.slipDeg, 1)}°  sönme ${f(r.clearTime)} s  hız kaybı ${f(r.speedLoss, 0)} km/s  yön dönüşü ${f(r.turnDeg, 0)}°  yaw α ${f(r.peakYawAcc, 1)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ids = process.argv.slice(2);
  let defs = [null];
  if (ids.length) {
    const { getCarDef } = await import('../../src/cars.js');
    defs = ids.map(getCarDef);
  }
  for (const d of defs) {
    printDrift(d ? d.id : 'varsayılan', measureDrift(d));
    console.log('  [çıkış: slip sönme]');
    for (const kmh of [100, 200, 280]) {
      printExit(`${kmh} km/s gazsız`, measureExit(d, kmh));
      printExit(`${kmh} km/s gazlı`, measureExit(d, kmh, { thr: 1 }));
      printExit(`${kmh} km/s karşı direksiyon`, measureExit(d, kmh, { counter: 1 }));
    }
  }
}
