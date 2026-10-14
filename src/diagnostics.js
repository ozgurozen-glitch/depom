// Diagnostics: 3B görüntü gelmediğinde (WebGL bağlamı kaybı, hatalı çizim hattı, yakalanmamış hata)
// oyuncuya nedenini gösteren panel. Adres sonuna #debug eklenirse panel her zaman açılır.
const MAX_ERRORS = 6;

export class Diagnostics {
  constructor(renderer) {
    this.renderer = renderer;
    this.errors = [];
    this.notes = [];
    this.panel = null;
    this.contextLost = false;

    window.addEventListener('error', (e) => this.addError(e.message || String(e.error)));
    window.addEventListener('unhandledrejection', (e) => this.addError((e.reason && e.reason.message) || String(e.reason)));
    // three.js gölgelendirici derleme hatalarını console.error ile bildirir.
    const origError = console.error.bind(console);
    console.error = (...args) => {
      this.addError(args.map((a) => (a && a.message) || String(a)).join(' '));
      origError(...args);
    };

    const canvas = renderer.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.show('Grafik kartı bağlantısı koptu (WebGL bağlamı kayboldu). Bu genelde ekran kartı belleği yetmediğinde olur.');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.note('WebGL bağlamı geri geldi; sayfayı yenilemen önerilir.');
    });

    // Bağlam kaybolunca GPU bilgisi okunamaz; açılışta kaydet.
    this.gpu = this.gpuInfo();

    if (window.location.hash === '#debug') setTimeout(() => this.show('Hata ayıklama paneli (#debug).'), 1500);
  }

  addError(text) {
    if (!text) return;
    this.errors.push(String(text).slice(0, 300));
    if (this.errors.length > MAX_ERRORS) this.errors.shift();
    this.errorCount = (this.errorCount || 0) + 1;
    if (this.panel) this.render();
    else if (this.errorCount >= 3) this.show('Oyun çalışırken art arda hata oluştu.');
  }

  note(text) {
    this.notes.push(text);
    if (this.panel) this.render();
  }

  gpuInfo() {
    const gl = this.renderer.getContext();
    const info = { webgl: '?', gpu: '?', halfFloatRT: '?', floatRT: '?' };
    try {
      info.webgl = this.renderer.capabilities.isWebGL2 ? 'WebGL 2' : 'WebGL 1';
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      info.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      info.halfFloatRT = gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float') ? 'var' : 'yok';
      info.floatRT = gl.getExtension('EXT_color_buffer_float') ? 'var' : 'yok';
    } catch (err) {
      info.gpu = `okunamadı (${err.message})`;
    }
    return info;
  }

  show(reason) {
    if (!this.panel) {
      const el = document.createElement('div');
      el.className = 'interactive';
      el.style.cssText = [
        'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)', 'z-index:50',
        'width:min(560px, calc(100vw - 32px))', 'max-height:calc(100vh - 32px)', 'overflow:auto',
        'padding:18px 20px', 'border-radius:10px', 'background:rgba(8,12,22,0.94)', 'color:#e8f6ff',
        'border:1px solid rgba(0,229,255,0.4)', 'font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif',
        'user-select:text', '-webkit-user-select:text', 'pointer-events:auto',
      ].join(';');
      document.body.appendChild(el);
      this.panel = el;
    }
    this.reason = reason;
    this.render();
  }

  render() {
    const g = this.contextLost ? this.gpu : this.gpuInfo();
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const list = (items) => items.map((t) => `<li>${esc(t)}</li>`).join('');
    this.panel.innerHTML = `
      <div style="font-weight:800;font-size:16px;margin-bottom:6px;color:#ffd400">3B görüntü yüklenemedi</div>
      <div style="margin-bottom:10px">${esc(this.reason)}</div>
      <div style="font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:6px">
        ${esc(g.webgl)} · GPU: ${esc(g.gpu)}<br>
        Yarım float hedef: ${esc(g.halfFloatRT)} · Float hedef: ${esc(g.floatRT)} · Bağlam kayıp: ${this.contextLost ? 'evet' : 'hayır'}<br>
        Ekran: ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio || 1}x · ${esc(navigator.userAgent)}
        ${this.notes.length ? `<ul style="margin:6px 0 0;padding-left:18px">${list(this.notes)}</ul>` : ''}
        ${this.errors.length ? `<div style="margin-top:6px;color:#ff8a95">Hatalar:</div><ul style="margin:2px 0 0;padding-left:18px">${list(this.errors)}</ul>` : ''}
      </div>
      <div style="margin-top:10px;opacity:0.8">Bu panelin ekran görüntüsünü gönderirsen sorunu bulmama yardımcı olur.</div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button type="button" data-act="reload" style="padding:8px 14px;border-radius:6px;border:0;background:#00e5ff;color:#04121c;font-weight:800;cursor:pointer">Yeniden yükle</button>
        <button type="button" data-act="close" style="padding:8px 14px;border-radius:6px;border:1px solid rgba(255,255,255,0.4);background:transparent;color:#e8f6ff;font-weight:700;cursor:pointer">Kapat</button>
      </div>`;
    this.panel.querySelector('[data-act="reload"]').onclick = () => window.location.reload();
    this.panel.querySelector('[data-act="close"]').onclick = () => { this.panel.remove(); this.panel = null; };
  }
}
