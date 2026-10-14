// Başsız yarış simülasyonu: gerçek Car fiziği + gerçek BotDriver + gerçek CollisionSystem, Game.step sırasıyla.
// Game, HUD, ses ve çizim yok. Farklı hız/tutuşta araç modelleri src/car.js'in ayarlı kopyalarıyla (hooks.mjs) üretilir.
import * as THREE from 'three';
import { BotDriver } from '../../src/ai.js';
import { CollisionSystem } from '../../src/collisions.js';
import { makeTrack } from './tracks.mjs';
import { makeRealTrack } from './realtrack.mjs';
import { getRacingLine } from '../../src/ai/racingLine.js';

const DT = 1 / 60;
const KMH = 1 / 3.6;

// Araç modelleri: oyunun gerçek araç kataloğu (src/cars.js); her model src/car.js ile spec olarak kurulur.
import { Car } from '../../src/car.js';
import { CARS } from '../../src/cars.js';
export const MODELS = Object.fromEntries(CARS.map((c) => [c.id, c]));
let coldCounter = 0;
/** [Car, spec] — cold: spec kopyalanır (→ yeni öğrenilmiş araç modeli; "soğuk başlangıç" ölçümleri için). */
export function makeCarFactory(cold) {
  const specs = new Map();
  return (model, extra) => {
    let spec = specs.get(model);
    if (!spec) {
      spec = cold ? { ...MODELS[model], _cold: ++coldCounter } : MODELS[model];
      specs.set(model, spec);
    }
    return new Car({ ...extra, spec });
  };
}

const DIFF_SHIFT = { easy: -0.14, normal: 0, hard: 0.06 }; // game.js DIFFICULTIES ile aynı
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export function botOptions(i, count, difficulty) {
  const base = 0.95 - (i / Math.max(1, count - 1)) * 0.35;
  return {
    skill: clamp(base + (DIFF_SHIFT[difficulty] ?? 0), 0.3, 1),
    aggression: 0.3 + ((i * 37) % 10) / 15,
    preferredLane: ((i % 3) - 1) * 0.5,
    difficulty,
  };
}

/**
 * opts: { track, trackOpts, laps, difficulty, bots (sayı), models: [model adları, botlar için döngü],
 *         playerModel, player: 'none' | 'normal' | 'same', solo: bool, maxTime, seedOffset }
 */
export async function runRace(opts) {
  const {
    track: trackId = 'oval', trackOpts = {}, laps = 2, difficulty = 'normal', bots = 7,
    models = ['raijin', 'titan', 'vortex'], playerModel = 'vortex', player: playerMode = 'normal', solo = false,
    maxTime = 0, verbose = false,
  } = opts;
  const track = trackId === 'riviera' || trackId === 'bangkok' ? await makeRealTrack(trackId) : makeTrack(trackId, trackOpts);
  const L = track.length;
  const scene = new THREE.Scene();
  const collisions = new CollisionSystem();

  const mkCar = makeCarFactory(opts.cold === true);
  const entries = []; // { car, driver, model, idx, m }
  const nBots = solo ? 1 : bots;
  for (let i = 0; i < nBots; i++) {
    const model = models[i % models.length];
    const car = mkCar(model, { scene, color: 0xff0000, name: `B${i}`, isPlayer: false });
    const driver = new BotDriver(car, track, botOptions(solo ? (opts.botIndex ?? 0) : i, solo ? 7 : bots, difficulty));
    entries.push({ car, driver, model, bot: true, name: `B${i}:${model}` });
  }
  let playerEntry = null;
  if (!solo && playerMode !== 'none') {
    const car = mkCar(playerModel, { scene, color: 0x1677ff, name: 'SEN', isPlayer: true });
    const driver = new BotDriver(car, track, playerMode === 'same'
      ? { skill: 0.9, aggression: 0.5, preferredLane: 0, difficulty }
      : { skill: 0.9, aggression: 0.5, preferredLane: 0 });
    playerEntry = { car, driver, model: playerModel, bot: false, name: `SEN:${playerModel}` };
    entries.push(playerEntry);
  }
  const cars = entries.map((e) => e.car);
  const player = playerEntry ? playerEntry.car : null;

  // ızgara
  const grid = track.getStartGrid(cars.length);
  const NO_INPUT = { throttle: 0, brake: 0, steer: 0, nitro: false, drift: false };
  entries.forEach((e, i) => {
    const car = e.car;
    car.placeAt(grid[i].pos, grid[i].yaw);
    car.update(DT, NO_INPUT, track);
    car.events.length = 0;
    car.nitro = 0.3;
    const s0 = track.project(car.position).s;
    car.trackS = s0;
    car.prevS = s0;
    car.raceDistance = s0 > L / 2 ? s0 - L : s0;
    car.lap = 0;
    car.place = i + 1;
    car.finished = false;
    car.finishTime = null;
    e.m = {
      lapTimes: [], incidents: [], lastLapAt: 0, wallHits: 0, wallHard: 0, wrecks: 0, wreckWall: 0, wreckTakedown: 0,
      stuck: 0, reverse: 0, takedowns: 0, bumps: 0, slipStarts: 0, slipTime: 0, slipEnds: 0, nearMiss: 0,
      stuckT: 0, stuckGrace: 0, revT: 0, revFlag: false, stuckFlag: false, topKmh: 0, sumSpeed: 0, steps: 0,
      nitroStarts: 0, perfect: 0, shock: 0, driverMs: 0, driverCalls: 0, wallSteps: 0, maxDraft: 0, driftSteps: 0,
    };
  });

  const ctxBase = { cars, player, raceStarted: true };
  const T = maxTime || (laps * L) / 16 + 90;
  let time = 0;
  let finished = 0;
  const finishOrder = [];
  let slipEvents = 0;
  const trace = opts.trace ? [] : null;

  for (let step = 0; step < T / DT; step++) {
    time += DT;
    const ctx = { ...ctxBase };
    for (const e of entries) {
      const t0 = performance.now();
      const inp = e.driver.getInput(DT, ctx);
      const dtc = performance.now() - t0;
      e.m.driverMs += dtc;
      e.m.driverCalls++;
      if (step > 1200) (e.m.callUs || (e.m.callUs = [])).push(dtc * 1000);
      e.car.update(DT, inp, track);
    }
    const ev = collisions.update(DT, cars, track) || [];
    for (const evt of ev) {
      if (evt.type === 'takedown') {
        evt.car.addNitro(0.35);
        const e = entries.find((x) => x.car === evt.car);
        if (e) {
          e.m.takedowns++;
          if (e.driver.attackTarget === evt.victim || e.driver.attackPhase) e.m.tdIntent = (e.m.tdIntent || 0) + 1;
          else if (e.car.nitroLevel === 'shockwave') e.m.tdShock = (e.m.tdShock || 0) + 1;
          else {
            e.m.tdAccident = (e.m.tdAccident || 0) + 1;
            const d = e.driver;
            const vd = entries.find((x) => x.car === evt.victim);
            (e.m.tdLog || (e.m.tdLog = [])).push({
              t: +time.toFixed(1), s: Math.round(e.car.trackS), att: e.name, vic: vd ? vd.name : '?',
              ot: d.otState, side: d.otSide, avoid: d.avoidActive, defend: d.defendActive, lapse: d.lapseKind,
              vA: Math.round(e.car.speed * 3.6), vV: Math.round(evt.victim.speed * 3.6),
              latA: +e.car.lateral.toFixed(1), latV: +evt.victim.lateral.toFixed(1),
              ds: +(((evt.victim.trackS - e.car.trackS + L * 1.5) % L) - L / 2).toFixed(1),
              rel: +Math.hypot(evt.victim.velocity.x - e.car.velocity.x, evt.victim.velocity.z - e.car.velocity.z).toFixed(1),
              dYaw: +(((evt.victim.yaw - e.car.yaw + 3 * Math.PI) % (2 * Math.PI) - Math.PI) * 57.3).toFixed(0),
              kap: +(1 / Math.max(1e-6, Math.abs(getRacingLine(track).curvatureAt(e.car.trackS)))).toFixed(0),
              vicOt: vd ? vd.driver.otState : '', vicDef: vd ? vd.driver.defendActive : '', vicAvoid: vd ? vd.driver.avoidActive : '',
            });
          }
          const v = entries.find((x) => x.car === evt.victim);
          if (v && !v.bot) e.m.tdOnPlayer = (e.m.tdOnPlayer || 0) + 1;
        }
      } else if (evt.type === 'near_miss') {
        evt.car.addNitro(0.05);
        const e = entries.find((x) => x.car === evt.car);
        if (e) e.m.nearMiss++;
      } else if (evt.type === 'bump') {
        const e = entries.find((x) => x.car === evt.car);
        if (e) e.m.bumps++;
        for (const x of entries) if (x.car === evt.car || x.car === evt.other) x.m.lastBumpT = time;
      } else if (evt.type === 'slipstream_start') {
        const e = entries.find((x) => x.car === evt.car);
        if (e) e.m.slipStarts++;
        slipEvents++;
      } else if (evt.type === 'slipstream_end') {
        const e = entries.find((x) => x.car === evt.car);
        if (e) e.m.slipEnds++;
      }
    }
    // pickup'lar
    for (const p of track.pickups) {
      if (!p.active) {
        if (time >= p.respawnAt) p.active = true;
        continue;
      }
      for (const c of cars) {
        if (c.wrecked) continue;
        let ds = c.trackS - p.s;
        ds -= Math.round(ds / L) * L;
        if (ds * ds + (c.lateral - p.lateral) ** 2 < 3.2 * 3.2) {
          c.addNitro(0.25);
          p.active = false;
          p.respawnAt = time + 12;
          break;
        }
      }
    }
    // yarış ilerlemesi
    for (const e of entries) {
      const car = e.car;
      let ds = car.trackS - car.prevS;
      if (ds < -L / 2) ds += L;
      else if (ds > L / 2) ds -= L;
      car.prevS = car.trackS;
      car.raceDistance += ds;
      const m = e.m;
      // olaylar
      for (const evt of car.events) {
        switch (evt.type) {
          case 'wall_hit':
            m.wallHits++;
            if (evt.strength > 0.5) m.wallHard++;
            if (evt.strength > 0.5) {
              if (time - (m.lastBumpT ?? -9) < 1.2) m.wallAfterBump = (m.wallAfterBump || 0) + 1;
              else if (e.driver.avoidActive || e.driver.otState || e.driver.defendActive) m.wallDuringManeuver = (m.wallDuringManeuver || 0) + 1;
              else m.wallClean = (m.wallClean || 0) + 1;
            }
            if (m.incidents.length < 400) m.incidents.push({ k: evt.strength > 0.5 ? 'hard' : 'wall', str: +evt.strength.toFixed(2), s: Math.round(car.trackS), kmh: Math.round(car.speed * 3.6), t: +time.toFixed(1), lat: +car.lateral.toFixed(1) });
            break;
          case 'wreck':
            m.wrecks++;
            if (m.incidents.length < 60) m.incidents.push({ k: `wreck-${evt.cause}`, s: Math.round(car.trackS), kmh: Math.round(car.speed * 3.6), t: +time.toFixed(1), lat: +car.lateral.toFixed(1) });
            if (evt.cause === 'wall') m.wreckWall++;
            else m.wreckTakedown++;
            break;
          case 'nitro_start':
            m.nitroStarts++;
            if (evt.level === 'normal' || evt.level === 'shockwave') {
              (m.nitroFree || (m.nitroFree = [])).push(e.driver.brakeFreeDistance(car.trackS, car.speed + 18, e.driver.aLatNow, e.driver.capNow));
            }
            if (evt.level === 'perfect') m.perfect++;
            if (evt.level === 'shockwave') m.shock++;
            break;
          default:
        }
      }
      car.events.length = 0;
      if (!car.finished) {
        const completed = Math.floor(car.raceDistance / L);
        if (completed > car.lap) {
          car.lap = completed;
          m.lapTimes.push(time - m.lastLapAt);
          m.lastLapAt = time;
          if (car.lap >= laps) {
            car.finished = true;
            car.finishTime = time;
            finished++;
            finishOrder.push(e);
          }
        }
        // ölçümler (yarış sürerken)
        const v = car.speed;
        m.steps++;
        m.sumSpeed += v;
        if (v * 3.6 > m.topKmh) m.topKmh = v * 3.6;
        if (car.draft > 0.05) m.slipTime += DT;
        if (car.draft > m.maxDraft) m.maxDraft = car.draft;
        if (car.drifting) m.driftSteps++;
        // takılma: yavaş, devrilmiş değil, yarışın ilk 4 s'sinden sonra
        if (!car.wrecked && !car.ghost && time > 4 && Math.abs(v) < 2.5) {
          m.stuckT += DT;
          if (m.stuckT > 2 && !m.stuckFlag) {
            m.stuck++;
            m.stuckFlag = true;
          }
        } else {
          m.stuckT = 0;
          m.stuckFlag = false;
        }
        // ters yön
        if (!car.wrecked && !car.airborne && time > 4) {
          const smp = track.sample(car.trackS).tangent;
          const dot = Math.sin(car.yaw) * smp.x + Math.cos(car.yaw) * smp.z;
          if (dot < -0.2) {
            m.revT += DT;
            if (m.revT > 1 && !m.revFlag) {
              m.reverse++;
              m.revFlag = true;
            }
          } else {
            m.revT = 0;
            m.revFlag = false;
          }
        }
      }
    }
    if (opts.onStep) opts.onStep(entries, time, step);
    if (trace && step % 30 === 0) trace.push(cars.map((c) => [c.trackS, c.lateral, c.speed]));
    if (finished === cars.length) break;
    if (solo && finished === 1) break;
  }

  for (const e of entries) {
    const d = e.driver;
    e.stats = d.stats ? { ...d.stats } : {};
  }
  return { track, trackId, L, laps, time, entries, finishOrder, slipEvents, trace, finished, total: cars.length };
}
