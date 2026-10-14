#!/usr/bin/env node
// Bot yapay zekâ simülasyonu CLI'ı.
//   node --import ./tools/aisim/register.mjs tools/aisim/run.mjs --mode solo --track oval,hard --difficulty easy,normal,hard
//   node --import ./tools/aisim/register.mjs tools/aisim/run.mjs --mode race --track hard --difficulty hard --laps 3
// seçenekler: --mode solo|race|both  --track oval,hard,hard2,mixed  --difficulty easy,normal,hard  --laps N
//             --models vortex,speedster,gripper  --bots N  --radius R (hard/hard2 köşe yarıçapı)  --player none|normal|same
//             --botIndex i (solo: hangi botun yeteneği)  --reps N  --json
import { runRace, MODELS } from './sim.mjs';
import { PROFILES } from '../../src/ai/profile.js';
import { TUNING } from '../../src/ai.js';
import { TRACK_IDS } from './tracks.mjs';

const opt = { set: '', tune: '', mode: 'both', track: 'oval,hard', difficulty: 'easy,normal,hard', laps: '2', models: 'vortex,speedster,gripper', bots: '7', radius: '', player: 'normal', botIndex: '0', reps: '1', json: false, maxTime: '0' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const k = argv[i].replace(/^--/, '');
  if (k === 'json') opt.json = true;
  else opt[k] = argv[++i];
}
// --set easy.latAccelMul=0.8,hard.capacityUse=0.9:0.97  → profil değerlerini çalışma anında değiştirir (ayar denemeleri)
for (const kv of list0(opt.set || '')) {
  const [path, val] = kv.split('=');
  const [d, key] = path.split('.');
  PROFILES[d][key] = val.includes(':') ? val.split(':').map(Number) : Number(val);
}
for (const kv of list0(opt.tune || '')) {
  const [k, v] = kv.split('=');
  TUNING[k] = Number(v);
}
function list0(s) { return String(s).split(',').filter(Boolean); }
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
    let totals = { wall: 0, hard: 0, wreck: 0, wreckWall: 0, wreckTd: 0, stuck: 0, reverse: 0, td: 0, wb: 0, wm: 0, wc: 0, tdI: 0, tdS: 0, tdA: 0, tdP: 0, attack: 0, follow: 0, swing: 0, shock: 0, lapse: 0, recover: 0, ot: {}, bump: 0, slip: 0, slipT: 0, def: 0, ovt: 0, fin: 0, tot: 0, us: [], plPlace: [] };
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
      totals.wb += sumStat(bs, 'wallAfterBump');
      totals.wm += sumStat(bs, 'wallDuringManeuver');
      totals.wc += sumStat(bs, 'wallClean');
      totals.tdI += sumStat(bs, 'tdIntent');
      totals.tdS += sumStat(bs, 'tdShock');
      totals.tdA += sumStat(bs, 'tdAccident');
      totals.tdP += sumStat(bs, 'tdOnPlayer');
      for (const e of bs) for (const k of Object.keys(e.stats)) if (k.startsWith('ot_')) totals.ot[k] = (totals.ot[k] || 0) + e.stats[k];
      for (const k of ['attack', 'follow', 'swing', 'shock', 'lapse', 'recover']) totals[k] += bs.reduce((a, e) => a + (e.stats[k] || 0), 0);
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
    console.log(`        sert duvar: bump sonrası ${t.wb} manevra sırasında ${t.wm} temiz ${t.wc}\n        takedown: kasıtlı ${t.tdI} shockwave ${t.tdS} kaza ${t.tdA} (oyuncuya ${t.tdP}) | saldırı ${t.attack} takip ${t.follow} sollama-başlangıç ${t.swing} shock ${t.shock} hata ${t.lapse} toparlanma ${t.recover}\n        sollama sonuçları: ${JSON.stringify(t.ot)}`);
    out.push({ diff, mean: mean(lapAll), ...t });
  }
  return out;
}

const soloAll = [];
for (const trackId of tracks) {
  if (opt.mode === 'solo' || opt.mode === 'both') soloAll.push(...(await soloBlock(trackId)).map((r) => ({ ...r, trackId })));
  if (opt.mode === 'race' || opt.mode === 'both') await raceBlock(trackId);
}
if (soloAll.length && tracks.length * models.length > 1) {
  console.log('\n=== SOLO ÖZET (pist·araç ortalaması; süre = ortTur / pist başına normal-zorluk ortTur) ===');
  for (const diff of diffs) {
    const rows = soloAll.filter((r) => r.diff === diff);
    const ratios = rows.map((r) => {
      const base = soloAll.find((q) => q.trackId === r.trackId && q.model === r.model && q.diff === (diffs.includes('normal') ? 'normal' : diffs[0]));
      return r.mean / base.mean;
    });
    console.log(`${diff.padEnd(7)} süre oranı ${f2(mean(ratios))} toplam ${f1(rows.reduce((a, r) => a + r.mean, 0))}  duvar/tur ${f1(mean(rows.map((r) => r.wallPerLap)))}  sert ${rows.reduce((a, r) => a + r.wallHard, 0)}  wreck ${rows.reduce((a, r) => a + r.wrecks, 0)}  takılma ${rows.reduce((a, r) => a + r.stuck, 0)}  ters ${rows.reduce((a, r) => a + r.reverse, 0)}  us/adım ${f1(mean(rows.map((r) => r.us)))}`);
  }
}
