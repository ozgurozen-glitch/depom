// Araç başına ölçülen performans (azami hız, 0-100/0-200, viraj yarıçapı, nitro kazancı) ve bunlardan türetilen
// 0..1 stat değerleri. cars.js içindeki stats bu değerlerle uyumlu olmalıdır (physics.mjs doğrular).
//   node --import ./tools/cartest/register.mjs tools/cartest/stats.mjs
import * as THREE from 'three';
import { Car } from '../../src/car.js';
import { CARS } from '../../src/cars.js';
import { FlatTrack } from './flat-track.js';

const DT = 1 / 60;
const scene = new THREE.Scene();
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function newCar(spec, kmh = 0) {
  const car = new Car({ scene, color: 0x1677ff, name: 'S', isPlayer: true, spec });
  car.placeAt(new THREE.Vector3(0, 0, 0), 0);
  car.update(DT, { throttle: 0 }, new FlatTrack());
  if (kmh) car.applyImpulse(new THREE.Vector3(0, 0, kmh / 3.6));
  car.events.length = 0;
  return car;
}

export function measureCar(spec) {
  const tr = new FlatTrack(8000);
  const out = {};

  // İvme ve azami hız
  {
    const car = newCar(spec);
    let t100 = null;
    let t200 = null;
    for (let i = 0; i < 60 * 40; i++) {
      car.update(DT, { throttle: 1, brake: 0, steer: 0, nitro: false, drift: false }, tr);
      const t = (i + 1) * DT;
      if (t100 === null && car.speedKmh >= 100) t100 = t;
      if (t200 === null && car.speedKmh >= 200) t200 = t;
    }
    out.topKmh = car.speedKmh;
    out.t100 = t100;
    out.t200 = t200;
  }

  // Sabit hızda tam direksiyon: viraj yarıçapı (hız P denetleyiciyle tutulur)
  const radius = (kmh) => {
    const car = newCar(spec, kmh);
    const target = kmh / 3.6;
    const inp = (t) => ({ throttle: Math.min(1, Math.max(0, 0.6 + (target - car.speed) * 0.5)), brake: 0, steer: 1, nitro: false, drift: false, t });
    for (let i = 0; i < 90; i++) car.update(DT, inp(), tr);
    let yaw = 0;
    let prev = car.yaw;
    let dist = 0;
    let p0 = car.position.clone();
    for (let i = 0; i < 90; i++) {
      car.update(DT, inp(), tr);
      yaw += Math.atan2(Math.sin(car.yaw - prev), Math.cos(car.yaw - prev));
      prev = car.yaw;
      dist += car.position.distanceTo(p0);
      p0 = car.position.clone();
    }
    return dist / Math.abs(yaw);
  };
  out.r100 = radius(100);
  out.r150 = radius(150);
  out.r250 = radius(Math.min(250, out.topKmh - 15));

  // Normal nitro: 200 km/s'den başlayıp patlama bitince hız kazancı
  {
    const car = newCar(spec, 200);
    car.nitro = 1;
    car.update(DT, { throttle: 1, nitro: true }, tr);
    for (let i = 0; i < Math.round(2.4 / DT); i++) car.update(DT, { throttle: 1, nitro: false }, tr);
    out.nitroGain = car.speedKmh - 200;
  }
  out.driftNitroRate = (spec && spec.tuning && spec.tuning.driftNitroRate) || 0.12;
  return out;
}

// Ölçümlerden 0..1 stat (menüde gösterilen).
export function deriveStats(m) {
  return {
    speed: clamp01((m.topKmh - 220) / 100),
    accel: clamp01((7.2 - m.t200) / 3.6),
    handling: clamp01((38 - m.r150) / 20),
    nitro: clamp01(0.8 * clamp01((m.nitroGain - 60) / 70) + 0.2 * clamp01(m.driftNitroRate / 0.2)),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const spec of CARS) {
    const m = measureCar(spec);
    const d = deriveStats(m);
    console.log(`${spec.id.padEnd(7)} top ${m.topKmh.toFixed(1)} km/s | 0-100 ${m.t100.toFixed(2)} s | 0-200 ${m.t200.toFixed(2)} s | R@100 ${m.r100.toFixed(1)} m | R@150 ${m.r150.toFixed(1)} m | R@250 ${m.r250.toFixed(1)} m | nitro +${m.nitroGain.toFixed(0)} km/s`);
    console.log(`        türetilen stats: ${Object.entries(d).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  ')}   (cars.js: ${Object.entries(spec.stats).map(([k, v]) => `${k} ${v}`).join('  ')})`);
  }
}
