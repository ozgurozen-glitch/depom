// CollisionSystem birim testleri (slipstream + mevcut takedown/bump/near_miss davranışı).
//   node --import ./tools/aisim/register.mjs tools/aisim/collisions.test.mjs
import * as THREE from 'three';
import { CollisionSystem } from '../../src/collisions.js';
import { makeTrack } from './tracks.mjs';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

function makeCar(name, { x = 0, z = 0, yaw = 0, speed = 40, isPlayer = false } = {}) {
  const c = {
    name, isPlayer,
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed),
    yaw, speed, halfLength: 2.3, halfWidth: 1, radius: 2.2,
    wrecked: false, ghost: false, airborne: false, nitroActive: false, nitroLevel: null,
    trackS: z, lateral: -x, draft: 0,
    applyImpulse(v) { this.velocity.add(v); },
    wreck(cause) { this.wrecked = true; this.wreckCause = cause; },
  };
  return c;
}

const DT = 1 / 60;
function step(cs, cars, n = 1, track = null, collect = null) {
  let all = collect;
  for (let i = 0; i < n; i++) {
    const ev = cs.update(DT, cars, track);
    if (all) for (const e of ev) all.push(e);
    // araçları ilerlet
    for (const c of cars) {
      if (c.wrecked) continue;
      c.position.x += c.velocity.x * DT;
      c.position.z += c.velocity.z * DT;
      c.trackS = c.position.z;
      c.lateral = -c.position.x;
    }
  }
  return all;
}
const count = (ev, type) => ev.filter((e) => e.type === type).length;

console.log('\n# Slipstream');
{
  const cs = new CollisionSystem();
  const A = makeCar('A', { z: 0 });
  const B = makeCar('B', { z: 15 });
  const ev = [];
  step(cs, [A, B], 36, null, ev); // 0.6 s
  const target = 0.3 + 0.7 * (1 - (15 - 4) / 31);
  check('draft 0.6 s sonra hedefe yakın', near(A.draft, target, 0.03), `draft=${A.draft.toFixed(3)} hedef=${target.toFixed(3)}`);
  check('öndeki araba draft almaz', B.draft === 0);
  check('slipstream_start bir kez', count(ev, 'slipstream_start') === 1 && ev[0].car === A && ev[0].other === B);
  step(cs, [A, B], 60, null, ev);
  check('kararlı durumda ek olay yok', count(ev, 'slipstream_start') === 1 && count(ev, 'slipstream_end') === 0);
  // yükselme süresi: 0 → ~0.3 yaklaşık 0.18 s
  const cs2 = new CollisionSystem();
  const A2 = makeCar('A', { z: 0 });
  const B2 = makeCar('B', { z: 6 }); // çok yakın → hedef ≈ 0.94
  step(cs2, [A2, B2], 18);
  check('0.3 s sonra yaklaşık yarıya (yükselme ~0.6 s)', near(A2.draft, 0.5, 0.06), `draft=${A2.draft.toFixed(3)}`);
  // sönme
  B.position.z = 500;
  const ev2 = [];
  step(cs, [A, B], 12, null, ev2); // 0.2 s
  check('0.2 s sonra yaklaşık yarı (sönme ~0.4 s)', near(A.draft, target - 0.5, 0.12), `draft=${A.draft.toFixed(3)}`);
  step(cs, [A, B], 30, null, ev2);
  check('sönünce slipstream_end bir kez', A.draft === 0 && count(ev2, 'slipstream_end') === 1 && ev2[0].car === A && ev2[0].other === B);
}
{
  const t = (label, a, b, expectDraft) => {
    const cs = new CollisionSystem();
    const A = makeCar('A', a);
    const B = makeCar('B', b);
    if (a.mod) a.mod(A);
    if (b.mod) b.mod(B);
    step(cs, [A, B], 1);
    // araçlar ilerlerken konumlar değişmesin: yalnızca bir adım sonra hedefe bakmak için draft > 0 mı?
    step(cs, [A, B], 40);
    check(label, expectDraft ? A.draft > 0.2 : A.draft === 0, `draft=${A.draft.toFixed(3)}`);
  };
  t('100 km/s altında draft yok', { z: 0, speed: 25 }, { z: 15, speed: 25 }, false);
  t('100 km/s üstünde draft var', { z: 0, speed: 29 }, { z: 15, speed: 29 }, true);
  t('yanal 2.0 m → draft', { z: 0 }, { z: 15, x: 2.0 }, true);
  t('yanal 2.5 m → draft yok', { z: 0 }, { z: 15, x: 2.5 }, false);
  t('3 m önde (çok yakın) → draft yok', { z: 0 }, { z: 3, x: 1.9 }, false);
  t('34 m önde → draft var', { z: 0 }, { z: 34 }, true);
  t('40 m önde → draft yok', { z: 0 }, { z: 40 }, false);
  t('arkadaki araba draft vermez', { z: 15 }, { z: 0 }, false);
  t('devrilmiş araba draft vermez', { z: 0 }, { z: 15, mod: (c) => { c.wrecked = true; } }, false);
  t('ghost araba draft vermez', { z: 0 }, { z: 15, mod: (c) => { c.ghost = true; } }, false);
  t('havadaki araba draft vermez', { z: 0 }, { z: 15, mod: (c) => { c.airborne = true; } }, false);
  t('ghost araba draft almaz', { z: 0, mod: (c) => { c.ghost = true; } }, { z: 15 }, false);
  t('havadaki araba draft almaz', { z: 0, mod: (c) => { c.airborne = true; } }, { z: 15 }, false);
  t('ters yöne giden araba draft vermez', { z: 0 }, { z: 15, yaw: Math.PI, speed: 40 }, false);
  t('durmuş araba draft vermez', { z: 0 }, { z: 15, speed: 0 }, false);
}
{
  // wreck: anında sıfırlanır ve end olayı gelir
  const cs = new CollisionSystem();
  const A = makeCar('A', { z: 0 });
  const B = makeCar('B', { z: 15 });
  const ev = [];
  step(cs, [A, B], 60, null, ev);
  A.wrecked = true;
  step(cs, [A, B], 1, null, ev);
  check('wreck olunca draft anında 0 + end olayı', A.draft === 0 && count(ev, 'slipstream_end') === 1);
}
{
  // histerezis: sınırda gidip gelen öndeki araba çok sayıda olay üretmemeli
  const cs = new CollisionSystem();
  const A = makeCar('A', { z: 0 });
  const B = makeCar('B', { z: 20 });
  const ev = [];
  for (let i = 0; i < 600; i++) {
    B.position.x = Math.floor(i / 12) % 2 === 0 ? 2.1 : 2.3;
    step(cs, [A, B], 1, null, ev);
    B.position.z = A.position.z + 20; // mesafe sabit
  }
  const starts = count(ev, 'slipstream_start');
  const ends = count(ev, 'slipstream_end');
  check('sınırda titreşimde açık dönem başına en çok bir olay', starts <= 26 && ends <= 26 && Math.abs(starts - ends) <= 1, `starts=${starts} ends=${ends}`);
  // 0..1 aralığı
  let ok = true;
  const cs2 = new CollisionSystem();
  const C = makeCar('C', { z: 0 });
  const D = makeCar('D', { z: 20 });
  for (let i = 0; i < 500; i++) {
    D.position.z = C.position.z + 4 + (i % 40);
    step(cs2, [C, D], 1);
    if (!(C.draft >= 0 && C.draft <= 1)) ok = false;
  }
  check('draft her zaman 0..1', ok);
  // tek araba / boş dizi
  const E = makeCar('E');
  E.draft = 0.7;
  cs2.update(DT, [E], null);
  check('tek araba: draft 0', E.draft === 0);
}
{
  // sıcak yolda bellek ayırma yok (olay olmayan adımlar)
  const cs = new CollisionSystem();
  const cars = [];
  for (let i = 0; i < 8; i++) cars.push(makeCar(`C${i}`, { x: (i % 2) * 6 - 3, z: i * 12 }));
  for (let i = 0; i < 2000; i++) cs.update(DT, cars, null);
  global.gc && global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 200000; i++) cs.update(DT, cars, null);
  const dh = process.memoryUsage().heapUsed - h0;
  check('200k adımda yığın büyümesi < 6 MB', dh < 6e6, `${(dh / 1e6).toFixed(2)} MB`);
}

console.log('\n# Mevcut davranış');
{
  // arkadan hızlı çarpma → takedown + bump
  const cs = new CollisionSystem();
  const A = makeCar('A', { z: 0, speed: 50 });
  const B = makeCar('B', { z: 4.2, speed: 35 }); // kutular çakışıyor
  const ev = [];
  step(cs, [A, B], 2, null, ev);
  check('arkadan 15 m/s kapanma: takedown', count(ev, 'takedown') === 1 && B.wrecked && ev.find((e) => e.type === 'takedown').car === A);
  check('takedown ile bump olayı', count(ev, 'bump') >= 1);
}
{
  // yavaş sürtme: bump yok / takedown yok
  const cs = new CollisionSystem();
  const A = makeCar('A', { z: 0, speed: 40 });
  const B = makeCar('B', { z: 4.2, speed: 39.5 });
  const ev = [];
  step(cs, [A, B], 2, null, ev);
  check('hafif temas: takedown yok', count(ev, 'takedown') === 0 && !B.wrecked);
}
{
  // oyuncuya karşı bot eşiği 1.4 kat: 8 m/s yeterli değil
  const cs = new CollisionSystem();
  const A = makeCar('A', { z: 0, speed: 48 });
  const B = makeCar('P', { z: 4.2, speed: 40, isPlayer: true });
  const ev = [];
  step(cs, [A, B], 2, null, ev);
  check('bot oyuncuyu 8 m/s ile devirmez (eşik 9.8)', count(ev, 'takedown') === 0);
}
{
  // near miss: oval üzerinde yan yana geçiş (yanal boşluk ~0.8 m)
  const track = makeTrack('oval');
  const cs = new CollisionSystem();
  const mk = (name, s, lat, speed) => {
    const smp = track.sample(s);
    const c = makeCar(name, { speed });
    c.position.copy(smp.pos).addScaledVector(smp.right, lat);
    c.yaw = Math.atan2(smp.tangent.x, smp.tangent.z);
    c.velocity.set(Math.sin(c.yaw) * speed, 0, Math.cos(c.yaw) * speed);
    c.trackS = s;
    c.lateral = lat;
    return c;
  };
  const A = mk('A', 70, -1.5, 60);
  const B = mk('B', 80, 1.5, 40); // yanal merkez farkı 3 m, kutu genişliği 2 → boşluk 1 m
  const ev = [];
  for (let i = 0; i < 90; i++) {
    for (const c of [A, B]) {
      c.position.x += c.velocity.x * DT;
      c.position.z += c.velocity.z * DT;
      c.trackS += c.speed * DT;
    }
    for (const e of cs.update(DT, [A, B], track)) ev.push(e);
  }
  check('near_miss üretilir', count(ev, 'near_miss') === 1 && ev.find((e) => e.type === 'near_miss').car === A, JSON.stringify(ev.map((e) => e.type)));
}

console.log(failures ? `\n${failures} test BAŞARISIZ` : '\nTüm testler geçti');
process.exit(failures ? 1 : 0);
