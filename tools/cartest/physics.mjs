// Car fiziği için başsız (Node) senaryo testleri. Ölçümleri yazdırır, beklentiler tutmazsa çıkış kodu 1.
//   node --import ./tools/cartest/register.mjs tools/cartest/physics.mjs
import * as THREE from 'three';
import { Car, CAR_TUNING } from '../../src/car.js';
import { TestTrack } from './test-track.js';

const DT = 1 / 60;
const KMH = 3.6;
let failures = 0;

function check(name, ok, detail) {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

// Sonsuz düz pist (ivme/direksiyon ölçümleri için).
class FlatTrack {
  constructor(width = 200) {
    this.name = 'flat';
    this.width = width;
    this.length = 1e6;
    this.ramps = [];
    this.pickups = [];
  }
  sample(s) {
    return { pos: new THREE.Vector3(0, 0, s), tangent: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0), width: this.width };
  }
  project(pos) {
    return { s: pos.z, lateral: -pos.x, height: pos.y, onRoad: Math.abs(pos.x) < this.width / 2 };
  }
  heightAt() { return 0; }
  update() {}
}

const scene = new THREE.Scene();
const input = (o = {}) => ({ throttle: 1, brake: 0, steer: 0, nitro: false, drift: false, ...o });

function makeCar(track, s, lat = 0, speedKmh = 0) {
  const car = new Car({ scene, color: 0x1677ff, name: 'T', isPlayer: true });
  placeOn(car, track, s, lat, speedKmh);
  return car;
}

function placeOn(car, track, s, lat, speedKmh) {
  const smp = track.sample(s);
  const pos = smp.pos.clone().addScaledVector(smp.right, lat);
  pos.y = track.heightAt(s, lat);
  const yaw = Math.atan2(smp.tangent.x, smp.tangent.z);
  car.placeAt(pos, yaw);
  car.trackS = s;
  car.update(DT, input({ throttle: 0 }), track);
  if (speedKmh) car.applyImpulse(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(speedKmh / KMH));
  car.events.length = 0;
}

function run(car, track, seconds, fn) {
  const events = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    car.update(DT, typeof fn === 'function' ? fn(t, car) : fn, track);
    for (const e of car.events) events.push({ t: Number(t.toFixed(3)), ...e, car: undefined });
    car.events.length = 0;
  }
  return events;
}

const types = (ev) => ev.map((e) => e.type);

// ---------------------------------------------------------------------------------------------
console.log('\n# İvme ve azami hız');
{
  const tr = new FlatTrack();
  const car = makeCar(tr, 0);
  let t100 = null;
  let t200 = null;
  let t280 = null;
  for (let i = 0; i < 60 * 25; i++) {
    car.update(DT, input(), tr);
    const k = car.speedKmh;
    const t = (i + 1) * DT;
    if (t100 === null && k >= 100) t100 = t;
    if (t200 === null && k >= 200) t200 = t;
    if (t280 === null && k >= 280) t280 = t;
  }
  const top = car.speedKmh;
  check('0-100 km/s', t100 > 1.6 && t100 < 2.8, `${t100?.toFixed(2)} s`);
  check('0-200 km/s ≈ 5 s', t200 > 4.4 && t200 < 5.6, `${t200?.toFixed(2)} s`);
  check('0-280 km/s', t280 !== null && t280 < 14, `${t280?.toFixed(2)} s`);
  check('azami hız ≈ 290', top > 285 && top <= 291, `${top.toFixed(1)} km/s`);

  // Fren
  let ts = null;
  for (let i = 0; i < 60 * 10; i++) {
    car.update(DT, input({ throttle: 0, brake: 1, drift: true }), tr);
    if (ts === null && car.speedKmh < 1) ts = (i + 1) * DT;
  }
  check('290→0 fren (direksiyonsuz)', ts !== null && ts < 4.5, `${ts?.toFixed(2)} s`);
  run(car, tr, 2, input({ throttle: 0, brake: 1, drift: true }));
  check('durunca geri vites', car.speed < -5 && car.speed >= -CAR_TUNING.reverseMax - 0.01, `speed ${car.speed.toFixed(1)} m/s`);
}

// ---------------------------------------------------------------------------------------------
console.log('\n# Nitro');
{
  const tr = new FlatTrack();
  const car = makeCar(tr, 0, 0, 290);
  car.nitro = 1;
  let ev = run(car, tr, 0.1, input({ nitro: true }));
  check('normal nitro başlar', car.nitroActive && car.nitroLevel === 'normal', types(ev).join(','));
  ev = run(car, tr, 0.1, input());
  ev = ev.concat(run(car, tr, 2.3, input()));
  check('normal patlama ~2.2 s sürer ve biter', types(ev).includes('nitro_end') && !car.nitroActive);
  check('normal patlama barın ~1/3\'ünü yakar', Math.abs(car.nitro - 2 / 3) < 0.03, `bar ${car.nitro.toFixed(3)}`);
  const vNormal = car.speedKmh;
  check('normal nitro hızı (≈+%18 hedef)', vNormal > 315 && vNormal < 345, `${vNormal.toFixed(1)} km/s`);

  // Perfect zinciri
  const car2 = makeCar(tr, 0, 0, 290);
  car2.nitro = 1;
  run(car2, tr, 0.05, input({ nitro: true }));
  run(car2, tr, 0.05, input());
  run(car2, tr, 0.6, input());
  let early = run(car2, tr, 0.05, input({ nitro: true }));
  run(car2, tr, 0.05, input());
  check('erken basış (<%75) yok sayılır', car2.nitroLevel === 'normal' && !types(early).includes('nitro_start'));
  run(car2, tr, 1.1, input()); // ilerleme ≈ %80
  const prog = car2.nitroBurstProgress;
  const ev2 = run(car2, tr, 0.05, input({ nitro: true }));
  check('perfect nitro zinciri', car2.nitroLevel === 'perfect' && types(ev2).includes('nitro_start'), `progress at press ${prog?.toFixed(2)}`);
  run(car2, tr, 0.05, input());
  let maxK = 0;
  run(car2, tr, 2.4, (t, c) => { maxK = Math.max(maxK, c.speedKmh); return input(); });
  check('perfect daha hızlı', maxK > vNormal, `${maxK.toFixed(1)} km/s`);

  // Shockwave
  const car3 = makeCar(tr, 0, 0, 290);
  car3.nitro = 1;
  const ev3 = [];
  ev3.push(...run(car3, tr, 0.08, input({ nitro: true })));
  ev3.push(...run(car3, tr, 0.1, input()));
  ev3.push(...run(car3, tr, 0.08, input({ nitro: true })));
  check('çift dokunuş → shockwave', car3.nitroLevel === 'shockwave', ev3.filter((e) => e.type === 'nitro_start').map((e) => e.level).join('→'));
  let maxS = 0;
  let dur = 0;
  ev3.push(...run(car3, tr, 4.5, (t, c) => { maxS = Math.max(maxS, c.speedKmh); if (c.nitroActive) dur += DT; return input(); }));
  check('shockwave tüm barı ~4 s\'de yakar', car3.nitro < 0.02 && dur > 3.6 && dur < 4.3, `süre ${dur.toFixed(2)} s, bar ${car3.nitro.toFixed(3)}`);
  check('shockwave en hızlı', maxS > maxK, `${maxS.toFixed(1)} km/s`);

  const car4 = makeCar(tr, 0, 0, 290);
  car4.nitro = 0.8;
  run(car4, tr, 0.08, input({ nitro: true }));
  run(car4, tr, 0.1, input());
  run(car4, tr, 0.08, input({ nitro: true }));
  check('bar dolu değilken çift dokunuş shockwave yapmaz', car4.nitroLevel === 'normal');
}

// ---------------------------------------------------------------------------------------------
console.log('\n# Direksiyon');
{
  const tr = new FlatTrack(5000);
  for (const kmh of [60, 150, 290]) {
    const car = makeCar(tr, 0, 0, kmh);
    // sabit hız için gazı ayarlamadan tam direksiyon
    let yaw0 = car.yaw;
    run(car, tr, 0.6, input({ steer: 1 }));
    yaw0 = car.yaw;
    const sp0 = car.speedKmh;
    run(car, tr, 1, input({ steer: 1 }));
    const rate = -(car.yaw - yaw0);
    const v = Math.hypot(car.velocity.x, car.velocity.z);
    const slip = Math.atan2(Math.abs(car.velocity.x * -Math.cos(car.yaw) + car.velocity.z * Math.sin(car.yaw)), Math.abs(car.speed)) * 180 / Math.PI;
    console.log(`     ${kmh} km/s: yaw ${rate.toFixed(2)} rad/s, yarıçap ${(v / rate).toFixed(0)} m, kayma ${slip.toFixed(1)}°, hız ${sp0.toFixed(0)}→${car.speedKmh.toFixed(0)}`);
    check(`${kmh} km/s sağa direksiyon yaw'ı azaltır`, rate > 0.5);
  }
  // Yandan itme: duran araba ileri fırlamamalı
  const car = makeCar(tr, 0, 0, 0);
  car.applyImpulse(new THREE.Vector3(10, 0, 0));
  run(car, tr, 1.5, input({ throttle: 0 }));
  check('duran arabaya yan itme ileri hız üretmez', Math.abs(car.speed) < 1.5, `speed ${car.speed.toFixed(2)}`);
  const car2 = makeCar(tr, 0, 0, 200);
  car2.applyImpulse(new THREE.Vector3(-8, 0, 0)); // sağa
  const lat0 = car2.position.x;
  run(car2, tr, 1, input());
  check('hızlı arabaya yan itme yanal kaydırır', car2.position.x < lat0 - 0.4, `Δx ${(car2.position.x - lat0).toFixed(2)} m`);
}

// ---------------------------------------------------------------------------------------------
console.log('\n# Drift');
{
  const tr = new FlatTrack(5000);
  const car = makeCar(tr, 0, 0, 200);
  car.nitro = 0;
  const ev = run(car, tr, 0.1, input({ throttle: 0, brake: 1, drift: true, steer: 1 }));
  check('fren + direksiyon + hız → drift_start', types(ev).includes('drift_start') && car.drifting);
  let maxAng = 0;
  const v0 = car.speedKmh;
  run(car, tr, 2, (t, c) => { maxAng = Math.max(maxAng, c.driftAngle); return input({ throttle: 0, brake: 1, drift: true, steer: 1 }); });
  const dAng = maxAng * 180 / Math.PI;
  check('drift açısı 25-45°', dAng > 30 && dAng <= 46, `${dAng.toFixed(1)}°`);
  check('drift hızı az düşürür', car.speedKmh > v0 - 35, `${v0.toFixed(0)}→${car.speedKmh.toFixed(0)} km/s`);
  check('drift nitro doldurur (~0.12/s)', car.nitro > 0.2 && car.nitro < 0.28, `bar ${car.nitro.toFixed(3)}`);
  // karşı direksiyon açıyı küçültür
  run(car, tr, 0.15, input({ throttle: 0, brake: 1, drift: true, steer: -0.4 }));
  const angCounter = car.driftAngle * 180 / Math.PI;
  check('karşı direksiyon açıyı küçültür', angCounter < dAng - 3, `${angCounter.toFixed(1)}°`);
  const ev3 = run(car, tr, 0.4, input({ throttle: 1, brake: 0, drift: false, steer: 0.6 }));
  const end = ev3.find((e) => e.type === 'drift_end');
  check('fren bırakılınca drift_end + duration', end && end.duration > 2, end ? `duration ${end.duration.toFixed(2)} s` : '');
  run(car, tr, 1, input({ steer: 0 }));
  const slip = Math.abs(car.velocity.x * -Math.cos(car.yaw) + car.velocity.z * Math.sin(car.yaw));
  check('drift sonrası tutuş toparlar', slip < 2, `yanal ${slip.toFixed(2)} m/s, hız ${car.speedKmh.toFixed(0)}`);

  const car2 = makeCar(tr, 0, 0, 200);
  const ev4 = run(car2, tr, 0.2, input({ throttle: 0, brake: 1, drift: true, steer: 1 }));
  const ev5 = run(car2, tr, 0.4, input({ throttle: 0, brake: 1, drift: true, steer: 0 }));
  check('direksiyon bırakılınca drift biter', types(ev4).includes('drift_start') && types(ev5).includes('drift_end'));

  const car3 = makeCar(tr, 0, 0, 60);
  const ev6 = run(car3, tr, 0.5, input({ throttle: 0, brake: 1, drift: true, steer: 1 }));
  check('düşük hızda drift yok (fren)', !types(ev6).includes('drift_start') && car3.speedKmh < 60);
}

// ---------------------------------------------------------------------------------------------
console.log('\n# Rampa, tepe, hava');
{
  const tr = new TestTrack(null);
  // Jump rampası (s 430-455, 3.2 m)
  const car = makeCar(tr, 330, 0, 280);
  car.nitro = 0;
  const ev = run(car, tr, 5, input());
  const jump = ev.find((e) => e.type === 'jump');
  const land = ev.find((e) => e.type === 'land');
  check('rampa: jump + land', jump && land, land ? `airTime ${land.airTime.toFixed(2)} s, hard=${land.hard}` : types(ev).join(','));
  check('rampa uçuşu Asphalt gibi uzun (>1 s)', land && land.airTime > 1.0);
  check('hava nitro doldurur', car.nitro > 0.08, `bar ${car.nitro.toFixed(3)}`);
  check('jump rampası barrel roll yapmaz', !types(ev).includes('barrel_roll'));
  const jumpS = jump && jump.t;

  // Tepe: yüksek hızda havalanır
  const car2 = makeCar(tr, 20, 0, 300);
  const ev2 = run(car2, tr, 4, input());
  const lands = ev2.filter((e) => e.type === 'land');
  console.log(`     tepe @300: ${types(ev2).join(',') || '(olay yok)'} ${lands.map((l) => l.airTime.toFixed(2)).join(' ')}`);
  const car2b = makeCar(tr, 20, 0, 120);
  const ev2b = run(car2b, tr, 6, input({ throttle: 0.5 }));
  check('tepe @120 km/s: tümsekte zıplama olayı yok', !types(ev2b).includes('jump'), types(ev2b).join(','));

  // Roll rampası (düzlük B, sağ yarı)
  const sR = tr.ramps[1].s0 - 120;
  const car3 = makeCar(tr, sR, 5, 280);
  const ev3 = run(car3, tr, 5, input());
  check('roll rampası → barrel_roll', types(ev3).includes('barrel_roll'), types(ev3).join(','));
  // Drift halinde roll rampası → flat spin
  const rr = tr.ramps[1];
  const car4 = makeCar(tr, rr.s0 - 60, 1.5, 270);
  const ev4 = run(car4, tr, 4, (t, c) => {
    const ds = c.trackS - rr.s0;
    return ds > rr.s1 - rr.s0 - 26 && ds < rr.s1 - rr.s0 + 3
      ? input({ throttle: 0, brake: 1, drift: true, steer: 1 })
      : input();
  });
  console.log(`     drift+roll: ${types(ev4).join(',')}`);
  check('drift halinde rampadan → flat_spin', types(ev4).includes('flat_spin'));
  console.log(`     (jump t=${jumpS})`);
}

// ---------------------------------------------------------------------------------------------
console.log('\n# Bariyer, wreck, respawn');
{
  const tr = new TestTrack(null);
  // Sığ açıyla sürtünme
  const car = makeCar(tr, 300 + 400, 0, 200); // düzlük A sonu öncesi değil: s=700 viraj başı
  placeOn(car, tr, 500, 6, 200);
  car.yaw -= 0.12; // sağa (lateral +) doğru
  const ev = run(car, tr, 2, input({ steer: 0.15 }));
  const hits = ev.filter((e) => e.type === 'wall_hit');
  let minGap = Infinity;
  for (let i = 1; i < hits.length; i++) minGap = Math.min(minGap, hits[i].t - hits[i - 1].t);
  check('sürtünme wall_hit üretir', hits.length > 2, `${hits.length} olay, sağ=${hits[0]?.side}`);
  check('wall_hit ~0.1 s\'de bir', minGap >= 0.099, `min aralık ${minGap.toFixed(3)} s`);
  check('sürtünmede wreck yok', !types(ev).includes('wreck'));
  check('bariyer içinde kalır', Math.abs(car.lateral) <= tr.width / 2 - car.halfWidth + 0.01, `lateral ${car.lateral.toFixed(2)}`);
  check('wall_hit alanları', hits[0] && hits[0].point instanceof THREE.Vector3 && hits[0].strength >= 0 && hits[0].strength <= 1);

  // Direksiyonsuz virajda dış duvara yaslanma: ceza var ama sürünme yok.
  const carC = makeCar(tr, tr.turn1[0] - 10, 0, 250);
  const evC = run(carC, tr, 4, input());
  check('viraj duvarına sürtünme: hız korunur (>170 km/s), wreck yok',
    carC.speedKmh > 170 && !types(evC).includes('wreck') && types(evC).includes('wall_hit'), `${carC.speedKmh.toFixed(0)} km/s`);
  // 20° darbe: belirgin ama hafif kayıp
  const carI = makeCar(tr, 500, 0, 250);
  carI.yaw -= 0.35;
  carI.velocity.set(Math.sin(carI.yaw) * 250 / KMH, 0, Math.cos(carI.yaw) * 250 / KMH);
  carI.speed = 250 / KMH;
  const evI = run(carI, tr, 0.6, input());
  const hitI = evI.find((e) => e.type === 'wall_hit');
  check('20° darbe: wreck yok, hız kaybı %5-30', !types(evI).includes('wreck') && carI.speedKmh > 175 && carI.speedKmh < 240,
    `${carI.speedKmh.toFixed(0)} km/s, strength ${hitI?.strength.toFixed(2)}`);

  // Kafa kafaya
  const car2 = makeCar(tr, 500, 0, 220);
  car2.yaw -= 1.0; // ~57° sağa
  const sp = car2.speedKmh;
  car2.velocity.set(Math.sin(car2.yaw) * sp / KMH, 0, Math.cos(car2.yaw) * sp / KMH);
  car2.speed = car2.velocity.x * Math.sin(car2.yaw) + car2.velocity.z * Math.cos(car2.yaw);
  const ev2 = run(car2, tr, 0.5, input());
  check('sert açılı çarpma → wreck(wall)', ev2.some((e) => e.type === 'wreck' && e.cause === 'wall'));
  const wreckT = ev2.find((e) => e.type === 'wreck')?.t ?? 0;
  const s0 = car2.trackS;
  const ev3 = [];
  let st = null;
  for (let i = 0; i < 180 && !st; i++) {
    const e = run(car2, tr, DT, input({ steer: 1, nitro: i % 2 === 0 }));
    for (const x of e) { x.t = i * DT; ev3.push(x); }
    if (e.some((x) => x.type === 'respawn')) st = { s: car2.trackS, lat: car2.lateral, kmh: car2.speedKmh, ghost: car2.ghost, yawErr: 0 };
  }
  const resp = ev3.find((e) => e.type === 'respawn');
  check('~2.5 s sonra respawn', resp && Math.abs(resp.t + 0.5 - wreckT - 2.5) < 0.1, resp ? `t=${(resp.t + 0.5 - wreckT).toFixed(2)}` : '');
  const tan = tr.sample(car2.trackS).tangent;
  const yawErr = Math.abs(Math.atan2(Math.sin(car2.yaw - Math.atan2(tan.x, tan.z)), Math.cos(car2.yaw - Math.atan2(tan.x, tan.z))));
  check('respawn: ghost, pist yönünde, ±width/4, ~%35 hız', st && st.ghost && yawErr < 0.05 && Math.abs(st.lat) <= tr.width / 4 + 0.01
    && Math.abs(st.kmh - 0.35 * 290) < 8, st ? `s ${s0.toFixed(1)}→${st.s.toFixed(1)}, lat ${st.lat.toFixed(2)}, ${st.kmh.toFixed(0)} km/s` : '');
  check('wreck sırasında input yok sayılır (nitro yanmadı)', !ev3.some((e) => e.type === 'nitro_start' && e.t < resp?.t));

  const car3 = makeCar(tr, 500, 0, 150);
  car3.wreck('takedown');
  const ev4 = run(car3, tr, 2.6, input());
  const r = ev4.find((e) => e.type === 'respawn');
  check('respawn olayı', !!r);
  check('respawn sonrası ghost = true', car3.ghost === true);
  run(car3, tr, 1.6, input());
  check('ghost 1.5 s sonra biter', car3.ghost === false);
  car3.events.length = 0;
  car3.wreck('takedown');
  car3.wreck('takedown');
  check('wreck() olayı bir kez', car3.events.filter((e) => e.type === 'wreck').length === 1 && car3.wrecked);
  car3.placeAt(new THREE.Vector3(0, 0, 50), 0);
  check('placeAt her şeyi sıfırlar', !car3.wrecked && !car3.ghost && !car3.drifting && !car3.airborne && !car3.nitroActive && car3.velocity.length() === 0);
}

// ---------------------------------------------------------------------------------------------
console.log('\n# Performans');
{
  const tr = new TestTrack(null);
  const cars = [];
  for (let i = 0; i < 8; i++) cars.push(makeCar(tr, 10 + i * 12, (i % 3 - 1) * 5, 200));
  const t0 = performance.now();
  const N = 60 * 30;
  for (let k = 0; k < N; k++) {
    for (const c of cars) {
      c.update(DT, input({ steer: Math.sin(k * 0.01 + c.lateral) * 0.3 }), tr);
      c.events.length = 0;
    }
  }
  const ms = (performance.now() - t0) / N;
  check('8 araba fizik adımı < 1 ms', ms < 1, `${ms.toFixed(3)} ms/adım`);
  const p = cars[0].getRearWheelPositions();
  const e = cars[0].getExhaustPositions();
  check('arka teker ve egzoz konumları sonlu', [...p, ...e].every((v) => Number.isFinite(v.x + v.y + v.z)));
}

console.log(failures ? `\n${failures} BAŞARISIZ` : '\nTümü geçti.');
process.exit(failures ? 1 : 0);
