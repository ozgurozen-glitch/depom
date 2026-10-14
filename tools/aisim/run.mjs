#!/usr/bin/env node
// Bot yapay zekâ simülasyonu CLI'ı.
//   node --import ./tools/aisim/register.mjs tools/aisim/run.mjs --mode solo --track oval,hard --difficulty easy,normal,hard
//   node --import ./tools/aisim/register.mjs tools/aisim/run.mjs --mode race --track hard --difficulty hard --laps 3
// seçenekler: --mode solo|race|both  --track oval,hard,hard2,mixed  --difficulty easy,normal,hard  --laps N
//             --models vortex,speedster,gripper  --bots N  --radius R (hard/hard2 köşe yarıçapı)  --player none|normal|same
//             --botIndex i (solo: hangi botun yeteneği)  --reps N  --json
import { runRace, MODELS } from './sim.mjs';
import { TRACK_IDS } from './tracks.mjs';

const opt = { mode: 'both', track: 'oval,hard', difficulty: 'easy,normal,hard', laps: '2', models: 'vortex,speedster,gripper', bots: '7', radius: '', player: 'normal', botIndex: '0', reps: '1', json: false, maxTime: '0' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const k = argv[i].replace(/^--/, '');
  if (k === 'json') opt.json = true;
  else opt[k] = argv[++i];
}
const list = (s) => String(s).split(',').filter(Boolean);
const tracks = opt.track === 'all' ? TRACK_IDS : list(opt.track);
const diffs = list(opt.difficulty);
const models = list(opt.models);
const laps = Number(opt.laps);
const bots = Number(opt.bots);
const reps = Number(opt.reps);
const trackOpts = opt.radius ? { radius: Number(opt.radius) } : {};
for (const m of models) if (!(m in MODELS)) throw new Error(`bilinmeyen model ${m}`);

const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '-');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

function sumStat(entries, key) {
  return entries.reduce((a, e) => a + (e.m[key] || 0), 0);
}

async function soloBlock(trackId) {
  console.log(`\n=== SOLO  pist=${trackId}  tur=${laps}  botIndex=${opt.botIndex} ===`);
  console.log('model       zorluk  ortTur(s)  enİyiTur  duvar/tur  sert  wreck  takılma  ters  maxkm/s  ortkm/s  nitro  perf  us/adım');
  const rows = [];
  for (const model of models) {
    for (const diff of diffs) {
      const laps_ = [];
      let agg = null;
      for (let r = 0; r < reps; r++) {
        const res = await runRace({ track: trackId, trackOpts, laps, difficulty: diff, models: [model], solo: true, botIndex: Number(opt.botIndex), maxTime: Number(opt.maxTime) });
        const e = res.entries[0];
        laps_.push(...e.m.lapTimes);
        agg = agg ? { ...agg, m: Object.fromEntries(Object.keys(e.m).map((k) => [k, typeof e.m[k] === 'number' ? (agg.m[k] || 0) + e.m[k] : e.m[k]])) } : { m: { ...e.m } };
        if (e.m.lapTimes.length < laps) console.log(`  !! ${model}/${diff}: yarış bitmedi (${e.m.lapTimes.length}/${laps} tur) t=${f1(res.time)}`);
      }
      const m = agg.m;
      const nLaps = Math.max(1, laps_.length);
      const row = {
        model, diff, mean: mean(laps_), best: Math.min(...laps_), wallPerLap: m.wallHits / nLaps, wallHard: m.wallHard, wrecks: m.wrecks, stuck: m.stuck,
        reverse: m.reverse, top: m.topKmh, avg: (m.sumSpeed / Math.max(1, m.steps)) * 3.6, nitro: m.nitroStarts, perf: m.perfect, us: (m.driverMs / m.driverCalls) * 1000,
      };
      rows.push(row);
      console.log(`${model.padEnd(11)} ${diff.padEnd(6)}  ${f2(row.mean).padStart(9)}  ${f2(row.best).padStart(8)}  ${f1(row.wallPerLap).padStart(9)}  ${String(row.wallHard).padStart(4)}  ${String(row.wrecks).padStart(5)}  ${String(row.stuck).padStart(7)}  ${String(row.reverse).padStart(4)}  ${f1(row.top).padStart(7)}  ${f1(row.avg).padStart(7)}  ${String(row.nitro).padStart(5)}  ${String(row.perf).padStart(4)}  ${f1(row.us).padStart(7)}`);
    }
  }
  return rows;
}

async function raceBlock(trackId) {
  console.log(`\n=== YARIŞ  pist=${trackId}  tur=${laps}  botlar=${bots}  modeller=${models.join('/')}  oyuncu=${opt.player} ===`);
  console.log('zorluk  ortTur(s)  bitti  duvar/tur  sert  wreck(duvar/takedown)  takılma  ters  takedown  bump  slipBaşla  slipSüre(s)  savunma  sollama  us/adım  oyuncuSırası');
  const out = [];
  for (const diff of diffs) {
    let lapAll = [];
    let totals = { wall: 0, hard: 0, wreck: 0, wreckWall: 0, wreckTd: 0, stuck: 0, reverse: 0, td: 0, bump: 0, slip: 0, slipT: 0, def: 0, ovt: 0, fin: 0, tot: 0, us: [], plPlace: [] };
    for (let r = 0; r < reps; r++) {
      const res = await runRace({ track: trackId, trackOpts, laps, difficulty: diff, bots, models, player: opt.player, maxTime: Number(opt.maxTime) });
      const bs = res.entries.filter((e) => e.bot);
      for (const e of bs) lapAll.push(...e.m.lapTimes);
      totals.wall += sumStat(bs, 'wallHits');
      totals.hard += sumStat(bs, 'wallHard');
      totals.wreck += sumStat(bs, 'wrecks');
      totals.wreckWall += sumStat(bs, 'wreckWall');
      totals.wreckTd += sumStat(bs, 'wreckTakedown');
      totals.stuck += sumStat(res.entries, 'stuck');
      totals.reverse += sumStat(res.entries, 'reverse');
      totals.td += sumStat(bs, 'takedowns');
      totals.bump += sumStat(bs, 'bumps');
      totals.slip += sumStat(res.entries, 'slipStarts');
      totals.slipT += sumStat(res.entries, 'slipTime');
      totals.def += bs.reduce((a, e) => a + (e.stats.defend || 0), 0);
      totals.ovt += bs.reduce((a, e) => a + (e.stats.overtake || 0), 0);
      totals.fin += res.finished;
      totals.tot += res.total;
      totals.us.push(...res.entries.map((e) => (e.m.driverMs / e.m.driverCalls) * 1000));
      const pl = res.entries.find((e) => !e.bot);
      if (pl) totals.plPlace.push(res.finishOrder.indexOf(pl) + 1 || res.total);
    }
    const nLaps = Math.max(1, lapAll.length);
    const t = totals;
    console.log(`${diff.padEnd(6)}  ${f2(mean(lapAll)).padStart(9)}  ${`${t.fin}/${t.tot}`.padStart(5)}  ${f1(t.wall / nLaps).padStart(9)}  ${String(t.hard).padStart(4)}  ${`${t.wreck}(${t.wreckWall}/${t.wreckTd})`.padStart(21)}  ${String(t.stuck).padStart(7)}  ${String(t.reverse).padStart(4)}  ${String(t.td).padStart(8)}  ${String(t.bump).padStart(4)}  ${String(t.slip).padStart(9)}  ${f1(t.slipT).padStart(11)}  ${String(t.def).padStart(7)}  ${String(t.ovt).padStart(7)}  ${f1(mean(t.us)).padStart(7)}  ${t.plPlace.join(',')}`);
    out.push({ diff, mean: mean(lapAll), ...t });
  }
  return out;
}

for (const trackId of tracks) {
  if (opt.mode === 'solo' || opt.mode === 'both') await soloBlock(trackId);
  if (opt.mode === 'race' || opt.mode === 'both') await raceBlock(trackId);
}
