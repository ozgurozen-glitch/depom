// Car fiziği için başsız (Node) senaryo testleri. Ölçümleri yazdırır, beklentiler tutmazsa çıkış kodu 1.
//   node --import ./tools/cartest/register.mjs tools/cartest/physics.mjs
import * as THREE from 'three';
import { Car, CAR_TUNING } from '../../src/car.js';
import { TestTrack } from './test-track.js';
import { FlatTrack } from './flat-track.js';
import { CARS, getCarDef } from '../../src/cars.js';
import { measureDrift, printDrift } from './drift.mjs';
import { measureCar, deriveStats } from './stats.mjs';

const DT = 1 / 60;
const KMH = 3.6;
let failures = 0;

function check(name, ok, detail) {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

const scene = new THREE.Scene();
const input = (o = {}) => ({ throttle: 1, brake: 0, steer: 0, nitro: false, drift: false, ...o });

let SPEC = null; // null → varsayılan araç (Vortex GT)

function makeCar(track, s, lat = 0, speedKmh = 0) {
  const car = new Car({ scene, color: 0x1677ff, name: 'T', isPlayer: true, spec: SPEC });
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
for (const def of CARS) {
  SPEC = def;
  console.log(`\n# Drift — ${def.name}`);
  const tr = new FlatTrack(5000);
  const car = makeCar(tr, 0, 0, 200);
  car.nitro = 0;
  const ev = run(car, tr, 0.1, input({ throttle: 0, brake: 1, drift: true, steer: 1 }));
  check('fren + direksiyon + hız → drift_start', types(ev).includes('drift_start') && car.drifting);
  let maxAng = 0;
  const v0 = car.speedKmh;
  run(car, tr, 2, (t, c) => { maxAng = Math.max(maxAng, c.driftAngle); return input({ throttle: 0, brake: 1, drift: true, steer: 1 }); });
  const dAng = maxAng * 180 / Math.PI;
  check('drift açısı 30-46°', dAng > 30 && dAng <= 46, `${dAng.toFixed(1)}°`);
  check('drift hızı az düşürür', car.speedKmh > v0 - 35, `${v0.toFixed(0)}→${car.speedKmh.toFixed(0)} km/s`);
  const nRate = (def.tuning && def.tuning.driftNitroRate) || 0.12;
  check(`drift nitro doldurur (~${nRate}/s)`, Math.abs(car.nitro - nRate * 2.1) < 0.04, `bar ${car.nitro.toFixed(3)}`);
  // karşı direksiyon açıyı küçültür
  run(car, tr, 0.35, input({ throttle: 0, brake: 1, drift: true, steer: -0.4 }));
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
  SPEC = null;
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
console.log('\n# Drift yumuşaklığı (gövde açısı: hız ω rad/s, ivme α rad/s²; slip β = gövde/hız açısı)');
{
  // Önceki (sert) modelin Vortex GT için aynı senaryodaki ölçümü (200 km/s, giriş → sol/sağ geçiş → çıkış).
  const BEFORE = { entry: { w: 4.99, a: 299.5 }, flick: { w: 7.57, a: 461.6 }, exit: { w: 0.57, a: 74.0 }, all: { w: 7.57, a: 461.6, sr: 6.07, sa: 344.6 } };
  const r = measureDrift(null);
  printDrift('sonra', r);
  console.log(`     önce  entry ω ${BEFORE.entry.w} / α ${BEFORE.entry.a} | flick ω ${BEFORE.flick.w} / α ${BEFORE.flick.a} | exit α ${BEFORE.exit.a} | tümü β̇ ${BEFORE.all.sr} / β̈ ${BEFORE.all.sa}`);
  const pct = (a, b) => `${((1 - a / b) * 100).toFixed(0)}% düşüş`;
  check('yaw ivmesi tepe ≥ %75 düştü', r.all.a < BEFORE.all.a * 0.25, `${BEFORE.all.a} → ${r.all.a.toFixed(1)} rad/s² (${pct(r.all.a, BEFORE.all.a)})`);
  check('slip ivmesi tepe ≥ %75 düştü', r.all.sa < BEFORE.all.sa * 0.25, `${BEFORE.all.sa} → ${r.all.sa.toFixed(1)} rad/s² (${pct(r.all.sa, BEFORE.all.sa)})`);
  check('yaw hızı tepe ≥ %35 düştü', r.all.w < BEFORE.all.w * 0.65, `${BEFORE.all.w} → ${r.all.w.toFixed(2)} rad/s (${pct(r.all.w, BEFORE.all.w)})`);
  check('slip hızı tepe ≥ %40 düştü', r.all.sr < BEFORE.all.sr * 0.6, `${BEFORE.all.sr} → ${r.all.sr.toFixed(2)} rad/s (${pct(r.all.sr, BEFORE.all.sr)})`);
  check('çıkışta yaw ivmesi ≥ %90 düştü (tutuş kademeli)', r.phases.exit.a < BEFORE.exit.a * 0.1, `${BEFORE.exit.a} → ${r.phases.exit.a.toFixed(1)} rad/s²`);
  for (const def of CARS) {
    const m = measureDrift(def);
    check(`${def.name}: giriş açısı 0.25–0.40 s'de oturur, aşım yok`, m.entry.settle >= 0.25 && m.entry.settle <= 0.4 && m.entry.overshootDeg < 0.5,
      `oturma ${m.entry.settle?.toFixed(2)} s, aşım ${m.entry.overshootDeg.toFixed(2)}°`);
    check(`${def.name}: ivme sınırları (α < 80, β̈ < 70 rad/s²)`, m.all.a < 80 && m.all.sa < 70, `α ${m.all.a.toFixed(1)}, β̈ ${m.all.sa.toFixed(1)}`);
    check(`${def.name}: flick akıcı (slip yeni yönde < 0.6 s, kararlı ≥ 22°)`, m.flick.flipTime !== null && m.flick.flipTime < 0.6 && m.flick.toDeg > 22,
      `geçiş ${m.flick.flipTime?.toFixed(2)} s, ${m.flick.toDeg.toFixed(1)}°`);
    check(`${def.name}: çıkışta slip kademeli söner (0.3–1.0 s)`, m.exit.clearTime > 0.3 && m.exit.clearTime < 1.0, `${m.exit.clearTime?.toFixed(2)} s`);
    check(`${def.name}: drift hız kaybı makul (< 45 km/s / 3.3 s)`, m.speedLoss < 45, `${m.speedLoss.toFixed(0)} km/s`);
  }
  // Analog direksiyon: kararlı drift açısı direksiyonla doğrusal (karşı direksiyon -0.5'e kadar drift yönünü korur)
  const tr = new FlatTrack(5000);
  for (const def of CARS) {
    SPEC = def;
    const T = { ...CAR_TUNING, ...def.tuning };
    const got = [];
    const want = [];
    for (const st of [-0.45, -0.2, 0.2, 0.6, 1]) {
      const c = makeCar(tr, 0, 0, 200);
      run(c, tr, 0.1, input({ throttle: 0, brake: 1, drift: true, steer: 1 }));
      run(c, tr, 1.8, input({ throttle: 0, brake: 1, drift: true, steer: st }));
      got.push(c.driftAngle * 180 / Math.PI);
      want.push((T.driftAngleMin + (T.driftAngleMax - T.driftAngleMin) * (st + 1) / 2) * 180 / Math.PI);
    }
    check(`${def.name}: drift açısı direksiyonla doğrusal (±1°)`, got.every((g, i) => Math.abs(g - want[i]) < 1),
      `${got.map((g) => g.toFixed(1)).join(' / ')}° (beklenen ${want.map((g) => g.toFixed(1)).join(' / ')})`);
  }
  SPEC = null;
}

// ---------------------------------------------------------------------------------------------
console.log('\n# Araç kataloğu: ayarlar, ölçülen performans, stats');
{
  const res = {};
  for (const def of CARS) {
    const m = measureCar(def);
    res[def.id] = m;
    const declared = ((def.tuning && def.tuning.maxSpeed) || CAR_TUNING.maxSpeed) * KMH;
    console.log(`     ${def.name.padEnd(10)} azami ${m.topKmh.toFixed(1)} km/s | 0-100 ${m.t100.toFixed(2)} s | 0-200 ${m.t200.toFixed(2)} s | R@150 ${m.r150.toFixed(1)} m | R@250 ${m.r250.toFixed(1)} m | nitro +${m.nitroGain.toFixed(0)} km/s`);
    check(`${def.name}: azami hız = tuning.maxSpeed`, Math.abs(m.topKmh - declared) < 1.5, `${m.topKmh.toFixed(1)} / ${declared.toFixed(0)} km/s`);
    const car = new Car({ scene, color: def.color, name: 'C', isPlayer: false, spec: def });
    check(`${def.name}: car.maxSpeed = ayarlı azami hız`, Math.abs(car.maxSpeed * KMH - declared) < 0.01, `${(car.maxSpeed * KMH).toFixed(1)}`);
    check(`${def.name}: halfLength/halfWidth model boyutlarından`, car.halfLength > 2 && car.halfWidth > 0.9 && car.halfLength === car.dims.length / 2);
    const st = deriveStats(m);
    for (const k of ['speed', 'accel', 'handling', 'nitro']) {
      check(`${def.name}: stats.${k} ayarla uyumlu`, Math.abs(st[k] - def.stats[k]) <= 0.04, `katalog ${def.stats[k]} / ölçülen ${st[k].toFixed(2)}`);
    }
    car.dispose();
  }
  const [V, R, T] = ['vortex', 'raijin', 'titan'].map((id) => res[id]);
  check('azami hızlar ≈ 270 / 290 / 305 (Raijin / Vortex / Titan)', Math.abs(R.topKmh - 270) < 2 && Math.abs(V.topKmh - 290) < 2 && Math.abs(T.topKmh - 305) < 2);
  check('Raijin: en iyi ivme ve en iyi viraj tutuşu', R.t200 < V.t200 && R.t200 < T.t200 && R.r150 < V.r150 && R.r150 < T.r150);
  check('Titan: en yüksek azami hız, en yavaş ivme, en geniş viraj, en güçlü nitro',
    T.topKmh > V.topKmh && T.topKmh > R.topKmh && T.t200 > V.t200 && T.t200 > R.t200 && T.r150 > V.r150 && T.nitroGain > V.nitroGain && T.nitroGain > R.nitroGain);
  check('CAR_TUNING değişmedi (örnek başına birleşim)', CAR_TUNING.maxSpeed * KMH > 289.9 && CAR_TUNING.maxSpeed * KMH < 290.1 && Object.isFrozen(CAR_TUNING));

  // Model paylaşımı: geometri paylaşılır, boya araba başına
  const a = new Car({ scene, color: 0xff0000, name: 'A', spec: getCarDef('raijin') });
  const b = new Car({ scene, color: 0x00ff00, name: 'B', spec: getCarDef('raijin') });
  const c = new Car({ scene, color: 0x0000ff, name: 'C', spec: getCarDef('titan') });
  check('aynı model: geometri paylaşılır, boya materyali ayrı', a.parts.body.geometry === b.parts.body.geometry && a.parts.paint !== b.parts.paint
    && a.parts.paint.color.getHex() === 0xff0000 && b.parts.paint.color.getHex() === 0x00ff00);
  check('farklı modeller farklı geometri ve boyut', a.parts.body.geometry !== c.parts.body.geometry && a.dims.length !== c.dims.length);

  // POV görünümleri
  const v = new Car({ scene, color: 0xffffff, name: 'V', spec: getCarDef('vortex') });
  for (const car of [a, c, v]) {
    const kids = car.parts.chassis.children;
    const hidden = () => kids.filter((m) => !m.visible).length;
    car.setViewMode('chase');
    const h0 = hidden();
    car.setViewMode('hood');
    const hHood = hidden();
    car.setViewMode('bumper');
    const hBump = hidden();
    const wheelsVisible = [...car.parts.frontWheels, car.parts.rearAxle].every((m) => m.visible);
    car.setViewMode('far');
    const hFar = hidden();
    const an = car.viewAnchors;
    check(`${car.spec.name}: POV — chase/far hepsi görünür, hood 3, bumper 6 parça gizli, tekerlekler görünür`,
      h0 === 0 && hFar === 0 && hHood === 3 && hBump === 6 && wheelsVisible, `gizli: ${h0}/${hHood}/${hBump}/${hFar}`);
    check(`${car.spec.name}: viewAnchors (hood, bumper) sonlu ve doğru yerde`, an.hood instanceof THREE.Vector3 && an.bumper instanceof THREE.Vector3
      && [an.hood, an.bumper].every((p) => Number.isFinite(p.x + p.y + p.z)) && an.hood.y > 0.8 && an.hood.z > 0 && an.bumper.z > car.dims.length / 2 - 0.3 && an.bumper.y < an.hood.y,
      `hood (${an.hood.toArray().join(', ')}) bumper (${an.bumper.toArray().join(', ')})`);
  }
  v.dispose();

  // dispose: mesh + ayrı gölge düzlemi sahneden kalkar; paylaşılan geometri bırakılmaz, boya materyali bırakılır
  const d = new Car({ scene, color: 0xff00ff, name: 'D', spec: getCarDef('titan') });
  d.parts.shadow = d.parts.shadow || new THREE.Mesh(new THREE.PlaneGeometry(1, 1)); // Node'da canvas yok → sahte gölge
  scene.add(d.parts.shadow);
  check('dispose öncesi mesh + gölge sahnede', scene.children.includes(d.mesh) && scene.children.includes(d.parts.shadow));
  let geoDisposed = 0;
  d.parts.body.geometry.addEventListener('dispose', () => geoDisposed++);
  let paintDisposed = 0;
  d.parts.paint.addEventListener('dispose', () => paintDisposed++);
  const shadow = d.parts.shadow;
  d.dispose();
  d.dispose(); // ikinci çağrı zararsız
  check('dispose: mesh ve gölge sahneden kalktı', !scene.children.includes(d.mesh) && !scene.children.includes(shadow));
  check('dispose: paylaşılan geometri bırakılmadı, araca özel boya materyali bırakıldı', geoDisposed === 0 && paintDisposed === 1, `geo ${geoDisposed}, boya ${paintDisposed}`);
  a.dispose(); b.dispose(); c.dispose();
}

// ---------------------------------------------------------------------------------------------
console.log('\n# Slipstream (draft)');
{
  const tr = new FlatTrack(5000);
  for (const def of CARS) {
    SPEC = def;
    const vmax = ((def.tuning && def.tuning.maxSpeed) || CAR_TUNING.maxSpeed) * KMH;
    const c0 = makeCar(tr, 0, 0, 100);
    const c1 = makeCar(tr, 0, 0, 100);
    check(`${def.name}: draft başlangıçta 0`, c0.draft === 0);
    let maxStep = 0;
    let prev = c1.speed;
    for (let i = 0; i < 60 * 25; i++) {
      c0.update(DT, input(), tr);
      c1.draft = 1;
      c1.update(DT, input(), tr);
      maxStep = Math.max(maxStep, Math.abs(c1.speed - prev));
      prev = c1.speed;
    }
    const gain = c1.speedKmh / c0.speedKmh;
    check(`${def.name}: draft=1 azami hızı ~%8 artırır (yumuşak)`, gain > 1.06 && gain < 1.095, `${c0.speedKmh.toFixed(0)} → ${c1.speedKmh.toFixed(0)} km/s (+${((gain - 1) * 100).toFixed(1)}%)`);
    check(`${def.name}: draft hız basamağı üretmez`, maxStep < 0.4, `maks Δv/adım ${maxStep.toFixed(3)} m/s`);
    const a0 = makeCar(tr, 0, 0, 100);
    const a1 = makeCar(tr, 0, 0, 100);
    a1.draft = 1;
    run(a0, tr, 3, input());
    run(a1, tr, 3, input());
    check(`${def.name}: draft ivmeyi artırır`, a1.speedKmh > a0.speedKmh + 1, `${a0.speedKmh.toFixed(1)} → ${a1.speedKmh.toFixed(1)} km/s`);
    c1.draft = 0;
    run(c1, tr, 10, input());
    check(`${def.name}: draft kalkınca azami hıza geri döner`, Math.abs(c1.speedKmh - vmax) < 3, `${c1.speedKmh.toFixed(1)} km/s`);
  }
  SPEC = null;
}

// ---------------------------------------------------------------------------------------------
console.log('\n# Performans');
{
  const tr = new TestTrack(null);
  const cars = [];
  for (let i = 0; i < 8; i++) { SPEC = CARS[i % CARS.length]; cars.push(makeCar(tr, 10 + i * 12, (i % 3 - 1) * 5, 200)); }
SPEC = null;
  const t0 = performance.now();
  const N = 60 * 30;
  for (let k = 0; k < N; k++) {
    for (const c of cars) {
      c.update(DT, input({ steer: Math.sin(k * 0.01 + c.lateral) * 0.3 }), tr);
      c.events.length = 0;
    }
  }
  const ms = (performance.now() - t0) / N;
  check('8 araba (karışık modeller) fizik adımı < 1 ms', ms < 1, `${ms.toFixed(3)} ms/adım`);
  const p = cars[0].getRearWheelPositions();
  const e = cars[0].getExhaustPositions();
  check('arka teker ve egzoz konumları sonlu', [...p, ...e].every((v) => Number.isFinite(v.x + v.y + v.z)));
}

console.log(failures ? `\n${failures} BAŞARISIZ` : '\nTümü geçti.');
process.exit(failures ? 1 : 0);
