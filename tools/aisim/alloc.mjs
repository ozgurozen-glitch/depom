// BotDriver.getInput sıcak yolunda bellek ayırma denetimi: araba durumu sabit tutulup 300k çağrı yapılır.
//   node --expose-gc --import ./tools/aisim/register.mjs tools/aisim/alloc.mjs
import * as THREE from 'three';
import { BotDriver } from '../../src/ai.js';
import { makeTrack } from './tracks.mjs';
import { makeCarFactory } from './sim.mjs';

const track = makeTrack('mixed');
const mkCar = makeCarFactory(false);
const scene = new THREE.Scene();
const mk = (name, s, lat) => {
  const car = mkCar('vortex', { scene, color: 0xff0000, name, isPlayer: false });
  const smp = track.sample(s);
  car.placeAt(smp.pos.clone().addScaledVector(smp.right, lat), Math.atan2(smp.tangent.x, smp.tangent.z));
  car.applyImpulse(new THREE.Vector3(smp.tangent.x, 0, smp.tangent.z).multiplyScalar(60));
  car.update(1 / 60, { throttle: 1, brake: 0, steer: 0, nitro: false, drift: false }, track);
  car.nitro = 1;
  car.raceDistance = s;
  car.lap = 0;
  return car;
};
const DT = 1 / 60;
for (const diff of ['easy', 'normal', 'hard']) {
  const me = mk('me', 3300, 0);
  const others = [mk('a', 3320, 1), mk('b', 3280, -3), mk('c', 3335, -2)];
  const cars = [me, ...others];
  const driver = new BotDriver(me, track, { skill: 0.9, aggression: 0.8, preferredLane: 0.5, difficulty: diff });
  const ctx = { cars, player: others[0], raceStarted: true };
  for (let i = 0; i < 20000; i++) driver.getInput(DT, ctx);
  if (global.gc) global.gc();
  const h0 = process.memoryUsage().heapUsed;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 300000; i++) driver.getInput(DT, ctx);
  const t1 = process.hrtime.bigint();
  if (global.gc) global.gc();
  const dh = process.memoryUsage().heapUsed - h0;
  console.log(`${diff.padEnd(6)} ${(Number(t1 - t0) / 300000 / 1000).toFixed(2)} µs/çağrı, yığın değişimi (GC sonrası) ${(dh / 1e3).toFixed(0)} KB, defend ${driver.stats.defend} follow ${driver.stats.follow}`);
}
