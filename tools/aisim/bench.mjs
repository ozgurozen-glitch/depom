// BotDriver.getInput adım süresi (µs): ısınma sonrası ortalama / p50 / p99 (zorluk ve pist başına).
//   node --import ./tools/aisim/register.mjs tools/aisim/bench.mjs [--track mixed] [--laps 2]
import { runRace } from './sim.mjs';

const argv = process.argv.slice(2);
const opt = { track: 'mixed', laps: '2' };
for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = argv[i + 1];

const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
// ısınma: kısa bir yarış
await runRace({ track: opt.track, laps: 1, difficulty: 'hard', models: ['vortex', 'speedster', 'gripper'] });
for (const diff of ['easy', 'normal', 'hard']) {
  const res = await runRace({ track: opt.track, laps: Number(opt.laps), difficulty: diff, models: ['vortex', 'speedster', 'gripper'] });
  const us = [];
  for (const e of res.entries) if (e.m.callUs) for (const u of e.m.callUs) us.push(u);
  us.sort((a, b) => a - b);
  const mean = us.reduce((a, b) => a + b, 0) / us.length;
  console.log(`${diff.padEnd(6)} ${opt.track}: ort ${mean.toFixed(1)} µs  p50 ${q(us, 0.5).toFixed(1)}  p99 ${q(us, 0.99).toFixed(1)}  p99.9 ${q(us, 0.999).toFixed(1)}  (n=${us.length}; performance.now ek yükünü içerir)`);
}
