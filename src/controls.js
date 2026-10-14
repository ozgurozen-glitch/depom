// Controls: klavye + gamepad + dokunmatik giriş.
//
// Gaz MANUELDİR: ↑/W gaz, ↓/S fren (durunca geri vites), Space el freni/drift (frenden ayrı; direksiyonla
// birlikte yeterli hızda basılırsa drift'e girer), Shift/N nitro, C kamera, P/Esc duraklat, R yeniden başlat.
// Gamepad: RT gaz (analog), LT fren, A nitro, B/X drift. Dokunmatik: ◀ ▶, GAZ ve FREN pedalları, NITRO, DRIFT.
// Nitro basma kenarlarını Car algılar; burada yalnızca "basılı mı" bilgisi verilir.
const STEER_RAMP_TIME = 0.1; // dijital direksiyonun tam sapmaya varış süresi (s)
const STEER_RETURN_RATE = 1 / 0.07; // bırakınca merkeze dönüş
const STEER_REVERSE_RATE = 1 / 0.05; // ters yöne geçişte merkezi hızlı geç
const STICK_DEADZONE = 0.15;
const TRIGGER_THRESHOLD = 0.35;

const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  throttle: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  drift: ['Space'],
  nitro: ['ShiftLeft', 'ShiftRight', 'KeyN'],
  pause: ['Escape', 'KeyP'],
  restart: ['KeyR'],
  camera: ['KeyC'],
};
const GAME_KEYS = new Set([...KEYS.left, ...KEYS.right, ...KEYS.throttle, ...KEYS.brake, ...KEYS.drift, ...KEYS.nitro]);

const STYLE_ID = 'touch-controls-style';
const STYLE = `
.tc-root { position: absolute; inset: 0; pointer-events: none; display: none;
  --tc-steer: clamp(70px, 10vmin + 30px, 112px); --tc-nitro: clamp(62px, 9vmin + 28px, 96px);
  --tc-drift: clamp(58px, 7vmin + 30px, 88px); --tc-gap: clamp(8px, 1.6vmin, 14px);
  --tc-pedal: clamp(64px, 8vmin + 34px, 96px); --tc-redge: max(14px, env(safe-area-inset-right));
  --tc-edge: max(14px, env(safe-area-inset-left)); --tc-bottom: max(16px, env(safe-area-inset-bottom)); }
.tc-root.tc-visible { display: block; }
.tc-btn { position: absolute; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,0.92); font: 800 14px/1 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  letter-spacing: 0.08em; text-shadow: 0 1px 3px rgba(0,0,0,0.6); touch-action: none; user-select: none;
  -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;
  transition: transform 70ms ease-out, background-color 70ms, box-shadow 70ms, border-color 70ms; }
.tc-steer { bottom: var(--tc-bottom); width: var(--tc-steer); height: calc(var(--tc-steer) * 0.92);
  background: rgba(12,16,26,0.38); border: 2px solid rgba(255,255,255,0.45); border-radius: 10px;
  transform: skewX(-12deg); box-shadow: 0 4px 16px rgba(0,0,0,0.25); }
.tc-steer svg { width: 44%; height: 44%; transform: skewX(12deg); fill: rgba(255,255,255,0.9);
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6)); }
.tc-left { left: calc(var(--tc-edge) + 6px); }
.tc-right { left: calc(var(--tc-edge) + 6px + var(--tc-steer) + var(--tc-gap)); }
.tc-steer.tc-pressed { background: rgba(255,255,255,0.32); border-color: #fff; transform: skewX(-12deg) scale(0.95); }
.tc-round { border-radius: 50%; flex-direction: column; gap: 3px; }
.tc-pedal { right: calc(var(--tc-redge)); bottom: var(--tc-bottom); width: var(--tc-pedal); height: calc(var(--tc-pedal) * 1.55);
  border-radius: 20px 20px 14px 14px; flex-direction: column; gap: 6px; font-size: clamp(12px, 1.4vmin + 7px, 17px);
  background: linear-gradient(180deg, rgba(60,220,110,0.5), rgba(10,120,60,0.38)); border: 3px solid rgba(130,255,170,0.85);
  box-shadow: 0 4px 16px rgba(0,0,0,0.3), inset 0 0 14px rgba(120,255,170,0.25); }
.tc-pedal svg { width: 34%; height: auto; fill: #eafff1; }
.tc-pedal.tc-pressed { transform: scale(0.95); background: linear-gradient(180deg, rgba(130,255,170,0.75), rgba(30,180,90,0.6)); }
.tc-brake { right: calc(var(--tc-redge) + var(--tc-pedal) + var(--tc-gap)); width: calc(var(--tc-pedal) * 0.86); height: calc(var(--tc-pedal) * 1.12);
  background: linear-gradient(180deg, rgba(255,90,90,0.5), rgba(150,20,30,0.4)); border-color: rgba(255,140,140,0.85);
  box-shadow: 0 4px 16px rgba(0,0,0,0.3), inset 0 0 14px rgba(255,120,120,0.25); }
.tc-brake.tc-pressed { background: linear-gradient(180deg, rgba(255,150,150,0.75), rgba(210,50,60,0.6)); }
.tc-nitro { right: calc(var(--tc-redge) + var(--tc-pedal) * 1.86 + var(--tc-gap) * 2); bottom: calc(var(--tc-bottom) + 4px);
  width: var(--tc-nitro); height: var(--tc-nitro); font-size: clamp(12px, 1.3vmin + 7px, 17px);
  background: radial-gradient(circle at 50% 38%, rgba(70,235,255,0.55), rgba(0,150,200,0.32) 62%, rgba(0,60,90,0.3));
  border: 3px solid rgba(110,240,255,0.85); box-shadow: 0 0 18px rgba(0,220,255,0.45), inset 0 0 16px rgba(0,220,255,0.3); }
.tc-nitro.tc-pressed { transform: scale(0.93); background: radial-gradient(circle, rgba(160,250,255,0.8), rgba(0,190,240,0.55));
  box-shadow: 0 0 30px rgba(0,230,255,0.85), inset 0 0 20px rgba(255,255,255,0.4); }
.tc-nitro svg { width: 30%; height: 30%; fill: #eafff1; }
.tc-drift { right: calc(var(--tc-redge) + var(--tc-pedal) * 1.86 + var(--tc-gap) * 3 + var(--tc-nitro));
  bottom: calc(var(--tc-bottom) + 2px); width: var(--tc-drift); height: var(--tc-drift); font-size: clamp(11px, 1.2vmin + 6px, 15px);
  background: rgba(12,16,26,0.38); border: 2px solid rgba(255,190,90,0.75); box-shadow: 0 4px 16px rgba(0,0,0,0.25); }
.tc-drift.tc-pressed { transform: scale(0.93); background: rgba(255,170,60,0.4); border-color: #ffd28a; }
.tc-pause, .tc-camera { top: max(8px, env(safe-area-inset-top)); width: 48px; height: 48px;
  border-radius: 12px; background: rgba(12,16,26,0.45); border: 2px solid rgba(255,255,255,0.5); font-size: 18px; letter-spacing: 0; }
.tc-pause { right: max(8px, env(safe-area-inset-right)); }
.tc-camera { right: calc(max(8px, env(safe-area-inset-right)) + 48px + 8px); }
.tc-camera svg { width: 24px; height: 24px; fill: rgba(255,255,255,0.92); filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6)); }
.tc-pause.tc-pressed, .tc-camera.tc-pressed { background: rgba(255,255,255,0.35); }
@media (max-height: 420px) { .tc-root { --tc-steer: 72px; --tc-nitro: 66px; --tc-drift: 60px; --tc-pedal: 68px; } }
/* Dikey: nitro ve drift pedalların üstünde (iki sıra), ekranın alt-ortasındaki hız göstergesine binmesin */
@media (orientation: portrait) {
  .tc-root { --tc-lift: 0px; }
  .tc-nitro { right: var(--tc-redge); bottom: calc(var(--tc-bottom) + var(--tc-pedal) * 1.55 + var(--tc-gap)); }
  .tc-drift { right: calc(var(--tc-redge) + var(--tc-nitro) + var(--tc-gap)); bottom: calc(var(--tc-bottom) + var(--tc-pedal) * 1.55 + var(--tc-gap)); }
}
`;

const ARROW_LEFT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 3.5 6 12l10.5 8.5z"/></svg>';
const ARROW_RIGHT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 3.5 18 12 7.5 20.5z"/></svg>';
const CHEVRON_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3 15h6v6h6v-6h6z"/></svg>';
const CHEVRON_DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21 3 9h6V3h6v6h6z"/></svg>';
const BOLT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 1 4 14h6.5L9 23l11-14h-7z"/></svg>';
// Kamera gövdesi + mercek (evenodd ile delik): görünüm değiştirme düğmesi.
const CAMERA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M4 7h3.2l1.6-2.4h6.4L16.8 7H20a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 19H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 7zm8 2.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 1 0 0-6.8z"/></svg>';

export class Controls {
  constructor(domElement) {
    this.domElement = domElement || null;
    this.keys = new Set();
    this.pauseQueued = false;
    this.restartQueued = false;
    this.cameraQueued = false;
    this.isTouch = typeof window !== 'undefined'
      && ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0);

    this.steer = 0; // yumuşatılmış dijital direksiyon
    this.lastSteerTime = null;
    this.input = { throttle: 0, brake: 0, steer: 0, nitro: false, drift: false };

    // Dokunmatik
    this.touchVisible = false;
    this.pointers = new Map(); // pointerId → 'left' | 'right' | 'gas' | 'brake' | 'nitro' | 'drift'
    this.buttons = {};

    // Gamepad
    this.pad = { steer: 0, throttle: 0, brake: false, nitro: false, drift: false, active: false };
    this.padPrev = { start: false, select: false, camera: false };
    this.padPolledAt = -1;

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onBlur = this.onBlur.bind(this);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);

    this.buildTouchUI();
  }

  // --- Klavye --------------------------------------------------------------------------------

  onKeyDown(e) {
    if (GAME_KEYS.has(e.code)) {
      const t = e.target;
      const tag = t && t.tagName;
      const onWidget = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON';
      // Space bir HUD düğmesine odaklıyken düğmeyi tetiklesin; aksi halde sayfa kaymasın.
      if (onWidget && e.code === 'Space') return;
      e.preventDefault();
    }
    this.keys.add(e.code);
    if (e.repeat) return;
    if (KEYS.pause.includes(e.code)) this.pauseQueued = true;
    if (KEYS.restart.includes(e.code)) this.restartQueued = true;
    if (KEYS.camera.includes(e.code) && !(e.ctrlKey || e.metaKey || e.altKey)) this.cameraQueued = true;
  }

  onKeyUp(e) {
    this.keys.delete(e.code);
  }

  onBlur() {
    this.keys.clear();
    this.releaseAllPointers();
  }

  anyKey(list) {
    for (const k of list) if (this.keys.has(k)) return true;
    return false;
  }

  // --- Gamepad -------------------------------------------------------------------------------

  pollGamepad() {
    const now = performance.now();
    if (now - this.padPolledAt < 4) return; // aynı karede tekrar okuma
    this.padPolledAt = now;
    const pad = this.pad;
    pad.active = false;
    pad.steer = 0;
    pad.throttle = 0;
    pad.brake = false;
    pad.nitro = false;
    pad.drift = false;
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    let list;
    try {
      list = navigator.getGamepads();
    } catch {
      return;
    }
    let start = false;
    let select = false;
    let camera = false;
    for (const gp of list || []) {
      if (!gp || !gp.connected) continue;
      const b = (i) => gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > TRIGGER_THRESHOLD);
      let x = gp.axes[0] || 0;
      x = Math.abs(x) < STICK_DEADZONE ? 0 : (x - Math.sign(x) * STICK_DEADZONE) / (1 - STICK_DEADZONE);
      // Hafif üstel eğri: merkezde hassas, uçta tam.
      x = Math.sign(x) * (Math.abs(x) ** 1.4);
      if (b(14)) x = -1;
      if (b(15)) x = 1;
      if (x !== 0) pad.steer = x;
      if (gp.buttons[7]) pad.throttle = Math.max(pad.throttle, gp.buttons[7].pressed && !gp.buttons[7].value ? 1 : gp.buttons[7].value); // RT: analog gaz
      if (b(6)) pad.brake = true; // LT: fren / geri
      if (b(0)) pad.nitro = true; // A
      if (b(1) || b(2)) pad.drift = true; // B / X: drift
      if (b(9)) start = true;
      if (b(8)) select = true;
      if (b(3)) camera = true; // Y / üçgen
      pad.active = true;
    }
    if (start && !this.padPrev.start) this.pauseQueued = true;
    if (select && !this.padPrev.select) this.restartQueued = true;
    if (camera && !this.padPrev.camera) this.cameraQueued = true;
    this.padPrev.start = start;
    this.padPrev.select = select;
    this.padPrev.camera = camera;
  }

  // --- Ana API -------------------------------------------------------------------------------

  getInput() {
    this.pollGamepad();
    const now = performance.now();
    const dt = this.lastSteerTime === null ? 0 : Math.min(0.05, Math.max(0, (now - this.lastSteerTime) / 1000));
    this.lastSteerTime = now;

    const left = this.anyKey(KEYS.left) || this.touchHas('left');
    const right = this.anyKey(KEYS.right) || this.touchHas('right');
    const digital = (right ? 1 : 0) - (left ? 1 : 0);
    // Dijital direksiyon ≈0.1 s'lik rampa ile yumuşar.
    const cur = this.steer;
    let rate;
    if (digital === 0) rate = STEER_RETURN_RATE;
    else if (cur !== 0 && Math.sign(cur) !== digital) rate = STEER_REVERSE_RATE;
    else rate = 1 / STEER_RAMP_TIME;
    const step = rate * dt;
    if (digital > cur) this.steer = Math.min(digital, cur + step);
    else if (digital < cur) this.steer = Math.max(digital, cur - step);

    let steer = this.steer;
    if (this.pad.active && this.pad.steer !== 0 && digital === 0) steer = this.pad.steer;

    const gas = this.anyKey(KEYS.throttle) || this.touchHas('gas');
    const brake = this.anyKey(KEYS.brake) || this.touchHas('brake') || this.pad.brake;
    const drift = this.anyKey(KEYS.drift) || this.touchHas('drift') || this.pad.drift;
    const nitro = this.anyKey(KEYS.nitro) || this.touchHas('nitro') || this.pad.nitro;

    const out = this.input;
    out.throttle = gas ? 1 : Math.max(0, Math.min(1, this.pad.throttle));
    out.brake = brake ? 1 : 0;
    out.steer = Math.max(-1, Math.min(1, steer));
    out.nitro = nitro;
    out.drift = drift;
    return out; // her çağrıda aynı nesne (çağıran hemen okur; saklamak isterse kopyalamalı)
  }

  consumePause() {
    this.pollGamepad();
    const v = this.pauseQueued;
    this.pauseQueued = false;
    return v;
  }

  consumeRestart() {
    this.pollGamepad();
    const v = this.restartQueued;
    this.restartQueued = false;
    return v;
  }

  // Kamera görünümü değiştirme isteği: C tuşu, gamepad Y, dokunmatik kamera düğmesi.
  consumeCameraToggle() {
    this.pollGamepad();
    const v = this.cameraQueued;
    this.cameraQueued = false;
    return v;
  }

  setTouchVisible(visible) {
    this.touchVisible = Boolean(visible) && this.isTouch;
    if (this.touchRoot) this.touchRoot.classList.toggle('tc-visible', this.touchVisible);
    if (!this.touchVisible) this.releaseAllPointers();
  }

  // --- Dokunmatik ----------------------------------------------------------------------------

  touchHas(name) {
    if (!this.touchVisible || this.pointers.size === 0) return false;
    for (const v of this.pointers.values()) if (v === name) return true;
    return false;
  }

  buildTouchUI() {
    if (typeof document === 'undefined') return;
    const hud = document.getElementById('hud') || document.body;
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
    const root = document.createElement('div');
    root.className = 'tc-root';
    root.setAttribute('aria-hidden', 'true');

    const make = (name, cls, html, label) => {
      const el = document.createElement('div');
      el.className = `tc-btn interactive ${cls}`;
      el.dataset.btn = name;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', label);
      el.innerHTML = html;
      root.appendChild(el);
      this.buttons[name] = el;
      return el;
    };
    make('left', 'tc-steer tc-left', ARROW_LEFT, 'Sola');
    make('right', 'tc-steer tc-right', ARROW_RIGHT, 'Sağa');
    make('gas', 'tc-pedal tc-gas', `${CHEVRON_UP}<span>GAZ</span>`, 'Gaz');
    make('brake', 'tc-pedal tc-brake', `${CHEVRON_DOWN}<span>FREN</span>`, 'Fren / geri');
    make('drift', 'tc-round tc-drift', '<span>DRIFT</span>', 'Drift / el freni');
    make('nitro', 'tc-round tc-nitro', `${BOLT}<span>NITRO</span>`, 'Nitro');
    make('pause', 'tc-pause', 'II', 'Duraklat');
    make('camera', 'tc-camera', CAMERA_ICON, 'Kamera görünümü');

    root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    root.addEventListener('pointermove', (e) => this.onPointerMove(e));
    const up = (e) => this.onPointerUp(e);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    root.addEventListener('lostpointercapture', up);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    // iOS: uzun basmada büyüteç / seçim açılmasın.
    root.addEventListener('touchstart', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });

    hud.appendChild(root);
    this.touchRoot = root;
  }

  onPointerDown(e) {
    const btn = e.target.closest && e.target.closest('[data-btn]');
    if (!btn) return;
    if (e.cancelable) e.preventDefault();
    const name = btn.dataset.btn;
    if (name === 'pause' || name === 'camera') {
      if (name === 'pause') this.pauseQueued = true;
      else this.cameraQueued = true;
      btn.classList.add('tc-pressed');
      setTimeout(() => btn.classList.remove('tc-pressed'), 120);
      return;
    }
    this.pointers.set(e.pointerId, name);
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {
      // bazı tarayıcılarda sentetik olaylar yakalanamaz
    }
    this.refreshPressed();
  }

  onPointerMove(e) {
    const cur = this.pointers.get(e.pointerId);
    if (cur !== 'left' && cur !== 'right') return;
    // Başparmak sol↔sağ düğme arasında kaydırılabilir.
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const btn = el && el.closest && el.closest('[data-btn]');
    const name = btn && btn.dataset.btn;
    if ((name === 'left' || name === 'right') && name !== cur) {
      this.pointers.set(e.pointerId, name);
      this.refreshPressed();
    }
  }

  onPointerUp(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    this.refreshPressed();
  }

  releaseAllPointers() {
    if (this.pointers.size === 0) return;
    this.pointers.clear();
    this.refreshPressed();
  }

  refreshPressed() {
    for (const [name, el] of Object.entries(this.buttons)) {
      if (name === 'pause' || name === 'camera') continue;
      let on = false;
      for (const v of this.pointers.values()) if (v === name) on = true;
      el.classList.toggle('tc-pressed', on);
    }
  }
}
