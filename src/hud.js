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
const SLIP_TIMEOUT = 20000;  // ms: slipstream_end gelmese bile gösterge bu süre sonra kendiliğinden gizlenir
const CAM_TIME = 1500;       // ms: kamera bilgi rozetinin görünme süresi
const CAM_LABELS = { chase: 'TAKİP', far: 'UZAK', hood: 'KAPUT', bumper: 'TAMPON' };
const STAT_DEFS = [['speed', 'HIZ'], ['accel', 'İVME'], ['handling', 'YOL TUTUŞ'], ['nitro', 'NITRO']];
const TRACK_SWITCH_DELAY = 60; // ms: "yükleniyor" durumu çizilsin diye onChange'i bu kadar geciktir
const CHEVRON_L = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 4 7 12l8 8" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEVRON_R = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 4 8 8-8 8" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CAM_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h2l1.4-2h6.2l1.4 2h2A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

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

    this.slipOn = false;
    this.slipUntil = 0;
    this.camOn = false;
    this.camUntil = 0;

    this.menu = null;
    this.menuStart = null;
    this.garage = null;
    this.pause = null;
    this.pauseResume = null;
    this.pauseRestart = null;
    this.pauseMenu = null;
    this.results = null;
    this.resultsRestart = null;
    this.resultsMenu = null;
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
      <div class="nr-camview"><span class="nr-camview-ico">${CAM_ICON}</span><span class="nr-camview-k">KAMERA:</span><b class="nr-camview-v"></b></div>
      <div class="nr-speedo">
        <div class="nr-slip" aria-hidden="true"><span class="nr-slip-chev"><i></i><i></i><i></i></span><span class="nr-slip-text" lang="en">SLIPSTREAM</span></div>
        <div class="nr-gauge">${gaugeSvg()}
          <div class="nr-speed"><div class="nr-speed-num nr-num">0</div><div class="nr-speed-unit">KM/SA</div></div>
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
    this.slipEl = q('.nr-slip');
    this.camEl = q('.nr-camview');
    this.camValEl = q('.nr-camview-v');
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
    if (this.slipOn && (now >= this.slipUntil || !raceVisible)) this.setSlip(false);
    if (this.camOn && (now >= this.camUntil || !raceVisible)) this.setCamView(null);
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
      case 'slipstream_start':
        if (isMe) this.setSlip(true);
        break;
      case 'slipstream_end':
        if (isMe) this.setSlip(false);
        break;
      case 'camera_view':
        if (isMe) this.setCamView(evt.view);
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

  // Slipstream göstergesi: start'ta açılır, end'de ya da SLIP_TIMEOUT boyunca olay gelmezse kapanır.
  setSlip(on) {
    this.slipUntil = on ? performance.now() + SLIP_TIMEOUT : 0;
    if (on === this.slipOn) return;
    this.slipOn = on;
    this.slipEl.classList.toggle('nr-slip-on', on);
  }

  // Kamera bilgi rozeti: view verilirse "KAMERA: <ad>" gösterir, null ise gizler.
  setCamView(view) {
    if (!view) {
      if (this.camOn) {
        this.camOn = false;
        this.camEl.classList.remove('nr-camview-on');
      }
      return;
    }
    const label = CAM_LABELS[view] || upper(view);
    if (label !== this.cache.camLabel) {
      this.cache.camLabel = label;
      this.camValEl.textContent = label;
    }
    this.camUntil = performance.now() + CAM_TIME;
    if (!this.camOn) {
      this.camOn = true;
      this.camEl.classList.add('nr-camview-on');
    }
    animate(this.camEl, [
      { transform: 'skewX(-8deg) scale(1.14)' },
      { transform: 'skewX(-8deg) scale(1)' },
    ], { duration: 200, easing: 'ease-out' });
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
    const node = el('div', `nr-note nr-tone-${item.tone}${item.small ? ' nr-small' : ''}`);
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

  // ---------------------------------------------------------------- menü (garaj)

  // data: { trackName, carName, tracks, cars, colors, difficulties, selection, onChange(sel), onStart(sel) }
  // tracks/cars verilmezse (eski çağrı) tek seçenekli salt-okunur garaj kurulur.
  showMenu(data = {}) {
    this.removeMenu();
    const touch = isCoarsePointer();
    const tracks = Array.isArray(data.tracks) && data.tracks.length
      ? data.tracks
      : [{ id: null, name: data.trackName || '', subtitle: '', laps: this.totalLaps || 0, record: null }];
    const cars = Array.isArray(data.cars) && data.cars.length
      ? data.cars
      : [{ id: null, name: data.carName || '', class: '', stats: null, color: null }];
    const colors = Array.isArray(data.colors) ? data.colors : [];
    const diffs = Array.isArray(data.difficulties) ? data.difficulties : [];
    const given = data.selection || {};
    const defDiff = diffs.find((d) => d.id === 'normal') || diffs[0];
    const sel = {
      trackId: tracks.some((t) => t.id === given.trackId) ? given.trackId : tracks[0].id,
      carId: cars.some((c) => c.id === given.carId) ? given.carId : cars[0].id,
      color: given.color ?? null,
      difficulty: diffs.some((d) => d.id === given.difficulty) ? given.difficulty : (defDiff ? defDiff.id : null),
    };
    const g = {
      tracks, cars, colors, diffs, sel, touch,
      onChange: typeof data.onChange === 'function' ? data.onChange : null,
      onStart: typeof data.onStart === 'function' ? data.onStart : null,
      timer: 0, dirty: false, busy: false, fired: false, carDir: 1,
      cache: {}, els: {},
    };
    this.garage = g;

    const menu = el('div', 'nr-menu');
    const panel = el('div', 'nr-garage interactive');
    menu.appendChild(panel);

    // Üst: logo
    const head = el('div', 'nr-garage-head');
    const logo = el('div', 'nr-logo nr-garage-logo');
    logo.setAttribute('role', 'heading');
    logo.setAttribute('aria-level', '1');
    logo.setAttribute('aria-label', 'Nitro Rush');
    logo.append(el('span', 'nr-logo-a', 'NITRO'), el('span', 'nr-logo-b', 'RUSH'));
    head.appendChild(logo);
    head.appendChild(el('div', 'nr-garage-title', 'GARAJ'));
    panel.appendChild(head);

    const body = el('div', 'nr-garage-body');
    panel.appendChild(body);
    const section = (label, cls) => {
      const wrap = el('section', `nr-garage-sec ${cls || ''}`);
      wrap.appendChild(el('div', 'nr-garage-k', label));
      body.appendChild(wrap);
      return wrap;
    };

    // Pist kartları
    const secTrack = section('PİST', 'nr-garage-sec-track');
    const trackList = el('div', 'nr-garage-tracks');
    trackList.setAttribute('role', 'radiogroup');
    trackList.setAttribute('aria-label', 'Pist');
    g.els.tracks = tracks.map((t) => {
      const b = el('button', 'nr-garage-track nr-panel interactive');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      const inner = el('span', 'nr-garage-track-in nr-unskew');
      const name = el('span', 'nr-garage-track-name', t.name || '');
      name.lang = 'en';
      inner.appendChild(name);
      inner.appendChild(el('span', 'nr-garage-track-sub', t.subtitle || ''));
      const meta = el('span', 'nr-garage-track-meta');
      meta.appendChild(el('span', 'nr-garage-chip', `${t.laps || '-'} TUR`));
      const has = Boolean(t.record) && Number.isFinite(t.record.bestTime);
      const rec = el('span', `nr-garage-rec${has ? ' nr-garage-has' : ''}`);
      rec.append(has ? 'EN İYİ ' : 'REKOR YOK');
      if (has) rec.appendChild(el('b', 'nr-num', fmtTime(t.record.bestTime)));
      meta.appendChild(rec);
      inner.appendChild(meta);
      b.appendChild(inner);
      b.addEventListener('click', (e) => {
        if (e.detail > 0) b.blur();
        this.garagePick('trackId', t.id);
      });
      trackList.appendChild(b);
      return b;
    });
    secTrack.appendChild(trackList);

    // Araç seçimi
    const secCar = section('ARAÇ', 'nr-garage-sec-car');
    const carRow = el('div', 'nr-garage-carrow');
    const mkArrow = (cls, svg, label, dir) => {
      const b = el('button', `nr-garage-arrow ${cls} interactive`);
      b.type = 'button';
      b.setAttribute('aria-label', label);
      const i = el('span', 'nr-garage-arrow-in');
      i.innerHTML = svg;
      b.appendChild(i);
      b.addEventListener('click', (e) => {
        if (e.detail > 0) b.blur();
        this.garageStepCar(dir);
      });
      return b;
    };
    const prev = mkArrow('nr-garage-prev', CHEVRON_L, 'Önceki araç', -1);
    const next = mkArrow('nr-garage-next', CHEVRON_R, 'Sonraki araç', 1);
    const info = el('div', 'nr-garage-carinfo');
    g.els.carClass = el('div', 'nr-garage-carclass');
    g.els.carName = el('div', 'nr-garage-carname');
    g.els.carName.lang = 'en';
    info.append(g.els.carClass, g.els.carName);
    carRow.append(prev, info, next);
    if (cars.length < 2) {
      prev.disabled = true;
      next.disabled = true;
      carRow.classList.add('nr-garage-single');
    }
    secCar.appendChild(carRow);
    const stats = el('div', 'nr-garage-stats');
    g.els.stats = STAT_DEFS.map(([key, label], i) => {
      const row = el('div', 'nr-garage-stat');
      const bar = el('div', 'nr-garage-bar');
      const fill = el('div', 'nr-garage-fill');
      fill.style.transitionDelay = `${i * 70}ms`;
      bar.append(fill, el('div', 'nr-garage-seg'));
      const val = el('span', 'nr-garage-stat-v nr-num', '0');
      row.append(el('span', 'nr-garage-stat-k', label), bar, val);
      stats.appendChild(row);
      return { key, fill, val };
    });
    secCar.appendChild(stats);
    if (!touch && cars.length > 1) secCar.appendChild(el('div', 'nr-garage-tip', '← → TUŞLARIYLA ARAÇ DEĞİŞTİR'));

    // Boya
    if (colors.length) {
      const secPaint = section('BOYA', 'nr-garage-sec-paint');
      const sw = el('div', 'nr-garage-swatches');
      sw.setAttribute('role', 'radiogroup');
      sw.setAttribute('aria-label', 'Boya');
      g.els.swatches = colors.map((c) => {
        const css = cssColor(c);
        const b = el('button', 'nr-garage-swatch interactive');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-label', `Boya ${css}`);
        b.style.setProperty('--sw', css);
        b.addEventListener('click', (e) => {
          if (e.detail > 0) b.blur();
          this.garagePick('color', c);
        });
        sw.appendChild(b);
        return { b, css };
      });
      secPaint.appendChild(sw);
    }

    // Zorluk
    if (diffs.length) {
      const secDiff = section('ZORLUK', 'nr-garage-sec-diff');
      const seg = el('div', 'nr-garage-segctl');
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', 'Zorluk');
      g.els.diffs = diffs.map((d) => {
        const b = el('button', 'nr-garage-diff interactive');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.appendChild(el('span', '', d.name));
        b.addEventListener('click', (e) => {
          if (e.detail > 0) b.blur();
          this.garagePick('difficulty', d.id);
        });
        seg.appendChild(b);
        return { b, id: d.id };
      });
      secDiff.appendChild(seg);
    }

    // Kontrol yardımı (dar/alçak ekranda panelin içinde, geniş ekranda sağ altta)
    body.appendChild(this.garageHelp(touch, 'nr-garage-help-in'));
    menu.appendChild(this.garageHelp(touch, 'nr-garage-help-side'));

    // Alt: başlat
    const foot = el('div', 'nr-garage-foot');
    const start = el('button', 'nr-btn nr-btn-pulse nr-garage-start interactive');
    start.type = 'button';
    g.els.startText = el('span', '', 'YARIŞA BAŞLA');
    start.appendChild(g.els.startText);
    start.addEventListener('click', (e) => {
      if (e.detail > 0) start.blur();
      if (this.menuStart) this.menuStart();
    });
    g.els.start = start;
    foot.appendChild(start);
    if (!touch) foot.appendChild(el('div', 'nr-hint', 'ENTER İLE BAŞLA'));
    panel.appendChild(foot);

    this.menuStart = () => this.garageStart();
    this.el.appendChild(menu);
    this.menu = menu;
    // Önce 0 değerleriyle çiz, sonra doldur: istatistik çubukları animasyonla dolsun.
    this.syncGarage(true);
    void menu.offsetWidth; // eslint-disable-line no-void
    this.syncGarage(false);
    animate(panel, [
      { opacity: 0, transform: 'translateX(-40px)' },
      { opacity: 1, transform: 'translateX(0)' },
    ], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  garageHelp(touch, cls) {
    const help = el('div', `nr-help ${cls}`);
    help.innerHTML = touch ? `
      <span class="nr-help-keys"><span class="nr-key">◀</span><span class="nr-key">▶</span></span><span>Sol alttaki düğmelerle direksiyon</span>
      <span class="nr-help-keys"><span class="nr-key">N</span><span class="nr-key">D</span></span><span>Sağ alt: nitro ve drift/fren · dolu barda çift dokun = shockwave</span>
      <span class="nr-help-keys"><span class="nr-key">II</span></span><span>Sağ üstteki düğmeyle duraklat</span>
      <span class="nr-help-keys"><span class="nr-key">C</span></span><span>Üstteki kamera düğmesiyle kamera görünümü</span>` : `
      <span class="nr-help-keys"><span class="nr-key">←</span><span class="nr-key">→</span></span><span>Direksiyon</span>
      <span class="nr-help-keys"><span class="nr-key">↓</span><span class="nr-key">Space</span></span><span>Drift / fren</span>
      <span class="nr-help-keys"><span class="nr-key">↑</span><span class="nr-key">Shift</span></span><span>Nitro · dolu barda çift bas = shockwave</span>
      <span class="nr-help-keys"><span class="nr-key">C</span></span><span>Kamera görünümü (takip · uzak · kaput · tampon)</span>
      <span class="nr-help-keys"><span class="nr-key">P</span><span class="nr-key">R</span><span class="nr-key">M</span></span><span>Duraklat · yeniden başlat · ses</span>`;
    return help;
  }

  // Seçimde tek bir alan değişti (pist / araç / boya / zorluk).
  garagePick(field, value) {
    const g = this.garage;
    if (!g || g.sel[field] === value) return;
    g.sel[field] = value;
    // Pist değişimi yüklemeyi bloklar: önce "yükleniyor" çizilsin, sonra onChange çalışsın.
    if (field === 'trackId') this.setGarageBusy(true);
    this.syncGarage(false);
    this.queueGarageChange();
  }

  garageStepCar(dir) {
    const g = this.garage;
    if (!g || g.cars.length < 2) return;
    const i = Math.max(0, g.cars.findIndex((c) => c.id === g.sel.carId));
    const n = g.cars.length;
    g.carDir = dir;
    this.garagePick('carId', g.cars[(i + dir + n) % n].id);
  }

  queueGarageChange() {
    const g = this.garage;
    if (!g) return;
    g.dirty = true;
    if (g.timer) return; // zamanlayıcı tetiklendiğinde en güncel seçim gönderilir
    g.timer = setTimeout(() => {
      g.timer = 0;
      this.flushGarageChange();
    }, g.busy ? TRACK_SWITCH_DELAY : 0);
  }

  flushGarageChange() {
    const g = this.garage;
    if (!g) return;
    if (g.timer) {
      clearTimeout(g.timer);
      g.timer = 0;
    }
    if (g.dirty) {
      g.dirty = false;
      if (g.onChange) g.onChange({ ...g.sel });
    }
    if (g.busy) requestAnimationFrame(() => { if (this.garage === g) this.setGarageBusy(false); });
  }

  setGarageBusy(busy) {
    const g = this.garage;
    if (!g || g.busy === busy) return;
    g.busy = busy;
    g.els.start.classList.toggle('nr-garage-busy', busy);
    g.els.start.setAttribute('aria-busy', busy ? 'true' : 'false');
    g.els.startText.textContent = busy ? 'YÜKLENİYOR…' : 'YARIŞA BAŞLA';
  }

  garageStart() {
    const g = this.garage;
    if (!g || g.fired || g.busy) return;
    g.fired = true;
    if (g.timer) {
      clearTimeout(g.timer);
      g.timer = 0;
    }
    g.dirty = false; // onStart(sel) seçimi zaten uygular
    if (g.onStart) g.onStart({ ...g.sel });
  }

  // DOM'u yalnızca değişen değerlerde günceller. zero=true: çubukları 0'da tut (giriş animasyonu için).
  syncGarage(zero) {
    const g = this.garage;
    if (!g) return;
    const c = g.cache;
    const sel = g.sel;

    g.els.tracks.forEach((b, i) => {
      const on = g.tracks[i].id === sel.trackId;
      if (c[`t${i}`] === on) return;
      c[`t${i}`] = on;
      b.classList.toggle('nr-garage-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });

    const car = g.cars.find((x) => x.id === sel.carId) || g.cars[0];
    if (c.car !== car) {
      const first = c.car === undefined;
      c.car = car;
      const idx = g.cars.indexOf(car);
      g.els.carName.textContent = car.name || '';
      const count = g.cars.length > 1 ? `${idx + 1}/${g.cars.length}` : '';
      g.els.carClass.textContent = [car.class, count].filter(Boolean).join(' · ');
      if (!first) {
        animate(g.els.carName, [
          { opacity: 0, transform: `translateX(${18 * g.carDir}px)` },
          { opacity: 1, transform: 'translateX(0)' },
        ], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    }
    for (const st of g.els.stats) {
      const raw = zero ? 0 : Number(car.stats && car.stats[st.key]);
      const v = Math.round(Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 0)) * 100);
      if (c[`s${st.key}`] === v) continue;
      c[`s${st.key}`] = v;
      st.fill.style.transform = `scaleX(${v / 100})`;
      st.val.textContent = String(v);
    }

    if (g.els.swatches) {
      const eff = cssColor(sel.color ?? car.color ?? '');
      for (const sw of g.els.swatches) {
        const on = sw.css === eff;
        if (c[`w${sw.css}`] === on) continue;
        c[`w${sw.css}`] = on;
        sw.b.classList.toggle('nr-garage-on', on);
        sw.b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
    }
    if (g.els.diffs) {
      for (const d of g.els.diffs) {
        const on = d.id === sel.difficulty;
        if (c[`d${d.id}`] === on) continue;
        c[`d${d.id}`] = on;
        d.b.classList.toggle('nr-garage-on', on);
        d.b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
    }
  }

  hideMenu() {
    const menu = this.menu;
    if (!menu) return;
    this.clearGarage();
    this.menu = null;
    this.menuStart = null;
    const anim = animate(menu, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-out', fill: 'forwards' });
    if (anim) anim.onfinish = () => menu.remove();
    else menu.remove();
  }

  removeMenu() {
    if (this.menu) this.menu.remove();
    this.clearGarage();
    this.menu = null;
    this.menuStart = null;
  }

  clearGarage() {
    if (this.garage && this.garage.timer) clearTimeout(this.garage.timer);
    this.garage = null;
  }

  // ---------------------------------------------------------------- duraklatma

  showPause(visible, { onResume, onRestart, onMenu } = {}) {
    if (!visible) {
      if (this.pause) this.pause.remove();
      this.pause = null;
      this.pauseResume = null;
      this.pauseRestart = null;
      this.pauseMenu = null;
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
            <button class="nr-btn nr-btn-ghost nr-pause-menu interactive" type="button"><span>ANA MENÜ</span></button>
          </div>
          <div class="nr-hint">P / ESC İLE DEVAM</div>
        </div>`;
      ov.querySelector('.nr-resume').addEventListener('click', () => this.pauseResume && this.pauseResume());
      ov.querySelector('.nr-restart').addEventListener('click', () => this.pauseRestart && this.pauseRestart());
      ov.querySelector('.nr-pause-menu').addEventListener('click', () => this.pauseMenu && this.pauseMenu());
      this.el.appendChild(ov);
      this.pause = ov;
      animate(ov.querySelector('.nr-pause-box'), [
        { opacity: 0, transform: 'scale(1.15)' },
        { opacity: 1, transform: 'scale(1)' },
      ], { duration: 220, easing: 'ease-out' });
    }
    this.pauseResume = typeof onResume === 'function' ? onResume : null;
    this.pauseRestart = typeof onRestart === 'function' ? onRestart : null;
    this.pauseMenu = typeof onMenu === 'function' ? onMenu : null;
    this.pause.querySelector('.nr-pause-menu').classList.toggle('nr-hidden', !this.pauseMenu);
  }

  // ---------------------------------------------------------------- sonuçlar

  // opts: { record: { newBestTime, newBestLap, bestTime, bestLap }, trackName, onMenu }
  showResults(rows, onRestart, opts = {}) {
    if (this.results) {
      this.results.remove();
      this.results = null;
      this.resultsRestart = null;
      this.resultsMenu = null;
    }
    if (!rows) return;
    const { record = null, trackName = '', onMenu = null } = opts || {};

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
    if (trackName) {
      const tn = el('div', 'nr-res-track', trackName);
      tn.lang = 'en';
      titles.appendChild(tn);
    }
    head.appendChild(titles);
    box.appendChild(head);

    const newRecord = Boolean(record && (record.newBestTime || record.newBestLap));
    let badge = null;
    if (newRecord) {
      badge = el('div', 'nr-res-badge');
      badge.appendChild(el('span', 'nr-res-badge-t', 'YENİ REKOR!'));
      box.appendChild(badge);
    }

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

    // En iyi süre / tur (pist rekoru; yoksa bu yarışın değerleri)
    const bestTime = record && Number.isFinite(record.bestTime) ? record.bestTime : (me && Number.isFinite(me.time) ? me.time : null);
    const bestLap = record && Number.isFinite(record.bestLap) ? record.bestLap : (me && Number.isFinite(me.bestLap) ? me.bestLap : null);
    if (bestTime !== null || bestLap !== null) {
      const stats = el('div', 'nr-res-stats');
      const chip = (label, value, isNew) => {
        const c = el('div', `nr-res-stat${isNew ? ' nr-res-new' : ''}`);
        c.appendChild(el('span', 'nr-res-stat-k', label));
        c.appendChild(el('b', 'nr-num', fmtTime(value)));
        if (isNew) c.appendChild(el('i', 'nr-res-stat-n', 'YENİ'));
        stats.appendChild(c);
      };
      if (bestTime !== null) chip('EN İYİ SÜRE', bestTime, Boolean(record && record.newBestTime));
      if (bestLap !== null) chip('EN İYİ TUR', bestLap, Boolean(record && record.newBestLap));
      box.appendChild(stats);
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
    if (typeof onMenu === 'function') {
      const mbtn = el('button', 'nr-btn nr-btn-ghost interactive');
      mbtn.type = 'button';
      mbtn.appendChild(el('span', '', 'ANA MENÜ'));
      this.resultsMenu = () => {
        if (fired) return;
        fired = true;
        onMenu();
      };
      mbtn.addEventListener('click', () => this.resultsMenu && this.resultsMenu());
      actions.appendChild(mbtn);
    } else {
      this.resultsMenu = null;
    }
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
    if (badge) {
      animate(badge, [
        { opacity: 0, transform: 'skewX(-12deg) scale(0.3)' },
        { opacity: 1, transform: 'skewX(-12deg) scale(1.2)', offset: 0.6 },
        { opacity: 1, transform: 'skewX(-12deg) scale(1)' },
      ], { duration: 520, delay: 380, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'backwards' });
    }
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
    if (this.menu && this.garage) {
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        this.garageStepCar(e.code === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (enter || space) {
        // Odaktaki menü düğmesi kendi etkinleşmesini yapsın (klavyeyle Tab ile gezen için).
        const a = document.activeElement;
        if (a && a.tagName === 'BUTTON' && this.menu.contains(a)) return;
        e.preventDefault();
        if (this.menuStart) this.menuStart();
        return;
      }
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
