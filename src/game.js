import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Track } from './track.js';
import { Environment } from './environment.js';
import { Car } from './car.js';
import { Controls } from './controls.js';
import { ChaseCamera } from './camera.js';
import { BotDriver } from './ai.js';
import { CollisionSystem } from './collisions.js';
import { Effects } from './effects.js';
import { HUD } from './hud.js';
import { AudioSystem } from './audio.js';

const NO_INPUT = Object.freeze({ throttle: 0, brake: 0, steer: 0, nitro: false, drift: false });
const COUNTDOWN_SECONDS = 3;
const PERFECT_START_WINDOW = [-0.3, 0.2]; // GO anına göre saniye
const PICKUP_RADIUS = 3.2;
const PICKUP_RESPAWN = 12;
const RESULTS_DELAY = 2.5;

export class Game {
  constructor({ renderer, hudRoot, options }) {
    this.renderer = renderer;
    this.options = options;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.3, 5000);

    this.track = new Track(this.scene);
    this.environment = new Environment(this.scene, renderer, this.track);
    this.controls = new Controls(renderer.domElement);
    this.chaseCam = new ChaseCamera(this.camera);
    this.collisions = new CollisionSystem();
    this.effects = new Effects(renderer, this.scene, this.camera);
    this.hud = new HUD(hudRoot);
    this.audio = new AudioSystem();
    this.audio.setMuted(Boolean(options.muted));
    this.hud.setTrack(this.track);

    this.createCars();

    this.state = 'menu'; // menu | countdown | racing | finished
    this.paused = false;
    this.time = 0;
    this.accumulator = 0;
    this.frameEvents = [];
    this.fps = 0;

    this.clock = new THREE.Clock();
    this.loop = this.loop.bind(this);
    window.addEventListener('resize', () => this.resize());
  }

  createCars() {
    this.cars = [];
    this.drivers = new Map();

    for (let i = 0; i < CONFIG.botCount; i++) {
      const car = new Car({
        scene: this.scene,
        color: CONFIG.botColors[i % CONFIG.botColors.length],
        name: CONFIG.botNames[i % CONFIG.botNames.length],
        isPlayer: false,
      });
      // Öndeki botlar daha yetenekli; ızgara sırası = zorluk sırası.
      const skill = 0.95 - (i / Math.max(1, CONFIG.botCount - 1)) * 0.35;
      this.drivers.set(car, new BotDriver(car, this.track, {
        skill,
        aggression: 0.3 + ((i * 37) % 10) / 15,
        preferredLane: ((i % 3) - 1) * 0.5,
      }));
      this.cars.push(car);
    }

    // Asphalt'taki gibi oyuncu ızgaranın en arkasından başlar.
    this.player = new Car({
      scene: this.scene,
      color: CONFIG.playerColor,
      name: CONFIG.playerName,
      isPlayer: true,
    });
    this.cars.push(this.player);
    this.playerAutopilot = new BotDriver(this.player, this.track, { skill: 0.9, aggression: 0.5, preferredLane: 0 });
  }

  resetRace() {
    const grid = this.track.getStartGrid(this.cars.length);
    this.cars.forEach((car, i) => {
      car.placeAt(grid[i].pos, grid[i].yaw);
      car.events.length = 0;
      car.nitro = 0.3;
      const startS = this.track.project(car.position).s;
      car.trackS = startS;
      car.prevS = startS;
      car.raceDistance = startS > this.track.length / 2 ? startS - this.track.length : startS;
      car.lap = 0;
      car.place = i + 1;
      car.finished = false;
      car.finishTime = null;
    });
    for (const p of this.track.pickups) {
      p.active = true;
      p.mesh.visible = true;
    }
    this.finishOrder = [];
    this.raceTime = 0;
    this.lapStart = 0;
    this.bestLap = null;
    this.lastLapTime = null;
    this.finishedAt = null;
    this.resultsShown = false;
    this.countdown = COUNTDOWN_SECONDS;
    this.goShownFor = 0;
    this.playerNitroPressAt = null;
    this.prevPlayerNitro = false;
    this.frameEvents.length = 0;
  }

  start() {
    this.resetRace();
    if (this.options.skipMenu) {
      this.startCountdown();
    } else {
      this.state = 'menu';
      this.chaseCam.setMode('menu');
      this.hud.showMenu({
        trackName: this.track.name || CONFIG.trackName,
        carName: CONFIG.carName,
        onStart: () => this.startCountdown(),
      });
    }
    requestAnimationFrame(this.loop);
  }

  startCountdown() {
    this.audio.resume();
    this.hud.hideMenu();
    this.hud.showResults(null);
    this.state = 'countdown';
    this.countdown = COUNTDOWN_SECONDS;
    this.chaseCam.setMode('countdown');
    this.controls.setTouchVisible(true);
    this.hud.showCountdown(String(COUNTDOWN_SECONDS));
    this.frameEvents.push({ type: 'countdown', car: this.player, value: COUNTDOWN_SECONDS });
  }

  restart() {
    this.paused = false;
    this.hud.showPause(false);
    this.resetRace();
    this.startCountdown();
  }

  togglePause() {
    if (this.state !== 'racing' && this.state !== 'countdown') return;
    this.paused = !this.paused;
    this.hud.showPause(this.paused, {
      onResume: () => this.togglePause(),
      onRestart: () => this.restart(),
    });
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.effects.resize(w, h);
  }

  loop() {
    requestAnimationFrame(this.loop);
    const realDt = Math.min(this.clock.getDelta(), 0.1);
    this.fps = this.fps * 0.9 + (realDt > 0 ? 1 / realDt : 0) * 0.1;

    if (this.controls.consumePause()) this.togglePause();
    if (this.controls.consumeRestart() && this.state !== 'menu') this.restart();

    const speed = this.options.speed;
    if (!this.paused) {
      this.accumulator += realDt * speed;
      const maxSteps = CONFIG.maxStepsPerFrame * speed;
      let steps = 0;
      while (this.accumulator >= CONFIG.fixedDt && steps < maxSteps) {
        this.step(CONFIG.fixedDt);
        this.accumulator -= CONFIG.fixedDt;
        steps++;
      }
      if (steps >= maxSteps) this.accumulator = 0;
    }

    const events = this.frameEvents;
    for (const evt of events) {
      this.hud.handleEvent(evt);
      this.audio.handleEvent(evt);
      this.routeCameraShake(evt);
    }
    const frameDt = this.paused ? 0 : realDt;
    this.effects.update(frameDt, this.cars, this.player, events);
    this.frameEvents = [];

    this.chaseCam.update(frameDt, this.player, this.track);
    this.environment.update(frameDt, this.player.position);
    const hudState = this.getHudState();
    this.hud.update(hudState);
    this.audio.update(frameDt, this.player, hudState);
    this.effects.render();
  }

  step(dt) {
    this.time += dt;
    this.track.update(dt, this.time);

    if (this.state === 'countdown') this.updateCountdown(dt);
    if (this.state === 'racing' || this.state === 'finished') this.raceTime += dt;
    if (this.goShownFor > 0) {
      this.goShownFor -= dt;
      if (this.goShownFor <= 0) this.hud.showCountdown(null);
    }

    const racing = this.state === 'racing' || this.state === 'finished';
    const ctx = { cars: this.cars, player: this.player, raceStarted: racing };
    for (const car of this.cars) {
      car.update(dt, racing ? this.inputFor(car, dt, ctx) : NO_INPUT, this.track);
    }

    const collisionEvents = this.collisions.update(dt, this.cars, this.track) || [];
    for (const evt of collisionEvents) {
      if (evt.type === 'takedown') evt.car.addNitro(CONFIG.nitroReward.takedown);
      if (evt.type === 'near_miss') evt.car.addNitro(CONFIG.nitroReward.nearMiss);
      this.frameEvents.push(evt);
    }

    this.updatePickups();
    if (racing) this.updateRaceProgress();

    for (const car of this.cars) {
      if (car.events.length) {
        for (const evt of car.events) this.frameEvents.push(evt);
        car.events.length = 0;
      }
    }

    if (this.state === 'finished' && !this.resultsShown && this.raceTime - this.finishedAt > RESULTS_DELAY) {
      this.resultsShown = true;
      this.controls.setTouchVisible(false);
      this.hud.showResults(this.buildResults(), () => this.restart());
    }
  }

  inputFor(car, dt, ctx) {
    if (car === this.player) {
      if (car.finished || this.options.autopilot) return this.playerAutopilot.getInput(dt, ctx);
      return this.controls.getInput();
    }
    return this.drivers.get(car).getInput(dt, ctx);
  }

  updateCountdown(dt) {
    const before = Math.ceil(this.countdown);
    this.countdown -= dt;
    const after = Math.ceil(this.countdown);

    // Mükemmel çıkış: GO anına yakın nitroya basmak.
    const input = this.options.autopilot ? null : this.controls.getInput();
    const nitroNow = input ? input.nitro : false;
    if (nitroNow && !this.prevPlayerNitro) this.playerNitroPressAt = -this.countdown;
    this.prevPlayerNitro = nitroNow;

    if (after !== before && after > 0) {
      this.hud.showCountdown(String(after));
      this.frameEvents.push({ type: 'countdown', car: this.player, value: after });
    }
    if (this.countdown <= 0) {
      this.state = 'racing';
      this.raceTime = 0;
      this.lapStart = 0;
      this.chaseCam.setMode('race');
      this.hud.showCountdown('GO!');
      this.goShownFor = 0.9;
      this.frameEvents.push({ type: 'go', car: this.player });
      const t = this.playerNitroPressAt;
      if (t !== null && t >= PERFECT_START_WINDOW[0] && t <= PERFECT_START_WINDOW[1]) {
        const fwd = new THREE.Vector3(Math.sin(this.player.yaw), 0, Math.cos(this.player.yaw));
        this.player.applyImpulse(fwd.multiplyScalar(18));
        this.player.addNitro(CONFIG.nitroReward.perfectStart);
        this.frameEvents.push({ type: 'perfect_start', car: this.player });
      }
    }
  }

  updatePickups() {
    for (const p of this.track.pickups) {
      if (!p.active) {
        if (this.time >= p.respawnAt) {
          p.active = true;
          p.mesh.visible = true;
        }
        continue;
      }
      const at = p.mesh.getWorldPosition(tmpVec);
      for (const car of this.cars) {
        if (car.wrecked) continue;
        if (car.position.distanceToSquared(at) < PICKUP_RADIUS * PICKUP_RADIUS) {
          p.active = false;
          p.mesh.visible = false;
          p.respawnAt = this.time + PICKUP_RESPAWN;
          car.addNitro(CONFIG.nitroReward.pickup);
          this.frameEvents.push({ type: 'pickup', car, kind: p.kind });
          break;
        }
      }
    }
  }

  updateRaceProgress() {
    const L = this.track.length;
    for (const car of this.cars) {
      let ds = car.trackS - car.prevS;
      if (ds < -L / 2) ds += L;
      else if (ds > L / 2) ds -= L;
      car.prevS = car.trackS;
      car.raceDistance += ds;
      if (car.finished) continue;

      const completed = Math.floor(car.raceDistance / L);
      if (completed > car.lap) {
        car.lap = completed;
        if (car === this.player) {
          this.lastLapTime = this.raceTime - this.lapStart;
          this.lapStart = this.raceTime;
          if (this.bestLap === null || this.lastLapTime < this.bestLap) this.bestLap = this.lastLapTime;
        }
        if (car.lap >= CONFIG.laps) {
          car.finished = true;
          car.finishTime = this.raceTime;
          this.finishOrder.push(car);
          this.frameEvents.push({ type: 'finish', car, place: this.finishOrder.length });
          if (car === this.player) {
            this.state = 'finished';
            this.finishedAt = this.raceTime;
            this.chaseCam.setMode('finish');
          }
        } else {
          this.frameEvents.push({ type: 'lap', car, lap: car.lap });
          if (car.lap === CONFIG.laps - 1) this.frameEvents.push({ type: 'final_lap', car });
        }
      }
    }

    const order = [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return this.finishOrder.indexOf(a) - this.finishOrder.indexOf(b);
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.raceDistance - a.raceDistance;
    });
    order.forEach((car, i) => { car.place = i + 1; });
  }

  buildResults() {
    const total = CONFIG.laps * this.track.length;
    const rows = this.cars.map((car) => {
      let time = car.finishTime;
      if (time === null) {
        const remaining = Math.max(0, total - car.raceDistance);
        time = this.raceTime + remaining / Math.max(45, Math.abs(car.speed));
      }
      return {
        name: car.name,
        time,
        bestLap: car === this.player ? this.bestLap : null,
        isPlayer: car === this.player,
      };
    });
    rows.sort((a, b) => a.time - b.time);
    rows.forEach((r, i) => { r.place = i + 1; });
    return rows;
  }

  routeCameraShake(evt) {
    if (evt.car !== this.player && evt.victim !== this.player) return;
    switch (evt.type) {
      case 'wall_hit': if (evt.strength > 0.15) this.chaseCam.shake(evt.strength * 0.7); break;
      case 'bump': this.chaseCam.shake(0.2 + evt.strength * 0.4); break;
      case 'takedown': this.chaseCam.shake(0.6); break;
      case 'land': if (evt.hard) this.chaseCam.shake(0.4); break;
      case 'wreck': this.chaseCam.shake(1); break;
      case 'nitro_start': if (evt.level === 'shockwave') this.chaseCam.shake(0.5); break;
      default: break;
    }
  }

  getHudState() {
    const p = this.player;
    return {
      state: this.state,
      paused: this.paused,
      speedKmh: p.speedKmh,
      nitro: p.nitro,
      nitroActive: p.nitroActive,
      nitroLevel: p.nitroLevel,
      nitroBurstProgress: p.nitroBurstProgress ?? null,
      place: p.place,
      totalCars: this.cars.length,
      lap: Math.min(CONFIG.laps, Math.max(1, p.lap + 1)),
      totalLaps: CONFIG.laps,
      raceTime: this.state === 'racing' || this.state === 'finished' ? this.raceTime : 0,
      lapTime: this.state === 'racing' ? this.raceTime - this.lapStart : 0,
      bestLap: this.bestLap,
      wrecked: p.wrecked,
      cars: this.cars.map((c) => ({ x: c.position.x, z: c.position.z, color: c.color, isPlayer: c.isPlayer })),
    };
  }

  // Test ve hata ayıklama için.
  debugState() {
    const carInfo = (c) => ({
      name: c.name,
      place: c.place,
      lap: c.lap,
      s: Math.round(c.trackS),
      lateral: Number(c.lateral.toFixed(2)),
      raceDistance: Math.round(c.raceDistance),
      speedKmh: Math.round(c.speedKmh),
      nitro: Number(c.nitro.toFixed(2)),
      wrecked: c.wrecked,
      airborne: c.airborne,
      finished: c.finished,
      y: Number(c.position.y.toFixed(2)),
    });
    return {
      state: this.state,
      raceTime: Number(this.raceTime.toFixed(2)),
      fps: Math.round(this.fps),
      trackLength: Math.round(this.track.length),
      player: carInfo(this.player),
      bots: this.cars.filter((c) => !c.isPlayer).map(carInfo),
    };
  }
}

const tmpVec = new THREE.Vector3();
