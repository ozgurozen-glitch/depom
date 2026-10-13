// AudioSystem: tamamen WebAudio ile sentezlenen sesler (dosya yok).
//  - Motor: iki hafif detune testere + kare alt osilatör → waveshaper → lowpass → presence; perde 6 vitesli
//    simüle RPM'i izler (vites içinde yükselir, geçişte düşer, geçişte kısa gaz kesme + ara sıra patlama).
//  - Sürekli katmanlar: rüzgâr, nitro fıslaması, drift lastik sesi, duvar sürtünmesi, yakındaki botların uğultusu.
//  - Tek seferlik sesler: darbe, wreck (+ cam), takedown, geri sayım, pickup çanı, bitiş fanfarı vb.
// AudioContext yalnızca resume() ile (ilk kullanıcı etkileşiminde) oluşturulur; o zamana dek her şey no-op.
// M tuşu sesi açar/kapatır.

const MASTER_VOLUME = 0.85;
const GEAR_TOP = [58, 102, 148, 196, 250, 360]; // km/s: her vitesin üst hızı
const DOWNSHIFT = 0.82;
const MAX_VOICES = 40;

function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.voices = 0;

    // Motor simülasyonu
    this.gear = 0;
    this.rpm = 0.2;
    this.shiftTimer = 0;
    this.prevSpeed = 0;
    this.accel = 0;
    this.throttle = 1;
    this.revTime = 0;
    this.pitchMul = 1;
    this.lastNow = undefined;

    this.scrape = 0;
    this.lastWallSound = -1;
    this.lastBumpSound = -1;
    this.prevStateName = null;
    this.countdownBeepAt = -10;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0, ok: false };
    this.hiddenSuspended = false;

    const gesture = () => this.resume();
    window.addEventListener('pointerdown', gesture, { passive: true });
    window.addEventListener('touchend', gesture, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat) this.setMuted(!this.muted);
      this.resume();
    });
    document.addEventListener('visibilitychange', () => this.onVisibility());
  }

  // ---------------------------------------------------------------- yaşam döngüsü

  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.build();
        this.ready = true;
      } catch (err) {
        console.warn('Ses başlatılamadı:', err);
        try { if (this.ctx) this.ctx.close(); } catch { /* yok say */ }
        this.ctx = null;
        this.ready = false;
        return;
      }
    }
    if (this.ctx.state === 'suspended' && !document.hidden) {
      this.ctx.resume().catch(() => {});
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (!this.ready) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_VOLUME, this.ctx.currentTime, 0.04);
  }

  onVisibility() {
    if (!this.ctx) return;
    if (document.hidden) {
      if (this.ctx.state === 'running') {
        this.hiddenSuspended = true;
        this.ctx.suspend().catch(() => {});
      }
    } else if (this.hiddenSuspended) {
      this.hiddenSuspended = false;
      this.ctx.resume().catch(() => {});
    }
  }

  // ---------------------------------------------------------------- grafik kurulumu

  build() {
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.22;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // Sürekli katmanlar duck üzerinden (menü/duraklatmada kısılır); tek seferlikler sfx üzerinden.
    this.duck = ctx.createGain();
    this.duck.gain.value = 1;
    this.duck.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(1.1, 3);
    const rv = ctx.createGain();
    rv.gain.value = 0.25;
    this.reverb.connect(rv);
    rv.connect(this.master);

    this.noise = this.makeNoise(2);

    // --- Motor
    const e = {};
    e.o1 = this.osc('sawtooth', 100, -7);
    e.o2 = this.osc('sawtooth', 100, 9);
    e.sub = this.osc('square', 50, 0);
    e.g1 = this.gain(0.34);
    e.g2 = this.gain(0.3);
    e.gs = this.gain(0.26);
    e.mix = this.gain(0.8);
    // Ateşleme dalgalanması: mix kazancını motor frekansının yarısında hafifçe titret.
    e.lfo = this.osc('sine', 50, 0);
    e.lfoGain = this.gain(0.22);
    e.lfo.connect(e.lfoGain);
    e.lfoGain.connect(e.mix.gain);
    e.shaper = ctx.createWaveShaper();
    e.shaper.curve = this.makeDrive(2.4);
    e.shaper.oversample = '2x';
    e.lp = this.filter('lowpass', 1200, 2.2);
    e.peak = this.filter('peaking', 1700, 1.1);
    e.peak.gain.value = 4;
    e.out = this.gain(0);
    e.o1.connect(e.g1);
    e.o2.connect(e.g2);
    e.sub.connect(e.gs);
    e.g1.connect(e.mix);
    e.g2.connect(e.mix);
    e.gs.connect(e.mix);
    e.mix.connect(e.shaper);
    e.shaper.connect(e.lp);
    e.lp.connect(e.peak);
    e.peak.connect(e.out);
    e.out.connect(this.duck);
    this.engine = e;

    // --- Rüzgâr
    this.wind = this.noiseLoop([['highpass', 140, 0.5], ['lowpass', 800, 0.6]]);
    // --- Nitro fıslaması
    this.nitroHiss = this.noiseLoop([['bandpass', 1700, 0.8], ['highshelf', 3500, 0.7]]);
    this.nitroHiss.filters[1].gain.value = 5;
    // --- Drift: modülasyonlu dar bant gürültü (lastik ciyaklaması)
    this.drift = this.noiseLoop([['bandpass', 1050, 7], ['peaking', 2100, 4]]);
    this.drift.filters[1].gain.value = 8;
    this.drift.lfo = this.osc('sine', 7.3, 0);
    this.drift.lfoGain = this.gain(150);
    this.drift.lfo.connect(this.drift.lfoGain);
    this.drift.lfoGain.connect(this.drift.filters[0].frequency);
    this.drift.am = this.osc('sine', 13.1, 0);
    this.drift.amGain = this.gain(0.35);
    this.drift.am.connect(this.drift.amGain);
    this.drift.amGain.connect(this.drift.pre.gain);
    // --- Duvar sürtünmesi
    this.scrapeLoop = this.noiseLoop([['bandpass', 2600, 1.3], ['lowpass', 6000, 0.7]]);
    // --- Yakındaki botların ortak uğultusu
    this.traffic = {
      osc: this.osc('sawtooth', 70, 0),
      lp: this.filter('lowpass', 280, 1),
      out: this.gain(0),
    };
    this.traffic.osc.connect(this.traffic.lp);
    this.traffic.lp.connect(this.traffic.out);
    this.traffic.out.connect(this.duck);
  }

  osc(type, freq, detune) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.start();
    return o;
  }

  gain(v) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  filter(type, freq, q) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  // Döngüsel gürültü kaynağı → filtre zinciri → kazanç (0) → duck
  noiseLoop(chain) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const pre = this.gain(1);
    src.connect(pre);
    let node = pre;
    const filters = [];
    for (const [type, freq, q] of chain) {
      const f = this.filter(type, freq, q);
      node.connect(f);
      node = f;
      filters.push(f);
    }
    const out = this.gain(0);
    node.connect(out);
    out.connect(this.duck);
    src.start(0, Math.random() * 1.8);
    return { src, pre, filters, out };
  }

  makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }

  makeDrive(k) {
    const n = 1024;
    const curve = new Float32Array(n);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    return curve;
  }

  // ---------------------------------------------------------------- her kare

  update(dt, player, state) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // Yumuşatmalar ses saatine göre (duraklatmada oyun dt=0 gelir ama motor yine rölantiye inmeli).
    const adt = this.lastNow === undefined ? 0 : clamp(now - this.lastNow, 0, 0.1);
    this.lastNow = now;
    const stateName = state ? state.state : 'racing';
    const paused = Boolean(state && state.paused);

    if (stateName !== this.prevStateName) {
      // Game ilk "3" için olay üretmiyorsa geri sayıma girişte bip'i burada çal.
      if (stateName === 'countdown' && this.prevStateName !== 'countdown') {
        this.countdownBeep(false);
        this.countdownBeepAt = now;
      }
      if (stateName === 'countdown') {
        this.gear = 0;
        this.revTime = 0;
      }
      this.prevStateName = stateName;
    }

    if (player && player.position) {
      this.listener.x = player.position.x;
      this.listener.y = player.position.y;
      this.listener.z = player.position.z;
      this.listener.yaw = player.yaw || 0;
      this.listener.ok = true;
    }

    const quiet = paused || stateName === 'menu';
    this.duck.gain.setTargetAtTime(paused ? 0.1 : stateName === 'menu' ? 0.4 : 1, now, 0.12);

    const speed = player ? Math.max(0, player.speedKmh || 0) : 0;
    const wrecked = Boolean(player && player.wrecked);
    const airborne = Boolean(player && player.airborne);
    const nitroOn = Boolean(player && player.nitroActive) && !quiet && !wrecked;
    const level = player ? player.nitroLevel : null;

    // Gaz/fren tahmini: hız değişiminden (gaz otomatik; sert yavaşlama = fren).
    if (dt > 0) {
      const a = (speed - this.prevSpeed) / dt;
      this.accel += (a - this.accel) * Math.min(1, dt * 6);
      this.prevSpeed = speed;
    }
    let throttleTarget = this.accel < -40 ? 0.15 : 1;
    if (wrecked || quiet) throttleTarget = 0.1;
    this.throttle += (throttleTarget - this.throttle) * Math.min(1, adt * 10);

    // Vites + RPM
    let rpmTarget;
    if (quiet || wrecked) {
      rpmTarget = 0.2;
    } else if (stateName === 'countdown') {
      // Çıkış öncesi gaz kökleme: düzensiz devir dalgaları
      this.revTime += adt;
      const t = this.revTime;
      const env = Math.max(0, Math.sin(t * 3.7) * 0.6 + Math.sin(t * 6.1 + 1) * 0.4);
      rpmTarget = 0.28 + env * 0.55;
      this.throttle = 0.6 + env * 0.4;
    } else {
      while (this.gear < GEAR_TOP.length - 1 && speed > GEAR_TOP[this.gear]) {
        this.gear++;
        this.shiftTimer = 0.13;
        if (Math.random() < 0.45) this.backfire(now + 0.05);
      }
      while (this.gear > 0 && speed < GEAR_TOP[this.gear - 1] * DOWNSHIFT) this.gear--;
      rpmTarget = 0.2 + 0.8 * Math.min(1.04, speed / GEAR_TOP[this.gear]);
      if (airborne) rpmTarget = Math.min(1.1, rpmTarget + 0.15);
    }
    if (this.shiftTimer > 0) this.shiftTimer -= adt;
    const rate = this.shiftTimer > 0 ? 28 : rpmTarget > this.rpm ? 9 : 6;
    this.rpm += (rpmTarget - this.rpm) * Math.min(1, adt * rate);

    const pitchTarget = nitroOn ? (level === 'shockwave' ? 1.14 : level === 'perfect' ? 1.1 : 1.07) : 1;
    this.pitchMul += (pitchTarget - this.pitchMul) * Math.min(1, adt * 4);

    const e = this.engine;
    const rpm = this.rpm;
    const base = (50 + rpm * 230) * this.pitchMul;
    const tc = 0.03;
    e.o1.frequency.setTargetAtTime(base, now, tc);
    e.o2.frequency.setTargetAtTime(base, now, tc);
    e.sub.frequency.setTargetAtTime(base * 0.5, now, tc);
    e.lfo.frequency.setTargetAtTime(base * 0.5, now, tc);
    const cutoff = 320 + rpm ** 1.5 * 3300 * (0.45 + 0.55 * this.throttle) + (nitroOn ? 900 : 0);
    e.lp.frequency.setTargetAtTime(cutoff, now, 0.04);
    const shiftDip = this.shiftTimer > 0 ? 0.45 : 1;
    const engineGain = (0.09 + 0.15 * rpm) * (0.55 + 0.45 * this.throttle) * shiftDip * (wrecked ? 0.35 : 1);
    e.out.gain.setTargetAtTime(engineGain, now, this.shiftTimer > 0 ? 0.015 : 0.05);

    // Rüzgâr
    const sk = Math.min(1.2, speed / 330);
    const windGain = quiet ? 0 : 0.26 * sk * sk * (airborne ? 1.3 : 1);
    this.wind.out.gain.setTargetAtTime(windGain, now, 0.1);
    this.wind.filters[1].frequency.setTargetAtTime(450 + speed * 9, now, 0.1);

    // Nitro
    const nitroGain = nitroOn ? (level === 'shockwave' ? 0.3 : level === 'perfect' ? 0.24 : 0.18) : 0;
    this.nitroHiss.out.gain.setTargetAtTime(nitroGain, now, nitroOn ? 0.03 : 0.12);
    this.nitroHiss.filters[0].frequency.setTargetAtTime(1300 + speed * 3, now, 0.1);

    // Drift
    const drifting = Boolean(player && player.drifting) && !airborne && !wrecked && !quiet;
    const driftGain = drifting ? 0.17 * clamp(speed / 120, 0.3, 1) : 0;
    this.drift.out.gain.setTargetAtTime(driftGain, now, drifting ? 0.03 : 0.09);
    this.drift.filters[0].frequency.setTargetAtTime(950 + Math.min(300, speed * 1.2), now, 0.1);

    // Duvar sürtünmesi (wall_hit olayları besler)
    this.scrape *= Math.exp(-adt * 7);
    this.scrapeLoop.out.gain.setTargetAtTime(quiet ? 0 : this.scrape * 0.28, now, 0.03);

    // Yakındaki botların uğultusu
    let near = 0;
    if (state && state.cars && this.listener.ok && !quiet) {
      for (const c of state.cars) {
        if (c.isPlayer) continue;
        const dx = c.x - this.listener.x;
        const dz = c.z - this.listener.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < 45) near += (1 - d / 45) ** 2;
      }
    }
    this.traffic.out.gain.setTargetAtTime(Math.min(0.11, near * 0.06), now, 0.15);
    this.traffic.osc.frequency.setTargetAtTime(62 + rpm * 80, now, 0.1);
    this.traffic.lp.frequency.setTargetAtTime(220 + speed * 1.2, now, 0.1);
  }

  // ---------------------------------------------------------------- olaylar

  handleEvent(evt) {
    if (!this.ready || !evt) return;
    const car = evt.car;
    const isMe = Boolean(car && car.isPlayer);
    const victimMe = Boolean(evt.victim && evt.victim.isPlayer);
    const otherMe = Boolean(evt.other && evt.other.isPlayer);
    const now = this.ctx.currentTime;

    switch (evt.type) {
      case 'wall_hit': {
        const g = isMe ? 1 : this.proximity(car, 50) * 0.6;
        if (g <= 0) break;
        const s = clamp(evt.strength ?? 0.4, 0, 1);
        if (isMe) this.scrape = Math.max(this.scrape, 0.45 + 0.55 * s);
        // Sürekli sürtünmede her karede darbe çalma.
        if (now - this.lastWallSound > 0.09 || s > 0.6) {
          this.lastWallSound = now;
          this.impact(s, g, this.panFor(car));
        }
        break;
      }
      case 'bump': {
        const g = isMe || otherMe ? 1 : this.proximity(car, 50) * 0.6;
        if (g <= 0 || now - this.lastBumpSound < 0.06) break;
        this.lastBumpSound = now;
        this.bump(clamp(evt.strength ?? 0.4, 0, 1), g, this.panFor(car));
        break;
      }
      case 'wreck': {
        const g = isMe ? 1 : this.proximity(car, 90) * 0.75;
        if (g > 0) this.crash(g, this.panFor(car));
        break;
      }
      case 'takedown':
        if (isMe || victimMe) this.takedown(isMe);
        break;
      case 'countdown':
        if (isMe && !(evt.value === 3 && now - this.countdownBeepAt < 0.8)) this.countdownBeep(false);
        break;
      case 'go':
        if (isMe) this.countdownBeep(true);
        break;
      case 'pickup':
        if (isMe) this.chime();
        break;
      case 'finish':
        if (isMe) this.fanfare(evt.place ?? 1);
        break;
      case 'nitro_start':
        if (isMe) this.nitroWhoosh(evt.level);
        break;
      case 'nitro_end':
        if (isMe) this.noiseHit({ type: 'bandpass', f0: 1800, f1: 500, q: 1, dur: 0.35, gain: 0.1 });
        break;
      case 'near_miss':
        if (isMe) this.noiseHit({ type: 'bandpass', f0: 2800, f1: 450, q: 1.4, dur: 0.38, gain: 0.32, pan: Math.random() < 0.5 ? -0.7 : 0.7, attack: 0.05 });
        break;
      case 'land':
        if (isMe && (evt.hard || (evt.airTime ?? 0) > 0.3)) this.landThump(evt.hard ? 1 : 0.45);
        break;
      case 'barrel_roll':
      case 'flat_spin':
        if (isMe) this.arpeggio([1046.5, 1318.5, 1568], 0.06, 0.09, 'triangle');
        break;
      case 'lap':
        if (isMe) this.arpeggio([784, 1046.5], 0.12, 0.12, 'triangle');
        break;
      case 'final_lap':
        if (isMe) {
          this.arpeggio([784, 988, 1175], 0.1, 0.12, 'square', 0.05);
          this.arpeggio([784, 988, 1175], 0.1, 0.12, 'square', 0.05, 0.36);
        }
        break;
      case 'perfect_start':
        if (isMe) {
          this.nitroWhoosh('perfect');
          this.arpeggio([1318.5, 1760, 2093], 0.05, 0.08, 'sine');
        }
        break;
      case 'respawn':
        if (isMe) this.tone({ type: 'sine', f0: 300, f1: 900, dur: 0.3, gain: 0.1 });
        break;
      default:
        break;
    }
  }

  // Dinleyiciye (oyuncu) uzaklığa göre 0..1 kazanç.
  proximity(car, range) {
    if (!car || !car.position || !this.listener.ok) return 0;
    const dx = car.position.x - this.listener.x;
    const dz = car.position.z - this.listener.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    return d >= range ? 0 : (1 - d / range) ** 1.5;
  }

  panFor(car) {
    if (!car || car.isPlayer || !car.position || !this.listener.ok) return 0;
    const dx = car.position.x - this.listener.x;
    const dz = car.position.z - this.listener.z;
    const rx = -Math.cos(this.listener.yaw);
    const rz = Math.sin(this.listener.yaw);
    return clamp((dx * rx + dz * rz) / 15, -0.85, 0.85);
  }

  // ---------------------------------------------------------------- tek seferlik ses yapı taşları

  claimVoice(seconds) {
    if (this.voices >= MAX_VOICES) return false;
    this.voices++;
    setTimeout(() => { this.voices--; }, seconds * 1000 + 60);
    return true;
  }

  output(node, { pan = 0, send = 0.25 } = {}) {
    const ctx = this.ctx;
    let tail = node;
    if (pan && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      tail.connect(p);
      tail = p;
    }
    tail.connect(this.sfx);
    if (send > 0) {
      const s = this.gain(send);
      tail.connect(s);
      s.connect(this.reverb);
    }
  }

  envelope(g, t, peak, attack, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  noiseHit({ at, type = 'lowpass', f0 = 1000, f1 = null, q = 1, dur = 0.2, gain = 0.3, attack = 0.003, pan = 0, send = 0.25, rate = 1 }) {
    if (!this.claimVoice(dur)) return;
    const ctx = this.ctx;
    const t = at ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const f = this.filter(type, f0, q);
    if (f1) {
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    }
    const g = this.ctx.createGain();
    this.envelope(g, t, gain, attack, dur);
    src.connect(f);
    f.connect(g);
    this.output(g, { pan, send });
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  tone({ at, type = 'sine', f0 = 440, f1 = null, dur = 0.2, gain = 0.2, attack = 0.004, pan = 0, send = 0.2, detune = 0 }) {
    if (!this.claimVoice(dur)) return;
    const ctx = this.ctx;
    const t = at ?? ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this.envelope(g, t, gain, attack, dur);
    o.connect(g);
    this.output(g, { pan, send });
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  arpeggio(freqs, step, dur, type = 'triangle', gain = 0.12, delay = 0) {
    const t0 = this.ctx.currentTime + delay;
    freqs.forEach((f, i) => {
      this.tone({ at: t0 + i * step, type, f0: f, dur: dur + 0.15, gain, attack: 0.005, send: 0.35 });
    });
  }

  // ---------------------------------------------------------------- ses tasarımları

  impact(s, g, pan) {
    this.noiseHit({ type: 'lowpass', f0: 900 + 2800 * s, f1: 260, q: 0.8, dur: 0.12 + 0.2 * s, gain: (0.22 + 0.5 * s) * g, pan });
    this.tone({ type: 'sine', f0: 95, f1: 42, dur: 0.22 + 0.1 * s, gain: (0.15 + 0.45 * s) * g, pan, send: 0.1 });
    if (s > 0.35) {
      this.tone({ type: 'square', f0: 213, f1: 180, dur: 0.12, gain: 0.05 * s * g, pan, send: 0.3 });
      this.tone({ type: 'square', f0: 331, f1: 290, dur: 0.1, gain: 0.04 * s * g, pan, send: 0.3 });
    }
  }

  bump(s, g, pan) {
    this.tone({ type: 'sine', f0: 125, f1: 48, dur: 0.24, gain: (0.15 + 0.45 * s) * g, pan, send: 0.1 });
    this.noiseHit({ type: 'lowpass', f0: 1700 + 1500 * s, f1: 380, q: 0.9, dur: 0.16, gain: (0.12 + 0.3 * s) * g, pan });
    this.tone({ type: 'triangle', f0: 430, f1: 380, dur: 0.1, gain: 0.07 * g, pan, send: 0.3 });
    this.tone({ type: 'triangle', f0: 617, f1: 560, dur: 0.08, gain: 0.05 * g, pan, send: 0.3 });
  }

  crash(g, pan) {
    const t = this.ctx.currentTime;
    this.noiseHit({ at: t, type: 'lowpass', f0: 4200, f1: 140, q: 0.7, dur: 0.95, gain: 0.85 * g, pan, send: 0.4 });
    this.noiseHit({ at: t + 0.02, type: 'bandpass', f0: 1300, f1: 600, q: 1.2, dur: 0.5, gain: 0.4 * g, pan });
    this.tone({ at: t, type: 'sine', f0: 72, f1: 26, dur: 1.0, gain: 0.85 * g, pan, send: 0.15 });
    this.tone({ at: t, type: 'square', f0: 157, f1: 120, dur: 0.25, gain: 0.08 * g, pan, send: 0.3 });
    this.tone({ at: t + 0.05, type: 'square', f0: 239, f1: 205, dur: 0.2, gain: 0.06 * g, pan, send: 0.3 });
    // Cam şıngırtısı: dağınık yüksek tınılar + yüksek geçiren gürültü
    this.noiseHit({ at: t + 0.03, type: 'highpass', f0: 5200, q: 0.7, dur: 0.45, gain: 0.2 * g, pan, send: 0.5 });
    for (let i = 0; i < 12; i++) {
      this.tone({
        at: t + 0.03 + Math.random() * 0.38,
        type: 'sine',
        f0: 2600 + Math.random() * 4800,
        dur: 0.05 + Math.random() * 0.14,
        gain: (0.04 + Math.random() * 0.06) * g,
        pan: clamp(pan + (Math.random() - 0.5) * 0.8, -1, 1),
        send: 0.5,
        attack: 0.002,
      });
    }
  }

  takedown(attacker) {
    const t = this.ctx.currentTime;
    this.tone({ at: t, type: 'sine', f0: 150, f1: 36, dur: 0.55, gain: 1.0, send: 0.2 });
    this.noiseHit({ at: t, type: 'lowpass', f0: 2600, f1: 180, q: 0.8, dur: 0.45, gain: 0.7, send: 0.35 });
    this.tone({ at: t, type: 'square', f0: 181, f1: 150, dur: 0.18, gain: 0.08, send: 0.3 });
    // Ağır vuruşun ardından fıslama (whoosh)
    this.noiseHit({ at: t + 0.06, type: 'bandpass', f0: 320, f1: 3200, q: 1.3, dur: 0.55, gain: attacker ? 0.3 : 0.2, attack: 0.12, send: 0.4 });
  }

  countdownBeep(go) {
    const t = this.ctx.currentTime;
    if (go) {
      this.tone({ at: t, type: 'square', f0: 1046.5, dur: 0.55, gain: 0.09, send: 0.25 });
      this.tone({ at: t, type: 'sine', f0: 1046.5, dur: 0.6, gain: 0.22, send: 0.25 });
      this.tone({ at: t, type: 'sine', f0: 1568, dur: 0.5, gain: 0.08, send: 0.25 });
    } else {
      this.tone({ at: t, type: 'square', f0: 523.25, dur: 0.17, gain: 0.08, send: 0.2 });
      this.tone({ at: t, type: 'sine', f0: 523.25, dur: 0.2, gain: 0.2, send: 0.2 });
    }
  }

  chime() {
    const t = this.ctx.currentTime;
    const f = 1318.5;
    const partials = [[1, 0.16, 0.7], [2.0, 0.07, 0.45], [2.76, 0.06, 0.32], [4.07, 0.03, 0.22]];
    for (const [m, g, d] of partials) this.tone({ at: t, type: 'sine', f0: f * m, dur: d, gain: g, attack: 0.002, send: 0.45 });
    this.tone({ at: t + 0.06, type: 'sine', f0: 1760, dur: 0.25, gain: 0.06, send: 0.45 });
    this.tone({ at: t + 0.12, type: 'sine', f0: 2349.3, dur: 0.3, gain: 0.05, send: 0.45 });
  }

  fanfare(place) {
    const t = this.ctx.currentTime;
    const win = place <= 3;
    const notes = win ? [523.25, 659.25, 783.99, 1046.5] : [440, 523.25, 659.25];
    const step = 0.11;
    notes.forEach((f, i) => {
      const at = t + i * step;
      const last = i === notes.length - 1;
      const dur = last ? 0.9 : 0.16;
      this.tone({ at, type: 'sawtooth', f0: f, dur, gain: 0.07, send: 0.4 });
      this.tone({ at, type: 'square', f0: f / 2, dur, gain: 0.04, send: 0.3 });
      this.tone({ at, type: 'triangle', f0: f, dur, gain: 0.1, send: 0.4 });
    });
    if (win) {
      const at = t + notes.length * step;
      for (const f of [523.25, 659.25, 783.99]) this.tone({ at, type: 'triangle', f0: f, dur: 0.9, gain: 0.06, send: 0.45 });
    }
  }

  nitroWhoosh(level) {
    const t = this.ctx.currentTime;
    this.noiseHit({ at: t, type: 'bandpass', f0: 450, f1: 2900, q: 1, dur: 0.38, gain: 0.3, attack: 0.04, send: 0.3 });
    if (level === 'shockwave') {
      this.tone({ at: t, type: 'sine', f0: 95, f1: 30, dur: 0.85, gain: 0.85, send: 0.3 });
      this.noiseHit({ at: t, type: 'lowpass', f0: 1400, f1: 90, q: 0.7, dur: 0.7, gain: 0.5, send: 0.45 });
      this.tone({ at: t, type: 'sawtooth', f0: 180, f1: 1400, dur: 0.28, gain: 0.07, send: 0.4 });
    } else if (level === 'perfect') {
      this.tone({ at: t, type: 'sine', f0: 1200, f1: 2600, dur: 0.22, gain: 0.08, send: 0.4 });
    }
  }

  landThump(k) {
    this.tone({ type: 'sine', f0: 85, f1: 34, dur: 0.32, gain: 0.7 * k, send: 0.1 });
    this.noiseHit({ type: 'lowpass', f0: 700, f1: 160, q: 0.8, dur: 0.22, gain: 0.4 * k });
  }

  backfire(at) {
    this.noiseHit({ at, type: 'bandpass', f0: 650, q: 1.8, dur: 0.06, gain: 0.32, attack: 0.002, send: 0.25, rate: 0.8 });
    this.noiseHit({ at: at + 0.07, type: 'bandpass', f0: 520, q: 1.8, dur: 0.05, gain: 0.22, attack: 0.002, send: 0.25, rate: 0.8 });
  }
}
