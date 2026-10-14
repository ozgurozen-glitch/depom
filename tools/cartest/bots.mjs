// Bot sürücülerin (src/ai.js) üç araçla test pistinde davranışı: tur ilerlemesi, drift sayısı, duvar/wreck olayları.
//   node --import ./tools/cartest/register.mjs tools/cartest/bots.mjs [saniye]
import * as THREE from 'three';
import { Car } from '../../src/car.js';
import { CARS } from '../../src/cars.js';
import { BotDriver } from '../../src/ai.js';
import { TestTrack } from './test-track.js';

const DT = 1 / 60;
const SECONDS = Number(process.argv[2]) || 90;
const tr = new TestTrack(null);
const scene = new THREE.Scene();
const grid = tr.getStartGrid(CARS.length);
const rows = [];
const cars = CARS.map((spec, i) => {
  const car = new Car({ scene, color: spec.color, name: spec.name, isPlayer: false, spec });
  car.placeAt(grid[CARS.length - 1 - i].pos, grid[CARS.length - 1 - i].yaw);
  car.trackS = tr.project(car.position).s;
  const bot = new BotDriver(car, tr, { skill: 0.9, aggression: 0.3, preferredLane: (i - 1) * 0.5, difficulty: 'normal' });
  const stat = { name: spec.name, car, bot, drifts: 0, driftTime: 0, walls: 0, wrecks: 0, laps: 0, prevS: car.trackS, dist: 0 };
  rows.push(stat);
  return car;
});

for (let k = 0; k < SECONDS / DT; k++) {
  for (const r of rows) {
    const inp = r.bot.getInput(DT, { cars, player: cars[0], raceStarted: k * DT > 3 });
    r.car.update(DT, inp, tr);
    for (const e of r.car.events) {
      if (e.type === 'drift_start') r.drifts++;
      else if (e.type === 'drift_end') r.driftTime += e.duration;
      else if (e.type === 'wall_hit' && e.strength > 0.3) r.walls++;
      else if (e.type === 'wreck') r.wrecks++;
    }
    r.car.events.length = 0;
    let ds = r.car.trackS - r.prevS;
    if (ds < -tr.length / 2) ds += tr.length;
    r.dist += ds;
    r.prevS = r.car.trackS;
  }
}
for (const r of rows) {
  console.log(`${r.name.padEnd(10)} mesafe ${(r.dist / tr.length).toFixed(2)} tur (${SECONDS} s) | drift ${r.drifts} (${r.driftTime.toFixed(1)} s) | sert duvar ${r.walls} | wreck ${r.wrecks} | son hız ${r.car.speedKmh.toFixed(0)} km/s`);
}
