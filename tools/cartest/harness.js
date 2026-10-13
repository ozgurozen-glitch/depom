// YALNIZCA TEST: Car + Controls + ChaseCamera'yı test pistinde çalıştıran sahne.
// URL parametreleri:
//   scenario=drive|jump|roll|spin|crest|wall|tunnel|showroom   (varsayılan drive)
//   view=front|rear|side|top|q1|q2|q3|q4   (showroom yakın çekim açısı)
//   cam=race|menu|countdown|finish        (ChaseCamera modu)
//   bots=N  speed=N  pauseAt=saniye  autopilot=1  color=hex  nitro=0..1  kmh=N  lat=N  s=N  touch=1
import * as THREE from 'three';
import { Car } from '../../src/car.js';
import { Controls } from '../../src/controls.js';
import { ChaseCamera } from '../../src/camera.js';
import { TestTrack } from './test-track.js';

const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);
const scenario = params.get('scenario') || 'drive';
const simSpeed = Math.max(0.1, num('speed', 1));
const pauseAt = params.has('pauseAt') ? num('pauseAt', 0) : null;
const DT = 1 / 60;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 4000);

// Gökyüzü + ortam haritası (boya yansımaları için).
{
  const sky = new THREE.Scene();
  const g = new THREE.SphereGeometry(100, 32, 16);
  const cols = [];
  const p = g.getAttribute('position');
  const top = new THREE.Color(0x3d7fd6);
  const hor = new THREE.Color(0xffd7a8);
  const bot = new THREE.Color(0x2a2a30);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 100;
    const c = y > 0 ? hor.clone().lerp(top, Math.pow(y, 0.6)) : hor.clone().lerp(bot, Math.min(1, -y * 4));
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  sky.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  sun.position.set(60, 40, 30);
  sky.add(sun);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(sky, 0.02).texture;
  scene.background = new THREE.Color(0x8fb4e0);
  scene.fog = new THREE.Fog(0x9fbce0, 250, 1600);
}
scene.add(new THREE.HemisphereLight(0xdde8ff, 0x445533, 0.9));
const sunLight = new THREE.DirectionalLight(0xfff1dd, 2.4);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
const sc = sunLight.shadow.camera;
sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 300;
sunLight.shadow.bias = -0.0004;
scene.add(sunLight);
scene.add(sunLight.target);

const track = new TestTrack(scene);
const controls = new Controls(renderer.domElement);
const chase = new ChaseCamera(camera);

const COLORS = [0xe8101a, 0xffb000, 0xf5f5f5, 0x18c060, 0x8a2be2, 0x222428, 0xff4fa0];
const player = new Car({ scene, color: params.has('color') ? parseInt(params.get('color'), 16) : 0x1677ff, name: 'SEN', isPlayer: true });
const cars = [player];
const nBots = num('bots', scenario === 'drive' ? 7 : 0);
for (let i = 0; i < nBots; i++) cars.push(new Car({ scene, color: COLORS[i % COLORS.length], name: `Bot${i}`, isPlayer: false }));

function place(car, s, lat, kmh) {
  const smp = track.sample(s);
  const pos = smp.pos.clone().addScaledVector(smp.right, lat);
  pos.y = track.heightAt(s, lat);
  const yaw = Math.atan2(smp.tangent.x, smp.tangent.z);
  car.placeAt(pos, yaw);
  car.trackS = track.wrap(s);
  if (kmh) car.applyImpulse(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(kmh / 3.6));
}

const SCEN = {
  drive: { s: track.length - 30, lat: 4, kmh: 0 },
  jump: { s: 330, lat: 0, kmh: 280 },
  roll: { s: track.ramps[1].s0 - 120, lat: 5, kmh: 280 },
  spin: { s: track.ramps[1].s0 - 60, lat: 1.5, kmh: 270 },
  crest: { s: 20, lat: 0, kmh: 300 },
  wall: { s: 480, lat: 5, kmh: 230, yaw: -0.18 },
  tunnel: { s: track.tunnel.s0 - 60, lat: 0, kmh: 260 },
  drift: { s: track.turn2[0] - 25, lat: 3, kmh: 210 },
  wreck: { s: 480, lat: 0, kmh: 230, yaw: -1.0 },
  showroom: { s: 60, lat: 0, kmh: 0 },
};
const sc0 = SCEN[scenario] || SCEN.drive;
place(player, num('s', sc0.s), num('lat', sc0.lat), num('kmh', sc0.kmh));
if (sc0.yaw) {
  player.yaw += sc0.yaw;
  const sp = player.speed;
  player.velocity.set(Math.sin(player.yaw) * sp, 0, Math.cos(player.yaw) * sp);
  player.speed = sp;
}
player.nitro = num('nitro', 0.5);
if (scenario === 'drive') {
  const grid = track.getStartGrid(cars.length);
  cars.forEach((c, i) => {
    c.placeAt(grid[cars.length - 1 - i].pos, grid[cars.length - 1 - i].yaw);
    c.trackS = track.project(c.position).s;
    c.nitro = 0.3;
  });
}

// Basit bot sürücü: şerit takibi + ara sıra nitro.
function botInput(car, i, t) {
  const lane = ((i % 3) - 1) * 5;
  const look = 22 + Math.abs(car.speed) * 0.35;
  const smp = track.sample(car.trackS + look);
  const tx = smp.pos.x + smp.right.x * lane;
  const tz = smp.pos.z + smp.right.z * lane;
  const want = Math.atan2(tx - car.position.x, tz - car.position.z);
  let d = want - car.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return { throttle: 1, brake: 0, steer: THREE.MathUtils.clamp(-d * 3, -1, 1), nitro: Math.floor(t * 0.5 + i) % 5 === 0, drift: false };
}

const autopilot = params.has('autopilot');
let simTime = 0;
let acc = 0;
const evLog = [];
window.__events = evLog;
const raceStart = scenario === 'drive' ? 3 : 0;
const camMode = params.get('cam') || (scenario === 'showroom' ? 'menu' : scenario === 'drive' ? 'countdown' : 'race');
chase.setMode(camMode);
if (params.has('touch') || controls.isTouch) controls.setTouchVisible(true);

function playerInput(t) {
  if (scenario === 'spin') {
    const r = track.ramps[1];
    const ds = player.trackS - r.s0;
    if (ds > r.s1 - r.s0 - 26 && ds < r.s1 - r.s0 + 3) return { throttle: 0, brake: 1, steer: 1, nitro: false, drift: true };
    return { throttle: 1, brake: 0, steer: 0, nitro: false, drift: false };
  }
  if (scenario === 'drift') {
    return t > 0.3 ? { throttle: 0, brake: 1, steer: 1, nitro: t > 0.8 && t < 0.85, drift: true } : { throttle: 1, brake: 0, steer: 0, nitro: false, drift: false };
  }
  if (autopilot) return botInput(player, 1, t);
  return controls.getInput();
}

function step() {
  simTime += DT;
  const racing = simTime >= raceStart;
  if (scenario === 'drive' && camMode === 'countdown' && racing && chase.mode === 'countdown') chase.setMode('race');
  cars.forEach((c, i) => {
    const inp = !racing || scenario === 'showroom' ? { throttle: 0, brake: 0, steer: 0, nitro: false, drift: false }
      : c === player ? playerInput(simTime) : botInput(c, i, simTime);
    c.update(DT, inp, track);
    for (const e of c.events) {
      if (c === player) evLog.push({ t: Number(simTime.toFixed(2)), type: e.type, level: e.level, strength: e.strength, airTime: e.airTime, hard: e.hard, duration: e.duration, side: e.side });
      if (c === player && (e.type === 'wall_hit' || e.type === 'wreck' || (e.type === 'land' && e.hard))) chase.shake(e.type === 'wreck' ? 1 : 0.4);
    }
    c.events.length = 0;
  });
}

// Showroom yakın çekim açıları (chase kamerası yerine sabit).
const VIEWS = {
  front: [0, 1.2, 7.5], rear: [0, 1.3, -7.5], side: [-7.8, 1.0, 0], top: [0.01, 9, 0.5],
  q1: [-4.8, 1.6, 5.4], q2: [4.8, 1.3, -5.4], q3: [-5.2, 0.7, -4.6], q4: [4.6, 2.4, 5.0], wheel: [-3.2, 0.6, 2.4],
};
const view = params.get('view');

const dbg = document.getElementById('dbg');
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const real = Math.min(clock.getDelta(), 0.1);
  let simDt = 0;
  if (pauseAt === null || simTime < pauseAt) {
    if (pauseAt !== null) {
      // Belirlenmiş an: kare başına sabit adım (yavaş GPU'da bile deterministik).
      const n = Math.min(Math.ceil(simSpeed), Math.max(1, Math.round((pauseAt - simTime) / DT)));
      for (let i = 0; i < n; i++) step();
      simDt = n * DT;
    } else {
      acc += real * simSpeed;
      let n = 0;
      while (acc >= DT && n < 20) { step(); acc -= DT; n++; simDt += DT; }
      if (n >= 20) acc = 0;
    }
  }
  if (view === 'sheet') {
    // 3×2 açı ızgarası tek karede.
    const names = (params.get('views') || 'q1,front,side,q2,rear,top').split(',');
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cw = Math.floor(W / 3);
    const ch = Math.floor(H / 2);
    renderer.setScissorTest(true);
    camera.aspect = cw / ch;
    camera.fov = num('fov', 34);
    camera.updateProjectionMatrix();
    names.forEach((n, i) => {
      const v = VIEWS[n] || VIEWS.q1;
      const p = player.position;
      const off = new THREE.Vector3(v[0], v[1], v[2]).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
      camera.position.copy(p).add(off);
      camera.lookAt(p.x, p.y + (n === 'wheel' ? 0.35 : 0.55), p.z);
      const x = (i % 3) * cw;
      const y = H - (Math.floor(i / 3) + 1) * ch;
      renderer.setViewport(x, y, cw, ch);
      renderer.setScissor(x, y, cw, ch);
      renderer.render(scene, camera);
    });
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    dbg.textContent = '';
    return;
  } else if (view && VIEWS[view]) {
    const v = VIEWS[view];
    const p = player.position;
    const off = new THREE.Vector3(v[0], v[1], v[2]).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
    camera.position.copy(p).add(off);
    camera.fov = num('fov', 40);
    camera.updateProjectionMatrix();
    camera.lookAt(p.x, p.y + (view === 'wheel' ? 0.35 : 0.55), p.z);
  } else {
    chase.update(simDt, player, track);
  }
  sunLight.position.copy(player.position).add(new THREE.Vector3(60, 90, 40));
  sunLight.target.position.copy(player.position);
  renderer.render(scene, camera);
  const p = player;
  dbg.textContent = `${scenario} t=${simTime.toFixed(2)} ${Math.round(p.speedKmh)} km/s  s=${p.trackS.toFixed(1)} lat=${p.lateral.toFixed(2)} y=${p.position.y.toFixed(2)}\n`
    + `nitro ${p.nitro.toFixed(2)} ${p.nitroLevel || '-'} ${p.nitroBurstProgress === null ? '' : p.nitroBurstProgress.toFixed(2)}  drift ${p.drifting ? (p.driftAngle * 57.3).toFixed(0) + '°' : '-'}  air ${p.airborne}  wreck ${p.wrecked} ghost ${p.ghost}\n`
    + evLog.slice(-5).map((e) => `${e.t} ${e.type}${e.level ? ':' + e.level : ''}`).join('  ');
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__test = {
  player, cars, track, camera, chase,
  state: () => ({
    t: Number(simTime.toFixed(2)), kmh: Math.round(player.speedKmh), s: Number(player.trackS.toFixed(1)), lat: Number(player.lateral.toFixed(2)),
    y: Number(player.position.y.toFixed(2)), nitro: Number(player.nitro.toFixed(2)), level: player.nitroLevel, drifting: player.drifting,
    airborne: player.airborne, wrecked: player.wrecked, ghost: player.ghost, fov: Number(camera.fov.toFixed(1)),
    camY: Number((camera.position.y - player.position.y).toFixed(2)), events: evLog.slice(-8).map((e) => `${e.t}:${e.type}`),
  }),
};
frame();
