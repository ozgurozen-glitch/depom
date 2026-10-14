// Senaryo testleri: takılma (duvara burun), ters dönme ve wreck sonrası toparlanma.
//   node --import ./tools/aisim/register.mjs tools/aisim/scenarios.mjs [--track hard2] [--radius 8]
import * as THREE from 'three';
import { BotDriver } from '../../src/ai.js';
import { CollisionSystem } from '../../src/collisions.js';
import { getRacingLine } from '../../src/ai/racingLine.js';
import { makeTrack } from './tracks.mjs';
import { MODELS } from './sim.mjs';

const argv = process.argv.slice(2);
const opt = { track: 'hard2', radius: '8', models: 'vortex,speedster,gripper', diff: 'easy,normal,hard' };
for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = argv[i + 1];

const DT = 1 / 60;
let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

const classes = new Map();
async function carClass(model) {
  if (!classes.has(model)) {
    const tune = encodeURIComponent(JSON.stringify(MODELS[model] || {}));
    classes.set(model, (await import(new URL(`../../src/car.js?tune=${tune}`, import.meta.url).href)).Car);
  }
  return classes.get(model);
}

async function setup(model, diff, trackId, radius) {
  const track = makeTrack(trackId, { radius: Number(radius) });
  const Car = await carClass(model);
  const scene = new THREE.Scene();
  const car = new Car({ scene, color: 0xff0000, name: 'T', isPlayer: false });
  const driver = new BotDriver(car, track, { skill: 0.9, aggression: 0.3, preferredLane: 0, difficulty: diff });
  return { track, car, driver, scene };
}

function place(track, car, s, lat, yawOffset, speed) {
  const smp = track.sample(s);
  const pos = smp.pos.clone().addScaledVector(smp.right, lat);
  const yaw = Math.atan2(smp.tangent.x, smp.tangent.z) + yawOffset;
  car.placeAt(pos, yaw);
  car.update(DT, { throttle: 0, brake: 0, steer: 0, nitro: false, drift: false }, track);
  car.events.length = 0;
  car.trackS = s;
  car.prevS = s;
  car.raceDistance = s;
  car.lap = 0;
  car.finished = false;
  car.nitro = 0.3;
  if (speed) car.applyImpulse(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(speed));
}

function run(env, seconds, fn) {
  const { track, car, driver } = env;
  const cars = [car];
  const log = { wrecks: 0, wallHits: 0, t: 0 };
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const ctx = { cars, player: null, raceStarted: true };
    const inp = driver.getInput(DT, ctx);
    car.update(DT, inp, track);
    car.raceDistance += 0; // ilerleme bu testte önemsiz
    for (const e of car.events) {
      if (e.type === 'wreck') log.wrecks++;
      if (e.type === 'wall_hit') log.wallHits++;
    }
    car.events.length = 0;
    log.t = (i + 1) * DT;
    if (fn && fn(log, i)) break;
  }
  return log;
}

const models = opt.models.split(',');
const diffs = opt.diff.split(',');

console.log(`\n# Duvara burun (takılma) — pist=${opt.track} R=${opt.radius}`);
for (const model of models) {
  for (const diff of diffs) {
    for (const [name, lat, yawOff] of [['duvara dik', 8.6, -Math.PI / 2], ['duvara 45°', 8.6, -Math.PI / 4], ['ters (180°)', 0, Math.PI], ['sola dik', -8.6, Math.PI / 2]]) {
      for (const s0 of [250, 598]) {
        const env = await setup(model, diff, opt.track, opt.radius);
        const line = getRacingLine(env.track);
        // s0: düzlük (250) ve köşe (≈ 598: R=8 köşenin başı)
        place(env.track, env.car, s0, lat, yawOff, 0);
        env.driver.raceClock = 10; // yarış başlangıcı sonrası
        let recoveredAt = null;
        const log = run(env, 12, (lg) => {
          const smp = line.tangentAt(env.car.trackS, { x: 0, z: 0 });
          const dot = Math.sin(env.car.yaw) * smp.x + Math.cos(env.car.yaw) * smp.z;
          if (recoveredAt === null && env.car.speed > 12 && dot > 0.8 && Math.abs(env.car.lateral) < 9) recoveredAt = lg.t;
          return false;
        });
        const ok = recoveredAt !== null && recoveredAt < 6;
        check(`${model}/${diff} ${name} s=${s0}`, ok, recoveredAt === null ? 'toparlanamadı' : `${recoveredAt.toFixed(1)} s`);
      }
    }
  }
}

console.log('\n# Wreck sonrası toparlanma (respawn → 100 km/s)');
for (const model of models) {
  for (const diff of diffs) {
    const env = await setup(model, diff, opt.track, opt.radius);
    place(env.track, env.car, 100, 0, 0, 40);
    env.driver.raceClock = 10;
    run(env, 8, null); // hızlan
    env.car.wreck('takedown');
    let respawnAt = null;
    let t100 = null;
    let t200 = null;
    run(env, 12, (lg) => {
      if (respawnAt === null && !env.car.wrecked && env.car.ghost) respawnAt = lg.t;
      if (respawnAt !== null) {
        if (t100 === null && env.car.speed * 3.6 >= 100) t100 = lg.t - respawnAt;
        if (t200 === null && env.car.speed * 3.6 >= 200) t200 = lg.t - respawnAt;
      }
      return false;
    });
    check(`${model}/${diff} respawn sonrası toparlanma`, respawnAt !== null && t100 !== null && t100 < 3, `respawn ${respawnAt && respawnAt.toFixed(1)} s, 100 km/s: ${t100 && t100.toFixed(1)} s, 200 km/s: ${t200 ? t200.toFixed(1) : '-'} s`);
  }
}

console.log('\n# Shockwave (zor): bar dolu, düzlükte 50-70 m önde rakip');
for (const model of models) {
  const diff = 'hard';
  const env = await setup(model, diff, 'oval', 8);
  const Car = await carClass(model);
  const rival = new Car({ scene: env.scene, color: 0x00ff00, name: 'R', isPlayer: false });
  place(env.track, env.car, 200, 0, 0, 55);
  place(env.track, rival, 270, 0, 0, 45);
  env.car.nitro = 1;
  env.driver.raceClock = 30;
  const cs = new CollisionSystem();
  const cars = [env.car, rival];
  let shockAt = null;
  let takedownAt = null;
  const noIn = { throttle: 0, brake: 0, steer: 0, nitro: false, drift: false };
  for (let i = 0; i < 60 * 12; i++) {
    const ctx = { cars, player: null, raceStarted: true };
    env.car.update(DT, env.driver.getInput(DT, ctx), env.track);
    rival.update(DT, { ...noIn, throttle: 0.6 }, env.track);
    for (const e of cs.update(DT, cars, env.track)) if (e.type === 'takedown' && takedownAt === null) takedownAt = (i * DT).toFixed(1);
    for (const e of env.car.events) if (e.type === 'nitro_start' && e.level === 'shockwave' && shockAt === null) shockAt = (i * DT).toFixed(1);
    env.car.events.length = 0;
    rival.events.length = 0;
  }
  check(`${model}/hard shockwave atar`, shockAt !== null, shockAt !== null ? `${shockAt} s, takedown: ${takedownAt || 'yok'}` : 'atmadı');
}

console.log('\n# Savunma + sollama: uzun düzlükte yavaş öndeki (zor) ve arkadan yaklaşan hızlı araba (mixed pisti)');
for (const [lm, fm] of [['gripper', 'speedster'], ['vortex', 'speedster'], ['gripper', 'vortex']]) {
  const track = makeTrack('mixed');
  const scene = new THREE.Scene();
  const mk = async (model, name, diff, skill) => {
    const Car = await carClass(model);
    const car = new Car({ scene, color: 0xff0000, name, isPlayer: false });
    const driver = new BotDriver(car, track, { skill, aggression: 0.1, preferredLane: 0, difficulty: diff });
    return { car, driver };
  };
  const L = await mk(lm, 'L', 'hard', 0.9);
  const F = await mk(fm, 'F', 'hard', 1);
  place(track, L.car, track.length - 290, 0, 0, 62);
  place(track, F.car, track.length - 335, 3, 0, 66);
  for (const d of [L.driver, F.driver]) {
    d.racing = true;
    d.resetState();
    d.raceClock = 30;
    d.defendCooldown = 0;
    d.otCooldown = 0;
  }
  const cs = new CollisionSystem();
  const cars = [L.car, F.car];
  const latHist = [];
  let bumps = 0;
  let takedowns = 0;
  let slipStart = 0;
  let passedAt = null;
  let defSteps = 0;
  let defFlips = 0;
  let defRate = 0;
  let defMaxAbs = 0;
  let prevCur = null;
  let prevDirD = 0;
  for (let i = 0; i < 60 * 10.5; i++) {
    const ctx = { cars, player: null, raceStarted: true };
    L.car.update(DT, L.driver.getInput(DT, ctx), track);
    F.car.update(DT, F.driver.getInput(DT, ctx), track);
    for (const e of cs.update(DT, cars, track)) {
      if (e.type === 'bump') bumps++;
      if (e.type === 'takedown') takedowns++;
      if (e.type === 'slipstream_start' && e.car === F.car) slipStart++;
    }
    L.car.events.length = 0;
    F.car.events.length = 0;
    if (L.driver.defendActive) {
      defSteps++;
      const dcur = L.driver.defendCur;
      if (prevCur !== null) {
        const dd = dcur - prevCur;
        if (Math.abs(dd) > 1e-6) {
          const sg = Math.sign(dd);
          if (prevDirD !== 0 && sg !== prevDirD) defFlips++;
          prevDirD = sg;
        }
        defRate = Math.max(defRate, Math.abs(dd) / DT);
      }
      prevCur = dcur;
      defMaxAbs = Math.max(defMaxAbs, Math.abs(dcur));
    } else {
      prevCur = null;
      prevDirD = 0;
    }
    if (i % 15 === 0) { latHist.push(L.car.lateral); if (process.env.SCEN_DEBUG) console.log((i * DT).toFixed(2), 'L s', L.car.trackS.toFixed(0), 'lat', L.car.lateral.toFixed(1), 'v', (L.car.speed * 3.6).toFixed(0), L.driver.defendActive ? 'DEF' : '---', 'F lat', F.car.lateral.toFixed(1), 'v', (F.car.speed * 3.6).toFixed(0), 'ot', F.driver.otState, 'dr', F.car.draft.toFixed(2)); }
    let ds = F.car.trackS - L.car.trackS;
    ds -= Math.round(ds / track.length) * track.length;
    if (passedAt === null && ds > 6) passedAt = (i * DT).toFixed(1);
  }
  // lider yanal hız yön değişimleri (> 0.4 m/s) ve en büyük yanal sapma
  let maxAbs = 0;
  let maxLatSpeed = 0;
  for (let i = 1; i < latHist.length; i++) {
    maxAbs = Math.max(maxAbs, Math.abs(latHist[i]));
    maxLatSpeed = Math.max(maxLatSpeed, Math.abs(latHist[i] - latHist[i - 1]) / 0.25);
  }
  const ok = takedowns === 0 && defFlips === 0 && defRate < 3 && defMaxAbs < 7.2 && L.driver.stats.defend <= 2 && L.driver.stats.defend >= 1;
  check(`lider ${lm} / takipçi ${fm}`, ok, `savunma ${L.driver.stats.defend}, takip ${F.driver.stats.follow}, sollama ${F.driver.stats.overtake}, geçiş ${passedAt || '-'} s, slip başlangıç ${slipStart}, bump ${bumps}, takedown ${takedowns}, savunma süresi ${(defSteps * DT).toFixed(1)} s, hedef yön değişimi ${defFlips}, hedef maks yanal hız ${defRate.toFixed(1)} m/s, hedef maks |lat| ${defMaxAbs.toFixed(1)}`);
}

console.log(failures ? `\n${failures} senaryo BAŞARISIZ` : '\nTüm senaryolar geçti');
process.exit(failures ? 1 : 0);
