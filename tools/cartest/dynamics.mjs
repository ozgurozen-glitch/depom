// Sürüş dinamiği yumuşaklık ölçümleri (direksiyon basamağı, gaz bırakma, duvar sürtünmesi, yatış, süspansiyon).
//   node --import ./tools/cartest/register.mjs tools/cartest/dynamics.mjs
import * as THREE from 'three';
import { Car } from '../../src/car.js';
import { FlatTrack } from './flat-track.js';
import { TestTrack } from './test-track.js';

const DT = 1 / 60;
const scene = new THREE.Scene();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const inp = (o = {}) => ({ throttle: 1, brake: 0, steer: 0, nitro: false, drift: false, ...o });

function carAt(track, s, lat, kmh, spec = null, isPlayer = true) {
  const car = new Car({ scene, color: 0x1677ff, name: 'D', isPlayer, spec });
  const smp = track.sample(s);
  const pos = smp.pos.clone().addScaledVector(smp.right, lat);
  pos.y = track.heightAt(s, lat);
  const yaw = Math.atan2(smp.tangent.x, smp.tangent.z);
  car.placeAt(pos, yaw);
  car.trackS = s;
  car.update(DT, inp({ throttle: 0 }), track);
  if (kmh) car.applyImpulse(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(kmh / 3.6));
  car.events.length = 0;
  return car;
}

// Klavye gibi basamak direksiyon: yaw ivmesi tepe değeri (rad/s²) ve gövde yatışı aşımı.
export function steerStep(kmh, spec = null) {
  const tr = new FlatTrack(5000);
  const car = carAt(tr, 0, 0, kmh, spec);
  let prevYaw = car.yaw;
  let prevW = 0;
  let peakA = 0;
  let peakW = 0;
  let leanMax = 0;
  let lean2 = 0;
  for (let i = 0; i < 180; i++) {
    const t = i * DT;
    car.update(DT, inp({ steer: t >= 0.2 ? 1 : 0 }), tr);
    const w = wrap(car.yaw - prevYaw) / DT;
    prevYaw = car.yaw;
    if (t > 0.2) peakA = Math.max(peakA, Math.abs((w - prevW) / DT));
    peakW = Math.max(peakW, Math.abs(w));
    prevW = w;
    leanMax = Math.max(leanMax, Math.abs(car._lean));
    lean2 = Math.abs(car._lean);
  }
  return { peakYawAcc: peakA, peakYawRate: peakW, leanOvershoot: lean2 > 1e-4 ? leanMax / lean2 : 1 };
}

// Gaz bırakma: boyuna ivmenin (m/s²) değişim hızı tepe değeri (jerk) ve 3 s sonraki hız.
export function throttleRelease(kmh, spec = null) {
  const tr = new FlatTrack(5000);
  const car = carAt(tr, 0, 0, kmh, spec);
  for (let i = 0; i < 120; i++) car.update(DT, inp(), tr);
  let prevV = car.speed;
  car.update(DT, inp(), tr);
  let prevA = (car.speed - prevV) / DT;
  prevV = car.speed;
  let peakJerk = 0;
  let minA = 0;
  let a1 = 0;
  const v0 = car.speedKmh;
  for (let i = 0; i < 240; i++) {
    car.update(DT, inp({ throttle: 0 }), tr);
    const a = (car.speed - prevV) / DT;
    peakJerk = Math.max(peakJerk, Math.abs((a - prevA) / DT));
    minA = Math.min(minA, a);
    if (i === 5) a1 = a;
    prevV = car.speed;
    prevA = a;
  }
  return { peakJerk, maxDecel: -minA, decel0_1s: -a1, lossKmh: v0 - car.speedKmh };
}

// Duvar sürtünmesi / darbe: adım başına en büyük hız düşüşü (m/s²).
export function wallHit(kind, spec = null) {
  const tr = new TestTrack(null);
  const car = carAt(tr, 500, kind === 'scrape' ? 6 : 0, kind === 'scrape' ? 200 : 250, spec);
  if (kind === 'scrape') car.yaw -= 0.12;
  else {
    car.yaw -= 0.35;
    car.velocity.set(Math.sin(car.yaw) * 250 / 3.6, 0, Math.cos(car.yaw) * 250 / 3.6);
    car.speed = 250 / 3.6;
  }
  let prev = Math.hypot(car.velocity.x, car.velocity.z);
  let peak = 0;
  const v0 = prev;
  for (let i = 0; i < 90; i++) {
    car.update(DT, inp({ steer: kind === 'scrape' ? 0.15 : 0 }), tr);
    const v = Math.hypot(car.velocity.x, car.velocity.z);
    peak = Math.max(peak, (prev - v) / DT);
    prev = v;
  }
  return { peakDecel: peak, lossKmh: (v0 - prev) * 3.6 };
}

// Süspansiyon: iniş darbesi sonrası yay salınımı (sıfırı geçiş sayısı ve aşım, metre).
export function suspension(spec = null) {
  const tr = new FlatTrack(5000);
  const car = carAt(tr, 0, 0, 0, spec);
  car._suspVel = -1.5;
  let min = 0;
  let over = 0;
  let cross = 0;
  let prevSign = 0;
  for (let i = 0; i < 120; i++) {
    car.update(DT, inp({ throttle: 0 }), tr);
    const y = car._suspY;
    min = Math.min(min, y);
    if (min < -0.02) over = Math.max(over, y);
    const sg = Math.abs(y) < 1e-3 ? 0 : Math.sign(y);
    if (sg !== 0 && prevSign !== 0 && sg !== prevSign) cross++;
    if (sg !== 0) prevSign = sg;
  }
  return { min, overshoot: over, crossings: cross };
}

export function printAll(label, d) {
  console.log(`  [${label}]`);
  console.log(`     direksiyon basamağı @250: yaw ivmesi tepe ${d.step250.peakYawAcc.toFixed(1)} rad/s², yaw hızı ${d.step250.peakYawRate.toFixed(2)}, yatış aşımı x${d.step250.leanOvershoot.toFixed(2)}`);
  console.log(`     direksiyon basamağı @60 : yaw ivmesi tepe ${d.step60.peakYawAcc.toFixed(1)} rad/s²`);
  console.log(`     gaz bırakma @250: jerk tepe ${d.rel.peakJerk.toFixed(1)} m/s³, 0.1 s'de ${d.rel.decel0_1s.toFixed(2)} m/s², azami ${d.rel.maxDecel.toFixed(2)}, 4 s kayıp ${d.rel.lossKmh.toFixed(0)} km/s`);
  console.log(`     duvar sürtünme tepe yavaşlama ${d.scrape.peakDecel.toFixed(1)} m/s² (kayıp ${d.scrape.lossKmh.toFixed(0)} km/s); 20° darbe tepe ${d.impact.peakDecel.toFixed(1)} m/s² (kayıp ${d.impact.lossKmh.toFixed(0)} km/s)`);
  console.log(`     süspansiyon: sıfır geçişi ${d.susp.crossings}, aşım ${(d.susp.overshoot * 1000).toFixed(1)} mm (tepe çökme ${(d.susp.min * 1000).toFixed(0)} mm)`);
}

export function measureAll() {
  return {
    step250: steerStep(250), step60: steerStep(60), rel: throttleRelease(250),
    scrape: wallHit('scrape'), impact: wallHit('impact'), susp: suspension(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) printAll('ölçüm', measureAll());
