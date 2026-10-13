// HUD: Asphalt'tan esinlenen DOM arayüzü (sıra/tur, süreler, minimap, hız göstergesi, nitro barı,
// bildirimler, geri sayım, menü, duraklatma, sonuçlar). Stiller src/hud.css'te (yalnızca sistem fontları).
// Performans: update() her karede çağrılır ama DOM yalnızca değer değişince yazılır; minimap ~30 Hz.

const CSS_ID = 'nr-hud-css';
const CSS_HREF = new URL('./hud.css', import.meta.url).href;

const GAUGE_MAX_KMH = 360;
const ARC = { cx: 100, cy: 100, r: 82, from: 160, to: 380 }; // derece, SVG (saat yönü)
const MAP_INTERVAL = 1000 / 30;
const NOTE_TIME = 1500;      // ms: kuyruk boşken bildirim süresi
const NOTE_TIME_BUSY = 900;  // ms: kuyrukta bekleyen varken
const NOTE_QUEUE_MAX = 4;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fmtTime(t) {
  if (t === null || t === undefined || !Number.isFinite(t)) return '--:--.--';
  const cs = Math.max(0, Math.floor(t * 100 + 1e-6));
  const m = Math.floor(cs / 6000);
  const s = Math.floor(cs / 100) % 60;
  const c = cs % 100;
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}.${c < 10 ? '0' : ''}${c}`;
}

const colorCache = new Map();
function cssColor(color) {
  let css = colorCache.get(color);
  if (css) return css;
  if (typeof color === 'number') css = `#${(color >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
  else if (color && typeof color.getHexString === 'function') css = `#${color.getHexString()}`;
  else css = String(color || '#ffffff');
  if (colorCache.size < 64) colorCache.set(color, css);
  return css;
}

function upper(name) {
  return String(name ?? '').toUpperCase();
}

function arcPoint(deg, r) {
  const a = (deg * Math.PI) / 180;
  return [ARC.cx + r * Math.cos(a), ARC.cy + r * Math.sin(a)];
}

function arcPath(a0, a1, r) {
  const [x0, y0] = arcPoint(a0, r);
  const [x1, y1] = arcPoint(a1, r);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function gaugeSvg() {
  const main = arcPath(ARC.from, ARC.to, ARC.r);
  const redFrom = ARC.from + (ARC.to - ARC.from) * (300 / GAUGE_MAX_KMH);
  let ticks = '';
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const a = ARC.from + ((ARC.to - ARC.from) * i) / n;
    const major = i % 2 === 0;
    const [x0, y0] = arcPoint(a, major ? 66 : 69.5);
    const [x1, y1] = arcPoint(a, 74);
    ticks += `M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return `<svg viewBox="0 0 200 132" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="nr-g-speed" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#0070ff"/><stop offset="0.55" stop-color="#00e5ff"/><stop offset="1" stop-color="#eafdff"/>
      </linearGradient>
      <linearGradient id="nr-g-nitro" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#6a2cff"/><stop offset="0.5" stop-color="#7f8cff"/><stop offset="1" stop-color="#7ff3ff"/>
      </linearGradient>
    </defs>
    <path class="nr-arc-bg" d="${main}"/>
    <path class="nr-arc-track" d="${main}"/>
    <path class="nr-arc-red" d="${arcPath(redFrom, ARC.to, ARC.r)}"/>
    <path class="nr-ticks" d="${ticks}"/>
    <path class="nr-arc-glow" d="${main}" pathLength="100" stroke="url(#nr-g-speed)" stroke-dasharray="100 200" stroke-dashoffset="100"/>
    <path class="nr-arc-fill" d="${main}" pathLength="100" stroke="url(#nr-g-speed)" stroke-dasharray="100 200" stroke-dashoffset="100"/>
  </svg>`;
}

function isCoarsePointer() {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

function animate(node, keyframes, options) {
  if (typeof node.animate !== 'function') {
    const last = keyframes[keyframes.length - 1];
    if (options && options.fill === 'forwards') Object.assign(node.style, last);
    return null;
  }
  return node.animate(keyframes, options);
}

export class HUD {
  constructor(root) {
    this.root = root;
    this.el = el('div', 'nr');
    root.appendChild(this.el);
    this.loadStyles();

    this.vig = el('div', 'nr-vig');
    this.el.appendChild(this.vig);
    this.buildRace();
    this.notesLayer = el('div', 'nr-notes');
    this.el.appendChild(this.notesLayer);
    this.countEl = el('div', 'nr-count');
    this.countEl.style.display = 'none';
    this.el.appendChild(this.countEl);

    this.cache = {};
    this.stateName = null;
    this.totalLaps = 0;
    this.totalCars = 0;

    this.mapData = null;
    this.mapDirty = true;
    this.mapLast = 0;
    this.mapBg = document.createElement('canvas');
    this.mapCtx = this.mapCanvas.getContext('2d');

    this.noteQueue = [];
    this.noteActive = null;
    this.lastWreckedByAt = -1e9;

    this.countText = null;
    this.countAt = 0;
    this.countHideAnim = null;

    this.vigHeld = false;

    this.menu = null;
    this.menuStart = null;
    this.pause = null;
    this.pauseResume = null;
    this.results = null;
    this.resultsRestart = null;
    this.resultsAt = 0;

    this.onKey = this.onKey.bind(this);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', () => { this.mapDirty = true; });
  }

  loadStyles() {
    const ready = () => this.el.classList.add('nr-ready');
    let link = document.getElementById(CSS_ID);
    if (!link) {
      link = document.createElement('link');
      link.id = CSS_ID;
      link.rel = 'stylesheet';
      link.href = CSS_HREF;
      document.head.appendChild(link);
    } else if (link.sheet) {
      ready();
      return;
    }
    link.addEventListener('load', () => { ready(); this.mapDirty = true; });
    link.addEventListener('error', ready);
    setTimeout(ready, 2500); // her ihtimale karşı
  }

  // ---------------------------------------------------------------- DOM kurulumu

  buildRace() {
    const race = el('div', 'nr-race nr-hidden');
    race.innerHTML = `
      <div class="nr-pos nr-panel"><div class="nr-unskew">
        <div class="nr-pos-label">SIRA</div>
        <div class="nr-pos-row"><span class="nr-place nr-num">-</span><span class="nr-total nr-num">/-</span></div>
        <div class="nr-lap">TUR <b class="nr-lap-n nr-num">1</b><span class="nr-lap-t nr-num">/-</span></div>
      </div></div>
      <div class="nr-timer nr-panel"><div class="nr-unskew">
        <div class="nr-race-time nr-num">00:00.00</div>
        <div class="nr-lap-row">
          <span><span class="nr-k">TUR</span><span class="nr-lap-time nr-num">00:00.00</span></span>
          <span class="nr-best nr-hidden"><span class="nr-k">EN İYİ</span><span class="nr-best-time nr-num"></span></span>
        </div>
      </div></div>
      <div class="nr-map"><canvas></canvas></div>
      <div class="nr-speedo">
        <div class="nr-gauge">${gaugeSvg()}
          <div class="nr-speed"><div class="nr-speed-num nr-num">0</div><div class="nr-speed-unit">KM/S</div></div>
        </div>
        <div class="nr-nitro-wrap">
          <div class="nr-burst nr-hidden"><div class="nr-burst-zone"></div><div class="nr-burst-mark"></div><div class="nr-burst-tip">PERFECT!</div></div>
          <div class="nr-nitro"><div class="nr-nitro-fill"></div><div class="nr-nitro-seg"></div></div>
          <div class="nr-nitro-label">NITRO</div>
          <div class="nr-nitro-pct nr-num">0%</div>
        </div>
      </div>`;
    this.el.appendChild(race);
    const q = (s) => race.querySelector(s);
    this.race = race;
    this.placeEl = q('.nr-place');
    this.totalEl = q('.nr-total');
    this.lapNEl = q('.nr-lap-n');
    this.lapTEl = q('.nr-lap-t');
    this.raceTimeEl = q('.nr-race-time');
    this.lapTimeEl = q('.nr-lap-time');
    this.bestWrap = q('.nr-best');
    this.bestEl = q('.nr-best-time');
    this.mapCanvas = q('.nr-map canvas');
    this.speedo = q('.nr-speedo');
    this.speedEl = q('.nr-speed-num');
    this.arcFill = q('.nr-arc-fill');
    this.arcGlow = q('.nr-arc-glow');
    this.nitroWrap = q('.nr-nitro-wrap');
    this.nitroFill = q('.nr-nitro-fill');
    this.nitroPct = q('.nr-nitro-pct');
    this.burst = q('.nr-burst');
    this.burstMark = q('.nr-burst-mark');
  }

  // ---------------------------------------------------------------- minimap

  setTrack(track) {
    if (!track || typeof track.sample !== 'function' || !(track.length > 0)) return;
    const N = 320;
    const pts = new Float32Array(N * 2);
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (let i = 0; i < N; i++) {
      const p = track.sample((track.length * i) / N).pos;
      pts[i * 2] = p.x;
      pts[i * 2 + 1] = p.z;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const s0 = track.sample(0);
    this.mapData = {
      pts, minX, maxX, minZ, maxZ,
      start: { x: s0.pos.x, z: s0.pos.z, rx: s0.right.x, rz: s0.right.z, w: track.width || 20 },
    };
    this.mapDirty = true;
  }

  prepareMap() {
    const canvas = this.mapCanvas;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (!cssW || !cssH || !this.mapData) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(cssW * dpr);
    const H = Math.round(cssH * dpr);
    canvas.width = W;
    canvas.height = H;
    this.mapBg.width = W;
    this.mapBg.height = H;

    const d = this.mapData;
    const pad = Math.max(10 * dpr, W * 0.12);
    const spanX = Math.max(1, d.maxX - d.minX);
    const spanZ = Math.max(1, d.maxZ - d.minZ);
    const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanZ);
    const offX = (W - spanX * scale) / 2 - d.minX * scale;
    const offY = (H - spanZ * scale) / 2 - d.minZ * scale;
    this.mapT = { scale, offX, offY, dpr };

    const g = this.mapBg.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    const n = d.pts.length / 2;
    for (let i = 0; i <= n; i++) {
      const k = (i % n) * 2;
      const x = d.pts[k] * scale + offX;
      const y = d.pts[k + 1] * scale + offY;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    g.lineWidth = 9 * dpr;
    g.stroke();
    g.strokeStyle = 'rgba(28, 58, 88, 0.95)';
    g.lineWidth = 6 * dpr;
    g.stroke();
    g.shadowColor = 'rgba(0, 229, 255, 0.9)';
    g.shadowBlur = 6 * dpr;
    g.strokeStyle = '#00e5ff';
    g.lineWidth = 1.6 * dpr;
    g.stroke();
    g.shadowBlur = 0;

    // Başlangıç/bitiş çizgisi
    const s = d.start;
    const half = Math.max(5 * dpr, (s.w / 2) * scale + 2 * dpr);
    const cx = s.x * scale + offX;
    const cy = s.z * scale + offY;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2.4 * dpr;
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(cx - s.rx * half, cy - s.rz * half);
    g.lineTo(cx + s.rx * half, cy + s.rz * half);
    g.stroke();
    return true;
  }

  drawMap(cars, now) {
    if (!this.mapData || !cars) return;
    if (this.mapDirty) {
      if (!this.prepareMap()) return;
      this.mapDirty = false;
    }
    const g = this.mapCtx;
    const { scale, offX, offY, dpr } = this.mapT;
    const W = this.mapCanvas.width;
    const H = this.mapCanvas.height;
    g.clearRect(0, 0, W, H);
    g.drawImage(this.mapBg, 0, 0);

    let player = null;
    g.lineWidth = 1.3 * dpr;
    g.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c.isPlayer) {
        player = c;
        continue;
      }
      const x = c.x * scale + offX;
      const y = c.z * scale + offY;
      g.fillStyle = cssColor(c.color);
      g.beginPath();
      g.arc(x, y, 3.4 * dpr, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    if (player) {
      const x = player.x * scale + offX;
      const y = player.z * scale + offY;
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
      g.fillStyle = `rgba(0, 229, 255, ${0.16 + pulse * 0.2})`;
      g.beginPath();
      g.arc(x, y, (8.5 + pulse * 2.5) * dpr, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = cssColor(player.color);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2.2 * dpr;
      g.beginPath();
      g.arc(x, y, 5.4 * dpr, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }

  // ---------------------------------------------------------------- her kare

  update(s) {
    if (!s) return;
    const now = performance.now();
    if (s.state !== this.stateName) this.onStateChange(s.state, this.stateName);
    this.totalLaps = s.totalLaps;
    this.totalCars = s.totalCars;
    const c = this.cache;

    if (this.menu && (c.menuLaps !== s.totalLaps || c.menuCars !== s.totalCars)) {
      c.menuLaps = s.totalLaps;
      c.menuCars = s.totalCars;
      const info = this.menu.querySelector('.nr-track-info');
      if (info) info.textContent = `${s.totalLaps} TUR · ${s.totalCars} ARABA`;
    }

    const raceVisible = s.state !== 'menu' && !this.results;
    if (raceVisible !== c.raceVisible) {
      c.raceVisible = raceVisible;
      this.race.classList.toggle('nr-hidden', !raceVisible);
      if (raceVisible) this.mapDirty = true;
    }
    const dim = Boolean(s.paused);
    if (dim !== c.dim) {
      c.dim = dim;
      this.race.classList.toggle('nr-dim', dim);
    }

    this.updateWreck(s);
    this.updateNotes(now);
    if (!raceVisible) return;

    // Sıra + tur
    if (s.place !== c.place) {
      c.place = s.place;
      this.placeEl.textContent = String(s.place ?? '-');
      this.placeEl.classList.toggle('p1', s.place === 1);
    }
    if (s.totalCars !== c.totalCars) {
      c.totalCars = s.totalCars;
      this.totalEl.textContent = `/${s.totalCars}`;
    }
    if (s.lap !== c.lap) {
      c.lap = s.lap;
      this.lapNEl.textContent = String(s.lap);
    }
    if (s.totalLaps !== c.totalLapsShown) {
      c.totalLapsShown = s.totalLaps;
      this.lapTEl.textContent = `/${s.totalLaps}`;
    }

    // Süreler
    const rt = fmtTime(s.raceTime || 0);
    if (rt !== c.raceTime) {
      c.raceTime = rt;
      this.raceTimeEl.textContent = rt;
    }
    const lt = fmtTime(s.lapTime || 0);
    if (lt !== c.lapTime) {
      c.lapTime = lt;
      this.lapTimeEl.textContent = lt;
    }
    const best = s.bestLap ?? null;
    if (best !== c.best) {
      c.best = best;
      this.bestWrap.classList.toggle('nr-hidden', best === null);
      if (best !== null) this.bestEl.textContent = fmtTime(best);
    }

    // Hız
    const speed = Math.max(0, Math.round(s.speedKmh || 0));
    if (speed !== c.speed) {
      c.speed = speed;
      this.speedEl.textContent = String(speed);
      const pct = Math.round(Math.min(1, speed / GAUGE_MAX_KMH) * 400) / 4;
      if (pct !== c.arcPct) {
        c.arcPct = pct;
        const off = String(100 - pct);
        this.arcFill.setAttribute('stroke-dashoffset', off);
        this.arcGlow.setAttribute('stroke-dashoffset', off);
      }
    }

    // Nitro
    const nitroActive = Boolean(s.nitroActive);
    if (nitroActive !== c.nitroActive) {
      c.nitroActive = nitroActive;
      this.nitroWrap.classList.toggle('nr-on', nitroActive);
      this.speedo.classList.toggle('nr-nitro-on', nitroActive);
      const grad = nitroActive ? 'url(#nr-g-nitro)' : 'url(#nr-g-speed)';
      this.arcFill.setAttribute('stroke', grad);
      this.arcGlow.setAttribute('stroke', grad);
    }
    const nitro = Math.max(0, Math.min(1, s.nitro || 0));
    const nq = Math.round(nitro * 200) / 200;
    if (nq !== c.nitro) {
      c.nitro = nq;
      this.nitroFill.style.transform = `scaleX(${nq})`;
      this.nitroPct.textContent = `${Math.round(nq * 100)}%`;
    }
    const full = nitro >= 0.995 && !nitroActive;
    if (full !== c.nitroFull) {
      c.nitroFull = full;
      this.nitroWrap.classList.toggle('nr-full', full);
    }

    // Perfect nitro penceresi (alan null olabilir)
    const bp = s.nitroBurstProgress;
    const showBurst = nitroActive && typeof bp === 'number' && Number.isFinite(bp);
    if (showBurst !== c.showBurst) {
      c.showBurst = showBurst;
      this.burst.classList.toggle('nr-hidden', !showBurst);
    }
    if (showBurst) {
      const bq = Math.round(Math.max(0, Math.min(1, bp)) * 250) / 2.5;
      if (bq !== c.burst) {
        c.burst = bq;
        this.burstMark.style.left = `${bq}%`;
      }
      const hot = bp > 0.75;
      if (hot !== c.burstHot) {
        c.burstHot = hot;
        this.burst.classList.toggle('nr-hot', hot);
      }
    }

    if (now - this.mapLast >= MAP_INTERVAL) {
      this.mapLast = now;
      this.drawMap(s.cars, now);
    }
  }

  onStateChange(next, prev) {
    this.stateName = next;
    if (next === 'countdown' && prev !== 'countdown') {
      // Yeni yarış: önceki yarışın bildirimlerini temizle. Game ilk "3"ü göstermiyorsa burada göster
      // (aynı metin kısa süre içinde tekrar gelirse showCountdown yok sayar).
      this.clearNotes();
      this.showCountdown('3');
    }
    if (next === 'menu') {
      this.clearNotes();
      this.showCountdown(null);
    }
  }

  updateWreck(s) {
    const wrecked = Boolean(s.wrecked) && s.state !== 'menu';
    if (wrecked && !this.vigHeld) this.flashWreck();
    if (!wrecked && this.vigHeld) {
      this.vigHeld = false;
      animate(this.vig, [{ opacity: 0.45 }, { opacity: 0 }], { duration: 600, easing: 'ease-out', fill: 'forwards' });
    }
  }

  flashWreck() {
    this.vigHeld = true;
    animate(this.vig, [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0.45 }], {
      duration: 900, easing: 'ease-out', fill: 'forwards',
    });
  }

  // ---------------------------------------------------------------- olaylar → bildirimler

  handleEvent(evt) {
    if (!evt) return;
    const car = evt.car;
    const victim = evt.victim;
    const mine = Boolean((car && car.isPlayer) || (victim && victim.isPlayer));
    if (!mine) return;
    const isMe = Boolean(car && car.isPlayer);

    switch (evt.type) {
      case 'takedown':
        if (isMe) {
          this.notify('TAKEDOWN!', { sub: upper(victim && victim.name), tone: 'gold', priority: 3, key: 'takedown' });
        } else if (victim && victim.isPlayer) {
          this.lastWreckedByAt = performance.now();
          this.notify(`WRECKED BY ${upper(car && car.name)}`, { tone: 'red', priority: 3, small: true });
          this.flashWreck();
        }
        break;
      case 'wreck':
        if (isMe) {
          this.flashWreck();
          if (performance.now() - this.lastWreckedByAt > 600) this.notify('WRECKED', { tone: 'red', priority: 3 });
        }
        break;
      case 'drift_end':
        if (isMe && evt.duration > 1) this.notify(`DRIFT ${evt.duration.toFixed(1)}s`, { tone: 'cyan', priority: 1 });
        break;
      case 'land':
        if (isMe && evt.airTime > 0.6) this.notify(`AIR TIME ${evt.airTime.toFixed(1)}s`, { tone: 'cyan', priority: 1 });
        break;
      case 'barrel_roll':
        if (isMe) this.notify('BARREL ROLL', { tone: 'gold', priority: 2 });
        break;
      case 'flat_spin':
        if (isMe) this.notify('FLAT SPIN', { tone: 'gold', priority: 2 });
        break;
      case 'nitro_start':
        if (isMe && evt.level === 'perfect') this.notify('PERFECT NITRO', { tone: 'nitro', priority: 2, key: 'perfect' });
        else if (isMe && evt.level === 'shockwave') this.notify('SHOCKWAVE', { tone: 'nitro', priority: 2 });
        break;
      case 'near_miss':
        if (isMe) this.notify('NEAR MISS', { tone: 'white', priority: 0, key: 'near', small: true });
        break;
      case 'pickup':
        if (isMe) this.notify('+NITRO', { tone: 'nitro', priority: 0, key: 'pickup', small: true });
        break;
      case 'final_lap':
        if (isMe) {
          const n = this.totalLaps || '';
          this.notify('SON TUR!', { sub: n ? `TUR ${n}/${n}` : '', tone: 'gold', priority: 3 });
        }
        break;
      case 'lap':
        // Son tura geçişte final_lap olayı da gelir; çift bildirim olmasın.
        if (isMe && (!this.totalLaps || evt.lap + 1 < this.totalLaps)) {
          this.notify(`TUR ${evt.lap + 1}/${this.totalLaps || '?'}`, { tone: 'white', priority: 2 });
        }
        break;
      case 'perfect_start':
        if (isMe) this.notify('PERFECT START', { sub: '+NITRO', tone: 'gold', priority: 3 });
        break;
      case 'finish':
        if (isMe) {
          const place = evt.place ?? car.place;
          this.notify(`${place}.`, { sub: 'FINISH', tone: place <= 3 ? 'gold' : 'white', priority: 4 });
        }
        break;
      default:
        break;
    }
  }

  notify(text, { sub = '', tone = 'cyan', priority = 1, key = null, small = false } = {}) {
    const now = performance.now();
    const active = this.noteActive;
    // Aynı türden art arda gelenleri birleştir: "NEAR MISS x2"
    if (key && active && active.key === key && now < active.until) {
      active.count++;
      active.mainEl.textContent = `${active.text} x${active.count}`;
      active.until = Math.max(active.until, now + 800);
      animate(active.node, [
        { transform: 'translateX(-50%) skewX(-8deg) scale(1.18)' },
        { transform: 'translateX(-50%) skewX(-8deg) scale(1)' },
      ], { duration: 220, easing: 'ease-out' });
      return;
    }
    const queued = key ? this.noteQueue.find((n) => n.key === key) : null;
    if (queued) {
      queued.count++;
      return;
    }
    const item = { text, sub, tone, priority, key, small, count: 1 };
    if (priority >= 3) {
      // Yüksek öncelik kuyruğun önüne (kendi önceliğindekilerin arkasına).
      let i = 0;
      while (i < this.noteQueue.length && this.noteQueue[i].priority >= priority) i++;
      this.noteQueue.splice(i, 0, item);
    } else {
      this.noteQueue.push(item);
    }
    while (this.noteQueue.length > NOTE_QUEUE_MAX) {
      let low = 0;
      for (let i = 1; i < this.noteQueue.length; i++) {
        if (this.noteQueue[i].priority < this.noteQueue[low].priority) low = i;
      }
      this.noteQueue.splice(low, 1);
    }
    if (active && priority > active.priority) active.until = Math.min(active.until, now + 150);
  }

  updateNotes(now) {
    const active = this.noteActive;
    if (active && now >= active.until) {
      this.noteActive = null;
      const node = active.node;
      const anim = animate(node, [
        { opacity: 1, transform: 'translateX(-50%) skewX(-8deg) scale(1)' },
        { opacity: 0, transform: 'translateX(-50%) skewX(-8deg) scale(1.22) translateY(-8px)' },
      ], { duration: 200, easing: 'ease-in', fill: 'forwards' });
      if (anim) anim.onfinish = () => node.remove();
      else node.remove();
    }
    if (!this.noteActive && this.noteQueue.length) {
      const item = this.noteQueue.shift();
      this.showNote(item, now);
    }
  }

  showNote(item, now) {
    const node = el('div', `nr-note nr-${item.tone}${item.small ? ' nr-small' : ''}`);
    const main = el('div', 'nr-note-main', item.count > 1 ? `${item.text} x${item.count}` : item.text);
    main.style.textTransform = 'none';
    main.lang = 'en';
    node.appendChild(main);
    if (item.sub) {
      const sub = el('div', 'nr-note-sub', item.sub);
      sub.lang = 'en';
      node.appendChild(sub);
    }
    this.notesLayer.appendChild(node);
    animate(node, [
      { opacity: 0, transform: 'translateX(-50%) skewX(-24deg) scale(2.3)' },
      { opacity: 1, transform: 'translateX(-50%) skewX(-6deg) scale(0.9)', offset: 0.55 },
      { opacity: 1, transform: 'translateX(-50%) skewX(-8deg) scale(1)' },
    ], { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
    item.node = node;
    item.mainEl = main;
    item.until = now + (this.noteQueue.length ? NOTE_TIME_BUSY : NOTE_TIME);
    this.noteActive = item;
  }

  clearNotes() {
    this.noteQueue.length = 0;
    if (this.noteActive) {
      this.noteActive.node.remove();
      this.noteActive = null;
    }
  }

  // ---------------------------------------------------------------- geri sayım

  showCountdown(text) {
    const node = this.countEl;
    if (!text) {
      if (node.style.display === 'none' || this.countHideAnim) return;
      this.countText = null;
      const anim = animate(node, [
        { opacity: 1, transform: 'translate(-50%, -50%) skewX(-10deg) scale(1)' },
        { opacity: 0, transform: 'translate(-50%, -50%) skewX(-10deg) scale(1.35)' },
      ], { duration: 260, easing: 'ease-in', fill: 'forwards' });
      const done = () => {
        this.countHideAnim = null;
        if (!this.countText) node.style.display = 'none';
      };
      if (anim) {
        this.countHideAnim = anim;
        anim.onfinish = done;
      } else {
        done();
      }
      return;
    }
    const now = performance.now();
    if (text === this.countText && now - this.countAt < 700) return;
    this.countText = text;
    this.countAt = now;
    if (this.countHideAnim) {
      this.countHideAnim.cancel();
      this.countHideAnim = null;
    }
    const go = text === 'GO!';
    node.textContent = text;
    node.className = go ? 'nr-count nr-go' : 'nr-count';
    node.style.display = '';
    if (go) {
      animate(node, [
        { opacity: 0, transform: 'translate(-50%, -50%) skewX(-24deg) scale(0.4)' },
        { opacity: 1, transform: 'translate(-50%, -50%) skewX(-8deg) scale(1.18)', offset: 0.35 },
        { opacity: 1, transform: 'translate(-50%, -50%) skewX(-10deg) scale(1)' },
      ], { duration: 520, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'forwards' });
    } else {
      animate(node, [
        { opacity: 0, transform: 'translate(-50%, -50%) skewX(-10deg) scale(2.6)' },
        { opacity: 1, transform: 'translate(-50%, -50%) skewX(-10deg) scale(0.94)', offset: 0.28 },
        { opacity: 1, transform: 'translate(-50%, -50%) skewX(-10deg) scale(1)', offset: 0.45 },
        { opacity: 1, transform: 'translate(-50%, -50%) skewX(-10deg) scale(0.92)', offset: 0.8 },
        { opacity: 0.0, transform: 'translate(-50%, -50%) skewX(-10deg) scale(0.75)' },
      ], { duration: 1000, easing: 'ease-out', fill: 'forwards' });
    }
  }

  // ---------------------------------------------------------------- menü

  showMenu({ trackName, carName, onStart } = {}) {
    this.removeMenu();
    const touch = isCoarsePointer();
    const menu = el('div', 'nr-menu');
    menu.innerHTML = `
      <div class="nr-menu-inner">
        <div class="nr-logo" role="heading" aria-level="1" aria-label="Nitro Rush">
          <span class="nr-logo-a">NITRO</span><span class="nr-logo-b">RUSH</span>
          <div class="nr-logo-stripe"></div>
        </div>
        <div class="nr-tag">ARCADE STREET RACING</div>
        <div class="nr-cards">
          <div class="nr-card nr-panel"><div class="nr-unskew">
            <div class="nr-card-k">PİST</div><div class="nr-card-v nr-track-name" lang="en"></div>
            <div class="nr-card-s nr-track-info">&nbsp;</div>
          </div></div>
          <div class="nr-card nr-card-car nr-panel"><div class="nr-unskew">
            <div class="nr-card-k">ARABA</div><div class="nr-card-v nr-car-name" lang="en"></div>
            <div class="nr-card-s">SEÇİLİ ARABA</div>
          </div></div>
        </div>
        <button class="nr-btn nr-btn-pulse interactive" type="button"><span>YARIŞA BAŞLA</span></button>
        <div class="nr-help">${touch ? `
          <span class="nr-help-keys"><span class="nr-key">◀</span><span class="nr-key">▶</span></span><span>Sol alttaki düğmelerle direksiyon</span>
          <span class="nr-help-keys"><span class="nr-key">N</span><span class="nr-key">D</span></span><span>Sağ alt: nitro ve drift/fren · dolu barda çift dokun = shockwave</span>
          <span class="nr-help-keys"><span class="nr-key">II</span></span><span>Sağ üstteki düğmeyle duraklat</span>` : `
          <span class="nr-help-keys"><span class="nr-key">←</span><span class="nr-key">→</span></span><span>Direksiyon</span>
          <span class="nr-help-keys"><span class="nr-key">↓</span><span class="nr-key">Space</span></span><span>Drift / fren</span>
          <span class="nr-help-keys"><span class="nr-key">↑</span><span class="nr-key">Shift</span></span><span>Nitro · dolu barda çift bas = shockwave</span>
          <span class="nr-help-keys"><span class="nr-key">P</span><span class="nr-key">R</span><span class="nr-key">M</span></span><span>Duraklat · yeniden başlat · ses</span>`}
        </div>
        ${touch ? '' : '<div class="nr-hint">ENTER / SPACE İLE BAŞLA</div>'}
      </div>`;
    menu.querySelector('.nr-track-name').textContent = trackName || '';
    menu.querySelector('.nr-car-name').textContent = carName || '';
    if (this.totalLaps && this.totalCars) {
      menu.querySelector('.nr-track-info').textContent = `${this.totalLaps} TUR · ${this.totalCars} ARABA`;
    }
    let fired = false;
    this.menuStart = () => {
      if (fired) return;
      fired = true;
      if (typeof onStart === 'function') onStart();
    };
    menu.querySelector('.nr-btn').addEventListener('click', () => this.menuStart && this.menuStart());
    this.el.appendChild(menu);
    this.menu = menu;
    this.cache.menuLaps = null;
    animate(menu.querySelector('.nr-menu-inner'), [
      { opacity: 0, transform: 'translateX(-40px)' },
      { opacity: 1, transform: 'translateX(0)' },
    ], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  hideMenu() {
    const menu = this.menu;
    if (!menu) return;
    this.menu = null;
    this.menuStart = null;
    const anim = animate(menu, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-out', fill: 'forwards' });
    if (anim) anim.onfinish = () => menu.remove();
    else menu.remove();
  }

  removeMenu() {
    if (this.menu) this.menu.remove();
    this.menu = null;
    this.menuStart = null;
  }

  // ---------------------------------------------------------------- duraklatma

  showPause(visible, { onResume, onRestart } = {}) {
    if (!visible) {
      if (this.pause) this.pause.remove();
      this.pause = null;
      this.pauseResume = null;
      return;
    }
    if (!this.pause) {
      const ov = el('div', 'nr-overlay nr-pause');
      ov.innerHTML = `
        <div class="nr-pause-box">
          <div class="nr-title">DURAKLATILDI</div>
          <div class="nr-btn-row">
            <button class="nr-btn nr-resume interactive" type="button"><span>DEVAM</span></button>
            <button class="nr-btn nr-btn-ghost nr-restart interactive" type="button"><span>YENİDEN BAŞLAT</span></button>
          </div>
          <div class="nr-hint">P / ESC İLE DEVAM</div>
        </div>`;
      ov.querySelector('.nr-resume').addEventListener('click', () => this.pauseResume && this.pauseResume());
      ov.querySelector('.nr-restart').addEventListener('click', () => this.pauseRestart && this.pauseRestart());
      this.el.appendChild(ov);
      this.pause = ov;
      animate(ov.querySelector('.nr-pause-box'), [
        { opacity: 0, transform: 'scale(1.15)' },
        { opacity: 1, transform: 'scale(1)' },
      ], { duration: 220, easing: 'ease-out' });
    }
    this.pauseResume = typeof onResume === 'function' ? onResume : null;
    this.pauseRestart = typeof onRestart === 'function' ? onRestart : null;
  }

  // ---------------------------------------------------------------- sonuçlar

  showResults(rows, onRestart) {
    if (this.results) {
      this.results.remove();
      this.results = null;
      this.resultsRestart = null;
    }
    if (!rows) return;

    const me = rows.find((r) => r.isPlayer) || null;
    const place = me ? me.place : null;
    const total = rows.length;
    const ov = el('div', 'nr-overlay nr-results');
    const box = el('div', 'nr-res');
    ov.appendChild(box);

    const head = el('div', 'nr-res-head');
    const placeCls = place === 1 ? 'nr-gold' : place === 2 ? 'nr-silver' : place === 3 ? 'nr-bronze' : '';
    head.appendChild(el('div', `nr-res-place ${placeCls}`, place ? `${place}.` : '-'));
    const titles = el('div', 'nr-res-titles');
    const title = place === 1 ? 'ZAFER!' : place && place <= 3 ? 'PODYUM!' : 'YARIŞ BİTTİ';
    titles.appendChild(el('div', 'nr-res-title', title));
    titles.appendChild(el('div', 'nr-res-sub', place ? `${total} ARABA İÇİNDE ${place}. SIRA` : 'SONUÇLAR'));
    head.appendChild(titles);
    box.appendChild(head);

    const table = el('div', 'nr-table');
    const rowEls = [];
    for (const r of rows) {
      const row = el('div', `nr-row nr-r${r.place}${r.isPlayer ? ' nr-me' : ''}`);
      row.appendChild(el('span', 'nr-row-place nr-num', `${r.place}.`));
      const name = el('span', 'nr-row-name', upper(r.name));
      name.lang = 'en';
      row.appendChild(name);
      row.appendChild(el('span', 'nr-row-time nr-num', fmtTime(r.time)));
      table.appendChild(row);
      rowEls.push(row);
    }
    box.appendChild(table);

    if (me && me.bestLap !== null && me.bestLap !== undefined) {
      const best = el('div', 'nr-res-best');
      best.append('EN İYİ TUR ');
      best.appendChild(el('b', 'nr-num', fmtTime(me.bestLap)));
      box.appendChild(best);
    }

    const actions = el('div', 'nr-res-actions');
    const btn = el('button', 'nr-btn nr-btn-pulse interactive');
    btn.type = 'button';
    btn.appendChild(el('span', '', 'TEKRAR YARIŞ'));
    let fired = false;
    this.resultsRestart = () => {
      if (fired) return;
      fired = true;
      if (typeof onRestart === 'function') onRestart();
    };
    btn.addEventListener('click', () => this.resultsRestart && this.resultsRestart());
    actions.appendChild(btn);
    box.appendChild(actions);

    this.el.appendChild(ov);
    this.results = ov;
    this.resultsAt = performance.now();
    this.cache.raceVisible = null; // update() yarış HUD'unu gizlesin
    this.clearNotes();

    animate(head, [
      { opacity: 0, transform: 'scale(1.6) skewX(-12deg)' },
      { opacity: 1, transform: 'scale(1) skewX(0deg)' },
    ], { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
    rowEls.forEach((row, i) => {
      animate(row, [
        { opacity: 0, transform: 'translateX(60px) skewX(-12deg)' },
        { opacity: 1, transform: 'translateX(0) skewX(-12deg)' },
      ], { duration: 320, delay: 150 + i * 55, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    });
  }

  // ---------------------------------------------------------------- klavye

  onKey(e) {
    if (e.repeat) return;
    const enter = e.code === 'Enter' || e.code === 'NumpadEnter';
    const space = e.code === 'Space';
    if (this.menu && this.menuStart && (enter || space)) {
      e.preventDefault();
      this.menuStart();
      return;
    }
    if (this.results && this.resultsRestart && enter && performance.now() - this.resultsAt > 800) {
      e.preventDefault();
      this.resultsRestart();
      return;
    }
    if (this.pause && this.pauseResume && enter) {
      e.preventDefault();
      this.pauseResume();
    }
  }
}
